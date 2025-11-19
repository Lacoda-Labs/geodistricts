const s4DataLoader = require('./s4-data-loader');

/**
 * Algorithm version - increment this when algorithm logic changes
 * 20251117-2010: Fixed duplicate tract assignment bug in fixIsolatedTractsAcrossAllGroups
 * 20251117-2245: Fixed tract intersection detection bug - tracts with boundaries exactly equal to dividing line were misclassified
 * 20251117-2300: Added final validation to catch and fix orphaned/missing tracts after algorithm completion
 * 20251117-2310: Added simple tract count validation after each division step to immediately detect orphaned/duplicate tracts
 * 20251117-2320: Changed intersection tract assignment - all intersecting tracts now assigned to south/east group, then isolation checked and rebalanced
 * 20251117-2329: Fixed inverted north/south check - changed from maxLat < dividingLine to minLat > dividingLine for latitude division
 * 20251117-2330: Disabled isolation checking and rebalancing logic for step-by-step debugging
 * 20251117-2343: Fixed tract ID uniqueness - TRACT_FIPS alone is not unique across state, now using GEOID or STATE+COUNTY+TRACT
 * 20251117-2350: Disabled deduplication by default for debugging - all tracts will be included (set DISABLE_DEDUP=false to enable)
 * 20251119-0400: Fixed missing tracts in step 1 - added deduplication in step 0 initialization and improved duplicate detection in division service
 */
const ALGORITHM_VERSION = '20251119-0400';

/**
 * Congressional districts per state (2020 census apportionment)
 */
const CONGRESSIONAL_DISTRICTS_BY_STATE = {
  'AL': 7, 'AK': 1, 'AZ': 9, 'AR': 4, 'CA': 52,
  'CO': 8, 'CT': 5, 'DE': 1, 'FL': 28, 'GA': 14,
  'HI': 2, 'ID': 2, 'IL': 17, 'IN': 9, 'IA': 4,
  'KS': 4, 'KY': 6, 'LA': 6, 'ME': 2, 'MD': 8,
  'MA': 9, 'MI': 13, 'MN': 8, 'MS': 4, 'MO': 8,
  'MT': 2, 'NE': 3, 'NV': 4, 'NH': 2, 'NJ': 12,
  'NM': 3, 'NY': 26, 'NC': 14, 'ND': 1, 'OH': 15,
  'OK': 5, 'OR': 6, 'PA': 17, 'RI': 2, 'SC': 7,
  'SD': 1, 'TN': 9, 'TX': 38, 'UT': 4, 'VT': 1,
  'VA': 11, 'WA': 10, 'WV': 2, 'WI': 8, 'WY': 1,
  'DC': 1
};

/**
 * Get number of congressional districts for a state
 */
function getDistrictsForState(state) {
  return CONGRESSIONAL_DISTRICTS_BY_STATE[state.toUpperCase()] || null;
}

/**
 * Get tract ID from a GeoJSON feature
 * IMPORTANT: Tract IDs must be unique across the entire state, not just within a county.
 * TRACT_FIPS alone is not unique - it's only unique within a county.
 * We need to use GEOID (which includes state+county+tract) or construct it from STATE+COUNTY+TRACT.
 */
function getTractId(tract) {
  // Prefer GEOID as it's the full unique identifier (state+county+tract)
  if (tract.properties?.GEOID) {
    return tract.properties.GEOID;
  }
  
  // If GEOID not available, try GEO_ID (may have "US" prefix)
  if (tract.properties?.GEO_ID) {
    // Remove "US" prefix if present
    const geoId = tract.properties.GEO_ID;
    if (geoId.startsWith('US')) {
      return geoId.substring(2);
    }
    return geoId;
  }
  
  // Fallback: construct from STATE_FIPS + COUNTY_FIPS + TRACT_FIPS
  // This ensures uniqueness across the entire state
  if (tract.properties?.STATE_FIPS && tract.properties?.COUNTY_FIPS && tract.properties?.TRACT_FIPS) {
    return `${tract.properties.STATE_FIPS}${tract.properties.COUNTY_FIPS}${tract.properties.TRACT_FIPS}`;
  }
  
  // Last resort: use TRACT_FIPS alone (not ideal, but better than null)
  if (tract.properties?.TRACT_FIPS) {
    console.warn(`⚠️ Using non-unique TRACT_FIPS for tract ID: ${tract.properties.TRACT_FIPS} (missing STATE/COUNTY)`);
    return tract.properties.TRACT_FIPS;
  }
  
  return null;
}

/**
 * Merge duplicate tracts with the same ID (e.g., MultiPolygon parts split into separate features)
 * Returns array of unique tracts with merged geometries
 * Set DISABLE_DEDUP=false to enable deduplication (currently disabled for debugging)
 */
const DISABLE_DEDUP = process.env.DISABLE_DEDUP !== 'false'; // Default to true (disabled) for debugging

