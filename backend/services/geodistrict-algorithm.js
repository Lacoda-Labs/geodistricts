const s4DataLoader = require('./s4-data-loader');
const turf = require('@turf/turf');
const logger = require('../utils/logger');

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
 * 20251122-0824: Fixed isolation check fallback logic - when no bridge tracts found, move isolated tracts directly to adjacent groups where they have neighbors, then balance population with different tracts
 * 20251123-1730: Fixed isolation detection bug - added safety checks to prevent main component tract from being incorrectly identified as isolated; improved null handling and BFS validation
 * 20251123-1806: Improved bridge tract detection for large isolations - less restrictive filtering for groups with 10+ isolated tracts; added debug logging for bridge tract candidates
 * 20251123-2207: Implemented canonical tract model using Map keyed by tract ID - Census API is primary source, TIGER polygons and S4 adjacency data attached as children; prevents duplicate tracts at source; added sibling group relationships to step metadata; updated move isolated/bridge tracts to use sibling groups; added duplicate tract detection and validation after division steps
 * 20251122-2327: Added DG tracking in tract properties (tract_DG, parent_DG, sibling_DG) - each tract stores its current DG, parent DG, and sibling DG; updated move isolated tracts to use sibling_DG from tract properties and swap tract_DG with sibling_DG when moving; improved sibling group lookup to use most recent division; added infinite loop prevention when moving would leave tract isolated
 * 20251124-0115: Removed findSiblingGroup() function - siblings are always the two DGs from dividing a parent DG; use sibling_DG directly from tract properties; added data integrity fix to set missing sibling_DG from divisionLines metadata; simplified logic to throw error if sibling_DG can't be found instead of using unreliable fallbacks
 * 20251126-2127: Bridge tract detection only from sibling group - changed to ONLY look for bridge tracts in the sibling group (the other half from same parent division), not from all other groups; added swap of tract_DG with sibling_DG when moving bridge tracts to match isolated tract movement behavior; fixed final step data structure - when algorithm completes, convert result object with finalDistricts to step-like object with districtGroups so moveIsolatedTracts() works in final step
 * 20251126-2300: Fixed cache persistence for isolated/bridge tract moves - when isolated or bridge tracts are moved, update algorithm state currentGroups and invalidate cached step and all subsequent step caches; ensures that subsequent steps use the updated data instead of the original cached step
 * 20251126-2320: Fixed moveIsolatedTracts to dynamically update group list after each move - processes all groups that currently have isolated tracts instead of continuing with original list; ensures single click processes all isolated tracts across all DGs
 * 20251128-2200: Fixed union polygon creation for MultiPolygon geometries - flatten MultiPolygon to individual Polygon features before dissolve/union operations; enables proper union of all tracts in district groups; added support for multiple union polygons per group when isolated tracts create multiple connected components
 * 20251128-2300: Fixed bridge tract detection for small isolations - adjusted filtering logic to be less restrictive for small isolations; bridge tracts adjacent to 2+ isolated tracts are now included even if in main component; added comprehensive debug logging for all groups with isolated tracts
 * 20251203-0000: Fixed union polygon visualization - use forceSingleUnion=true in createStep() and recreateUnionPolygonsForGroups() to create one dissolved polygon per district group for visualization, instead of multiple polygons per connected component; ensures clean district shapes when checkbox is unchecked
 * 20251203-0100: Fixed sibling_DG format bug in step reconstruction - always use full format DG{start}-{end} even when start equals end (e.g., DG2-2 not DG2); fixed algorithm state reconstruction for move-all-isolated-tracts endpoint; added GET /api/algorithm/step/:state/:stepNumber endpoint for loading previous steps
 * 20251203-0200: Fixed bridge tract infinite loop - handle case where tract_DG and sibling_DG are the same; improved swap logic to set values directly instead of swapping when values are identical; added check to skip bridge tract movement if it doesn't reduce isolation count
 * 20251203-0300: Additional fix for bridge tract movement logic
 * 20251203-0400: Cache invalidation bump
 * 20251203-0500: Fixed stale sibling_DG issue - always update sibling_DG from divisionLines to match current division (not just when missing). sibling_DG should always be set correctly during division, but this fixes cases where moved tracts have stale values.
 * 20251203-0600: Fixed caching bug - added state validation in final-step endpoint, validate tractCacheKey matches state, clear map layers immediately on state change, added race condition check
 * 20251203-0700: Cache invalidation bump
 * 20251203-2200: Improved bridge tract detection - only include tracts that will actually help connect isolated siblings; fixed swap logic to always swap tract_DG with sibling_DG without override
 */
const ALGORITHM_VERSION = '20251203-2200';

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
 * Find all connected components in a district group
 * @param {Object} group - District group containing tracts
 * @param {Map<string, string[]>} adjacencyGraph - Adjacency graph for all tracts
 * @returns {Array<Array<Object>>} - Array of connected components, each component is an array of tract objects
 */
function findConnectedComponents(group, adjacencyGraph) {
  if (!group.censusTracts || group.censusTracts.length === 0) {
    return [];
  }

  const groupTractIds = new Set(group.censusTracts.map(t => getTractId(t)).filter(Boolean));
  const visited = new Set();
  const components = [];

  for (const tract of group.censusTracts) {
    const tractId = getTractId(tract);
    if (!tractId || visited.has(tractId)) {
      continue;
    }

    // BFS to find all tracts in this connected component
    const component = [];
    const queue = [tractId];
    visited.add(tractId);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentTract = group.censusTracts.find(t => getTractId(t) === currentId);
      if (currentTract) {
        component.push(currentTract);
      }

      const neighbors = adjacencyGraph.get(currentId) || [];
      for (const neighborId of neighbors) {
        if (neighborId && groupTractIds.has(neighborId) && !visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    if (component.length > 0) {
      components.push(component);
    }
  }

  return components;
}

/**
 * Create union polygons for each connected component in a district group
 * If a group has isolated tracts (multiple connected components), returns an array of union polygons
 * @param {Object} group - District group containing tracts
 * @param {Map<string, string[]>} adjacencyGraph - Adjacency graph for all tracts (optional, for finding connected components)
 * @param {boolean} forceSingleUnion - If true, create one union polygon for all tracts regardless of connectivity (for visualization)
 * @returns {Array<Object>|Object|null} - Array of GeoJSON features (one per connected component) or single feature, or null if union fails
 */
function createUnionPolygonsForGroup(group, adjacencyGraph = null, forceSingleUnion = false) {
  if (!group.censusTracts || group.censusTracts.length === 0) {
    return null;
  }

  // If forceSingleUnion is true, create one union polygon for all tracts (ignoring connectivity)
  // This is useful for visualization when you want to see the district as one shape
  if (forceSingleUnion) {
    return createUnionPolygon(group);
  }

  // If adjacency graph is provided, check for multiple connected components
  if (adjacencyGraph) {
    const components = findConnectedComponents(group, adjacencyGraph);
    
    // If multiple components found, create union polygon for each
    if (components.length > 1) {
      console.log(`🔨 Group ${group.startDistrictNumber}-${group.endDistrictNumber} has ${components.length} connected components, creating union polygon for each`);
      const unionPolygons = [];
      
      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        const componentGroup = {
          ...group,
          censusTracts: component
        };
        const unionPolygon = createUnionPolygon(componentGroup);
        if (unionPolygon) {
          unionPolygons.push(unionPolygon);
          console.log(`✅ Created union polygon ${i + 1}/${components.length} for component with ${component.length} tracts`);
        } else {
          console.warn(`⚠️ Failed to create union polygon for component ${i + 1} with ${component.length} tracts`);
        }
      }
      
      if (unionPolygons.length > 0) {
        return unionPolygons;
      }
    }
  }

  // Single component or no adjacency graph - create single union polygon
  return createUnionPolygon(group);
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

    // Always try to use dissolve first (works better than sequential union after flattening)
    // Flatten MultiPolygon geometries to individual Polygon features for dissolve to work
    console.log(`🔨 Creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${validTracts.length} tracts) using dissolve`);
    try {
      // Flatten MultiPolygon geometries to individual Polygon features
      const flattenedTracts = [];
      for (const tract of validTracts) {
        if (tract.geometry.type === 'MultiPolygon') {
          // Convert MultiPolygon to multiple Polygon features
          for (const polygonCoords of tract.geometry.coordinates) {
            flattenedTracts.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: polygonCoords
              },
              properties: tract.properties || {}
            });
          }
        } else if (tract.geometry.type === 'Polygon') {
          flattenedTracts.push(tract);
        }
      }
      
      if (flattenedTracts.length > 0) {
        const collection = turf.featureCollection(flattenedTracts);
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
          console.log(`✅ Created union polygon using dissolve for group ${group.startDistrictNumber}-${group.endDistrictNumber} (flattened ${validTracts.length} tracts to ${flattenedTracts.length} polygons)`);
          return unionFeature;
        }
      }
    } catch (dissolveError) {
      console.warn(`⚠️ Dissolve failed for group ${group.startDistrictNumber}-${group.endDistrictNumber}, falling back to sequential union:`, dissolveError.message);
    }

    // Fallback: Flatten MultiPolygon geometries to individual Polygon features for sequential union
    const flattenedTracts = [];
    for (const tract of validTracts) {
      if (tract.geometry.type === 'MultiPolygon') {
        // Convert MultiPolygon to multiple Polygon features
        for (const polygonCoords of tract.geometry.coordinates) {
          flattenedTracts.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: polygonCoords
            },
            properties: tract.properties || {}
          });
        }
      } else if (tract.geometry.type === 'Polygon') {
        flattenedTracts.push(tract);
      }
    }
    
    if (flattenedTracts.length === 0) {
      console.warn(`⚠️ No valid polygon geometries found for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }
    
    // Start with the first flattened tract
    let union = turf.feature(flattenedTracts[0].geometry);
    if (!union || !union.geometry) {
      console.warn(`⚠️ Invalid initial tract geometry for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }
    
    console.log(`🔨 Creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${validTracts.length} tracts, ${flattenedTracts.length} polygons after flattening)`);

    // Union all remaining flattened tracts
    const batchSize = 100;
    let processedCount = 1;
    const startTime = Date.now();
    let skippedCount = 0;

    for (let i = 1; i < flattenedTracts.length; i++) {
      // Validate union geometry before attempting union
      if (!union || !union.geometry) {
        console.warn(`⚠️ Union geometry invalid at polygon ${i} in group ${group.startDistrictNumber}-${group.endDistrictNumber}, stopping union`);
        break;
      }
      
      const tractFeature = turf.feature(flattenedTracts[i].geometry);
      
      // Validate tract geometry before unioning
      if (!tractFeature || !tractFeature.geometry) {
        skippedCount++;
        continue;
      }
      
      try {
        const unionResult = turf.union(union, tractFeature);
        if (!unionResult || !unionResult.geometry) {
          skippedCount++;
          continue; // Skip this polygon but continue with others
        }
        union = unionResult;
        processedCount++;

        // Log progress for large unions (only on success to reduce verbosity)
        if (processedCount % batchSize === 0 || i === flattenedTracts.length - 1) {
          const elapsed = Date.now() - startTime;
          console.log(`🔨 Union progress: ${processedCount}/${flattenedTracts.length} polygons (${Math.round(processedCount / flattenedTracts.length * 100)}%) - ${elapsed}ms`);
        }
      } catch (error) {
        // Suppress verbose "Must have at least 2 geometries" errors - these are common for invalid geometries
        // Only log other types of errors
        if (!error.message.includes('Must have at least 2 geometries')) {
          console.warn(`⚠️ Error unioning polygon ${i} in group ${group.startDistrictNumber}-${group.endDistrictNumber}:`, error.message);
        }
        skippedCount++;
        // Skip this polygon and continue with the next one
        continue;
      }
    }
    
    if (skippedCount > 0) {
      console.log(`⚠️ Skipped ${skippedCount} polygon(s) during union for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${Math.round(skippedCount / flattenedTracts.length * 100)}% skipped)`);
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Completed union of ${processedCount}/${flattenedTracts.length} polygons (from ${validTracts.length} tracts) for group ${group.startDistrictNumber}-${group.endDistrictNumber} in ${totalTime}ms`);

    // Validate final union geometry
    if (!union || !union.geometry) {
      console.error(`❌ Union geometry is null or invalid after processing ${processedCount} tracts for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }

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

    console.log(`✅ Successfully created union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (geometry type: ${union.geometry.type})`);
    return unionFeature;
  } catch (error) {
    console.error(`❌ Error creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber}:`, error.message);
    console.error(`   Stack trace:`, error.stack);
    return null;
  }
}

