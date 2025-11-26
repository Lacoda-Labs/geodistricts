/**
 * PoliGeo Analyst Core Service
 * Main analysis engine for geodistrict voting analysis
 * Accepts multiple input formats and returns structured voting statistics
 */

const vestDataLoader = require('./vest-data-loader');
const spatialAnalyzer = require('./spatial-analyzer');
const representationComparison = require('./representation-comparison');
const axios = require('axios');

/**
 * PoliGeo Analyst Class
 */
class PoliGeoAnalyst {
  constructor() {
    this.apiBaseUrl = null; // Set this to enable internal API calls
  }

  /**
   * Set API base URL for internal service calls
   */
  setApiBaseUrl(url) {
    this.apiBaseUrl = url;
  }

  /**
   * Parse GEOID input (can be string, array, or CSV)
   */
  parseGeoidInput(input) {
    if (!input) {
      throw new Error('GEOID input is required and cannot be empty');
    }

    let geoids = [];
    
    if (Array.isArray(input)) {
      if (input.length === 0) {
        throw new Error('GEOID array cannot be empty');
      }
      geoids = input.map(g => {
        const geoid = String(g).trim();
        if (!geoid || geoid.length === 0) {
          throw new Error('Empty GEOID found in array');
        }
        // Validate GEOID is numeric and 11 digits
        if (!/^\d{11}$/.test(geoid.padStart(11, '0'))) {
          throw new Error(`Invalid GEOID format: ${geoid}. GEOIDs must be 11-digit numeric codes.`);
        }
        return geoid.padStart(11, '0').substring(0, 11);
      });
    } else if (typeof input === 'string') {
      // Try to parse as CSV
      if (input.includes(',')) {
        geoids = input.split(',').map(g => {
          const geoid = g.trim();
          if (!geoid || geoid.length === 0) {
            return null; // Skip empty entries
          }
          // Validate GEOID is numeric and 11 digits
          if (!/^\d{11}$/.test(geoid.padStart(11, '0'))) {
            throw new Error(`Invalid GEOID format: ${geoid}. GEOIDs must be 11-digit numeric codes.`);
          }
          return geoid.padStart(11, '0').substring(0, 11);
        }).filter(g => g !== null);
      } else {
        // Single GEOID
        const geoid = input.trim();
        if (!geoid || geoid.length === 0) {
          throw new Error('GEOID string cannot be empty');
        }
        // Validate GEOID is numeric and 11 digits
        if (!/^\d{11}$/.test(geoid.padStart(11, '0'))) {
          throw new Error(`Invalid GEOID format: ${geoid}. GEOIDs must be 11-digit numeric codes.`);
        }
        geoids = [geoid.padStart(11, '0').substring(0, 11)];
      }
    } else {
      throw new Error(`Invalid GEOID input type: ${typeof input}. Expected string, array, or CSV.`);
    }

    if (geoids.length === 0) {
      throw new Error('No valid GEOIDs found in input');
    }

    // Remove duplicates
    const uniqueGeoids = [...new Set(geoids)];
    if (uniqueGeoids.length !== geoids.length) {
      console.warn(`⚠️ Removed ${geoids.length - uniqueGeoids.length} duplicate GEOIDs`);
    }

    return uniqueGeoids;
  }