function deduplicateAndMergeTracts(tracts) {
  // DISABLED: Skip deduplication for debugging (can enable by setting DISABLE_DEDUP=false)
  if (DISABLE_DEDUP) {
    console.log(`⚠️ DEDUPLICATION DISABLED: Returning all ${tracts.length} tracts without deduplication (set DISABLE_DEDUP=false to enable)`);
    return tracts;
  }

  const seenTractIds = new Map(); // Map<tractId, tract> - store merged tract
  const duplicateTractIds = [];
  const nullTractIds = [];
  
  console.log(`📊 Starting deduplication: ${tracts.length} input tracts`);
  
  for (const tract of tracts) {
    let tractId = getTractId(tract);
    
    // Check for null/undefined tract IDs - try to generate one from properties
    if (!tractId || tractId === 'null' || tractId === 'undefined') {
      // Try to construct an ID from available properties
      let generatedId = null;
      if (tract.properties) {
        // Try STATE + COUNTY + TRACT
        if (tract.properties.STATE && tract.properties.COUNTY && tract.properties.TRACT) {
          generatedId = `${tract.properties.STATE}${tract.properties.COUNTY}${tract.properties.TRACT}`;
        } else if (tract.properties.STATE_FIPS && tract.properties.COUNTY_FIPS && tract.properties.TRACT_FIPS) {
          generatedId = `${tract.properties.STATE_FIPS}${tract.properties.COUNTY_FIPS}${tract.properties.TRACT_FIPS}`;
        } else if (tract.geometry) {
          // Fallback: use centroid coordinates as ID
          const centroid = calculateTractCentroid(tract);
          generatedId = `generated_${centroid.lat.toFixed(6)}_${centroid.lng.toFixed(6)}`;
        }
      }
      
      if (generatedId) {
        // Use the generated ID
        tractId = generatedId;
        if (!tract.properties) tract.properties = {};
        tract.properties.GENERATED_ID = generatedId;
      } else {
        // If we still can't generate an ID, log detailed info and skip
        const tractInfo = {
          hasProperties: !!tract.properties,
          propertyKeys: tract.properties ? Object.keys(tract.properties) : [],
          hasGeometry: !!tract.geometry,
          geometryType: tract.geometry?.type,
          sampleProperties: tract.properties ? {
            TRACT_FIPS: tract.properties.TRACT_FIPS,
            GEOID: tract.properties.GEOID,
            GEO_ID: tract.properties.GEO_ID,
            STATE_FIPS: tract.properties.STATE_FIPS,
            COUNTY_FIPS: tract.properties.COUNTY_FIPS,
            STATE: tract.properties.STATE,
            COUNTY: tract.properties.COUNTY,
            TRACT: tract.properties.TRACT
          } : null
        };
        nullTractIds.push(tractInfo);
        continue;
      }
    }
    
    if (seenTractIds.has(tractId)) {
      duplicateTractIds.push(tractId);
      // Merge geometries if this is a duplicate (MultiPolygon parts)
      const existingTract = seenTractIds.get(tractId);
      if (tract.geometry && existingTract.geometry) {
        // Merge MultiPolygon geometries
        if (existingTract.geometry.type === 'Polygon' && tract.geometry.type === 'Polygon') {
          // Convert both to MultiPolygon
          existingTract.geometry = {
            type: 'MultiPolygon',
            coordinates: [existingTract.geometry.coordinates, tract.geometry.coordinates]
          };
        } else if (existingTract.geometry.type === 'MultiPolygon' && tract.geometry.type === 'Polygon') {
          // Add polygon to existing MultiPolygon
          existingTract.geometry.coordinates.push(tract.geometry.coordinates);
        } else if (existingTract.geometry.type === 'Polygon' && tract.geometry.type === 'MultiPolygon') {
          // Convert existing to MultiPolygon and merge
          existingTract.geometry = {
            type: 'MultiPolygon',
            coordinates: [existingTract.geometry.coordinates, ...tract.geometry.coordinates]
          };
        } else if (existingTract.geometry.type === 'MultiPolygon' && tract.geometry.type === 'MultiPolygon') {
          // Merge two MultiPolygons
          existingTract.geometry.coordinates.push(...tract.geometry.coordinates);
        }
        // Merge properties (prefer non-null values)
        Object.keys(tract.properties || {}).forEach(key => {
          if (tract.properties[key] !== null && tract.properties[key] !== undefined) {
            if (!existingTract.properties[key] || existingTract.properties[key] === null) {
              existingTract.properties[key] = tract.properties[key];
            }
          }
        });
      }
      continue;
    }
    // Clone the tract to avoid mutating the original
    seenTractIds.set(tractId, JSON.parse(JSON.stringify(tract)));
  }
  
  const uniqueTracts = Array.from(seenTractIds.values());
  
  if (nullTractIds.length > 0) {
    console.error(`⚠️ INPUT ERROR: Found ${nullTractIds.length} tracts with null/undefined IDs (these will be SKIPPED)`);
    console.error(`   Sample null tract info:`, JSON.stringify(nullTractIds.slice(0, 3), null, 2));
    console.error(`   ⚠️ WARNING: ${nullTractIds.length} tracts will be missing from the algorithm!`);
  }
  
  if (duplicateTractIds.length > 0) {
    const uniqueDuplicates = [...new Set(duplicateTractIds)];
    console.log(`ℹ️ Found ${duplicateTractIds.length} duplicate tract features (${uniqueDuplicates.length} unique IDs) - merged into single features`);
    console.log(`   Sample duplicate IDs: ${uniqueDuplicates.slice(0, 10).join(', ')}${uniqueDuplicates.length > 10 ? '...' : ''}`);
    console.log(`   Using ${uniqueTracts.length} unique tracts instead of ${tracts.length} total features`);
  }
  
  const totalSkipped = nullTractIds.length;
  const totalMerged = duplicateTractIds.length;
  const totalOutput = uniqueTracts.length;
  
  if (totalSkipped > 0 || totalMerged > 0 || totalOutput !== tracts.length) {
    console.log(`📊 Deduplication Summary:`);
    console.log(`   Input: ${tracts.length} tracts`);
    console.log(`   Skipped (no ID): ${totalSkipped} tracts`);
    console.log(`   Merged (duplicates): ${totalMerged} tracts`);
    console.log(`   Output: ${totalOutput} unique tracts`);
    console.log(`   Difference: ${tracts.length - totalOutput} tracts (${totalSkipped} skipped + ${totalMerged} merged)`);
  }
  
  return uniqueTracts;
}

/**
 * Calculate bounds for a group of tracts
 */
function calculateBounds(tracts) {
  if (tracts.length === 0) {
    return { north: 0, south: 0, east: 0, west: 0 };
  }

  let north = -90, south = 90, east = -180, west = 180;

  for (const tract of tracts) {
    const centroid = calculateTractCentroid(tract);
    north = Math.max(north, centroid.lat);
    south = Math.min(south, centroid.lat);
    east = Math.max(east, centroid.lng);
    west = Math.min(west, centroid.lng);
  }

  return { north, south, east, west };
}

/**
 * Calculate centroid for a single tract
 */
