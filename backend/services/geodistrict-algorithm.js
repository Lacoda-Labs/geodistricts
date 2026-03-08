const s4DataLoader = require('./s4-data-loader');
const turf = require('@turf/turf');
const logger = require('../utils/logger');
const { simplifyUnionGeometry, reduceTractGeometryPrecision } = require('../utils/geometry-simplify');

/** When state total tract count exceeds this, reduce tract geometry precision before union/dissolve (e.g. CA). */
const TRACT_PRECISION_REDUCTION_STATE_THRESHOLD = 7000;

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
 * 20251203-2215: Cache invalidation bump
 */
const ALGORITHM_VERSION = '20251203-2215';

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
 * Returns true if tract is water/special-purpose (no TIGER geometry or Census tract code 990000/999000).
 * Such tracts are excluded from isolation at steps 1+ so they do not block move-isolated (per CA 06017990000, 06061990000).
 */
function isWaterOrSpecialTract(tract) {
  if (!tract) return false;
  const hasGeometry = !!(tract.geometry && tract.geometry.coordinates && (
    (tract.geometry.type === 'Polygon' && tract.geometry.coordinates.length > 0) ||
    (tract.geometry.type === 'MultiPolygon' && tract.geometry.coordinates.length > 0)
  ));
  if (!hasGeometry) return true;
  const tractFips = tract.properties?.TRACT_FIPS ? String(tract.properties.TRACT_FIPS) : '';
  const geoid = tract.properties?.GEOID ? String(tract.properties.GEOID) : '';
  const code = tractFips || (geoid.length >= 6 ? geoid.slice(-6) : '');
  // Census water/special: 990000, 999000; also 7990000 (7-digit) used in some states
  return code === '990000' || code === '999000' || code === '7990000' || code === '9990000';
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

/** When aspect ratio min/max >= this, treat as tie and use parent lastDivisionDirection to alternate. */
const CLOSE_ASPECT_THRESHOLD = 0.9;

/**
 * Calculate bounding box from tract geometry extents (not centroids).
 * Used for aspect-ratio-based division direction.
 * @param {Array} tracts - Array of tract features
 * @returns {{ north: number, south: number, east: number, west: number }}
 */
function calculateBboxFromGeometry(tracts) {
  if (!tracts || tracts.length === 0) {
    return { north: 0, south: 0, east: 0, west: 0 };
  }
  let north = -90, south = 90, east = -180, west = 180;
  for (const tract of tracts) {
    const b = getTractBounds(tract);
    // Skip tracts with no geometry (getTractBounds returns 0,0,0,0); they would corrupt bbox (e.g. south=0, east=0)
    if (b.minLat === 0 && b.maxLat === 0 && b.minLng === 0 && b.maxLng === 0) continue;
    north = Math.max(north, b.maxLat);
    south = Math.min(south, b.minLat);
    east = Math.max(east, b.maxLng);
    west = Math.min(west, b.minLng);
  }
  return { north, south, east, west };
}

/**
 * Choose division direction from group bbox aspect ratio: divide perpendicular to long axis.
 * On tie or close ratio, alternate from parent's lastDivisionDirection.
 * @param {Object} group - District group with censusTracts and optional lastDivisionDirection
 * @returns {'latitude'|'longitude'}
 */
function chooseDivisionDirection(group) {
  const groupLabel = `DG${group.startDistrictNumber}-${group.endDistrictNumber}`;
  const bbox = calculateBboxFromGeometry(group.censusTracts);
  const latSpan = bbox.north - bbox.south;
  const lngSpan = bbox.east - bbox.west;
  const maxSpan = Math.max(latSpan, lngSpan);
  const minSpan = Math.min(latSpan, lngSpan);
  const ratio = maxSpan > 0 ? minSpan / maxSpan : 0;
  const lastDir = group.lastDivisionDirection ?? null;

  let direction;
  let reason;

  if (maxSpan <= 0) {
    direction = (lastDir === 'longitude') ? 'latitude' : (lastDir === 'latitude' ? 'longitude' : 'latitude');
    reason = 'zero span, default/tie-break';
  } else if (ratio >= CLOSE_ASPECT_THRESHOLD) {
    if (lastDir === 'latitude') {
      direction = 'longitude';
      reason = `tie/close ratio ${ratio.toFixed(3)} >= ${CLOSE_ASPECT_THRESHOLD}, alternate from parent (was latitude)`;
    } else if (lastDir === 'longitude') {
      direction = 'latitude';
      reason = `tie/close ratio ${ratio.toFixed(3)} >= ${CLOSE_ASPECT_THRESHOLD}, alternate from parent (was longitude)`;
    } else {
      direction = 'latitude';
      reason = `tie/close ratio ${ratio.toFixed(3)} >= ${CLOSE_ASPECT_THRESHOLD}, no parent -> default latitude`;
    }
  } else if (lngSpan > latSpan) {
    direction = 'longitude';
    reason = `lngSpan (${lngSpan.toFixed(4)}) > latSpan (${latSpan.toFixed(4)}): bbox wider E-W -> divide by longitude`;
  } else {
    direction = 'latitude';
    reason = `latSpan (${latSpan.toFixed(4)}) >= lngSpan (${lngSpan.toFixed(4)}): bbox taller N-S -> divide by latitude`;
  }

  console.log(`🧭 DIVISION DIRECTION ${groupLabel}: ${direction} | bbox [S=${bbox.south.toFixed(4)} N=${bbox.north.toFixed(4)} W=${bbox.west.toFixed(4)} E=${bbox.east.toFixed(4)}] latSpan=${latSpan.toFixed(4)} lngSpan=${lngSpan.toFixed(4)} ratio=${ratio.toFixed(3)} lastDir=${lastDir} | ${reason}`);
  return direction;
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
 * Create union polygons using S4-ordered sequential merging approach
 * Implements the algorithm from 251204-how-to-create-union-polygons.md:
 * - Start with first tract from sorted DG tracts
 * - Using S4 get adjacent tracts, merge in order of S4 adjacency
 * - As tracts are merged, add them to Set of merged tracts
 * - If merge fails, start a new subset union polygon, continuing same S4 merge sequence
 * - If no more adjacent tracts left to merge, continue by selecting next unmerged tract from sorted DG tracts
 * - Repeat until no more single tracts have been attempted to be merged
 * - Once all single tracts are attempted, result should be main merged union polygon and zero or more subset union polygons
 * - Attempt to merge subset polygons with each other and finally to the main polygon
 * - Final result is one or more union polygons for the given DG
 * 
 * @param {Object} group - District group containing tracts
 * @param {Map<string, string[]>} adjacencyGraph - S4 adjacency graph for all tracts (required)
 * @param {number} stepNumber - Step number (optional, used at Step 0 to structure polygons as main + islands)
 * @returns {Array<Object>|Object|null} - Array of GeoJSON features (main polygon first, then island polygons) or single feature, or null if union fails
 */
function createUnionPolygonsS4Ordered(group, adjacencyGraph, stepNumber = null, stateTotalTractCount = null) {
  if (!group.censusTracts || group.censusTracts.length === 0 || !adjacencyGraph) {
    return null;
  }

  const isStep0 = stepNumber === 0 || stepNumber === '0';
  const validTracts = group.censusTracts.filter(t => t && t.geometry);
  if (validTracts.length === 0) return null;

  // Sort tracts by ID for consistent ordering
  let sortedTracts = [...validTracts].sort((a, b) => {
    const idA = getTractId(a) || '';
    const idB = getTractId(b) || '';
    return idA.localeCompare(idB);
  });

  if (stateTotalTractCount != null && stateTotalTractCount > TRACT_PRECISION_REDUCTION_STATE_THRESHOLD) {
    sortedTracts = sortedTracts.map(t => ({
      ...t,
      geometry: reduceTractGeometryPrecision(t.geometry, { decimals: 5 })
    }));
  }

  console.log(`🔨 S4-ordered merging for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${sortedTracts.length} tracts)`);

  const mergedTractIds = new Set();
  const mainPolygonTracts = [];
  const subsetPolygons = [];

  // Flatten MultiPolygon to Polygon features
  function flattenTractGeometry(tract) {
    const polygons = [];
    if (tract.geometry.type === 'MultiPolygon') {
      for (const polygonCoords of tract.geometry.coordinates) {
        polygons.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygonCoords },
          properties: tract.properties || {}
        });
      }
    } else if (tract.geometry.type === 'Polygon') {
      polygons.push(tract);
    }
    return polygons;
  }

  // Merge polygon into union (Turf v7: union takes FeatureCollection of 2+ polygons)
  function mergePolygonIntoUnion(union, polygonFeature) {
    if (!union?.geometry || !polygonFeature?.geometry) return null;
    try {
      const result = turf.union(turf.featureCollection([union, polygonFeature]));
      return result?.geometry ? result : null;
    } catch {
      return null;
    }
  }

  // Create union from tracts
  function createUnionFromTracts(tracts) {
    if (tracts.length === 0) return null;
    if (tracts.length === 1) {
      const one = tracts[0];
      const simplified = simplifyUnionGeometry(one.geometry);
      return simplified !== one.geometry ? { ...one, geometry: simplified } : one;
    }

    const flattened = [];
    for (const tract of tracts) {
      flattened.push(...flattenTractGeometry(tract));
    }
    if (flattened.length === 0) return null;

    let union = turf.feature(flattened[0].geometry);
    if (!union?.geometry) return null;

    // When a polygon fails to merge, keep it as a separate part (do not drop tracts)
    const parts = [];
    for (let i = 1; i < flattened.length; i++) {
      const nextFeature = turf.feature(flattened[i].geometry);
      const merged = mergePolygonIntoUnion(union, nextFeature);
      if (merged) {
        union = merged;
      } else {
        parts.push(union);
        union = nextFeature;
      }
    }

    const groupProperties = {
      DISTRICT_START: group.startDistrictNumber,
      DISTRICT_END: group.endDistrictNumber,
      TOTAL_POPULATION: group.totalPopulation,
      TRACT_COUNT: tracts.length
    };

    if (parts.length > 0) {
      parts.push(union);
      const multi = buildMultiPolygonFromFeatures(parts.map(p => ({ type: 'Feature', geometry: p.geometry, properties: {} })));
      if (multi) {
        multi.properties = groupProperties;
        multi.geometry = simplifyUnionGeometry(multi.geometry);
        return multi;
      }
    }

    const simplifiedGeometry = simplifyUnionGeometry(union.geometry);
    return {
      type: 'Feature',
      geometry: simplifiedGeometry,
      properties: groupProperties
    };
  }

  // Process tracts sequentially using S4 adjacency
  let currentSubsetTracts = [];
  let currentUnion = null;
  let isMainPolygon = true;

  for (let i = 0; i < sortedTracts.length; i++) {
    const tract = sortedTracts[i];
    const tractId = getTractId(tract);
    if (!tractId || mergedTractIds.has(tractId)) continue;

    // Start new polygon if needed
    if (currentUnion === null) {
      const flattened = flattenTractGeometry(tract);
      if (flattened.length > 0) {
        currentUnion = turf.feature(flattened[0].geometry);
        currentSubsetTracts = [tract];
        mergedTractIds.add(tractId);
      } else {
        continue;
      }
    } else {
      // Try to merge this tract
      const flattened = flattenTractGeometry(tract);
      let merged = false;
      for (const polygonFeature of flattened) {
        const mergedResult = mergePolygonIntoUnion(currentUnion, turf.feature(polygonFeature.geometry));
        if (mergedResult) {
          currentUnion = mergedResult;
          merged = true;
        }
      }

      if (merged) {
        currentSubsetTracts.push(tract);
        mergedTractIds.add(tractId);
      } else {
        // Merge failed - finalize current subset
        if (currentSubsetTracts.length > 0) {
          const subsetPolygon = createUnionFromTracts(currentSubsetTracts);
          if (subsetPolygon?.geometry) {
            if (isMainPolygon) {
              mainPolygonTracts.push(...currentSubsetTracts);
            } else {
              subsetPolygons.push({ tracts: [...currentSubsetTracts], polygon: subsetPolygon });
            }
          }
        }

        // Start new subset
        const newFlattened = flattenTractGeometry(tract);
        if (newFlattened.length > 0) {
          currentUnion = turf.feature(newFlattened[0].geometry);
          currentSubsetTracts = [tract];
          mergedTractIds.add(tractId);
          isMainPolygon = false;
        } else {
          currentUnion = null;
          currentSubsetTracts = [];
        }
      }
    }

    // Try to merge adjacent tracts using S4 adjacency
    if (currentUnion?.geometry) {
      const adjacentTractIds = adjacencyGraph.get(tractId) || [];
      const unmergedAdjacent = adjacentTractIds.filter(id => 
        sortedTracts.some(t => getTractId(t) === id) && !mergedTractIds.has(id)
      );

      for (const adjacentId of unmergedAdjacent) {
        const adjacentTract = sortedTracts.find(t => getTractId(t) === adjacentId);
        if (!adjacentTract) continue;

        const flattened = flattenTractGeometry(adjacentTract);
        let merged = false;
        for (const polygonFeature of flattened) {
          const mergedResult = mergePolygonIntoUnion(currentUnion, turf.feature(polygonFeature.geometry));
          if (mergedResult) {
            currentUnion = mergedResult;
            merged = true;
          }
        }

        if (merged) {
          currentSubsetTracts.push(adjacentTract);
          mergedTractIds.add(adjacentId);
        }
      }
    }
  }

  // Finalize current subset
  if (currentSubsetTracts.length > 0) {
    const subsetPolygon = createUnionFromTracts(currentSubsetTracts);
    if (subsetPolygon?.geometry) {
      if (isMainPolygon) {
        mainPolygonTracts.push(...currentSubsetTracts);
      } else {
        subsetPolygons.push({ tracts: [...currentSubsetTracts], polygon: subsetPolygon });
      }
    }
  }

  // Create main polygon
  let mainPolygon = null;
  if (mainPolygonTracts.length > 0) {
    mainPolygon = createUnionFromTracts(mainPolygonTracts);
  }

  // Attempt to merge subset polygons with each other and with main
  const finalPolygons = [];
  if (mainPolygon?.geometry) {
    finalPolygons.push(mainPolygon);
  }

  // Try to merge subsets together
  const mergedSubsets = [];
  for (let i = 0; i < subsetPolygons.length; i++) {
    let merged = false;
    const subset = subsetPolygons[i];

    // Try to merge with main polygon
    if (mainPolygon?.geometry) {
      const flattened = flattenTractGeometry(subset.polygon);
      for (const polygonFeature of flattened) {
        const mergedResult = mergePolygonIntoUnion(mainPolygon, turf.feature(polygonFeature.geometry));
        if (mergedResult) {
          mainPolygon.geometry = mergedResult.geometry;
          merged = true;
          break;
        }
      }
    }

    // Try to merge with other subsets
    if (!merged) {
      for (let j = i + 1; j < subsetPolygons.length; j++) {
        const otherSubset = subsetPolygons[j];
        const flattened = flattenTractGeometry(subset.polygon);
        for (const polygonFeature of flattened) {
          const mergedResult = mergePolygonIntoUnion(otherSubset.polygon, turf.feature(polygonFeature.geometry));
          if (mergedResult) {
            otherSubset.polygon.geometry = mergedResult.geometry;
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }

    if (!merged) {
      mergedSubsets.push(subset.polygon);
    }
  }

  finalPolygons.push(...mergedSubsets);

  // Sort by size (largest first)
  finalPolygons.sort((a, b) => {
    const sizeA = a.properties?.TRACT_COUNT || 0;
    const sizeB = b.properties?.TRACT_COUNT || 0;
    return sizeB - sizeA;
  });

  if (finalPolygons.length === 0) {
    console.error(`❌ No union polygons created using S4-ordered approach for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
    return null;
  }

  console.log(`✅ S4-ordered merging created ${finalPolygons.length} polygon(s) for group ${group.startDistrictNumber}-${group.endDistrictNumber} (main: ${mainPolygonTracts.length} tracts, ${subsetPolygons.length} subset(s))`);

  // Simplify all polygons (merge may have replaced geometry with unsimplified union output)
  for (const f of finalPolygons) {
    if (f?.geometry) f.geometry = simplifyUnionGeometry(f.geometry);
  }

  if (isStep0) {
    return finalPolygons;
  }
  return finalPolygons.length === 1 ? finalPolygons[0] : finalPolygons;
}

/**
 * Create union polygons for each connected component in a district group
 * If a group has isolated tracts (multiple connected components), returns an array of union polygons
 * At Step 0, returns array with main polygon (largest component) first, followed by island polygons (smaller components)
 * @param {Object} group - District group containing tracts
 * @param {Map<string, string[]>} adjacencyGraph - Adjacency graph for all tracts (optional, for finding connected components)
 * @param {boolean} forceSingleUnion - If true, create one union polygon for all tracts regardless of connectivity (for visualization)
 * @param {number} stepNumber - Step number (optional, used at Step 0 to structure polygons as main + islands)
 * @param {{ yieldEvery?: number, yieldFn?: () => Promise<void> }|null} yieldConfig - Optional: yield to event loop during long union work
 * @returns {Promise<Array<Object>|Object|null>} - Array of GeoJSON features (main polygon first, then island polygons at Step 0) or single feature, or null if union fails
 */
async function createUnionPolygonsForGroup(group, adjacencyGraph = null, forceSingleUnion = false, stepNumber = null, stateTotalTractCount = null, yieldConfig = null) {
  if (!group.censusTracts || group.censusTracts.length === 0) {
    return null;
  }

  const isStep0 = stepNumber === 0 || stepNumber === '0';

  // When forceSingleUnion is true and not Step 0, create one union polygon per DG.
  // If the group has multiple connected components (main + islands), we create a MultiPolygon; otherwise one Polygon.
  if (forceSingleUnion && !isStep0) {
    if (!adjacencyGraph) {
      return await createUnionPolygon(group, stateTotalTractCount, yieldConfig);
    }
    const components = findConnectedComponents(group, adjacencyGraph);
    // Single component or empty: always use simple dissolve (contiguous DG)
    if (components.length <= 1) {
      return await createUnionPolygon(group, stateTotalTractCount, yieldConfig);
    }
    // If largest component has only 1 tract, graph is likely empty/wrong (e.g. S4 missing) - treat as contiguous
    components.sort((a, b) => b.length - a.length);
    if (components[0].length <= 1) {
      return await createUnionPolygon(group, stateTotalTractCount, yieldConfig);
    }
    // Multiple real components (main + islands): fall through to create main + island polygons, then MultiPolygon
  }

  // Try S4-ordered merging approach first if adjacency graph is available
  // Skip S4-ordered for very large groups (>1000 tracts) as sequential merging is too slow
  const tractCount = group.censusTracts?.length || 0;
  const S4_ORDERED_MAX_TRACTS = 1000;

  if (adjacencyGraph && tractCount <= S4_ORDERED_MAX_TRACTS) {
    const s4Result = createUnionPolygonsS4Ordered(group, adjacencyGraph, stepNumber, stateTotalTractCount);
    if (s4Result) {
      return s4Result;
    }
    // Fall back to connected components approach if S4-ordered fails
    console.warn(`⚠️ S4-ordered merging failed, falling back to connected components approach`);
  } else if (adjacencyGraph && tractCount > S4_ORDERED_MAX_TRACTS) {
    console.log(`⚠️ Skipping S4-ordered merging for large group (${tractCount} tracts > ${S4_ORDERED_MAX_TRACTS} threshold), using faster approach`);
  }

  // If adjacency graph is provided, check for multiple connected components
  if (adjacencyGraph) {
    const components = findConnectedComponents(group, adjacencyGraph);
    
    // If multiple components found, create union polygon for each
    if (components.length > 1) {
      // Sort components by size (largest first) - main component is largest, islands are smaller
      components.sort((a, b) => b.length - a.length);
      
      const mainComponent = components[0]; // Largest component
      const islandComponents = components.slice(1); // Smaller components (islands)
      
      // Verify main component is actually the largest
      const allComponentSizes = components.map(c => c.length).sort((a, b) => b - a);
      if (mainComponent.length !== allComponentSizes[0]) {
        console.error(`❌ CRITICAL: Main component size mismatch! Expected ${allComponentSizes[0]} but got ${mainComponent.length}`);
      }
      
      // Check if any island tract IDs appear in main component (should not happen)
      if (islandComponents.length > 0) {
        const islandTractIds = new Set();
        for (const islandComp of islandComponents) {
          for (const tract of islandComp) {
            const tractId = getTractId(tract);
            if (tractId) islandTractIds.add(tractId);
          }
        }
        
        const mainTractIds = new Set(mainComponent.map(t => getTractId(t)).filter(Boolean));
        const overlap = [...islandTractIds].filter(id => mainTractIds.has(id));
        if (overlap.length > 0) {
          console.error(`❌ CRITICAL: ${overlap.length} island tract ID(s) found in main component! Overlapping IDs: ${overlap.slice(0, 5).join(', ')}`);
        }
      }
      
      console.log(`🔨 Group ${group.startDistrictNumber}-${group.endDistrictNumber} has ${components.length} connected components${isStep0 ? ' (main + islands at Step 0)' : ''}`);
      console.log(`   Main component: ${mainComponent.length} tracts, Islands: ${islandComponents.map(c => c.length).join(', ')} tracts`);
      console.log(`   Component sizes (sorted): ${allComponentSizes.join(', ')}`);
      
      const unionPolygons = [];
      
      // Create main polygon (largest component) - always first
      // Validate that mainComponent contains tract objects with geometry
      const validMainTracts = mainComponent.filter(t => t && t.geometry);
      const invalidMainTracts = mainComponent.length - validMainTracts.length;
      if (invalidMainTracts > 0) {
        console.warn(`⚠️ Main component has ${invalidMainTracts} tracts without geometry out of ${mainComponent.length} total`);
      }
      
      // Log sample tract IDs from main component to verify they're correct (not island tracts)
      const mainTractIds = mainComponent.slice(0, 5).map(t => getTractId(t)).filter(Boolean);
      console.log(`   Main component sample tract IDs: ${mainTractIds.join(', ')}`);
      
      // Verify main component doesn't contain known island tracts (for CA Step 0)
      if (isStep0) {
        const knownIslandTracts = ['06037599000', '06037599100', '06075980401', '06083980100', '06111980000'];
        const mainTractIdSet = new Set(mainComponent.map(t => getTractId(t)).filter(Boolean));
        const islandTractsInMain = knownIslandTracts.filter(id => mainTractIdSet.has(id));
        if (islandTractsInMain.length > 0) {
          console.error(`❌ CRITICAL: Known island tract(s) found in main component: ${islandTractsInMain.join(', ')}`);
        } else {
          console.log(`   ✅ Verified: No known island tracts in main component`);
        }
      }
      
      const mainGroup = {
        ...group,
        censusTracts: mainComponent
      };
      const mainPolygon = await createUnionPolygon(mainGroup, stateTotalTractCount, yieldConfig);
      if (mainPolygon) {
        const mainFeatures = Array.isArray(mainPolygon) ? mainPolygon : [mainPolygon];
        const validMainFeatures = mainFeatures.filter(f => f && f.geometry);
        if (validMainFeatures.length > 0) {
          if (validMainFeatures.length > 1) {
            console.log(`✅ Created main union (${validMainFeatures.length} parts from merge failures) for component with ${mainComponent.length} tracts`);
          } else {
            const geomType = validMainFeatures[0].geometry.type;
            let pointCount = 0;
            if (geomType === 'Polygon' && validMainFeatures[0].geometry.coordinates && validMainFeatures[0].geometry.coordinates[0]) {
              pointCount = validMainFeatures[0].geometry.coordinates[0].length;
            } else if (geomType === 'MultiPolygon' && validMainFeatures[0].geometry.coordinates) {
              pointCount = validMainFeatures[0].geometry.coordinates.reduce((sum, poly) => sum + (poly[0]?.length || 0), 0);
            }
            console.log(`✅ Created main union polygon for component with ${mainComponent.length} tracts (${validMainTracts.length} with geometry) - type: ${geomType}, points: ${pointCount}`);
          }
          unionPolygons.push(...validMainFeatures);
        } else {
          console.error(`❌ Failed to create main union polygon for component with ${mainComponent.length} tracts (${validMainTracts.length} with geometry) - no valid geometry`);
          if (isStep0) {
            console.error(`❌ CRITICAL: Main polygon creation failed at Step 0. Will still create island polygons so DG has geometry.`);
          }
        }
      } else {
        console.error(`❌ Failed to create main union polygon for component with ${mainComponent.length} tracts (${validMainTracts.length} with geometry) - polygon is null`);
        // Still create island polygons so the DG has at least island geometry (multi-polygon)
        if (isStep0) {
          console.error(`❌ CRITICAL: Main polygon creation failed at Step 0. Will still create island polygons so DG has geometry.`);
        }
      }
      
      // Create island polygons (smaller components) whenever we have island components,
      // so the DG can be represented as a multi-polygon (main + islands) even when main fails
      if (islandComponents.length > 0) {
        for (let i = 0; i < islandComponents.length; i++) {
          const islandComponent = islandComponents[i];
          const islandGroup = {
            ...group,
            censusTracts: islandComponent
          };
          const islandPolygon = await createUnionPolygon(islandGroup, stateTotalTractCount, yieldConfig);
          if (islandPolygon) {
            const islandFeatures = Array.isArray(islandPolygon) ? islandPolygon : [islandPolygon];
            const validIslandFeatures = islandFeatures.filter(f => f && f.geometry);
            if (validIslandFeatures.length > 0) {
              unionPolygons.push(...validIslandFeatures);
              console.log(`🏝️ Created island union polygon ${i + 1}/${islandComponents.length} for component with ${islandComponent.length} tracts${validIslandFeatures.length > 1 ? ` (${validIslandFeatures.length} parts)` : ''}`);
            } else {
              console.warn(`⚠️ Failed to create island union polygon ${i + 1} with ${islandComponent.length} tracts - no valid geometry`);
            }
          } else {
            console.warn(`⚠️ Failed to create island union polygon ${i + 1} with ${islandComponent.length} tracts - polygon is null`);
          }
        }
      }
      
      if (unionPolygons.length > 0) {
        // Validate that main polygon is first in array
        if (isStep0 && unionPolygons.length > 1) {
          console.log(`✅ Step 0: Returning ${unionPolygons.length} polygons (main + ${unionPolygons.length - 1} island(s)) for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
        }
        
        // When forceSingleUnion && !isStep0, return one MultiPolygon feature so the DG always has one geometry (main + islands)
        if (forceSingleUnion && !isStep0) {
          const multi = buildMultiPolygonFromFeatures(unionPolygons);
          if (multi) {
            console.log(`✅ Returning single MultiPolygon (${unionPolygons.length} part(s)) for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
            return multi;
          }
        }
        
        // At Step 0, always return array (main + islands)
        // For other steps, return array if we have multiple polygons, single if only main
        if (isStep0 && unionPolygons.length === 1) {
          // Only main polygon, no islands - still return as array for consistency
          console.log(`✅ Step 0: Returning single main polygon (no islands) for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
          return unionPolygons;
        }
        return unionPolygons.length === 1 && !isStep0 ? unionPolygons[0] : unionPolygons;
      } else {
        console.error(`❌ No union polygons created for group ${group.startDistrictNumber}-${group.endDistrictNumber} - all polygon creation failed`);
        return null;
      }
    }
  }

  // Single component or no adjacency graph - create single union polygon (or array of parts if merges failed)
  // At Step 0 with single component, return as array for consistency
  const singlePolygon = await createUnionPolygon(group, stateTotalTractCount, yieldConfig);
  if (isStep0 && singlePolygon) {
    return Array.isArray(singlePolygon) ? singlePolygon : [singlePolygon]; // Return as array even for single component at Step 0
  }
  return singlePolygon; // Single feature or array of features (when sequential union had merge failures)
}

/**
 * Build a single GeoJSON Feature with MultiPolygon geometry from an array of Polygon/MultiPolygon features.
 * Used when a district group has multiple connected components (main + islands) so the DG has one geometry to render.
 * @param {Array<Object>} features - Array of GeoJSON Feature objects (geometry.type Polygon or MultiPolygon)
 * @returns {Object|null} Single Feature with geometry.type MultiPolygon, or null if no valid geometries
 */
function buildMultiPolygonFromFeatures(features) {
  if (!Array.isArray(features) || features.length === 0) return null;
  const multiCoords = [];
  for (const f of features) {
    if (!f || !f.geometry || !f.geometry.coordinates) continue;
    if (f.geometry.type === 'Polygon') {
      multiCoords.push(f.geometry.coordinates);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const polyCoords of f.geometry.coordinates) {
        multiCoords.push(polyCoords);
      }
    }
  }
  if (multiCoords.length === 0) return null;
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: multiCoords },
    properties: {}
  };
}

