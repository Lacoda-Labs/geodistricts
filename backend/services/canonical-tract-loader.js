/**
 * Canonical Tract Loader
 * 
 * Creates a canonical tract model using a Map keyed by tract ID to prevent duplicates.
 * Architecture:
 * - Census API data is the PRIMARY/authoritative source for tract records
 * - TIGER polygon data is attached to the census tract record
 * - Brown-S4 adjacency data is attached to the census tract record
 * 
 * This ensures:
 * 1. No duplicate tracts (Map enforces uniqueness by tract ID)
 * 2. Census API is the source of truth
 * 3. All related data (polygons, adjacency) is attached to the canonical tract record
 */

const s4DataLoader = require('./s4-data-loader');

/**
 * Get canonical tract ID from census data
 * Uses Census API format as the authoritative ID
 */
function getCanonicalTractId(censusData) {
  // Census API uses GEO_ID format: "1400000US04005002101" or GEOID: "04005002101"
  if (censusData.GEO_ID) {
    // Remove "US" prefix if present: "1400000US04005002101" -> "04005002101"
    const geoId = censusData.GEO_ID;
    if (geoId.includes('US')) {
      return geoId.split('US')[1];
    }
    return geoId;
  }
  
  if (censusData.GEOID) {
    return censusData.GEOID;
  }
  
  // Fallback: construct from state+county+tract (handle both uppercase and lowercase)
  const state = censusData.STATE || censusData.state;
  const county = censusData.COUNTY || censusData.county;
  const tract = censusData.TRACT || censusData.tract;
  
  if (state && county && tract) {
    // Ensure proper padding: state (2 digits), county (3 digits), tract (6 digits)
    const stateFips = String(state).padStart(2, '0');
    const countyFips = String(county).padStart(3, '0');
    const tractFips = String(tract).padStart(6, '0');
    return `${stateFips}${countyFips}${tractFips}`;
  }
  
  return null;
}

/**
 * Get tract ID from TIGER polygon feature (for matching).
 * Prefer 11-digit GEOID/FIPS so direct match works; fall back to 6-digit TRACT_FIPS.
 */
function getTigerTractId(feature) {
  return feature.properties?.GEOID || feature.properties?.FIPS || feature.properties?.TRACT_FIPS;
}

/**
 * Create canonical tract model from census data, TIGER polygons, and S4 adjacency
 * 
 * @param {Array} censusData - Array of census API tract records (PRIMARY source)
 * @param {Object} tigerBoundaries - GeoJSON with TIGER polygon features
 * @param {string} state - State code
 * @returns {Map<string, Object>} Map of tractId -> canonical tract record
 */
