/**
 * Spatial Analyzer Service
 * Handles polygon-to-tract spatial joins and areal weighting for partial overlaps
 */

const turf = require('@turf/turf');
const axios = require('axios');

/**
 * Spatial Analyzer Class
 */
class SpatialAnalyzer {
  constructor() {
    this.tractBoundariesCache = new Map(); // Cache for tract boundaries by state
  }

  /**
   * Load tract boundaries for a state
   * Uses existing API endpoint or direct TIGERweb access
   */
  async loadTractBoundaries(state, apiBaseUrl = null) {
    const cacheKey = `tract_boundaries_${state}`;
    
    // Check cache first
    if (this.tractBoundariesCache.has(cacheKey)) {
      return this.tractBoundariesCache.get(cacheKey);
    }

    try {
      let boundaries;
      
      if (apiBaseUrl) {
        // Use internal API endpoint
        const response = await axios.get(`${apiBaseUrl}/api/census/tract-boundaries`, {
          params: { state },
          timeout: 60000, // 60 second timeout
        });
        boundaries = response.data;
      } else {
        // Direct TIGERweb access
        const stateFipsMap = {
          'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
          'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
          'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
          'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
          'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
          'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
          'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
          'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
          'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
          'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
          'DC': '11'
        };
        
        const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
        // Census TIGERweb Tracts_Blocks MapServer layer 10 = Census 2020 Tracts (STATE, COUNTY, TRACT, GEOID 11-char)
        const serviceUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10/query';

        const params = new URLSearchParams({
          where: `STATE='${stateFips}'`,
          outFields: 'STATE,COUNTY,TRACT,GEOID,POP100',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: '2000'
        });

        const response = await axios.get(`${serviceUrl}?${params.toString()}`, {
          timeout: 60000,
        });
        let features = response.data?.features ?? [];
        const pageSize = 2000;
        while (features.length >= pageSize) {
          const nextParams = new URLSearchParams({
            where: `STATE='${stateFips}'`,
            outFields: 'STATE,COUNTY,TRACT,GEOID,POP100',
            f: 'geojson',
            outSR: '4326',
            resultRecordCount: String(pageSize),
            resultOffset: String(features.length),
          });
          const nextRes = await axios.get(`${serviceUrl}?${nextParams.toString()}`, { timeout: 60000 });
          const nextFeatures = nextRes.data?.features ?? [];
          if (nextFeatures.length === 0) break;
          features = features.concat(nextFeatures);
        }

        // Normalize to expected property names (STATE_FIPS, COUNTY_FIPS, TRACT_FIPS, POPULATION) for compatibility
        features = features.map((f) => {
          const p = f.properties || {};
          return {
            ...f,
            properties: {
              ...p,
              STATE_FIPS: p.STATE,
              COUNTY_FIPS: p.COUNTY,
              TRACT_FIPS: p.TRACT,
              FIPS: p.GEOID,
              POPULATION: p.POP100 != null ? p.POP100 : p.POPULATION,
            },
          };
        });

        boundaries = {
          type: 'FeatureCollection',
          features
        };
      }

      // Cache the boundaries
      this.tractBoundariesCache.set(cacheKey, boundaries);
      return boundaries;

    } catch (error) {
      console.error(`Error loading tract boundaries for ${state}:`, error.message);
      throw new Error(`Failed to load tract boundaries for ${state}: ${error.message}`);
    }
  }

  /**
   * Load tract GEOIDs only for a state (no geometry). Uses TIGERweb with returnGeometry=false for a small response.
   * Used by county→tract party allocation so full boundary fetches are not needed.
   */
  async loadTractGeoids(state, apiBaseUrl = null) {
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);

    if (apiBaseUrl) {
      const axios = require('axios');
      const response = await axios.get(`${apiBaseUrl}/api/census/tract-geoids`, {
        params: { state },
        timeout: 60000,
      });
      return response.data?.geoids ?? [];
    }

