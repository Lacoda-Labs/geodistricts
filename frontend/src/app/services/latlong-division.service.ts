import { Injectable, Injector, forwardRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { GeoJsonFeature } from './census.service';
import { DistrictGroup, GeodistrictAlgorithmService, ALGORITHM_VERSION } from './geodistrict-algorithm.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LatLongDivisionService {
  private algorithmService: GeodistrictAlgorithmService | null = null;
  // Use base URL without /api since routes already include /api
  private readonly backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';

  constructor(
    private injector: Injector,
    private http: HttpClient
  ) {}

  private getAlgorithmService(): GeodistrictAlgorithmService {
    if (!this.algorithmService) {
      this.algorithmService = this.injector.get(GeodistrictAlgorithmService);
    }
    return this.algorithmService;
  }

  /**
   * Generate a cache key for division results
   */
  private generateCacheKey(group: DistrictGroup, direction: 'latitude' | 'longitude'): string {
    // Create a unique key based on group properties and direction
    const keyData = {
      startDistrict: group.startDistrictNumber,
      endDistrict: group.endDistrictNumber,
      totalDistricts: group.totalDistricts,
      tractCount: group.censusTracts.length,
      totalPopulation: group.totalPopulation,
      direction: direction,
      // Include bounds for uniqueness
      north: group.bounds.north.toFixed(6),
      south: group.bounds.south.toFixed(6),
      east: group.bounds.east.toFixed(6),
      west: group.bounds.west.toFixed(6)
    };

    // Simple hash function for the key
    const str = JSON.stringify(keyData);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `latlong_division_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if cached result exists for this division
   */
  private checkCache(cacheKey: string): Observable<any> {
    // Include algorithm version in query parameter for cache validation
    const url = `${this.backendUrl}/api/algorithm/latlong/cache/${encodeURIComponent(cacheKey)}?algorithmVersion=${ALGORITHM_VERSION}`;
    return this.http.get<{ status: string; cached: boolean; data?: any; algorithmVersion?: string }>(url).pipe(
      map((response: any) => {
        if (response.cached && response.data) {
          // Check algorithm version - if missing or doesn't match, invalidate cache
          if (!response.algorithmVersion) {
            console.log(`🔄 LATLONG CACHE: Algorithm version missing. Old cache entry without version. Treating as cache miss.`);
            return null;
          }
          
          if (response.algorithmVersion !== ALGORITHM_VERSION) {
            console.log(`🔄 LATLONG CACHE: Algorithm version mismatch. cached=${response.algorithmVersion}, current=${ALGORITHM_VERSION}. Treating as cache miss.`);
            return null;
          }
          
          console.log(`✅ LATLONG CACHE HIT: Retrieved cached result for key: ${cacheKey} (algorithm version: ${response.algorithmVersion})`);
          return response.data;
        }
        return null;
      }),
      catchError(error => {
        console.warn(`⚠️ LATLONG CACHE CHECK FAILED: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Store division result in cache
   */
  private storeInCache(cacheKey: string, divisionResult: any): Observable<any> {
    const url = `${this.backendUrl}/api/algorithm/latlong/cache`;
    const payload = {
      cacheKey,
      divisionResult,
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      algorithmVersion: ALGORITHM_VERSION // Include algorithm version for cache validation
    };

    return this.http.post(url, payload).pipe(
      map((response: any) => {
        console.log(`💾 LATLONG CACHE: Stored result for key: ${cacheKey}`);
        return response;
      }),
      catchError(error => {
        console.warn(`⚠️ LATLONG CACHE STORE FAILED: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @param forceRecalculate Force recalculation even if cached result exists
   * @returns Observable with division result
   */
  divideDistrictGroup(group: DistrictGroup, direction: 'latitude' | 'longitude', forceRecalculate: boolean = false): Observable<{
    groups: DistrictGroup[];
    history: string[];
    dividingLine: number;
    intersectingTractIds?: string[];
  }> {
    return new Observable(observer => {
      const cacheKey = this.generateCacheKey(group, direction);

      // Check cache first unless force recalculate is requested
      if (!forceRecalculate) {
        this.checkCache(cacheKey).subscribe(cachedResult => {
          if (cachedResult) {
            observer.next(cachedResult);
            observer.complete();
            return;
          }

          // Cache miss - compute the result
          this.computeDivisionResult(group, direction, cacheKey).subscribe(result => {
            observer.next(result);
            observer.complete();
          });
        });
      } else {
        // Force recalculate - compute directly
        this.computeDivisionResult(group, direction, cacheKey).subscribe(result => {
          observer.next(result);
          observer.complete();
        });
      }
    });
  }

  /**
   * Compute the division result (extracted from the original method)
   */
  private computeDivisionResult(group: DistrictGroup, direction: 'latitude' | 'longitude', cacheKey: string): Observable<{
    groups: DistrictGroup[];
    history: string[];
    dividingLine: number;
    intersectingTractIds?: string[];
  }> {
    return new Observable(observer => {
      const { totalDistricts } = group;

      // Calculate how to divide the districts
      const division = this.calculateOptimalDivision(totalDistricts);

      // Calculate target population for each group
      const totalPopulation = group.totalPopulation;
      const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
      const targetSecondGroupPopulation = group.totalPopulation - targetFirstGroupPopulation;

      // Find the dividing line using iterative approach
      const dividingLine = this.findOptimalDividingLine(group.censusTracts, direction, targetFirstGroupPopulation);

      // Create history array early so it can be updated during refinement
      const history: string[] = [];

      // Divide tracts based on the dividing line
      const { firstGroupTracts, secondGroupTracts, intersectingTractIds } = this.divideTractsByLine(
        group.censusTracts,
        direction,
        dividingLine,
        targetFirstGroupPopulation,
        targetSecondGroupPopulation,
        history
      );

      // Validate contiguity of both groups
      const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
      const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

      if (!firstGroupContiguous || !secondGroupContiguous) {
        console.warn(`⚠️  Lat/long division resulted in non-contiguous groups. This is expected for some geographic configurations.`);
      }

      // Create new district groups
      const firstGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.startDistrictNumber + division.first - 1,
        censusTracts: firstGroupTracts,
        totalDistricts: division.first,
        totalPopulation: firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
        bounds: this.calculateBounds(firstGroupTracts),
        centroid: this.calculateCentroid(firstGroupTracts)
      };

      const secondGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber + division.first,
        endDistrictNumber: group.endDistrictNumber,
        censusTracts: secondGroupTracts,
        totalDistricts: division.second,
        totalPopulation: secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
        bounds: this.calculateBounds(secondGroupTracts),
        centroid: this.calculateCentroid(secondGroupTracts)
      };

      // Check for high variance and log warning
      const actualFirstPopulation = firstGroup.totalPopulation;
      const actualVariance = Math.abs(actualFirstPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation;

      // Calculate how many tracts need to move to balance populations
      const averageTractPopulation = group.totalPopulation / group.censusTracts.length;
      let firstGroupDifference = firstGroup.totalPopulation - targetFirstGroupPopulation;
      let secondGroupDifference = secondGroup.totalPopulation - targetSecondGroupPopulation;

      // Determine which group is over target and needs to give tracts
      let tractsToMove = 0;
      let moveDirection = '';
      if (firstGroupDifference > 0 && secondGroupDifference < 0) {
        // First group is over, second group is under - move from first to second
        const populationToMove = Math.min(Math.abs(firstGroupDifference), Math.abs(secondGroupDifference));
        tractsToMove = Math.round(populationToMove / averageTractPopulation);
        moveDirection = direction === 'latitude' ? 'south to north' : 'west to east';
      } else if (firstGroupDifference < 0 && secondGroupDifference > 0) {
        // First group is under, second group is over - move from second to first
        const populationToMove = Math.min(Math.abs(firstGroupDifference), Math.abs(secondGroupDifference));
        tractsToMove = Math.round(populationToMove / averageTractPopulation);
        moveDirection = direction === 'latitude' ? 'north to south' : 'east to west';
      }

      if (actualVariance > 0.05) { // >5% variance
        console.warn(`⚠️ High population variance detected: ${(actualVariance * 100).toFixed(1)}% (target: ${targetFirstGroupPopulation.toLocaleString()}, actual: ${actualFirstPopulation.toLocaleString()})`);
        console.warn(`   This may indicate complex geographic distribution that requires multiple dividing lines or different approach.`);
      }

      if (tractsToMove > 0) {
        console.log(`📊 To balance variance: move ~${tractsToMove} tract(s) ${moveDirection} (avg tract pop: ${averageTractPopulation.toFixed(0)})`);
      }

      // Format ratio for display (e.g., 50/50, 66/34)
      // division.ratio is already in percentages [50, 50] or [66, 34]
      const ratioDisplay = `${division.ratio[0]}/${division.ratio[1]}`;

      // Add initial history entries (history array was created earlier and passed to divideTractsByLine)
      history.push(
        `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} lat/long line at ${dividingLine.toFixed(6) + (direction === 'latitude' ? '°N' : '°W')} by ${ratioDisplay} ratio`,
        `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
        `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`,
        `  - Population variance: ${(actualVariance * 100).toFixed(1)}%`
      );

      if (tractsToMove > 0) {
        history.push(`  - To balance variance: move ~${tractsToMove} tract(s) ${moveDirection} (avg tract pop: ${averageTractPopulation.toFixed(0)})`);
      }

      const result = {
        groups: [firstGroup, secondGroup],
        history,
        dividingLine,
        intersectingTractIds
      };

      // Store result in cache
      this.storeInCache(cacheKey, result).subscribe(() => {
        observer.next(result);
        observer.complete();
      });
    });
  }

  /**
   * Calculate optimal division of districts
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number]; first: number; second: number } {
    if (totalDistricts === 1) {
      return { ratio: [100, 0], first: 1, second: 0 };
    }

    const firstGroupDistricts = Math.ceil(totalDistricts / 2);
    const secondGroupDistricts = totalDistricts - firstGroupDistricts;

    const firstRatio = Math.round((firstGroupDistricts / totalDistricts) * 100);
    const secondRatio = 100 - firstRatio;

    return { ratio: [firstRatio, secondRatio], first: firstGroupDistricts, second: secondGroupDistricts };
  }

  /**
   * Find optimal dividing line using iterative approach
   */
  private findOptimalDividingLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', targetPopulation: number): number {
    console.log(`🔍 Finding optimal ${direction} dividing line for target population: ${targetPopulation.toLocaleString()}`);

    // Get the range of coordinates for the direction using bounding boxes
    const bounds = tracts.map(tract => this.getTractBounds(tract));

    let minCoord: number, maxCoord: number;
    if (direction === 'latitude') {
      minCoord = Math.min(...bounds.map(b => b.minLat));
      maxCoord = Math.max(...bounds.map(b => b.maxLat));
    } else {
      minCoord = Math.min(...bounds.map(b => b.minLng));
      maxCoord = Math.max(...bounds.map(b => b.maxLng));
    }
    const centerCoord = (minCoord + maxCoord) / 2;

    console.log(`📍 Coordinate range: ${minCoord.toFixed(6)} to ${maxCoord.toFixed(6)}, center: ${centerCoord.toFixed(6)}`);

    // Start with center coordinate and iterate to find optimal position
    let currentLine = centerCoord;
    let bestLine = centerCoord;
    let bestDifference = Infinity;
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.0001; // About 10 meters

    while (iterations < maxIterations) {
      // Calculate populations on each side of the line
      const { firstGroupPopulation, secondGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, currentLine);

      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      console.log(`  Iteration ${iterations + 1}: Line at ${currentLine.toFixed(6)}, populations: ${firstGroupPopulation.toLocaleString()} vs ${secondGroupPopulation.toLocaleString()}, difference: ${difference.toLocaleString()}`);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = currentLine;
      }

      // If we're close enough, stop
      if (difference < targetPopulation * 0.005) { // Within 1% of target
        console.log(`✅ Found optimal line at ${currentLine.toFixed(6)} within 1% tolerance`);
        break;
      }

      // Calculate adjustment based on population difference
      const populationDifference = firstGroupPopulation - targetPopulation;
      const populationRatio = Math.abs(populationDifference) / targetPopulation;

      // Determine direction to move the line
      let adjustment: number;
      if (direction === 'latitude') {
        // For latitude: if first group has too many people, move line north (increase latitude)
        // if first group has too few people, move line south (decrease latitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      } else {
        // For longitude: if first group has too many people, move line east (increase longitude)
        // if first group has too few people, move line west (decrease longitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      }

      console.log(`    Population difference: ${populationDifference.toLocaleString()}, adjustment: ${adjustment.toFixed(6)}`);

      // Prevent infinite loops by ensuring we don't go outside bounds
      const newLine = Math.max(minCoord, Math.min(maxCoord, currentLine + adjustment));

      if (Math.abs(newLine - currentLine) < tolerance) {
        console.log(`✅ Converged at line ${currentLine.toFixed(6)}`);
        break;
      }

      currentLine = newLine;
      iterations++;
    }

    console.log(`🎯 Final optimal ${direction} line: ${bestLine.toFixed(6)} (${iterations} iterations)`);

    // If we didn't converge well, try binary search as fallback
    if (bestDifference > targetPopulation * 0.05) { // If still >5% off target
      console.log(`🔄 Iterative approach didn't converge well (${bestDifference.toLocaleString()} difference), trying binary search...`);
      const binarySearchLine = this.binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord);
      const binarySearchDifference = Math.abs(this.calculatePopulationsByLine(tracts, direction, binarySearchLine).firstGroupPopulation - targetPopulation);

      if (binarySearchDifference < bestDifference) {
        console.log(`✅ Binary search found better line: ${binarySearchLine.toFixed(6)} (difference: ${binarySearchDifference.toLocaleString()})`);
        return binarySearchLine;
      }
    }

    return bestLine;
  }

  /**
   * Binary search for optimal dividing line
   */
  private binarySearchOptimalLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', targetPopulation: number, minCoord: number, maxCoord: number): number {
    let left = minCoord;
    let right = maxCoord;
    let bestLine = (left + right) / 2;
    let bestDifference = Infinity;
    const maxIterations = 50;
    const tolerance = 0.0001;

    for (let i = 0; i < maxIterations; i++) {
      const mid = (left + right) / 2;
      const { firstGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, mid);
      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = mid;
      }

      if (difference < targetPopulation * 0.01 || Math.abs(right - left) < tolerance) {
        break;
      }

      if (firstGroupPopulation < targetPopulation) {
        if (direction === 'latitude') {
          left = mid; // Move north (increase latitude)
        } else {
          left = mid; // Move east (increase longitude)
        }
      } else {
        if (direction === 'latitude') {
          right = mid; // Move south (decrease latitude)
        } else {
          right = mid; // Move west (decrease longitude)
        }
      }
    }

    return bestLine;
  }

  /**
   * Calculate populations on each side of a dividing line
   */
  private calculatePopulationsByLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', lineCoordinate: number): {
    firstGroupPopulation: number;
    secondGroupPopulation: number;
  } {
    let firstGroupPopulation = 0;
    let secondGroupPopulation = 0;

    for (const tract of tracts) {
      const population = tract.properties?.POPULATION || 0;
      const isEntirelyNorthOrWest = this.isTractEntirelyNorthOrWest(tract, direction, lineCoordinate);

      if (isEntirelyNorthOrWest) {
        firstGroupPopulation += population;
      } else {
        secondGroupPopulation += population;
      }
    }

    return { firstGroupPopulation, secondGroupPopulation };
  }

  /**
   * Divide tracts by a lat/long line using entire tract geometry
   */
  private divideTractsByLine(
    tracts: GeoJsonFeature[], 
    direction: 'latitude' | 'longitude', 
    lineCoordinate: number,
    targetFirstGroupPopulation: number,
    targetSecondGroupPopulation: number,
    history: string[] = []
  ): {
    firstGroupTracts: GeoJsonFeature[];
    secondGroupTracts: GeoJsonFeature[];
    intersectingTractIds: string[];
  } {
    // Use the algorithm service's divideTractsByLine method which has all the contiguity checking
    // We need to access it through the algorithm service, but since it's private, we'll need to make it public
    // For now, let's copy the full implementation here
    const firstGroupTracts: GeoJsonFeature[] = [];
    const secondGroupTracts: GeoJsonFeature[] = [];
    const intersectingTracts: GeoJsonFeature[] = [];

    // First pass: divide tracts and identify those that intersect the line
    for (const tract of tracts) {
      const isEntirelyNorthOrWest = this.isTractEntirelyNorthOrWest(tract, direction, lineCoordinate);
      const intersects = this.doesTractIntersectLine(tract, direction, lineCoordinate);

      if (intersects) {
        intersectingTracts.push(tract);
        // For intersecting tracts, use centroid to determine initial assignment
        const centroid = this.calculateTractCentroid(tract);
        const centroidOnFirstSide = direction === 'latitude' 
          ? centroid.lat >= lineCoordinate 
          : centroid.lng <= lineCoordinate;
        
        if (centroidOnFirstSide) {
          firstGroupTracts.push(tract);
        } else {
          secondGroupTracts.push(tract);
        }
      } else {
        // Non-intersecting tracts: assign based on which side they're on
        if (isEntirelyNorthOrWest) {
          firstGroupTracts.push(tract);
        } else {
          secondGroupTracts.push(tract);
        }
      }
    }

    console.log(`📊 Divided ${tracts.length} tracts by entire geometry: ${firstGroupTracts.length} + ${secondGroupTracts.length} by ${direction} line at ${lineCoordinate.toFixed(6)}`);
    console.log(`🔍 Found ${intersectingTracts.length} tracts that intersect the line`);

    // Use algorithm service methods for contiguity checking (lazy load to avoid circular dependency)
    const algorithmService = this.getAlgorithmService();
    const adjacencyGraph = algorithmService.buildGeometryAdjacencyGraph(tracts);

    // Build enclosed tract relationship map at the start to track which tracts are enclosed by which
    // This ensures that when we move a tract, we also move its enclosed tracts
    const enclosedMap = algorithmService.findContainedTracts(tracts, true);
    const containerToEnclosed = new Map<string, string[]>(); // Maps container ID to array of enclosed tract IDs
    const enclosedToContainer = new Map<string, string>(); // Maps enclosed tract ID to its container ID
    
    for (const relationship of enclosedMap) {
      const containerId = relationship.container;
      const enclosedId = relationship.contained;
      
      if (!containerToEnclosed.has(containerId)) {
        containerToEnclosed.set(containerId, []);
      }
      containerToEnclosed.get(containerId)!.push(enclosedId);
      enclosedToContainer.set(enclosedId, containerId);
    }

    if (enclosedMap.length > 0) {
      console.log(`📦 Found ${enclosedMap.length} enclosed tract relationship(s):`);
      for (const relationship of enclosedMap) {
        console.log(`   ${relationship.contained} is enclosed by ${relationship.container}`);
      }
    }
    
    // Second pass: check intersecting tracts using contiguity approach
    // For each intersecting tract, find adjacent tracts in the opposite group,
    // and if any adjacent tract is isolated, move the intersecting tract to join them
    // Use the new isolation check: a tract is isolated if its reachable count is less than the max reachable count
    
    for (const intersectingTract of intersectingTracts) {
      const tractId = algorithmService.getTractId(intersectingTract);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      
      // Debug logging for specific tract
      if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
        console.log(`🔍 DEBUG: Checking intersecting tract ${tractId}, inFirst: ${inFirst}, inSecond: ${inSecond}, neighbors: ${neighbors.length}`);
      }
      
      if (inSecond) {
        // We're in second group - find adjacent tracts in first group (opposite group)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Debug logging for specific tract
        if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`🔍 DEBUG: ${tractId} in second group, neighborsInFirst: ${neighborsInFirst.join(', ')}`);
        }
        
        // Check if any adjacent tract in first group is isolated using the new method
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => {
          const isIsolated = algorithmService.isTractIsolated(neighborId, firstGroupTracts, adjacencyGraph);
          if ((tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') && isIsolated) {
            const reachableCount = algorithmService.calculateReachableTracts(neighborId, firstGroupTracts, adjacencyGraph);
            const maxReachableCount = algorithmService.calculateMaxReachableCount(firstGroupTracts, adjacencyGraph);
            console.log(`🔍 DEBUG: ${tractId} - Found isolated neighbor ${neighborId} in first group (reachable: ${reachableCount}/${maxReachableCount})`);
          }
          return isIsolated;
        });
        
        if (isolatedNeighbors.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighbors[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, firstGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (second group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = firstGroupTracts[tractIndex];
              firstGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = secondGroupTracts[intersectingTractIndex];
            secondGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          secondGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from first group to second group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from second group back to first group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(secondGroupTracts, firstGroupTracts, tracts, direction, totalPopulationMoved, 'second', 'first');
          }
        } else if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`⚠️ DEBUG: ${tractId} - No isolated neighbors found in first group. neighborsInFirst: ${neighborsInFirst.length}`);
        }
      } else if (inFirst) {
        // We're in first group - check neighbors in second group (opposite group)
        const neighborsInSecond = neighbors.filter(neighborId => 
          secondGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Debug logging for specific tract
        if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`🔍 DEBUG: ${tractId} in first group, neighborsInSecond: ${neighborsInSecond.join(', ')}`);
        }
        
        // Check if any adjacent tract in second group is isolated using the new method
        const isolatedNeighborsInSecond = neighborsInSecond.filter(neighborId => {
          const isIsolated = algorithmService.isTractIsolated(neighborId, secondGroupTracts, adjacencyGraph);
          if ((tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') && isIsolated) {
            const reachableCount = algorithmService.calculateReachableTracts(neighborId, secondGroupTracts, adjacencyGraph);
            const maxReachableCount = algorithmService.calculateMaxReachableCount(secondGroupTracts, adjacencyGraph);
            console.log(`🔍 DEBUG: ${tractId} - Found isolated neighbor ${neighborId} in second group (reachable: ${reachableCount}/${maxReachableCount})`);
          }
          return isIsolated;
        });
        
        if (isolatedNeighborsInSecond.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighborsInSecond[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, secondGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (first group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = secondGroupTracts[tractIndex];
              secondGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = firstGroupTracts[intersectingTractIndex];
            firstGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          firstGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from second group to first group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from first group back to second group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(firstGroupTracts, secondGroupTracts, tracts, direction, totalPopulationMoved, 'first', 'second');
          }
        } else if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`⚠️ DEBUG: ${tractId} - No isolated neighbors found in second group. neighborsInSecond: ${neighborsInSecond.length}`);
        }
      }
    }

    // Fix isolated tracts after division (for any remaining issues)
    // Pass direction for population balancing
    const fixedResult = algorithmService.fixIsolatedTractsAfterDivision(firstGroupTracts, secondGroupTracts, tracts, direction);
    firstGroupTracts.length = 0;
    firstGroupTracts.push(...fixedResult.firstGroupTracts);
    secondGroupTracts.length = 0;
    secondGroupTracts.push(...fixedResult.secondGroupTracts);

    // Second pass (after fixIsolatedTractsAfterDivision): Check intersecting tracts again for isolated neighbors
    // Use the new isolation check: a tract is isolated if its reachable count is less than the max reachable count
    console.log(`🔍 Second pass check: Checking ${firstGroupTracts.length} first group tracts and ${secondGroupTracts.length} second group tracts`);
    
    // Check intersecting tracts again for isolated neighbors
    for (const intersectingTract of intersectingTracts) {
      const tractId = algorithmService.getTractId(intersectingTract);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      
      // Debug logging for specific tract
      if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
        console.log(`🔍 DEBUG (after fix): Checking intersecting tract ${tractId}, inFirst: ${inFirst}, inSecond: ${inSecond}, neighbors: ${neighbors.length}`);
      }
      
      if (inSecond) {
        // We're in second group - find adjacent tracts in first group (opposite group)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in first group is isolated using the new method
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => 
          algorithmService.isTractIsolated(neighborId, firstGroupTracts, adjacencyGraph)
        );
        
        if (isolatedNeighbors.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighbors[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, firstGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (second group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = firstGroupTracts[tractIndex];
              firstGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = secondGroupTracts[intersectingTractIndex];
            secondGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          secondGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 (After fix) Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from first group to second group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from second group back to first group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(secondGroupTracts, firstGroupTracts, tracts, direction, totalPopulationMoved, 'second', 'first');
          }
        }
      } else if (inFirst) {
        // We're in first group - check neighbors in second group (opposite group)
        const neighborsInSecond = neighbors.filter(neighborId => 
          secondGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in second group is isolated using the new method
        const isolatedNeighborsInSecond = neighborsInSecond.filter(neighborId => 
          algorithmService.isTractIsolated(neighborId, secondGroupTracts, adjacencyGraph)
        );
        
        if (isolatedNeighborsInSecond.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighborsInSecond[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, secondGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (first group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = secondGroupTracts[tractIndex];
              secondGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = firstGroupTracts[intersectingTractIndex];
            firstGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          firstGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 (After fix) Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from second group to first group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from first group back to second group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(firstGroupTracts, secondGroupTracts, tracts, direction, totalPopulationMoved, 'first', 'second');
          }
        }
      }
    }

    // Third pass: refine division to minimize variance by moving intersecting tracts
    // Track initial state before refinement
    const initialFirstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const initialSecondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const initialFirstGroupCount = firstGroupTracts.length;
    const initialSecondGroupCount = secondGroupTracts.length;
    const initialFirstVariance = ((initialFirstGroupPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation) * 100;
    const initialSecondVariance = ((initialSecondGroupPopulation - targetSecondGroupPopulation) / targetSecondGroupPopulation) * 100;
    
    // Get remaining intersecting tracts that can be moved
    const remainingIntersectingTracts = intersectingTracts.filter(tract => {
      const tractId = algorithmService.getTractId(tract);
      return firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId) ||
             secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
    });

    console.log(`📊 Variance refinement: Starting with ${remainingIntersectingTracts.length} intersecting tract(s) available to move`);
    console.log(`   Initial variance: First group: ${initialFirstVariance.toFixed(2)}%, Second group: ${initialSecondVariance.toFixed(2)}%`);
    console.log(`   Target: First group: ${targetFirstGroupPopulation.toLocaleString()}, Second group: ${targetSecondGroupPopulation.toLocaleString()}`);

    // Sort intersecting tracts by population (smallest first for finer control)
    remainingIntersectingTracts.sort((a, b) => {
      const popA = a.properties?.POPULATION || 0;
      const popB = b.properties?.POPULATION || 0;
      return popA - popB;
    });

    // Calculate current population and variance
    let firstGroupPopulation = initialFirstGroupPopulation;
    let secondGroupPopulation = initialSecondGroupPopulation;
    let firstGroupVariance = firstGroupPopulation - targetFirstGroupPopulation;
    let secondGroupVariance = secondGroupPopulation - targetSecondGroupPopulation;
    
    // Track how many tracts were moved
    let tractsMovedCount = 0;
    let stopReason = '';

    // Move tracts from the group with positive variance to the group with negative variance
    for (const tract of remainingIntersectingTracts) {
      const tractId = algorithmService.getTractId(tract);
      const tractPopulation = tract.properties?.POPULATION || 0;
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);

      // Determine which group needs to give tracts (positive variance) and which needs to receive (negative variance)
      if (firstGroupVariance > 0 && secondGroupVariance < 0 && inFirst) {
        // First group is over target, second is under - move tract from first to second
        const index = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
        if (index !== -1) {
          // Move the tract
          firstGroupTracts.splice(index, 1);
          secondGroupTracts.push(tract);
          
          // Also move any enclosed tracts that belong to this tract
          const enclosedTractIds = containerToEnclosed.get(tractId) || [];
          let totalMovedPopulation = tractPopulation;
          
          for (const enclosedId of enclosedTractIds) {
            const enclosedTract = tracts.find(t => algorithmService.getTractId(t) === enclosedId);
            if (enclosedTract) {
              const enclosedInFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === enclosedId);
              if (enclosedInFirst) {
                const enclosedIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === enclosedId);
                if (enclosedIndex !== -1) {
                  firstGroupTracts.splice(enclosedIndex, 1);
                  secondGroupTracts.push(enclosedTract);
                  const enclosedPop = enclosedTract.properties?.POPULATION || 0;
                  totalMovedPopulation += enclosedPop;
                  console.log(`📦 Moved enclosed tract ${enclosedId} (pop: ${enclosedPop.toLocaleString()}) with container ${tractId}`);
                }
              }
            }
          }
          
          firstGroupPopulation -= totalMovedPopulation;
          secondGroupPopulation += totalMovedPopulation;
          firstGroupVariance = firstGroupPopulation - targetFirstGroupPopulation;
          secondGroupVariance = secondGroupPopulation - targetSecondGroupPopulation;
          tractsMovedCount += 1 + enclosedTractIds.length; // Count the tract plus any enclosed tracts
          console.log(`📊 Moved intersecting tract ${tractId} (pop: ${tractPopulation.toLocaleString()})${enclosedTractIds.length > 0 ? ` and ${enclosedTractIds.length} enclosed tract(s)` : ''} from first to second group to reduce variance`);
        }
        // Stop if first group now has negative variance (overcorrected)
        if (firstGroupVariance < 0) {
          const currentFirstVariance = ((firstGroupVariance / targetFirstGroupPopulation) * 100);
          stopReason = `First group variance reduced to negative (${currentFirstVariance.toFixed(2)}%), stopping to avoid overcorrection`;
          console.log(`✅ ${stopReason}`);
          break;
        }
      } else if (secondGroupVariance > 0 && firstGroupVariance < 0 && inSecond) {
        // Second group is over target, first is under - move tract from second to first
        const index = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
        if (index !== -1) {
          // Move the tract
          secondGroupTracts.splice(index, 1);
          firstGroupTracts.push(tract);
          
          // Also move any enclosed tracts that belong to this tract
          const enclosedTractIds = containerToEnclosed.get(tractId) || [];
          let totalMovedPopulation = tractPopulation;
          
          for (const enclosedId of enclosedTractIds) {
            const enclosedTract = tracts.find(t => algorithmService.getTractId(t) === enclosedId);
            if (enclosedTract) {
              const enclosedInSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === enclosedId);
              if (enclosedInSecond) {
                const enclosedIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === enclosedId);
                if (enclosedIndex !== -1) {
                  secondGroupTracts.splice(enclosedIndex, 1);
                  firstGroupTracts.push(enclosedTract);
                  const enclosedPop = enclosedTract.properties?.POPULATION || 0;
                  totalMovedPopulation += enclosedPop;
                  console.log(`📦 Moved enclosed tract ${enclosedId} (pop: ${enclosedPop.toLocaleString()}) with container ${tractId}`);
                }
              }
            }
          }
          
          secondGroupPopulation -= totalMovedPopulation;
          firstGroupPopulation += totalMovedPopulation;
          firstGroupVariance = firstGroupPopulation - targetFirstGroupPopulation;
          secondGroupVariance = secondGroupPopulation - targetSecondGroupPopulation;
          tractsMovedCount += 1 + enclosedTractIds.length; // Count the tract plus any enclosed tracts
          console.log(`📊 Moved intersecting tract ${tractId} (pop: ${tractPopulation.toLocaleString()})${enclosedTractIds.length > 0 ? ` and ${enclosedTractIds.length} enclosed tract(s)` : ''} from second to first group to reduce variance`);
        }
        // Stop if second group now has negative variance (overcorrected)
        if (secondGroupVariance < 0) {
          const currentSecondVariance = ((secondGroupVariance / targetSecondGroupPopulation) * 100);
          stopReason = `Second group variance reduced to negative (${currentSecondVariance.toFixed(2)}%), stopping to avoid overcorrection`;
          console.log(`✅ ${stopReason}`);
          break;
        }
      }
    }

    const finalFirstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const finalSecondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const finalFirstVariance = ((finalFirstGroupPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation) * 100;
    const finalSecondVariance = ((finalSecondGroupPopulation - targetSecondGroupPopulation) / targetSecondGroupPopulation) * 100;
    
    // Determine why refinement stopped
    if (!stopReason) {
      if (tractsMovedCount === 0) {
        stopReason = 'No intersecting tracts available to move';
      } else if (tractsMovedCount >= remainingIntersectingTracts.length) {
        stopReason = `All ${remainingIntersectingTracts.length} available intersecting tracts were moved`;
      } else {
        stopReason = `Variance balanced (${finalFirstVariance.toFixed(2)}% / ${finalSecondVariance.toFixed(2)}%)`;
      }
    }
    
    console.log(`📊 Variance refinement complete:`);
    console.log(`   Moved ${tractsMovedCount} tract(s) out of ${remainingIntersectingTracts.length} available intersecting tracts`);
    console.log(`   Final variance: First group: ${finalFirstVariance.toFixed(2)}%, Second group: ${finalSecondVariance.toFixed(2)}%`);
    console.log(`   Variance reduction: ${(Math.abs(initialFirstVariance) + Math.abs(initialSecondVariance) - (Math.abs(finalFirstVariance) + Math.abs(finalSecondVariance))).toFixed(2)}%`);
    console.log(`   Stop reason: ${stopReason}`);
    
    // Log how many tracts were actually moved during refinement
    if (tractsMovedCount > 0) {
      const moveDirection = direction === 'latitude' ? 'north to south' : 'east to west';
      history.push(`  - Balanced variance: moved ${tractsMovedCount} tract(s) ${moveDirection} (final variance: ${finalFirstVariance.toFixed(2)}% / ${finalSecondVariance.toFixed(2)}%)`);
      if (tractsMovedCount < remainingIntersectingTracts.length) {
        history.push(`    (${remainingIntersectingTracts.length - tractsMovedCount} intersecting tract(s) remaining, stopped: ${stopReason})`);
      }
    } else {
      history.push(`  - No variance balancing needed (variance already acceptable or no intersecting tracts available)`);
    }
    
    // Fourth pass (after variance reduction): Check intersecting tracts again for isolated neighbors
    // This is important because variance reduction may have moved tracts without checking isolation
    console.log(`🔍 Fourth pass check (after variance reduction): Checking ${firstGroupTracts.length} first group tracts and ${secondGroupTracts.length} second group tracts`);
    
    for (const intersectingTract of intersectingTracts) {
      const tractId = algorithmService.getTractId(intersectingTract);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      
      // Debug logging for specific tract
      if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
        console.log(`🔍 DEBUG (after variance): Checking intersecting tract ${tractId}, inFirst: ${inFirst}, inSecond: ${inSecond}, neighbors: ${neighbors.length}`);
      }
      
      if (inSecond) {
        // We're in second group - find adjacent tracts in first group (opposite group)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in first group is isolated using the new method
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => 
          algorithmService.isTractIsolated(neighborId, firstGroupTracts, adjacencyGraph)
        );
        
        if (isolatedNeighbors.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighbors[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, firstGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (second group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = firstGroupTracts[tractIndex];
              firstGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = secondGroupTracts[intersectingTractIndex];
            secondGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          secondGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 (After variance) Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from first group to second group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from second group back to first group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(secondGroupTracts, firstGroupTracts, tracts, direction, totalPopulationMoved, 'second', 'first');
          }
        }
      } else if (inFirst) {
        // We're in first group - check neighbors in second group (opposite group)
        const neighborsInSecond = neighbors.filter(neighborId => 
          secondGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Debug logging for specific tract
        if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`🔍 DEBUG (after variance): ${tractId} in first group, neighborsInSecond: ${neighborsInSecond.join(', ')}`);
        }
        
        // Check if any adjacent tract in second group is isolated using the new method
        const isolatedNeighborsInSecond = neighborsInSecond.filter(neighborId => {
          const isIsolated = algorithmService.isTractIsolated(neighborId, secondGroupTracts, adjacencyGraph);
          if ((tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') && isIsolated) {
            const reachableCount = algorithmService.calculateReachableTracts(neighborId, secondGroupTracts, adjacencyGraph);
            const maxReachableCount = algorithmService.calculateMaxReachableCount(secondGroupTracts, adjacencyGraph);
            console.log(`🔍 DEBUG (after variance): ${tractId} - Found isolated neighbor ${neighborId} in second group (reachable: ${reachableCount}/${maxReachableCount})`);
          }
          return isIsolated;
        });
        
        if (isolatedNeighborsInSecond.length > 0) {
          // Find all tracts in the isolated component (start from first isolated neighbor)
          const firstIsolatedNeighbor = isolatedNeighborsInSecond[0];
          const isolatedComponentTractIds = algorithmService.getIsolatedComponentTractIds(firstIsolatedNeighbor, secondGroupTracts, adjacencyGraph);
          
          // Move all tracts in the isolated component to the opposite group (first group)
          const tractsToMove: GeoJsonFeature[] = [];
          for (const isolatedTractId of isolatedComponentTractIds) {
            const tractIndex = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === isolatedTractId);
            if (tractIndex !== -1) {
              const tract = secondGroupTracts[tractIndex];
              secondGroupTracts.splice(tractIndex, 1);
              tractsToMove.push(tract);
            }
          }
          
          // Also move the intersecting tract to the opposite group
          const intersectingTractIndex = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (intersectingTractIndex !== -1) {
            const intersectingTract = firstGroupTracts[intersectingTractIndex];
            firstGroupTracts.splice(intersectingTractIndex, 1);
            tractsToMove.push(intersectingTract);
          }
          
          // Add all moved tracts to the opposite group
          firstGroupTracts.push(...tractsToMove);
          
          // Calculate total population moved
          const totalPopulationMoved = tractsToMove.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          
          console.log(`🔄 (After variance) Moved entire isolated component (${isolatedComponentTractIds.size} tracts) and intersecting tract ${tractId} from second group to first group (${totalPopulationMoved.toLocaleString()} people)`);
          console.log(`   Isolated component tracts: ${Array.from(isolatedComponentTractIds).slice(0, 10).join(', ')}${isolatedComponentTractIds.size > 10 ? '...' : ''}`);
          
          // BALANCE: Move boundary tracts from first group back to second group
          if (direction && algorithmService) {
            algorithmService.balanceTractMove(firstGroupTracts, secondGroupTracts, tracts, direction, totalPopulationMoved, 'first', 'second');
          }
        } else if (tractId.includes('002106') || tractId.includes('02106') || tractId.includes('050617') || tractId === '04013050617') {
          console.log(`⚠️ DEBUG (after variance): ${tractId} - No isolated neighbors found in second group. neighborsInSecond: ${neighborsInSecond.length}`);
        }
      }
    }
    
    // Get intersecting tract IDs (reuse algorithmService from earlier in the function)
    const intersectingTractIds = intersectingTracts.map(tract => algorithmService.getTractId(tract));
    
    // VALIDATE: Ensure all tracts are assigned to exactly one group
    const allTractIds = new Set(tracts.map(t => algorithmService.getTractId(t)));
    const firstGroupTractIds = new Set(firstGroupTracts.map(t => algorithmService.getTractId(t)));
    const secondGroupTractIds = new Set(secondGroupTracts.map(t => algorithmService.getTractId(t)));
    
    // Check for tracts in both groups (duplicates)
    for (const tractId of firstGroupTractIds) {
      if (secondGroupTractIds.has(tractId)) {
        console.error(`⚠️ ERROR: Tract ${tractId} is in both groups! Removing from second group.`);
        const index = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
        if (index !== -1) {
          secondGroupTracts.splice(index, 1);
        }
      }
    }
    
    // Check for missing tracts
    const missingTracts: string[] = [];
    for (const tractId of allTractIds) {
      if (!firstGroupTractIds.has(tractId) && !secondGroupTractIds.has(tractId)) {
        missingTracts.push(tractId);
      }
    }
    
    if (missingTracts.length > 0) {
      console.error(`⚠️ ERROR: ${missingTracts.length} tract(s) not assigned to any group after division:`);
      console.error(`   Missing tracts: ${missingTracts.slice(0, 10).join(', ')}${missingTracts.length > 10 ? '...' : ''}`);
      
      // Assign missing tracts based on their position relative to the division line
      for (const missingTractId of missingTracts) {
        const missingTract = tracts.find(t => algorithmService.getTractId(t) === missingTractId);
        if (missingTract) {
          const isEntirelyNorthOrWest = this.isTractEntirelyNorthOrWest(missingTract, direction, lineCoordinate);
          const centroid = this.calculateTractCentroid(missingTract);
          const centroidOnFirstSide = direction === 'latitude' 
            ? centroid.lat >= lineCoordinate 
            : centroid.lng <= lineCoordinate;
          
          // Assign to group based on position
          if (isEntirelyNorthOrWest || centroidOnFirstSide) {
            firstGroupTracts.push(missingTract);
            console.log(`🔧 Fixed: Assigned missing tract ${missingTractId} to first group (north/west of line)`);
          } else {
            secondGroupTracts.push(missingTract);
            console.log(`🔧 Fixed: Assigned missing tract ${missingTractId} to second group (south/east of line)`);
          }
        }
      }
    }
    
    return { 
      firstGroupTracts, 
      secondGroupTracts,
      intersectingTractIds
    };
  }

  /**
   * Validate that tracts in a group are contiguous (simplified - always returns true)
   */
  private validateContiguity(tracts: GeoJsonFeature[], groupName: string): boolean {
    console.log(`✅ ${groupName}: Contiguity check skipped (${tracts.length} tracts)`);
    return true;
  }

  /**
   * Calculate bounds for a group of tracts
   */
  private calculateBounds(tracts: GeoJsonFeature[]): { north: number; south: number; east: number; west: number } {
    if (tracts.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = -90, south = 90, east = -180, west = 180;

    for (const tract of tracts) {
      const centroid = this.calculateTractCentroid(tract);
      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    }

    return { north, south, east, west };
  }

  /**
   * Calculate centroid for a group of tracts
   */
  private calculateCentroid(tracts: GeoJsonFeature[]): { lat: number; lng: number } {
    if (tracts.length === 0) {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0;
    let totalLng = 0;
    let totalPopulation = 0;

    for (const tract of tracts) {
      const centroid = this.calculateTractCentroid(tract);
      const population = tract.properties?.POPULATION || 0;
      totalLat += centroid.lat * population;
      totalLng += centroid.lng * population;
      totalPopulation += population;
    }

    if (totalPopulation === 0) {
      // Fallback to geometric centroid
      const centroid = this.calculateTractCentroid(tracts[0]);
      return { lat: centroid.lat, lng: centroid.lng };
    }

    return {
      lat: totalLat / totalPopulation,
      lng: totalLng / totalPopulation
    };
  }

  /**
   * Calculate centroid for a single tract
   */
  private calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry) return { lat: 0, lng: 0 };
    
    let totalLat = 0, totalLng = 0, pointCount = 0;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          totalLng += coord[0];
          totalLat += coord[1];
          pointCount++;
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            totalLng += coord[0];
            totalLat += coord[1];
            pointCount++;
          }
        }
      }
    }

    return pointCount > 0 ? { lat: totalLat / pointCount, lng: totalLng / pointCount } : { lat: 0, lng: 0 };
  }

  /**
   * Get tract bounds
   */
  private getTractBounds(tract: GeoJsonFeature): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    const coords = this.getAllCoordinates(tract);
    if (coords.length === 0) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    
    for (const coord of coords) {
      const [lng, lat] = coord;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Get all coordinates from a feature
   */
  private getAllCoordinates(feature: GeoJsonFeature): number[][] {
    if (!feature.geometry) return [];

    const coords: number[][] = [];
    const processRing = (ring: number[][]) => {
      for (const coord of ring) {
        if (coord.length >= 2) {
          coords.push(coord);
        }
      }
    };

    if (feature.geometry.type === 'Polygon') {
      for (const ring of feature.geometry.coordinates) {
        processRing(ring);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const polygon of feature.geometry.coordinates) {
        for (const ring of polygon) {
          processRing(ring);
        }
      }
    }

    return coords;
  }

  /**
   * Check if tract is entirely north or west of line
   */
  private isTractEntirelyNorthOrWest(tract: GeoJsonFeature, direction: 'latitude' | 'longitude', lineCoordinate: number): boolean {
    if (direction === 'latitude') {
      return this.isTractEntirelyNorthOfLine(tract, lineCoordinate);
    } else {
      return this.isTractEntirelyWestOfLine(tract, lineCoordinate);
    }
  }

  /**
   * Check if tract is entirely north of latitude line
   */
  private isTractEntirelyNorthOfLine(tract: GeoJsonFeature, latitudeLine: number): boolean {
    if (!tract.geometry) return false;

    const bounds = this.getTractBounds(tract);
    // A tract is entirely north if its minimum latitude is at or above the line
    // (higher latitude = more north)
    return bounds.minLat >= latitudeLine;
  }

  /**
   * Check if tract is entirely west of longitude line
   */
  private isTractEntirelyWestOfLine(tract: GeoJsonFeature, longitudeLine: number): boolean {
    if (!tract.geometry) return false;

    const bounds = this.getTractBounds(tract);
    return bounds.maxLng < longitudeLine;
  }

  /**
   * Check if tract intersects the dividing line
   */
  private doesTractIntersectLine(tract: GeoJsonFeature, direction: 'latitude' | 'longitude', lineCoordinate: number): boolean {
    if (!tract.geometry) return false;

    const bounds = this.getTractBounds(tract);

    if (direction === 'latitude') {
      // Check if tract crosses the latitude line
      return bounds.minLat <= lineCoordinate && bounds.maxLat >= lineCoordinate;
    } else {
      // Check if tract crosses the longitude line
      return bounds.minLng <= lineCoordinate && bounds.maxLng >= lineCoordinate;
    }
  }
}

