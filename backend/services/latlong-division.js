const { calculateBounds, calculateCentroid, calculateTractCentroid, getTractId } = require('./geodistrict-algorithm');
const s4DataLoader = require('./s4-data-loader');

/**
 * LatLong Division Service
 * Divides district groups using latitude/longitude dividing lines
 */
class LatLongDivisionService {
  /**
   * Calculate optimal division ratio
   */
  calculateOptimalDivision(totalDistricts) {
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
   * Get tract bounds - uses pre-calculated bounds if available, otherwise calculates from geometry
   */
  getTractBounds(tract) {
    // Use pre-calculated bounds if available (performance optimization)
    if (tract.properties && 
        typeof tract.properties.MIN_LAT === 'number' &&
        typeof tract.properties.MAX_LAT === 'number' &&
        typeof tract.properties.MIN_LNG === 'number' &&
        typeof tract.properties.MAX_LNG === 'number') {
      return {
        minLat: tract.properties.MIN_LAT,
        maxLat: tract.properties.MAX_LAT,
        minLng: tract.properties.MIN_LNG,
        maxLng: tract.properties.MAX_LNG
      };
    }

    // Fallback: calculate from geometry if bounds not pre-calculated
    if (!tract.geometry) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const lng = coord[0];
          const lat = coord[1];
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const lng = coord[0];
            const lat = coord[1];
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          }
        }
      }
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Check if tract is entirely north or west of a line
   */
  isTractEntirelyNorthOrWest(tract, direction, lineCoordinate) {
    const bounds = this.getTractBounds(tract);
    
    if (direction === 'latitude') {
      // For latitude: "north" means minLat > lineCoordinate (tract's southernmost point is above the line)
      // This means the entire tract is north of the dividing line
      return bounds.minLat > lineCoordinate;
    } else {
      // For longitude: "west" means maxLng < lineCoordinate (tract's easternmost point is west of the line)
      // US longitudes are negative, so more negative = more west
      return bounds.maxLng < lineCoordinate;
    }
  }

  /**
   * Calculate populations on each side of a dividing line
   */
  calculatePopulationsByLine(tracts, direction, lineCoordinate) {
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
   * Fast division using sorted tracts - no need to find dividing line
   * Simply accumulate population until target is reached
   * Returns the index where to split the sorted array
   */
  findDivisionIndex(tracts, direction, targetPopulation) {
    console.log(`📊 SORTING: Starting to sort ${tracts.length} tracts by ${direction === 'latitude' ? 'south boundary (minLat)' : 'east boundary (maxLng)'}`);
    const sortStartTime = Date.now();
    
    // Pre-compute bounds and sort tracts
    const tractsWithBounds = tracts.map(tract => {
      const bounds = this.getTractBounds(tract);
      const population = tract.properties?.POPULATION || 0;
      return { tract, bounds, population };
    });

    // Sort tracts by the relevant boundary
    if (direction === 'latitude') {
      // Sort by south boundary (minLat) - descending (most north first)
      tractsWithBounds.sort((a, b) => b.bounds.minLat - a.bounds.minLat);
    } else {
      // Sort by east boundary (maxLng) - ascending (most west first)
      // Note: US longitudes are negative, so more negative = more west
      tractsWithBounds.sort((a, b) => a.bounds.maxLng - b.bounds.maxLng);
    }

    const sortEndTime = Date.now();
    console.log(`✅ SORTING: Completed in ${sortEndTime - sortStartTime}ms - sorted ${tractsWithBounds.length} tracts`);

    // Accumulate population until we reach the target
    console.log(`🔀 DIVISION: Starting population accumulation (target: ${targetPopulation.toLocaleString()})`);
    const divisionStartTime = Date.now();
    let accumulatedPopulation = 0;
    let divisionIndex = 0;

    for (let i = 0; i < tractsWithBounds.length; i++) {
      accumulatedPopulation += tractsWithBounds[i].population;
      
      // If we've reached or exceeded the target, this is our division point
      if (accumulatedPopulation >= targetPopulation) {
        divisionIndex = i + 1;
        break;
      }
    }

    // Ensure we have at least one tract in each group
    if (divisionIndex === 0) {
      divisionIndex = 1;
    } else if (divisionIndex >= tractsWithBounds.length) {
      divisionIndex = tractsWithBounds.length - 1;
    }

    const divisionEndTime = Date.now();
    const firstGroupPopulation = accumulatedPopulation;
    const secondGroupPopulation = tractsWithBounds.reduce((sum, item, idx) => 
      idx >= divisionIndex ? sum + item.population : sum, 0);
    
    console.log(`✅ DIVISION: Completed in ${divisionEndTime - divisionStartTime}ms`);
    console.log(`   - Division index: ${divisionIndex} of ${tractsWithBounds.length} tracts`);
    console.log(`   - First group: ${divisionIndex} tracts, ${firstGroupPopulation.toLocaleString()} population`);
    console.log(`   - Second group: ${tractsWithBounds.length - divisionIndex} tracts, ${secondGroupPopulation.toLocaleString()} population`);
    console.log(`   - Population variance: ${Math.abs(firstGroupPopulation - targetPopulation).toLocaleString()} (${((Math.abs(firstGroupPopulation - targetPopulation) / targetPopulation) * 100).toFixed(2)}%)`);

    return { divisionIndex, sortedTracts: tractsWithBounds };
  }

  /**
   * Divide tracts using sorted array - extremely fast O(n) approach
   * No need to check boundary intersections or find dividing lines
   */
  divideTractsBySortedArray(sortedTractsWithBounds, divisionIndex, direction) {
    console.log(`✂️ SPLITTING: Splitting ${sortedTractsWithBounds.length} sorted tracts at index ${divisionIndex}`);
    const splitStartTime = Date.now();
    
    const firstGroupTracts = sortedTractsWithBounds.slice(0, divisionIndex).map(item => item.tract);
    const secondGroupTracts = sortedTractsWithBounds.slice(divisionIndex).map(item => item.tract);
    
    const splitEndTime = Date.now();
    console.log(`✅ SPLITTING: Completed in ${splitEndTime - splitStartTime}ms`);
    console.log(`   - First group: ${firstGroupTracts.length} tracts`);
    console.log(`   - Second group: ${secondGroupTracts.length} tracts`);
    
    // Calculate dividing line for reporting (use boundary between the two groups)
    const lastFirstGroupTract = sortedTractsWithBounds[divisionIndex - 1];
    const firstSecondGroupTract = sortedTractsWithBounds[divisionIndex];
    
    let dividingLine;
    if (lastFirstGroupTract && firstSecondGroupTract) {
      if (direction === 'latitude') {
        // For latitude: use the boundary between the two groups
        dividingLine = (lastFirstGroupTract.bounds.minLat + firstSecondGroupTract.bounds.minLat) / 2;
      } else {
        // For longitude: use the boundary between the two groups
        dividingLine = (lastFirstGroupTract.bounds.maxLng + firstSecondGroupTract.bounds.maxLng) / 2;
      }
    } else {
      // Fallback
      if (direction === 'latitude') {
        dividingLine = lastFirstGroupTract?.bounds.minLat || 0;
      } else {
        dividingLine = lastFirstGroupTract?.bounds.maxLng || 0;
      }
    }
    
    return { firstGroupTracts, secondGroupTracts, dividingLine, intersectingTractIds: [] };
  }

  /**
   * Build adjacency graph for tracts using S4 data
   */
  buildAdjacencyGraph(tracts) {
    if (tracts.length === 0) {
      return new Map();
    }

    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      const cacheKey = state.toLowerCase();
      const s4AdjacencyGraph = s4DataLoader.getS4AdjacencyData(cacheKey);
      
      if (s4AdjacencyGraph) {
        const tractIds = new Set(tracts.map(t => getTractId(t)));
        const graph = new Map();
        
        // Initialize all tracts
        for (const tract of tracts) {
          const id = getTractId(tract);
          graph.set(id, []);
        }
        
        // Populate adjacencies from S4 data
        for (const tract of tracts) {
          const id = getTractId(tract);
          const s4Neighbors = s4AdjacencyGraph.get(id) || [];
          
          // Filter to only include neighbors that are in our tract set
          const validNeighbors = s4Neighbors.filter(neighborId => tractIds.has(neighborId));
          graph.set(id, validNeighbors);
        }
        
        return graph;
      }
    }
    
    // Fallback: empty graph
    const graph = new Map();
    for (const tract of tracts) {
      const id = getTractId(tract);
      graph.set(id, []);
    }
    
    return graph;
  }

  /**
   * Calculate reachable tracts from a given tract using BFS
   */
  calculateReachableTracts(tractId, groupTracts, adjacencyGraph) {
    const groupTractIds = new Set(groupTracts.map(t => getTractId(t)));
    
    const reachableTracts = new Set();
    const queue = [tractId];
    reachableTracts.add(tractId);
    
    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = adjacencyGraph.get(currentId) || [];
      
      for (const neighborId of neighbors) {
        if (groupTractIds.has(neighborId) && !reachableTracts.has(neighborId)) {
          reachableTracts.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    
    return reachableTracts.size;
  }

  /**
   * Calculate maximum reachable count (main component size) for a group
   */
  calculateMaxReachableCount(groupTracts, adjacencyGraph) {
    let maxReachableCount = 0;
    for (const tract of groupTracts) {
      const tractId = getTractId(tract);
      const reachableCount = this.calculateReachableTracts(tractId, groupTracts, adjacencyGraph);
      if (reachableCount > maxReachableCount) {
        maxReachableCount = reachableCount;
      }
    }
    return maxReachableCount;
  }

  /**
   * Find isolated groups (connected components that are smaller than the main component)
   */
  findIsolatedGroups(groupTracts, allTracts, adjacencyGraph) {
    if (groupTracts.length === 0) {
      return [];
    }

    const maxReachableCount = this.calculateMaxReachableCount(groupTracts, adjacencyGraph);
    const isolatedGroups = [];
    const processedTracts = new Set();
    
    for (const tract of groupTracts) {
      const tractId = getTractId(tract);
      if (processedTracts.has(tractId)) {
        continue;
      }
      
      const reachableCount = this.calculateReachableTracts(tractId, groupTracts, adjacencyGraph);
      
      // If this component is smaller than the main component, it's isolated
      if (reachableCount < maxReachableCount) {
        // Find all tracts in this isolated component
        const groupTractIds = new Set(groupTracts.map(t => getTractId(t)));
        const isolatedTracts = new Set();
        const queue = [tractId];
        isolatedTracts.add(tractId);
        processedTracts.add(tractId);
        
        while (queue.length > 0) {
          const currentId = queue.shift();
          const neighbors = adjacencyGraph.get(currentId) || [];
          
          for (const neighborId of neighbors) {
            if (groupTractIds.has(neighborId) && !isolatedTracts.has(neighborId)) {
              isolatedTracts.add(neighborId);
              processedTracts.add(neighborId);
              queue.push(neighborId);
            }
          }
        }
        
        // Convert to array of tract objects
        const isolatedTractArray = groupTracts.filter(t => isolatedTracts.has(getTractId(t)));
        isolatedGroups.push(isolatedTractArray);
      } else {
        // Mark all tracts in main component as processed
        const groupTractIds = new Set(groupTracts.map(t => getTractId(t)));
        const mainComponent = new Set();
        const queue = [tractId];
        mainComponent.add(tractId);
        processedTracts.add(tractId);
        
        while (queue.length > 0) {
          const currentId = queue.shift();
          const neighbors = adjacencyGraph.get(currentId) || [];
          
          for (const neighborId of neighbors) {
            if (groupTractIds.has(neighborId) && !mainComponent.has(neighborId)) {
              mainComponent.add(neighborId);
              processedTracts.add(neighborId);
              queue.push(neighborId);
            }
          }
        }
      }
    }
    
    return isolatedGroups;
  }

  /**
   * Validate contiguity (simplified - always returns true for now)
   * TODO: Implement full contiguity checking using S4 adjacency data
   */
  validateContiguity(tracts, groupName) {
    // Simplified: always return true
    // Full implementation would use S4 adjacency data to check if all tracts are connected
    return true;
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param {Object} group - District group to divide
   * @param {string} direction - Division direction ('latitude' or 'longitude')
   * @param {boolean} forceRecalculate - Force recalculation (ignored for now)
   * @returns {Promise<Object>} Division result
   */
  async divideDistrictGroup(group, direction, forceRecalculate = false) {
    const { totalDistricts } = group;

    // Validate input: check for duplicate tracts in the input group
    // Use getTractId() for consistent tract ID extraction
    const inputTractIds = new Set();
    const duplicateTractIds = [];
    for (const tract of group.censusTracts) {
      const tractId = getTractId(tract);
      if (!tractId) {
        console.warn(`⚠️ Tract missing ID, skipping duplicate check:`, tract);
        continue;
      }
      if (inputTractIds.has(tractId)) {
        duplicateTractIds.push(tractId);
      }
      inputTractIds.add(tractId);
    }
    if (duplicateTractIds.length > 0) {
      console.error(`⚠️ DIVISION INPUT ERROR: Group ${group.startDistrictNumber}-${group.endDistrictNumber} contains ${duplicateTractIds.length} duplicate tracts: ${duplicateTractIds.slice(0, 5).join(', ')}${duplicateTractIds.length > 5 ? '...' : ''}`);
      // Remove duplicates from input (keep first occurrence)
      const seen = new Set();
      group.censusTracts = group.censusTracts.filter(tract => {
        const tractId = getTractId(tract);
        if (!tractId) {
          console.warn(`⚠️ Tract missing ID, keeping:`, tract);
          return true; // Keep tracts without IDs (shouldn't happen, but be safe)
        }
        if (seen.has(tractId)) {
          return false;
        }
        seen.add(tractId);
        return true;
      });
      // Recalculate population and bounds after deduplication
      group.totalPopulation = group.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
      group.bounds = calculateBounds(group.censusTracts);
      group.centroid = calculateCentroid(group.censusTracts);
      console.log(`✅ Removed ${duplicateTractIds.length} duplicate tracts, ${group.censusTracts.length} unique tracts remaining`);
    }

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    const targetSecondGroupPopulation = group.totalPopulation - targetFirstGroupPopulation;

    console.log(`🚀 DIVISION START: Dividing group ${group.startDistrictNumber}-${group.endDistrictNumber} by ${direction}`);
    console.log(`   - Total tracts: ${group.censusTracts.length}`);
    console.log(`   - Total population: ${totalPopulation.toLocaleString()}`);
    console.log(`   - Target first group: ${targetFirstGroupPopulation.toLocaleString()} (${division.ratio[0]}%)`);
    console.log(`   - Target second group: ${targetSecondGroupPopulation.toLocaleString()} (${division.ratio[1]}%)`);

    // Fast division: find division index in sorted array
    const { divisionIndex, sortedTracts } = this.findDivisionIndex(
      group.censusTracts,
      direction,
      targetFirstGroupPopulation
    );

    // Create history array
    const history = [];

    // Divide tracts using sorted array (extremely fast - no boundary checks needed)
    const { firstGroupTracts, secondGroupTracts, dividingLine, intersectingTractIds } = 
      this.divideTractsBySortedArray(sortedTracts, divisionIndex, direction);
    
    console.log(`✅ DIVISION COMPLETE: Successfully divided group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
    console.log(`   - Dividing line: ${dividingLine.toFixed(6)}${direction === 'latitude' ? '°N' : '°W'}`);
    console.log(`   - First group: ${firstGroupTracts.length} tracts`);
    console.log(`   - Second group: ${secondGroupTracts.length} tracts`);

    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Lat/long division resulted in non-contiguous groups. This is expected for some geographic configurations.`);
    }

    // DISABLED: Check for isolated groups in firstGroup and rebalance if needed
    // This logic is disabled for step-by-step debugging
    /*
    const allTracts = group.censusTracts;
    const adjacencyGraph = this.buildAdjacencyGraph(allTracts);
    const isolatedGroups = this.findIsolatedGroups(firstGroupTracts, allTracts, adjacencyGraph);
    
    if (isolatedGroups.length > 0) {
      // Move all isolated groups to secondGroup
      const totalIsolatedTracts = isolatedGroups.reduce((sum, isolated) => sum + isolated.length, 0);
      console.log(`🔧 Found ${isolatedGroups.length} isolated group(s) with ${totalIsolatedTracts} total tract(s) in first group, moving to second group and rebalancing`);
      
      // Track which tracts were isolated (so we don't move them back)
      const isolatedTractIds = new Set();
      for (const isolatedGroup of isolatedGroups) {
        for (const tract of isolatedGroup) {
          isolatedTractIds.add(getTractId(tract));
        }
      }
      
      // Move isolated tracts to secondGroup
      for (const isolatedGroup of isolatedGroups) {
        for (const tract of isolatedGroup) {
          const tractId = getTractId(tract);
          // Remove from firstGroup
          const index = firstGroupTracts.findIndex(t => getTractId(t) === tractId);
          if (index !== -1) {
            firstGroupTracts.splice(index, 1);
          }
          // Add to secondGroup (avoid duplicates)
          if (!secondGroupTracts.some(t => getTractId(t) === tractId)) {
            secondGroupTracts.push(tract);
          }
        }
      }
      
      // Move same number of tracts from secondGroup to firstGroup to balance
      // Prefer tracts that are adjacent to firstGroup to maintain contiguity
      // IMPORTANT: Don't move back the isolated tracts we just moved
      const secondGroupTractIds = new Set(secondGroupTracts.map(t => getTractId(t)));
      const firstGroupTractIds = new Set(firstGroupTracts.map(t => getTractId(t)));
      
      // Find tracts in secondGroup that are adjacent to firstGroup
      const candidateTracts = [];
      for (const tract of secondGroupTracts) {
        const tractId = getTractId(tract);
        const neighbors = adjacencyGraph.get(tractId) || [];
        const hasFirstGroupNeighbor = neighbors.some(neighborId => firstGroupTractIds.has(neighborId));
        if (hasFirstGroupNeighbor) {
          candidateTracts.push(tract);
        }
      }
      
      // If we don't have enough adjacent tracts, use any tracts from secondGroup
      const tractsToMove = [];
      let remaining = totalIsolatedTracts;
      
      // First, try to use adjacent tracts
      for (const tract of candidateTracts) {
        if (remaining <= 0) break;
        const tractId = getTractId(tract);
        if (!tractsToMove.some(t => getTractId(t) === tractId)) {
          tractsToMove.push(tract);
          remaining--;
        }
      }
      
      // If we still need more, use any remaining tracts from secondGroup
      // IMPORTANT: Don't move back the isolated tracts we just moved
      if (remaining > 0) {
        for (const tract of secondGroupTracts) {
          if (remaining <= 0) break;
          const tractId = getTractId(tract);
          if (!tractsToMove.some(t => getTractId(t) === tractId) && 
              !firstGroupTractIds.has(tractId) && 
              !isolatedTractIds.has(tractId)) {
            tractsToMove.push(tract);
            remaining--;
          }
        }
      }
      
      // Move tracts from secondGroup to firstGroup
      for (const tract of tractsToMove) {
        const tractId = getTractId(tract);
        // Remove from secondGroup
        const index = secondGroupTracts.findIndex(t => getTractId(t) === tractId);
        if (index !== -1) {
          secondGroupTracts.splice(index, 1);
        }
        // Add to firstGroup (avoid duplicates)
        if (!firstGroupTracts.some(t => getTractId(t) === tractId)) {
          firstGroupTracts.push(tract);
        }
      }
      
      if (remaining > 0) {
        console.warn(`⚠️ REBALANCE WARNING: Could only move ${tractsToMove.length} of ${totalIsolatedTracts} requested tracts from second group to first group. Remaining: ${remaining}`);
      }
      
      console.log(`✅ Rebalanced: Moved ${totalIsolatedTracts} isolated tract(s) to second group, moved ${tractsToMove.length} tract(s) from second group to first group`);
      
      // Validate tract count after rebalancing
      const totalAfterRebalance = firstGroupTracts.length + secondGroupTracts.length;
      const expectedTotal = group.censusTracts.length;
      if (totalAfterRebalance !== expectedTotal) {
        console.error(`⚠️ REBALANCE COUNT MISMATCH: Expected ${expectedTotal} tracts, found ${totalAfterRebalance} after rebalancing (difference: ${totalAfterRebalance - expectedTotal})`);
      }
    }
    */

    // Create new district groups
    const firstGroup = {
      startDistrictNumber: group.startDistrictNumber,
      endDistrictNumber: group.startDistrictNumber + division.first - 1,
      censusTracts: firstGroupTracts,
      totalDistricts: division.first,
      totalPopulation: firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: calculateBounds(firstGroupTracts),
      centroid: calculateCentroid(firstGroupTracts)
    };

    const secondGroup = {
      startDistrictNumber: group.startDistrictNumber + division.first,
      endDistrictNumber: group.endDistrictNumber,
      censusTracts: secondGroupTracts,
      totalDistricts: division.second,
      totalPopulation: secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: calculateBounds(secondGroupTracts),
      centroid: calculateCentroid(secondGroupTracts)
    };

    // Calculate variance
    const actualFirstPopulation = firstGroup.totalPopulation;
    const actualVariance = Math.abs(actualFirstPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation;

    // Format ratio for display
    const ratioDisplay = `${division.ratio[0]}/${division.ratio[1]}`;

    // Add history entries
    history.push(
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} lat/long line at ${dividingLine.toFixed(6) + (direction === 'latitude' ? '°N' : '°W')} by ${ratioDisplay} ratio`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`,
      `  - Population variance: ${(actualVariance * 100).toFixed(1)}%`
    );

    return {
      groups: [firstGroup, secondGroup],
      history,
      dividingLine,
      intersectingTractIds
    };
  }
}

module.exports = new LatLongDivisionService();

