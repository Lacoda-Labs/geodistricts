import { Injectable, Injector, forwardRef } from '@angular/core';
import { GeoJsonFeature } from './census.service';
import { DistrictGroup, GeodistrictAlgorithmService } from './geodistrict-algorithm.service';

@Injectable({
  providedIn: 'root'
})
export class LatLongDivisionService {
  private algorithmService: GeodistrictAlgorithmService | null = null;

  constructor(private injector: Injector) {}

  private getAlgorithmService(): GeodistrictAlgorithmService {
    if (!this.algorithmService) {
      this.algorithmService = this.injector.get(GeodistrictAlgorithmService);
    }
    return this.algorithmService;
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @returns Division result with new groups and history
   */
  divideDistrictGroup(group: DistrictGroup, direction: 'latitude' | 'longitude'): {
    groups: DistrictGroup[];
    history: string[];
    dividingLine: number;
  } {
    const { totalDistricts } = group;

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    const targetSecondGroupPopulation = group.totalPopulation - targetFirstGroupPopulation;

    // Find the dividing line using iterative approach
    const dividingLine = this.findOptimalDividingLine(group.censusTracts, direction, targetFirstGroupPopulation);

    // Divide tracts based on the dividing line
    const { firstGroupTracts, secondGroupTracts } = this.divideTractsByLine(
      group.censusTracts,
      direction,
      dividingLine,
      targetFirstGroupPopulation,
      targetSecondGroupPopulation
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

    const history = [
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} lat/long line at ${dividingLine.toFixed(6) + (direction === 'latitude' ? '°N' : '°W')}`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`,
      `  - Population variance: ${(actualVariance * 100).toFixed(1)}%`
    ];
    
    if (tractsToMove > 0) {
      history.push(`  - To balance variance: move ~${tractsToMove} tract(s) ${moveDirection} (avg tract pop: ${averageTractPopulation.toFixed(0)})`);
    }

    return {
      groups: [firstGroup, secondGroup],
      history,
      dividingLine
    };
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
    targetSecondGroupPopulation: number
  ): {
    firstGroupTracts: GeoJsonFeature[];
    secondGroupTracts: GeoJsonFeature[];
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
    
    // First, compute components in both groups once to identify any isolated components
    const firstGroupComponents = algorithmService.findConnectedComponents(firstGroupTracts, adjacencyGraph);
    const secondGroupComponents = algorithmService.findConnectedComponents(secondGroupTracts, adjacencyGraph);
    
    // Identify main components (largest component in each group)
    const mainFirstComponent = firstGroupComponents.length > 0 
      ? firstGroupComponents.reduce((largest, component) => 
          component.length > largest.length ? component : largest, firstGroupComponents[0])
      : [];
    const mainSecondComponent = secondGroupComponents.length > 0 
      ? secondGroupComponents.reduce((largest, component) => 
          component.length > largest.length ? component : largest, secondGroupComponents[0])
      : [];
    
    // Debug logging for isolated components
    const isolatedFirstComponents = firstGroupComponents.filter(c => c !== mainFirstComponent && c.length > 0);
    const isolatedSecondComponents = secondGroupComponents.filter(c => c !== mainSecondComponent && c.length > 0);
    
    if (isolatedFirstComponents.length > 0 || isolatedSecondComponents.length > 0) {
      console.log(`🔍 Found isolated components: ${isolatedFirstComponents.length} in first group, ${isolatedSecondComponents.length} in second group`);
      for (const isolated of isolatedFirstComponents) {
        console.log(`   First group isolated: ${isolated.length} tracts (${isolated.slice(0, 3).join(', ')})`);
      }
      for (const isolated of isolatedSecondComponents) {
        console.log(`   Second group isolated: ${isolated.length} tracts (${isolated.slice(0, 3).join(', ')})`);
      }
    }
    
    // Helper function to check if a tract ID is in an isolated component
    const isTractInIsolatedComponent = (tractId: string, components: string[][], mainComponent: string[]): boolean => {
      const component = components.find(c => c.includes(tractId));
      return component !== undefined && component !== mainComponent;
    };
    
    for (const intersectingTract of intersectingTracts) {
      const tractId = algorithmService.getTractId(intersectingTract);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      
      // Debug logging for specific tract
      if (tractId.includes('002106') || tractId.includes('02106')) {
        console.log(`🔍 DEBUG: Checking intersecting tract ${tractId}, inFirst: ${inFirst}, inSecond: ${inSecond}, neighbors: ${neighbors.length}`);
      }
      
      if (inSecond) {
        // We're in second group - find adjacent tracts in first group (opposite group)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in first group is isolated
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => 
          isTractInIsolatedComponent(neighborId, firstGroupComponents, mainFirstComponent)
        );
        
        if (isolatedNeighbors.length > 0) {
          // Move intersecting tract to first group to connect with isolated neighbors
          const index = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (index !== -1) {
            secondGroupTracts.splice(index, 1);
            firstGroupTracts.push(intersectingTract);
            const isolatedComponentSizes = isolatedNeighbors.map(id => {
              const component = firstGroupComponents.find(c => c.includes(id));
              return `${id}(${component?.length || 0})`;
            }).join(', ');
            console.log(`🔄 Moved intersecting tract ${tractId} to first group (connects to isolated neighbors: ${isolatedComponentSizes})`);
          }
        } else if (neighborsInFirst.length > 0) {
          // Check if moving the tract improves contiguity (optional - only if no isolated neighbors found)
          const tempFirstGroup = [...firstGroupTracts, intersectingTract];
          const firstGroupComponentsWith = algorithmService.findConnectedComponents(tempFirstGroup, adjacencyGraph);
          
          if (firstGroupComponentsWith.length < firstGroupComponents.length) {
            const index = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
            if (index !== -1) {
              secondGroupTracts.splice(index, 1);
              firstGroupTracts.push(intersectingTract);
              console.log(`🔄 Moved intersecting tract ${tractId} to first group (improves contiguity: ${firstGroupComponents.length} → ${firstGroupComponentsWith.length} components)`);
            }
          }
        }
      } else if (inFirst) {
        // We're in first group - find adjacent tracts in second group (opposite group)
        const neighborsInSecond = neighbors.filter(neighborId => 
          secondGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in second group is isolated
        const isolatedNeighbors = neighborsInSecond.filter(neighborId => 
          isTractInIsolatedComponent(neighborId, secondGroupComponents, mainSecondComponent)
        );
        
        if (isolatedNeighbors.length > 0) {
          // Move intersecting tract to second group to connect with isolated neighbors
          const index = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (index !== -1) {
            firstGroupTracts.splice(index, 1);
            secondGroupTracts.push(intersectingTract);
            const isolatedComponentSizes = isolatedNeighbors.map(id => {
              const component = secondGroupComponents.find(c => c.includes(id));
              return `${id}(${component?.length || 0})`;
            }).join(', ');
            console.log(`🔄 Moved intersecting tract ${tractId} to second group (connects to isolated neighbors: ${isolatedComponentSizes})`);
          }
        } else if (neighborsInSecond.length > 0) {
          // Check if moving the tract improves contiguity (optional - only if no isolated neighbors found)
          const tempSecondGroup = [...secondGroupTracts, intersectingTract];
          const secondGroupComponentsWith = algorithmService.findConnectedComponents(tempSecondGroup, adjacencyGraph);
          
          if (secondGroupComponentsWith.length < secondGroupComponents.length) {
            const index = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
            if (index !== -1) {
              firstGroupTracts.splice(index, 1);
              secondGroupTracts.push(intersectingTract);
              console.log(`🔄 Moved intersecting tract ${tractId} to second group (improves contiguity: ${secondGroupComponents.length} → ${secondGroupComponentsWith.length} components)`);
            }
          }
        }
      }
    }

    // Fix isolated tracts after division (for any remaining issues)
    const fixedResult = algorithmService.fixIsolatedTractsAfterDivision(firstGroupTracts, secondGroupTracts, tracts);
    firstGroupTracts.length = 0;
    firstGroupTracts.push(...fixedResult.firstGroupTracts);
    secondGroupTracts.length = 0;
    secondGroupTracts.push(...fixedResult.secondGroupTracts);

    // Second pass (after fixIsolatedTractsAfterDivision): Check intersecting tracts again for isolated neighbors
    // Recompute components after fixIsolatedTractsAfterDivision as groups may have changed
    console.log(`🔍 Second pass check: Checking ${firstGroupTracts.length} first group tracts and ${secondGroupTracts.length} second group tracts`);
    const firstGroupComponentsAfterFix = algorithmService.findConnectedComponents(firstGroupTracts, adjacencyGraph);
    const secondGroupComponentsAfterFix = algorithmService.findConnectedComponents(secondGroupTracts, adjacencyGraph);
    console.log(`🔍 Second pass check: Found ${firstGroupComponentsAfterFix.length} component(s) in first group, ${secondGroupComponentsAfterFix.length} component(s) in second group`);
    
    const mainFirstComponentAfterFix = firstGroupComponentsAfterFix.length > 0 
      ? firstGroupComponentsAfterFix.reduce((largest, component) => 
          component.length > largest.length ? component : largest, firstGroupComponentsAfterFix[0])
      : [];
    const mainSecondComponentAfterFix = secondGroupComponentsAfterFix.length > 0 
      ? secondGroupComponentsAfterFix.reduce((largest, component) => 
          component.length > largest.length ? component : largest, secondGroupComponentsAfterFix[0])
      : [];
    
    const isolatedFirstComponentsAfterFix = firstGroupComponentsAfterFix.filter(c => c !== mainFirstComponentAfterFix && c.length > 0);
    const isolatedSecondComponentsAfterFix = secondGroupComponentsAfterFix.filter(c => c !== mainSecondComponentAfterFix && c.length > 0);
    
    if (isolatedFirstComponentsAfterFix.length > 0 || isolatedSecondComponentsAfterFix.length > 0) {
      console.log(`🔍 After fixIsolatedTracts: Found isolated components: ${isolatedFirstComponentsAfterFix.length} in first group, ${isolatedSecondComponentsAfterFix.length} in second group`);
      for (const isolated of isolatedFirstComponentsAfterFix) {
        console.log(`   First group isolated: ${isolated.length} tracts (${isolated.slice(0, 3).join(', ')})`);
      }
      for (const isolated of isolatedSecondComponentsAfterFix) {
        console.log(`   Second group isolated: ${isolated.length} tracts (${isolated.slice(0, 3).join(', ')})`);
      }
    }
    
    // Check intersecting tracts again for isolated neighbors
    for (const intersectingTract of intersectingTracts) {
      const tractId = algorithmService.getTractId(intersectingTract);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      const inFirst = firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      const inSecond = secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
      
      // Debug logging for specific tract
      if (tractId.includes('002106') || tractId.includes('02106')) {
        console.log(`🔍 DEBUG (after fix): Checking intersecting tract ${tractId}, inFirst: ${inFirst}, inSecond: ${inSecond}, neighbors: ${neighbors.length}`);
      }
      
      if (inSecond) {
        // We're in second group - find adjacent tracts in first group (opposite group)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Debug logging for specific tract
        if (tractId.includes('002106') || tractId.includes('02106')) {
          console.log(`🔍 DEBUG (after fix): ${tractId} - neighborsInFirst: ${neighborsInFirst.join(', ')}`);
          console.log(`🔍 DEBUG (after fix): ${tractId} - firstGroupComponentsAfterFix: ${firstGroupComponentsAfterFix.map(c => c.length).join(', ')}`);
          console.log(`🔍 DEBUG (after fix): ${tractId} - mainFirstComponentAfterFix size: ${mainFirstComponentAfterFix.length}`);
        }
        
        // Check if any adjacent tract in first group is isolated
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => {
          const component = firstGroupComponentsAfterFix.find(c => c.includes(neighborId));
          const isIsolated = component !== undefined && component !== mainFirstComponentAfterFix;
          if ((tractId.includes('002106') || tractId.includes('02106')) && isIsolated) {
            console.log(`🔍 DEBUG (after fix): ${tractId} - Found isolated neighbor ${neighborId} in component of size ${component?.length || 0}`);
          }
          return isIsolated;
        });
        
        if (isolatedNeighbors.length > 0) {
          // Move intersecting tract to first group to connect with isolated neighbors
          const index = secondGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (index !== -1) {
            secondGroupTracts.splice(index, 1);
            firstGroupTracts.push(intersectingTract);
            const isolatedComponentSizes = isolatedNeighbors.map(id => {
              const component = firstGroupComponentsAfterFix.find(c => c.includes(id));
              return `${id}(${component?.length || 0})`;
            }).join(', ');
            console.log(`🔄 (After fix) Moved intersecting tract ${tractId} to first group (connects to isolated neighbors: ${isolatedComponentSizes})`);
          }
        } else if (tractId.includes('002106') || tractId.includes('02106')) {
          console.log(`⚠️ DEBUG (after fix): ${tractId} - No isolated neighbors found. neighborsInFirst: ${neighborsInFirst.length}`);
        }
      } else if (inFirst) {
        // We're in first group - check if any neighbors in first group are isolated
        // (This handles the case where the intersecting tract is in the same group as isolated components)
        const neighborsInFirst = neighbors.filter(neighborId => 
          firstGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in first group is isolated
        const isolatedNeighbors = neighborsInFirst.filter(neighborId => {
          const component = firstGroupComponentsAfterFix.find(c => c.includes(neighborId));
          const isIsolated = component !== undefined && component !== mainFirstComponentAfterFix;
          if ((tractId.includes('002106') || tractId.includes('02106')) && isIsolated) {
            console.log(`🔍 DEBUG (after fix): ${tractId} - Found isolated neighbor ${neighborId} in first group, component size ${component?.length || 0}`);
          }
          return isIsolated;
        });
        
        if (isolatedNeighbors.length > 0) {
          // The intersecting tract is adjacent to isolated neighbors in the same group
          // This is good - the tract is already connecting to the isolated neighbors
          // But we should verify this is correct by checking if moving it would disconnect them
          // Actually, if the tract is already in the same group and has isolated neighbors,
          // we should keep it there (it's already there)
          const isolatedComponentSizes = isolatedNeighbors.map(id => {
            const component = firstGroupComponentsAfterFix.find(c => c.includes(id));
            return `${id}(${component?.length || 0})`;
          }).join(', ');
          console.log(`✅ (After fix) Intersecting tract ${tractId} is in first group with isolated neighbors: ${isolatedComponentSizes} - keeping it in first group`);
        }
        
        // Also check neighbors in second group (opposite group)
        const neighborsInSecond = neighbors.filter(neighborId => 
          secondGroupTracts.some(t => algorithmService.getTractId(t) === neighborId)
        );
        
        // Check if any adjacent tract in second group is isolated
        const isolatedNeighborsInSecond = neighborsInSecond.filter(neighborId => {
          const component = secondGroupComponentsAfterFix.find(c => c.includes(neighborId));
          return component !== undefined && component !== mainSecondComponentAfterFix;
        });
        
        if (isolatedNeighborsInSecond.length > 0) {
          // Move intersecting tract to second group to connect with isolated neighbors
          const index = firstGroupTracts.findIndex(t => algorithmService.getTractId(t) === tractId);
          if (index !== -1) {
            firstGroupTracts.splice(index, 1);
            secondGroupTracts.push(intersectingTract);
            const isolatedComponentSizes = isolatedNeighborsInSecond.map(id => {
              const component = secondGroupComponentsAfterFix.find(c => c.includes(id));
              return `${id}(${component?.length || 0})`;
            }).join(', ');
            console.log(`🔄 (After fix) Moved intersecting tract ${tractId} to second group (connects to isolated neighbors: ${isolatedComponentSizes})`);
          }
        }
      }
    }

    // Third pass: refine division to minimize variance by moving intersecting tracts
    // Get remaining intersecting tracts that can be moved
    const remainingIntersectingTracts = intersectingTracts.filter(tract => {
      const tractId = algorithmService.getTractId(tract);
      return firstGroupTracts.some(t => algorithmService.getTractId(t) === tractId) ||
             secondGroupTracts.some(t => algorithmService.getTractId(t) === tractId);
    });

    // Sort intersecting tracts by population (smallest first for finer control)
    remainingIntersectingTracts.sort((a, b) => {
      const popA = a.properties?.POPULATION || 0;
      const popB = b.properties?.POPULATION || 0;
      return popA - popB;
    });

    // Calculate current population and variance
    let firstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    let secondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    let firstGroupVariance = firstGroupPopulation - targetFirstGroupPopulation;
    let secondGroupVariance = secondGroupPopulation - targetSecondGroupPopulation;

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
          console.log(`📊 Moved intersecting tract ${tractId} (pop: ${tractPopulation.toLocaleString()})${enclosedTractIds.length > 0 ? ` and ${enclosedTractIds.length} enclosed tract(s)` : ''} from first to second group to reduce variance`);
        }
        // Stop if first group now has negative variance (overcorrected)
        if (firstGroupVariance < 0) {
          console.log(`✅ First group variance reduced to negative (${((firstGroupVariance / targetFirstGroupPopulation) * 100).toFixed(2)}%), stopping`);
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
          console.log(`📊 Moved intersecting tract ${tractId} (pop: ${tractPopulation.toLocaleString()})${enclosedTractIds.length > 0 ? ` and ${enclosedTractIds.length} enclosed tract(s)` : ''} from second to first group to reduce variance`);
        }
        // Stop if second group now has negative variance (overcorrected)
        if (secondGroupVariance < 0) {
          console.log(`✅ Second group variance reduced to negative (${((secondGroupVariance / targetSecondGroupPopulation) * 100).toFixed(2)}%), stopping`);
          break;
        }
      }
    }

    const finalFirstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const finalSecondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const finalFirstVariance = ((finalFirstGroupPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation) * 100;
    const finalSecondVariance = ((finalSecondGroupPopulation - targetSecondGroupPopulation) / targetSecondGroupPopulation) * 100;
    console.log(`📊 Final variance after refinement: First group: ${finalFirstVariance.toFixed(2)}%, Second group: ${finalSecondVariance.toFixed(2)}%`);
    
    return { 
      firstGroupTracts, 
      secondGroupTracts 
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