  /**
   * Analyze geodistrict from GEOID list (Format A)
   */
  async analyzeFromGeoids(geoids, geodistrictName = null) {
    const normalizedGeoids = this.parseGeoidInput(geoids);
    
    // Determine available years
    const status = await vestDataLoader.getStatus();
    const availableYears = status.availableYears.filter(y => y <= new Date().getFullYear());
    
    if (availableYears.length === 0) {
      throw new Error('No VEST data available. Please download VEST data first.');
    }

    // Load VEST data for available years
    const vestDataByYear = {};
    for (const year of availableYears) {
      try {
        const data = await vestDataLoader.loadVESTData(year);
        vestDataByYear[year] = data;
      } catch (error) {
        console.warn(`Warning: Could not load VEST data for ${year}:`, error.message);
      }
    }

    // Aggregate votes for each year
    const results = {};
    let totalTracts = 0;
    let missingTracts = 0;
    const missingGeoids = [];

    for (const year of availableYears) {
      const data = vestDataByYear[year];
      if (!data) continue;

      let totalDemVotes = 0;
      let totalRepVotes = 0;
      let totalPresVotes = 0;
      let foundTracts = 0;

      // Get tract data (handles both direct tract-level and county-level with allocation)
      const tractDataMap = await vestDataLoader.getTractData(normalizedGeoids, year, this.apiBaseUrl);

      for (const geoid of normalizedGeoids) {
        const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
        const tractData = tractDataMap[normalizedGeoid] || data.data?.[normalizedGeoid];
        
        if (tractData) {
          totalDemVotes += tractData.votes_dem_pres || 0;
          totalRepVotes += tractData.votes_rep_pres || 0;
          totalPresVotes += tractData.total_votes_pres || 0;
          foundTracts++;
        } else {
          missingGeoids.push(geoid);
          missingTracts++;
        }
      }

      if (totalTracts === 0) {
        totalTracts = normalizedGeoids.length;
      }

      const pctDem = totalPresVotes > 0 ? totalDemVotes / totalPresVotes : 0;
      const pctRep = totalPresVotes > 0 ? totalRepVotes / totalPresVotes : 0;
      const demAdvantage = ((pctDem - pctRep) * 100).toFixed(1);

      results[year] = {
        votes_dem_pres: Math.round(totalDemVotes),
        votes_rep_pres: Math.round(totalRepVotes),
        total_pres: Math.round(totalPresVotes),
        pct_dem_pres: parseFloat(pctDem.toFixed(3)),
        pct_rep_pres: parseFloat(pctRep.toFixed(3)),
        dem_advantage: `${demAdvantage >= 0 ? '+' : ''}${demAdvantage}`,
        coverage: foundTracts / normalizedGeoids.length,
      };
    }

    // Calculate trends
    const trends = {};
    if (results[2016] && results[2020]) {
      const trend = ((results[2020].pct_dem_pres - results[2016].pct_dem_pres) * 100).toFixed(1);
      trends.trend_2016_2020 = `${trend >= 0 ? '+' : ''}${trend} ${trend >= 0 ? 'Dem' : 'Rep'}`;
    }
    if (results[2020] && results[2024]) {
      const trend = ((results[2024].pct_dem_pres - results[2020].pct_dem_pres) * 100).toFixed(1);
      trends.trend_2020_2024 = `${trend >= 0 ? '+' : ''}${trend} ${trend >= 0 ? 'Dem' : 'Rep'}`;
    }

    // Determine party lean recommendation
    const latestYear = Math.max(...availableYears);
    const latestResult = results[latestYear];
    const recommendedLean = this.recommendPartyLean(latestResult.pct_dem_pres);

    // Get comparison to representation
    const comparison = await representationComparison.compareToRepresentation(
      { geoids: normalizedGeoids, state: null },
      latestResult
    );

    const coverage = totalTracts > 0 ? (totalTracts - missingTracts) / totalTracts : 0;
    
    return {
      geodistrict_name: geodistrictName || `Custom Geodistrict (${normalizedGeoids.length} tracts)`,
      source_years: availableYears,
      tract_count: totalTracts,
      missing_tract_count: missingTracts,
      missing_tract_coverage: parseFloat(coverage.toFixed(3)),
      estimated_voting_age_population: null, // Would need ACS data
      results: {
        ...results,
        ...trends,
        recommended_proxy_party_lean: recommendedLean,
      },
      comparison_to_current_representation: comparison,
      data_last_updated: status.lastUpdated ? status.lastUpdated.toISOString().split('T')[0] : null,
      methodology: 'VEST/Harvard precinct-to-tract allocation (areal weighting + dasymetric refinement)',
      warnings: missingTracts > 0 ? [
        `${missingTracts} tracts (${((missingTracts / totalTracts) * 100).toFixed(1)}%) missing from VEST data`,
        `Coverage: ${(coverage * 100).toFixed(1)}%`
      ] : [],
      data_quality: {
        coverage_percent: parseFloat((coverage * 100).toFixed(1)),
        missing_tracts: missingGeoids.slice(0, 10), // Show first 10 missing GEOIDs
        total_missing: missingTracts,
      },
    };
  }