/**
 * Create a union polygon from all tracts in a district group.
 * Output is run through simplifyUnionGeometry (precision reduction + dedup) for display and smaller payloads.
 * @param {Object} group - District group containing tracts
 * @param {number|null} stateTotalTractCount - Total tract count for state (used for precision reduction threshold)
 * @param {{ yieldEvery?: number, yieldFn?: () => Promise<void> }|null} yieldConfig - Optional: yield to event loop every N polygons (e.g. { yieldEvery: 50, yieldFn: () => new Promise(r => setImmediate(r)) }) so server can serve other requests
 * @returns {Promise<Object|null>} GeoJSON feature representing the union polygon, or null if union fails
 */
async function createUnionPolygon(group, stateTotalTractCount = null, yieldConfig = null) {
  if (!group.censusTracts || group.censusTracts.length === 0) {
    return null;
  }

  try {
    // Collect all valid tract geometries
    let validTracts = [];
    for (const tract of group.censusTracts) {
      if (tract && tract.geometry) {
        validTracts.push(tract);
      }
    }

    if (validTracts.length === 0) {
      return null;
    }

    // For large states, reduce tract precision before union/dissolve to improve performance
    if (stateTotalTractCount != null && stateTotalTractCount > TRACT_PRECISION_REDUCTION_STATE_THRESHOLD) {
      console.log(`🔬 Reducing tract precision (5 decimals) for union in group ${group.startDistrictNumber}-${group.endDistrictNumber} (state total ${stateTotalTractCount} tracts > ${TRACT_PRECISION_REDUCTION_STATE_THRESHOLD})`);
      validTracts = validTracts.map(t => ({
        ...t,
        geometry: reduceTractGeometryPrecision(t.geometry, { decimals: 5 })
      }));
    }

    // If only one tract, return it with simplified geometry for display
    if (validTracts.length === 1) {
      const one = validTracts[0];
      const simplified = simplifyUnionGeometry(one.geometry);
      return simplified !== one.geometry
        ? { ...one, geometry: simplified }
        : one;
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
        
        // For very large collections, turf.dissolve may fail or produce incorrect results
        // Use chunked approach for collections > 5000 polygons
        let dissolved = null;
        if (flattenedTracts.length > 5000) {
          console.log(`⚠️ Large collection (${flattenedTracts.length} polygons), using chunked dissolve approach`);
          try {
            // Try chunked dissolve: dissolve in batches and then dissolve the results
            const chunkSize = 2000;
            const chunks = [];
            for (let i = 0; i < flattenedTracts.length; i += chunkSize) {
              const chunk = flattenedTracts.slice(i, i + chunkSize);
              const chunkCollection = turf.featureCollection(chunk);
              const chunkDissolved = turf.dissolve(chunkCollection);
              if (chunkDissolved && chunkDissolved.features && chunkDissolved.features.length > 0) {
                chunks.push(...chunkDissolved.features);
              }
              if (yieldConfig?.yieldFn) await yieldConfig.yieldFn();
            }
            
            if (chunks.length > 0) {
              // Dissolve the chunk results together
              const chunkCollection = turf.featureCollection(chunks);
              dissolved = turf.dissolve(chunkCollection);
              console.log(`✅ Chunked dissolve: ${flattenedTracts.length} polygons -> ${chunks.length} chunks -> final result`);
            }
          } catch (chunkError) {
            console.warn(`⚠️ Chunked dissolve failed: ${chunkError.message}, falling back to sequential union`);
          }
        } else {
          // For smaller collections, use direct dissolve
          try {
            dissolved = turf.dissolve(collection);
          } catch (dissolveError) {
            console.warn(`⚠️ Direct dissolve failed: ${dissolveError.message}, falling back to sequential union`);
          }
        }
        
        if (dissolved && dissolved.features && dissolved.features.length > 0) {
          const resultFeature = dissolved.features[0];
          // Validate the dissolved result has reasonable geometry
          const geomType = resultFeature.geometry?.type;
          let pointCount = 0;
          if (geomType === 'Polygon' && resultFeature.geometry.coordinates && resultFeature.geometry.coordinates[0]) {
            pointCount = resultFeature.geometry.coordinates[0].length;
          } else if (geomType === 'MultiPolygon' && resultFeature.geometry.coordinates) {
            pointCount = resultFeature.geometry.coordinates.reduce((sum, poly) => sum + (poly[0]?.length || 0), 0);
          }
          
          // Validate result size - a union of N tracts must have many more points than a single tract.
          // Use a multiplier so a single-tract result (e.g. ~50-200 points) is rejected for multi-tract groups.
          // Require at least 5 points per tract (with floor 500) so e.g. 179 tracts need 895 points.
          const minExpectedPoints = validTracts.length > 1000
            ? 5000
            : Math.max(500, validTracts.length * 5);
          
          if (pointCount < minExpectedPoints) {
            console.error(`❌ CRITICAL: Dissolve result is too small: ${pointCount} points for ${validTracts.length} tracts (${flattenedTracts.length} polygons). Expected at least ${minExpectedPoints} points. Dissolve may have failed or returned one tract. Falling back to sequential union.`);
            // Don't return the bad result, fall through to sequential union
          } else {
            // Result looks good, simplify for display and use it
            const unionFeature = {
              type: 'Feature',
              geometry: simplifyUnionGeometry(resultFeature.geometry),
              properties: {
                DISTRICT_START: group.startDistrictNumber,
                DISTRICT_END: group.endDistrictNumber,
                TOTAL_POPULATION: group.totalPopulation,
                TRACT_COUNT: group.censusTracts.length
              }
            };
            console.log(`✅ Created union polygon using dissolve for group ${group.startDistrictNumber}-${group.endDistrictNumber} (flattened ${validTracts.length} tracts to ${flattenedTracts.length} polygons, result: ${geomType} with ${pointCount} points)`);
            return unionFeature;
          }
        } else {
          console.warn(`⚠️ Dissolve returned no features for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${flattenedTracts.length} polygons), falling back to sequential union`);
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
    
    // For very large collections, dissolve in batches then merge batch results with union (not dissolve).
    // turf.dissolve on many features can return simplified/wrong geometry; merging with turf.union preserves detail.
    // Use same stricter threshold as direct dissolve: at least 5 points per tract so single-tract results are rejected.
    const minExpectedPoints = validTracts.length > 1000 ? 5000 : Math.max(500, validTracts.length * 5);
    if (flattenedTracts.length > 1000) {
      console.log(`⚠️ Very large collection (${flattenedTracts.length} polygons), using batched dissolve then union-of-batches`);
      try {
        const batchSize = 500;
        const batches = [];
        for (let i = 0; i < flattenedTracts.length; i += batchSize) {
          const batch = flattenedTracts.slice(i, i + batchSize);
          const batchCollection = turf.featureCollection(batch);
          const batchDissolved = turf.dissolve(batchCollection);
          if (batchDissolved && batchDissolved.features && batchDissolved.features.length > 0) {
            batches.push(...batchDissolved.features);
          }
          // Yield to event loop so server can serve other requests (NEVER BLOCK on union polygon work)
          if (yieldConfig?.yieldFn) await yieldConfig.yieldFn();
        }
        
        if (batches.length > 0) {
          // Merge batch results with turf.union (not dissolve) so geometry is preserved (Turf v7: union takes FeatureCollection)
          // CA step 2+: each group has ~2k tracts -> 50–250 batches to merge; each turf.union is O(vertices) and gets slower as merged grows
          let merged = turf.feature(batches[0].geometry);
          const yieldEveryBatches = 5; // Yield often so server can process next-step and other requests
          const batchUnionStart = Date.now();
          for (let b = 1; b < batches.length; b++) {
            const next = turf.feature(batches[b].geometry);
            const u = turf.union(turf.featureCollection([merged, next]));
            if (!u || !u.geometry) break;
            merged = u;
            // Yield to event loop so server can serve other requests (NEVER BLOCK on union polygon work)
            if (yieldConfig?.yieldFn && (b % yieldEveryBatches === 0 || b === batches.length - 1)) await yieldConfig.yieldFn();
            if (b % 50 === 0 || b === batches.length - 1) {
              const elapsed = Math.round((Date.now() - batchUnionStart) / 1000);
              console.log(`🔨 Batched union progress: ${b + 1}/${batches.length} batches (${elapsed}s elapsed)`);
            }
          }
          if (merged && merged.geometry) {
            const geomType = merged.geometry.type;
            let pointCount = 0;
            if (geomType === 'Polygon' && merged.geometry.coordinates && merged.geometry.coordinates[0]) {
              pointCount = merged.geometry.coordinates[0].length;
            } else if (geomType === 'MultiPolygon' && merged.geometry.coordinates) {
              pointCount = merged.geometry.coordinates.reduce((sum, poly) => sum + (poly[0]?.length || 0), 0);
            }
            if (pointCount >= minExpectedPoints) {
              const unionFeature = {
                type: 'Feature',
                geometry: simplifyUnionGeometry(merged.geometry),
                properties: {
                  DISTRICT_START: group.startDistrictNumber,
                  DISTRICT_END: group.endDistrictNumber,
                  TOTAL_POPULATION: group.totalPopulation,
                  TRACT_COUNT: group.censusTracts.length
                }
              };
              console.log(`✅ Created union polygon using batched dissolve + union for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${flattenedTracts.length} polygons -> ${batches.length} batches -> ${pointCount} points)`);
              return unionFeature;
            }
            console.warn(`⚠️ Batched union result too small (${pointCount} points < ${minExpectedPoints}), falling back to per-polygon sequential union`);
          }
        }
      } catch (batchError) {
        console.warn(`⚠️ Batched dissolve/union fallback failed: ${batchError.message}, falling back to sequential union`);
      }
    }
    
    // Start with the first flattened tract
    let union = turf.feature(flattenedTracts[0].geometry);
    if (!union || !union.geometry) {
      console.warn(`⚠️ Invalid initial tract geometry for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }

    // When a tract fails to merge, we push the current union as a part and start a new union with that tract (so result is MultiPolygon / array of features)
    const parts = [];
    const groupProperties = {
      DISTRICT_START: group.startDistrictNumber,
      DISTRICT_END: group.endDistrictNumber,
      TOTAL_POPULATION: group.totalPopulation,
      TRACT_COUNT: group.censusTracts.length
    };
    
    console.log(`🔨 Creating union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${validTracts.length} tracts, ${flattenedTracts.length} polygons after flattening)`);

    // Union all remaining flattened tracts
    const batchSize = 100;
    let processedCount = 1;
    const startTime = Date.now();
    let skippedCount = 0;
    let mergeFailureCount = 0;

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
        const unionResult = turf.union(turf.featureCollection([union, tractFeature]));
        if (!unionResult || !unionResult.geometry) {
          // Merge failed: keep current union as a part and start a new part with this tract (do not drop it)
          if (mergeFailureCount < 5) {
            console.warn(`⚠️ Union returned null/invalid for polygon ${i}/${flattenedTracts.length} in group ${group.startDistrictNumber}-${group.endDistrictNumber}. Keeping as separate part. Union type: ${union.geometry?.type}, tract type: ${tractFeature.geometry?.type}`);
          }
          mergeFailureCount++;
          parts.push(union);
          union = tractFeature;
          processedCount++;
          continue;
        }
        union = unionResult;
        processedCount++;

        // Yield to event loop so server can serve other requests (NEVER BLOCK on union polygon work)
        if (yieldConfig && yieldConfig.yieldEvery && yieldConfig.yieldFn && processedCount % yieldConfig.yieldEvery === 0) {
          await yieldConfig.yieldFn();
        }
        // Log progress for large unions (only on success to reduce verbosity)
        if (processedCount % batchSize === 0 || i === flattenedTracts.length - 1) {
          const elapsed = Date.now() - startTime;
          console.log(`🔨 Union progress: ${processedCount}/${flattenedTracts.length} polygons (${Math.round(processedCount / flattenedTracts.length * 100)}%) - ${elapsed}ms`);
        }
      } catch (error) {
        // Merge threw: keep current union as a part and start a new part with this tract (do not drop it)
        if (mergeFailureCount < 5) {
          console.warn(`⚠️ Error unioning polygon ${i}/${flattenedTracts.length} in group ${group.startDistrictNumber}-${group.endDistrictNumber}:`, error.message, '- keeping as separate part');
        }
        mergeFailureCount++;
        parts.push(union);
        union = tractFeature;
        processedCount++;
      }
    }
    
    if (skippedCount > 0) {
      console.log(`⚠️ Skipped ${skippedCount} polygon(s) (invalid geometry) during union for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
    }
    if (mergeFailureCount > 0) {
      console.log(`⚠️ ${mergeFailureCount} merge failure(s) for group ${group.startDistrictNumber}-${group.endDistrictNumber} - result has ${parts.length + 1} part(s) (MultiPolygon)`);
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Completed union of ${processedCount}/${flattenedTracts.length} polygons (from ${validTracts.length} tracts) for group ${group.startDistrictNumber}-${group.endDistrictNumber} in ${totalTime}ms`);

    // Validate final union geometry
    if (!union || !union.geometry) {
      console.error(`❌ Union geometry is null or invalid after processing ${processedCount} tracts for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      return null;
    }

    // If we had merge failures, we have multiple parts: return array of Features so caller can build MultiPolygon
    if (parts.length > 0) {
      parts.push(union);
      const features = parts.map(p => ({
        type: 'Feature',
        geometry: simplifyUnionGeometry(p.geometry),
        properties: groupProperties
      }));
      console.log(`✅ Successfully created union polygon for group ${group.startDistrictNumber}-${group.endDistrictNumber} (${features.length} parts, MultiPolygon)`);
      return features;
    }

    // Single part: return one Feature as before
    const simplifiedGeometry = simplifyUnionGeometry(union.geometry);
    const unionFeature = {
      type: 'Feature',
      geometry: simplifiedGeometry,
      properties: groupProperties
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
 * @param {Set<string>|string[]|null} step0IslandTractIds - Optional. At steps > 0, tract IDs that are geographic islands (from step 0); these are excluded from isolation so they are not flagged as isolated.
 */
function createStep(step, level, districtGroups, description, divisionDirection, divisionLine, divisionLines, algorithmService = null, allTracts = null, step0IslandTractIds = null) {
  // Build adjacency graph if we have algorithmService and allTracts (needed for finding connected components)
  let adjacencyGraph = null;
  if (algorithmService && allTracts && allTracts.length > 0) {
    try {
      adjacencyGraph = algorithmService.buildGeometryAdjacencyGraph(allTracts);
    } catch (error) {
      console.warn(`⚠️ Failed to build adjacency graph for step ${step}: ${error.message}`);
    }
  }

  // Union polygons for district groups: Step 0 uses TIGER (set by caller); steps 1..N defer until final step cache (see backend index.js)
  const isStep0 = step === 0 || step === '0';
  const groupsWithUnions = districtGroups.map(group => {
    // Step 0: unionResult stays null - caller must set TIGER state boundaries
    // Steps 1..N: do not build union polygons during the run (defer until final step cache)
    const unionResult = null;
    if (isStep0 && Array.isArray(unionResult) && unionResult.length > 0) {
      // Step 0: Store as unionPolygons array with main first, then islands; unionPolygon = one MultiPolygon (main + islands)
      const mainPolygon = unionResult[0];
      if (!mainPolygon || !mainPolygon.geometry) {
        console.error(`❌ CRITICAL: Step 0 main polygon is missing or has no geometry for group ${group.startDistrictNumber}-${group.endDistrictNumber}`);
        console.error(`   unionResult length: ${unionResult.length}, first element:`, mainPolygon);
      }
      const multiPolygon = buildMultiPolygonFromFeatures(unionResult);
      return {
        ...group,
        unionPolygon: multiPolygon || mainPolygon, // One MultiPolygon (main + islands) so DG always has geometry
        unionPolygons: unionResult // Array with main + islands
      };
    } else if (!isStep0) {
      // Steps 1..N: no union polygons until final step is cached
      return {
        ...group,
        unionPolygon: undefined,
        unionPolygons: undefined
      };
    } else {
      // Step 0 with null unionResult - caller will set TIGER
      return {
        ...group,
        unionPolygon: undefined,
        unionPolygons: undefined
      };
    }
  });

  // Detect isolated tracts if algorithmService and allTracts are provided
  // At Step 0, also detect and group island tracts (geographic islands)
  let isolatedTractsData = null;
  let islandTractsData = null;
  let stepDgAdjacentGroupsByGroup = undefined;
  if (algorithmService && allTracts && allTracts.length > 0) {
    try {
      const detectionResult = algorithmService.detectIsolatedTracts(groupsWithUnions, allTracts, step, step0IslandTractIds);
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
      if (detectionResult.dgAdjacentGroupsByGroup && detectionResult.dgAdjacentGroupsByGroup.size > 0) {
        stepDgAdjacentGroupsByGroup = Object.fromEntries(
          [...detectionResult.dgAdjacentGroupsByGroup.entries()].map(([k, v]) => [String(k), v])
        );
      }
      
      // At Step 0, also store island tract groups
      if (isStep0 && detectionResult.islandTractsByGroup && detectionResult.islandTractsByGroup.size > 0) {
        const islandTractsByGroup = {};
        detectionResult.islandTractsByGroup.forEach((islandGroups, groupIndex) => {
          // islandGroups is an array of arrays (groups of adjacent island tracts)
          islandTractsByGroup[groupIndex] = islandGroups;
        });
        
        const totalIslandTracts = Object.values(islandTractsByGroup).reduce((sum, groups) => 
          sum + groups.reduce((s, g) => s + g.length, 0), 0
        );
        
        islandTractsData = {
          islandTractsByGroup,
          totalIslandTracts,
          totalIslandGroups: Object.values(islandTractsByGroup).reduce((sum, groups) => sum + groups.length, 0),
          groupsWithIslands: Object.keys(islandTractsByGroup).length
        };
        
        console.log(`🏝️ Step 0: Detected ${totalIslandTracts} island tract(s) grouped into ${islandTractsData.totalIslandGroups} island group(s) across ${islandTractsData.groupsWithIslands} district group(s)`);
      } else if (isStep0 && detectionResult.isolatedTractIds.size === 0) {
        console.log(`🏝️ Step 0: No island tracts detected (all tracts are in main component)`);
      }

      // At Step 0, also detect water/special-purpose tracts (no geometry or tract code 990000/999000) and exclude from isolation in steps 1+
      if (isStep0 && allTracts && allTracts.length > 0) {
        const excludedTractIds = [];
        for (const tract of allTracts) {
          if (!isWaterOrSpecialTract(tract)) continue;
          const id = getTractId(tract);
          if (id) excludedTractIds.push(id);
        }
        if (excludedTractIds.length > 0) {
          if (!islandTractsData) {
            islandTractsData = {
              islandTractsByGroup: {},
              totalIslandTracts: 0,
              totalIslandGroups: 0,
              groupsWithIslands: 0
            };
          }
          islandTractsData.excludedTractIds = excludedTractIds;
          // Treat non-movable (water/special) same as island tracts: add to island list for group 0
          const group0Key = 0;
          if (!islandTractsData.islandTractsByGroup[group0Key]) {
            islandTractsData.islandTractsByGroup[group0Key] = [];
          }
          const excludedAsIslandGroups = excludedTractIds.map(id => [id]);
          islandTractsData.islandTractsByGroup[group0Key] = islandTractsData.islandTractsByGroup[group0Key].concat(excludedAsIslandGroups);
          islandTractsData.totalIslandTracts = Object.values(islandTractsData.islandTractsByGroup).reduce((sum, groups) =>
            sum + groups.reduce((s, g) => s + g.length, 0), 0);
          islandTractsData.totalIslandGroups = Object.values(islandTractsData.islandTractsByGroup).reduce((sum, groups) => sum + groups.length, 0);
          islandTractsData.groupsWithIslands = Object.keys(islandTractsData.islandTractsByGroup).length;
          console.log(`🏝️ Step 0: Excluding ${excludedTractIds.length} water/special tract(s) from isolation in later steps: ${excludedTractIds.slice(0, 5).join(', ')}${excludedTractIds.length > 5 ? '...' : ''}`);
        }

        // At Step 0, also exclude tracts with zero adjacency (no S4 neighbors) so they are not flagged as isolated at steps 1+
        if (adjacencyGraph && adjacencyGraph.size > 0) {
          const waterSpecialSet = new Set(excludedTractIds);
          const zeroAdjacencyTractIds = [];
          for (const id of adjacencyGraph.keys()) {
            const neighbors = adjacencyGraph.get(id) || [];
            if (neighbors.length > 0) continue;
            if (waterSpecialSet.has(id)) continue;
            const tract = allTracts.find(t => getTractId(t) === id);
            if (tract && isWaterOrSpecialTract(tract)) continue;
            zeroAdjacencyTractIds.push(id);
          }
          if (zeroAdjacencyTractIds.length > 0) {
            if (!islandTractsData) {
              islandTractsData = {
                islandTractsByGroup: {},
                totalIslandTracts: 0,
                totalIslandGroups: 0,
                groupsWithIslands: 0
              };
            }
            excludedTractIds.push(...zeroAdjacencyTractIds);
            islandTractsData.excludedTractIds = excludedTractIds;
            const group0Key = 0;
            if (!islandTractsData.islandTractsByGroup[group0Key]) {
              islandTractsData.islandTractsByGroup[group0Key] = [];
            }
            const zeroAdjAsIslandGroups = zeroAdjacencyTractIds.map(id => [id]);
            islandTractsData.islandTractsByGroup[group0Key] = islandTractsData.islandTractsByGroup[group0Key].concat(zeroAdjAsIslandGroups);
            islandTractsData.totalIslandTracts = Object.values(islandTractsData.islandTractsByGroup).reduce((sum, groups) =>
              sum + groups.reduce((s, g) => s + g.length, 0), 0);
            islandTractsData.totalIslandGroups = Object.values(islandTractsData.islandTractsByGroup).reduce((sum, groups) => sum + groups.length, 0);
            islandTractsData.groupsWithIslands = Object.keys(islandTractsData.islandTractsByGroup).length;
            console.log(`🏝️ Step 0: Excluding ${zeroAdjacencyTractIds.length} tract(s) with no adjacency from isolation in later steps: ${zeroAdjacencyTractIds.slice(0, 5).join(', ')}${zeroAdjacencyTractIds.length > 5 ? '...' : ''}`);
          }
        }
      }
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
    isolatedTractsData: isolatedTractsData || undefined, // Only include if detected
    islandTractsData: islandTractsData || undefined, // Only include at Step 0 if detected
    dgAdjacentGroupsByGroup: stepDgAdjacentGroupsByGroup
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
      centroid: calculateCentroid(uniqueTracts),
      lastDivisionDirection: null
    };

    // Initialize DG properties for step 0 (all tracts in single group)
    const initialDG = `DG1-${totalDistricts}`;
    for (const tract of uniqueTracts) {
      if (!tract.properties) tract.properties = {};
      tract.properties.tract_DG = initialDG;
      tract.properties.parent_DG = null; // No parent for initial state
      tract.properties.sibling_DG = null; // No sibling for initial state
    }

    // Create step 0 WITHOUT union polygons - Step 0 should use TIGER state boundaries instead.
    // Pass this and uniqueTracts so island detection runs and islandTractsData is set (excluded from isolation at steps 1+).
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
    const newGroups = [];
    const divisionLines = [];
    let stepDirection = 'latitude'; // Primary direction for step (first division in this step)

    // Ensure algorithmHistory is initialized (might be undefined if state was reconstructed from cache)
    if (!algorithmHistory) {
      algorithmState.algorithmHistory = [];
    }

    for (const group of currentGroups) {
      if (group.totalDistricts === 1) {
        newGroups.push(group);
      } else {
        const direction = chooseDivisionDirection(group);
        stepDirection = direction;
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

    // Post-division: move any tract with ENCLOSED_BY into the same DG as its enclosing tract (keeps enclosed+enclosing together even if TRACT_GROUP_ID was missing)
    updatedGroups = this._moveEnclosedTractsToEnclosingGroup(updatedGroups);
    
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
    
    // At step > 0, exclude step-0 island and water/special tracts from isolation detection
    let step0IslandTractIds = null;
    if (nextIteration > 0) {
      const islandSet = new Set();

      // Add step-0 island tracts if available
      if (steps && steps[0] && steps[0].islandTractsData) {
        const step0 = steps[0];
        if (step0.islandTractsData.islandTractsByGroup) {
          for (const islandGroups of Object.values(step0.islandTractsData.islandTractsByGroup)) {
            if (Array.isArray(islandGroups)) {
              for (const group of islandGroups) {
                if (Array.isArray(group)) {
                  group.forEach(id => islandSet.add(id));
                } else if (typeof group === 'string') {
                  islandSet.add(group);
                } else if (group && Array.isArray(group.tractIds)) {
                  group.tractIds.forEach(id => islandSet.add(id));
                }
              }
            }
          }
        }
        if (Array.isArray(step0.islandTractsData.excludedTractIds)) {
          step0.islandTractsData.excludedTractIds.forEach(id => islandSet.add(id));
        }
      }

      // Add water/special tracts from uniqueTracts
      if (Array.isArray(uniqueTracts)) {
        for (const tract of uniqueTracts) {
          if (!isWaterOrSpecialTract(tract)) continue;
          const id = getTractId(tract);
          if (id) islandSet.add(id);
        }
      }

      // Add known CA island tracts (hardcoded for now - could be made configurable)
      const knownCAIslandTracts = ['06037599000', '06037599100', '06075980401', '06083980100', '06111980000'];
      let stateCode = null;
      if (Array.isArray(uniqueTracts) && uniqueTracts.length > 0) {
        const firstTract = uniqueTracts[0];
        stateCode = firstTract?.properties?.STATE || firstTract?.properties?.['STATE_FIPS'] ||
          (firstTract?.properties?.GEOID ? firstTract.properties.GEOID.substring(0, 2) : null);
      }
      if (!stateCode && updatedGroups.length > 0 && updatedGroups[0].censusTracts?.length > 0) {
        const t = updatedGroups[0].censusTracts[0];
        stateCode = t?.properties?.STATE || t?.properties?.['STATE_FIPS'] ||
          (t?.properties?.GEOID ? String(t.properties.GEOID).substring(0, 2) : null);
      }
      if (stateCode === '06' || stateCode === 'CA') {
        knownCAIslandTracts.forEach(id => islandSet.add(id));
      }

      if (islandSet.size > 0) {
        step0IslandTractIds = islandSet;
        console.log(`🏝️ Step ${nextIteration}: Excluding ${islandSet.size} step-0 island/water tract(s) from isolation detection`);
      }
    }

    const createStepStartTime = Date.now();
    const step = createStep(nextIteration, nextIteration, updatedGroups,
      `Division ${nextIteration} by ${stepDirection}`, stepDirection, undefined, divisionLines, this, uniqueTracts, step0IslandTractIds);
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

    // Try to use S4 adjacency data if available (STATE or STATE_FIPS; normalized to abbreviation inside S4 loader)
    const state = tracts[0]?.properties?.['STATE'] || tracts[0]?.properties?.['STATE_FIPS'] || '';
    if (state) {
      const s4AdjacencyGraph = s4DataLoader.getS4AdjacencyData(state);
      
      if (s4AdjacencyGraph) {
        const tractIds = new Set(tracts.map(t => getTractId(t)).filter(Boolean));
        const graph = new Map();
        
        // Initialize all tracts
        for (const tract of tracts) {
          const id = getTractId(tract);
          if (id) graph.set(id, []);
        }
        
        // Populate adjacencies from S4 data
        let tractsWithNeighbors = 0;
        let totalAdjacencies = 0;
        for (const tract of tracts) {
          const id = getTractId(tract);
          if (!id) continue;
          const s4Neighbors = s4AdjacencyGraph.get(id) || [];
          const validNeighbors = s4Neighbors.filter(neighborId => tractIds.has(neighborId));
          graph.set(id, validNeighbors);
          if (validNeighbors.length > 0) {
            tractsWithNeighbors++;
            totalAdjacencies += validNeighbors.length;
          }
        }
        
        // Diagnostic: if few tracts have neighbors, log potential ID mismatch (e.g. CO "nearly all isolated")
        const pctWithNeighbors = tractIds.size > 0 ? (100 * tractsWithNeighbors / tractIds.size) : 0;
        if (pctWithNeighbors < 50 && tractIds.size > 10) {
          const sampleInputIds = Array.from(tractIds).slice(0, 5);
          const sampleS4Keys = Array.from(s4AdjacencyGraph.keys()).slice(0, 5);
          console.warn(`⚠️ ADJACENCY: Only ${pctWithNeighbors.toFixed(1)}% of tracts have S4 neighbors (${tractsWithNeighbors}/${tractIds.size}). Possible ID format mismatch.`);
          console.warn(`   Sample input tract IDs: ${sampleInputIds.join(', ')}`);
          console.warn(`   Sample S4 graph keys:   ${sampleS4Keys.join(', ')}`);
        }
        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`✅ Built adjacency graph using S4 data: ${totalAdjacencies} total relationships for ${tracts.length} tracts (${tractsWithNeighbors} tracts with neighbors)`);
        }
        
        return graph;
      }
    }
    
    // Fallback: For now, return empty graph (geometric intersection would require additional libraries)
    // In production, you'd want to implement geometric intersection here
    const sampleIds = tracts.slice(0, 3).map(t => getTractId(t));
    console.error(`❌ CRITICAL: S4 adjacency data not available for state '${state}' (from first tract), using empty adjacency graph!`);
    console.error(`   This will cause isolation detection to fail (all tracts will appear isolated).`);
    console.error(`   Sample tract IDs from input: ${sampleIds.join(', ')}. Ensure S4 is loaded and state matches.`);
    
    const graph = new Map();
    for (const tract of tracts) {
      const id = getTractId(tract);
      if (id) graph.set(id, []);
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
   * Build connected components (dgAdjacentGroups) for one district group using a single pass:
   * iterate tracts in order, for each unvisited tract run BFS over in-group S4 adjacents only.
   * @param {Array} groupTracts - censusTracts for the group
   * @param {Set<string>} groupTractIds - Set of tract IDs in the group
   * @param {Map<string, Array<string>>} adjacencyGraph - S4 adjacency graph
   * @returns {Array<Set<string>>} - List of connected components (each a Set of tract IDs)
   */
  _buildDgAdjacentGroups(groupTracts, groupTractIds, adjacencyGraph) {
    const visited = new Set();
    const dgAdjacentGroups = [];
    for (const tract of groupTracts) {
      const tractId = getTractId(tract);
      if (!tractId || !groupTractIds.has(tractId)) continue;
      if (visited.has(tractId)) continue;
      const component = new Set();
      const queue = [tractId];
      visited.add(tractId);
      component.add(tractId);
      while (queue.length > 0) {
        const currentId = queue.shift();
        const neighbors = adjacencyGraph.get(currentId) || [];
        for (const neighborId of neighbors) {
          if (neighborId && groupTractIds.has(neighborId) && !visited.has(neighborId)) {
            visited.add(neighborId);
            component.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
      dgAdjacentGroups.push(component);
    }
    return dgAdjacentGroups;
  }

  /**
   * Post-division pass: move any tract with ENCLOSED_BY into the same DG as its enclosing tract.
   * Keeps enclosed and enclosing tracts together when TRACT_GROUP_ID was missing or division split them.
   * @param {Array} districtGroups - District groups (will be mutated)
   * @returns {Array} The same districtGroups array (possibly with tracts moved)
   */
  _moveEnclosedTractsToEnclosingGroup(districtGroups) {
    if (!districtGroups || districtGroups.length === 0) return districtGroups;
    const tractIdToGroupIndex = new Map();
    for (let i = 0; i < districtGroups.length; i++) {
      for (const t of districtGroups[i].censusTracts || []) {
        const id = getTractId(t);
        if (id) tractIdToGroupIndex.set(id, i);
      }
    }
    let moved = 0;
    for (let fromIdx = 0; fromIdx < districtGroups.length; fromIdx++) {
      const group = districtGroups[fromIdx];
      const tracts = group.censusTracts || [];
      const toMove = [];
      for (const tract of tracts) {
        const enclosingId = tract.properties?.ENCLOSED_BY;
        if (!enclosingId) continue;
        const toIdx = tractIdToGroupIndex.get(enclosingId);
        if (toIdx === undefined || toIdx === fromIdx) continue;
        toMove.push({ tract, toIdx });
      }
      for (const { tract, toIdx } of toMove) {
        const tractId = getTractId(tract);
        const fromGroup = districtGroups[fromIdx];
        const toGroup = districtGroups[toIdx];
        const idx = fromGroup.censusTracts.findIndex(t => getTractId(t) === tractId);
        if (idx === -1) continue;
        fromGroup.censusTracts.splice(idx, 1);
        fromGroup.totalPopulation = (fromGroup.censusTracts || []).reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
        fromGroup.bounds = calculateBounds(fromGroup.censusTracts || []);
        fromGroup.centroid = calculateCentroid(fromGroup.censusTracts || []);
        if (!toGroup.censusTracts.some(t => getTractId(t) === tractId)) {
          toGroup.censusTracts.push(tract);
          toGroup.totalPopulation = (toGroup.censusTracts || []).reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
          toGroup.bounds = calculateBounds(toGroup.censusTracts || []);
          toGroup.centroid = calculateCentroid(toGroup.censusTracts || []);
          if (tract.properties) {
            const targetDG = `DG${toGroup.startDistrictNumber}-${toGroup.endDistrictNumber}`;
            const sourceDG = `DG${fromGroup.startDistrictNumber}-${fromGroup.endDistrictNumber}`;
            tract.properties.tract_DG = targetDG;
            tract.properties.sibling_DG = sourceDG;
          }
          tractIdToGroupIndex.set(tractId, toIdx);
          moved++;
          if (tractId && tractId.includes('48409')) {
            console.log(`🔄 Post-division: moved enclosed tract ${tractId} to same DG as enclosing ${enclosingId} (DG ${toGroup.startDistrictNumber}-${toGroup.endDistrictNumber})`);
          }
        }
      }
    }
    if (moved > 0) {
      console.log(`✅ Post-division ENCLOSED_BY: moved ${moved} enclosed tract(s) to same DG as enclosing tract`);
    }
    return districtGroups;
  }

  /**
   * Detect isolated tracts across all groups without fixing them.
   * Uses one-pass connected components per DG (fast): main component = largest dgAdjacentGroup, isolated = rest.
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {number} stepNumber - Step number (optional, used to exclude island tracts at Step 0)
   * @param {Set<string>|string[]|null} step0IslandTractIds - Optional. Geographic island tract IDs from step 0; at steps > 0 these are excluded from isolation (per doc 251204).
   * @returns {Object} - isolatedTractsByGroup (Map), isolatedTractIds (Set), groupStats, islandTractsByGroup (Step 0 only), isolatedComponentsByGroup (Map of groupIndex -> Array<Set> of non-main components)
   */
  detectIsolatedTracts(districtGroups, allTracts, stepNumber = null, step0IslandTractIds = null) {
    const isStep0 = stepNumber === 0 || stepNumber === '0';
    const islandSet = step0IslandTractIds instanceof Set ? step0IslandTractIds : (Array.isArray(step0IslandTractIds) ? new Set(step0IslandTractIds) : null);
    logger.debug(`🔍 DETECT ISOLATED: Starting isolation detection for ${districtGroups.length} groups with ${allTracts.length} total tracts (island tracts will be excluded in all steps)`);
    
    if (districtGroups.length < 1) {
      return {
        isolatedTractsByGroup: new Map(),
        isolatedTractIds: new Set(),
        groupStats: [],
        isolatedComponentsByGroup: new Map()
      };
    }
    
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    const totalTractsInGroups = districtGroups.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0);
    logger.debug(`🔍 DETECT ISOLATED: Built adjacency graph with ${adjacencyGraph.size} entries for ${allTracts.length} total tracts, ${totalTractsInGroups} tracts in groups`);
    
    const isolatedTractsByGroup = new Map();
    const isolatedTractIds = new Set();
    const islandTractsByGroup = new Map();
    const isolatedComponentsByGroup = new Map();
    const dgAdjacentGroupsByGroup = new Map();
    const groupStats = [];

    // Enclosed (donut-hole) tracts are allowed and follow their enclosing tract (GDIP-004 §3.1.1); exclude from isolated set at steps > 0
    const enclosedTractIds = new Set();
    for (const group of districtGroups) {
      for (const tract of group.censusTracts || []) {
        if (tract.properties?.ENCLOSED_BY) {
          const id = getTractId(tract);
          if (id) enclosedTractIds.add(id);
        }
      }
    }

    for (let groupIndex = 0; groupIndex < districtGroups.length; groupIndex++) {
      const group = districtGroups[groupIndex];
      const totalTractsInGroup = group.censusTracts.length;
      
      if (totalTractsInGroup === 0) {
        dgAdjacentGroupsByGroup.set(groupIndex, []);
        groupStats.push({
          groupIndex,
          maxReachable: 0,
          totalTracts: 0,
          groupLabel: `${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}`
        });
        continue;
      }
      
      const groupTractIds = new Set(group.censusTracts.map(t => getTractId(t)).filter(Boolean));
      const dgAdjacentGroups = this._buildDgAdjacentGroups(group.censusTracts, groupTractIds, adjacencyGraph);
      dgAdjacentGroupsByGroup.set(groupIndex, dgAdjacentGroups.map(s => Array.from(s)));
      
      if (dgAdjacentGroups.length === 0) {
        groupStats.push({
          groupIndex,
          maxReachable: 0,
          totalTracts: totalTractsInGroup,
          groupLabel: `${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}`
        });
        continue;
      }
      
      let mainComponentSize = 0;
      let mainComponent = null;
      const isolatedComponents = [];
      for (const comp of dgAdjacentGroups) {
        if (comp.size > mainComponentSize) {
          mainComponentSize = comp.size;
          mainComponent = comp;
        }
      }
      for (const comp of dgAdjacentGroups) {
        if (comp !== mainComponent) {
          isolatedComponents.push(comp);
        }
      }
      
      groupStats.push({
        groupIndex,
        maxReachable: mainComponentSize,
        totalTracts: totalTractsInGroup,
        groupLabel: `${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}`
      });
      
      if (mainComponentSize < totalTractsInGroup * 0.1) {
        console.warn(`⚠️ DETECT ISOLATED: Suspiciously low main component for group ${group.startDistrictNumber}-${group.endDistrictNumber}: ${mainComponentSize} out of ${totalTractsInGroup} tracts`);
      }
      
      if (isolatedComponents.length === 0) {
        continue;
      }
      
      const groupIsolatedTractIds = new Set();
      for (const comp of isolatedComponents) {
        for (const id of comp) {
          groupIsolatedTractIds.add(id);
        }
      }
      
      if (!isStep0 && islandSet && islandSet.size > 0) {
        for (const islandId of islandSet) {
          groupIsolatedTractIds.delete(islandId);
        }
      }

      if (!isStep0 && enclosedTractIds.size > 0) {
        let removedEnclosed = 0;
        for (const enclosedId of enclosedTractIds) {
          if (groupIsolatedTractIds.has(enclosedId)) {
            groupIsolatedTractIds.delete(enclosedId);
            removedEnclosed++;
          }
        }
        if (removedEnclosed > 0) {
          logger.debug(`🔍 DETECT ISOLATED: Excluded ${removedEnclosed} enclosed tract(s) from isolation in group ${group.startDistrictNumber}-${group.endDistrictNumber} (allowed per GDIP-004 §3.1.1)`);
        }
      }

      if (groupIsolatedTractIds.size > 0) {
        if (isStep0) {
          const islandGroups = isolatedComponents.map(s => Array.from(s));
          console.log(`🏝️ Group ${group.startDistrictNumber}-${group.endDistrictNumber}: ${groupIsolatedTractIds.size} island tract(s) detected at Step 0, grouped into ${islandGroups.length} island group(s)`);
          console.log(`   Main component (mainland): ${mainComponentSize} tract(s)`);
          islandGroups.forEach((islandGroup, idx) => {
            console.log(`   Island group ${idx + 1}: ${islandGroup.length} tract(s) - ${islandGroup.slice(0, 5).join(', ')}${islandGroup.length > 5 ? '...' : ''}`);
          });
          islandTractsByGroup.set(groupIndex, islandGroups);
        } else {
          for (const tractId of groupIsolatedTractIds) {
            isolatedTractIds.add(tractId);
          }
          isolatedTractsByGroup.set(groupIndex, groupIsolatedTractIds);
          isolatedComponentsByGroup.set(groupIndex, isolatedComponents);
          console.log(`🔍 Group ${group.startDistrictNumber}-${group.endDistrictNumber}: ${groupIsolatedTractIds.size} isolated tract(s) detected`);
          const isolatedArray = Array.from(groupIsolatedTractIds).slice(0, 10);
          console.log(`   Isolated tract IDs: ${isolatedArray.join(', ')}${groupIsolatedTractIds.size > 10 ? '...' : ''}`);
        }
      }
    }
    
    logger.debug(`✅ DETECT ISOLATED: Found ${isolatedTractIds.size} isolated tracts across ${isolatedTractsByGroup.size} groups`);
    if (isStep0 && islandTractsByGroup.size > 0) {
      const totalIslandTracts = Array.from(islandTractsByGroup.values()).reduce((sum, groups) => sum + groups.reduce((s, g) => s + g.length, 0), 0);
      logger.debug(`🏝️ DETECT ISLANDS: Found ${totalIslandTracts} island tracts grouped into ${islandTractsByGroup.size} district group(s) at Step 0`);
    }
    // Log post-division isolated summary for steps > 0 (confirms main component is not in isolated list)
    if (!isStep0 && isolatedTractIds.size > 0) {
      const byGroupSummary = {};
      isolatedTractsByGroup.forEach((ids, idx) => { byGroupSummary[idx] = ids.size; });
      const sampleIds = Array.from(isolatedTractIds).slice(0, 15);
      console.log(`📋 POST-DIVISION ISOLATED (step ${stepNumber}): total=${isolatedTractIds.size}, groups=${isolatedTractsByGroup.size}, byGroup=${JSON.stringify(byGroupSummary)}, sample IDs: ${sampleIds.join(', ')}${isolatedTractIds.size > 15 ? '...' : ''}`);
    }

    return {
      isolatedTractsByGroup,
      isolatedTractIds,
      groupStats,
      islandTractsByGroup: isStep0 ? islandTractsByGroup : new Map(),
      isolatedComponentsByGroup: isStep0 ? new Map() : isolatedComponentsByGroup,
      dgAdjacentGroupsByGroup
    };
  }

  /**
   * Group adjacent island tracts together
   * Island tracts that are adjacent to each other form a group
   * @param {Array<string>} islandTractIds - Array of island tract IDs
   * @param {Map<string, Array<string>>} adjacencyGraph - Adjacency graph for all tracts
   * @returns {Array<Array<string>>} Array of island groups, where each group is an array of adjacent tract IDs
   */
  groupAdjacentIslandTracts(islandTractIds, adjacencyGraph) {
    if (islandTractIds.length === 0) {
      return [];
    }
    
    const islandTractSet = new Set(islandTractIds);
    const visited = new Set();
    const islandGroups = [];
    
    for (const tractId of islandTractIds) {
      if (visited.has(tractId)) {
        continue;
      }
      
      // BFS to find all adjacent island tracts
      const islandGroup = [];
      const queue = [tractId];
      visited.add(tractId);
      
      while (queue.length > 0) {
        const currentId = queue.shift();
        islandGroup.push(currentId);
        
        // Find adjacent island tracts
        const neighbors = adjacencyGraph.get(currentId) || [];
        for (const neighborId of neighbors) {
          if (islandTractSet.has(neighborId) && !visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
      
      if (islandGroup.length > 0) {
        islandGroups.push(islandGroup);
      }
    }
    
    return islandGroups;
  }

  /**
   * Detect bridge tracts that could connect isolated tracts.
   * When isolatedComponentsByGroup is provided, only considers isolated components with 2+ tracts (bridge detection for multi-tract isolations only).
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {Map} isolatedTractsByGroup - Map of groupIndex -> Set of isolated tract IDs
   * @param {Map} isolatedComponentsByGroup - Optional. Map of groupIndex -> Array<Set> of non-main components. When present, bridge detection only uses isolated tracts in components with size >= 2.
   * @returns {Object} - Object with bridgeTractsByIsolatedGroup (Map of groupIndex -> Array of {tractId, fromGroupIndex, adjacentIsolatedCount})
   */
  detectBridgeTracts(districtGroups, allTracts, isolatedTractsByGroup, isolatedComponentsByGroup = null) {
    logger.debug(`🌉 DETECT BRIDGE TRACTS: Starting bridge tract detection for ${isolatedTractsByGroup.size} groups with isolated tracts`);
    
    if (districtGroups.length < 2 || isolatedTractsByGroup.size === 0) {
      return { bridgeTractsByIsolatedGroup: new Map() };
    }
    
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    const bridgeTractsByIsolatedGroup = new Map();
    
    for (const [isolatedGroupIndex, isolatedTractIds] of isolatedTractsByGroup.entries()) {
      const isolatedGroup = districtGroups[isolatedGroupIndex];
      if (!isolatedGroup) continue;
      
      // When isolatedComponentsByGroup is provided, only run bridge for groups that have at least one component with 2+ tracts; restrict to those tracts.
      let isolatedTractIdsForBridge = isolatedTractIds;
      if (isolatedComponentsByGroup && isolatedComponentsByGroup.has(isolatedGroupIndex)) {
        const components = isolatedComponentsByGroup.get(isolatedGroupIndex);
        const multiTractComponents = components.filter(c => c.size >= 2);
        if (multiTractComponents.length === 0) {
          continue; // No multi-tract isolated component; skip bridge detection for this group
        }
        const allowedSet = new Set();
        for (const c of multiTractComponents) {
          for (const id of c) {
            allowedSet.add(id);
          }
        }
        isolatedTractIdsForBridge = allowedSet;
      }
      
      // Bridge tracts must ONLY come from the original parent DG (sibling = other half of same parent division).
      // Do not consider tracts outside the parent DG.
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
      
      // Find all tracts in the SIBLING GROUP ONLY that are adjacent to isolated tracts (or to isolated tracts in multi-tract components when isolatedComponentsByGroup is used)
      const candidateBridgeTracts = new Map(); // Map<tractId, {fromGroupIndex, adjacentIsolatedCount}>
      
      for (const isolatedTractId of isolatedTractIdsForBridge) {
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
      const isolatedCount = isolatedTractIdsForBridge.size;
      const isLargeIsolation = isolatedCount >= 10;
      
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
    
    // Fallback for single-district isolated groups when divisionLines don't yield sibling
    if (!siblingDG && isolatedGroup.startDistrictNumber === isolatedGroup.endDistrictNumber) {
      const n = isolatedGroup.startDistrictNumber;
      const totalDistricts = Math.max(...districtGroups.map(g => g.endDistrictNumber || g.startDistrictNumber), n);
      if (n + 1 <= totalDistricts && districtGroups.some(g => g.startDistrictNumber === n + 1 && g.endDistrictNumber === n + 1)) {
        siblingDG = `DG${n + 1}-${n + 1}`;
        console.log(`   Fallback: using adjacent single-district sibling ${siblingDG} for bridge move`);
      } else if (n - 1 >= 1 && districtGroups.some(g => g.startDistrictNumber === n - 1 && g.endDistrictNumber === n - 1)) {
        siblingDG = `DG${n - 1}-${n - 1}`;
        console.log(`   Fallback: using adjacent single-district sibling ${siblingDG} for bridge move`);
      }
      if (!siblingDG) {
        const other = districtGroups.find(g =>
          g.startDistrictNumber === g.endDistrictNumber &&
          (g.startDistrictNumber !== isolatedGroup.startDistrictNumber || g.endDistrictNumber !== isolatedGroup.endDistrictNumber)
        );
        if (other) {
          siblingDG = `DG${other.startDistrictNumber}-${other.endDistrictNumber}`;
          console.log(`   Fallback: using any single-district sibling ${siblingDG} for bridge move`);
        }
      }
    }

    // Fallback for range groups when divisionLines don't contain this group
    if (!siblingDG && isolatedGroup.startDistrictNumber < isolatedGroup.endDistrictNumber) {
      const low = isolatedGroup.startDistrictNumber;
      const high = isolatedGroup.endDistrictNumber;
      const adjacentBefore = districtGroups.find(g => g.endDistrictNumber === low - 1);
      const adjacentAfter = districtGroups.find(g => g.startDistrictNumber === high + 1);
      if (adjacentBefore) {
        siblingDG = `DG${adjacentBefore.startDistrictNumber}-${adjacentBefore.endDistrictNumber}`;
        console.log(`   Fallback: using adjacent range sibling ${siblingDG} (before) for bridge move`);
      } else if (adjacentAfter) {
        siblingDG = `DG${adjacentAfter.startDistrictNumber}-${adjacentAfter.endDistrictNumber}`;
        console.log(`   Fallback: using adjacent range sibling ${siblingDG} (after) for bridge move`);
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
    // Create a copy of district groups to modify (guard against missing censusTracts)
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: Array.isArray(group.censusTracts) ? [...group.censusTracts] : []
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
    
    // Don't re-run isolation detection here - it's expensive and will be done once at the end
    // Just return the updated groups
    return {
      districtGroups: updatedGroups
    };
  }

  /**
   * Get district group indices that are S4-adjacent to an isolated component (neighbors of any tract in the component belong to these DGs).
   * @private
   * @param {Set<string>|string[]} componentTractIds - Tract IDs in the isolated component
   * @param {number} sourceGroupIndex - Index of the group that contains the component
   * @param {Map<string, number>} tractIdToGroupIndex - Map from tract ID to group index
   * @param {Map<string, string[]>} adjacencyGraph - S4 adjacency graph
   * @returns {number[]} - Unique adjacent group indices (excluding source)
   */
  _getAdjacentGroupIndicesForComponent(componentTractIds, sourceGroupIndex, tractIdToGroupIndex, adjacencyGraph) {
    const adjacent = new Set();
    const idList = componentTractIds instanceof Set ? Array.from(componentTractIds) : componentTractIds;
    for (const tractId of idList) {
      const neighbors = adjacencyGraph.get(tractId) || [];
      for (const neighborId of neighbors) {
        const gi = tractIdToGroupIndex.get(neighborId);
        if (gi !== undefined && gi !== sourceGroupIndex) {
          adjacent.add(gi);
        }
      }
    }
    return Array.from(adjacent);
  }

  /**
   * Choose target group for moving an isolated component: prefer division-tree sibling if adjacent, else first adjacent.
   * @private
   * @param {number[]} adjacentGroupIndices - Candidate target group indices (from _getAdjacentGroupIndicesForComponent)
   * @param {Set<string>|string[]} componentTractIds - Tract IDs in the component
   * @param {Array} districtGroups - Current district groups
   * @param {Array} allTracts - All tracts (to read sibling_DG from a tract in the component)
   * @returns {number|null} - Chosen target group index, or null if no adjacent groups
   */
  _chooseTargetGroupForComponent(adjacentGroupIndices, componentTractIds, districtGroups, allTracts) {
    if (!adjacentGroupIndices || adjacentGroupIndices.length === 0) return null;
    const firstId = componentTractIds instanceof Set ? componentTractIds.values().next().value : componentTractIds[0];
    const tract = allTracts.find(t => getTractId(t) === firstId);
    const siblingDG = tract?.properties?.sibling_DG;
    if (siblingDG) {
      const match = siblingDG.match(/DG(\d+)-(\d+)/);
      if (match) {
        const siblingStart = parseInt(match[1], 10);
        const siblingEnd = parseInt(match[2], 10);
        for (let i = 0; i < districtGroups.length; i++) {
          if (districtGroups[i].startDistrictNumber === siblingStart &&
              districtGroups[i].endDistrictNumber === siblingEnd) {
            if (adjacentGroupIndices.includes(i)) return i;
            break;
          }
        }
      }
    }
    return Math.min(...adjacentGroupIndices);
  }

  /**
   * Move isolated tracts by adjacency: for each isolated component, choose an adjacent DG (sibling first), move entire component.
   * Used at final step only (strategy finalStepOnly run-mode and Move Isolated Tracts button at final step).
   * @param {Array} districtGroups - Current district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {Object} isolationResult - Result of detectIsolatedTracts (isolatedTractsByGroup, isolatedComponentsByGroup)
   * @param {Set<string>|string[]|null} step0IslandTractIds - Optional step-0 island tract IDs to exclude
   * @returns {Object} - { districtGroups, movedComponents, movedTractCount }
   */
  moveIsolatedComponentsByAdjacency(districtGroups, allTracts, isolationResult, step0IslandTractIds = null) {
    const islandSet = step0IslandTractIds instanceof Set ? step0IslandTractIds : (Array.isArray(step0IslandTractIds) ? new Set(step0IslandTractIds) : null);
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);

    let updatedGroups = districtGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));
    let movedComponents = 0;
    let movedTractCount = 0;
    const unmovableTractIds = [];

    const buildTractIdToGroupIndex = (groups) => {
      const map = new Map();
      for (let i = 0; i < groups.length; i++) {
        for (const t of groups[i].censusTracts || []) {
          const id = getTractId(t);
          if (id) map.set(id, i);
        }
      }
      return map;
    };

    const isolatedTractsByGroup = isolationResult.isolatedTractsByGroup;
    const isolatedComponentsByGroup = isolationResult.isolatedComponentsByGroup || new Map();

    const groupEntries = isolatedTractsByGroup instanceof Map
      ? isolatedTractsByGroup.entries()
      : Object.entries(isolatedTractsByGroup || {});
    for (const [key, isolatedTractIds] of groupEntries) {
      const groupIndex = typeof key === 'number' ? key : parseInt(key, 10);
      if (Number.isNaN(groupIndex) || groupIndex < 0 || groupIndex >= updatedGroups.length) continue;
      const groupIsolated = isolatedTractIds instanceof Set ? Array.from(isolatedTractIds) : (Array.isArray(isolatedTractIds) ? isolatedTractIds : []);
      if (groupIsolated.length === 0) continue;

      let components;
      const hasComponents = isolatedComponentsByGroup && (isolatedComponentsByGroup instanceof Map ? isolatedComponentsByGroup.has(groupIndex) : Object.prototype.hasOwnProperty.call(isolatedComponentsByGroup, groupIndex));
      if (hasComponents) {
        components = isolatedComponentsByGroup.get ? isolatedComponentsByGroup.get(groupIndex) : isolatedComponentsByGroup[groupIndex];
        if (!Array.isArray(components)) {
          components = components instanceof Set ? [components] : [new Set(components)];
        } else {
          components = components.map(c => c instanceof Set ? c : new Set(c));
        }
      } else {
        components = groupIsolated.map(id => new Set([id]));
      }

      for (const component of components) {
        const componentIds = Array.from(component);
        const toMove = islandSet ? componentIds.filter(id => !islandSet.has(id)) : componentIds;
        if (toMove.length === 0) continue;

        const tractIdToGroupIndex = buildTractIdToGroupIndex(updatedGroups);
        const adjacentIndices = this._getAdjacentGroupIndicesForComponent(toMove, groupIndex, tractIdToGroupIndex, adjacencyGraph);
        if (adjacentIndices.length === 0) {
          toMove.forEach(id => unmovableTractIds.push(id));
          const sampleIds = toMove.slice(0, 5).join(', ') + (toMove.length > 5 ? ` ... (${toMove.length} total)` : '');
          logger.debug(`   No adjacent district for isolated component (${toMove.length} tract(s)), skipping (added to island list). Tract IDs: ${sampleIds}`);
          continue;
        }

        const targetGroupIndex = this._chooseTargetGroupForComponent(adjacentIndices, toMove, updatedGroups, allTracts);
        if (targetGroupIndex === null) continue;

        const result = this._moveTractsToGroup(updatedGroups, allTracts, groupIndex, toMove, targetGroupIndex, true);
        updatedGroups = result.districtGroups;
        movedComponents++;
        movedTractCount += toMove.length;
      }
    }

    return {
      districtGroups: updatedGroups,
      movedComponents,
      movedTractCount,
      unmovableTractIds
    };
  }

  /**
   * Move isolated tracts to opposite group (sibling group from same parent division) and re-run isolation detection
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {number} isolatedGroupIndex - Index of the group with isolated tracts
   * @param {Array} isolatedTractIds - Array of isolated tract IDs to move
   * @param {Array} divisionLines - Optional array of division line metadata with sibling relationships
   * @param {boolean} skipBalancing - If true, do not run compensating balance after this move (used by move-all-isolated flow)
   * @returns {Object} - Updated district groups and new isolation detection results
   */
  moveIsolatedTractsToOppositeGroup(districtGroups, allTracts, isolatedGroupIndex, isolatedTractIds, divisionLines = null, skipBalancing = true) {
    // Single-line summary only; per-tract logs removed for readability
    
    if (isolatedGroupIndex < 0 || isolatedGroupIndex >= districtGroups.length) {
      throw new Error(`Invalid isolated group index: ${isolatedGroupIndex}`);
    }
    
    const isolatedGroup = districtGroups[isolatedGroupIndex];
    if (!isolatedGroup) {
      throw new Error(`Group at index ${isolatedGroupIndex} not found`);
    }
    if (!Array.isArray(isolatedGroup.censusTracts)) {
      throw new Error(`Group ${isolatedGroupIndex} (DG${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}) has no censusTracts array. Re-run the algorithm or reload the step.`);
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
        break;
      }
    }
    
    // If not found in isolated group, try from allTracts
    if (!siblingDG) {
      for (const tractId of isolatedTractIds) {
        const tract = allTracts.find(t => getTractId(t) === tractId);
        if (tract && tract.properties?.sibling_DG) {
          siblingDG = tract.properties.sibling_DG;
          break;
        }
      }
    }
    
    // If sibling_DG is missing, try to set it from divisionLines metadata
    // This fixes data integrity issues where sibling_DG wasn't set during division or reconstruction
    if (!siblingDG && divisionLines && Array.isArray(divisionLines)) {
      
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
              // Update all isolated tracts with the correct sibling_DG
              const parentDG = divLine.parentGroup ? `DG${divLine.parentGroup.startDistrictNumber}-${divLine.parentGroup.endDistrictNumber}` : null;
              for (const tractId of isolatedTractIds) {
                const tract = allTracts.find(t => getTractId(t) === tractId);
                if (tract) {
                  if (!tract.properties) tract.properties = {};
                  tract.properties.sibling_DG = siblingDG;
                  if (parentDG) tract.properties.parent_DG = parentDG;
                }
              }
              break;
            }
          }
        }
      }
    }
    
    // Fallback for single-district groups when divisionLines are missing or don't contain this group
    // (e.g. step cache incomplete). Sibling of N-N is typically (N+1)-(N+1) or (N-1)-(N-1).
    if (!siblingDG && isolatedGroup.startDistrictNumber === isolatedGroup.endDistrictNumber) {
      const n = isolatedGroup.startDistrictNumber;
      const totalDistricts = Math.max(...districtGroups.map(g => g.endDistrictNumber || g.startDistrictNumber), n);
      if (n + 1 <= totalDistricts) {
        const nextExists = districtGroups.some(g => g.startDistrictNumber === n + 1 && g.endDistrictNumber === n + 1);
        if (nextExists) {
          siblingDG = `DG${n + 1}-${n + 1}`;
          console.log(`   Fallback: using adjacent single-district sibling ${siblingDG} for ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
        }
      }
      if (!siblingDG && n - 1 >= 1) {
        const prevExists = districtGroups.some(g => g.startDistrictNumber === n - 1 && g.endDistrictNumber === n - 1);
        if (prevExists) {
          siblingDG = `DG${n - 1}-${n - 1}`;
          console.log(`   Fallback: using adjacent single-district sibling ${siblingDG} for ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
        }
      }
      // Last resort: use any other single-district group as sibling (e.g. when divisionLines incomplete)
      if (!siblingDG) {
        const other = districtGroups.find(g =>
          g.startDistrictNumber === g.endDistrictNumber &&
          (g.startDistrictNumber !== isolatedGroup.startDistrictNumber || g.endDistrictNumber !== isolatedGroup.endDistrictNumber)
        );
        if (other) {
          siblingDG = `DG${other.startDistrictNumber}-${other.endDistrictNumber}`;
          console.log(`   Fallback: using any single-district sibling ${siblingDG} for ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
        }
      }
    }

    // Fallback for range groups (e.g. 8-14) when divisionLines don't contain this group - use adjacent range by district number
    if (!siblingDG && isolatedGroup.startDistrictNumber < isolatedGroup.endDistrictNumber) {
      const low = isolatedGroup.startDistrictNumber;
      const high = isolatedGroup.endDistrictNumber;
      const adjacentBefore = districtGroups.find(g => g.endDistrictNumber === low - 1);
      const adjacentAfter = districtGroups.find(g => g.startDistrictNumber === high + 1);
      if (adjacentBefore) {
        siblingDG = `DG${adjacentBefore.startDistrictNumber}-${adjacentBefore.endDistrictNumber}`;
        console.log(`   Fallback: using adjacent range sibling ${siblingDG} (before) for ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
      } else if (adjacentAfter) {
        siblingDG = `DG${adjacentAfter.startDistrictNumber}-${adjacentAfter.endDistrictNumber}`;
        console.log(`   Fallback: using adjacent range sibling ${siblingDG} (after) for ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}`);
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
            break;
          }
        }
      }
    }
    
    if (siblingGroupIndex === null) {
      const divInfo = divisionLines && Array.isArray(divisionLines)
        ? ` (${divisionLines.length} division line(s), none matched group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber})`
        : ' (no divisionLines)';
      throw new Error(`Cannot find sibling group for isolated group ${isolatedGroup.startDistrictNumber}-${isolatedGroup.endDistrictNumber}. sibling_DG should be set on all tracts after division.${divInfo}`);
    }
    
    const siblingGroup = districtGroups[siblingGroupIndex];
    // Validate that sibling group index is valid
    if (siblingGroupIndex < 0 || siblingGroupIndex >= districtGroups.length) {
      throw new Error(`Invalid sibling group index: ${siblingGroupIndex} (total groups: ${districtGroups.length})`);
    }

    return this._moveTractsToGroup(districtGroups, allTracts, isolatedGroupIndex, isolatedTractIds, siblingGroupIndex, skipBalancing);
  }

  /**
   * Target population variance for sibling DG balance (e.g. 0.01 = 1%). Used when choosing
   * compensating tract so that sibling groups end up within this variance of ideal split.
   */
  static get BALANCE_TARGET_VARIANCE() { return 0.01; }

  /**
   * Find a tract in the target group that borders the source group such that moving it to the
   * source brings the two sibling DGs' populations within target variance and as close to
   * balanced as possible (uses current sibling populations, not moved-tract population).
   * @private
   * @param {Array} districtGroups - Current district groups (after isolated tracts were moved to target)
   * @param {number} sourceGroupIndex - Index of source group (e.g. isolated group)
   * @param {number} targetGroupIndex - Index of target group (e.g. sibling that received isolated tracts)
   * @param {Map} adjacencyGraph - Tract adjacency graph
   * @returns {string[]|null} - Array of tract IDs to move from target to source, or null if none suitable
   */
  _findBalancingTract(districtGroups, sourceGroupIndex, targetGroupIndex, adjacencyGraph) {
    const sourceGroup = districtGroups[sourceGroupIndex];
    const targetGroup = districtGroups[targetGroupIndex];
    if (!sourceGroup || !targetGroup || targetGroup.censusTracts.length === 0) return null;

    const S = sourceGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    const T = targetGroup.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    const total = S + T;
    if (total <= 0) return null;
    const ideal = total / 2;
    const targetMovePop = (T - S) / 2;

    const sourceGroupTractIds = new Set(sourceGroup.censusTracts.map(t => getTractId(t)));
    const boundaryTracts = targetGroup.censusTracts.filter(t => {
      const tid = getTractId(t);
      const neighbors = adjacencyGraph.get(tid) || [];
      return neighbors.some(n => sourceGroupTractIds.has(n));
    });
    if (boundaryTracts.length === 0) return null;

    // Score each candidate: after moving tract with pop P, newSource = S+P, newTarget = T-P.
    // Variance from ideal = max(|newSource - ideal|, |newTarget - ideal|) / ideal. Prefer smallest.
    const variance = (P) => {
      const newSource = S + P;
      const newTarget = T - P;
      return Math.max(Math.abs(newSource - ideal), Math.abs(newTarget - ideal)) / ideal;
    };

    boundaryTracts.sort((a, b) => {
      const popA = a.properties?.POPULATION || 0;
      const popB = b.properties?.POPULATION || 0;
      const varA = variance(popA);
      const varB = variance(popB);
      if (varA !== varB) return varA - varB;
      return Math.abs(popA - targetMovePop) - Math.abs(popB - targetMovePop);
    });

    for (const tract of boundaryTracts) {
      const tractId = getTractId(tract);
      const remainingTracts = targetGroup.censusTracts.filter(t => getTractId(t) !== tractId);
      if (remainingTracts.length === 0) continue;
      const maxReachable = this.calculateMaxReachableCount(remainingTracts, adjacencyGraph);
      if (maxReachable >= remainingTracts.length * 0.95) {
        return [tractId];
      }
    }
    return null;
  }

  /**
   * Get balancing tract IDs for an isolated group (tracts that would be moved from sibling to source to balance population).
   * Used by detect-isolated-tracts to show a preview in the UI.
   * @param {Array} districtGroups - Current district groups
   * @param {Array} allTracts - All tracts (for building adjacency graph)
   * @param {number} isolatedGroupIndex - Index of the group that has isolated tracts (source)
   * @returns {string[]|null} - Array of tract IDs that would be used for balancing, or null
   */
  getBalancingTractIdsForGroup(districtGroups, allTracts, isolatedGroupIndex) {
    const isolatedGroup = districtGroups[isolatedGroupIndex];
    if (!isolatedGroup || !isolatedGroup.censusTracts.length) return null;

    let siblingDG = null;
    for (const tract of isolatedGroup.censusTracts) {
      if (tract.properties?.sibling_DG) {
        siblingDG = tract.properties.sibling_DG;
        break;
      }
    }
    if (!siblingDG) return null;

    const match = siblingDG.match(/DG(\d+)-(\d+)/);
    if (!match) return null;
    const siblingStart = parseInt(match[1], 10);
    const siblingEnd = parseInt(match[2], 10);
    let siblingGroupIndex = null;
    for (let i = 0; i < districtGroups.length; i++) {
      if (districtGroups[i].startDistrictNumber === siblingStart &&
          districtGroups[i].endDistrictNumber === siblingEnd) {
        siblingGroupIndex = i;
        break;
      }
    }
    if (siblingGroupIndex === null) return null;

    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    return this._findBalancingTract(districtGroups, isolatedGroupIndex, siblingGroupIndex, adjacencyGraph);
  }

  /**
   * Helper method to move tracts from one group to another
   * @private
   * @param {boolean} skipBalancing - If true, do not perform compensating move (used when this call is the balancing move)
   */
  _moveTractsToGroup(districtGroups, allTracts, sourceGroupIndex, tractIds, targetGroupIndex, skipBalancing = true) {
    // Create a copy of district groups to modify
    const updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    const sourceGroup = updatedGroups[sourceGroupIndex];
    const targetGroup = updatedGroups[targetGroupIndex];
    let movedCount = 0;
    const skippedTractIds = []; // Tracts skipped (no neighbor in any group) so caller can stop retrying

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

      // Skip water/special-purpose tracts (no boundary data); they are non-movable and would block move-all
      if (isWaterOrSpecialTract(tract)) {
        console.warn(`⚠️ Non-movable tract (water/special, no boundary data): ${tractId} — skipping move.`);
        skippedTractIds.push(tractId);
        if (!sourceGroup.censusTracts.some(t => getTractId(t) === tractId)) {
          sourceGroup.censusTracts.push(tract);
        }
        continue;
      }
      
      // Log if tract was found in multiple groups (duplicate issue)
      if (foundInGroups.length > 1) {
        console.warn(`⚠️ DUPLICATE TRACT: Tract ${tractId} was found in ${foundInGroups.length} groups: ${foundInGroups.join(', ')}. Removing from all before moving to target.`);
      }
      
      // Check if tract will still be isolated in target group (prevent infinite loops)
      const neighbors = adjacencyGraph.get(tractId) || [];
      const hasNeighborInTarget = neighbors.some(neighborId =>
        targetGroup.censusTracts.some(t => getTractId(t) === neighborId)
      );

      // If primary target (sibling) has no neighbors, try any other group that has a neighbor so the tract is no longer isolated
      let effectiveTargetGroup = targetGroup;
      let effectiveTargetGroupIndex = targetGroupIndex;
      if (!hasNeighborInTarget && targetGroup.censusTracts.length > 0) {
        for (let g = 0; g < updatedGroups.length; g++) {
          if (g === sourceGroupIndex) continue;
          const group = updatedGroups[g];
          const hasNeighborHere = neighbors.some(neighborId =>
            group.censusTracts.some(t => getTractId(t) === neighborId)
          );
          if (hasNeighborHere) {
            effectiveTargetGroup = group;
            effectiveTargetGroupIndex = g;
            console.log(`   Tract ${tractId} has no neighbors in sibling ${targetGroup.startDistrictNumber}-${targetGroup.endDistrictNumber}, moving to group ${group.startDistrictNumber}-${group.endDistrictNumber} instead (has neighbor)`);
            break;
          }
        }
      }

      const hasNeighborInEffectiveTarget = effectiveTargetGroup === targetGroup
        ? hasNeighborInTarget
        : neighbors.some(neighborId =>
            effectiveTargetGroup.censusTracts.some(t => getTractId(t) === neighborId)
          );

      if (!hasNeighborInEffectiveTarget && effectiveTargetGroup.censusTracts.length > 0) {
        skippedTractIds.push(tractId);
        if (!sourceGroup.censusTracts.some(t => getTractId(t) === tractId)) {
          sourceGroup.censusTracts.push(tract);
        }
        continue;
      }

      // Add to target group (avoid duplicates - though we just removed it from all groups)
      if (!effectiveTargetGroup.censusTracts.some(t => getTractId(t) === tractId)) {
        effectiveTargetGroup.censusTracts.push(tract);
        movedCount++;

        const sourceDG = foundInGroups.length > 0 ? `DG${foundInGroups[0].split('-')[0]}-${foundInGroups[0].split('-')[1]}` : null;
        const targetDG = `DG${effectiveTargetGroup.startDistrictNumber}-${effectiveTargetGroup.endDistrictNumber}`;

        // SWAP tract_DG with sibling_DG when moving to sibling; otherwise set tract_DG to target and sibling_DG to source
        if (tract.properties) {
          const oldTractDG = tract.properties.tract_DG;
          const oldSiblingDG = tract.properties.sibling_DG;

          if (effectiveTargetGroupIndex === targetGroupIndex && oldTractDG && oldSiblingDG && oldTractDG !== oldSiblingDG) {
            tract.properties.tract_DG = oldSiblingDG;
            tract.properties.sibling_DG = oldTractDG;
            if (tract.properties.tract_DG !== targetDG) {
              tract.properties.tract_DG = targetDG;
              tract.properties.sibling_DG = sourceDG || oldTractDG;
            }
          } else {
            tract.properties.tract_DG = targetDG;
            tract.properties.sibling_DG = sourceDG || oldTractDG;
          }
        }
      } else {
        console.warn(`⚠️ Tract ${tractId} already in target group ${effectiveTargetGroup.startDistrictNumber}-${effectiveTargetGroup.endDistrictNumber}, skipping`);
      }
    }
    
    // Compensating move: move a boundary tract from target back to source so sibling DGs are within target variance
    if (!skipBalancing && movedCount > 0) {
      const balancingTractIds = this._findBalancingTract(
        updatedGroups, sourceGroupIndex, targetGroupIndex, adjacencyGraph
      );
      if (balancingTractIds && balancingTractIds.length > 0) {
        const movePop = updatedGroups[targetGroupIndex].censusTracts
          .filter(t => balancingTractIds.includes(getTractId(t)))
          .reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
        console.log(`   Balancing: moving ${balancingTractIds.join(', ')} from target back to source (sibling balance, pop ~${movePop})`);
        const balanceResult = this._moveTractsToGroup(
          updatedGroups, allTracts, targetGroupIndex, balancingTractIds, sourceGroupIndex, true
        );
        for (let i = 0; i < balanceResult.districtGroups.length; i++) {
          updatedGroups[i] = balanceResult.districtGroups[i];
        }
      }
    }
    
    // Re-get group refs in case we did a compensating move (updatedGroups elements were replaced)
    const sourceGroupFinal = updatedGroups[sourceGroupIndex];
    const targetGroupFinal = updatedGroups[targetGroupIndex];
    // Update group stats
    sourceGroupFinal.totalPopulation = sourceGroupFinal.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    sourceGroupFinal.bounds = calculateBounds(sourceGroupFinal.censusTracts);
    sourceGroupFinal.centroid = calculateCentroid(sourceGroupFinal.censusTracts);
    
    targetGroupFinal.totalPopulation = targetGroupFinal.censusTracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    targetGroupFinal.bounds = calculateBounds(targetGroupFinal.censusTracts);
    targetGroupFinal.centroid = calculateCentroid(targetGroupFinal.censusTracts);
    
    console.log(`✅ Moved ${movedCount} isolated tract(s) to opposite group`);
    if (skippedTractIds.length > 0) {
      const sample = skippedTractIds.slice(0, 5).join(', ');
      const suffix = skippedTractIds.length > 5 ? ` (sample: ${sample}... and ${skippedTractIds.length - 5} more)` : `: ${sample}`;
      console.log(`   Skipped ${skippedTractIds.length} tract(s) (no neighbor in any group)${suffix}`);
    }

    // Don't re-run isolation detection here - it's expensive and will be done once at the end
    return {
      districtGroups: updatedGroups,
      skippedTractIds
    };
  }

  /**
   * Get sort value for a tract by division direction (same key as latlong-division: minLat for latitude, maxLng for longitude).
   * @private
   */
  _getTractSortValue(tract, direction) {
    if (tract.properties &&
        typeof tract.properties.MIN_LAT === 'number' &&
        typeof tract.properties.MAX_LNG === 'number') {
      return direction === 'latitude' ? tract.properties.MIN_LAT : tract.properties.MAX_LNG;
    }
    if (!tract.geometry) return 0;
    let minLat = 90, maxLng = -180;
    const visit = (coord) => {
      const lng = coord[0], lat = coord[1];
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
    };
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) visit(coord);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) visit(coord);
        }
      }
    }
    return direction === 'latitude' ? minLat : maxLng;
  }

  /**
   * After all isolated tracts have been moved, balance each sibling pair by swapping boundary tracts
   * from the overpopulated DG to the other, starting from tracts closest to the dividing line.
   * @param {Array} updatedGroups - District groups after Phase 1 (all isolated moves, no per-move balance)
   * @param {Array} allTracts - All tracts
   * @param {Array} divisionLines - Array of { line, direction, siblingGroups }
   * @returns {Array} Updated district groups
   */
  balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, divisionLines) {
    if (!divisionLines || divisionLines.length === 0) {
      logger.debug('balanceSiblingPairsAfterIsolatedMoves: no division lines, skipping');
      return updatedGroups;
    }
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    let groups = updatedGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));
    let totalSwaps = 0;

    for (const divLine of divisionLines) {
      if (!divLine.siblingGroups || divLine.siblingGroups.length !== 2) continue;
      const s0 = divLine.siblingGroups[0];
      const s1 = divLine.siblingGroups[1];
      const lineVal = typeof divLine.line === 'number' ? divLine.line : 0;
      const direction = divLine.direction === 'longitude' ? 'longitude' : 'latitude';

      let idxA = -1, idxB = -1;
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (g.startDistrictNumber === s0.startDistrictNumber && g.endDistrictNumber === s0.endDistrictNumber) idxA = i;
        if (g.startDistrictNumber === s1.startDistrictNumber && g.endDistrictNumber === s1.endDistrictNumber) idxB = i;
      }
      if (idxA < 0 || idxB < 0) continue;

      const ideal = (groups[idxA].censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0) +
        groups[idxB].censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0)) / 2;
      const total = ideal * 2;
      if (total <= 0) continue;

      const groupATractIds = new Set(groups[idxA].censusTracts.map(t => getTractId(t)));
      const groupBTractIds = new Set(groups[idxB].censusTracts.map(t => getTractId(t)));
      const boundaryA = groups[idxA].censusTracts.filter(t => {
        const tid = getTractId(t);
        const neighbors = adjacencyGraph.get(tid) || [];
        return neighbors.some(n => groupBTractIds.has(n));
      });
      const boundaryB = groups[idxB].censusTracts.filter(t => {
        const tid = getTractId(t);
        const neighbors = adjacencyGraph.get(tid) || [];
        return neighbors.some(n => groupATractIds.has(n));
      });

      const maxSwaps = Math.max(boundaryA.length + boundaryB.length, 50);
      let swaps = 0;
      while (swaps < maxSwaps) {
        const popA = groups[idxA].censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
        const popB = groups[idxB].censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
        const varianceA = Math.abs(popA - ideal) / ideal;
        const varianceB = Math.abs(popB - ideal) / ideal;
        if (varianceA <= GeodistrictAlgorithmService.BALANCE_TARGET_VARIANCE && varianceB <= GeodistrictAlgorithmService.BALANCE_TARGET_VARIANCE) break;

        const overPopIdx = popA >= popB ? idxA : idxB;
        const underPopIdx = popA >= popB ? idxB : idxA;
        const boundaryCandidates = overPopIdx === idxA ? boundaryA : boundaryB;
        const overGroup = groups[overPopIdx];
        const underGroup = groups[underPopIdx];

        boundaryCandidates.sort((a, b) => {
          const va = this._getTractSortValue(a, direction);
          const vb = this._getTractSortValue(b, direction);
          const distA = Math.abs(va - lineVal);
          const distB = Math.abs(vb - lineVal);
          return distA - distB;
        });

        let moved = false;
        for (const tract of boundaryCandidates) {
          const tractId = getTractId(tract);
          const remaining = overGroup.censusTracts.filter(t => getTractId(t) !== tractId);
          if (remaining.length === 0) continue;
          const maxReachable = this.calculateMaxReachableCount(remaining, adjacencyGraph);
          if (maxReachable < remaining.length * 0.95) continue;

          const fromIdx = overPopIdx;
          const toIdx = underPopIdx;
          const fromGroup = groups[fromIdx];
          const toGroup = groups[toIdx];
          const tractIndex = fromGroup.censusTracts.findIndex(t => getTractId(t) === tractId);
          if (tractIndex === -1) continue;
          const [movedTract] = fromGroup.censusTracts.splice(tractIndex, 1);
          toGroup.censusTracts.push(movedTract);

          const targetDG = `DG${toGroup.startDistrictNumber}-${toGroup.endDistrictNumber}`;
          const sourceDG = `DG${fromGroup.startDistrictNumber}-${fromGroup.endDistrictNumber}`;
          if (movedTract.properties) {
            movedTract.properties.tract_DG = targetDG;
            movedTract.properties.sibling_DG = sourceDG;
          }

          fromGroup.totalPopulation = fromGroup.censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
          fromGroup.bounds = calculateBounds(fromGroup.censusTracts);
          fromGroup.centroid = calculateCentroid(fromGroup.censusTracts);
          toGroup.totalPopulation = toGroup.censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
          toGroup.bounds = calculateBounds(toGroup.censusTracts);
          toGroup.centroid = calculateCentroid(toGroup.censusTracts);

          groupATractIds.clear();
          groups[idxA].censusTracts.forEach(t => groupATractIds.add(getTractId(t)));
          groupBTractIds.clear();
          groups[idxB].censusTracts.forEach(t => groupBTractIds.add(getTractId(t)));
          boundaryA.length = 0;
          boundaryB.length = 0;
          groups[idxA].censusTracts.forEach(t => {
            const tid = getTractId(t);
            const neighbors = adjacencyGraph.get(tid) || [];
            if (neighbors.some(n => groupBTractIds.has(n))) boundaryA.push(t);
          });
          groups[idxB].censusTracts.forEach(t => {
            const tid = getTractId(t);
            const neighbors = adjacencyGraph.get(tid) || [];
            if (neighbors.some(n => groupATractIds.has(n))) boundaryB.push(t);
          });
          moved = true;
          swaps++;
          totalSwaps++;
          break;
        }
        if (!moved) break;
      }
    }
    if (totalSwaps > 0) {
      console.log(`✅ BALANCE: Sibling-pair balance performed ${totalSwaps} tract swap(s) across ${divisionLines.length} division line(s)`);
    } else {
      console.log(`📊 BALANCE: Sibling-pair balance completed with 0 swaps (${divisionLines.length} division lines; pairs within target variance or no valid boundary moves)`);
    }
    return groups;
  }

  /**
   * Balance district groups by variance: prioritize districts with largest |variance|,
   * pair each with an adjacent district of opposite variance, move boundary tracts to reduce variance.
   * Intended for final step only (each group is a single district).
   * @param {Array} districtGroups - District groups (final step: one district per group)
   * @param {Array} allTracts - All tracts in the dataset
   * @param {number} targetDistrictPopulation - Target population per district (state total / total districts)
   * @returns {Array} Updated district groups
   */
  balanceDistrictsByVariance(districtGroups, allTracts, targetDistrictPopulation) {
    if (!districtGroups || districtGroups.length < 2 || targetDistrictPopulation <= 0) {
      return districtGroups;
    }
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    let groups = districtGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));

    const getGroupPopulation = (group) =>
      (group.censusTracts || []).reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
    const getTargetForGroup = (group) => {
      const n = group.totalDistricts != null ? group.totalDistricts : (group.endDistrictNumber - group.startDistrictNumber + 1);
      return targetDistrictPopulation * n;
    };
    const variancePercent = (group) => {
      const pop = getGroupPopulation(group);
      const target = getTargetForGroup(group);
      if (target <= 0) return 0;
      return ((pop - target) / target) * 100;
    };

    // Build group index -> Set of adjacent group indices
    const groupAdjacent = new Map();
    for (let i = 0; i < groups.length; i++) {
      groupAdjacent.set(i, new Set());
    }
    for (let i = 0; i < groups.length; i++) {
      const tractIdsI = new Set((groups[i].censusTracts || []).map(t => getTractId(t)).filter(Boolean));
      for (let j = i + 1; j < groups.length; j++) {
        const tractIdsJ = new Set((groups[j].censusTracts || []).map(t => getTractId(t)).filter(Boolean));
        for (const tid of tractIdsI) {
          const neighbors = adjacencyGraph.get(tid) || [];
          if (neighbors.some(n => tractIdsJ.has(n))) {
            groupAdjacent.get(i).add(j);
            groupAdjacent.get(j).add(i);
            break;
          }
        }
      }
    }

    const targetVariancePercent = GeodistrictAlgorithmService.BALANCE_TARGET_VARIANCE * 100; // 1%
    const maxIterations = 150; // Run until all within tolerance or no improving move
    let iter = 0;
    while (iter < maxIterations) {
      iter++;
      // Recompute population and variance for each group
      const groupData = groups.map((g, i) => ({
        index: i,
        group: g,
        pop: getGroupPopulation(g),
        target: getTargetForGroup(g),
        variancePercent: variancePercent(g)
      }));

      // Sort by descending |variancePercent| (worst first)
      groupData.sort((a, b) => Math.abs(b.variancePercent) - Math.abs(a.variancePercent));
      const worst = groupData[0];
      if (Math.abs(worst.variancePercent) <= targetVariancePercent) break;

      const worstIdx = worst.index;
      const adjacentIndices = groupAdjacent.get(worstIdx) || new Set();
      const oppositeCandidates = groupData.filter(
        (d) => d.index !== worstIdx && adjacentIndices.has(d.index) && d.variancePercent * worst.variancePercent < 0
      );
      if (oppositeCandidates.length === 0) {
        // Try next worst group (skip this one)
        let foundMove = false;
        for (let w = 1; w < groupData.length; w++) {
          const next = groupData[w];
          if (Math.abs(next.variancePercent) <= targetVariancePercent) break;
          const adj = groupAdjacent.get(next.index) || new Set();
          const opp = groupData.filter(
            (d) => d.index !== next.index && adj.has(d.index) && d.variancePercent * next.variancePercent < 0
          );
          if (opp.length > 0) {
            // Use next as worst and pick partner
            const partner = opp.sort((a, b) => Math.abs(a.variancePercent) - Math.abs(b.variancePercent))[opp.length - 1];
            const overIdx = next.variancePercent > 0 ? next.index : partner.index;
            const underIdx = next.variancePercent > 0 ? partner.index : next.index;
            const moved = this._tryOneVarianceBalanceMove(groups, overIdx, underIdx, adjacencyGraph, getGroupPopulation, getTargetForGroup);
            if (moved) {
              foundMove = true;
              break;
            }
          }
        }
        if (!foundMove) break;
        continue;
      }

      // Pick partner: adjacent with largest |variancePercent|
      oppositeCandidates.sort((a, b) => Math.abs(a.variancePercent) - Math.abs(b.variancePercent));
      const partner = oppositeCandidates[oppositeCandidates.length - 1];
      const overIdx = worst.variancePercent > 0 ? worstIdx : partner.index;
      const underIdx = worst.variancePercent > 0 ? partner.index : worstIdx;

      const moved = this._tryOneVarianceBalanceMove(groups, overIdx, underIdx, adjacencyGraph, getGroupPopulation, getTargetForGroup);
      if (!moved) {
        // Try next worst
        let foundAny = false;
        for (let w = 1; w < groupData.length; w++) {
          const next = groupData[w];
          if (Math.abs(next.variancePercent) <= targetVariancePercent) break;
          const adj = groupAdjacent.get(next.index) || new Set();
          const opp = groupData.filter(
            (d) => d.index !== next.index && adj.has(d.index) && d.variancePercent * next.variancePercent < 0
          );
          if (opp.length === 0) continue;
          const p = opp.sort((a, b) => Math.abs(a.variancePercent) - Math.abs(b.variancePercent))[opp.length - 1];
          const oIdx = next.variancePercent > 0 ? next.index : p.index;
          const uIdx = next.variancePercent > 0 ? p.index : next.index;
          if (this._tryOneVarianceBalanceMove(groups, oIdx, uIdx, adjacencyGraph, getGroupPopulation, getTargetForGroup)) {
            foundAny = true;
            break;
          }
        }
        if (!foundAny) break;
      }
    }
    return groups;
  }

  /**
   * Try a single boundary tract move from over group to under group to reduce variance.
   * @private
   * @returns {boolean} true if a move was made
   */
  _tryOneVarianceBalanceMove(groups, overIdx, underIdx, adjacencyGraph, getGroupPopulation, getTargetForGroup) {
    const overGroup = groups[overIdx];
    const underGroup = groups[underIdx];
    const overTractIds = new Set((overGroup.censusTracts || []).map(t => getTractId(t)).filter(Boolean));
    const underTractIds = new Set((underGroup.censusTracts || []).map(t => getTractId(t)).filter(Boolean));
    const boundaryTracts = (overGroup.censusTracts || []).filter(t => {
      const tid = getTractId(t);
      const neighbors = adjacencyGraph.get(tid) || [];
      return neighbors.some(n => underTractIds.has(n));
    });
    if (boundaryTracts.length === 0) return false;

    const targetOver = getTargetForGroup(overGroup);
    const targetUnder = getTargetForGroup(underGroup);
    const popOver = getGroupPopulation(overGroup);
    const popUnder = getGroupPopulation(underGroup);

    const scoreTract = (tract) => {
      const pop = tract.properties?.POPULATION || 0;
      const newOver = popOver - pop;
      const newUnder = popUnder + pop;
      const varOver = targetOver > 0 ? Math.abs(newOver - targetOver) / targetOver : 0;
      const varUnder = targetUnder > 0 ? Math.abs(newUnder - targetUnder) / targetUnder : 0;
      return Math.max(varOver, varUnder);
    };
    boundaryTracts.sort((a, b) => scoreTract(a) - scoreTract(b));

    for (const tract of boundaryTracts) {
      const tractId = getTractId(tract);
      const remaining = overGroup.censusTracts.filter(t => getTractId(t) !== tractId);
      if (remaining.length === 0) continue;
      const maxReachable = this.calculateMaxReachableCount(remaining, adjacencyGraph);
      if (maxReachable < remaining.length * 0.95) continue;

      const tractIndex = overGroup.censusTracts.findIndex(t => getTractId(t) === tractId);
      if (tractIndex === -1) continue;
      const [movedTract] = overGroup.censusTracts.splice(tractIndex, 1);
      underGroup.censusTracts.push(movedTract);

      const targetDG = `DG${underGroup.startDistrictNumber}-${underGroup.endDistrictNumber}`;
      const sourceDG = `DG${overGroup.startDistrictNumber}-${overGroup.endDistrictNumber}`;
      if (movedTract.properties) {
        movedTract.properties.tract_DG = targetDG;
        movedTract.properties.sibling_DG = sourceDG;
      }
      overGroup.totalPopulation = overGroup.censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
      overGroup.bounds = calculateBounds(overGroup.censusTracts);
      overGroup.centroid = calculateCentroid(overGroup.censusTracts);
      underGroup.totalPopulation = underGroup.censusTracts.reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
      underGroup.bounds = calculateBounds(underGroup.censusTracts);
      underGroup.centroid = calculateCentroid(underGroup.censusTracts);
      return true;
    }
    return false;
  }

  /**
   * Resolve isolation for a step: detect isolated, detect bridge, move bridge, move remaining isolated
   * This is the complete isolation resolution flow used in the "run all steps" execution
   * @param {Array} districtGroups - All district groups
   * @param {Array} allTracts - All tracts in the dataset
   * @param {Array} divisionLines - Optional array of division line metadata with sibling relationships
   * @returns {Object} - Updated district groups and isolation resolution summary
   */
  /**
   * Run mode: always run bridge tract detection (and move) as part of isolation resolution.
   * Step mode: user initiates each step; bridge detection is not automatic.
   * @param {Array} districtGroups - Current district groups
   * @param {Array} allTracts - All tracts
   * @param {Array} divisionLines - Optional division line metadata (sibling relationships)
   * @param {Set<string>|null} step0IslandTractIds - Optional. Step-0 island tract IDs to exclude from isolation
   * @param {number|null} stepNumber - Optional. Step number (for detection; use > 0 so islands are excluded)
   */
  resolveIsolationForStep(districtGroups, allTracts, divisionLines = null, step0IslandTractIds = null, stepNumber = 1) {
    logger.debug(`🔧 RESOLVE ISOLATION: Starting isolation resolution for ${districtGroups.length} groups`);
    
    let updatedGroups = districtGroups.map(group => ({
      ...group,
      censusTracts: [...group.censusTracts]
    }));
    
    let totalIsolatedMoved = 0;
    let totalBridgeMoved = 0;
    let resolutionIterations = 0;
    const maxResolutionIterations = 10; // Safety limit
    
    while (resolutionIterations < maxResolutionIterations) {
      resolutionIterations++;
      logger.debug(`🔧 Resolution iteration ${resolutionIterations}`);
      
      const isolationResult = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, step0IslandTractIds);
      
      if (isolationResult.isolatedTractIds.size === 0) {
        logger.debug(`✅ No isolated tracts found after iteration ${resolutionIterations - 1}`);
        break;
      }
      
      logger.debug(`   Found ${isolationResult.isolatedTractIds.size} isolated tracts in ${isolationResult.isolatedTractsByGroup.size} groups`);
      
      const isolatedTractsByGroupMap = new Map();
      isolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroupMap.set(groupIndex, tractIds);
      });
      
      // Run mode: always run bridge detection. Pass isolatedComponentsByGroup so bridge is only for components with 2+ tracts.
      const bridgeResult = this.detectBridgeTracts(
        updatedGroups,
        allTracts,
        isolatedTractsByGroupMap,
        isolationResult.isolatedComponentsByGroup || null
      );
      
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
        const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, step0IslandTractIds);
        
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
      const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, step0IslandTractIds);
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
      const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, step0IslandTractIds);
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
    const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, step0IslandTractIds);
    
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
   * Resolve isolation at final step using adjacency-based move (whole-component, sibling-first).
   * Used when isolationStrategy === 'finalStepOnly'. No divisionLines; sibling from tract.properties.sibling_DG.
   * @param {Array} districtGroups - Current district groups (all single-district at final step)
   * @param {Array} allTracts - All tracts
   * @param {Set<string>|string[]|null} step0IslandTractIds - Step-0 island tract IDs to exclude
   * @param {number} stepNumber - Step number for detection (e.g. final step number)
   * @returns {Object} - Same shape as resolveIsolationForStep (districtGroups, resolutionSummary, finalIsolation)
   */
  resolveIsolationForFinalStep(districtGroups, allTracts, step0IslandTractIds = null, stepNumber = 1) {
    logger.debug(`🔧 RESOLVE ISOLATION (final step): Starting adjacency-based resolution for ${districtGroups.length} groups`);
    let updatedGroups = districtGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));
    let totalIsolatedMoved = 0;
    let totalBridgeMoved = 0;
    let resolutionIterations = 0;
    const maxResolutionIterations = 10;
    let islandSet = step0IslandTractIds instanceof Set ? step0IslandTractIds : (Array.isArray(step0IslandTractIds) ? new Set(step0IslandTractIds) : new Set());

    while (resolutionIterations < maxResolutionIterations) {
      resolutionIterations++;
      logger.debug(`🔧 Final-step resolution iteration ${resolutionIterations}`);
      const isolationResult = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, islandSet);
      if (isolationResult.isolatedTractIds.size === 0) break;
      logger.debug(`   Found ${isolationResult.isolatedTractIds.size} isolated tracts in ${isolationResult.isolatedTractsByGroup.size} groups`);

      const isolatedTractsByGroupMap = new Map();
      isolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroupMap.set(groupIndex, tractIds);
      });
      const bridgeResult = this.detectBridgeTracts(
        updatedGroups, allTracts, isolatedTractsByGroupMap,
        isolationResult.isolatedComponentsByGroup || null
      );

      if (bridgeResult.bridgeTractsByIsolatedGroup.size > 0) {
        const isolationCountBeforeBridge = isolationResult.isolatedTractIds.size;
        for (const [isolatedGroupIndex, bridgeTracts] of bridgeResult.bridgeTractsByIsolatedGroup.entries()) {
          const bridgeTractIds = bridgeTracts.map(bt => bt.tractId);
          const moveResult = this.moveBridgeTractsAndRecheck(updatedGroups, allTracts, isolatedGroupIndex, bridgeTractIds, null);
          updatedGroups = moveResult.districtGroups;
          totalBridgeMoved += bridgeTractIds.length;
        }
        const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, islandSet);
        if (isolationAfterBridge.isolatedTractIds.size === 0) break;
        if (isolationAfterBridge.isolatedTractIds.size >= isolationCountBeforeBridge) {
          logger.debug(`⚠️ Bridge did not reduce isolation, continuing with move isolated`);
        }
      }

      const isolationAfterBridge = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, islandSet);
      if (isolationAfterBridge.isolatedTractIds.size > 0) {
        const moveResult = this.moveIsolatedComponentsByAdjacency(
          updatedGroups, allTracts, isolationAfterBridge, islandSet
        );
        updatedGroups = moveResult.districtGroups;
        totalIsolatedMoved += moveResult.movedTractCount;
        if (moveResult.unmovableTractIds && moveResult.unmovableTractIds.length > 0) {
          moveResult.unmovableTractIds.forEach(id => islandSet.add(id));
          logger.debug(`   Added ${moveResult.unmovableTractIds.length} unmovable tract(s) to island list for final step`);
        }
      }

      const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, islandSet);
      if (finalIsolation.isolatedTractIds.size === 0) {
        logger.info(`✅ Final-step isolation resolved after ${resolutionIterations} iteration(s)`);
        break;
      }
      logger.debug(`   Still have ${finalIsolation.isolatedTractIds.size} isolated tracts, continuing...`);
    }

    if (resolutionIterations >= maxResolutionIterations) {
      logger.warn(`⚠️ Final-step resolution reached max iterations (${maxResolutionIterations})`);
    }
    const finalIsolation = this.detectIsolatedTracts(updatedGroups, allTracts, stepNumber, islandSet);
    logger.info(`✅ RESOLVE ISOLATION (final step): moved ${totalBridgeMoved} bridge, ${totalIsolatedMoved} isolated, ${finalIsolation.isolatedTractIds.size} remaining`);
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
      if (tractId && (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('48409'))) {
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
      if (tractId && (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('48409'))) {
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
          if (memberId.includes('001700') || memberId.includes('002302') || memberId.includes('48409')) {
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
              // DON'T add to isolatedTractIds yet - wait until after island check
            }
          }
          
          // Final safety check: ensure main component is never in isolated set
          if (groupIsolatedTractIds.has(mainComponentTractId)) {
            console.error(`❌ CRITICAL BUG: Main component tract ${mainComponentTractId} found in isolated set! Removing it.`);
            groupIsolatedTractIds.delete(mainComponentTractId);
          }
          
          if (groupIsolatedTractIds.size > 0) {
            // Island tracts (tracts in smaller connected components) should be excluded from isolation detection in ALL steps
            // The main component (largest reachable component) is the "mainland" and smaller components are islands
            // At Step 0, these are geographic islands (like CA's 5 island tracts)
            // In later steps, these are tracts in smaller components that should be treated as islands
            console.log(`🏝️ Group ${group.startDistrictNumber}-${group.endDistrictNumber}: ${groupIsolatedTractIds.size} island tract(s) detected${isStep0 ? ' at Step 0' : ''} (excluded from isolation detection)`);
            console.log(`   Main component (mainland): ${mainComponentTractId} (${mainComponentReachableCount} reachable)`);
            console.log(`   Island components: ${groupIsolatedTractIds.size} tract(s) in smaller components`);
            
            // Debug: Log first few island tract IDs
            const islandArray = Array.from(groupIsolatedTractIds).slice(0, 5);
            console.log(`   Sample island tracts: ${islandArray.join(', ')}`);
            
            // Don't add to isolated sets - these are island tracts (geographic islands at Step 0, or smaller components in later steps)
            // Continue to next group without marking these as isolated
            continue;
          }
          // If groupIsolatedTractIds.size === 0, there are no isolated tracts in this group, so continue to next group
        }
        // If maxReachableCount >= totalTractsInGroup, there are no isolated tracts, so continue to next group
      }
    }
    
    if (hasIsolationIssues && iteration < maxIterations) {
      console.log(`�� FIX ISOLATED: Iteration ${iteration} - re-checking all groups for remaining isolation issues...`);
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
   * @param {boolean} resolveIsolation - If true, resolve isolation after each step (backward compat; overridden by isolationStrategy)
   * @param {Function} onStepComplete - Optional callback called after each step with (stepNumber, stepData, shouldCache) - if returns false, step won't be cached
   * @param {string} [isolationStrategy='none'] - 'none' (default, no resolution), 'perStep' (resolve after each division), 'finalStepOnly' (resolve once at final step)
   * @returns {Promise<Object>} GeodistrictResult
   */
  async executeGeodistrictAlgorithm(tracts, totalDistricts, maxIterations, forceInvalidate = false, resolveIsolation = false, onStepComplete = null, isolationStrategy = null) {
    const strategy = isolationStrategy ?? (resolveIsolation ? 'perStep' : 'none');
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
      centroid: calculateCentroid(uniqueTracts),
      lastDivisionDirection: null
    };

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Create initial step with algorithmService and allTracts so we detect island tracts (for exclusion in later steps, doc 251204)
    const step0 = createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude', undefined, undefined, this, uniqueTracts, null);
    steps.push(step0);

    // Flatten step-0 island tract IDs and excluded (water/special) tract IDs so we exclude them from isolation in steps 1+
    let step0IslandTractIds = null;
    {
      const islandSet = new Set();
      if (step0.islandTractsData) {
        if (step0.islandTractsData.islandTractsByGroup) {
          for (const islandGroups of Object.values(step0.islandTractsData.islandTractsByGroup)) {
            if (Array.isArray(islandGroups)) {
              for (const group of islandGroups) {
                if (Array.isArray(group)) group.forEach(id => islandSet.add(id));
                else if (typeof group === 'string') islandSet.add(group);
                else if (group && Array.isArray(group.tractIds)) group.tractIds.forEach(id => islandSet.add(id));
              }
            }
          }
        }
        if (Array.isArray(step0.islandTractsData.excludedTractIds)) {
          step0.islandTractsData.excludedTractIds.forEach(id => islandSet.add(id));
        }
      }
      // Always add water/special from uniqueTracts so they are excluded even when step 0 was cached without excludedTractIds
      for (const tract of uniqueTracts) {
        if (!isWaterOrSpecialTract(tract)) continue;
        const id = getTractId(tract);
        if (id) islandSet.add(id);
      }
      // Known CA Pacific island tracts: always exclude from isolation at steps 1+ (even if step-0 island data missing/wrong format)
      const knownCAIslandTracts = ['06037599000', '06037599100', '06075980401', '06083980100', '06111980000'];
      if (uniqueTracts.length > 0) {
        const firstTract = uniqueTracts[0];
        const stateCode = firstTract?.properties?.STATE || firstTract?.properties?.['STATE_FIPS'] ||
          (firstTract?.properties?.GEOID ? firstTract.properties.GEOID.substring(0, 2) : null);
        if (stateCode === '06' || stateCode === 'CA') {
          knownCAIslandTracts.forEach(id => islandSet.add(id));
        }
      }
      if (islandSet.size > 0) {
        step0IslandTractIds = islandSet;
        console.log(`🏝️ Step 0: ${islandSet.size} tract(s) will be excluded from isolation in later steps (islands + water/special)`);
      }
    }

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const newGroups = [];
      const divisionLines = [];
      let divisionLine = undefined;

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          const direction = chooseDivisionDirection(group);
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
      
      // Resolve isolation only for strategy 'perStep' (skip for 'none' and 'finalStepOnly')
      let groupsForStep = currentGroups;
      let resolutionSummary = null;
      if (strategy === 'perStep' && iteration > 0) { // Skip for step 0 (no isolation possible)
        console.log(`🔧 Resolving isolation for step ${iteration} (perStep)...`);
        const resolutionResult = this.resolveIsolationForStep(currentGroups, uniqueTracts, divisionLines, step0IslandTractIds, iteration);
        groupsForStep = resolutionResult.districtGroups;
        resolutionSummary = resolutionResult.resolutionSummary;
        
        // Update currentGroups for next iteration
        currentGroups = groupsForStep;
        
        console.log(`✅ Step ${iteration} isolation resolved: ${resolutionSummary.bridgeTractsMoved} bridge, ${resolutionSummary.isolatedTractsMoved} isolated moved`);
      }
      
      const stepDirection = divisionLines.length > 0 ? divisionLines[0].direction : 'latitude';
      const step = createStep(iteration, iteration, groupsForStep,
        `Division ${iteration} by ${stepDirection}`, stepDirection, divisionLine, divisionLines, this, uniqueTracts, step0IslandTractIds);
      
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

    // Strategy 'finalStepOnly': resolve isolation once now (all groups are single-district) using adjacency-based move
    if (strategy === 'finalStepOnly' && iteration > 0 && steps.length > 0) {
      const isFinalStep = currentGroups.every(g => g.totalDistricts === 1);
      if (isFinalStep) {
        console.log(`🔧 Resolving isolation at final step (finalStepOnly, adjacency-based move)...`);
        const resolutionResult = this.resolveIsolationForFinalStep(currentGroups, uniqueTracts, step0IslandTractIds, iteration);
        currentGroups = resolutionResult.districtGroups;
        const resolutionSummary = resolutionResult.resolutionSummary;
        console.log(`✅ Final-step isolation resolved: ${resolutionSummary.bridgeTractsMoved} bridge, ${resolutionSummary.isolatedTractsMoved} isolated moved`);
        // Replace last step with resolved groups and re-run step creation for consistent isolation display
        const lastStepBefore = steps[steps.length - 1];
        const stepDirection = lastStepBefore.divisionDirection || 'latitude';
        const finalStep = createStep(iteration, iteration, currentGroups,
          lastStepBefore.description || `Division ${iteration} by ${stepDirection}`, stepDirection, undefined, [], this, uniqueTracts, step0IslandTractIds);
        finalStep.isolationResolution = resolutionSummary;
        steps[steps.length - 1] = finalStep;
        if (onStepComplete) {
          await onStepComplete(iteration, finalStep, true);
        }
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
      centroid: calculateCentroid(uniqueTracts),
      lastDivisionDirection: null
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
      const newGroups = [];
      const divisionLines = [];

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          newGroups.push(group);
        } else {
          const direction = chooseDivisionDirection(group);
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
      // currentGroups = this.fixIsolatedTractsAcrossAllGroups(currentGroups, uniqueTracts, stepDirection);
      
      const stepDirection = divisionLines.length > 0 ? divisionLines[0].direction : 'latitude';
      const step = createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${stepDirection}`, stepDirection, undefined, divisionLines, this, uniqueTracts, step0IslandTractIds);
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
  CONGRESSIONAL_DISTRICTS_BY_STATE,
  GeodistrictAlgorithmService,
  getDistrictsForState,
  getTractId,
  isWaterOrSpecialTract,
  calculateBounds,
  calculateCentroid,
  calculateTractCentroid,
  calculateOptimalDivision,
  createStep,
  createUnionPolygon,
  createUnionPolygonsForGroup,
  buildMultiPolygonFromFeatures,
  detectEnclosedTracts,
  ALGORITHM_VERSION
};