function createCanonicalTractMap(censusData, tigerBoundaries, state) {
  const tractMap = new Map(); // Map<tractId, canonicalTract>
  
  console.log(`📊 Creating canonical tract model from ${censusData.length} census records`);
  
  // Step 1: Create canonical records from Census API data (PRIMARY source)
  for (const censusRecord of censusData) {
    const tractId = getCanonicalTractId(censusRecord);
    if (!tractId) {
      console.warn(`⚠️ Skipping census record without valid ID:`, censusRecord);
      continue;
    }
    
    // Create canonical tract record with Census API data as base
    const canonicalTract = {
      // Primary identifier (from Census API)
      tractId: tractId,
      
      // Census API data (PRIMARY/authoritative)
      censusData: {
        ...censusRecord,
        POPULATION: censusRecord.B01001_001E || censusRecord.POPULATION || 0,
        STATE: state
      },
      
      // TIGER polygon geometry (attached, not primary)
      geometry: null,
      
      // S4 adjacency data (attached, not primary)
      s4Adjacency: null,
      
      // Properties for GeoJSON compatibility
      properties: {
        ...censusRecord,
        POPULATION: censusRecord.B01001_001E || censusRecord.POPULATION || 0,
        STATE: state,
        GEOID: tractId,
        TRACT_FIPS: tractId.slice(-6), // Last 6 digits
        COUNTY_FIPS: tractId.slice(-9, -6), // Middle 3 digits
        STATE_FIPS: tractId.slice(0, 2) // First 2 digits
      }
    };
    
    // Store in Map (enforces uniqueness - if duplicate ID, this will overwrite)
    if (tractMap.has(tractId)) {
      console.warn(`⚠️ Duplicate tract ID in census data: ${tractId} - keeping first occurrence`);
    }
    tractMap.set(tractId, canonicalTract);
  }
  
  console.log(`✅ Created ${tractMap.size} canonical tract records from census data`);
  
  // Step 2: Attach TIGER polygon geometries to canonical records
  if (tigerBoundaries && tigerBoundaries.features) {
    let matchedCount = 0;
    let unmatchedCount = 0;
    
    for (const feature of tigerBoundaries.features) {
      const tigerTractId = getTigerTractId(feature);
      if (!tigerTractId) {
        unmatchedCount++;
        continue;
      }
      
      // Try to match TIGER tract to canonical record
      // TIGER might use different ID format, so try multiple matching strategies
      let matched = false;
      
      // Strategy 1: Direct ID match
      if (tractMap.has(tigerTractId)) {
        const canonicalTract = tractMap.get(tigerTractId);
        canonicalTract.geometry = feature.geometry;
        // Merge TIGER properties into canonical tract properties
        Object.assign(canonicalTract.properties, feature.properties);
        matched = true;
        matchedCount++;
      } else {
        // Strategy 2: Try matching by last 6 digits (TRACT_FIPS) + county + state
        // TIGER might have format like "04025000701" (state+county+tract)
        // Canonical might have same format
        const tigerTractFips = tigerTractId.slice(-6); // Last 6 digits (tract)
        const tigerCountyFips = tigerTractId.length >= 9 ? tigerTractId.slice(-9, -6) : null; // Middle 3 digits (county)
        const tigerStateFips = tigerTractId.length >= 11 ? tigerTractId.slice(0, 2) : null; // First 2 digits (state)
        
        for (const [tractId, canonicalTract] of tractMap.entries()) {
          if (!canonicalTract.geometry) {
            const canonicalTractFips = tractId.slice(-6);
            const canonicalCountyFips = tractId.length >= 9 ? tractId.slice(-9, -6) : null;
            const canonicalStateFips = tractId.length >= 11 ? tractId.slice(0, 2) : null;
            
            // Match by tract FIPS (last 6 digits) - most reliable
            if (tractId.endsWith(tigerTractFips)) {
              // If we have county/state info, verify they match too
              if (tigerCountyFips && canonicalCountyFips && tigerCountyFips !== canonicalCountyFips) {
                continue; // County mismatch, skip
              }
              if (tigerStateFips && canonicalStateFips && tigerStateFips !== canonicalStateFips) {
                continue; // State mismatch, skip
              }
              
              canonicalTract.geometry = feature.geometry;
              Object.assign(canonicalTract.properties, feature.properties);
              matched = true;
              matchedCount++;
              break;
            }
          }
        }
      }
      
      if (!matched) {
        unmatchedCount++;
        // Don't create new records from TIGER - Census API is primary
        // Just log for debugging (limit to first 10)
        if (unmatchedCount <= 10) {
          console.warn(`⚠️ TIGER polygon ${tigerTractId} has no matching census record`);
        }
      }
    }
    
    console.log(`✅ Attached ${matchedCount} TIGER polygons to canonical tracts (${unmatchedCount} unmatched)`);
  }
  
  // Step 3: Attach S4 adjacency data to canonical records
  try {
    const s4AdjacencyGraph = s4DataLoader.getS4AdjacencyData(`s4_adjacency_${state}`);
    if (s4AdjacencyGraph) {
      let adjacencyAttached = 0;
      
      for (const [tractId, canonicalTract] of tractMap.entries()) {
        const neighbors = s4AdjacencyGraph.get(tractId);
        if (neighbors && neighbors.length > 0) {
          canonicalTract.s4Adjacency = neighbors;
          adjacencyAttached++;
        }
      }
      
      console.log(`✅ Attached S4 adjacency data to ${adjacencyAttached} canonical tracts`);
    } else {
      console.warn(`⚠️ No S4 adjacency data available for ${state}`);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to load S4 adjacency data: ${error.message}`);
  }
  
  // Step 4: Convert to GeoJSON features array (for compatibility with existing code)
  const tractsWithoutGeometry = [];
  const geoJsonFeatures = Array.from(tractMap.values()).map(canonicalTract => {
    if (!canonicalTract.geometry) {
      tractsWithoutGeometry.push(canonicalTract.tractId);
      return null;
    }
    return {
      type: 'Feature',
      geometry: canonicalTract.geometry,
      properties: canonicalTract.properties
    };
  }).filter(Boolean);

  if (tractsWithoutGeometry.length > 0) {
    const sample = tractsWithoutGeometry.slice(0, 5).join(', ');
    const suffix = tractsWithoutGeometry.length > 5 ? ` (sample: ${sample}...)` : ` (${sample})`;
    console.warn(`⚠️ ${tractsWithoutGeometry.length} canonical tract(s) have no geometry${suffix}`);
  }

  console.log(`✅ Converted ${geoJsonFeatures.length} canonical tracts to GeoJSON features`);
  
  return {
    tractMap: tractMap, // Map<tractId, canonicalTract> - canonical model
    geoJsonFeatures: geoJsonFeatures, // Array<GeoJSON Feature> - for compatibility
    stats: {
      totalCanonicalTracts: tractMap.size,
      tractsWithGeometry: geoJsonFeatures.length,
      tractsWithoutGeometry: tractMap.size - geoJsonFeatures.length
    }
  };
}

module.exports = {
  createCanonicalTractMap,
  getCanonicalTractId
};