  /**
   * Analyze geodistrict from polygon (Format B)
   */
  async analyzeFromPolygon(polygon, geodistrictName = null, state = null) {
    // Normalize GeoJSON input
    const normalizedPolygon = spatialAnalyzer.normalizeGeoJSON(polygon);

    // Find intersecting tracts
    const intersectingTracts = await spatialAnalyzer.findIntersectingTracts(normalizedPolygon, state);
    
    if (intersectingTracts.length === 0) {
      throw new Error('No tracts found intersecting with the provided polygon');
    }

    // Extract GEOIDs and weights
    const geoids = intersectingTracts.map(t => t.geoid);
    const weights = new Map();
    intersectingTracts.forEach(t => {
      weights.set(t.geoid, t.intersectionRatio);
    });

    // Get status and available years
    const status = await vestDataLoader.getStatus();
    const availableYears = status.availableYears.filter(y => y <= new Date().getFullYear());

    if (availableYears.length === 0) {
      throw new Error('No VEST data available. Please download VEST data first.');
    }

    // Load VEST data and aggregate with weights
    const vestDataByYear = {};
    for (const year of availableYears) {
      try {
        const data = await vestDataLoader.loadVESTData(year);
        vestDataByYear[year] = data;
      } catch (error) {
        console.warn(`Warning: Could not load VEST data for ${year}:`, error.message);
      }
    }

    const results = {};
    let missingTracts = 0;

    // Get all tract GEOIDs from intersecting tracts
    const tractGeoids = intersectingTracts.map(t => t.geoid);

    for (const year of availableYears) {
      const data = vestDataByYear[year];
      if (!data) continue;

      // Get tract data (handles both direct tract-level and county-level with allocation)
      const tractDataMap = await vestDataLoader.getTractData(tractGeoids, year, this.apiBaseUrl);

      let totalDemVotes = 0;
      let totalRepVotes = 0;
      let totalPresVotes = 0;
      let foundTracts = 0;

      for (const tract of intersectingTracts) {
        const geoid = tract.geoid;
        const weight = tract.intersectionRatio;
        const tractData = tractDataMap[geoid] || data.data?.[geoid];
        
        if (tractData) {
          // Apply areal weighting (for polygon intersection)
          totalDemVotes += (tractData.votes_dem_pres || 0) * weight;
          totalRepVotes += (tractData.votes_rep_pres || 0) * weight;
          totalPresVotes += (tractData.total_votes_pres || 0) * weight;
          foundTracts++;
        } else {
          missingTracts++;
        }
      }

      const pctDem = totalPresVotes > 0 ? totalDemVotes / totalPresVotes : 0;
      const pctRep = totalPresVotes > 0 ? totalRepVotes / totalPresVotes : 0;
      const demAdvantage = ((pctDem - pctRep) * 100).toFixed(1);

      results[year] = {
        votes_dem_pres: Math.round(totalDemVotes),
        votes_rep_pres: Math.round(totalRepVotes),
        total_pres: Math.round(totalPresVotes),
        pct_dem_pres: parseFloat(pctDem.toFixed(3)),
        pct_rep_pres: parseFloat(pctRep.toFixed(3)),
        dem_advantage: `${demAdvantage >= 0 ? '+' : ''}${demAdvantage}`,
        coverage: foundTracts / intersectingTracts.length,
      };
    }

    // Calculate trends
    const trends = {};
    if (results[2016] && results[2020]) {
      const trend = ((results[2020].pct_dem_pres - results[2016].pct_dem_pres) * 100).toFixed(1);
      trends.trend_2016_2020 = `${trend >= 0 ? '+' : ''}${trend} ${trend >= 0 ? 'Dem' : 'Rep'}`;
    }
    if (results[2020] && results[2024]) {
      const trend = ((results[2024].pct_dem_pres - results[2020].pct_dem_pres) * 100).toFixed(1);
      trends.trend_2020_2024 = `${trend >= 0 ? '+' : ''}${trend} ${trend >= 0 ? 'Dem' : 'Rep'}`;
    }

    // Determine party lean
    const latestYear = Math.max(...availableYears);
    const latestResult = results[latestYear];
    const recommendedLean = this.recommendPartyLean(latestResult.pct_dem_pres);

    // Get comparison to representation
    const comparison = await representationComparison.compareToRepresentation(
      { geoids, state },
      latestResult
    );

    const totalTractCount = intersectingTracts.length;
    const coverage = totalTractCount > 0 ? (totalTractCount - missingTracts) / totalTractCount : 0;
    
    return {
      geodistrict_name: geodistrictName || `Custom Geodistrict (${totalTractCount} tracts)`,
      source_years: availableYears,
      tract_count: totalTractCount,
      missing_tract_count: missingTracts,
      missing_tract_coverage: parseFloat(coverage.toFixed(3)),
      estimated_voting_age_population: null, // Would need ACS data
      results: {
        ...results,
        ...trends,
        recommended_proxy_party_lean: recommendedLean,
      },
      comparison_to_current_representation: comparison,
      data_last_updated: status.lastUpdated ? status.lastUpdated.toISOString().split('T')[0] : null,
      methodology: 'VEST/Harvard precinct-to-tract allocation (areal weighting + dasymetric refinement)',
      warnings: missingTracts > 0 ? [
        `${missingTracts} tracts (${((missingTracts / totalTractCount) * 100).toFixed(1)}%) missing from VEST data`,
        `Coverage: ${(coverage * 100).toFixed(1)}%`
      ] : [],
      data_quality: {
        coverage_percent: parseFloat((coverage * 100).toFixed(1)),
        total_missing: missingTracts,
        spatial_method: 'areal_weighting',
      },
    };
  }