    const serviceUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10/query';
    const pageSize = 2000;
    const geoids = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams({
        where: `STATE='${stateFips}'`,
        outFields: 'GEOID',
        f: 'json',
        returnGeometry: 'false',
        resultRecordCount: String(pageSize),
        resultOffset: String(offset),
      });
      const response = await axios.get(`${serviceUrl}?${params.toString()}`, { timeout: 60000 });
      const features = response.data?.features ?? [];
      for (const f of features) {
        const g = f?.properties?.GEOID;
        if (g) geoids.push(String(g).padStart(11, '0').substring(0, 11));
      }
      offset += features.length;
      hasMore = features.length >= pageSize;
    }
    return geoids;
  }

  /**
   * Extract GEOID (11-digit tract id) from a tract feature.
   * Esri USA_Census_Tracts uses FIPS; other sources use GEOID or state+county+tract.
   */
  getTractGeoid(feature) {
    const p = feature?.properties;
    if (!p) return null;
    const fromFips = p.FIPS ?? p.GEOID ?? p.geoid;
    if (fromFips != null && fromFips !== '') return String(fromFips).padStart(11, '0').substring(0, 11);
    if (p.STATE_FIPS != null && p.COUNTY_FIPS != null && p.TRACT_FIPS != null) {
      const s = String(p.STATE_FIPS).padStart(2, '0');
      const c = String(p.COUNTY_FIPS).padStart(3, '0');
      const t = String(p.TRACT_FIPS).replace(/\.\d+$/, '').padStart(6, '0').substring(0, 6);
      return `${s}${c}${t}`;
    }
    return null;
  }

  /**
   * Find tracts that intersect with a polygon
   * Returns array of { geoid, feature, intersectionArea, intersectionRatio }
   */
  async findIntersectingTracts(polygon, state = null) {
    // Validate polygon
    if (!polygon || !polygon.type) {
      throw new Error('Invalid polygon: must be a GeoJSON Feature or FeatureCollection');
    }

    // Convert to Feature if needed
    let polygonFeature;
    if (polygon.type === 'FeatureCollection') {
      if (polygon.features.length === 0) {
        throw new Error('Empty FeatureCollection provided');
      }
      // Use first feature or union all features
      if (polygon.features.length === 1) {
        polygonFeature = polygon.features[0];
      } else {
        // Union all features into one polygon
        let unioned = polygon.features[0];
        for (let i = 1; i < polygon.features.length; i++) {
          try {
            unioned = turf.union(turf.featureCollection([unioned, polygon.features[i]]));
          } catch (error) {
            console.warn(`Warning: Could not union feature ${i}:`, error.message);
          }
        }
        polygonFeature = unioned;
      }
    } else if (polygon.type === 'Feature') {
      polygonFeature = polygon;
    } else if (polygon.type === 'Polygon' || polygon.type === 'MultiPolygon') {
      polygonFeature = turf.feature(polygon);
    } else {
      throw new Error(`Unsupported GeoJSON type: ${polygon.type}`);
    }

    // Validate geometry
    if (!polygonFeature.geometry || 
        (polygonFeature.geometry.type !== 'Polygon' && polygonFeature.geometry.type !== 'MultiPolygon')) {
      throw new Error('Polygon must have Polygon or MultiPolygon geometry');
    }

    // Determine state from polygon bbox or use provided state
    let targetState = state;
    if (!targetState) {
      const bbox = turf.bbox(polygonFeature);
      // Use centroid to determine state (simplified - in production, use proper state boundary lookup)
      const centroid = turf.centroid(polygonFeature);
      // For now, we'll need state to be provided or extracted from intersecting tracts
      console.warn('State not provided and cannot be auto-detected from polygon. Will attempt to load all states.');
    }

    // Load tract boundaries
    // If state not provided, we'll need to check multiple states or use a different approach
    // For now, require state to be provided
    if (!targetState) {
      throw new Error('State parameter is required for polygon intersection. Cannot auto-detect state from polygon.');
    }

    const boundaries = await this.loadTractBoundaries(targetState);
    const intersectingTracts = [];

    // Check each tract for intersection
    for (const tractFeature of boundaries.features) {
      try {
        // Check if tract intersects with polygon
        if (turf.intersect(polygonFeature, tractFeature)) {
          // Calculate intersection area
          const intersection = turf.intersect(polygonFeature, tractFeature);
          if (intersection) {
            const intersectionArea = turf.area(intersection); // Area in square meters
            const tractArea = turf.area(tractFeature); // Area in square meters
            const intersectionRatio = tractArea > 0 ? intersectionArea / tractArea : 0;

            const geoid = this.getTractGeoid(tractFeature);
            if (geoid) {
              intersectingTracts.push({
                geoid: geoid.padStart(11, '0').substring(0, 11),
                feature: tractFeature,
                intersectionArea,
                intersectionRatio,
                tractArea,
              });
            }
          }
        }
      } catch (error) {
        // Skip tracts that cause errors (e.g., invalid geometry)
        console.warn(`Warning: Error checking intersection for tract:`, error.message);
        continue;
      }
    }

    return intersectingTracts;
  }

  /**
   * Calculate areal weighting for tracts intersecting with a polygon
   * Returns array of { geoid, weight } where weight is 0-1
   */
  async calculateArealWeights(polygon, state = null) {
    const intersectingTracts = await this.findIntersectingTracts(polygon, state);
    
    return intersectingTracts.map(tract => ({
      geoid: tract.geoid,
      weight: tract.intersectionRatio,
      intersectionArea: tract.intersectionArea,
      tractArea: tract.tractArea,
    }));
  }

  /**
   * Get GEOIDs for tracts that intersect with a polygon
   * Simplified version that just returns GEOIDs
   */
  async getIntersectingGeoids(polygon, state = null) {
    const intersectingTracts = await this.findIntersectingTracts(polygon, state);
    return intersectingTracts.map(tract => tract.geoid);
  }

  /**
   * Parse WKT (Well-Known Text) to GeoJSON
   * Basic implementation - for production, use a proper WKT parser library
   */
  parseWKT(wkt) {
    // This is a simplified WKT parser - for production, use a library like 'terraformer-wkt-parser'
    // For now, we'll throw an error and suggest using GeoJSON
    throw new Error('WKT parsing not yet implemented. Please provide GeoJSON format.');
  }

  /**
   * Validate and normalize GeoJSON input
   */
  normalizeGeoJSON(input) {
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch (error) {
        throw new Error('Invalid JSON string provided');
      }
    }
    return input;
  }
}

// Export singleton instance
module.exports = new SpatialAnalyzer();

