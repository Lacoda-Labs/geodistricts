import { Injectable } from '@angular/core';
import { Observable, throwError, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CensusService, GeoJsonFeature, GeoJsonResponse } from './census.service';
import { CongressionalDistrictsService } from './congressional-districts.service';
import { environment } from '../../environments/environment';

// Interface for DistrictGroup as defined in the algorithm
export interface DistrictGroup {
  startDistrictNumber: number;
  endDistrictNumber: number;
  censusTracts: GeoJsonFeature[];
  totalDistricts: number;
  totalPopulation: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centroid: {
    lat: number;
    lng: number;
  };
}

// Interface for algorithm step visualization
export interface GeodistrictStep {
  step: number;
  level: number;
  districtGroups: DistrictGroup[];
  description: string;
  totalGroups: number;
  totalDistricts: number;
  divisionDirection: 'latitude' | 'longitude';
}

// Interface for algorithm result
export interface GeodistrictResult {
  finalDistricts: DistrictGroup[];
  steps: GeodistrictStep[];
  totalPopulation: number;
  averagePopulation: number;
  populationVariance: number;
  algorithmHistory: string[];
}

// Interface for algorithm options
export interface GeodistrictOptions {
  state: string;
  useDirectAPI?: boolean;
  forceInvalidate?: boolean;
  maxIterations?: number;
}

@Injectable({
  providedIn: 'root'
})
export class GeodistrictAlgorithmService {

  constructor(
    private censusService: CensusService,
    private congressionalDistrictsService: CongressionalDistrictsService
  ) {}

  /**
   * Run the geodistrict algorithm for a given state
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  runGeodistrictAlgorithm(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, useDirectAPI = false, forceInvalidate = false, maxIterations = 100 } = options;
    
    // In production, always use backend proxy (which handles Secret Manager)
    // In development, respect the useDirectAPI flag
    const shouldUseDirectAPI = useDirectAPI && !environment.production;

    console.log(`Starting geodistrict algorithm for state: ${state}`);

    // Convert state abbreviation to FIPS code if needed
    const stateFips = this.getStateFipsCode(state);
    console.log(`Using FIPS code: ${stateFips} for state: ${state}`);

    // Get total districts for the state
    return this.congressionalDistrictsService.getTotalDistrictsForState(state).pipe(
      switchMap(totalDistricts => {
        console.log(`Total districts for ${state}: ${totalDistricts}`);

        // Get census data and boundaries with fallback
        console.log(`Using ${shouldUseDirectAPI ? 'direct API' : 'backend proxy'} for state: ${state}`);
        const dataSource$ = shouldUseDirectAPI 
          ? this.censusService.getTractDataWithBoundariesDirect(stateFips, undefined, forceInvalidate)
          : this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate);

        return dataSource$.pipe(
          map(data => {
            if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
              throw new Error(`No tract boundaries found for state: ${state}`);
            }

            // Combine demographic data with boundary data
            const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);
            
            console.log(`Found ${tractsWithPopulation.length} census tracts for ${state}`);

            // Run the algorithm
            return this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations);
          }),
          catchError(error => {
            console.warn(`Direct API failed for state ${state}, falling back to backend proxy:`, error);
            
            // Fallback to backend proxy
            return this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate).pipe(
              map(data => {
                if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
                  throw new Error(`No tract boundaries found for state: ${state} (both direct API and backend proxy failed)`);
                }

                // Combine demographic data with boundary data
                const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);
                
                console.log(`Found ${tractsWithPopulation.length} census tracts for ${state} via backend proxy`);

                // Run the algorithm
                return this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations);
              })
            );
          })
        );
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Combine demographic data with boundary features
   * @param demographicData Census demographic data
   * @param boundaryFeatures GeoJSON boundary features
   * @returns Combined tract features with population data
   */
  private combineTractData(demographicData: any[], boundaryFeatures: GeoJsonFeature[]): GeoJsonFeature[] {
    const demographicMap = new Map<string, any>();
    
    console.log(`Combining ${demographicData.length} demographic records with ${boundaryFeatures.length} boundary features`);
    
    // Create a map of demographic data by FIPS code
    demographicData.forEach(tract => {
      const fipsKey = `${tract.state}${tract.county}${tract.tract}`;
      demographicMap.set(fipsKey, tract);
    });

    console.log(`Created demographic map with ${demographicMap.size} entries`);
    console.log('Sample demographic keys:', Array.from(demographicMap.keys()).slice(0, 5));

    // Combine with boundary features
    const combinedFeatures = boundaryFeatures.map(feature => {
      const stateFips = feature.properties?.STATE_FIPS || feature.properties?.STATE;
      const countyFips = feature.properties?.COUNTY_FIPS || feature.properties?.COUNTY;
      const tractFips = feature.properties?.TRACT_FIPS || feature.properties?.TRACT;
      
      const fipsKey = `${stateFips}${countyFips}${tractFips}`;
      const demographicTract = demographicMap.get(fipsKey);

      if (demographicTract) {
        // Update feature properties with population data
        feature.properties = {
          ...feature.properties,
          POPULATION: demographicTract.population || 0,
          NAME: demographicTract.name || feature.properties?.NAME,
          STATE: demographicTract.state || stateFips,
          COUNTY: demographicTract.county || countyFips,
          TRACT: demographicTract.tract || tractFips
        };
      } else {
        // Set default population if no demographic data found
        feature.properties = {
          ...feature.properties,
          POPULATION: feature.properties?.POPULATION || 0
        };
      }

      return feature;
    });

    const matchedCount = combinedFeatures.filter(f => (f.properties?.POPULATION || 0) > 0).length;
    console.log(`Matched ${matchedCount} out of ${combinedFeatures.length} features with demographic data`);
    
    if (matchedCount === 0) {
      console.log('Sample boundary feature properties:', boundaryFeatures[0]?.properties);
      console.log('Sample demographic tract:', demographicData[0]);
    }

    return combinedFeatures;
  }