/**
 * Create a step object with union polygons for each district group
 * Also detects and stores isolated tracts data for the step
 */
function createStep(step, level, districtGroups, description, divisionDirection, divisionLine, divisionLines, algorithmService = null, allTracts = null) {
  // Build adjacency graph if we have algorithmService and allTracts (needed for finding connected components)
  let adjacencyGraph = null;
  if (algorithmService && allTracts && allTracts.length > 0) {
    try {
      adjacencyGraph = algorithmService.buildGeometryAdjacencyGraph(allTracts);
    } catch (error) {
      console.warn(`⚠️ Failed to build adjacency graph for step ${step}: ${error.message}`);
    }
  }

  // Create union polygons for each district group
  // Use forceSingleUnion=true to create one dissolved polygon per district group for visualization
  // This creates a single union polygon that encompasses all tracts, even if they're isolated/disconnected
  const groupsWithUnions = districtGroups.map(group => {
    const unionPolygon = createUnionPolygonsForGroup(group, adjacencyGraph, true); // forceSingleUnion=true for visualization
    
    // Always store as single unionPolygon (not array) for consistent visualization
    return {
      ...group,
      unionPolygon: unionPolygon || undefined // Use undefined instead of null for cleaner JSON
    };
  });

  // Detect isolated tracts if algorithmService and allTracts are provided
  let isolatedTractsData = null;
  if (algorithmService && allTracts && allTracts.length > 0) {
    try {
      const detectionResult = algorithmService.detectIsolatedTracts(groupsWithUnions, allTracts);
      // Convert Map to object for JSON serialization
      const isolatedTractsByGroup = {};
      detectionResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
      });
      isolatedTractsData = {
        isolatedTractsByGroup,
        isolatedTractIds: Array.from(detectionResult.isolatedTractIds),
        totalIsolated: detectionResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(isolatedTractsByGroup).length
      };
    } catch (error) {
      console.warn(`⚠️ Failed to detect isolated tracts for step ${step}: ${error.message}`);
    }
  }

  return {
    step,
    level,
    districtGroups: groupsWithUnions,
    description,
    totalGroups: groupsWithUnions.length,
    totalDistricts: groupsWithUnions.reduce((sum, g) => sum + g.totalDistricts, 0),
    divisionDirection: divisionDirection || 'latitude',
    divisionLine,
    divisionLines: divisionLines || [],
    isolatedTractsData: isolatedTractsData || undefined // Only include if detected
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

    // Initialize DG properties for step 0 (all tracts in single group)
    const initialDG = `DG1-${totalDistricts}`;
    for (const tract of uniqueTracts) {
      if (!tract.properties) tract.properties = {};
      tract.properties.tract_DG = initialDG;
      tract.properties.parent_DG = null; // No parent for initial state
      tract.properties.sibling_DG = null; // No sibling for initial state
    }

    // Create step 0 with union polygons - pass algorithmService and allTracts so union polygons are created
    const initialStep = createStep(0, 0, [initialGroup], 'Initial state: All tracts in single group', 'latitude', undefined, [], this, uniqueTracts);

    // Return step 0 and algorithm state
    return {
      step: initialStep,
      state: {
        uniqueTracts,
        currentGroups: initialStep.districtGroups, // Use groups from step (which have union polygons) - already an array
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

    // Debug: Log current groups state
    console.log(`🔍 EXECUTE NEXT STEP: iteration=${iteration}, currentGroups.length=${currentGroups?.length || 0}`);
    if (currentGroups && currentGroups.length > 0) {
      currentGroups.forEach((group, idx) => {
        console.log(`🔍   Group ${idx}: ${group.startDistrictNumber}-${group.endDistrictNumber}, totalDistricts=${group.totalDistricts}, tracts=${group.censusTracts?.length || 0}`);
      });
    } else {
      console.warn(`⚠️ EXECUTE NEXT STEP: currentGroups is empty or undefined!`);
    }

    // Check if algorithm is complete
    if (!currentGroups || currentGroups.length === 0 || !currentGroups.some(group => group.totalDistricts > 1) || iteration >= maxIterations) {
      const reason = !currentGroups || currentGroups.length === 0 ? 'no groups' : 
                     !currentGroups.some(group => group.totalDistricts > 1) ? 'all groups have 1 district' : 
                     'max iterations reached';
      console.log(`✅ Algorithm completed: ${reason} (iteration=${iteration}, maxIterations=${maxIterations})`);
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
            // Store sibling group relationships: when parent divides, record which groups are siblings
            const firstGroup = divisionResult.groups[0];
            const secondGroup = divisionResult.groups[1];
            
            const parentDG = `DG${group.startDistrictNumber}-${group.endDistrictNumber}`;
            const firstSiblingDG = `DG${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}`;
            const secondSiblingDG = `DG${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}`;
            
            // Update tract properties with DG relationships
            // Tracts in first group: tract_DG=firstSiblingDG, parent_DG=parentDG, sibling_DG=secondSiblingDG
            for (const tract of firstGroup.censusTracts) {
              if (!tract.properties) tract.properties = {};
              tract.properties.tract_DG = firstSiblingDG;
              tract.properties.parent_DG = parentDG;
              tract.properties.sibling_DG = secondSiblingDG;
            }
            
            // Tracts in second group: tract_DG=secondSiblingDG, parent_DG=parentDG, sibling_DG=firstSiblingDG
            for (const tract of secondGroup.censusTracts) {
              if (!tract.properties) tract.properties = {};
              tract.properties.tract_DG = secondSiblingDG;
              tract.properties.parent_DG = parentDG;
              tract.properties.sibling_DG = firstSiblingDG;
            }
            
            divisionLines.push({
              line: divisionResult.dividingLine,
              direction: direction,
              parentGroup: {
                startDistrictNumber: group.startDistrictNumber,
                endDistrictNumber: group.endDistrictNumber,
                totalDistricts: group.totalDistricts
              },
              siblingGroups: [
                {
                  startDistrictNumber: firstGroup.startDistrictNumber,
                  endDistrictNumber: firstGroup.endDistrictNumber
                },
                {
                  startDistrictNumber: secondGroup.startDistrictNumber,
                  endDistrictNumber: secondGroup.endDistrictNumber
                }
              ],
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
    
    // Check for duplicate tract assignments across groups
    const tractToGroups = new Map(); // Map<tractId, Array<groupIndex>>
    for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
      const group = updatedGroups[groupIndex];
      for (const tract of group.censusTracts) {
        const tractId = getTractId(tract);
        if (!tractId) continue;
        
        if (!tractToGroups.has(tractId)) {
          tractToGroups.set(tractId, []);
        }
        tractToGroups.get(tractId).push(groupIndex);
      }
    }
    
    // Check for duplicates and log specific tracts mentioned by user
    let duplicatesFound = 0;
    const problematicTracts = ['002105', '002104'];
    for (const [tractId, groupIndices] of tractToGroups.entries()) {
      if (groupIndices.length > 1) {
        duplicatesFound++;
        const groupLabels = groupIndices.map(i => `${updatedGroups[i].startDistrictNumber}-${updatedGroups[i].endDistrictNumber}`).join(', ');
        console.error(`⚠️ DUPLICATE TRACT ASSIGNMENT: Tract ${tractId} is assigned to ${groupIndices.length} groups: ${groupLabels}`);
        
        // Special logging for the problematic tracts
        if (problematicTracts.some(id => tractId.includes(id))) {
          console.error(`   🚨 PROBLEMATIC TRACT: ${tractId} should be in one group but is in: ${groupLabels}`);
          console.error(`   → This tract should be removed from all groups except the correct one`);
        }
      }
    }
    
    if (duplicatesFound > 0) {
      console.error(`⚠️ POST-DIVISION VALIDATION: Found ${duplicatesFound} tract(s) assigned to multiple groups after step ${nextIteration}`);
      console.error(`   → This indicates a bug in the division logic - tracts should only be in one group`);
      
      // Fix duplicates by keeping tract in first group only
      let fixedCount = 0;
      for (const [tractId, groupIndices] of tractToGroups.entries()) {
        if (groupIndices.length > 1) {
          // Keep in first group, remove from all others
          for (let i = 1; i < groupIndices.length; i++) {
            const groupIndex = groupIndices[i];
            const group = updatedGroups[groupIndex];
            const tractIndex = group.censusTracts.findIndex(t => getTractId(t) === tractId);
            
            if (tractIndex !== -1) {
              group.censusTracts.splice(tractIndex, 1);
              group.totalPopulation = group.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
              group.bounds = calculateBounds(group.censusTracts);
              group.centroid = calculateCentroid(group.censusTracts);
              fixedCount++;
              
              if (problematicTracts.some(id => tractId.includes(id))) {
                console.error(`   ✅ Fixed: Removed ${tractId} from group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
              }
            }
          }
        }
      }
      
      if (fixedCount > 0) {
        console.log(`✅ POST-DIVISION FIX: Removed ${fixedCount} duplicate tract assignment(s)`);
      }
    }
    
    const validationTime = Date.now() - validationStartTime;
    if (validationTime > 10) {
      console.log(`⏱️ VALIDATION: Completed in ${validationTime}ms`);
    }
    
    // Fix isolated tracts after division (DISABLED - now manual via UI)
    // Pass the dividing line to optimize the check to only overlapping tracts
    // const dividingLine = divisionLines.length > 0 ? divisionLines[0].line : undefined;
    // const fixIsolatedStartTime = Date.now();
    // console.log(`🔧 POST-DIVISION: Starting isolation check after step ${nextIteration}...`);
    // updatedGroups = this.fixIsolatedTractsAcrossAllGroups(updatedGroups, uniqueTracts, direction, dividingLine);
    // const fixIsolatedTime = Date.now() - fixIsolatedStartTime;
    // console.log(`⏱️ POST-DIVISION: Fix isolated tracts took ${fixIsolatedTime}ms`);
    
    // Verify tract 940013 is not isolated after fix
    for (const group of updatedGroups) {
      const has940013 = group.censusTracts.some(t => getTractId(t).includes('940013'));
      if (has940013) {
        console.log(`✅ POST-DIVISION: Tract 940013 is in group ${group.startDistrictNumber}-${group.endDistrictNumber} after step ${nextIteration}`);
      }
    }
    
    const createStepStartTime = Date.now();
    const step = createStep(nextIteration, nextIteration, updatedGroups,
      `Division ${nextIteration} by ${direction}`, direction, undefined, divisionLines, this, uniqueTracts);
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
   * Detect isolated tracts across all groups without fixing them
   * Returns a map of group index -> array of isolated tract IDs
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @returns {Object} - Object with isolatedTractsByGroup (Map of groupIndex -> Set of tractIds) and isolatedTractIds (Set of all isolated tract IDs)
   */
  detectIsolatedTracts(districtGroups, allTracts) {
    logger.debug(`🔍 DETECT ISOLATED: Starting isolation detection for ${districtGroups.length} groups with ${allTracts.length} total tracts`);
    
    if (districtGroups.length < 1) {
      return { isolatedTractsByGroup: new Map(), isolatedTractIds: new Set(), groupStats: [] };
    }
    
    // Build adjacency graph for all tracts
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    
    const isolatedTractsByGroup = new Map(); // Map<groupIndex, Set<tractId>>
    const isolatedTractIds = new Set(); // All isolated tract IDs across all groups
    const groupStats = []; // Array of {groupIndex, maxReachable, totalTracts, groupLabel} for all groups
    
    // Check each group for isolated tracts
    for (let groupIndex = 0; groupIndex < districtGroups.length; groupIndex++) {
      const group = districtGroups[groupIndex];
      const totalTractsInGroup = group.censusTracts.length;
      
      if (totalTractsInGroup === 0) {
        continue; // Skip empty groups
      }
      
      // Calculate max reachable count to identify the main component
      const maxReachableCount = this.calculateMaxReachableCount(group.censusTracts, adjacencyGraph);
      
      // Store stats for all groups (even if no isolation)
      groupStats.push({
        groupIndex,
        maxReachable: maxReachableCount,
        totalTracts: totalTractsInGroup,
        groupLabel: `${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}`
      });
      
      // If max reachable < total, we have isolated tracts
      if (maxReachableCount < totalTractsInGroup) {
        const isolatedCount = totalTractsInGroup - maxReachableCount;
        
        // Find the main component by finding a tract with max reachable count
        let mainComponentTractId = null;
        let mainComponentReachableCount = 0;
        for (const tract of group.censusTracts) {
          const tractId = getTractId(tract);
          if (!tractId) continue; // Skip tracts without valid IDs
          const reachableCount = this.calculateReachableTracts(tractId, group.censusTracts, adjacencyGraph);
          if (reachableCount > mainComponentReachableCount) {
            mainComponentReachableCount = reachableCount;
            mainComponentTractId = tractId;
          }
        }
        
        // Safety check: if we couldn't find a main component tract, skip this group
        if (!mainComponentTractId) {
          console.warn(`⚠️ DETECT ISOLATED: Could not find main component tract for group ${group.startDistrictNumber}-${group.endDistrictNumber}, skipping`);
          continue;
        }
        
        // Verify main component tract is in adjacency graph
        if (!adjacencyGraph.has(mainComponentTractId)) {
          console.warn(`⚠️ DETECT ISOLATED: Main component tract ${mainComponentTractId} not found in adjacency graph for group ${group.startDistrictNumber}-${group.endDistrictNumber}, skipping`);
          continue;
        }
        
        // Find all isolated tracts (not reachable from main component)
        const groupTractIds = new Set(group.censusTracts.map(t => getTractId(t)).filter(Boolean));
        const reachableTractIds = new Set();
        const queue = [mainComponentTractId];
        
        // CRITICAL: Always add main component tract to reachable set first
        // This ensures it can never be marked as isolated
        if (!reachableTractIds.has(mainComponentTractId)) {
          reachableTractIds.add(mainComponentTractId);
        }
        
        // BFS to find all reachable tracts
        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId) continue; // Skip null/undefined IDs
          const neighbors = adjacencyGraph.get(currentId) || [];
          
          for (const neighborId of neighbors) {
            if (neighborId && groupTractIds.has(neighborId) && !reachableTractIds.has(neighborId)) {
              reachableTractIds.add(neighborId);
              queue.push(neighborId);
            }
          }
        }
        
        // CRITICAL: Double-check main component is in reachable set after BFS
        if (!reachableTractIds.has(mainComponentTractId)) {
          console.error(`❌ CRITICAL: Main component tract ${mainComponentTractId} missing from reachable set after BFS! Adding it now.`);
          reachableTractIds.add(mainComponentTractId);
        }
        
        // Verify we found the expected number of reachable tracts
        if (reachableTractIds.size !== mainComponentReachableCount) {
          console.warn(`⚠️ DETECT ISOLATED: Mismatch in reachable count for group ${group.startDistrictNumber}-${group.endDistrictNumber}: BFS found ${reachableTractIds.size}, expected ${mainComponentReachableCount}`);
        }
        
        // Find isolated tracts (in group but not reachable)
        // IMPORTANT: Do NOT include the main component tract itself as isolated
        const groupIsolatedTractIds = new Set();
        for (const tractId of groupTractIds) {
          // Skip null/undefined IDs
          if (!tractId) continue;
          
          // CRITICAL: Never mark the main component tract as isolated
          if (tractId === mainComponentTractId) {
            // Double-check it's in reachable set
            if (!reachableTractIds.has(tractId)) {
              console.error(`❌ CRITICAL BUG: Main component tract ${tractId} not in reachable set! Adding it now.`);
              reachableTractIds.add(tractId);
            }
            continue; // Skip main component tract
          }
          
          // Only mark as isolated if not reachable
          if (!reachableTractIds.has(tractId)) {
            groupIsolatedTractIds.add(tractId);
            isolatedTractIds.add(tractId);
          }
        }
        
        // Final safety check: ensure main component is never in isolated set
        if (groupIsolatedTractIds.has(mainComponentTractId)) {
          console.error(`❌ CRITICAL BUG: Main component tract ${mainComponentTractId} found in isolated set! Removing it.`);
          groupIsolatedTractIds.delete(mainComponentTractId);
          isolatedTractIds.delete(mainComponentTractId);
        }
        
        if (groupIsolatedTractIds.size > 0) {
          isolatedTractsByGroup.set(groupIndex, groupIsolatedTractIds);
          console.log(`🔍 Group ${group.startDistrictNumber}-${group.endDistrictNumber}: ${groupIsolatedTractIds.size} isolated tract(s) detected`);
          console.log(`   Main component: ${mainComponentTractId} (${mainComponentReachableCount} reachable)`);
          console.log(`   Total tracts: ${totalTractsInGroup}, Reachable: ${reachableTractIds.size}, Isolated: ${groupIsolatedTractIds.size}`);
          console.log(`   Main component in reachable set: ${reachableTractIds.has(mainComponentTractId)}`);
          console.log(`   Main component in isolated set: ${groupIsolatedTractIds.has(mainComponentTractId)}`);
          
          // Debug: Log first few isolated tract IDs
          const isolatedArray = Array.from(groupIsolatedTractIds).slice(0, 5);
          console.log(`   Sample isolated tracts: ${isolatedArray.join(', ')}`);
        }
      }
    }
    
    logger.debug(`✅ DETECT ISOLATED: Found ${isolatedTractIds.size} isolated tracts across ${isolatedTractsByGroup.size} groups`);
    
    return { isolatedTractsByGroup, isolatedTractIds, groupStats };
  }

  /**
   * Detect bridge tracts that could connect isolated tracts
   * Bridge tracts are tracts in other groups that are adjacent to isolated tracts
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {Map} isolatedTractsByGroup - Map of groupIndex -> Set of isolated tract IDs
   * @returns {Object} - Object with bridgeTractsByIsolatedGroup (Map of groupIndex -> Array of {tractId, fromGroupIndex, adjacentIsolatedCount})
   */
  detectBridgeTracts(districtGroups, allTracts, isolatedTractsByGroup) {
    logger.debug(`🌉 DETECT BRIDGE TRACTS: Starting bridge tract detection for ${isolatedTractsByGroup.size} groups with isolated tracts`);
    
    if (districtGroups.length < 2 || isolatedTractsByGroup.size === 0) {
      return { bridgeTractsByIsolatedGroup: new Map() };
    }
    
    // Build adjacency graph for all tracts
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    
    const bridgeTractsByIsolatedGroup = new Map(); // Map<isolatedGroupIndex, Array<{tractId, fromGroupIndex, adjacentIsolatedCount}>>
    
    // For each group with isolated tracts, find bridge tracts
    for (const [isolatedGroupIndex, isolatedTractIds] of isolatedTractsByGroup.entries()) {
      const isolatedGroup = districtGroups[isolatedGroupIndex];
      if (!isolatedGroup) continue;
      
      // Bridge tracts should ONLY come from the sibling group (the other half from the same parent division)
      // After a DG division, bridge tracts are only between the two sibling groups
      let siblingGroupIndex = null;
      const isolatedGroupDG = `DG${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`;
      
      // Find sibling_DG from any tract in the isolated group
      let siblingDG = null;
      for (const tract of isolatedGroup.censusTracts) {
        if (tract.properties?.sibling_DG) {
          siblingDG = tract.properties.sibling_DG;
          break;
        }
      }
      
      // Find the sibling group index
      if (siblingDG) {
        const match = siblingDG.match(/DG(\d+)-(\d+)/);
        if (match) {
          const siblingStart = parseInt(match[1], 10);
          const siblingEnd = parseInt(match[2], 10);
          for (let i = 0; i < districtGroups.length; i++) {
            if (districtGroups[i].startDistrictNumber === siblingStart &&
                districtGroups[i].endDistrictNumber === siblingEnd) {
              siblingGroupIndex = i;
              break;
            }
          }
        }
      }
      
      if (siblingGroupIndex === null) {
        console.warn(`⚠️ Cannot find sibling group for isolated group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}. Skipping bridge tract detection.`);
        continue; // Skip this isolated group if no sibling found
      }
      
      const siblingGroup = districtGroups[siblingGroupIndex];
      console.log(`   Bridge detection: ONLY looking for bridge tracts in sibling group ${siblingGroup.startDistrictNumber}-${siblingGroup.endDistrictNumber}`);
      
      const bridgeTracts = [];
      
      // Find all tracts in the SIBLING GROUP ONLY that are adjacent to isolated tracts
      // Bridge tracts should only come from the sibling group (the other half from the same parent division)
      const candidateBridgeTracts = new Map(); // Map<tractId, {fromGroupIndex, adjacentIsolatedCount}>
      
      for (const isolatedTractId of isolatedTractIds) {
        const neighbors = adjacencyGraph.get(isolatedTractId) || [];
        
        for (const neighborId of neighbors) {
          // Check if this neighbor is in the sibling group
          const hasNeighbor = siblingGroup.censusTracts.some(t => getTractId(t) === neighborId);
          
          if (hasNeighbor) {
            // This neighbor is a potential bridge tract (from the sibling group)
            if (!candidateBridgeTracts.has(neighborId)) {
              candidateBridgeTracts.set(neighborId, {
                tractId: neighborId,
                fromGroupIndex: siblingGroupIndex,
                adjacentIsolatedCount: 0
              });
            }
            candidateBridgeTracts.get(neighborId).adjacentIsolatedCount++;
          }
        }
      }
      
      // Filter bridge tracts: only include those that are good candidates
      // Since bridge tracts only come from the sibling group, we want to be careful not to break the sibling group
      // (adjacent to multiple isolated tracts or in a position to help)
      // For groups with many isolated tracts, be less restrictive
      const isolatedCount = isolatedTractIds.size;
      const isLargeIsolation = isolatedCount >= 10; // Many isolated tracts need more bridge options
      
      for (const bridgeTract of candidateBridgeTracts.values()) {
        // Check if this tract is in the main component of the sibling group
        const sourceGroup = siblingGroup; // Always the sibling group
        const sourceGroupMaxReachable = this.calculateMaxReachableCount(sourceGroup.censusTracts, adjacencyGraph);
        const tractReachableInSource = this.calculateReachableTracts(bridgeTract.tractId, sourceGroup.censusTracts, adjacencyGraph);
        const isInMainComponentOfSource = tractReachableInSource >= sourceGroupMaxReachable * 0.95;
        
        // Check if all neighbors are in the sibling group (fully embedded)
        const tractNeighbors = adjacencyGraph.get(bridgeTract.tractId) || [];
        const sourceGroupTractIds = new Set(sourceGroup.censusTracts.map(t => getTractId(t)));
        let neighborsInSourceGroup = 0;
        for (const neighborId of tractNeighbors) {
          if (sourceGroupTractIds.has(neighborId)) {
            neighborsInSourceGroup++;
          }
        }
        const allNeighborsInSource = neighborsInSourceGroup === tractNeighbors.length && tractNeighbors.length > 0;
        
        // Debug logging for all candidate bridge tracts (especially for District 5)
        const isDistrict5 = isolatedGroup.startDistrictNumber === 5 && isolatedGroup.endDistrictNumber === 5;
        if (isDistrict5 || bridgeTract.tractId === '010102' || bridgeTract.tractId.includes('010102')) {
          // Find the tract to get its properties
          const tract = allTracts.find(t => getTractId(t) === bridgeTract.tractId);
          console.log(`🔍 DEBUG Bridge tract ${bridgeTract.tractId}:`);
          console.log(`   From group: ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber}`);
          console.log(`   Tract properties: tract_DG=${tract?.properties?.tract_DG || 'missing'}, sibling_DG=${tract?.properties?.sibling_DG || 'missing'}, parent_DG=${tract?.properties?.parent_DG || 'missing'}`);
          console.log(`   Isolated group: ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}, sibling group: ${siblingGroup.startDistrictNumber}-${siblingGroup.endDistrictNumber}`);
          console.log(`   Adjacent to ${bridgeTract.adjacentIsolatedCount} isolated tracts`);
          console.log(`   In main component: ${isInMainComponentOfSource} (reachable: ${tractReachableInSource}, max: ${sourceGroupMaxReachable})`);
          console.log(`   All neighbors in source: ${allNeighborsInSource} (${neighborsInSourceGroup}/${tractNeighbors.length})`);
          console.log(`   Large isolation: ${isLargeIsolation}`);
        }
        
        // IMPORTANT: Only include bridge tracts that will actually help connect isolated siblings
        // A bridge tract should:
        // 1. Be adjacent to isolated tracts (already verified)
        // 2. When moved to the isolated group, help connect isolated tracts to the main component
        // 
        // To verify #2, we need to check:
        // - The bridge tract has neighbors in the isolated group's main component (so when moved, it connects to main component)
        // - Moving the bridge tract will create a path from isolated tracts to the main component
        const isolatedGroupTractIds = new Set(isolatedGroup.censusTracts.map(t => getTractId(t)));
        const isolatedGroupMaxReachable = this.calculateMaxReachableCount(isolatedGroup.censusTracts, adjacencyGraph);
        const bridgeTractNeighbors = adjacencyGraph.get(bridgeTract.tractId) || [];
        
        // Count neighbors that are in the isolated group's main component (not isolated tracts)
        // These are tracts in the isolated group that are reachable from the main component
        let neighborsInIsolatedMainComponent = 0;
        for (const neighborId of bridgeTractNeighbors) {
          if (isolatedGroupTractIds.has(neighborId) && !isolatedTractIds.has(neighborId)) {
            // This neighbor is in the isolated group but not an isolated tract (so it's in the main component)
            const neighborReachable = this.calculateReachableTracts(neighborId, isolatedGroup.censusTracts, adjacencyGraph);
            if (neighborReachable >= isolatedGroupMaxReachable * 0.95) {
              neighborsInIsolatedMainComponent++;
            }
          }
        }
        
        // A bridge tract will help connect if:
        // - It has neighbors in the isolated group's main component (so when moved, it connects to main component)
        //   AND it's adjacent to isolated tracts (so it can bridge the gap)
        // This means: moving the bridge tract will create a path from isolated tracts -> bridge tract -> main component
        const willHelpConnect = neighborsInIsolatedMainComponent > 0 && bridgeTract.adjacentIsolatedCount >= 1;
        
        // For large isolations, be slightly less restrictive but still require it to help connect
        let willInclude = false;
        if (isLargeIsolation) {
          // For large isolations, include if:
          // 1. Adjacent to at least 3 isolated tracts (high value, likely to help)
          // 2. OR has neighbors in main component AND adjacent to isolated tracts (will bridge the gap)
          willInclude = bridgeTract.adjacentIsolatedCount >= 3 || 
                       (neighborsInIsolatedMainComponent > 0 && bridgeTract.adjacentIsolatedCount >= 1);
        } else {
          // For small isolations, only include if it will actually help connect
          // Must have neighbors in main component AND be adjacent to isolated tracts
          willInclude = neighborsInIsolatedMainComponent > 0 && bridgeTract.adjacentIsolatedCount >= 1;
        }
        
        // Debug logging for specific tracts
        const isDistrict4 = isolatedGroup.startDistrictNumber === 4 && isolatedGroup.endDistrictNumber === 4;
        const isDebugTract = bridgeTract.tractId === '010102' || bridgeTract.tractId.includes('010102') || 
                            bridgeTract.tractId === '940100' || bridgeTract.tractId.includes('940100');
        if (isDistrict4 || isDistrict5 || isDebugTract) {
          console.log(`   Will include: ${willInclude} (adjacentIsolatedCount=${bridgeTract.adjacentIsolatedCount}, neighborsInIsolatedMainComponent=${neighborsInIsolatedMainComponent}, willHelpConnect=${willHelpConnect})`);
          if (!willInclude) {
            console.log(`   ❌ REJECTED: Bridge tract ${bridgeTract.tractId} will NOT help connect isolated tracts`);
            console.log(`      - Adjacent to ${bridgeTract.adjacentIsolatedCount} isolated tract(s)`);
            console.log(`      - Has ${neighborsInIsolatedMainComponent} neighbor(s) in isolated group's main component`);
          }
        }
        
        if (willInclude) {
          bridgeTracts.push(bridgeTract);
        }
      }
      
      // Sort by number of adjacent isolated tracts (best bridges first)
      bridgeTracts.sort((a, b) => b.adjacentIsolatedCount - a.adjacentIsolatedCount);
      
      // Debug logging for all groups with isolated tracts (not just large ones)
      console.log(`🔍 DEBUG Group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}: ${isolatedCount} isolated tracts`);
      console.log(`   Found ${candidateBridgeTracts.size} candidate bridge tracts, ${bridgeTracts.length} passed filters`);
      if (candidateBridgeTracts.size > 0 && bridgeTracts.length === 0) {
        console.log(`   ⚠️ All candidates filtered out! Top candidates:`);
        const sortedCandidates = Array.from(candidateBridgeTracts.values())
          .sort((a, b) => b.adjacentIsolatedCount - a.adjacentIsolatedCount)
          .slice(0, 5);
        for (const candidate of sortedCandidates) {
          const sourceGroup = districtGroups[candidate.fromGroupIndex];
          const tract = allTracts.find(t => getTractId(t) === candidate.tractId);
          const sourceGroupMaxReachable = this.calculateMaxReachableCount(sourceGroup.censusTracts, adjacencyGraph);
          const tractReachableInSource = this.calculateReachableTracts(candidate.tractId, sourceGroup.censusTracts, adjacencyGraph);
          const isInMainComponent = tractReachableInSource >= sourceGroupMaxReachable * 0.95;
          const tractNeighbors = adjacencyGraph.get(candidate.tractId) || [];
          const sourceGroupTractIds = new Set(sourceGroup.censusTracts.map(t => getTractId(t)));
          const neighborsInSource = tractNeighbors.filter(id => sourceGroupTractIds.has(id)).length;
          const allNeighborsInSource = neighborsInSource === tractNeighbors.length && tractNeighbors.length > 0;
          console.log(`     - ${candidate.tractId} (from ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber}, ${candidate.adjacentIsolatedCount} adjacent isolated, inMainComponent=${isInMainComponent}, allNeighborsInSource=${allNeighborsInSource})`);
        }
      }
      
      if (bridgeTracts.length > 0) {
        bridgeTractsByIsolatedGroup.set(isolatedGroupIndex, bridgeTracts);
        console.log(`🌉 Group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}: Found ${bridgeTracts.length} bridge tract(s)`);
        if (bridgeTracts.length > 0) {
          console.log(`   Top bridge: ${bridgeTracts[0].tractId} (from group ${bridgeTracts[0].fromGroupIndex}, ${bridgeTracts[0].adjacentIsolatedCount} adjacent isolated)`);
        }
      }
    }
    
    logger.debug(`✅ DETECT BRIDGE TRACTS: Found bridge tracts for ${bridgeTractsByIsolatedGroup.size} groups`);
    
    return { bridgeTractsByIsolatedGroup };
  }

  /**
   * Move bridge tracts to isolated group and re-run isolation detection
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {number} isolatedGroupIndex - Index of the group with isolated tracts
   * @param {Array} bridgeTractIds - Array of bridge tract IDs to move
   * @returns {Object} - Updated district groups and new isolation detection results
   */
  moveBridgeTractsAndRecheck(districtGroups, allTracts, isolatedGroupIndex, bridgeTractIds, divisionLines = null) {
    console.log(`🔄 MOVE BRIDGE TRACTS: Moving ${bridgeTractIds.length} bridge tract(s) to sibling group of isolated group ${isolatedGroupIndex}`);
    
    if (isolatedGroupIndex < 0 || isolatedGroupIndex >= districtGroups.length) {
      throw new Error(`Invalid isolated group index: ${isolatedGroupIndex}`);
    }
    
    const isolatedGroup = districtGroups[isolatedGroupIndex];
    if (!isolatedGroup) {
      throw new Error(`Group at index ${isolatedGroupIndex} not found`);
    }
    
    // Use sibling_DG from tract properties - every tract should have this set after division
    // Get sibling_DG from any tract in the isolated group
    let siblingDG = null;
    for (const tract of isolatedGroup.censusTracts) {
      if (tract.properties?.sibling_DG) {
        siblingDG = tract.properties.sibling_DG;
        console.log(`   Found sibling_DG from isolated group: ${siblingDG}`);
        break;
      }
    }
    
    // If sibling_DG is missing, try to set it from divisionLines metadata
    if (!siblingDG && divisionLines && Array.isArray(divisionLines)) {
      const sortedDivisionLines = [...divisionLines];
      if (sortedDivisionLines.some(dl => dl.step !== undefined)) {
        sortedDivisionLines.sort((a, b) => {
          const stepA = a.step !== undefined ? a.step : -1;
          const stepB = b.step !== undefined ? b.step : -1;
          return stepB - stepA;
        });
      } else {
        sortedDivisionLines.reverse();
      }
      
      for (const divLine of sortedDivisionLines) {
        if (divLine.siblingGroups && Array.isArray(divLine.siblingGroups) && divLine.siblingGroups.length === 2) {
          const isolatedMatches = divLine.siblingGroups.find(sibling => 
            sibling.startDistrictNumber === isolatedGroup.startDistrictNumber &&
            sibling.endDistrictNumber === isolatedGroup.endDistrictNumber
          );
          
          if (isolatedMatches) {
            const otherSibling = divLine.siblingGroups.find(sibling =>
              !(sibling.startDistrictNumber === isolatedGroup.startDistrictNumber &&
                sibling.endDistrictNumber === isolatedGroup.endDistrictNumber)
            );
            
            if (otherSibling) {
              siblingDG = `DG${otherSibling.startDistrictNumber}-${otherSibling.endDistrictNumber}`;
              console.log(`   Set sibling_DG from divisionLines: ${siblingDG}`);
              break;
            }
          }
        }
      }
    }
    
    // Find group index matching sibling_DG
    let siblingGroupIndex = null;
    if (siblingDG) {
      const match = siblingDG.match(/DG(\d+)-(\d+)/);
      if (match) {
        const siblingStart = parseInt(match[1], 10);
        const siblingEnd = parseInt(match[2], 10);
        
        for (let i = 0; i < districtGroups.length; i++) {
          if (districtGroups[i].startDistrictNumber === siblingStart &&
              districtGroups[i].endDistrictNumber === siblingEnd) {
            siblingGroupIndex = i;
            break;
          }
        }
      }
    }
    
    if (siblingGroupIndex === null) {
      throw new Error(`Cannot find sibling group for isolated group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}. sibling_DG should be set on all tracts after division.`);
    }
    
    const siblingGroup = districtGroups[siblingGroupIndex];
    console.log(`   Moving bridge tracts from sibling group ${siblingGroup.startDistrictNumber}-${siblingGroup.endDistrictNumber} to isolated group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
    
    // Move bridge tracts FROM the sibling group TO the isolated group to connect isolated tracts
    // Bridge tracts are detected in the sibling group (adjacent to isolated tracts) and should be moved to the isolated group
    return this._moveBridgeTractsToGroup(districtGroups, allTracts, isolatedGroupIndex, bridgeTractIds, isolatedGroupIndex);
  }

  /**
   * Helper method to move bridge tracts to a target group
   * @private
   */
  _moveBridgeTractsToGroup(districtGroups, allTracts, isolatedGroupIndex, bridgeTractIds, targetGroupIndex) {
    // Create a copy of district groups to modify
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    const targetGroup = updatedGroups[targetGroupIndex];
    let movedCount = 0;
    
    // Move each bridge tract
    for (const bridgeTractId of bridgeTractIds) {
      // Find which group contains this bridge tract
      let sourceGroupIndex = -1;
      let sourceGroup = null;
      let bridgeTract = null;
      
      for (let i = 0; i < updatedGroups.length; i++) {
        const tract = updatedGroups[i].censusTracts.find(t => getTractId(t) === bridgeTractId);
        if (tract) {
          sourceGroupIndex = i;
          sourceGroup = updatedGroups[i];
          bridgeTract = tract;
          break;
        }
      }
      
      if (!bridgeTract || !sourceGroup) {
        console.warn(`⚠️ Bridge tract ${bridgeTractId} not found in any group, skipping`);
        continue;
      }
      
      if (sourceGroupIndex === targetGroupIndex) {
        console.warn(`⚠️ Bridge tract ${bridgeTractId} is already in target group, skipping`);
        continue;
      }
      
      // Remove from source group
      const tractIndex = sourceGroup.censusTracts.findIndex(t => getTractId(t) === bridgeTractId);
      if (tractIndex === -1) {
        console.warn(`⚠️ Bridge tract ${bridgeTractId} not found in source group, skipping`);
        continue;
      }
      
      sourceGroup.censusTracts.splice(tractIndex, 1);
      
      // Update source group stats
      sourceGroup.totalPopulation = sourceGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
      sourceGroup.bounds = calculateBounds(sourceGroup.censusTracts);
      sourceGroup.centroid = calculateCentroid(sourceGroup.censusTracts);
      
      // Add to target group (avoid duplicates)
      if (!targetGroup.censusTracts.some(t => getTractId(t) === bridgeTractId)) {
        targetGroup.censusTracts.push(bridgeTract);
        movedCount++;
        
        // SWAP tract_DG with sibling_DG (as per user requirement)
        // When moving bridge tract, ALWAYS swap: tract_DG <-> sibling_DG
        // This is the core requirement - just swap the values, don't override
        if (bridgeTract.properties) {
          const oldTractDG = bridgeTract.properties.tract_DG;
          const oldSiblingDG = bridgeTract.properties.sibling_DG;
          const sourceDG = `DG${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber}`;
          const targetDG = `DG${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`;
          
          if (oldTractDG && oldSiblingDG && oldTractDG !== oldSiblingDG) {
            // Normal case: ALWAYS swap tract_DG and sibling_DG (don't override)
            bridgeTract.properties.tract_DG = oldSiblingDG;
            bridgeTract.properties.sibling_DG = oldTractDG;
            
            console.log(`✅ Moved bridge tract ${bridgeTractId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
            console.log(`   Swapped DG: tract_DG=${oldTractDG} -> ${bridgeTract.properties.tract_DG}, sibling_DG=${oldSiblingDG} -> ${bridgeTract.properties.sibling_DG}`);
            
            // Log warning if swapped tract_DG doesn't match target, but don't override the swap
            if (bridgeTract.properties.tract_DG !== targetDG) {
              console.warn(`⚠️ After swap, tract_DG (${bridgeTract.properties.tract_DG}) doesn't match target group (${targetDG}). Keeping swap as-is per user requirement.`);
            }
          } else if (oldTractDG === oldSiblingDG || !oldSiblingDG) {
            // Edge case: both are the same or sibling_DG is missing - set directly
            bridgeTract.properties.tract_DG = targetDG;
            bridgeTract.properties.sibling_DG = sourceDG;
            console.log(`✅ Moved bridge tract ${bridgeTractId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
            console.log(`   Set DG: tract_DG=${oldTractDG || 'missing'} -> ${targetDG}, sibling_DG=${oldSiblingDG || 'missing'} -> ${sourceDG}`);
          } else {
            // Update tract_DG to match target group if properties missing
            if (!bridgeTract.properties.tract_DG) {
              bridgeTract.properties.tract_DG = targetDG;
            }
            if (!bridgeTract.properties.sibling_DG) {
              bridgeTract.properties.sibling_DG = sourceDG;
            }
            console.log(`✅ Moved bridge tract ${bridgeTractId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
          }
        } else {
          console.log(`✅ Moved bridge tract ${bridgeTractId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
        }
      }
    }
    
    // Update target group stats
    targetGroup.totalPopulation = targetGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    targetGroup.bounds = calculateBounds(targetGroup.censusTracts);
    targetGroup.centroid = calculateCentroid(targetGroup.censusTracts);
    
    console.log(`✅ Moved ${movedCount} bridge tract(s) to target group`);
    
    // Re-run isolation detection
    console.log(`🔍 Re-running isolation detection after moving bridge tracts...`);
    const isolationResult = this.detectIsolatedTracts(updatedGroups, allTracts);
    
    return {
      districtGroups: updatedGroups,
      isolationResult
    };
  }


  /**
   * Move isolated tracts to opposite group (sibling group from same parent division) and re-run isolation detection
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {number} isolatedGroupIndex - Index of the group with isolated tracts
   * @param {Array} isolatedTractIds - Array of isolated tract IDs to move
   * @param {Array} divisionLines - Optional array of division line metadata with sibling relationships
   * @returns {Object} - Updated district groups and new isolation detection results
   */
  moveIsolatedTractsToOppositeGroup(districtGroups, allTracts, isolatedGroupIndex, isolatedTractIds, divisionLines = null) {
    console.log(`🔄 MOVE ISOLATED TRACTS: Moving ${isolatedTractIds.length} isolated tract(s) from group ${isolatedGroupIndex} to opposite group`);
    
    if (isolatedGroupIndex < 0 || isolatedGroupIndex >= districtGroups.length) {
      throw new Error(`Invalid isolated group index: ${isolatedGroupIndex}`);
    }
    
    const isolatedGroup = districtGroups[isolatedGroupIndex];
    if (!isolatedGroup) {
      throw new Error(`Group at index ${isolatedGroupIndex} not found`);
    }
    
    // Use sibling_DG from tract properties - every tract should have this set after division
    // Siblings are always the two DGs from dividing a parent DG (e.g., DG6-7 -> DG6-6/DG7-7)
    let siblingDG = null;
    const isolatedGroupDG = `DG${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`;
    
    // Find sibling_DG from isolated tracts' properties
    // All isolated tracts in the same group should have the same sibling_DG
    for (const tract of isolatedGroup.censusTracts) {
      const tractId = getTractId(tract);
      if (isolatedTractIds.includes(tractId) && tract.properties?.sibling_DG) {
        siblingDG = tract.properties.sibling_DG;
        console.log(`   Found sibling_DG from isolated tract properties: ${siblingDG} (tract ${tractId}, tract_DG=${tract.properties.tract_DG}, parent_DG=${tract.properties.parent_DG})`);
        break;
      }
    }
    
    // If not found in isolated group, try from allTracts
    if (!siblingDG) {
      for (const tractId of isolatedTractIds) {
        const tract = allTracts.find(t => getTractId(t) === tractId);
        if (tract && tract.properties?.sibling_DG) {
          siblingDG = tract.properties.sibling_DG;
          console.log(`   Found sibling_DG from allTracts: ${siblingDG} (tract ${tractId}, tract_DG=${tract.properties.tract_DG}, parent_DG=${tract.properties.parent_DG})`);
          break;
        } else if (tract) {
          console.log(`   Tract ${tractId} properties: tract_DG=${tract.properties?.tract_DG || 'missing'}, parent_DG=${tract.properties?.parent_DG || 'missing'}, sibling_DG=${tract.properties?.sibling_DG || 'missing'}`);
        }
      }
    }
    
    // If sibling_DG is missing, try to set it from divisionLines metadata
    // This fixes data integrity issues where sibling_DG wasn't set during division or reconstruction
    if (!siblingDG && divisionLines && Array.isArray(divisionLines)) {
      console.log(`   sibling_DG missing from tract properties, attempting to set from divisionLines`);
      
      // Sort division lines by step (most recent first)
      const sortedDivisionLines = [...divisionLines];
      if (sortedDivisionLines.some(dl => dl.step !== undefined)) {
        sortedDivisionLines.sort((a, b) => {
          const stepA = a.step !== undefined ? a.step : -1;
          const stepB = b.step !== undefined ? b.step : -1;
          return stepB - stepA; // Most recent first
        });
      } else {
        sortedDivisionLines.reverse();
      }
      
      // Find the division that created this isolated group
      for (const divLine of sortedDivisionLines) {
        if (divLine.siblingGroups && Array.isArray(divLine.siblingGroups) && divLine.siblingGroups.length === 2) {
          const isolatedMatches = divLine.siblingGroups.find(sibling => 
            sibling.startDistrictNumber === isolatedGroup.startDistrictNumber &&
            sibling.endDistrictNumber === isolatedGroup.endDistrictNumber
          );
          
          if (isolatedMatches) {
            // Found the division - get the other sibling
            const otherSibling = divLine.siblingGroups.find(sibling =>
              !(sibling.startDistrictNumber === isolatedGroup.startDistrictNumber &&
                sibling.endDistrictNumber === isolatedGroup.endDistrictNumber)
            );
            
            if (otherSibling) {
              siblingDG = `DG${otherSibling.startDistrictNumber}-${otherSibling.endDistrictNumber}`;
              console.log(`   Set sibling_DG from divisionLines: ${siblingDG} (parent: ${divLine.parentGroup?.startDistrictNumber || 'unknown'}-${divLine.parentGroup?.endDistrictNumber || 'unknown'})`);
              
              // Update all isolated tracts with the correct sibling_DG
              // Always update sibling_DG to match the current division, even if it was previously set
              // This fixes cases where tracts were moved between groups and have stale sibling_DG values
              for (const tractId of isolatedTractIds) {
                const tract = allTracts.find(t => getTractId(t) === tractId);
                if (tract) {
                  if (!tract.properties) tract.properties = {};
                  const oldSiblingDG = tract.properties.sibling_DG;
                  tract.properties.sibling_DG = siblingDG;
                  const parentDG = divLine.parentGroup ? `DG${divLine.parentGroup.startDistrictNumber}-${divLine.parentGroup.endDistrictNumber}` : null;
                  if (parentDG) {
                    tract.properties.parent_DG = parentDG; // Always update parent_DG to match current division
                  }
                  if (oldSiblingDG && oldSiblingDG !== siblingDG) {
                    console.log(`   Updated stale sibling_DG for tract ${tractId}: ${oldSiblingDG} -> ${siblingDG}`);
                  } else if (!oldSiblingDG) {
                    console.log(`   Fixed missing sibling_DG for tract ${tractId}`);
                  }
                }
              }
              break;
            }
          }
        }
      }
    }
    
    // Find group index matching sibling_DG
    let siblingGroupIndex = null;
    if (siblingDG) {
      // Parse sibling_DG to find matching group (format: "DG6-7" -> startDistrictNumber=6, endDistrictNumber=7)
      const match = siblingDG.match(/DG(\d+)-(\d+)/);
      if (match) {
        const siblingStart = parseInt(match[1], 10);
        const siblingEnd = parseInt(match[2], 10);
        
        // Find group index matching sibling_DG
        for (let i = 0; i < districtGroups.length; i++) {
          if (districtGroups[i].startDistrictNumber === siblingStart &&
              districtGroups[i].endDistrictNumber === siblingEnd) {
            siblingGroupIndex = i;
            console.log(`   Found target group from sibling_DG: ${siblingDG} -> group index ${i}`);
            break;
          }
        }
      }
    }
    
    if (siblingGroupIndex === null) {
      throw new Error(`Cannot find sibling group for isolated group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}. sibling_DG should be set on all tracts after division.`);
    }
    
    const siblingGroup = districtGroups[siblingGroupIndex];
    console.log(`   Moving isolated tracts from ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber} to sibling group ${siblingGroup.startDistrictNumber}-${siblingGroup.endDistrictNumber}`);
    
    // Validate that sibling group index is valid
    if (siblingGroupIndex < 0 || siblingGroupIndex >= districtGroups.length) {
      throw new Error(`Invalid sibling group index: ${siblingGroupIndex} (total groups: ${districtGroups.length})`);
    }
    
    // Log which tracts are being moved for debugging
    console.log(`   Moving ${isolatedTractIds.length} isolated tract(s): ${isolatedTractIds.slice(0, 5).join(', ')}${isolatedTractIds.length > 5 ? '...' : ''}`);
    
    return this._moveTractsToGroup(districtGroups, allTracts, isolatedGroupIndex, isolatedTractIds, siblingGroupIndex);
  }

  /**
   * Helper method to move tracts from one group to another
   * @private
   */
  _moveTractsToGroup(districtGroups, allTracts, sourceGroupIndex, tractIds, targetGroupIndex) {
    // Create a copy of district groups to modify
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    const sourceGroup = updatedGroups[sourceGroupIndex];
    const targetGroup = updatedGroups[targetGroupIndex];
    let movedCount = 0;
    
    // Build adjacency graph for checking if tracts will still be isolated after move
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    
    // Move all isolated tracts to the target group
    for (const tractId of tractIds) {
      // CRITICAL: Remove tract from ALL groups first to prevent duplicates
      // This ensures the tract is only in the target group after the move
      let tract = null;
      let foundInGroups = [];
      
      // Find and remove tract from all groups
      for (let i = 0; i < updatedGroups.length; i++) {
        const group = updatedGroups[i];
        const tractIndex = group.censusTracts.findIndex(t => getTractId(t) === tractId);
        if (tractIndex !== -1) {
          if (!tract) {
            // Store the tract object from first occurrence
            tract = group.censusTracts[tractIndex];
          }
          // Remove from this group
          group.censusTracts.splice(tractIndex, 1);
          foundInGroups.push(`${group.startDistrictNumber}-${group.endDistrictNumber}`);
        }
      }
      
      if (!tract) {
        console.warn(`⚠️ Isolated tract ${tractId} not found in any group, skipping`);
        continue;
      }
      
      // Log if tract was found in multiple groups (duplicate issue)
      if (foundInGroups.length > 1) {
        console.warn(`⚠️ DUPLICATE TRACT: Tract ${tractId} was found in ${foundInGroups.length} groups: ${foundInGroups.join(', ')}. Removing from all before moving to target.`);
      }
      
      // Check if tract will still be isolated in target group (prevent infinite loops)
      // If tract has no neighbors in target group, it will remain isolated - skip move
      const neighbors = adjacencyGraph.get(tractId) || [];
      const hasNeighborInTarget = neighbors.some(neighborId => 
        targetGroup.censusTracts.some(t => getTractId(t) === neighborId)
      );
      
      if (!hasNeighborInTarget && targetGroup.censusTracts.length > 0) {
        console.warn(`⚠️ SKIPPING MOVE: Tract ${tractId} has no neighbors in target group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}, would remain isolated. Not moving to prevent infinite loop.`);
        // Put tract back in source group since we're not moving it
        if (!sourceGroup.censusTracts.some(t => getTractId(t) === tractId)) {
          sourceGroup.censusTracts.push(tract);
        }
        continue;
      }
      
      // Add to target group (avoid duplicates - though we just removed it from all groups)
      if (!targetGroup.censusTracts.some(t => getTractId(t) === tractId)) {
        targetGroup.censusTracts.push(tract);
        movedCount++;
        
        // SWAP tract_DG with sibling_DG (as per user requirement)
        // When moving isolated tract, swap: tract_DG <-> sibling_DG
        if (tract.properties) {
          const oldTractDG = tract.properties.tract_DG;
          const oldSiblingDG = tract.properties.sibling_DG;
          const sourceDG = foundInGroups.length > 0 ? `DG${foundInGroups[0].split('-')[0]}-${foundInGroups[0].split('-')[1]}` : null;
          const targetDG = `DG${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`;
          
          if (oldTractDG && oldSiblingDG && oldTractDG !== oldSiblingDG) {
            // Normal case: swap tract_DG and sibling_DG
            tract.properties.tract_DG = oldSiblingDG;
            tract.properties.sibling_DG = oldTractDG;
            
            // Verify the new tract_DG matches the target group
            if (tract.properties.tract_DG !== targetDG) {
              console.warn(`⚠️ After swap, tract_DG (${tract.properties.tract_DG}) doesn't match target group (${targetDG})`);
              // Fix it: set tract_DG to target and sibling_DG to source (or old tract_DG if source not available)
              tract.properties.tract_DG = targetDG;
              tract.properties.sibling_DG = sourceDG || oldTractDG;
            }
            
            console.log(`✅ Moved isolated tract ${tractId} from group(s) ${foundInGroups.join(', ')} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}${hasNeighborInTarget ? ' (has neighbors in target)' : ''}`);
            console.log(`   Swapped DG: tract_DG=${oldTractDG} -> ${tract.properties.tract_DG}, sibling_DG=${oldSiblingDG} -> ${tract.properties.sibling_DG}`);
          } else if (oldTractDG === oldSiblingDG || !oldSiblingDG) {
            // Edge case: both are the same or sibling_DG is missing - set directly instead of swapping
            tract.properties.tract_DG = targetDG;
            tract.properties.sibling_DG = sourceDG || oldTractDG;
            console.log(`✅ Moved isolated tract ${tractId} from group(s) ${foundInGroups.join(', ')} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}${hasNeighborInTarget ? ' (has neighbors in target)' : ''}`);
            console.log(`   Set DG: tract_DG=${oldTractDG || 'missing'} -> ${targetDG}, sibling_DG=${oldSiblingDG || 'missing'} -> ${tract.properties.sibling_DG}`);
          } else {
            // Update tract_DG to match target group if properties missing
            if (!tract.properties.tract_DG) {
              tract.properties.tract_DG = targetDG;
            }
            if (!tract.properties.sibling_DG) {
              tract.properties.sibling_DG = sourceDG || oldTractDG;
            }
            console.log(`✅ Moved isolated tract ${tractId} from group(s) ${foundInGroups.join(', ')} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}${hasNeighborInTarget ? ' (has neighbors in target)' : ''}`);
          }
        } else {
          console.log(`✅ Moved isolated tract ${tractId} from group(s) ${foundInGroups.join(', ')} to ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}${hasNeighborInTarget ? ' (has neighbors in target)' : ''}`);
        }
      } else {
        console.warn(`⚠️ Tract ${tractId} already exists in target group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}, skipping add`);
      }
    }
    
    // Update group stats
    sourceGroup.totalPopulation = sourceGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    sourceGroup.bounds = calculateBounds(sourceGroup.censusTracts);
    sourceGroup.centroid = calculateCentroid(sourceGroup.censusTracts);
    
    targetGroup.totalPopulation = targetGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    targetGroup.bounds = calculateBounds(targetGroup.censusTracts);
    targetGroup.centroid = calculateCentroid(targetGroup.censusTracts);
    
    console.log(`✅ Moved ${movedCount} isolated tract(s) to opposite group`);
    
    // Re-run isolation detection
    console.log(`🔍 Re-running isolation detection after moving isolated tracts...`);
    const isolationResult = this.detectIsolatedTracts(updatedGroups, allTracts);
    
    return {
      districtGroups: updatedGroups,
      isolationResult
    };
  }

  /**
   * Resolve isolation for a step: detect isolated, detect bridge, move bridge, move remaining isolated
   * This is the complete isolation resolution flow used in the "run all steps" execution
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {Array} divisionLines - Optional array of division line metadata with sibling relationships
   * @returns {Object} - Updated district groups and isolation resolution summary
   */
  resolveIsolationForStep(districtGroups, allTracts, divisionLines = null) {
    logger.debug(`🔧 RESOLVE ISOLATION: Starting isolation resolution for ${districtGroups.length} groups`);
    
    let updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    let totalIsolatedMoved = 0;
    let totalBridgeMoved = 0;
    let resolutionIterations = 0;
    const maxResolutionIterations = 10; // Safety limit
    
    // Recursively resolve until no more isolated tracts remain
    while (resolutionIterations < maxResolutionIterations) {
      resolutionIterations++;
      logger.debug(`🔧 Resolution iteration ${resolutionIterations}`);
      
      // Step 1: Detect isolated tracts
      const isolationResult = this.detectIsolatedTracts(updatedGroups, allTracts);
      
      if (isolationResult.isolatedTractIds.size === 0) {
        logger.debug(`✅ No isolated tracts found after iteration ${resolutionIterations - 1}`);
        break;
      }
      
      logger.debug(`   Found ${isolationResult.isolatedTractIds.size} isolated tracts in ${isolationResult.isolatedTractsByGroup.size} groups`);
      
      // Convert Map to object for bridge detection
      const isolatedTractsByGroupMap = new Map();
      isolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroupMap.set(groupIndex, tractIds);
      });
      
      // Step 2: Detect bridge tracts
      const bridgeResult = this.detectBridgeTracts(updatedGroups, allTracts, isolatedTractsByGroupMap);
      
      let bridgeMovedThisIteration = 0;
      
      // Step 3: Move bridge tracts (if any)
      if (bridgeResult.bridgeTractsByIsolatedGroup.size > 0) {
        logger.debug(`   Found bridge tracts for ${bridgeResult.bridgeTractsByIsolatedGroup.size} groups`);
        
        const isolationCountBeforeBridge = isolationResult.isolatedTractIds.size;
        
        for (const [isolatedGroupIndex, bridgeTracts] of bridgeResult.bridgeTractsByIsolatedGroup.entries()) {
          const bridgeTractIds = bridgeTracts.map(bt => bt.tractId);
          logger.debug(`   Moving ${bridgeTractIds.length} bridge tract(s) for isolated group ${isolatedGroupIndex}`);
          
          const moveResult = this.moveBridgeTractsAndRecheck(
            updatedGroups,
            allTracts,
            isolatedGroupIndex,
            bridgeTractIds,
            divisionLines
          );
          
          updatedGroups = moveResult.districtGroups;
          bridgeMovedThisIteration += bridgeTractIds.length;
        }
        
        totalBridgeMoved += bridgeMovedThisIteration;
        logger.debug(`   Moved ${bridgeMovedThisIteration} bridge tract(s) this iteration`);
        
        // Re-detect isolation after moving bridge tracts
        const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts);
        
        // Check if bridge tract movement actually helped (reduced isolation count)
        if (isolationAfterBridge.isolatedTractIds.size >= isolationCountBeforeBridge) {
          logger.debug(`⚠️ Bridge tract movement did not reduce isolation (${isolationCountBeforeBridge} -> ${isolationAfterBridge.isolatedTractIds.size}), skipping bridge tracts in future iterations for this step`);
          // Don't break, continue to move isolated tracts directly
        } else {
          logger.debug(`✅ Bridge tract movement reduced isolation from ${isolationCountBeforeBridge} to ${isolationAfterBridge.isolatedTractIds.size}`);
        }
        
        if (isolationAfterBridge.isolatedTractIds.size === 0) {
          logger.debug(`✅ All isolation resolved after moving bridge tracts`);
          break;
        }
      }
      
      // Step 4: Move remaining isolated tracts
      const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts);
      if (isolationAfterBridge.isolatedTractIds.size > 0) {
        // Process each group with isolated tracts
        for (const [groupIndex, isolatedTractIds] of isolationAfterBridge.isolatedTractsByGroup.entries()) {
          const isolatedTractIdsArray = Array.from(isolatedTractIds);
          logger.debug(`   Moving ${isolatedTractIdsArray.length} isolated tract(s) from group ${groupIndex}`);
          
          const moveResult = this.moveIsolatedTractsToOppositeGroup(
            updatedGroups,
            allTracts,
            groupIndex,
            isolatedTractIdsArray,
            divisionLines
          );
          
          updatedGroups = moveResult.districtGroups;
          totalIsolatedMoved += isolatedTractIdsArray.length;
        }
      }
      
      // Check if we're done
      const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts);
      if (finalIsolation.isolatedTractIds.size === 0) {
        logger.info(`✅ All isolation resolved after ${resolutionIterations} iteration(s)`);
        break;
      }
      
      logger.debug(`   Still have ${finalIsolation.isolatedTractIds.size} isolated tracts, continuing...`);
    }
    
    if (resolutionIterations >= maxResolutionIterations) {
      logger.warn(`⚠️ Reached max resolution iterations (${maxResolutionIterations})`);
    }
    
    // Final isolation check
    const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts);
    
    logger.info(`✅ RESOLVE ISOLATION: Completed - moved ${totalBridgeMoved} bridge tracts, ${totalIsolatedMoved} isolated tracts, ${finalIsolation.isolatedTractIds.size} remaining isolated`);
    
    return {
      districtGroups: updatedGroups,
      resolutionSummary: {
        bridgeTractsMoved: totalBridgeMoved,
        isolatedTractsMoved: totalIsolatedMoved,
        remainingIsolated: finalIsolation.isolatedTractIds.size,
        iterations: resolutionIterations
      },
      finalIsolation: {
        isolatedTractsByGroup: Object.fromEntries(
          Array.from(finalIsolation.isolatedTractsByGroup.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        isolatedTractIds: Array.from(finalIsolation.isolatedTractIds),
        totalIsolated: finalIsolation.isolatedTractIds.size
      }
    };
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
          const isolatedTractIdArray = [];
          for (const tractId of groupTractIds) {
            if (!reachableTractIds.has(tractId)) {
              isolatedTractIds.add(tractId);
              isolatedTractIdArray.push(tractId);
              if (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('320903') || tractId.includes('940013') || tractId.includes('020102')) {
                console.log(`🔍 ISOLATION CHECK: Tract ${tractId} is isolated in group ${group.startDistrictNumber}-${group.endDistrictNumber} (iteration ${iteration})`);
              }
            }
          }

          console.log(`🔍 Group ${group.startDistrictNumber}-${group.endDistrictNumber}: max component size ${maxReachableCount}/${totalTractsInGroup} - ${isolatedCount} isolated tract(s) detected: ${isolatedTractIdArray.join(', ')}`);
          
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
          let shouldMoveBridgeTract = false;
          let bridgeTractMoveSucceeded = false;
          
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
            
            shouldMoveBridgeTract = true;
            
            if (isInMainComponentOfSource || allNeighborsInSource) {
              if (tractToMoveId.includes('940013') || tractToMoveId.includes('020102')) {
                console.log(`⚠️ Skipping move of tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} - tract is in main component (reachable: ${tractReachableInSource}/${sourceGroupMaxReachable}) or all ${neighborsInSourceGroup}/${tractNeighbors.length} neighbors are in source group`);
              }
              // Don't move this tract - it's in the main component of its current group or fully embedded
              shouldMoveBridgeTract = false;
            } else {
              // Check if this tract would be isolated in the target group
              // Simulate adding it to the target group and check connectivity
              const targetGroupTractIds = new Set(targetGroup.censusTracts.map(t => getTractId(t)));
              targetGroupTractIds.add(tractToMoveId);
              
              // Check if tract has neighbors in target group
              let hasNeighborInTarget = false;
              for (const neighborId of tractNeighbors) {
                if (targetGroupTractIds.has(neighborId)) {
                  hasNeighborInTarget = true;
                  break;
                }
              }
              
              // If tract has no neighbors in target group, it would be isolated - skip moving it
              if (!hasNeighborInTarget) {
                if (tractToMoveId.includes('940013') || tractToMoveId.includes('020102')) {
                  console.log(`⚠️ Skipping move of tract ${tractToMoveId} from group ${sourceGroup.startDistrictNumber}-${sourceGroup.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} - would be isolated (no neighbors in target group)`);
                }
                // Don't move this tract - it would become isolated in the target group
                shouldMoveBridgeTract = false;
              }
            }
            
            // Move the bridge tract (only if it won't be isolated)
            if (shouldMoveBridgeTract && moveTract(bestTractToMove, bestTractGroupIndex, groupIndex)) {
              bridgeTractMoveSucceeded = true;
              totalMoved++;
            if (tractToMoveId.includes('320903') || tractToMoveId.includes('940013') || tractToMoveId.includes('020102')) {
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
            } else if (!shouldMoveBridgeTract) {
              // Bridge tract was found but rejected - fall through to direct move
              const tractToMoveId = getTractId(bestTractToMove);
              console.log(`⚠️ Bridge tract ${tractToMoveId} found but rejected - falling through to direct isolated tract move`);
            }
          }
          
          // If no bridge tract was moved, try moving isolated tracts directly
          if (!bridgeTractMoveSucceeded) {
            // No bridge tract found - move isolated tracts directly to other groups
            console.log(`⚠️ No bridge tract found - moving isolated tracts directly to adjacent groups`);

            // Find the best target group for isolated tracts (one with the most adjacent neighbors)
            let bestTargetGroupIndex = -1;
            let maxAdjacentCount = 0;

            console.log(`🔍 Finding target groups for ${isolatedTractIds.size} isolated tracts in group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
            console.log(`🔍 Isolated tract IDs: ${Array.from(isolatedTractIds).join(', ')}`);
            
            // Debug logging for specific tract
            if (Array.from(isolatedTractIds).some(id => id.includes('020102'))) {
              console.log(`🔍 DEBUG: Tract 020102 is in isolated set for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
            }

            for (let otherGroupIndex = 0; otherGroupIndex < updatedGroups.length; otherGroupIndex++) {
              if (otherGroupIndex === groupIndex) continue;

              const otherGroup = updatedGroups[otherGroupIndex];
              const otherGroupTractIds = new Set(otherGroup.censusTracts.map(t => getTractId(t)));

              // Count how many isolated tracts have neighbors in this other group
              let adjacentCount = 0;
              const adjacentIsolated = new Set();

              for (const isolatedTractId of isolatedTractIds) {
                const neighbors = adjacencyGraph.get(isolatedTractId) || [];
                console.log(`🔍 Tract ${isolatedTractId} has ${neighbors.length} neighbors: ${neighbors.slice(0, 5).join(', ')}${neighbors.length > 5 ? '...' : ''}`);

                for (const neighborId of neighbors) {
                  if (otherGroupTractIds.has(neighborId)) {
                    adjacentCount++;
                    adjacentIsolated.add(isolatedTractId);
                    console.log(`🔍 Tract ${isolatedTractId} has neighbor ${neighborId} in group ${otherGroup.startDistrictNumber}-${otherGroup.endDistrictNumber}`);
                    break; // Count each isolated tract only once
                  }
                }
              }

              console.log(`🔍 Group ${otherGroup.startDistrictNumber}-${otherGroup.endDistrictNumber}: ${adjacentCount} adjacent isolated tracts (${Array.from(adjacentIsolated).join(', ')})`);

              if (adjacentCount > maxAdjacentCount) {
                maxAdjacentCount = adjacentCount;
                bestTargetGroupIndex = otherGroupIndex;
              }
            }

            console.log(`🔍 Best target group: ${bestTargetGroupIndex !== -1 ? updatedGroups[bestTargetGroupIndex].startDistrictNumber + '-' + updatedGroups[bestTargetGroupIndex].endDistrictNumber : 'none'} with ${maxAdjacentCount} adjacent tracts`);

            // Move isolated tracts to the best target group
            if (bestTargetGroupIndex !== -1) {
              const targetGroup = updatedGroups[bestTargetGroupIndex];
              let totalPopulationMoved = 0;

              console.log(`🔄 Moving ${isolatedTractIds.size} isolated tracts to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);

              // Move all isolated tracts to the target group
              const isolatedTractsToMove = Array.from(isolatedTractIds);
              for (const isolatedTractId of isolatedTractsToMove) {
                const isolatedTract = group.censusTracts.find(t => getTractId(t) === isolatedTractId);
                if (isolatedTract && moveTract(isolatedTract, groupIndex, bestTargetGroupIndex)) {
                  totalMoved++;
                  totalPopulationMoved += isolatedTract.properties?.POPULATION || 0;
                  if (isolatedTractId.includes('940013') || isolatedTractId.includes('020102')) {
                    console.log(`🔄 Moved isolated tract ${isolatedTractId} from group ${group.startDistrictNumber}-${group.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
                  }
                } else if (isolatedTractId.includes('020102')) {
                  console.log(`⚠️ Failed to move isolated tract ${isolatedTractId} from group ${group.startDistrictNumber}-${group.endDistrictNumber} to group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}`);
                }
              }

              // Balance population by moving tracts back from target group to source group
              // But don't move the tracts we just moved for isolation fixing
              if (totalPopulationMoved > 0) {
                const adjacentTractsInTarget = findAdjacentTracts(new Set(isolatedTractsToMove), bestTargetGroupIndex);
                let populationToBalance = totalPopulationMoved;

                for (const adjacentTract of adjacentTractsInTarget) {
                  const adjacentTractId = getTractId(adjacentTract);
                  // Don't move back the tracts we just moved
                  if (isolatedTractsToMove.includes(adjacentTractId)) continue;

                  const adjacentPopulation = adjacentTract.properties?.POPULATION || 0;
                  if (moveTract(adjacentTract, bestTargetGroupIndex, groupIndex)) {
                    totalMoved++;
                    populationToBalance -= adjacentPopulation;
                    console.log(`🔄 Balanced population: moved tract ${adjacentTractId} back from group ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber} to group ${group.startDistrictNumber}-${group.endDistrictNumber}`);

                    if (populationToBalance <= 0) break;
                  }
                }
              }
            } else {
              console.log(`⚠️ No suitable target groups found for isolated tracts in group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
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
      
      // Re-check isolation after fixes using the same logic as detection
      for (let groupIndex = 0; groupIndex < updatedGroups.length; groupIndex++) {
        const group = updatedGroups[groupIndex];
        if (group.censusTracts.length === 0) continue;

        // Use the same logic as the main detection - find max reachable count (main component)
        const maxReachableCount = this.calculateMaxReachableCount(group.censusTracts, adjacencyGraph);
        const totalTractsInGroup = group.censusTracts.length;

        if (maxReachableCount < totalTractsInGroup) {
          const isolatedCount = totalTractsInGroup - maxReachableCount;
          console.log(`⚠️ FIX ISOLATED: Group ${group.startDistrictNumber}-${group.endDistrictNumber} still has ${isolatedCount} isolated tract(s) after fix (${maxReachableCount}/${totalTractsInGroup} reachable)`);
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
   * @param {boolean} resolveIsolation - If true, resolve isolation after each step (detect isolated, detect bridge, move bridge, move isolated)
   * @param {Function} onStepComplete - Optional callback called after each step with (stepNumber, stepData, shouldCache) - if returns false, step won't be cached
   * @returns {Promise<Object>} GeodistrictResult
   */
  async executeGeodistrictAlgorithm(tracts, totalDistricts, maxIterations, forceInvalidate = false, resolveIsolation = false, onStepComplete = null) {
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

    // Create initial step (step 0 has all tracts in one group, so no isolated tracts possible)
    steps.push(createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude', undefined, undefined, null, null));

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
            
            // Store sibling group relationships: when parent divides, record which groups are siblings
            const firstGroup = divisionResult.groups[0];
            const secondGroup = divisionResult.groups[1];
            
            divisionLines.push({
              line: divisionResult.dividingLine,
              direction: direction,
              parentGroup: {
                startDistrictNumber: group.startDistrictNumber,
                endDistrictNumber: group.endDistrictNumber,
                totalDistricts: group.totalDistricts
              },
              siblingGroups: [
                {
                  startDistrictNumber: firstGroup.startDistrictNumber,
                  endDistrictNumber: firstGroup.endDistrictNumber
                },
                {
                  startDistrictNumber: secondGroup.startDistrictNumber,
                  endDistrictNumber: secondGroup.endDistrictNumber
                }
              ],
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
      const problematicTracts = ['002105', '002104'];
      for (const [tractId, groupIndices] of postDivisionTractToGroups.entries()) {
        if (groupIndices.length > 1) {
          divisionDuplicates++;
          const groupLabels = groupIndices.map(i => `${currentGroups[i].startDistrictNumber}-${currentGroups[i].endDistrictNumber}`).join(', ');
          
          // Always log problematic tracts, log first 5 others
          if (problematicTracts.some(id => tractId.includes(id)) || divisionDuplicates <= 5) {
            console.error(`⚠️ DIVISION BUG: Tract ${tractId} assigned to ${groupIndices.length} groups during division step ${iteration}: ${groupLabels}`);
            
            if (problematicTracts.some(id => tractId.includes(id))) {
              console.error(`   🚨 PROBLEMATIC TRACT: ${tractId} should be in one group but is in: ${groupLabels}`);
              console.error(`   → This indicates a bug in the division logic`);
            }
          }
        }
      }
      if (divisionDuplicates > 0) {
        console.error(`⚠️ DIVISION BUG: ${divisionDuplicates} tracts assigned to multiple groups during division step ${iteration}`);
      }
      
      // Fix isolated tracts after division (DISABLED - now manual via UI)
      // currentGroups = this.fixIsolatedTractsAcrossAllGroups(currentGroups, uniqueTracts, direction);
      
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
      
      // Resolve isolation if requested (for "run all steps" execution)
      let groupsForStep = currentGroups;
      let resolutionSummary = null;
      if (resolveIsolation && iteration > 0) { // Skip for step 0 (no isolation possible)
        console.log(`🔧 Resolving isolation for step ${iteration}...`);
        const resolutionResult = this.resolveIsolationForStep(currentGroups, uniqueTracts, divisionLines);
        groupsForStep = resolutionResult.districtGroups;
        resolutionSummary = resolutionResult.resolutionSummary;
        
        // Update currentGroups for next iteration
        currentGroups = groupsForStep;
        
        console.log(`✅ Step ${iteration} isolation resolved: ${resolutionSummary.bridgeTractsMoved} bridge, ${resolutionSummary.isolatedTractsMoved} isolated moved`);
      }
      
      const step = createStep(iteration, iteration, groupsForStep,
        `Division ${iteration} by ${direction}`, direction, divisionLine, divisionLines, this, uniqueTracts);
      
      // Add resolution summary to step if available
      if (resolutionSummary) {
        step.isolationResolution = resolutionSummary;
      }
      
      steps.push(step);
      
      // Call onStepComplete callback if provided (for caching)
      if (onStepComplete) {
        const shouldCache = await onStepComplete(iteration, step, true);
        // Callback can return false to skip caching, but we still add the step to the result
      }
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

    // Initialize DG properties for step 0 (all tracts in single group)
    const initialDG = `DG1-${totalDistricts}`;
    for (const tract of uniqueTracts) {
      if (!tract.properties) tract.properties = {};
      tract.properties.tract_DG = initialDG;
      tract.properties.parent_DG = null; // No parent for initial state
      tract.properties.sibling_DG = null; // No sibling for initial state
    }

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Yield initial step (step 0 has all tracts in one group, so no isolated tracts possible)
    const initialStep = createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude', undefined, undefined, null, null);
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
              // Store sibling group relationships: when parent divides, record which groups are siblings
              const firstGroup = divisionResult.groups[0];
              const secondGroup = divisionResult.groups[1];
              
              const parentDG = `DG${group.startDistrictNumber}-${group.endDistrictNumber}`;
              const firstSiblingDG = `DG${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}`;
              const secondSiblingDG = `DG${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}`;
              
              // Update tract properties with DG relationships
              // Tracts in first group: tract_DG=firstSiblingDG, parent_DG=parentDG, sibling_DG=secondSiblingDG
              for (const tract of firstGroup.censusTracts) {
                if (!tract.properties) tract.properties = {};
                const tractId = getTractId(tract);
                tract.properties.tract_DG = firstSiblingDG;
                tract.properties.parent_DG = parentDG;
                tract.properties.sibling_DG = secondSiblingDG;
                
                // Debug logging for specific tract mentioned in issue
                if (tractId === '010102' || tractId.includes('010102')) {
                  console.log(`🔍 DEBUG Division: Tract ${tractId} assigned to ${firstSiblingDG}, sibling_DG=${secondSiblingDG}, parent_DG=${parentDG}`);
                }
              }
              
              // Tracts in second group: tract_DG=secondSiblingDG, parent_DG=parentDG, sibling_DG=firstSiblingDG
              for (const tract of secondGroup.censusTracts) {
                if (!tract.properties) tract.properties = {};
                const tractId = getTractId(tract);
                tract.properties.tract_DG = secondSiblingDG;
                tract.properties.parent_DG = parentDG;
                tract.properties.sibling_DG = firstSiblingDG;
                
                // Debug logging for specific tract mentioned in issue
                if (tractId === '010102' || tractId.includes('010102')) {
                  console.log(`🔍 DEBUG Division: Tract ${tractId} assigned to ${secondSiblingDG}, sibling_DG=${firstSiblingDG}, parent_DG=${parentDG}`);
                }
              }
              
              divisionLines.push({
                line: divisionResult.dividingLine,
                direction: direction,
                parentGroup: {
                  startDistrictNumber: group.startDistrictNumber,
                  endDistrictNumber: group.endDistrictNumber,
                  totalDistricts: group.totalDistricts
                },
                siblingGroups: [
                  {
                    startDistrictNumber: firstGroup.startDistrictNumber,
                    endDistrictNumber: firstGroup.endDistrictNumber
                  },
                  {
                    startDistrictNumber: secondGroup.startDistrictNumber,
                    endDistrictNumber: secondGroup.endDistrictNumber
                  }
                ],
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
      
      // Fix isolated tracts after division (DISABLED - now manual via UI)
      // currentGroups = this.fixIsolatedTractsAcrossAllGroups(currentGroups, uniqueTracts, direction);
      
      const step = createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${direction}`, direction, undefined, divisionLines, this, uniqueTracts);
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
  createUnionPolygon,
  createUnionPolygonsForGroup,
  detectEnclosedTracts,
  ALGORITHM_VERSION
};