  /**
   * Analyze geodistrict from district name (Format C)
   * Fetches boundaries from Census TIGER or RDH
   */
  async analyzeFromDistrictName(districtName, districtType = 'congressional', state = null) {
    // This is a placeholder - in production, you would:
    // 1. Parse district name (e.g., "PA-07", "California State Senate District 15")
    // 2. Fetch boundaries from Census TIGER or RDH
    // 3. Use analyzeFromPolygon with the fetched boundaries
    
    throw new Error('District name analysis not yet implemented. Please use GEOID list or GeoJSON polygon format.');
  }

  /**
   * Recommend party lean based on vote share
   */
  recommendPartyLean(pctDem) {
    const margin = Math.abs(pctDem - 0.5);
    
    if (margin < 0.02) {
      return 'Toss-up (0–2%)';
    } else if (margin < 0.05) {
      return pctDem > 0.5 ? 'Lean Democratic (+2–5)' : 'Lean Republican (+2–5)';
    } else if (margin < 0.10) {
      return pctDem > 0.5 ? 'Likely Democratic (+5–10)' : 'Likely Republican (+5–10)';
    } else if (margin < 0.15) {
      return pctDem > 0.5 ? 'Safe Democratic (+10–15)' : 'Safe Republican (+10–15)';
    } else {
      return pctDem > 0.5 ? 'Very Safe Democratic (+15+)' : 'Very Safe Republican (+15+)';
    }
  }

  /**
   * Validate input data based on format
   */
  validateInput(input_format, input_data, state) {
    const format = input_format.toLowerCase();

    if (format === 'polygon' || format === 'geojson' || format === 'b') {
      if (!state) {
        throw new Error('State parameter is required for polygon input format');
      }
      if (!input_data) {
        throw new Error('Polygon data is required');
      }
      // Additional GeoJSON validation is done in spatialAnalyzer
    }

    if (format === 'district' || format === 'district_name' || format === 'c') {
      if (!input_data || typeof input_data !== 'string') {
        throw new Error('District name must be a non-empty string');
      }
      if (!state) {
        throw new Error('State parameter is recommended for district name format');
      }
    }
  }

  /**
   * Main analyze method - routes to appropriate handler based on input format
   */
  async analyze(input) {
    const { input_format, input_data, geodistrict_name, state } = input;

    // Validate required fields
    if (!input_format) {
      throw new Error('input_format is required');
    }
    if (input_data === null || input_data === undefined) {
      throw new Error('input_data is required');
    }

    // Validate input based on format
    this.validateInput(input_format, input_data, state);

    const format = input_format.toLowerCase();

    try {
      switch (format) {
        case 'geoid':
        case 'geoids':
        case 'a':
          return await this.analyzeFromGeoids(input_data, geodistrict_name);

        case 'polygon':
        case 'geojson':
        case 'b':
          return await this.analyzeFromPolygon(input_data, geodistrict_name, state);

        case 'district':
        case 'district_name':
        case 'c':
          return await this.analyzeFromDistrictName(input_data, null, state);

        default:
          throw new Error(`Unknown input format: ${input_format}. Supported formats: geoid, polygon, district`);
      }
    } catch (error) {
      // Enhance error messages with context
      if (error.message.includes('VEST data')) {
        throw new Error(`VEST data error: ${error.message}. Please ensure VEST data is downloaded first using POST /api/poligeo/vest-data/download`);
      }
      if (error.message.includes('polygon') || error.message.includes('GeoJSON')) {
        throw new Error(`Spatial analysis error: ${error.message}. Please ensure the polygon is valid GeoJSON with Polygon or MultiPolygon geometry.`);
      }
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PoliGeoAnalyst();

