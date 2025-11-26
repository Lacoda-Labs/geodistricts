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
        const serviceUrl = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0/query';
        
        const params = new URLSearchParams({
          where: `STATE_FIPS='${stateFips}'`,
          outFields: 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,GEOID',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: '2000'
        });
        
        const response = await axios.get(`${serviceUrl}?${params.toString()}`, {
          timeout: 60000,
        });
        
        boundaries = {
          type: 'FeatureCollection',
          features: response.data.features || []
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
   * Extract GEOID from a tract feature
   */
  getTractGeoid(feature) {
    return feature.properties?.GEOID || 
           feature.properties?.geoid ||
           (feature.properties?.STATE_FIPS && feature.properties?.COUNTY_FIPS && feature.properties?.TRACT_FIPS
             ? `${feature.properties.STATE_FIPS}${feature.properties.COUNTY_FIPS}${feature.properties.TRACT_FIPS}`
             : null);
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
            unioned = turf.union(unioned, polygon.features[i]);
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

