const s4DataLoader = require('./s4-data-loader');
const turf = require('@turf/turf');

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
 * 20251119-0530: Optimized division algorithm - replaced iterative/binary search with fast linear scan of sorted tracts (O(n log n) instead of O(n * iterations))
 * 20251119-0600: Fixed algorithm state initialization from cache - added missing fields (algorithmHistory, steps, totalStatePopulation, targetDistrictPopulation, state) and added detailed timing logs for performance analysis
 * 20251119-0700: Optimized isolation checking - only check overlapping tracts after division, added enclosed tract detection and handling
 * 20251119-0800: Fixed ID format consistency - unified getTractId usage across all normalization/reconstruction code, added state tract cache storage during step 0 initialization
 * 20251119-1900: Added union polygon creation for district groups on backend
 * 20251119-2000: Optimized isolation check - simplified to check first tract per group, find adjacent tract in other group causing isolation and move it
 * 20251119-2100: Enhanced isolation fix - if no bridge found, move isolated tracts themselves; after moving tracts, balance population by moving adjacent tracts back to preserve division ratio
 * 20251119-2200: Fixed enclosed tract handling - moved enclosed tract handling to occur BEFORE isolation checking to ensure enclosed tracts are with their enclosing tracts
 * 20251119-2300: Added TRACT_GROUP_ID metadata during step 0 - enclosed and enclosing tracts are assigned the same group ID and always move together during division and isolation fixes
 * 20251119-2400: Fixed tract ID format consistency - use getTractId consistently for TRACT_GROUP_ID assignment and division logic; improved tract group movement logic to prefer enclosing tract's group
 * 20251121-0000: Fixed isolation check - added iteration loop to re-check all groups until no isolation issues remain; improved isolation detection to use max reachable count (main component) instead of first tract; ensures isolated tracts from earlier steps are properly detected and fixed
 * 20251122-0000: Fixed bridge tract selection - prevent moving tracts that are in main component of source group or have all neighbors in source group; prevents incorrectly moving embedded tracts (like 940013) that are isolated in one district to another district
 */
const ALGORITHM_VERSION = '20251122-0000';

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
 * Point-in-polygon test using ray casting algorithm
 * @param {number[]} point - Point to test [lng, lat]
 * @param {number[][]} polygon - Array of polygon vertices [lng, lat]
 * @returns {boolean} True if point is inside polygon
 */
function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Get outer ring of a GeoJSON feature
 * @param {Object} feature - GeoJSON feature
 * @returns {number[][]} Array of coordinates [lng, lat]
 */
function getOuterRing(feature) {
  if (!feature.geometry) return [];
  
  if (feature.geometry.type === 'Polygon') {
    // First ring is the outer boundary
    if (feature.geometry.coordinates && feature.geometry.coordinates[0]) {
      return feature.geometry.coordinates[0];
    }
  } else if (feature.geometry.type === 'MultiPolygon') {
    // First ring of first polygon is the outer boundary
    if (feature.geometry.coordinates && feature.geometry.coordinates[0] && feature.geometry.coordinates[0][0]) {
      return feature.geometry.coordinates[0][0];
    }
  }
  
  return [];
}

/**
 * Check if tract A is completely contained within tract B using point-in-polygon
 * @param {Object} tractA - Potentially enclosed tract
 * @param {Object} tractB - Potentially enclosing tract
 * @returns {boolean} True if tractA is enclosed by tractB
 */
function isTractContainedIn(tractA, tractB) {
  if (!tractA.geometry || !tractB.geometry) return false;

  const idA = getTractId(tractA);
  const idB = getTractId(tractB);
  if (!idA || !idB) return false;

  // Get outer rings
  const outerRingA = getOuterRing(tractA);
  const outerRingB = getOuterRing(tractB);
  
  if (outerRingA.length < 3 || outerRingB.length < 3) return false;

  // Quick bounding box check first
  const boundsA = getTractBounds(tractA);
  const boundsB = getTractBounds(tractB);
  
  if (boundsA.minLat < boundsB.minLat || boundsA.maxLat > boundsB.maxLat ||
      boundsA.minLng < boundsB.minLng || boundsA.maxLng > boundsB.maxLng) {
    // Bounding box check fails - can't be contained
    return false;
  }

  // Sample points from tract A's outer ring (not all points - too many)
  const sampleSize = Math.min(outerRingA.length, 50); // Sample up to 50 points
  const step = Math.max(1, Math.floor(outerRingA.length / sampleSize));
  const samplePoints = [];
  
  for (let i = 0; i < outerRingA.length; i += step) {
    samplePoints.push(outerRingA[i]);
  }
  
  // Also include the centroid as a sample point
  const centroidA = calculateTractCentroid(tractA);
  samplePoints.push([centroidA.lng, centroidA.lat]);

  // Check if all sampled points are inside tract B's outer ring
  for (const point of samplePoints) {
    if (!isPointInPolygon(point, outerRingB)) {
      return false; // At least one point is outside
    }
  }

  return true; // All sampled points are inside
}

/**
 * Detect enclosed tracts (tracts entirely within another tract)
 * Uses S4 adjacency data to narrow down candidates: if a tract has only one neighbor,
 * it's likely enclosed by that neighbor. Then verifies with point-in-polygon.
 * @param {Array} tracts - Array of GeoJSON tract features
 * @returns {Map<string, string>} - Map of enclosed tract ID -> enclosing tract ID
 */
