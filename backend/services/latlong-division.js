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
   * Get tract bounds
   */
  getTractBounds(tract) {
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
   * Find optimal dividing line using iterative approach
   */
  findOptimalDividingLine(tracts, direction, targetPopulation) {
    // Get the range of coordinates for the direction using bounding boxes
    const bounds = tracts.map(tract => this.getTractBounds(tract));

    let minCoord, maxCoord;
    if (direction === 'latitude') {
      minCoord = Math.min(...bounds.map(b => b.minLat));
      maxCoord = Math.max(...bounds.map(b => b.maxLat));
    } else {
      minCoord = Math.min(...bounds.map(b => b.minLng));
      maxCoord = Math.max(...bounds.map(b => b.maxLng));
    }
    const centerCoord = (minCoord + maxCoord) / 2;

    // Start with center coordinate and iterate to find optimal position
    let currentLine = centerCoord;
    let bestLine = centerCoord;
    let bestDifference = Infinity;
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.0001; // About 10 meters

    while (iterations < maxIterations) {
      // Calculate populations on each side of the line
      const { firstGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, currentLine);

      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = currentLine;
      }

      // If we're close enough, stop
      if (difference < targetPopulation * 0.005) { // Within 0.5% of target
        break;
      }

      // Calculate adjustment based on population difference
      const populationDifference = firstGroupPopulation - targetPopulation;

      // Determine direction to move the line
      let adjustment;
      if (direction === 'latitude') {
        // For latitude: if first group has too many people, move line north (increase latitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      } else {
        // For longitude: if first group has too many people, move line east (increase longitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      }

      // Prevent infinite loops by ensuring we don't go outside bounds
      const newLine = Math.max(minCoord, Math.min(maxCoord, currentLine + adjustment));

      if (Math.abs(newLine - currentLine) < tolerance) {
        break;
      }

      currentLine = newLine;
      iterations++;
    }

    // If we didn't converge well, try binary search as fallback
    if (bestDifference > targetPopulation * 0.05) { // If still >5% off target
      const binarySearchLine = this.binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord);
      const binarySearchDifference = Math.abs(this.calculatePopulationsByLine(tracts, direction, binarySearchLine).firstGroupPopulation - targetPopulation);

      if (binarySearchDifference < bestDifference) {
        return binarySearchLine;
      }
    }

    return bestLine;
  }

  /**
   * Binary search for optimal dividing line
   */
  binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord) {
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
        left = mid; // Move north/east (increase coordinate)
      } else {
        right = mid; // Move south/west (decrease coordinate)
      }
    }

    return bestLine;
  }

  /**
   * Divide tracts by a lat/long line
   */
  divideTractsByLine(tracts, direction, dividingLine, targetFirstGroupPopulation, targetSecondGroupPopulation, history) {
    const firstGroupTracts = [];
    const secondGroupTracts = [];
    const intersectingTractIds = [];
    const assignedTractIds = new Set(); // Track which tracts we've assigned to prevent duplicates

    for (const tract of tracts) {
      const tractId = getTractId(tract) || 'unknown';
      
      // Safety check: if we've already assigned this tract, skip it (shouldn't happen, but be safe)
      if (assignedTractIds.has(tractId)) {
        console.error(`⚠️ DIVISION ERROR: Tract ${tractId} appears multiple times in input tracts array!`);
        continue;
      }
      
      const population = tract.properties?.POPULATION || 0;
      const bounds = this.getTractBounds(tract);
      
      let isEntirelyNorthOrWest = false;
      let intersectsLine = false;

      if (direction === 'latitude') {
        // Check if tract intersects the line (including edge cases where boundary equals the line)
        intersectsLine = bounds.minLat <= dividingLine && bounds.maxLat >= dividingLine;
        // A tract is entirely NORTH if its southernmost point (minLat) is above the dividing line
        // A tract is entirely SOUTH if its northernmost point (maxLat) is below the dividing line
        // For firstGroup (north): minLat > dividingLine means entire tract is north of line
        isEntirelyNorthOrWest = !intersectsLine && bounds.minLat > dividingLine;
      } else {
        // Check if tract intersects the line (including edge cases where boundary equals the line)
        intersectsLine = bounds.minLng <= dividingLine && bounds.maxLng >= dividingLine;
        // For longitude: US longitudes are negative (west of prime meridian)
        // More negative = more west. So maxLng < dividingLine means entirely west
        // Example: dividingLine = -100, maxLng = -120 means tract is entirely west
        isEntirelyNorthOrWest = !intersectsLine && bounds.maxLng < dividingLine;
      }

      if (intersectsLine) {
        // Tract intersects the line - assign all to south/east group (secondGroup)
        // This ensures we start with a contiguous assignment, then fix isolation if needed
        secondGroupTracts.push(tract);
        assignedTractIds.add(tractId);
        intersectingTractIds.push(tractId);
        // Debug logging for specific tract (check both full ID and last 6 digits which is the tract portion)
        const tractPortion = tractId.length >= 6 ? tractId.slice(-6) : tractId;
        if (tractId === '002000' || tractId.endsWith('002000') || tractPortion === '002000') {
          console.log(`🔍 DEBUG Tract ${tractId}: INTERSECTS line at ${dividingLine}, assigned to SOUTH group (secondGroup)`);
          console.log(`   Bounds: minLat=${bounds.minLat.toFixed(6)}, maxLat=${bounds.maxLat.toFixed(6)}, dividingLine=${dividingLine.toFixed(6)}`);
          console.log(`   Direction: ${direction}, minLat > dividingLine: ${bounds.minLat > dividingLine}, maxLat < dividingLine: ${bounds.maxLat < dividingLine}`);
        }
      } else if (isEntirelyNorthOrWest) {
        firstGroupTracts.push(tract);
        assignedTractIds.add(tractId);
        // Debug logging for specific tract
        const tractPortion = tractId.length >= 6 ? tractId.slice(-6) : tractId;
        if (tractId === '002000' || tractId.endsWith('002000') || tractPortion === '002000') {
          console.log(`🔍 DEBUG Tract ${tractId}: ENTIRELY NORTH, assigned to NORTH group (firstGroup)`);
          console.log(`   Bounds: minLat=${bounds.minLat.toFixed(6)}, maxLat=${bounds.maxLat.toFixed(6)}, dividingLine=${dividingLine.toFixed(6)}`);
          console.log(`   Direction: ${direction}, minLat > dividingLine: ${bounds.minLat > dividingLine}`);
        }
      } else {
        secondGroupTracts.push(tract);
        assignedTractIds.add(tractId);
        // Debug logging for specific tract
        const tractPortion = tractId.length >= 6 ? tractId.slice(-6) : tractId;
        if (tractId === '002000' || tractId.endsWith('002000') || tractPortion === '002000') {
          console.log(`🔍 DEBUG Tract ${tractId}: ENTIRELY SOUTH (else case), assigned to SOUTH group (secondGroup)`);
          console.log(`   Bounds: minLat=${bounds.minLat.toFixed(6)}, maxLat=${bounds.maxLat.toFixed(6)}, dividingLine=${dividingLine.toFixed(6)}`);
          console.log(`   Direction: ${direction}, isEntirelyNorthOrWest=${isEntirelyNorthOrWest}, intersectsLine=${intersectsLine}`);
          console.log(`   minLat > dividingLine: ${bounds.minLat > dividingLine}, maxLat < dividingLine: ${bounds.maxLat < dividingLine}`);
        }
      }
    }

    return { firstGroupTracts, secondGroupTracts, intersectingTractIds };
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
    const inputTractIds = new Set();
    const duplicateTractIds = [];
    for (const tract of group.censusTracts) {
      const tractId = tract.properties?.TRACT_FIPS || tract.properties?.GEOID || 'unknown';
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
        const tractId = tract.properties?.TRACT_FIPS || tract.properties?.GEOID || 'unknown';
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
    }

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    const targetSecondGroupPopulation = group.totalPopulation - targetFirstGroupPopulation;

    // Find the dividing line using iterative approach
    const dividingLine = this.findOptimalDividingLine(group.censusTracts, direction, targetFirstGroupPopulation);

    // Create history array
    const history = [];

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

