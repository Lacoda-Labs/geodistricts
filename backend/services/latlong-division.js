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
  /**
   * Get all tracts in the same tract group (for enclosed/enclosing tracts)
   * @param {Object} tract - Tract to find group members for
   * @param {Array} allTracts - All available tracts
   * @returns {Array} All tracts in the same group (including the input tract)
   */
  getTractGroupMembers(tract, allTracts) {
    const groupId = tract.properties?.TRACT_GROUP_ID;
    if (!groupId) {
      return [tract]; // No group, return just this tract
    }
    
    // Find all tracts with the same TRACT_GROUP_ID
    const groupMembers = allTracts.filter(t => t.properties?.TRACT_GROUP_ID === groupId);
    return groupMembers.length > 0 ? groupMembers : [tract];
  }

  /**
   * Squared distance between two tract centroids (avoids sqrt; order preserved)
   */
  _centroidDistanceSq(itemA, itemB) {
    const cA = calculateTractCentroid(itemA.tract);
    const cB = calculateTractCentroid(itemB.tract);
    const dLat = cA.lat - cB.lat;
    const dLng = cA.lng - cB.lng;
    return dLat * dLat + dLng * dLng;
  }

  /**
   * From remaining items, pick the one that is adjacent to refTract, or nearest by centroid;
   * tie-break by GEOID ascending. GDIP-004 tie-breaker: prefer adjacent or nearest to previous tract.
   */
  _pickAdjacentOrNearest(remainingItems, refItem, adjacencyGraph) {
    if (remainingItems.length === 0) return null;
    if (remainingItems.length === 1) return remainingItems[0];
    const refId = refItem ? getTractId(refItem.tract) : null;

    if (!refId) {
      // No previous: choose by GEOID ascending for determinism
      return remainingItems.slice().sort((a, b) => getTractId(a.tract).localeCompare(getTractId(b.tract)))[0];
    }

    const adjacent = [];
    const notAdjacent = [];
    const neighbors = adjacencyGraph.get(refId) || [];
    const neighborSet = new Set(neighbors);

    for (const item of remainingItems) {
      const id = getTractId(item.tract);
      if (neighborSet.has(id)) adjacent.push(item);
      else notAdjacent.push(item);
    }

    if (adjacent.length > 0) {
      adjacent.sort((a, b) => getTractId(a.tract).localeCompare(getTractId(b.tract)));
      return adjacent[0];
    }
    if (notAdjacent.length === 0) return null;
    // Sort by centroid distance to ref, then GEOID
    notAdjacent.sort((a, b) => {
      const distA = this._centroidDistanceSq(a, refItem);
      const distB = this._centroidDistanceSq(b, refItem);
      if (distA !== distB) return distA - distB;
      return getTractId(a.tract).localeCompare(getTractId(b.tract));
    });
    return notAdjacent[0];
  }

  /**
   * Reorder a run of items (same sortValue) so each is adjacent or nearest to the previous in the sort.
   * prevItem = item immediately before this run (or null if run is at start).
   */
  _reorderTieRunByAdjacencyOrNearness(run, prevItem, adjacencyGraph) {
    if (run.length <= 1) return run;
    const ordered = [];
    let remaining = run.slice();
    let ref = prevItem;

    while (remaining.length > 0) {
      const best = this._pickAdjacentOrNearest(remaining, ref, adjacencyGraph);
      if (!best) break;
      ordered.push(best);
      remaining = remaining.filter((x) => x !== best);
      ref = best;
    }
    return ordered;
  }

  findDivisionIndex(tracts, direction, targetPopulation) {
    console.log(`📊 SORTING: Starting to sort ${tracts.length} tracts by ${direction === 'latitude' ? 'south boundary (minLat)' : 'east boundary (maxLng)'}`);
    const sortStartTime = Date.now();

    // Build adjacency graph for tie-breaker (adjacent or nearest to previous tract)
    const adjacencyGraph = this.buildAdjacencyGraph(tracts);

    // Build tract group map for efficient lookup
    const tractGroupMap = new Map(); // Map<tractId, Set<tractIds in group>>
    for (const tract of tracts) {
      const tractId = getTractId(tract);
      const groupId = tract.properties?.TRACT_GROUP_ID;
      if (groupId && tractId) {
        if (!tractGroupMap.has(groupId)) {
          tractGroupMap.set(groupId, new Set());
        }
        tractGroupMap.get(groupId).add(tractId);
      }
    }
    
    // Pre-compute bounds and sort tracts
    // For enclosed tracts, we want them to sort immediately before their enclosing tracts
    const tractsWithBounds = tracts.map(tract => {
      const bounds = this.getTractBounds(tract);
      const population = tract.properties?.POPULATION || 0;
      const groupId = tract.properties?.TRACT_GROUP_ID;
      const tractId = getTractId(tract);
      const isEnclosed = tract.properties?.ENCLOSED_BY;
      
      // If this tract is enclosed, find its enclosing tract
      let enclosingTract = null;
      if (isEnclosed) {
        enclosingTract = tracts.find(t => getTractId(t) === isEnclosed);
      }
      
      // Determine sort value
      let sortValue;
      if (direction === 'latitude') {
        // For latitude: use south boundary (minLat) - descending (most north first)
        sortValue = bounds.minLat;
        // If enclosed, use enclosing tract's minLat but subtract a tiny amount to ensure it sorts before
        if (enclosingTract) {
          const enclosingBounds = this.getTractBounds(enclosingTract);
          sortValue = enclosingBounds.minLat - 0.000001; // Tiny offset to ensure enclosed sorts before enclosing
        }
      } else {
        // For longitude: use east boundary (maxLng) - ascending (most west first)
        sortValue = bounds.maxLng;
        // If enclosed, use enclosing tract's maxLng but subtract a tiny amount to ensure it sorts before
        if (enclosingTract) {
          const enclosingBounds = this.getTractBounds(enclosingTract);
          sortValue = enclosingBounds.maxLng - 0.000001; // Tiny offset to ensure enclosed sorts before enclosing
        }
      }
      
      // Debug logging for specific tracts
      if (tractId && (tractId.includes('001700') || tractId.includes('002302'))) {
        console.log(`📊 SORTING: Tract ${tractId} - isEnclosed=${!!isEnclosed}, enclosingTract=${isEnclosed || 'none'}, sortValue=${sortValue.toFixed(6)}`);
      }
      
      return { tract, bounds, sortValue, population, groupId, isEnclosed, enclosingTractId: isEnclosed };
    });

    // Sort tracts by the relevant boundary
    if (direction === 'latitude') {
      // Sort by south boundary (minLat) - descending (most north first)
      tractsWithBounds.sort((a, b) => b.sortValue - a.sortValue);
    } else {
      // Sort by east boundary (maxLng) - ascending (most west first)
      // Note: US longitudes are negative, so more negative = more west
      tractsWithBounds.sort((a, b) => a.sortValue - b.sortValue);
    }
    
    // Verify that enclosed tracts are immediately before their enclosing tracts
    // Use a stable approach: after initial sort, move enclosed tracts to immediately before their enclosing tracts
    // Process in multiple passes to handle cases where multiple enclosed tracts share the same enclosing tract
    
    // First, collect all enclosed tracts grouped by their enclosing tract
    const enclosedByEnclosing = new Map(); // Map<enclosingTractId, Array<{item, index}>>
    
    for (let i = 0; i < tractsWithBounds.length; i++) {
      const item = tractsWithBounds[i];
      if (item.isEnclosed && item.enclosingTractId) {
        if (!enclosedByEnclosing.has(item.enclosingTractId)) {
          enclosedByEnclosing.set(item.enclosingTractId, []);
        }
        enclosedByEnclosing.get(item.enclosingTractId).push({ item, index: i });
      }
    }
    
    // Process each enclosing tract's enclosed tracts
    // Sort by enclosing tract position (descending) to process from end to beginning
    const enclosingTractPositions = Array.from(enclosedByEnclosing.keys()).map(enclosingTractId => {
      const index = tractsWithBounds.findIndex(t => getTractId(t.tract) === enclosingTractId);
      return { enclosingTractId, index };
    }).filter(p => p.index !== -1).sort((a, b) => b.index - a.index);
    
    for (const { enclosingTractId, index: enclosingIndex } of enclosingTractPositions) {
      const enclosedItems = enclosedByEnclosing.get(enclosingTractId);
      if (!enclosedItems || enclosedItems.length === 0) continue;
      
      // Find all enclosed tracts that need to be moved
      const itemsToMove = [];
      for (const { item, index: currentIndex } of enclosedItems) {
        // Check if this enclosed tract is already immediately before the enclosing tract
        // We need to account for other enclosed tracts that might already be in position
        const tractId = getTractId(item.tract);
        const currentEnclosingIndex = tractsWithBounds.findIndex(t => getTractId(t.tract) === enclosingTractId);
        
        if (currentEnclosingIndex === -1) continue; // Enclosing tract not found (shouldn't happen)
        
        // Check if this enclosed tract is immediately before the enclosing tract
        // Account for other enclosed tracts that might be between currentIndex and enclosingIndex
        let isInCorrectPosition = false;
        if (currentIndex < currentEnclosingIndex) {
          // Check if there are any non-enclosed tracts between currentIndex and enclosingIndex
          let hasNonEnclosedBetween = false;
          for (let j = currentIndex + 1; j < currentEnclosingIndex; j++) {
            if (!tractsWithBounds[j].isEnclosed || tractsWithBounds[j].enclosingTractId !== enclosingTractId) {
              hasNonEnclosedBetween = true;
              break;
            }
          }
          isInCorrectPosition = !hasNonEnclosedBetween && currentIndex === currentEnclosingIndex - 1;
        }
        
        if (!isInCorrectPosition) {
          itemsToMove.push({ item, currentIndex, tractId });
        }
      }
      
      // Move all enclosed tracts to immediately before the enclosing tract
      // Sort by current index (descending) to process from end to beginning
      itemsToMove.sort((a, b) => b.currentIndex - a.currentIndex);
      
      for (const { item, currentIndex, tractId } of itemsToMove) {
        // Remove from current position
        const [removed] = tractsWithBounds.splice(currentIndex, 1);
        
        // Find the current position of the enclosing tract (may have shifted)
        const currentEnclosingIndex = tractsWithBounds.findIndex(t => 
          getTractId(t.tract) === enclosingTractId
        );
        
        if (currentEnclosingIndex !== -1) {
          // Insert immediately before the enclosing tract
          tractsWithBounds.splice(currentEnclosingIndex, 0, removed);
          
          if (tractId && (tractId.includes('001700') || enclosingTractId.includes('002302'))) {
            console.log(`📊 SORTING: Moved enclosed tract ${tractId} to immediately before enclosing tract ${enclosingTractId} (from index ${currentIndex} to ${currentEnclosingIndex})`);
          }
        }
      }
    }

    // GDIP-004 tie-breaker: within runs of equal boundary value, order by adjacency/nearness to previous tract
    const EPS = 1e-10;
    let i = 0;
    while (i < tractsWithBounds.length) {
      const sortVal = tractsWithBounds[i].sortValue;
      let j = i + 1;
      while (j < tractsWithBounds.length && Math.abs(tractsWithBounds[j].sortValue - sortVal) < EPS) j++;
      if (j - i > 1) {
        const run = tractsWithBounds.slice(i, j);
        const prevItem = i === 0 ? null : tractsWithBounds[i - 1];
        const reordered = this._reorderTieRunByAdjacencyOrNearness(run, prevItem, adjacencyGraph);
        for (let k = 0; k < reordered.length; k++) tractsWithBounds[i + k] = reordered[k];
      }
      i = j;
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
    
    // Build initial groups
    let firstGroupTracts = sortedTractsWithBounds.slice(0, divisionIndex).map(item => item.tract);
    let secondGroupTracts = sortedTractsWithBounds.slice(divisionIndex).map(item => item.tract);
    
    // Ensure tract groups move together - if a tract is in a group, move all group members together
    const allTracts = sortedTractsWithBounds.map(item => item.tract);
    const firstGroupTractIds = new Set(firstGroupTracts.map(t => getTractId(t)));
    const secondGroupTractIds = new Set(secondGroupTracts.map(t => getTractId(t)));
    
    // Build group membership map
    const groupMembersMap = new Map(); // Map<groupId, Set<tractIds>>
    for (const tract of allTracts) {
      const tractId = getTractId(tract);
      const groupId = tract.properties?.TRACT_GROUP_ID;
      if (groupId && tractId) {
        if (!groupMembersMap.has(groupId)) {
          groupMembersMap.set(groupId, new Set());
        }
        groupMembersMap.get(groupId).add(tractId);
      }
    }
    
    // Ensure all group members are in the same division group
    const movedTracts = new Set();
    const processedGroups = new Set();
    
    for (const tract of allTracts) {
      const tractId = getTractId(tract);
      const groupId = tract.properties?.TRACT_GROUP_ID;
      if (!groupId || movedTracts.has(tractId) || processedGroups.has(groupId)) continue;
      
      const groupMembers = groupMembersMap.get(groupId);
      if (!groupMembers || groupMembers.size <= 1) continue;
      
      processedGroups.add(groupId);
      
      // Count how many members are in each group
      let firstGroupCount = 0;
      let secondGroupCount = 0;
      let enclosingTractInFirst = false;
      let enclosingTractInSecond = false;
      
      for (const memberTract of allTracts) {
        const memberId = getTractId(memberTract);
        if (!groupMembers.has(memberId)) continue;
        
        if (firstGroupTractIds.has(memberId)) {
          firstGroupCount++;
          // Check if this is the enclosing tract
          if (memberTract.properties?.ENCLOSES && memberTract.properties.ENCLOSES.length > 0) {
            enclosingTractInFirst = true;
          }
        } else if (secondGroupTractIds.has(memberId)) {
          secondGroupCount++;
          // Check if this is the enclosing tract
          if (memberTract.properties?.ENCLOSES && memberTract.properties.ENCLOSES.length > 0) {
            enclosingTractInSecond = true;
          }
        }
      }
      
      // Determine target group: prefer group with enclosing tract, or group with more members
      let targetGroup = firstGroupCount >= secondGroupCount ? 'first' : 'second';
      if (enclosingTractInFirst) targetGroup = 'first';
      else if (enclosingTractInSecond) targetGroup = 'second';
      
      // Move all group members to the target group
      for (const memberTract of allTracts) {
        const memberId = getTractId(memberTract);
        if (!groupMembers.has(memberId) || movedTracts.has(memberId)) continue;
        
        const inFirstGroup = firstGroupTractIds.has(memberId);
        const inSecondGroup = secondGroupTractIds.has(memberId);
        
        if (targetGroup === 'first' && !inFirstGroup) {
          // Move to first group
          const index = secondGroupTracts.findIndex(t => getTractId(t) === memberId);
          if (index !== -1) {
            secondGroupTracts.splice(index, 1);
            firstGroupTracts.push(memberTract);
            firstGroupTractIds.add(memberId);
            secondGroupTractIds.delete(memberId);
            movedTracts.add(memberId);
            if (memberId.includes('001700') || memberId.includes('002302')) {
              console.log(`🔗 Moved tract ${memberId} to first group to keep tract group ${groupId} together`);
            }
          }
        } else if (targetGroup === 'second' && !inSecondGroup) {
          // Move to second group
          const index = firstGroupTracts.findIndex(t => getTractId(t) === memberId);
          if (index !== -1) {
            firstGroupTracts.splice(index, 1);
            secondGroupTracts.push(memberTract);
            secondGroupTractIds.add(memberId);
            firstGroupTractIds.delete(memberId);
            movedTracts.add(memberId);
            if (memberId.includes('001700') || memberId.includes('002302')) {
              console.log(`🔗 Moved tract ${memberId} to second group to keep tract group ${groupId} together`);
            }
          }
        }
      }
    }
    
    if (movedTracts.size > 0) {
      console.log(`✅ Moved ${movedTracts.size} tract(s) to keep ${processedGroups.size} tract group(s) together`);
    }
    
    // FALLBACK: After division, check if any tract groups were split and ensure they end up in the same group
    // This is a safety check in case the sorting didn't work perfectly
    console.log(`🔍 POST-DIVISION CHECK: Verifying all tract groups are intact...`);
    const postDivisionMovedTracts = new Set();
    const postDivisionProcessedGroups = new Set();
    
    for (const tract of allTracts) {
      const tractId = getTractId(tract);
      const groupId = tract.properties?.TRACT_GROUP_ID;
      if (!groupId || postDivisionProcessedGroups.has(groupId)) continue;
      
      const groupMembers = groupMembersMap.get(groupId);
      if (!groupMembers || groupMembers.size <= 1) continue;
      
      postDivisionProcessedGroups.add(groupId);
      
      // Check which groups the members are in
      const membersInFirst = [];
      const membersInSecond = [];
      let enclosingTractInFirst = false;
      let enclosingTractInSecond = false;
      
      for (const memberTract of allTracts) {
        const memberId = getTractId(memberTract);
        if (!groupMembers.has(memberId)) continue;
        
        if (firstGroupTractIds.has(memberId)) {
          membersInFirst.push(memberTract);
          if (memberTract.properties?.ENCLOSES && memberTract.properties.ENCLOSES.length > 0) {
            enclosingTractInFirst = true;
          }
        } else if (secondGroupTractIds.has(memberId)) {
          membersInSecond.push(memberTract);
          if (memberTract.properties?.ENCLOSES && memberTract.properties.ENCLOSES.length > 0) {
            enclosingTractInSecond = true;
          }
        }
      }
      
      // If group is split, move all members to the group with the enclosing tract, or the larger group
      if (membersInFirst.length > 0 && membersInSecond.length > 0) {
        let targetGroup = 'first';
        if (enclosingTractInSecond) targetGroup = 'second';
        else if (enclosingTractInFirst) targetGroup = 'first';
        else if (membersInSecond.length > membersInFirst.length) targetGroup = 'second';
        
        const tractsToMove = targetGroup === 'first' ? membersInSecond : membersInFirst;
        const fromGroupTracts = targetGroup === 'first' ? secondGroupTracts : firstGroupTracts;
        const toGroupTracts = targetGroup === 'first' ? firstGroupTracts : secondGroupTracts;
        const fromGroupTractIds = targetGroup === 'first' ? secondGroupTractIds : firstGroupTractIds;
        const toGroupTractIds = targetGroup === 'first' ? firstGroupTractIds : secondGroupTractIds;
        
        for (const tractToMove of tractsToMove) {
          const memberId = getTractId(tractToMove);
          if (postDivisionMovedTracts.has(memberId)) continue;
          
          const index = fromGroupTracts.findIndex(t => getTractId(t) === memberId);
          if (index !== -1) {
            fromGroupTracts.splice(index, 1);
            toGroupTracts.push(tractToMove);
            fromGroupTractIds.delete(memberId);
            toGroupTractIds.add(memberId);
            postDivisionMovedTracts.add(memberId);
            
            if (memberId.includes('001700') || memberId.includes('002302')) {
              console.log(`🔍 POST-DIVISION CHECK: Moved tract ${memberId} to ${targetGroup} group to keep tract group ${groupId} together`);
            }
          }
        }
      }
    }
    
    if (postDivisionMovedTracts.size > 0) {
      console.log(`✅ POST-DIVISION CHECK: Moved ${postDivisionMovedTracts.size} tract(s) to keep ${postDivisionProcessedGroups.size} tract group(s) together`);
    }
    
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