function detectEnclosedTracts(tracts) {
  console.log(`🔍 DETECTING ENCLOSED TRACTS: Checking ${tracts.length} tracts for enclosure relationships...`);
  const startTime = Date.now();
  const enclosedMap = new Map(); // Map<enclosedTractId, enclosingTractId>
  
  if (tracts.length === 0) {
    return enclosedMap;
  }
  
  // Get S4 adjacency data for the state
  const state = tracts[0]?.properties?.['STATE'] || '';
  if (!state) {
    console.warn(`⚠️ DETECTING ENCLOSED TRACTS: No state found in tracts, skipping`);
    return enclosedMap;
  }
  
  const cacheKey = state.toLowerCase();
  const s4AdjacencyGraph = s4DataLoader.getS4AdjacencyData(cacheKey);
  
  if (!s4AdjacencyGraph) {
    console.warn(`⚠️ DETECTING ENCLOSED TRACTS: No S4 adjacency data available for ${state}, skipping`);
    return enclosedMap;
  }
  
  // Build tract lookup by ID
  const tractMap = new Map();
  for (const tract of tracts) {
    const tractId = getTractId(tract);
    if (tractId) {
      tractMap.set(tractId, tract);
    }
  }
  
  // Find tracts with only one neighbor (candidates for being enclosed)
  const candidates = [];
  for (const tract of tracts) {
    const tractId = getTractId(tract);
    if (!tractId || !tract.geometry) continue;
    
    const neighbors = s4AdjacencyGraph.get(tractId) || [];
    // Filter to only neighbors that exist in our tract set
    const validNeighbors = neighbors.filter(nId => tractMap.has(nId));
    
    // Debug logging for specific tracts
    if (tractId.includes('001700') || tractId.includes('002302')) {
      console.log(`🔍 DETECTING ENCLOSED TRACTS: Tract ${tractId} has ${validNeighbors.length} valid neighbor(s): ${validNeighbors.join(', ')}`);
    }
    
    // If tract has exactly one neighbor, it's a candidate for being enclosed
    if (validNeighbors.length === 1) {
      candidates.push({
        tract,
        tractId,
        enclosingTractId: validNeighbors[0]
      });
      if (tractId.includes('001700') || validNeighbors[0].includes('002302')) {
        console.log(`🔍 DETECTING ENCLOSED TRACTS: Tract ${tractId} is a candidate (single neighbor: ${validNeighbors[0]})`);
      }
    }
  }
  
  console.log(`🔍 DETECTING ENCLOSED TRACTS: Found ${candidates.length} candidate tracts with single neighbor`);
  
    // Verify candidates with point-in-polygon
    let verifiedCount = 0;
    for (const candidate of candidates) {
      const enclosingTract = tractMap.get(candidate.enclosingTractId);
      if (!enclosingTract || !enclosingTract.geometry) continue;
      
      // Verify with point-in-polygon
      if (isTractContainedIn(candidate.tract, enclosingTract)) {
        enclosedMap.set(candidate.tractId, candidate.enclosingTractId);
        verifiedCount++;
        if (candidate.tractId.includes('001700') || candidate.enclosingTractId.includes('002302')) {
          console.log(`✅ Verified enclosed tract: ${candidate.tractId} is enclosed by ${candidate.enclosingTractId}`);
        }
      }
    }
  
  const endTime = Date.now();
  console.log(`✅ DETECTED ENCLOSED TRACTS: Found ${verifiedCount} enclosed tracts (from ${candidates.length} candidates) in ${endTime - startTime}ms`);
  
  return enclosedMap;
}

/**
 * Get tract bounds helper (reuses latlong-division service logic)
 */