  /**
   * Execute the geodistrict algorithm
   * @param tracts Array of census tract features with population data
   * @param totalDistricts Total number of districts to create
   * @param maxIterations Maximum number of iterations
   * @returns Algorithm result
   */
  private executeGeodistrictAlgorithm(tracts: GeoJsonFeature[], totalDistricts: number, maxIterations: number): GeodistrictResult {
    console.log(`Executing geodistrict algorithm: ${tracts.length} tracts → ${totalDistricts} districts`);

    // Calculate total state population
    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    console.log(`Total state population: ${totalStatePopulation.toLocaleString()}`);
    console.log(`Target population per district: ${targetDistrictPopulation.toLocaleString()}`);

    // Initialize with all tracts as a single district group
    const initialGroup: DistrictGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: tracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: this.calculateBounds(tracts),
      centroid: this.calculateCentroid(tracts)
    };

    const steps: GeodistrictStep[] = [];
    const algorithmHistory: string[] = [];
    let currentGroups: DistrictGroup[] = [initialGroup];
    let iteration = 0;

    // Create initial step
    steps.push(this.createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude'));

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const newGroups: DistrictGroup[] = [];
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

      console.log(`Iteration ${iteration}: Dividing ${currentGroups.length} groups by ${direction}`);

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Divide this group
          const divisionResult = this.divideDistrictGroup(group, direction);
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
        }
      }

      currentGroups = newGroups;
      steps.push(this.createStep(iteration, iteration, currentGroups, 
        `Iteration ${iteration}: Divided groups by ${direction}`, direction));

      console.log(`After iteration ${iteration}: ${currentGroups.length} groups, ${currentGroups.reduce((sum, g) => sum + g.totalDistricts, 0)} total districts`);
    }

    if (iteration >= maxIterations) {
      algorithmHistory.push(`Algorithm stopped: Maximum iterations (${maxIterations}) reached`);
    } else {
      algorithmHistory.push(`Algorithm completed: ${currentGroups.length} districts created in ${iteration} iterations`);
    }

    // Calculate final statistics
    const finalDistricts = currentGroups;
    const averagePopulation = totalStatePopulation / finalDistricts.length;
    const populationVariance = finalDistricts.reduce((sum, district) => 
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / finalDistricts.length;

    return {
      finalDistricts,
      steps,
      totalPopulation: totalStatePopulation,
      averagePopulation,
      populationVariance,
      algorithmHistory
    };
  }

  /**
   * Divide a district group into two groups
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @returns Division result with new groups and history
   */
  private divideDistrictGroup(group: DistrictGroup, direction: 'latitude' | 'longitude'): {
    groups: DistrictGroup[];
    history: string[];
  } {
    const { totalDistricts } = group;
    
    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);
    
    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    
    // Sort tracts for contiguity
    const sortedTracts = this.sortTractsForContiguity(group.censusTracts, direction);
    
    // Divide tracts by accumulating population
    let cumulativePopulation = 0;
    let divisionIndex = 0;
    let bestDifference = Infinity;
    
    for (let i = 0; i < sortedTracts.length; i++) {
      cumulativePopulation += sortedTracts[i].properties?.POPULATION || 0;
      const difference = Math.abs(cumulativePopulation - targetFirstGroupPopulation);
      
      if (difference < bestDifference) {
        bestDifference = difference;
        divisionIndex = i + 1;
      }
    }
    
    // Split tracts into two groups
    const firstGroupTracts = sortedTracts.slice(0, divisionIndex);
    const secondGroupTracts = sortedTracts.slice(divisionIndex);
    
    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);
    
    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Division resulted in non-contiguous groups. Attempting to fix...`);
      
      // Try to fix contiguity by adjusting the division point
      const fixedGroups = this.fixContiguityInDivision(sortedTracts, divisionIndex, group, division);
      if (fixedGroups) {
        return fixedGroups;
      }
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
    
    const history = [
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} into ${division.first} + ${division.second} districts`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`
    ];
    
    return {
      groups: [firstGroup, secondGroup],
      history
    };
  }

  /**
   * Sort tracts geographically by direction
   * @param tracts Array of tract features
   * @param direction Sort direction
   * @returns Sorted array of tracts
   */
  private sortTractsGeographically(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    return tracts.sort((a, b) => {
      const centroidA = this.calculateTractCentroid(a);
      const centroidB = this.calculateTractCentroid(b);
      
      if (direction === 'latitude') {
        // Sort by latitude (north to south), then longitude (west to east)
        if (Math.abs(centroidA.lat - centroidB.lat) < 0.001) {
          return centroidA.lng - centroidB.lng;
        }
        return centroidB.lat - centroidA.lat;
      } else {
        // Sort by longitude (west to east), then latitude (north to south)
        if (Math.abs(centroidA.lng - centroidB.lng) < 0.001) {
          return centroidB.lat - centroidA.lat;
        }
        return centroidA.lng - centroidB.lng;
      }
    });
  }

  /**
   * Sort tracts using the Fresh Approach zig-zag pattern
   * @param tracts Array of tract features
   * @param direction Sort direction preference
   * @returns Sorted array of tracts following zig-zag pattern
   */
  private sortTractsForContiguity(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    if (tracts.length <= 1) return tracts;

    console.log(`🔄 Starting Fresh Approach sorting for ${tracts.length} tracts (${direction} direction)`);
    
    // Build adjacency map for all tracts
    const adjacencyMap = this.buildAdjacencyMap(tracts);
    
    // Find the top-northwest tract as starting point
    const topNorthwestTract = this.findTopNorthwestTract(tracts);
    if (!topNorthwestTract) {
      console.warn('Could not find top-northwest tract, falling back to geographic sort');
      return this.sortTractsGeographically(tracts, direction);
    }
    
    console.log(`📍 Starting from top-northwest tract: ${this.getTractId(topNorthwestTract)}`);
    
    // Start the zig-zag pattern
    const sortedTracts: GeoJsonFeature[] = [topNorthwestTract];
    const remainingTracts = new Set(tracts.filter(t => t !== topNorthwestTract));
    
    let currentTract = topNorthwestTract;
    let currentDirection: 'east' | 'west' = 'east'; // Start moving east
    
    while (remainingTracts.size > 0) {
      let nextTract: GeoJsonFeature | null = null;
      
      if (direction === 'latitude') {
        // For latitude division: prefer east-west movement, then southward progression
        nextTract = this.findNextTractInLatitudePattern(currentTract, currentDirection, remainingTracts, adjacencyMap);
      } else {
        // For longitude division: prefer north-south movement, then eastward progression  
        nextTract = this.findNextTractInLongitudePattern(currentTract, currentDirection, remainingTracts, adjacencyMap);
      }
      
      if (nextTract) {
        sortedTracts.push(nextTract);
        remainingTracts.delete(nextTract);
        currentTract = nextTract;
        
        // Toggle direction for zig-zag pattern
        currentDirection = currentDirection === 'east' ? 'west' : 'east';
      } else {
        // No adjacent tract found, handle isolated tracts
        console.log(`⚠️  No adjacent tract found, handling isolated tracts...`);
        const isolatedTracts = this.handleIsolatedTracts(sortedTracts, remainingTracts, direction, adjacencyMap);
        sortedTracts.push(...isolatedTracts);
        isolatedTracts.forEach(tract => remainingTracts.delete(tract));
        
        if (remainingTracts.size > 0) {
          // Continue from the last added tract
          currentTract = sortedTracts[sortedTracts.length - 1];
        }
      }
    }
    
    console.log(`✅ Fresh Approach sorting complete: ${sortedTracts.length} tracts sorted`);
    return sortedTracts;
  }

  /**
   * Validate that tracts in a group are contiguous
   * @param tracts Array of tract features
   * @param groupName Name of the group for logging
   * @returns True if all tracts are contiguous
   */
  private validateContiguity(tracts: GeoJsonFeature[], groupName: string): boolean {
    if (tracts.length <= 1) return true;

    const adjacencyMap = this.buildAdjacencyMap(tracts);
    const visited = new Set<string>();
    const queue: string[] = [];
    
    // Start BFS from first tract
    const firstTractId = this.getTractId(tracts[0]);
    queue.push(firstTractId);
    visited.add(firstTractId);
    
    while (queue.length > 0) {
      const currentTractId = queue.shift()!;
      const neighbors = adjacencyMap.get(currentTractId) || new Set();
      
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    
    const isContiguous = visited.size === tracts.length;
    
    if (!isContiguous) {
      console.warn(`⚠️  ${groupName}: Non-contiguous tracts detected!`);
      console.warn(`   Expected ${tracts.length} tracts, but only ${visited.size} are reachable`);
      
      // Log which tracts are isolated
      const allTractIds = new Set(tracts.map(t => this.getTractId(t)));
      const isolatedTracts = [...allTractIds].filter(id => !visited.has(id));
      if (isolatedTracts.length > 0) {
        console.warn(`   Isolated tracts: ${isolatedTracts.join(', ')}`);
      }
    } else {
      console.log(`✅ ${groupName}: All ${tracts.length} tracts are contiguous`);
    }
    
    return isContiguous;
  }

  /**
   * Build adjacency map for all tracts
   * @param tracts Array of tract features
   * @returns Map of tract ID to adjacent tract IDs
   */
  private buildAdjacencyMap(tracts: GeoJsonFeature[]): Map<string, Set<string>> {
    const adjacencyMap = new Map<string, Set<string>>();
    
    // Initialize adjacency map
    tracts.forEach(tract => {
      const tractId = this.getTractId(tract);
      adjacencyMap.set(tractId, new Set());
    });
    
    // Check adjacency between all pairs of tracts
    for (let i = 0; i < tracts.length; i++) {
      for (let j = i + 1; j < tracts.length; j++) {
        if (this.areTractsAdjacent(tracts[i], tracts[j])) {
          const tractId1 = this.getTractId(tracts[i]);
          const tractId2 = this.getTractId(tracts[j]);
          adjacencyMap.get(tractId1)!.add(tractId2);
          adjacencyMap.get(tractId2)!.add(tractId1);
        }
      }
    }
    
    return adjacencyMap;
  }

  /**
   * Check if two tracts are adjacent (share a boundary)
   * @param tract1 First tract
   * @param tract2 Second tract
   * @returns True if tracts are adjacent
   */
  private areTractsAdjacent(tract1: GeoJsonFeature, tract2: GeoJsonFeature): boolean {
    // This is a simplified adjacency check based on centroid distance
    // In a real implementation, you'd check for shared boundaries
    const centroid1 = this.calculateTractCentroid(tract1);
    const centroid2 = this.calculateTractCentroid(tract2);
    
    // Calculate distance between centroids
    const distance = this.calculateDistance(centroid1, centroid2);
    
    // Consider tracts adjacent if their centroids are within a reasonable distance
    // This threshold might need adjustment based on your data
    const adjacencyThreshold = 0.05; // degrees (roughly 3-5 miles)
    
    return distance < adjacencyThreshold;
  }

  /**
   * Calculate distance between two points in degrees
   * @param point1 First point
   * @param point2 Second point
   * @returns Distance in degrees
   */
  private calculateDistance(point1: { lat: number; lng: number }, point2: { lat: number; lng: number }): number {
    const latDiff = point1.lat - point2.lat;
    const lngDiff = point1.lng - point2.lng;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }

  /**
   * Get unique identifier for a tract
   * @param tract Tract feature
   * @returns Tract identifier
   */
  private getTractId(tract: GeoJsonFeature): string {
    return tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || JSON.stringify(tract.geometry);
  }

  /**
   * Calculate adjacency score between two tracts
   * @param tract1 First tract
   * @param tract2 Second tract
   * @param adjacencyMap Adjacency map
   * @returns Adjacency score (higher is better)
   */
  private calculateAdjacencyScore(tract1: GeoJsonFeature, tract2: GeoJsonFeature, adjacencyMap: Map<string, Set<string>>): number {
    const tractId1 = this.getTractId(tract1);
    const tractId2 = this.getTractId(tract2);
    
    // Direct adjacency gets highest score
    if (adjacencyMap.get(tractId1)?.has(tractId2)) {
      return 100;
    }
    
    // Check for indirect adjacency (shared neighbors)
    const neighbors1 = adjacencyMap.get(tractId1) || new Set();
    const neighbors2 = adjacencyMap.get(tractId2) || new Set();
    const sharedNeighbors = new Set([...neighbors1].filter(n => neighbors2.has(n)));
    
    if (sharedNeighbors.size > 0) {
      return 50 + sharedNeighbors.size * 10; // Bonus for shared neighbors
    }
    
    // Geographic proximity score
    const centroid1 = this.calculateTractCentroid(tract1);
    const centroid2 = this.calculateTractCentroid(tract2);
    const distance = this.calculateDistance(centroid1, centroid2);
    
    // Convert distance to score (closer = higher score)
    return Math.max(0, 50 - distance * 1000);
  }

  /**
   * Find geographically closest tract to a reference tract
   * @param referenceTract Reference tract
   * @param candidateTracts Array of candidate tracts
   * @returns Closest tract or null
   */
  private findGeographicallyClosestTract(referenceTract: GeoJsonFeature, candidateTracts: GeoJsonFeature[]): GeoJsonFeature | null {
    if (candidateTracts.length === 0) return null;
    
    const referenceCentroid = this.calculateTractCentroid(referenceTract);
    let closestTract: GeoJsonFeature | null = null;
    let minDistance = Infinity;
    
    for (const tract of candidateTracts) {
      const centroid = this.calculateTractCentroid(tract);
      const distance = this.calculateDistance(referenceCentroid, centroid);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestTract = tract;
      }
    }
    
    return closestTract;
  }

  /**
   * Find the top-northwest tract (highest latitude, westernmost longitude)
   * @param tracts Array of tract features
   * @returns Top-northwest tract or null
   */
  private findTopNorthwestTract(tracts: GeoJsonFeature[]): GeoJsonFeature | null {
    if (tracts.length === 0) return null;
    
    let topNorthwestTract = tracts[0];
    let topNorthwestCentroid = this.calculateTractCentroid(topNorthwestTract);
    
    for (const tract of tracts) {
      const centroid = this.calculateTractCentroid(tract);
      
      // Higher latitude (more north) takes priority
      if (centroid.lat > topNorthwestCentroid.lat) {
        topNorthwestTract = tract;
        topNorthwestCentroid = centroid;
      } else if (Math.abs(centroid.lat - topNorthwestCentroid.lat) < 0.001) {
        // If latitudes are similar, prefer westernmost (lower longitude)
        if (centroid.lng < topNorthwestCentroid.lng) {
          topNorthwestTract = tract;
          topNorthwestCentroid = centroid;
        }
      }
    }
    
    return topNorthwestTract;
  }

  /**
   * Find next tract in latitude division pattern (east-west movement, then southward)
   * @param currentTract Current tract
   * @param direction Current direction (east or west)
   * @param remainingTracts Set of remaining tracts
   * @param adjacencyMap Adjacency map
   * @returns Next tract or null
   */
  private findNextTractInLatitudePattern(
    currentTract: GeoJsonFeature, 
    direction: 'east' | 'west', 
    remainingTracts: Set<GeoJsonFeature>, 
    adjacencyMap: Map<string, Set<string>>
  ): GeoJsonFeature | null {
    const currentCentroid = this.calculateTractCentroid(currentTract);
    const currentTractId = this.getTractId(currentTract);
    
    // Get adjacent tracts
    const adjacentTractIds = adjacencyMap.get(currentTractId) || new Set();
    const adjacentTracts = Array.from(remainingTracts).filter(tract => 
      adjacentTractIds.has(this.getTractId(tract))
    );
    
    if (adjacentTracts.length === 0) return null;
    
    // For latitude division: prefer east-west movement
    let bestTract: GeoJsonFeature | null = null;
    let bestScore = -Infinity;
    
    for (const tract of adjacentTracts) {
      const centroid = this.calculateTractCentroid(tract);
      let score = 0;
      
      // Prefer tracts in the current direction (east or west)
      if (direction === 'east' && centroid.lng > currentCentroid.lng) {
        score += 100; // Strong preference for eastward movement
      } else if (direction === 'west' && centroid.lng < currentCentroid.lng) {
        score += 100; // Strong preference for westward movement
      }
      
      // Slight preference for southward movement (but less than east-west)
      if (centroid.lat < currentCentroid.lat) {
        score += 10;
      }
      
      // Prefer tracts that are closer
      const distance = this.calculateDistance(currentCentroid, centroid);
      score += Math.max(0, 50 - distance * 1000);
      
      if (score > bestScore) {
        bestScore = score;
        bestTract = tract;
      }
    }
    
    return bestTract;
  }

  /**
   * Find next tract in longitude division pattern (north-south movement, then eastward)
   * @param currentTract Current tract
   * @param direction Current direction (east or west)
   * @param remainingTracts Set of remaining tracts
   * @param adjacencyMap Adjacency map
   * @returns Next tract or null
   */
  private findNextTractInLongitudePattern(
    currentTract: GeoJsonFeature, 
    direction: 'east' | 'west', 
    remainingTracts: Set<GeoJsonFeature>, 
    adjacencyMap: Map<string, Set<string>>
  ): GeoJsonFeature | null {
    const currentCentroid = this.calculateTractCentroid(currentTract);
    const currentTractId = this.getTractId(currentTract);
    
    // Get adjacent tracts
    const adjacentTractIds = adjacencyMap.get(currentTractId) || new Set();
    const adjacentTracts = Array.from(remainingTracts).filter(tract => 
      adjacentTractIds.has(this.getTractId(tract))
    );
    
    if (adjacentTracts.length === 0) return null;
    
    // For longitude division: prefer north-south movement
    let bestTract: GeoJsonFeature | null = null;
    let bestScore = -Infinity;
    
    for (const tract of adjacentTracts) {
      const centroid = this.calculateTractCentroid(tract);
      let score = 0;
      
      // Prefer tracts in the current direction (east or west)
      if (direction === 'east' && centroid.lng > currentCentroid.lng) {
        score += 10; // Slight preference for eastward movement
      } else if (direction === 'west' && centroid.lng < currentCentroid.lng) {
        score += 10; // Slight preference for westward movement
      }
      
      // Strong preference for north-south movement
      if (centroid.lat > currentCentroid.lat) {
        score += 50; // Northward movement
      } else if (centroid.lat < currentCentroid.lat) {
        score += 50; // Southward movement
      }
      
      // Prefer tracts that are closer
      const distance = this.calculateDistance(currentCentroid, centroid);
      score += Math.max(0, 50 - distance * 1000);
      
      if (score > bestScore) {
        bestScore = score;
        bestTract = tract;
      }
    }
    
    return bestTract;
  }

  /**
   * Handle isolated tracts that couldn't be connected in the zig-zag pattern
   * @param sortedTracts Already sorted tracts
   * @param remainingTracts Remaining isolated tracts
   * @param direction Sort direction
   * @param adjacencyMap Adjacency map
   * @returns Array of isolated tracts to insert
   */
  private handleIsolatedTracts(
    sortedTracts: GeoJsonFeature[], 
    remainingTracts: Set<GeoJsonFeature>, 
    direction: 'latitude' | 'longitude', 
    adjacencyMap: Map<string, Set<string>>
  ): GeoJsonFeature[] {
    const isolatedTracts = Array.from(remainingTracts);
    const result: GeoJsonFeature[] = [];
    
    // Group isolated tracts by adjacency
    const isolatedGroups = this.groupIsolatedTracts(isolatedTracts, adjacencyMap);
    
    for (const group of isolatedGroups) {
      if (group.length === 1) {
        // Single isolated tract - find closest insertion point
        const isolatedTract = group[0];
        const insertionPoint = this.findClosestInsertionPoint(isolatedTract, sortedTracts, direction);
        
        if (insertionPoint >= 0) {
          result.push(isolatedTract);
        }
      } else {
        // Group of isolated tracts - sort them separately then insert as group
        const sortedGroup = this.sortTractsGeographically(group, direction);
        const insertionPoint = this.findClosestGroupInsertionPoint(sortedGroup, sortedTracts, direction);
        
        if (insertionPoint >= 0) {
          result.push(...sortedGroup);
        }
      }
    }
    
    return result;
  }

  /**
   * Group isolated tracts by their adjacency relationships
   * @param isolatedTracts Array of isolated tracts
   * @param adjacencyMap Adjacency map
   * @returns Array of groups of adjacent isolated tracts
   */
  private groupIsolatedTracts(isolatedTracts: GeoJsonFeature[], adjacencyMap: Map<string, Set<string>>): GeoJsonFeature[][] {
    const groups: GeoJsonFeature[][] = [];
    const visited = new Set<string>();
    
    for (const tract of isolatedTracts) {
      const tractId = this.getTractId(tract);
      if (visited.has(tractId)) continue;
      
      // Start a new group with this tract
      const group: GeoJsonFeature[] = [tract];
      visited.add(tractId);
      
      // Find all adjacent isolated tracts
      const queue = [tract];
      while (queue.length > 0) {
        const currentTract = queue.shift()!;
        const currentTractId = this.getTractId(currentTract);
        const neighbors = adjacencyMap.get(currentTractId) || new Set();
        
        for (const neighborId of neighbors) {
          const neighborTract = isolatedTracts.find(t => this.getTractId(t) === neighborId);
          if (neighborTract && !visited.has(neighborId)) {
            group.push(neighborTract);
            visited.add(neighborId);
            queue.push(neighborTract);
          }
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }

  /**
   * Find the closest insertion point for an isolated tract
   * @param isolatedTract Isolated tract to insert
   * @param sortedTracts Already sorted tracts
   * @param direction Sort direction
   * @returns Index to insert at, or -1 if not found
   */
  private findClosestInsertionPoint(
    isolatedTract: GeoJsonFeature, 
    sortedTracts: GeoJsonFeature[], 
    direction: 'latitude' | 'longitude'
  ): number {
    const isolatedCentroid = this.calculateTractCentroid(isolatedTract);
    let bestIndex = -1;
    let minDistance = Infinity;
    
    for (let i = 0; i < sortedTracts.length; i++) {
      const tractCentroid = this.calculateTractCentroid(sortedTracts[i]);
      const distance = this.calculateDistance(isolatedCentroid, tractCentroid);
      
      if (distance < minDistance) {
        minDistance = distance;
        bestIndex = i + 1; // Insert after this tract
      }
    }
    
    return bestIndex;
  }

  /**
   * Find the closest insertion point for a group of isolated tracts
   * @param isolatedGroup Group of isolated tracts
   * @param sortedTracts Already sorted tracts
   * @param direction Sort direction
   * @returns Index to insert at, or -1 if not found
   */
  private findClosestGroupInsertionPoint(
    isolatedGroup: GeoJsonFeature[], 
    sortedTracts: GeoJsonFeature[], 
    direction: 'latitude' | 'longitude'
  ): number {
    // Use the centroid of the group to find insertion point
    const groupCentroid = this.calculateCentroid(isolatedGroup);
    let bestIndex = -1;
    let minDistance = Infinity;
    
    for (let i = 0; i < sortedTracts.length; i++) {
      const tractCentroid = this.calculateTractCentroid(sortedTracts[i]);
      const distance = this.calculateDistance(groupCentroid, tractCentroid);
      
      if (distance < minDistance) {
        minDistance = distance;
        bestIndex = i + 1; // Insert after this tract
      }
    }
    
    return bestIndex;
  }

  /**
   * Attempt to fix contiguity issues in division by adjusting the division point
   * @param sortedTracts Sorted array of tracts
   * @param originalDivisionIndex Original division index
   * @param group Original group being divided
   * @param division Division configuration
   * @returns Fixed division result or null if unable to fix
   */
  private fixContiguityInDivision(sortedTracts: GeoJsonFeature[], originalDivisionIndex: number, group: DistrictGroup, division: any): any | null {
    console.log(`🔧 Attempting to fix contiguity by adjusting division point...`);
    
    // Try different division points around the original
    const searchRange = Math.min(5, Math.floor(sortedTracts.length / 4));
    
    for (let offset = 1; offset <= searchRange; offset++) {
      // Try both directions
      for (const direction of [-1, 1]) {
        const newDivisionIndex = originalDivisionIndex + (offset * direction);
        
        if (newDivisionIndex <= 0 || newDivisionIndex >= sortedTracts.length) continue;
        
        const firstGroupTracts = sortedTracts.slice(0, newDivisionIndex);
        const secondGroupTracts = sortedTracts.slice(newDivisionIndex);
        
        const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `Fixed First Group (offset: ${offset * direction})`);
        const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Fixed Second Group (offset: ${offset * direction})`);
        
        if (firstGroupContiguous && secondGroupContiguous) {
          console.log(`✅ Successfully fixed contiguity with offset ${offset * direction}`);
          
          // Create the fixed groups
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
          
          const history = [
            `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} into ${division.first} + ${division.second} districts (contiguity fixed)`,
            `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
            `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`
          ];
          
          return {
            groups: [firstGroup, secondGroup],
            history
          };
        }
      }
    }
    
    console.warn(`❌ Unable to fix contiguity issues. Proceeding with original division.`);
    return null;
  }

  /**
   * Calculate optimal division for a number of districts
   * @param totalDistricts Total number of districts
   * @returns Division configuration
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number]; first: number; second: number } {
    if (totalDistricts <= 1) {
      return { ratio: [100, 0], first: 1, second: 0 };
    }

    if (totalDistricts % 2 === 0) {
      // Even number: divide 50/50
      const half = totalDistricts / 2;
      return { ratio: [50, 50], first: half, second: half };
    } else {
      // Odd number: divide as evenly as possible
      const first = Math.floor(totalDistricts / 2);
      const second = Math.ceil(totalDistricts / 2);
      const ratio: [number, number] = [
        Math.round((first / totalDistricts) * 100),
        Math.round((second / totalDistricts) * 100)
      ];
      return { ratio, first, second };
    }
  }

  /**
   * Calculate bounds for a group of tracts
   * @param tracts Array of tract features
   * @returns Bounds object
   */
  private calculateBounds(tracts: GeoJsonFeature[]): { north: number; south: number; east: number; west: number } {
    if (tracts.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = -90, south = 90, east = -180, west = 180;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    });

    return { north, south, east, west };
  }

  /**
   * Calculate centroid for a group of tracts
   * @param tracts Array of tract features
   * @returns Centroid coordinates
   */
  private calculateCentroid(tracts: GeoJsonFeature[]): { lat: number; lng: number } {
    if (tracts.length === 0) {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0, totalLng = 0;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
    });

    return {
      lat: totalLat / tracts.length,
      lng: totalLng / tracts.length
    };
  }

  /**
   * Calculate centroid for a single tract
   * @param tract Tract feature
   * @returns Centroid coordinates
   */
  private calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    const coordinates = this.extractAllCoordinates(tract.geometry);

    if (coordinates.length === 0) {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0, totalLng = 0;

    coordinates.forEach(coord => {
      totalLng += coord[0]; // longitude
      totalLat += coord[1]; // latitude
    });

    return {
      lat: totalLat / coordinates.length,
      lng: totalLng / coordinates.length
    };
  }

  /**
   * Extract all coordinate pairs from a GeoJSON geometry
   * @param geometry GeoJSON geometry object
   * @returns Array of coordinate pairs [lng, lat]
   */
  private extractAllCoordinates(geometry: any): number[][] {
    const coordinates: number[][] = [];

    if (!geometry || !geometry.coordinates) {
      return coordinates;
    }

    const extractFromArray = (coordArray: any): void => {
      if (Array.isArray(coordArray)) {
        if (coordArray.length === 2 && typeof coordArray[0] === 'number' && typeof coordArray[1] === 'number') {
          coordinates.push([coordArray[0], coordArray[1]]);
        } else {
          coordArray.forEach(extractFromArray);
        }
      }
    };

    if (geometry.type === 'Polygon') {
      geometry.coordinates.forEach((ring: any) => {
        extractFromArray(ring);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((polygon: any) => {
        polygon.forEach((ring: any) => {
          extractFromArray(ring);
        });
      });
    } else {
      extractFromArray(geometry.coordinates);
    }

    return coordinates;
  }

  /**
   * Create a step for visualization
   * @param step Step number
   * @param level Level number
   * @param groups District groups
   * @param description Step description
   * @param direction Division direction
   * @returns Step object
   */
  private createStep(step: number, level: number, groups: DistrictGroup[], description: string, direction: 'latitude' | 'longitude'): GeodistrictStep {
    return {
      step,
      level,
      districtGroups: groups,
      description,
      totalGroups: groups.length,
      totalDistricts: groups.reduce((sum, group) => sum + group.totalDistricts, 0),
      divisionDirection: direction
    };
  }

  /**
   * Get FIPS code for a state abbreviation
   * @param state State abbreviation or FIPS code
   * @returns FIPS code
   */
  private getStateFipsCode(state: string): string {
    // If it's already a FIPS code (2 digits), return as is
    if (/^\d{2}$/.test(state)) {
      return state;
    }

    // Convert state abbreviation to FIPS code
    const stateFipsMap: { [key: string]: string } = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06', 'CO': '08', 'CT': '09', 'DE': '10',
      'FL': '12', 'GA': '13', 'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19', 'KS': '20',
      'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28',
      'MO': '29', 'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34', 'NM': '35', 'NY': '36',
      'NC': '37', 'ND': '38', 'OH': '39', 'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50', 'VA': '51', 'WA': '53', 'WV': '54',
      'WI': '55', 'WY': '56'
    };

    const fipsCode = stateFipsMap[state.toUpperCase()];
    if (!fipsCode) {
      throw new Error(`Invalid state code: ${state}`);
    }

    return fipsCode;
  }

  /**
   * Handle errors
   * @param error Error object
   * @returns Observable that throws error
   */
  private handleError(error: any): Observable<never> {
    console.error('Geodistrict Algorithm Error:', error);
    let errorMessage = 'An error occurred while running the geodistrict algorithm';

    if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return throwError(() => new Error(errorMessage));
  }
}