function calculateTractCentroid(tract) {
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
 * Calculate centroid for a group of tracts (population-weighted)
 */
function calculateCentroid(tracts) {
  if (tracts.length === 0) {
    return { lat: 0, lng: 0 };
  }

  let totalLat = 0, totalLng = 0, totalPopulation = 0;

  for (const tract of tracts) {
    const population = tract.properties?.POPULATION || 0;
    const centroid = calculateTractCentroid(tract);
    
    totalLat += centroid.lat * population;
    totalLng += centroid.lng * population;
    totalPopulation += population;
  }

  if (totalPopulation === 0) {
    // Fallback to geometric centroid if no population data
    let sumLat = 0, sumLng = 0;
    for (const tract of tracts) {
      const centroid = calculateTractCentroid(tract);
      sumLat += centroid.lat;
      sumLng += centroid.lng;
    }
    return { lat: sumLat / tracts.length, lng: sumLng / tracts.length };
  }

  return {
    lat: totalLat / totalPopulation,
    lng: totalLng / totalPopulation
  };
}

/**
 * Calculate optimal division ratio
 */
function calculateOptimalDivision(totalDistricts) {
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
 * Create a step object
 */
function createStep(step, level, districtGroups, description, divisionDirection, divisionLine, divisionLines) {
  return {
    step,
    level,
    districtGroups,
    description,
    totalGroups: districtGroups.length,
    totalDistricts: districtGroups.reduce((sum, g) => sum + g.totalDistricts, 0),
    divisionDirection: divisionDirection || 'latitude',
    divisionLine,
    divisionLines: divisionLines || []
  };
}

/**
 * Geodistrict Algorithm Service
 * Executes the geodistricting algorithm
 */
class GeodistrictAlgorithmService {
  constructor(latLongDivisionService) {
    this.latLongDivisionService = latLongDivisionService;
  }

  /**
   * Initialize algorithm and return step 0
   * @param {Array} tracts - Array of GeoJSON tract features
   * @param {number} totalDistricts - Total number of districts
   * @param {number} maxIterations - Maximum iterations
   * @returns {Promise<{step: Object, state: Object}>} Step 0 and algorithm state
   */
  async initializeAlgorithm(tracts, totalDistricts, maxIterations) {
    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      try {
        await s4DataLoader.loadS4AdjacencyData(state);
      } catch (error) {
        console.warn(`⚠️ Failed to preload S4 adjacency data:`, error);
      }
    }

    // Deduplicate tracts array - merge duplicates (e.g., MultiPolygon parts)
    // Always deduplicate for step 0 to ensure we start with unique tracts
    let uniqueTracts = deduplicateAndMergeTracts(tracts);
    
    // If deduplication was disabled, manually remove duplicates by tract ID
    if (DISABLE_DEDUP) {
      console.log(`⚠️ Deduplication disabled, but removing duplicates for step 0 initialization`);
      const seenIds = new Set();
      const deduplicated = [];
      for (const tract of uniqueTracts) {
        const tractId = getTractId(tract);
        if (!seenIds.has(tractId)) {
          seenIds.add(tractId);
          deduplicated.push(tract);
        } else {
          console.log(`⚠️ Removing duplicate tract: ${tractId}`);
        }
      }
      uniqueTracts = deduplicated;
      console.log(`✅ Deduplicated from ${tracts.length} to ${uniqueTracts.length} unique tracts`);
    }

    const totalStatePopulation = uniqueTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    const initialGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: uniqueTracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: calculateBounds(uniqueTracts),
      centroid: calculateCentroid(uniqueTracts)
    };

    const initialStep = createStep(0, 0, [initialGroup], 'Initial state: All tracts in single group', 'latitude');

    // Return step 0 and algorithm state
    return {
      step: initialStep,
      state: {
        uniqueTracts,
        currentGroups: [initialGroup],
        iteration: 0,
        steps: [initialStep],
        algorithmHistory: [],
        totalStatePopulation,
        targetDistrictPopulation,
        maxIterations,
        state
      }
    };
  }

  /**
   * Execute the next step of the algorithm
   * @param {Object} algorithmState - Current algorithm state
   * @returns {Promise<{step: Object, state: Object, isComplete: boolean}>} Next step and updated state
   */
  async executeNextStep(algorithmState) {
    const {
      uniqueTracts,
      currentGroups,
      iteration,
      steps,
      algorithmHistory,
      maxIterations,
      state: stateCode
    } = algorithmState;

    // Check if algorithm is complete
    if (!currentGroups.some(group => group.totalDistricts > 1) || iteration >= maxIterations) {
      return {
        step: null,
        state: algorithmState,
        isComplete: true
      };
    }

    const nextIteration = iteration + 1;
    const direction = nextIteration % 2 === 1 ? 'latitude' : 'longitude';
    const newGroups = [];
    const divisionLines = [];

    for (const group of currentGroups) {
      if (group.totalDistricts === 1) {
        newGroups.push(group);
      } else {
        const division = calculateOptimalDivision(group.totalDistricts);
        const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, false);
        
        if (divisionResult) {
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
          
          if (divisionResult.dividingLine !== undefined) {
            divisionLines.push({
              line: divisionResult.dividingLine,
              direction: direction,
              parentGroup: {
                startDistrictNumber: group.startDistrictNumber,
                endDistrictNumber: group.endDistrictNumber,
                totalDistricts: group.totalDistricts
              },
              ratio: division.ratio,
              intersectingTractIds: divisionResult.intersectingTractIds
            });
          }
        }
      }
    }

    let updatedGroups = newGroups;
    
    // Quick validation: Total tract count should match input count
    const totalTractsAfterDivision = updatedGroups.reduce((sum, group) => sum + group.censusTracts.length, 0);
    const expectedTractCount = uniqueTracts.length;
    if (totalTractsAfterDivision !== expectedTractCount) {
      console.error(`⚠️ DIVISION COUNT MISMATCH: Expected ${expectedTractCount} tracts, found ${totalTractsAfterDivision} after division step ${nextIteration} (difference: ${totalTractsAfterDivision - expectedTractCount})`);
      if (totalTractsAfterDivision < expectedTractCount) {
        console.error(`   → Missing ${expectedTractCount - totalTractsAfterDivision} tract(s) - orphaned tracts detected!`);
      } else {
        console.error(`   → Extra ${totalTractsAfterDivision - expectedTractCount} tract(s) - duplicate tracts detected!`);
      }
    }
    
    // Fix isolated tracts after division (use uniqueTracts to ensure no duplicates in adjacency graph)
    updatedGroups = this.fixIsolatedTractsAcrossAllGroups(updatedGroups, uniqueTracts, direction);
    
    const step = createStep(nextIteration, nextIteration, updatedGroups,
      `Division ${nextIteration} by ${direction}`, direction, undefined, divisionLines);
    
    const updatedSteps = [...steps, step];
    const updatedState = {
      ...algorithmState,
      currentGroups: updatedGroups,
      iteration: nextIteration,
      steps: updatedSteps,
      algorithmHistory: [...algorithmHistory]
    };

    const isComplete = !updatedGroups.some(group => group.totalDistricts > 1) || nextIteration >= maxIterations;

    return {
      step,
      state: updatedState,
      isComplete
    };
  }

  /**
   * Build adjacency graph for tracts using S4 data or geometric intersection
   * @param {Array} tracts - Array of GeoJSON tract features
   * @returns {Map<string, string[]>} - Adjacency graph (tractId -> [neighborIds])
   */
  buildGeometryAdjacencyGraph(tracts) {
    if (tracts.length === 0) {
      return new Map();
    }

    // Try to use S4 adjacency data if available
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
        
        // Debug: Count total adjacency relationships
        let totalAdjacencies = 0;
        for (const [tractId, neighbors] of graph.entries()) {
          totalAdjacencies += neighbors.length;
        }
        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`✅ Built adjacency graph using S4 data: ${totalAdjacencies} total relationships for ${tracts.length} tracts`);
        }
        
        return graph;
      }
    }
    
    // Fallback: For now, return empty graph (geometric intersection would require additional libraries)
    // In production, you'd want to implement geometric intersection here
    const graph = new Map();
    for (const tract of tracts) {
      const id = getTractId(tract);
      graph.set(id, []);
    }
    
    if (process.env.DEBUG_CACHE === 'true') {
      console.log(`⚠️ S4 adjacency data not available, using empty adjacency graph (geometric intersection not implemented)`);
    }
    
    return graph;
  }

  /**
   * Calculate the number of reachable tracts from a given tract using BFS
   * This represents the size of the connected component containing the tract
   * @param {string} tractId - Tract ID to start from
   * @param {Array} groupTracts - All tracts in the group
   * @param {Map<string, string[]>} adjacencyGraph - Adjacency graph for all tracts
   * @returns {number} - Number of reachable tracts (including the tract itself)
   */
  calculateReachableTracts(tractId, groupTracts, adjacencyGraph) {
    const groupTractIds = new Set(groupTracts.map(t => getTractId(t)));
    
    // BFS traversal to find all reachable tracts
    const reachableTracts = new Set();
    const queue = [tractId];
    reachableTracts.add(tractId);
    
    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = adjacencyGraph.get(currentId) || [];
      
      for (const neighborId of neighbors) {
        // Only include neighbors that are in this group
        if (groupTractIds.has(neighborId) && !reachableTracts.has(neighborId)) {
          reachableTracts.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    
    return reachableTracts.size;
  }

  /**
   * Calculate the maximum reachable count for all tracts in a group
   * This represents the size of the main component
   * @param {Array} groupTracts - All tracts in the group
   * @param {Map<string, string[]>} adjacencyGraph - Adjacency graph for all tracts
   * @returns {number} - Maximum reachable count (main component size)
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
   * Fix isolated tracts across all groups after a division step
   * This checks each group for isolated tracts and moves them to adjacent groups to connect them
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {string} direction - Division direction ('latitude' or 'longitude')
   * @returns {Array} - Updated district groups with isolated tracts fixed
   */
  fixIsolatedTractsAcrossAllGroups(districtGroups, allTracts, direction) {
    if (process.env.DEBUG_CACHE === 'true') {
      console.log(`🔧 FIX ISOLATED TRACTS ACROSS ALL GROUPS: Checking ${districtGroups.length} groups for isolated tracts`);
    }
    
    if (districtGroups.length < 2) {
      // Need at least 2 groups to move tracts between them
      return districtGroups;
    }
    
    // Build adjacency graph for all tracts
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    
    // Create a copy of groups to modify
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    let totalMoved = 0;
    
    // Collect ALL unique tracts from all groups to ensure every tract is processed exactly once
    // This prevents issues when tracts are moved between groups during processing
    const allTractsMap = new Map(); // Map<tractId, tract>
    const tractToGroupIndex = new Map(); // Map<tractId, currentGroupIndex>
    
    // Build initial map of all tracts and their current group assignments
    for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
      const group = updatedGroups[groupIndex];
      for (const tract of group.censusTracts) {
        const tractId = getTractId(tract);
        allTractsMap.set(tractId, tract);
        tractToGroupIndex.set(tractId, groupIndex);
      }
    }
    
    // Process each tract exactly once
    for (const [tractId, tract] of allTractsMap.entries()) {
      // Find which group this tract currently belongs to (may have changed due to previous moves)
      let currentGroupIndex = tractToGroupIndex.get(tractId);
      if (currentGroupIndex === undefined) {
        // Tract not found in any group - find it
        for (let i = 0; i < updatedGroups.length; i++) {
          if (updatedGroups[i].censusTracts.some(t => getTractId(t) === tractId)) {
            currentGroupIndex = i;
            tractToGroupIndex.set(tractId, i);
            break;
          }
        }
      }
      
      // If tract not found in any group, skip it (shouldn't happen, but be safe)
      if (currentGroupIndex === undefined) {
        console.warn(`⚠️ Tract ${tractId} not found in any group during isolation check`);
        continue;
      }
      
      const group = updatedGroups[currentGroupIndex];
      
      // Verify tract is actually in this group's censusTracts array
      const tractInGroup = group.censusTracts.some(t => getTractId(t) === tractId);
      if (!tractInGroup) {
        // Tract was moved - update our tracking and continue
        for (let i = 0; i < updatedGroups.length; i++) {
          if (updatedGroups[i].censusTracts.some(t => getTractId(t) === tractId)) {
            tractToGroupIndex.set(tractId, i);
            currentGroupIndex = i;
            break;
          }
        }
        // If still not found, skip
        if (!updatedGroups[currentGroupIndex]?.censusTracts.some(t => getTractId(t) === tractId)) {
          continue;
        }
      }
      
      // Re-get group in case it changed
      const currentGroup = updatedGroups[currentGroupIndex];
      
      // Calculate max reachable count for this group (main component size)
      const maxReachableCount = this.calculateMaxReachableCount(currentGroup.censusTracts, adjacencyGraph);
      
      const reachableCount = this.calculateReachableTracts(tractId, currentGroup.censusTracts, adjacencyGraph);
        
      // Tract is isolated if its reachable count is less than the max reachable count
      if (reachableCount < maxReachableCount) {
        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`🔍 Found isolated tract ${tractId} in group ${currentGroup.startDistrictNumber}-${currentGroup.endDistrictNumber}: reachable count ${reachableCount} < max ${maxReachableCount}`);
        }
        
        // Find neighbors of this tract
        const neighbors = adjacencyGraph.get(tractId) || [];
        
        // Check which groups these neighbors belong to
        const neighborGroups = new Map(); // Map<groupIndex, neighborCount>
        
        for (const neighborId of neighbors) {
          // Find which group this neighbor belongs to
          for (let otherGroupIndex = 0; otherGroupIndex < updatedGroups.length; otherGroupIndex++) {
            const otherGroup = updatedGroups[otherGroupIndex];
            if (otherGroup.censusTracts.some(t => getTractId(t) === neighborId)) {
              neighborGroups.set(otherGroupIndex, (neighborGroups.get(otherGroupIndex) || 0) + 1);
              break;
            }
          }
        }
        
        // Find the best group to move this tract to
        // Prefer groups where the tract would connect to the main component
        let bestGroupIndex = -1;
        let bestReachableCount = 0;
        
        for (const [otherGroupIndex, neighborCount] of neighborGroups.entries()) {
          if (otherGroupIndex === currentGroupIndex) continue; // Don't move to same group
          
          const otherGroup = updatedGroups[otherGroupIndex];
          const otherGroupTracts = [...otherGroup.censusTracts, tract];
          
          // Calculate what the reachable count would be if we moved this tract
          const potentialReachableCount = this.calculateReachableTracts(tractId, otherGroupTracts, adjacencyGraph);
          const otherGroupMaxReachableCount = this.calculateMaxReachableCount(otherGroupTracts, adjacencyGraph);
          
          // If moving to this group would connect the tract to the main component, it's a good candidate
          if (potentialReachableCount >= otherGroupMaxReachableCount && potentialReachableCount > bestReachableCount) {
            bestGroupIndex = otherGroupIndex;
            bestReachableCount = potentialReachableCount;
          }
        }
        
        // If we found a good group to move to, move the tract
        if (bestGroupIndex !== -1) {
          const sourceGroup = updatedGroups[currentGroupIndex];
          const targetGroup = updatedGroups[bestGroupIndex];
          
          // Remove from source group
          const tractIndex = sourceGroup.censusTracts.findIndex(t => getTractId(t) === tractId);
          if (tractIndex !== -1) {
            const tractPopulation = tract.properties?.POPULATION || 0;
            sourceGroup.censusTracts.splice(tractIndex, 1);
            
            // Update source group population and bounds
            sourceGroup.totalPopulation = sourceGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
            sourceGroup.bounds = calculateBounds(sourceGroup.censusTracts);
            sourceGroup.centroid = calculateCentroid(sourceGroup.censusTracts);
            
            // Add to target group
            targetGroup.censusTracts.push(tract);
            
            // Update target group population and bounds
            targetGroup.totalPopulation = targetGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
            targetGroup.bounds = calculateBounds(targetGroup.censusTracts);
            targetGroup.centroid = calculateCentroid(targetGroup.censusTracts);
            
            // Update tracking
            tractToGroupIndex.set(tractId, bestGroupIndex);
            
            totalMoved++;
            console.log(`🔄 Moved isolated tract ${tractId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} (reachable count: ${bestReachableCount})`);
          }
        } else {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`⚠️ Could not find a suitable group to move isolated tract ${tractId} to`);
          }
        }
      }
    }
    
    if (totalMoved > 0) {
      console.log(`✅ Fixed ${totalMoved} isolated tract(s) across all groups`);
    } else if (process.env.DEBUG_CACHE === 'true') {
      console.log(`✅ No isolated tracts found across all groups`);
    }
    
    return updatedGroups;
  }

  /**
   * Execute the geodistrict algorithm
   * @param {Array} tracts - Array of GeoJSON tract features
   * @param {number} totalDistricts - Total number of districts to create
   * @param {number} maxIterations - Maximum iterations
   * @param {boolean} forceInvalidate - Force recalculation
   * @returns {Promise<Object>} GeodistrictResult
   */
  async executeGeodistrictAlgorithm(tracts, totalDistricts, maxIterations, forceInvalidate = false) {
    // Preload S4 adjacency data if available
    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      try {
        await s4DataLoader.loadS4AdjacencyData(state);
        console.log(`✅ Preloaded S4 adjacency data for ${state} before algorithm execution`);
      } catch (error) {
        console.warn(`⚠️ Failed to preload S4 adjacency data for ${state}:`, error);
      }
    }

    // Deduplicate tracts array - merge duplicates (e.g., MultiPolygon parts)
    const uniqueTracts = deduplicateAndMergeTracts(tracts);

    // Calculate total state population from unique tracts
    const totalStatePopulation = uniqueTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    // Initialize with all unique tracts as a single district group
    const initialGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: uniqueTracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: calculateBounds(uniqueTracts),
      centroid: calculateCentroid(uniqueTracts)
    };

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Create initial step
    steps.push(createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude'));

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const newGroups = [];
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

      const divisionLines = [];
      let divisionLine = undefined;

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Calculate division ratio for this group
          const division = calculateOptimalDivision(group.totalDistricts);
          
          // Divide this group using latlong algorithm
          const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, forceInvalidate);
          
          if (!divisionResult) {
            throw new Error('Division result is undefined');
          }
          
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
          
          // Capture dividing line if available
          if (divisionResult.dividingLine !== undefined) {
            divisionLine = divisionResult.dividingLine;
            
            divisionLines.push({
              line: divisionResult.dividingLine,
              direction: direction,
              parentGroup: {
                startDistrictNumber: group.startDistrictNumber,
                endDistrictNumber: group.endDistrictNumber,
                totalDistricts: group.totalDistricts
              },
              ratio: division.ratio,
              intersectingTractIds: divisionResult.intersectingTractIds
            });
          }
        }
      }

      currentGroups = newGroups;
      
      // Quick validation: Total tract count should match input count
      const totalTractsAfterDivision = currentGroups.reduce((sum, group) => sum + group.censusTracts.length, 0);
      const expectedTractCount = uniqueTracts.length;
      if (totalTractsAfterDivision !== expectedTractCount) {
        console.error(`⚠️ DIVISION COUNT MISMATCH: Expected ${expectedTractCount} tracts, found ${totalTractsAfterDivision} after division step ${iteration} (difference: ${totalTractsAfterDivision - expectedTractCount})`);
        if (totalTractsAfterDivision < expectedTractCount) {
          console.error(`   → Missing ${expectedTractCount - totalTractsAfterDivision} tract(s) - orphaned tracts detected!`);
        } else {
          console.error(`   → Extra ${totalTractsAfterDivision - expectedTractCount} tract(s) - duplicate tracts detected!`);
        }
      }
      
      // Validate immediately after division (before fixing isolated tracts)
      // This will catch if division itself is creating duplicates
      const postDivisionTractToGroups = new Map(); // Map<tractId, [groupIndex, ...]>
      for (let groupIndex = 0; groupIndex < currentGroups.length; groupIndex++) {
        const group = currentGroups[groupIndex];
        for (const tract of group.censusTracts) {
          const tractId = getTractId(tract);
          if (!postDivisionTractToGroups.has(tractId)) {
            postDivisionTractToGroups.set(tractId, []);
          }
          postDivisionTractToGroups.get(tractId).push(groupIndex);
        }
      }
      
      // Check for duplicates created during division
      let divisionDuplicates = 0;
      for (const [tractId, groupIndices] of postDivisionTractToGroups.entries()) {
        if (groupIndices.length > 1) {
          divisionDuplicates++;
          if (divisionDuplicates <= 5) { // Log first 5 only
            console.error(`⚠️ DIVISION BUG: Tract ${tractId} assigned to ${groupIndices.length} groups during division step ${iteration}!`);
          }
        }
      }
      if (divisionDuplicates > 0) {
        console.error(`⚠️ DIVISION BUG: ${divisionDuplicates} tracts assigned to multiple groups during division step ${iteration}`);
      }
      
      // Fix isolated tracts after division (use uniqueTracts to ensure no duplicates in adjacency graph)
      currentGroups = this.fixIsolatedTractsAcrossAllGroups(currentGroups, uniqueTracts, direction);
      
      // Validate: Ensure all tracts are assigned to exactly one group
      // First pass: identify duplicates
      const tractToGroups = new Map(); // Map<tractId, [groupIndex, ...]>
      for (let groupIndex = 0; groupIndex < currentGroups.length; groupIndex++) {
        const group = currentGroups[groupIndex];
        for (const tract of group.censusTracts) {
          const tractId = getTractId(tract);
          if (!tractToGroups.has(tractId)) {
            tractToGroups.set(tractId, []);
          }
          tractToGroups.get(tractId).push(groupIndex);
        }
      }
      
      // Remove duplicates: keep tract in the first group it appears in, remove from others
      let duplicatesFixed = 0;
      for (const [tractId, groupIndices] of tractToGroups.entries()) {
        if (groupIndices.length > 1) {
          console.error(`⚠️ ERROR: Tract ${tractId} is assigned to ${groupIndices.length} groups! Fixing by keeping in first group only.`);
          
          // Keep in first group, remove from all others
          for (let i = 1; i < groupIndices.length; i++) {
            const groupIndex = groupIndices[i];
            const group = currentGroups[groupIndex];
            const tractIndex = group.censusTracts.findIndex(t => getTractId(t) === tractId);
            
            if (tractIndex !== -1) {
              const tract = group.censusTracts[tractIndex];
              const tractPopulation = tract.properties?.POPULATION || 0;
              
              // Remove from this group
              group.censusTracts.splice(tractIndex, 1);
              
              // Update group population and bounds
              group.totalPopulation = group.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
              group.bounds = calculateBounds(group.censusTracts);
              group.centroid = calculateCentroid(group.censusTracts);
              
              duplicatesFixed++;
            }
          }
        }
      }
      
      if (duplicatesFixed > 0) {
        console.log(`✅ Fixed ${duplicatesFixed} duplicate tract assignment(s)`);
      }
      
      // Rebuild assignedTractIds set for missing tract check
      const assignedTractIds = new Set();
      for (const group of currentGroups) {
        for (const tract of group.censusTracts) {
          const tractId = getTractId(tract);
          assignedTractIds.add(tractId);
        }
      }
      
      // Check for missing tracts
      const allTractIds = new Set(tracts.map(t => getTractId(t)));
      const missingTracts = [];
      for (const tractId of allTractIds) {
        if (!assignedTractIds.has(tractId)) {
          missingTracts.push(tractId);
        }
      }
      
      if (missingTracts.length > 0) {
        console.error(`⚠️ ERROR: ${missingTracts.length} tract(s) not assigned to any group after division step ${iteration}`);
        
        // Assign missing tracts to the nearest group based on centroid
        for (const missingTractId of missingTracts) {
          const missingTract = tracts.find(t => getTractId(t) === missingTractId);
          if (missingTract) {
            const tractCentroid = calculateTractCentroid(missingTract);
            let nearestGroup = null;
            let minDistance = Infinity;
            
            for (const group of currentGroups) {
              const groupCentroid = group.centroid;
              const distance = Math.sqrt(
                Math.pow(tractCentroid.lat - groupCentroid.lat, 2) +
                Math.pow(tractCentroid.lng - groupCentroid.lng, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                nearestGroup = group;
              }
            }
            
            if (nearestGroup) {
              nearestGroup.censusTracts.push(missingTract);
              nearestGroup.totalPopulation += missingTract.properties?.POPULATION || 0;
              nearestGroup.bounds = calculateBounds(nearestGroup.censusTracts);
              nearestGroup.centroid = calculateCentroid(nearestGroup.censusTracts);
              console.log(`🔧 Fixed: Assigned missing tract ${missingTractId} to group ${nearestGroup.startDistrictNumber}-${nearestGroup.endDistrictNumber}`);
            }
          }
        }
      }
      
      steps.push(createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${direction}`, direction, divisionLine, divisionLines));
    }

    if (iteration >= maxIterations) {
      algorithmHistory.push(`Algorithm stopped: Maximum iterations (${maxIterations}) reached`);
    } else {
      algorithmHistory.push(`Algorithm completed: ${currentGroups.length} districts created in ${iteration} iterations`);
    }

    // Final validation: Check for orphaned/missing tracts and duplicates
    const assignedTractIds = new Set();
    const tractToGroups = new Map(); // Map<tractId, [groupIndex, ...]>
    
    for (let groupIndex = 0; groupIndex < currentGroups.length; groupIndex++) {
      const group = currentGroups[groupIndex];
      for (const tract of group.censusTracts) {
        const tractId = getTractId(tract);
        assignedTractIds.add(tractId);
        if (!tractToGroups.has(tractId)) {
          tractToGroups.set(tractId, []);
        }
        tractToGroups.get(tractId).push(groupIndex);
      }
    }
    
    // Check for duplicates
    let finalDuplicatesFixed = 0;
    for (const [tractId, groupIndices] of tractToGroups.entries()) {
      if (groupIndices.length > 1) {
        console.error(`⚠️ FINAL VALIDATION ERROR: Tract ${tractId} is assigned to ${groupIndices.length} groups! Fixing by keeping in first group only.`);
        
        // Keep in first group, remove from all others
        for (let i = 1; i < groupIndices.length; i++) {
          const groupIndex = groupIndices[i];
          const group = currentGroups[groupIndex];
          const tractIndex = group.censusTracts.findIndex(t => getTractId(t) === tractId);
          
          if (tractIndex !== -1) {
            const tract = group.censusTracts[tractIndex];
            const tractPopulation = tract.properties?.POPULATION || 0;
            
            // Remove from this group
            group.censusTracts.splice(tractIndex, 1);
            
            // Update group population and bounds
            group.totalPopulation = group.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
            group.bounds = calculateBounds(group.censusTracts);
            group.centroid = calculateCentroid(group.censusTracts);
            
            finalDuplicatesFixed++;
          }
        }
      }
    }
    
    if (finalDuplicatesFixed > 0) {
      console.log(`✅ Final validation: Fixed ${finalDuplicatesFixed} duplicate tract assignment(s)`);
      algorithmHistory.push(`Final validation: Fixed ${finalDuplicatesFixed} duplicate tract assignment(s)`);
    }
    
    // Check for missing/orphaned tracts
    const allTractIds = new Set(uniqueTracts.map(t => getTractId(t)));
    const missingTracts = [];
    for (const tractId of allTractIds) {
      if (!assignedTractIds.has(tractId)) {
        missingTracts.push(tractId);
      }
    }
    
    if (missingTracts.length > 0) {
      console.error(`⚠️ FINAL VALIDATION ERROR: ${missingTracts.length} tract(s) not assigned to any group!`);
      
      // Assign missing tracts to the nearest group based on centroid
      for (const missingTractId of missingTracts) {
        const missingTract = uniqueTracts.find(t => getTractId(t) === missingTractId);
        if (missingTract) {
          const tractCentroid = calculateTractCentroid(missingTract);
          let nearestGroup = null;
          let minDistance = Infinity;
          
          for (const group of currentGroups) {
            const groupCentroid = group.centroid;
            const distance = Math.sqrt(
              Math.pow(tractCentroid.lat - groupCentroid.lat, 2) +
              Math.pow(tractCentroid.lng - groupCentroid.lng, 2)
            );
            if (distance < minDistance) {
              minDistance = distance;
              nearestGroup = group;
            }
          }
          
          if (nearestGroup) {
            nearestGroup.censusTracts.push(missingTract);
            nearestGroup.totalPopulation += missingTract.properties?.POPULATION || 0;
            nearestGroup.bounds = calculateBounds(nearestGroup.censusTracts);
            nearestGroup.centroid = calculateCentroid(nearestGroup.censusTracts);
            console.log(`🔧 Final fix: Assigned orphaned tract ${missingTractId} to group ${nearestGroup.startDistrictNumber}-${nearestGroup.endDistrictNumber}`);
            algorithmHistory.push(`Final fix: Assigned orphaned tract ${missingTractId} to district ${nearestGroup.startDistrictNumber}`);
          }
        }
      }
      
      if (missingTracts.length > 0) {
        algorithmHistory.push(`Final validation: Fixed ${missingTracts.length} orphaned tract(s) by assigning to nearest district`);
      }
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
   * Execute algorithm step-by-step (for SSE streaming)
   * @param {Array} tracts - Array of GeoJSON tract features
   * @param {number} totalDistricts - Total number of districts
   * @param {number} maxIterations - Maximum iterations
   * @param {Function} onStep - Callback for each step
   * @returns {Promise<Object>} Final result
   */
  async *executeGeodistrictAlgorithmStepByStep(tracts, totalDistricts, maxIterations, onStep) {
    // Similar to executeGeodistrictAlgorithm but yields steps as they're created
    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      try {
        await s4DataLoader.loadS4AdjacencyData(state);
      } catch (error) {
        console.warn(`⚠️ Failed to preload S4 adjacency data:`, error);
      }
    }

    // Deduplicate tracts array - merge duplicates (e.g., MultiPolygon parts)
    const uniqueTracts = deduplicateAndMergeTracts(tracts);

    const totalStatePopulation = uniqueTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    const initialGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: uniqueTracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: calculateBounds(uniqueTracts),
      centroid: calculateCentroid(uniqueTracts)
    };

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Yield initial step
    const initialStep = createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude');
    steps.push(initialStep);
    yield { step: 0, data: initialStep, isComplete: false };

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';
      const newGroups = [];
      const divisionLines = [];

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          newGroups.push(group);
        } else {
          const division = calculateOptimalDivision(group.totalDistricts);
          const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, false);
          
          if (divisionResult) {
            newGroups.push(...divisionResult.groups);
            algorithmHistory.push(...divisionResult.history);
            
            if (divisionResult.dividingLine !== undefined) {
              divisionLines.push({
                line: divisionResult.dividingLine,
                direction: direction,
                parentGroup: {
                  startDistrictNumber: group.startDistrictNumber,
                  endDistrictNumber: group.endDistrictNumber,
                  totalDistricts: group.totalDistricts
                },
                ratio: division.ratio,
                intersectingTractIds: divisionResult.intersectingTractIds
              });
            }
          }
        }
      }

      currentGroups = newGroups;
      
      // Quick validation: Total tract count should match input count
      const totalTractsAfterDivision = currentGroups.reduce((sum, group) => sum + group.censusTracts.length, 0);
      const expectedTractCount = uniqueTracts.length;
      if (totalTractsAfterDivision !== expectedTractCount) {
        console.error(`⚠️ DIVISION COUNT MISMATCH: Expected ${expectedTractCount} tracts, found ${totalTractsAfterDivision} after division step ${iteration} (difference: ${totalTractsAfterDivision - expectedTractCount})`);
        if (totalTractsAfterDivision < expectedTractCount) {
          console.error(`   → Missing ${expectedTractCount - totalTractsAfterDivision} tract(s) - orphaned tracts detected!`);
        } else {
          console.error(`   → Extra ${totalTractsAfterDivision - expectedTractCount} tract(s) - duplicate tracts detected!`);
        }
      }
      
      // Fix isolated tracts after division (use uniqueTracts to ensure no duplicates in adjacency graph)
      currentGroups = this.fixIsolatedTractsAcrossAllGroups(currentGroups, uniqueTracts, direction);
      
      const step = createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${direction}`, direction, undefined, divisionLines);
      steps.push(step);
      
      yield { step: iteration, data: step, isComplete: false };
    }

    // Final validation: Check for orphaned/missing tracts and duplicates
    const assignedTractIds = new Set();
    const tractToGroups = new Map(); // Map<tractId, [groupIndex, ...]>
    
    for (let groupIndex = 0; groupIndex < currentGroups.length; groupIndex++) {
      const group = currentGroups[groupIndex];
      for (const tract of group.censusTracts) {
        const tractId = getTractId(tract);
        assignedTractIds.add(tractId);
        if (!tractToGroups.has(tractId)) {
          tractToGroups.set(tractId, []);
        }
        tractToGroups.get(tractId).push(groupIndex);
      }
    }
    
    // Check for duplicates
    let finalDuplicatesFixed = 0;
    for (const [tractId, groupIndices] of tractToGroups.entries()) {
      if (groupIndices.length > 1) {
        console.error(`⚠️ FINAL VALIDATION ERROR: Tract ${tractId} is assigned to ${groupIndices.length} groups! Fixing by keeping in first group only.`);
        
        // Keep in first group, remove from all others
        for (let i = 1; i < groupIndices.length; i++) {
          const groupIndex = groupIndices[i];
          const group = currentGroups[groupIndex];
          const tractIndex = group.censusTracts.findIndex(t => getTractId(t) === tractId);
          
          if (tractIndex !== -1) {
            const tract = group.censusTracts[tractIndex];
            
            // Remove from this group
            group.censusTracts.splice(tractIndex, 1);
            
            // Update group population and bounds
            group.totalPopulation = group.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
            group.bounds = calculateBounds(group.censusTracts);
            group.centroid = calculateCentroid(group.censusTracts);
            
            finalDuplicatesFixed++;
          }
        }
      }
    }
    
    if (finalDuplicatesFixed > 0) {
      console.log(`✅ Final validation: Fixed ${finalDuplicatesFixed} duplicate tract assignment(s)`);
      algorithmHistory.push(`Final validation: Fixed ${finalDuplicatesFixed} duplicate tract assignment(s)`);
    }
    
    // Check for missing/orphaned tracts
    const allTractIds = new Set(uniqueTracts.map(t => getTractId(t)));
    const missingTracts = [];
    for (const tractId of allTractIds) {
      if (!assignedTractIds.has(tractId)) {
        missingTracts.push(tractId);
      }
    }
    
    if (missingTracts.length > 0) {
      console.error(`⚠️ FINAL VALIDATION ERROR: ${missingTracts.length} tract(s) not assigned to any group!`);
      
      // Assign missing tracts to the nearest group based on centroid
      for (const missingTractId of missingTracts) {
        const missingTract = uniqueTracts.find(t => getTractId(t) === missingTractId);
        if (missingTract) {
          const tractCentroid = calculateTractCentroid(missingTract);
          let nearestGroup = null;
          let minDistance = Infinity;
          
          for (const group of currentGroups) {
            const groupCentroid = group.centroid;
            const distance = Math.sqrt(
              Math.pow(tractCentroid.lat - groupCentroid.lat, 2) +
              Math.pow(tractCentroid.lng - groupCentroid.lng, 2)
            );
            if (distance < minDistance) {
              minDistance = distance;
              nearestGroup = group;
            }
          }
          
          if (nearestGroup) {
            nearestGroup.censusTracts.push(missingTract);
            nearestGroup.totalPopulation += missingTract.properties?.POPULATION || 0;
            nearestGroup.bounds = calculateBounds(nearestGroup.censusTracts);
            nearestGroup.centroid = calculateCentroid(nearestGroup.censusTracts);
            console.log(`🔧 Final fix: Assigned orphaned tract ${missingTractId} to group ${nearestGroup.startDistrictNumber}-${nearestGroup.endDistrictNumber}`);
            algorithmHistory.push(`Final fix: Assigned orphaned tract ${missingTractId} to district ${nearestGroup.startDistrictNumber}`);
          }
        }
      }
      
      if (missingTracts.length > 0) {
        algorithmHistory.push(`Final validation: Fixed ${missingTracts.length} orphaned tract(s) by assigning to nearest district`);
      }
    }

    // Calculate final statistics
    const finalDistricts = currentGroups;
    const averagePopulation = totalStatePopulation / finalDistricts.length;
    const populationVariance = finalDistricts.reduce((sum, district) =>
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / finalDistricts.length;

    const result = {
      finalDistricts,
      steps,
      totalPopulation: totalStatePopulation,
      averagePopulation,
      populationVariance,
      algorithmHistory
    };

    yield { step: iteration, data: result, isComplete: true };
  }
}

module.exports = {
  GeodistrictAlgorithmService,
  getDistrictsForState,
  getTractId,
  calculateBounds,
  calculateCentroid,
  calculateTractCentroid,
  calculateOptimalDivision,
  createStep,
  ALGORITHM_VERSION
};