function getTractBounds(tract) {
  // Use pre-calculated bounds if available
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
  
  // Calculate from geometry
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
 * Create a union polygon from all tracts in a district group
 * @param {Object} group - District group containing tracts
 * @returns {Object|null} GeoJSON feature representing the union polygon, or null if union fails
 */
function createUnionPolygon(group) {
  if (!group.censusTracts || group.censusTracts.length === 0) {
    return null;
  }

  try {
    // Collect all valid tract geometries
    const validTracts = [];
    for (const tract of group.censusTracts) {
      if (tract && tract.geometry) {
        validTracts.push(tract);
      }
    }

    if (validTracts.length === 0) {
      return null;
    }

    // If only one tract, return it as-is
    if (validTracts.length === 1) {
      return validTracts[0];
    }

    // For very large groups (>500 tracts), use dissolve which is more efficient
    if (validTracts.length > 500) {
      console.log(`🔨 Creating union polygon for large group ${group.startDistrictNumber}-${group.endDistrictNumber} (${validTracts.length} tracts) using dissolve`);
      try {
        const collection = turf.featureCollection(validTracts);
        const dissolved = turf.dissolve(collection);
        if (dissolved && dissolved.features && dissolved.features.length > 0) {
          // Use the first (and usually only) feature from dissolved result
          const unionFeature = {
            type: 'Feature',
            geometry: dissolved.features[0].geometry,
            properties: {
              ...group.censusTracts[0].properties,
              DISTRICT_START: group.startDistrictNumber,
              DISTRICT_END: group.endDistrictNumber,
              TOTAL_POPULATION: group.totalPopulation,
              TRACT_COUNT: group.censusTracts.length
            }
          };
          console.log(`✅ Created union polygon using dissolve for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
          return unionFeature;
        }
      } catch (dissolveError) {
        console.warn(`⚠️ Dissolve failed for group ${group.startDistrictNumber}-${group.endDistrictNumber}, falling back to sequential union:`, dissolveError.message);
      }
    }

    // Start with the first tract
    let union = turf.feature(validTracts[0].geometry);
    if (!union || !union.geometry) {
      console.warn(`⚠️ Invalid initial tract geometry for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }
    
    console.log(`🔨 Creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${validTracts.length} tracts)`);

    // Union all remaining tracts
    const batchSize = 100;
    let processedCount = 1;
    const startTime = Date.now();
    let skippedCount = 0;

    for (let i = 1; i < validTracts.length; i++) {
      // Validate union geometry before attempting union
      if (!union || !union.geometry) {
        console.warn(`⚠️ Union geometry invalid at tract ${i} in group ${group.startDistrictNumber}-${group.endDistrictNumber}, stopping union`);
        break;
      }
      
      const tractFeature = turf.feature(validTracts[i].geometry);
      
      // Validate tract geometry before unioning
      if (!tractFeature || !tractFeature.geometry) {
        skippedCount++;
        continue;
      }
      
      try {
        const unionResult = turf.union(union, tractFeature);
        if (!unionResult || !unionResult.geometry) {
          skippedCount++;
          continue; // Skip this tract but continue with others
        }
        union = unionResult;
        processedCount++;

        // Log progress for large unions (only on success to reduce verbosity)
        if (processedCount % batchSize === 0 || i === validTracts.length - 1) {
          const elapsed = Date.now() - startTime;
          console.log(`🔨 Union progress: ${processedCount}/${validTracts.length} tracts (${Math.round(processedCount / validTracts.length * 100)}%) - ${elapsed}ms`);
        }
      } catch (error) {
        // Suppress verbose "Must have at least 2 geometries" errors - these are common for invalid geometries
        // Only log other types of errors
        if (!error.message.includes('Must have at least 2 geometries')) {
          console.warn(`⚠️ Error unioning tract ${i} in group ${group.startDistrictNumber}-${group.endDistrictNumber}:`, error.message);
        }
        skippedCount++;
        // Skip this tract and continue with the next one
        continue;
      }
    }
    
    if (skippedCount > 0) {
      console.log(`⚠️ Skipped ${skippedCount} tract(s) during union for group ${group.startDistrictNumber}-${group.endDistrictNumber} due to invalid geometries`);
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Completed union of ${processedCount} tracts for group ${group.startDistrictNumber}-${group.endDistrictNumber} in ${totalTime}ms`);

    // Create a GeoJSON feature with the union geometry and group properties
    const unionFeature = {
      type: 'Feature',
      geometry: union.geometry,
      properties: {
        ...group.censusTracts[0].properties,
        DISTRICT_START: group.startDistrictNumber,
        DISTRICT_END: group.endDistrictNumber,
        TOTAL_POPULATION: group.totalPopulation,
        TRACT_COUNT: group.censusTracts.length
      }
    };

    return unionFeature;
  } catch (error) {
    console.error(`❌ Error creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber}:`, error.message);
    return null;
  }
}

/**
 * Create a step object with union polygons for each district group
 */
function createStep(step, level, districtGroups, description, divisionDirection, divisionLine, divisionLines) {
  // Create union polygons for each district group
  const groupsWithUnions = districtGroups.map(group => {
    const unionPolygon = createUnionPolygon(group);
    return {
      ...group,
      unionPolygon: unionPolygon || undefined // Use undefined instead of null for cleaner JSON
    };
  });

  return {
    step,
    level,
    districtGroups: groupsWithUnions,
    description,
    totalGroups: groupsWithUnions.length,
    totalDistricts: groupsWithUnions.reduce((sum, g) => sum + g.totalDistricts, 0),
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
    
    // Ensure algorithmHistory is initialized (might be undefined if state was reconstructed from cache)
    if (!algorithmHistory) {
      algorithmState.algorithmHistory = [];
    }

    for (const group of currentGroups) {
      if (group.totalDistricts === 1) {
        newGroups.push(group);
      } else {
        const division = calculateOptimalDivision(group.totalDistricts);
        const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, false);
        
        if (divisionResult) {
          newGroups.push(...divisionResult.groups);
          if (divisionResult.history && divisionResult.history.length > 0) {
            (algorithmHistory || algorithmState.algorithmHistory || []).push(...divisionResult.history);
          }
          
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
    const validationStartTime = Date.now();
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
    const validationTime = Date.now() - validationStartTime;
    if (validationTime > 10) {
      console.log(`⏱️ VALIDATION: Completed in ${validationTime}ms`);
    }
    
    // Fix isolated tracts after division (use uniqueTracts to ensure no duplicates in adjacency graph)
    // Pass the dividing line to optimize the check to only overlapping tracts
    const dividingLine = divisionLines.length > 0 ? divisionLines[0].line : undefined;
    const fixIsolatedStartTime = Date.now();
    console.log(`🔧 POST-DIVISION: Starting isolation check after step ${nextIteration}...`);
    updatedGroups = this.fixIsolatedTractsAcrossAllGroups(updatedGroups, uniqueTracts, direction, dividingLine);
    const fixIsolatedTime = Date.now() - fixIsolatedStartTime;
    console.log(`⏱️ POST-DIVISION: Fix isolated tracts took ${fixIsolatedTime}ms`);
    
    // Verify tract 940013 is not isolated after fix
    for (const group of updatedGroups) {
      const has940013 = group.censusTracts.some(t => getTractId(t).includes('940013'));
      if (has940013) {
        console.log(`✅ POST-DIVISION: Tract 940013 is in group ${group.startDistrictNumber}-${group.endDistrictNumber} after step ${nextIteration}`);
      }
    }
    
    const createStepStartTime = Date.now();
    const step = createStep(nextIteration, nextIteration, updatedGroups,
      `Division ${nextIteration} by ${direction}`, direction, undefined, divisionLines);
    const createStepTime = Date.now() - createStepStartTime;
    if (createStepTime > 10) {
      console.log(`⏱️ CREATE STEP: Completed in ${createStepTime}ms`);
    }
    
    const updateStateStartTime = Date.now();
    const updatedSteps = [...steps, step];
    const updatedState = {
      ...algorithmState,
      currentGroups: updatedGroups,
      iteration: nextIteration,
      steps: updatedSteps,
      algorithmHistory: [...algorithmHistory]
    };
    const updateStateTime = Date.now() - updateStateStartTime;
    if (updateStateTime > 10) {
      console.log(`⏱️ UPDATE STATE: Completed in ${updateStateTime}ms`);
    }

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
   * Optimized approach: Check each new group by picking the first tract and calculating reachable tracts.
   * If reachable < total, find the adjacent tract in the other group causing isolation and move it.
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {string} direction - Division direction ('latitude' or 'longitude')
   * @param {number} dividingLine - The dividing line coordinate (latitude or longitude)
   * @returns {Array} - Updated district groups with isolated tracts fixed
   */
  fixIsolatedTractsAcrossAllGroups(districtGroups, allTracts, direction, dividingLine) {
    console.log(`🔧 FIX ISOLATED: Starting isolation check for ${districtGroups.length} groups with ${allTracts.length} total tracts`);
    const fixStartTime = Date.now();
    
    if (districtGroups.length < 2) {
      // Need at least 2 groups to move tracts between them
      return districtGroups;
    }
    
    // Build adjacency graph for all tracts
    console.log(`🔧 FIX ISOLATED: Building adjacency graph...`);
    const graphStartTime = Date.now();
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    const graphEndTime = Date.now();
    console.log(`✅ FIX ISOLATED: Adjacency graph built in ${graphEndTime - graphStartTime}ms`);
    
    // Create a copy of groups to modify
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    let totalMoved = 0;
    
    // Helper function to get all tracts in a tract group
    const getTractGroupMembers = (tract) => {
      const groupId = tract.properties?.TRACT_GROUP_ID;
      if (!groupId) {
        return [tract]; // No group, return just this tract
      }
      
      // Find all tracts with the same TRACT_GROUP_ID
      const groupMembers = [];
      for (const group of updatedGroups) {
        for (const t of group.censusTracts) {
          if (t.properties?.TRACT_GROUP_ID === groupId) {
            groupMembers.push(t);
          }
        }
      }
      
      const tractId = getTractId(tract);
      if (tractId && (tractId.includes('001700') || tractId.includes('002302'))) {
        console.log(`🔗 TRACT GROUP: Tract ${tractId} has group ${groupId}, found ${groupMembers.length} member(s)`);
      }
      
      return groupMembers.length > 0 ? groupMembers : [tract];
    };
    
    // Helper function to move a tract (and its group members) between groups
    const moveTract = (tract, fromGroupIndex, toGroupIndex) => {
      const fromGroup = updatedGroups[fromGroupIndex];
      const toGroup = updatedGroups[toGroupIndex];
      const tractId = getTractId(tract);
      
      // Get all tracts in this tract's group
      const groupMembers = getTractGroupMembers(tract);
      let movedCount = 0;
      
      // Debug logging for specific tracts
      if (tractId && (tractId.includes('001700') || tractId.includes('002302'))) {
        console.log(`🔗 MOVE TRACT: Moving tract ${tractId} (group ${tract.properties?.TRACT_GROUP_ID || 'none'}) with ${groupMembers.length} member(s) from group ${fromGroup.startDistrictNumber}-${fromGroup.endDistrictNumber} to group ${toGroup.startDistrictNumber}-${toGroup.endDistrictNumber}`);
      }
      
      // Move all group members
      for (const groupMember of groupMembers) {
        const memberId = getTractId(groupMember);
        
        // Find which group this member is currently in (might have changed)
        let currentFromGroup = fromGroup;
        let currentFromIndex = fromGroupIndex;
        
        // Check if member is actually in the fromGroup
        const memberInFromGroup = fromGroup.censusTracts.some(t => getTractId(t) === memberId);
        if (!memberInFromGroup) {
          // Find which group the member is actually in
          for (let i = 0; i < updatedGroups.length; i++) {
            if (updatedGroups[i].censusTracts.some(t => getTractId(t) === memberId)) {
              currentFromGroup = updatedGroups[i];
              currentFromIndex = i;
              break;
            }
          }
        }
        
        // Remove from source group
        const tractIndex = currentFromGroup.censusTracts.findIndex(t => getTractId(t) === memberId);
        if (tractIndex === -1) continue; // Already moved or not found
        
        currentFromGroup.censusTracts.splice(tractIndex, 1);
        
        // Update source group population and bounds
        currentFromGroup.totalPopulation = currentFromGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
        currentFromGroup.bounds = calculateBounds(currentFromGroup.censusTracts);
        currentFromGroup.centroid = calculateCentroid(currentFromGroup.censusTracts);
        
        // Add to target group (avoid duplicates)
        if (!toGroup.censusTracts.some(t => getTractId(t) === memberId)) {
          toGroup.censusTracts.push(groupMember);
          movedCount++;
          if (memberId.includes('001700') || memberId.includes('002302')) {
            console.log(`🔗 MOVE TRACT: Moved tract ${memberId} (part of group ${groupMember.properties?.TRACT_GROUP_ID || 'none'})`);
          }
        }
      }
      
      // Update target group population and bounds
      toGroup.totalPopulation = toGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
      toGroup.bounds = calculateBounds(toGroup.censusTracts);
      toGroup.centroid = calculateCentroid(toGroup.censusTracts);
      
      return movedCount > 0;
    };
    
    // FIRST: Handle enclosed tracts and tract groups - ensure they stay together
    // This must happen BEFORE isolation checking
    console.log(`🔧 FIX ISOLATED: Checking for enclosed tracts and tract groups to move...`);
    
    // Build a map of tract groups to their member tracts
    const tractGroupMembers = new Map(); // Map<groupId, Set<tractIds>>
    for (const group of updatedGroups) {
      for (const tract of group.censusTracts) {
        const groupId = tract.properties?.TRACT_GROUP_ID;
        if (groupId) {
          if (!tractGroupMembers.has(groupId)) {
            tractGroupMembers.set(groupId, new Set());
          }
          tractGroupMembers.get(groupId).add(getTractId(tract));
        }
      }
    }
    
    // Check each tract group - if members are split across groups, move them together
    for (const [groupId, memberIds] of tractGroupMembers.entries()) {
      // Find which groups contain members of this tract group
      const groupsWithMembers = new Map(); // Map<groupIndex, count>
      for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
        const group = updatedGroups[groupIndex];
        let count = 0;
        for (const tract of group.censusTracts) {
          if (memberIds.has(getTractId(tract))) {
            count++;
          }
        }
        if (count > 0) {
          groupsWithMembers.set(groupIndex, count);
        }
      }
      
      // If tract group is split across multiple groups, move all members to the group with the most members
      // Or if there's an enclosing tract, prefer its group
      if (groupsWithMembers.size > 1) {
        // Find the group with the most members, or the group with the enclosing tract
        let targetGroupIndex = -1;
        let maxCount = 0;
        let hasEnclosingTract = false;
        
        for (const [groupIndex, count] of groupsWithMembers.entries()) {
          const group = updatedGroups[groupIndex];
          // Check if this group has the enclosing tract (one with ENCLOSES property)
          const hasEnclosing = group.censusTracts.some(t => 
            getTractId(t) && memberIds.has(getTractId(t)) && 
            t.properties?.ENCLOSES && t.properties.ENCLOSES.length > 0
          );
          
          if (hasEnclosing) {
            targetGroupIndex = groupIndex;
            hasEnclosingTract = true;
            break;
          }
          
          if (count > maxCount) {
            maxCount = count;
            targetGroupIndex = groupIndex;
          }
        }
        
        // Move all members to the target group
        if (targetGroupIndex !== -1) {
          for (const [groupIndex, count] of groupsWithMembers.entries()) {
            if (groupIndex === targetGroupIndex) continue;
            
            const group = updatedGroups[groupIndex];
            const tractsToMove = group.censusTracts.filter(t => memberIds.has(getTractId(t)));
            
            for (const tract of tractsToMove) {
              const tractId = getTractId(tract);
              if (moveTract(tract, groupIndex, targetGroupIndex)) {
                totalMoved++;
                if (tractId.includes('001700') || tractId.includes('002302')) {
                  console.log(`🔄 Moved tract ${tractId} (tract group ${groupId}) to group ${updatedGroups[targetGroupIndex].startDistrictNumber}-${updatedGroups[targetGroupIndex].endDistrictNumber} to keep tract group together`);
                }
              }
            }
          }
        }
      }
    }
    
    // Also handle ENCLOSED_BY relationships (fallback for tracts without TRACT_GROUP_ID)
    for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
      const group = updatedGroups[groupIndex];
      
      for (const tract of group.censusTracts) {
        const enclosingTractId = tract.properties?.ENCLOSED_BY;
        if (enclosingTractId && !tract.properties?.TRACT_GROUP_ID) {
          // Find which group the enclosing tract belongs to
          let enclosingGroupIndex = -1;
          for (let i = 0; i < updatedGroups.length; i++) {
            if (updatedGroups[i].censusTracts.some(t => getTractId(t) === enclosingTractId)) {
              enclosingGroupIndex = i;
              break;
            }
          }
          
          // If enclosing tract is in a different group, move this tract to that group
          if (enclosingGroupIndex !== -1 && enclosingGroupIndex !== groupIndex) {
            const tractId = getTractId(tract);
            if (moveTract(tract, groupIndex, enclosingGroupIndex)) {
              totalMoved++;
              console.log(`🔄 Moved enclosed tract ${tractId} to same group as enclosing tract ${enclosingTractId} (from group ${group.startDistrictNumber}-${group.endDistrictNumber} to group ${updatedGroups[enclosingGroupIndex].startDistrictNumber}-${updatedGroups[enclosingGroupIndex].endDistrictNumber})`);
            }
          }
        }
      }
    }
    
    // Helper function to find adjacent tracts in a group
    const findAdjacentTracts = (tractIds, inGroupIndex) => {
      const adjacentTracts = [];
      const inGroup = updatedGroups[inGroupIndex];
      
      for (const tract of inGroup.censusTracts) {
        const tractId = getTractId(tract);
        const neighbors = adjacencyGraph.get(tractId) || [];
        
        // Check if any neighbor is in the target set
        for (const neighborId of neighbors) {
          if (tractIds.has(neighborId)) {
            adjacentTracts.push(tract);
            break; // Found adjacency, no need to check more neighbors
          }
        }
      }
      
      return adjacentTracts;
    };
    
    // NOW: Iterate until no more isolation issues are found
    // This is important because fixing isolation in one group might create new issues in other groups
    const maxIterations = 10; // Prevent infinite loops
    let iteration = 0;
    let hasIsolationIssues = true;
    
    while (hasIsolationIssues && iteration < maxIterations) {
      iteration++;
      hasIsolationIssues = false;
      
      // Check each group for isolation by picking the first tract
      for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
        const group = updatedGroups[groupIndex];
        const totalTractsInGroup = group.censusTracts.length;
        
        if (totalTractsInGroup === 0) {
          continue; // Skip empty groups
        }
        
        // Calculate max reachable count to identify the main component
        const maxReachableCount = this.calculateMaxReachableCount(group.censusTracts, adjacencyGraph);
        
        // If max reachable < total, we have isolated tracts
        if (maxReachableCount < totalTractsInGroup) {
          hasIsolationIssues = true;
          const isolatedCount = totalTractsInGroup - maxReachableCount;
          console.log(`🔍 Group ${group.startDistrictNumber}-${group.endDistrictNumber}: max component size ${maxReachableCount}/${totalTractsInGroup} - ${isolatedCount} isolated tract(s) detected`);
          
          // Special logging for tract 940013
          const has940013 = group.censusTracts.some(t => getTractId(t).includes('940013'));
          if (has940013) {
            console.log(`⚠️ Group ${group.startDistrictNumber}-${group.endDistrictNumber} contains tract 940013 - checking if it's isolated...`);
          }
          
          // Find the main component by finding a tract with max reachable count
          let mainComponentTractId = null;
          let mainComponentReachableCount = 0;
          for (const tract of group.censusTracts) {
            const tractId = getTractId(tract);
            const reachableCount = this.calculateReachableTracts(tractId, group.censusTracts, adjacencyGraph);
            if (reachableCount > mainComponentReachableCount) {
              mainComponentReachableCount = reachableCount;
              mainComponentTractId = tractId;
            }
          }
          
          // Find all isolated tracts (not reachable from main component)
          const groupTractIds = new Set(group.censusTracts.map(t => getTractId(t)));
          const reachableTractIds = new Set();
          const queue = [mainComponentTractId];
          reachableTractIds.add(mainComponentTractId);
          
          // BFS to find all reachable tracts
          while (queue.length > 0) {
            const currentId = queue.shift();
            const neighbors = adjacencyGraph.get(currentId) || [];
            
            for (const neighborId of neighbors) {
              if (groupTractIds.has(neighborId) && !reachableTractIds.has(neighborId)) {
                reachableTractIds.add(neighborId);
                queue.push(neighborId);
              }
            }
          }
          
          // Find isolated tracts (in group but not reachable)
          const isolatedTractIds = new Set();
          for (const tractId of groupTractIds) {
            if (!reachableTractIds.has(tractId)) {
              isolatedTractIds.add(tractId);
            if (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('320903') || tractId.includes('940013')) {
              console.log(`🔍 ISOLATION CHECK: Tract ${tractId} is isolated in group ${group.startDistrictNumber}-${group.endDistrictNumber} (iteration ${iteration})`);
            }
            }
          }
          
          // Debug: Log if we have isolated tracts but the tract group members are split
          if (isolatedTractIds.size > 0) {
            // Check if any isolated tracts are in a tract group
            const isolatedTractGroups = new Set();
            const reachableTractGroups = new Set();
            for (const tract of group.censusTracts) {
              const tractId = getTractId(tract);
              const groupId = tract.properties?.TRACT_GROUP_ID;
              if (groupId) {
                if (isolatedTractIds.has(tractId)) {
                  isolatedTractGroups.add(groupId);
                } else if (reachableTractIds.has(tractId)) {
                  reachableTractGroups.add(groupId);
                }
              }
            }
            
            // If a tract group has members in both isolated and reachable sets, that's a problem
            for (const groupId of isolatedTractGroups) {
              if (reachableTractGroups.has(groupId)) {
                console.log(`⚠️ ISOLATION CHECK: Tract group ${groupId} is split - some members isolated, some reachable in group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
              }
            }
          }
          
          // Debug: Check if tract 001700, 002302, 320903, or 940013 are in this group
          for (const tractId of groupTractIds) {
            if (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('320903') || tractId.includes('940013')) {
              const tract = group.censusTracts.find(t => getTractId(t) === tractId);
              const isReachable = reachableTractIds.has(tractId);
              const hasGroupId = tract?.properties?.TRACT_GROUP_ID;
              const isIsolated = isolatedTractIds.has(tractId);
              console.log(`🔍 ISOLATION CHECK: Tract ${tractId} in group ${group.startDistrictNumber}-${group.endDistrictNumber}: reachable=${isReachable}, isolated=${isIsolated}, TRACT_GROUP_ID=${hasGroupId || 'none'} (iteration ${iteration})`);
              
              // For 940013, also log its neighbors
              if (tractId.includes('940013')) {
                const neighbors = adjacencyGraph.get(tractId) || [];
                const neighborGroups = new Map();
                for (const neighborId of neighbors) {
                  for (let i = 0; i < updatedGroups.length; i++) {
                    if (updatedGroups[i].censusTracts.some(t => getTractId(t) === neighborId)) {
                      const neighborGroup = updatedGroups[i];
                      if (!neighborGroups.has(i)) {
                        neighborGroups.set(i, []);
                      }
                      neighborGroups.get(i).push(neighborId);
                      break;
                    }
                  }
                }
                console.log(`   - Tract 940013 has ${neighbors.length} neighbors: ${Array.from(neighborGroups.entries()).map(([idx, ids]) => `Group ${updatedGroups[idx].startDistrictNumber}-${updatedGroups[idx].endDistrictNumber}: ${ids.length} neighbors`).join(', ')}`);
              }
            }
          }
          
          // Check if any isolated tracts are in a tract group - if so, we need to move the entire group
          const isolatedTractGroups = new Map(); // Map<groupId, Set<isolatedTractIds>>
          for (const isolatedTractId of isolatedTractIds) {
            const isolatedTract = group.censusTracts.find(t => getTractId(t) === isolatedTractId);
            if (isolatedTract) {
              const groupId = isolatedTract.properties?.TRACT_GROUP_ID;
              if (groupId) {
                if (!isolatedTractGroups.has(groupId)) {
                  isolatedTractGroups.set(groupId, new Set());
                }
                isolatedTractGroups.get(groupId).add(isolatedTractId);
                if (isolatedTractId.includes('001700') || isolatedTractId.includes('002302') || isolatedTractId.includes('320903') || isolatedTractId.includes('940013')) {
                  console.log(`🔍 ISOLATION CHECK: Isolated tract ${isolatedTractId} is in tract group ${groupId}`);
                }
              }
            }
          }
          
          // Find the tract in the other group that is adjacent to isolated tracts and causing isolation
          // Look for a tract in another group that is adjacent to an isolated tract
          let bestTractToMove = null;
          let bestTractGroupIndex = -1;
          let bestAdjacentIsolatedCount = 0;
          
          for (let otherGroupIndex = 0; otherGroupIndex < updatedGroups.length; otherGroupIndex++) {
            if (otherGroupIndex === groupIndex) continue; // Skip same group
            
            const otherGroup = updatedGroups[otherGroupIndex];
            
            // Check each tract in the other group
            for (const otherTract of otherGroup.censusTracts) {
              const otherTractId = getTractId(otherTract);
              const otherNeighbors = adjacencyGraph.get(otherTractId) || [];
              
              // Count how many isolated tracts this tract is adjacent to
              // Also check if it's in the same tract group as any isolated tract
              let adjacentIsolatedCount = 0;
              let isInIsolatedTractGroup = false;
              const otherTractGroupId = otherTract.properties?.TRACT_GROUP_ID;
              
              for (const neighborId of otherNeighbors) {
                if (isolatedTractIds.has(neighborId)) {
                  adjacentIsolatedCount++;
                }
              }
              
              // Check if this tract is in the same group as an isolated tract
              if (otherTractGroupId && isolatedTractGroups.has(otherTractGroupId)) {
                isInIsolatedTractGroup = true;
                // Count all isolated tracts in this group
                adjacentIsolatedCount = isolatedTractGroups.get(otherTractGroupId).size;
              }
              
              // If this tract is adjacent to isolated tracts or in the same group, it's a candidate
              if ((adjacentIsolatedCount > 0 || isInIsolatedTractGroup) && adjacentIsolatedCount > bestAdjacentIsolatedCount) {
                bestTractToMove = otherTract;
                bestTractGroupIndex = otherGroupIndex;
                bestAdjacentIsolatedCount = adjacentIsolatedCount;
              }
            }
          }
          
          // If we found a tract to move, move it to this group
          // BUT: Check if moving it would make it isolated in the target group OR if it's in the main component of its current group
          if (bestTractToMove && bestTractGroupIndex !== -1) {
            const sourceGroup = updatedGroups[bestTractGroupIndex];
            const targetGroup = updatedGroups[groupIndex];
            const tractToMoveId = getTractId(bestTractToMove);
            const tractPopulation = bestTractToMove.properties?.POPULATION || 0;
            
            // Check if this tract is in the main component of its current group
            // If it is, we shouldn't move it as a bridge because it's important for connectivity
            const sourceGroupMaxReachable = this.calculateMaxReachableCount(sourceGroup.censusTracts, adjacencyGraph);
            const tractReachableInSource = this.calculateReachableTracts(tractToMoveId, sourceGroup.censusTracts, adjacencyGraph);
            // If tract's reachable count is >= 95% of max, it's in the main component
            const isInMainComponentOfSource = tractReachableInSource >= sourceGroupMaxReachable * 0.95;
            
            // Also check: if ALL neighbors are in the source group, don't move it (it's fully embedded)
            const tractNeighbors = adjacencyGraph.get(tractToMoveId) || [];
            const sourceGroupTractIds = new Set(sourceGroup.censusTracts.map(t => getTractId(t)));
            let neighborsInSourceGroup = 0;
            for (const neighborId of tractNeighbors) {
              if (sourceGroupTractIds.has(neighborId)) {
                neighborsInSourceGroup++;
              }
            }
            const allNeighborsInSource = neighborsInSourceGroup === tractNeighbors.length && tractNeighbors.length > 0;
            
            if (isInMainComponentOfSource || allNeighborsInSource) {
              if (tractToMoveId.includes('940013')) {
                console.log(`⚠️ Skipping move of tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} - tract is in main component (reachable: ${tractReachableInSource}/${sourceGroupMaxReachable}) or all ${neighborsInSourceGroup}/${tractNeighbors.length} neighbors are in source group`);
              }
              // Don't move this tract - it's in the main component of its current group or fully embedded
              bestTractToMove = null;
            } else {
              // Check if this tract would be isolated in the target group
              // Simulate adding it to the target group and check connectivity
              const targetGroupTractIds = new Set(targetGroup.censusTracts.map(t => getTractId(t)));
              targetGroupTractIds.add(tractToMoveId);
              
              // Check if tract has neighbors in target group
              const tractNeighbors = adjacencyGraph.get(tractToMoveId) || [];
              let hasNeighborInTarget = false;
              for (const neighborId of tractNeighbors) {
                if (targetGroupTractIds.has(neighborId)) {
                  hasNeighborInTarget = true;
                  break;
                }
              }
              
              // If tract has no neighbors in target group, it would be isolated - skip moving it
              if (!hasNeighborInTarget) {
                if (tractToMoveId.includes('940013')) {
                  console.log(`⚠️ Skipping move of tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} - would be isolated (no neighbors in target group)`);
                }
                // Don't move this tract - it would become isolated in the target group
                bestTractToMove = null;
              }
            }
            
            // Move the bridge tract (only if it won't be isolated)
            if (bestTractToMove && moveTract(bestTractToMove, bestTractGroupIndex, groupIndex)) {
              totalMoved++;
            if (tractToMoveId.includes('320903') || tractToMoveId.includes('940013')) {
              console.log(`🔄 Moved tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} (adjacent to ${bestAdjacentIsolatedCount} isolated tracts) - iteration ${iteration}`);
            } else {
              console.log(`🔄 Moved tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} (adjacent to ${bestAdjacentIsolatedCount} isolated tracts)`);
            }
              
              // After moving, check if we need to move enclosed tracts
              // Check for enclosed tract relationships in the moved tract
              const enclosingTractId = bestTractToMove.properties?.ENCLOSED_BY;
              if (enclosingTractId) {
                // Find which group the enclosing tract belongs to
                let enclosingGroupIndex = -1;
                for (let i = 0; i < updatedGroups.length; i++) {
                  if (updatedGroups[i].censusTracts.some(t => getTractId(t) === enclosingTractId)) {
                    enclosingGroupIndex = i;
                    break;
                  }
                }
                
                // If enclosing tract is in a different group, move this tract to that group
                if (enclosingGroupIndex !== -1 && enclosingGroupIndex !== groupIndex) {
                  if (moveTract(bestTractToMove, groupIndex, enclosingGroupIndex)) {
                    totalMoved++;
                    console.log(`🔄 Moved enclosed tract ${tractToMoveId} to same group as enclosing tract ${enclosingTractId}`);
                  }
                }
              }
              
              // Balance population: find adjacent tracts in the receiving group and move them to the giving group
              // This preserves the population division ratio
              // Note: targetGroup is now updated with the moved tract, so we can find its adjacent tracts
              const adjacentTractsInTarget = findAdjacentTracts(new Set([tractToMoveId]), groupIndex);
              
              // Find tracts in the target group that are adjacent to the moved tract
              // Move them back to the source group to balance population
              let populationToBalance = tractPopulation;
              
              for (const adjacentTract of adjacentTractsInTarget) {
                const adjacentTractId = getTractId(adjacentTract);
                // Don't move back the tract we just moved
                if (adjacentTractId === tractToMoveId) continue;
                
                const adjacentTractPopulation = adjacentTract.properties?.POPULATION || 0;
                
                // Move tract back to balance population
                if (moveTract(adjacentTract, groupIndex, bestTractGroupIndex)) {
                  totalMoved++;
                  populationToBalance -= adjacentTractPopulation;
                  console.log(`🔄 Balanced population: moved tract ${adjacentTractId} from group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} back to group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber}`);
                  
                  // Stop when we've balanced the population (approximately)
                  if (populationToBalance <= 0) break;
                }
              }
            }
          } else {
            // No bridge tract found - move isolated tracts themselves to another group
            console.log(`⚠️ No bridge tract found - moving isolated tracts to another group`);
            
            // Find the best group to move isolated tracts to (one with adjacent neighbors)
            let bestTargetGroupIndex = -1;
            let bestAdjacentCount = 0;
            
            for (let otherGroupIndex = 0; otherGroupIndex < updatedGroups.length; otherGroupIndex++) {
              if (otherGroupIndex === groupIndex) continue;
              
              const otherGroup = updatedGroups[otherGroupIndex];
              const otherGroupTractIds = new Set(otherGroup.censusTracts.map(t => getTractId(t)));
              
              // Count how many isolated tracts have neighbors in this other group
              let adjacentCount = 0;
              for (const isolatedTractId of isolatedTractIds) {
                const neighbors = adjacencyGraph.get(isolatedTractId) || [];
                for (const neighborId of neighbors) {
                  if (otherGroupTractIds.has(neighborId)) {
                    adjacentCount++;
                    break; // Count each isolated tract only once
                  }
                }
              }
              
              if (adjacentCount > bestAdjacentCount) {
                bestTargetGroupIndex = otherGroupIndex;
                bestAdjacentCount = adjacentCount;
              }
            }
            
            // If we found a target group, move isolated tracts there
            // IMPORTANT: If isolated tracts are in a tract group, move ALL group members together
            if (bestTargetGroupIndex !== -1) {
              const isolatedTracts = group.censusTracts.filter(t => isolatedTractIds.has(getTractId(t)));
              const tractsToMove = new Set(isolatedTracts);
              
              // Check if any isolated tracts are in a tract group - if so, include all group members
              for (const isolatedTract of isolatedTracts) {
                const groupId = isolatedTract.properties?.TRACT_GROUP_ID;
                if (groupId) {
                  // Find all tracts in this group across all groups
                  for (const otherGroup of updatedGroups) {
                    for (const tract of otherGroup.censusTracts) {
                      if (tract.properties?.TRACT_GROUP_ID === groupId) {
                        tractsToMove.add(tract);
                      }
                    }
                  }
                  
                  if (getTractId(isolatedTract).includes('001700') || getTractId(isolatedTract).includes('002302') || getTractId(isolatedTract).includes('320903') || getTractId(isolatedTract).includes('940013')) {
                    console.log(`🔍 ISOLATION FIX: Isolated tract ${getTractId(isolatedTract)} is in tract group ${groupId}, will move all ${tractsToMove.size} group members together`);
                  }
                }
              }
              
              let isolatedPopulation = 0;
              
              for (const isolatedTract of tractsToMove) {
                const isolatedTractId = getTractId(isolatedTract);
                // Find which group this tract is currently in (might be different from groupIndex if it's a group member)
                let currentGroupIndex = groupIndex;
                for (let i = 0; i < updatedGroups.length; i++) {
                  if (updatedGroups[i].censusTracts.some(t => getTractId(t) === isolatedTractId)) {
                    currentGroupIndex = i;
                    break;
                  }
                }
                
                if (currentGroupIndex !== bestTargetGroupIndex) {
                  if (moveTract(isolatedTract, currentGroupIndex, bestTargetGroupIndex)) {
                    totalMoved++;
                    isolatedPopulation += isolatedTract.properties?.POPULATION || 0;
                    if (isolatedTractId.includes('320903') || isolatedTractId.includes('940013')) {
                      console.log(`🔄 Moved isolated tract ${isolatedTractId} from group ${updatedGroups[currentGroupIndex].startDistrictNumber}-${updatedGroups[currentGroupIndex].endDistrictNumber} to group ${updatedGroups[bestTargetGroupIndex].startDistrictNumber}-${updatedGroups[bestTargetGroupIndex].endDistrictNumber} - iteration ${iteration}`);
                    } else {
                      console.log(`🔄 Moved isolated tract ${isolatedTractId} from group ${updatedGroups[currentGroupIndex].startDistrictNumber}-${updatedGroups[currentGroupIndex].endDistrictNumber} to group ${updatedGroups[bestTargetGroupIndex].startDistrictNumber}-${updatedGroups[bestTargetGroupIndex].endDistrictNumber}`);
                    }
                  }
                }
              }
              
              // Balance population: find adjacent tracts in the receiving group and move them back
              const receivingGroup = updatedGroups[bestTargetGroupIndex];
              const isolatedTractIdsSet = new Set(isolatedTractIds);
              const adjacentTractsInReceiving = findAdjacentTracts(isolatedTractIdsSet, bestTargetGroupIndex);
              
              // Move adjacent tracts back to balance population
              let populationToBalance = isolatedPopulation;
              for (const adjacentTract of adjacentTractsInReceiving) {
                const adjacentTractId = getTractId(adjacentTract);
                // Don't move back tracts we just moved
                if (isolatedTractIdsSet.has(adjacentTractId)) continue;
                
                const adjacentTractPopulation = adjacentTract.properties?.POPULATION || 0;
                if (moveTract(adjacentTract, bestTargetGroupIndex, groupIndex)) {
                  totalMoved++;
                  populationToBalance -= adjacentTractPopulation;
                  console.log(`🔄 Balanced population: moved tract ${adjacentTractId} from group ${receivingGroup.startDistrictNumber}-${receivingGroup.endDistrictNumber} back to group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
                  
                  // Stop when we've balanced the population (approximately)
                  if (populationToBalance <= 0) break;
                }
              }
            } else {
              // No suitable group found - check if isolated tracts are in a tract group
              // If so, try to move them to the group containing other members of the same tract group
              let tractGroupTarget = -1;
              for (const isolatedTractId of isolatedTractIds) {
                const isolatedTract = group.censusTracts.find(t => getTractId(t) === isolatedTractId);
                if (isolatedTract) {
                  const groupId = isolatedTract.properties?.TRACT_GROUP_ID;
                  if (groupId) {
                    // Find which group contains other members of this tract group
                    for (let i = 0; i < updatedGroups.length; i++) {
                      if (i === groupIndex) continue;
                      const otherGroup = updatedGroups[i];
                      const hasOtherMember = otherGroup.censusTracts.some(t => 
                        t.properties?.TRACT_GROUP_ID === groupId && !isolatedTractIds.has(getTractId(t))
                      );
                      if (hasOtherMember) {
                        tractGroupTarget = i;
                        break;
                      }
                    }
                    if (tractGroupTarget !== -1) break;
                  }
                }
              }
              
              if (tractGroupTarget !== -1) {
                // Move isolated tracts to the group containing other tract group members
                const isolatedTracts = group.censusTracts.filter(t => isolatedTractIds.has(getTractId(t)));
                for (const isolatedTract of isolatedTracts) {
                  const isolatedTractId = getTractId(isolatedTract);
                  if (moveTract(isolatedTract, groupIndex, tractGroupTarget)) {
                    totalMoved++;
                    console.log(`🔄 Moved isolated tract ${isolatedTractId} (tract group member) from group ${group.startDistrictNumber}-${group.endDistrictNumber} to group ${updatedGroups[tractGroupTarget].startDistrictNumber}-${updatedGroups[tractGroupTarget].endDistrictNumber} to join tract group`);
                  }
                }
              } else {
                console.warn(`⚠️ Could not find a suitable group to move isolated tracts to in group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
              }
            }
          }
        }
      }
      
      if (hasIsolationIssues && iteration < maxIterations) {
        console.log(`🔄 FIX ISOLATED: Iteration ${iteration} - re-checking all groups for remaining isolation issues...`);
      }
    }
    
    if (iteration >= maxIterations) {
      console.warn(`⚠️ FIX ISOLATED: Reached maximum iterations (${maxIterations}) - some isolation issues may remain`);
    }
    
    // Verify that isolation is actually fixed by checking each group again
    const fixEndTime = Date.now();
    const totalTime = fixEndTime - fixStartTime;
    
    if (totalMoved > 0) {
      console.log(`✅ FIX ISOLATED: Fixed ${totalMoved} isolated tract(s) across all groups in ${totalTime}ms`);
      
      // Re-check isolation after fixes
      for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
        const group = updatedGroups[groupIndex];
        if (group.censusTracts.length === 0) continue;
        
        const firstTractId = getTractId(group.censusTracts[0]);
        const reachableCount = this.calculateReachableTracts(firstTractId, group.censusTracts, adjacencyGraph);
        const totalTractsInGroup = group.censusTracts.length;
        
        if (reachableCount < totalTractsInGroup) {
          console.log(`⚠️ FIX ISOLATED: Group ${group.startDistrictNumber}-${group.endDistrictNumber} still has ${totalTractsInGroup - reachableCount} isolated tract(s) after fix (${reachableCount}/${totalTractsInGroup} reachable)`);
        }
      }
    } else {
      console.log(`✅ FIX ISOLATED: No isolated tracts found - completed in ${totalTime}ms`);
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
  detectEnclosedTracts,
  ALGORITHM_VERSION
};

