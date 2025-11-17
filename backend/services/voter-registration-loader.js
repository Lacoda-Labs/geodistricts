/**
 * Voter Registration Data Loader Service
 * Fetches and processes voter registration party data from various state sources
 */

const axios = require('axios');
const { parse } = require('csv-parse/sync');
const fs = require('fs').promises;
const path = require('path');

/**
 * State FIPS code mapping
 */
const STATE_FIPS_MAP = {
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

/**
 * State data source configurations
 * Maps states to their voter registration data sources
 */
const STATE_DATA_SOURCES = {
  'CA': {
    name: 'California Secretary of State',
    url: 'https://www.sos.ca.gov/elections/registration-statistics',
    method: 'manual', // Requires manual download or API access
    format: 'csv',
    granularity: 'precinct',
    notes: 'Statewide Database provides precinct-level data'
  },
  'NY': {
    name: 'New York State Board of Elections',
    url: 'https://www.elections.ny.gov/enrollment-congressional-district.html',
    method: 'download',
    format: 'csv',
    granularity: 'district',
    notes: 'County and congressional district level data available'
  },
  'FL': {
    name: 'Florida Division of Elections',
    url: 'https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/',
    method: 'download',
    format: 'csv',
    granularity: 'county',
    notes: 'County-level data available'
  },
  'TX': {
    name: 'Texas Secretary of State',
    url: 'https://www.sos.texas.gov/elections/historical/index.shtml',
    method: 'download',
    format: 'excel',
    granularity: 'county',
    notes: 'County-level data in Excel format'
  },
  'AZ': {
    name: 'Arizona Secretary of State',
    url: 'https://azsos.gov/elections/voter-registration-statistics',
    method: 'download',
    format: 'csv',
    granularity: 'county',
    notes: 'County-level voter registration data by party'
  }
  // Add more states as needed
};

/**
 * Voter Registration Data Loader
 */
class VoterRegistrationLoader {
  constructor() {
    this.loadingStates = new Set(); // Track states currently being loaded
  }

  /**
   * Get state FIPS code
   */
  getStateFipsCode(state) {
    return STATE_FIPS_MAP[state.toUpperCase()] || null;
  }

  /**
   * Get data source configuration for a state
   */
  getStateDataSource(state) {
    return STATE_DATA_SOURCES[state.toUpperCase()] || null;
  }

  /**
   * Fetch voter registration data for a state
   * This is a placeholder that will be implemented with actual state-specific loaders
   * 
   * @param {string} state - State abbreviation (e.g., 'CA', 'NY')
   * @returns {Promise<Object>} Voter registration data
   */
  async fetchVoterRegistrationData(state) {
    const stateUpper = state.toUpperCase();
    
    if (this.loadingStates.has(stateUpper)) {
      throw new Error(`Voter registration data is already being loaded for ${state}`);
    }

    this.loadingStates.add(stateUpper);

    try {
      console.log(`📥 Fetching voter registration data for ${state}...`);
      
      const dataSource = this.getStateDataSource(stateUpper);
      
      if (!dataSource) {
        // For states without configured sources, return placeholder structure
        console.warn(`⚠️ No data source configured for ${state}. Returning placeholder data.`);
        return this.createPlaceholderData(state);
      }

      // Route to state-specific loader
      let data;
      switch (dataSource.method) {
        case 'download':
          data = await this.fetchFromDownload(stateUpper, dataSource);
          break;
        case 'api':
          data = await this.fetchFromAPI(stateUpper, dataSource);
          break;
        case 'manual':
          // States requiring manual processing
          throw new Error(`State ${state} requires manual data processing. Data source: ${dataSource.url}`);
        default:
          throw new Error(`Unknown data source method for ${state}: ${dataSource.method}`);
      }

      // Process and normalize data
      const normalizedData = this.normalizeData(data, stateUpper, dataSource);

      console.log(`✅ Successfully fetched voter registration data for ${state}`);
      return normalizedData;

    } catch (error) {
      console.error(`❌ Error fetching voter registration data for ${state}:`, error.message);
      throw error;
    } finally {
      this.loadingStates.delete(stateUpper);
    }
  }

  /**
   * Fetch data from downloadable source
   */
  async fetchFromDownload(state, dataSource) {
    // Route to state-specific implementation
    if (state === 'AZ') {
      return await this.fetchArizonaData(dataSource);
    }
    
    // Generic fallback - try to download from URL
    try {
      console.log(`📥 Attempting to download from: ${dataSource.url}`);
      const response = await axios.get(dataSource.url, {
        timeout: 30000,
        responseType: dataSource.format === 'csv' ? 'text' : 'arraybuffer'
      });

      if (dataSource.format === 'csv') {
        return this.parseCSVData(response.data, state);
      } else {
        throw new Error(`Format ${dataSource.format} not yet supported for generic download`);
      }
    } catch (error) {
      console.error(`❌ Error downloading data for ${state}:`, error.message);
      throw new Error(`Failed to download data from ${dataSource.url}: ${error.message}`);
    }
  }

  /**
   * Fetch Arizona voter registration data
   * Arizona provides county-level voter registration statistics
   */
  async fetchArizonaData(dataSource) {
    try {
      // Arizona Secretary of State provides voter registration statistics
      // Common URL patterns (may need to be updated based on actual source)
      const possibleUrls = [
        'https://azsos.gov/sites/default/files/voter_registration_statistics.csv',
        'https://azsos.gov/elections/voter-registration-statistics',
        // Add more potential URLs as discovered
      ];

      let rawData = null;
      let lastError = null;

      // Try each possible URL
      for (const url of possibleUrls) {
        try {
          console.log(`📥 Trying to fetch Arizona data from: ${url}`);
          const response = await axios.get(url, {
            timeout: 30000,
            responseType: 'text',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; GeoDistricts/1.0)'
            }
          });

          if (response.data && response.data.length > 0) {
            rawData = response.data;
            console.log(`✅ Successfully fetched data from ${url}`);
            break;
          }
        } catch (error) {
          console.warn(`⚠️ Failed to fetch from ${url}:`, error.message);
          lastError = error;
          continue;
        }
      }

      if (!rawData) {
        // If direct download fails, create a structure that can be populated manually
        // or via a different method
        console.warn(`⚠️ Could not automatically fetch Arizona data. Creating structure for manual data entry.`);
        return this.createArizonaStructure();
      }

      // Parse CSV data
      return this.parseArizonaCSV(rawData);

    } catch (error) {
      console.error(`❌ Error fetching Arizona data:`, error.message);
      // Return structure that indicates manual processing needed
      return this.createArizonaStructure();
    }
  }

  /**
   * Parse Arizona CSV data
   */
  parseArizonaCSV(csvText) {
    try {
      const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      console.log(`📊 Parsed ${records.length} records from Arizona CSV`);

      // Arizona data typically has columns like:
      // County, Democratic, Republican, Libertarian, Green, Other, Total
      // Or variations of this format
      const processedData = [];

      for (const record of records) {
        // Try to identify county name and party counts
        // Handle various column name formats
        const countyName = record.County || record.COUNTY || record.county || record['County Name'] || '';
        
        if (!countyName) continue;

        // Try to extract voter counts - handle various column name formats
        const democratic = this.parseNumber(
          record.Democratic || record.DEM || record.D || record['Democratic Party'] || record['Dem'] || 0
        );
        const republican = this.parseNumber(
          record.Republican || record.REP || record.R || record['Republican Party'] || record['Rep'] || 0
        );
        const libertarian = this.parseNumber(
          record.Libertarian || record.LIB || record.L || record['Libertarian Party'] || 0
        );
        const green = this.parseNumber(
          record.Green || record.GRN || record.G || record['Green Party'] || 0
        );
        const other = this.parseNumber(
          record.Other || record.OTH || record.O || record['Other'] || record['No Party'] || record['Independent'] || 0
        );
        const total = this.parseNumber(
          record.Total || record.TOT || record.T || record['Total Voters'] || record['Total Registered'] || 0
        );

        // Calculate total if not provided
        const calculatedTotal = total || (democratic + republican + libertarian + green + other);
        const calculatedOther = other || (calculatedTotal - democratic - republican - libertarian - green);

        // Get county FIPS code
        const countyFips = this.getArizonaCountyFipsCode(countyName.trim());

        processedData.push({
          county: countyName.trim(),
          countyName: countyName.trim(),
          countyFips: countyFips,
          stateFips: '04', // Arizona FIPS code
          totalVoters: calculatedTotal,
          democraticVoters: democratic,
          republicanVoters: republican,
          otherVoters: calculatedOther, // Includes Libertarian, Green, and Other
          libertarianVoters: libertarian,
          greenVoters: green,
          // Calculate percentages
          democraticPercent: calculatedTotal > 0 ? (democratic / calculatedTotal) * 100 : 0,
          republicanPercent: calculatedTotal > 0 ? (republican / calculatedTotal) * 100 : 0,
          otherPercent: calculatedTotal > 0 ? (calculatedOther / calculatedTotal) * 100 : 0
        });
      }

      console.log(`✅ Processed ${processedData.length} counties for Arizona`);
      return processedData;

    } catch (error) {
      console.error(`❌ Error parsing Arizona CSV:`, error.message);
      throw new Error(`Failed to parse Arizona CSV data: ${error.message}`);
    }
  }

  /**
   * Arizona county FIPS codes mapping
   */
  getArizonaCountyFips() {
    return {
      'Apache': '001',
      'Cochise': '003',
      'Coconino': '005',
      'Gila': '007',
      'Graham': '009',
      'Greenlee': '011',
      'La Paz': '012',
      'Maricopa': '013',
      'Mohave': '015',
      'Navajo': '017',
      'Pima': '019',
      'Pinal': '021',
      'Santa Cruz': '023',
      'Yavapai': '025',
      'Yuma': '027'
    };
  }

  /**
   * Get county FIPS code for Arizona county name
   */
  getArizonaCountyFipsCode(countyName) {
    const fipsMap = this.getArizonaCountyFips();
    // Try exact match first
    if (fipsMap[countyName]) {
      return fipsMap[countyName];
    }
    // Try case-insensitive match
    const upperCounty = countyName.toUpperCase();
    for (const [county, fips] of Object.entries(fipsMap)) {
      if (county.toUpperCase() === upperCounty) {
        return fips;
      }
    }
    return null;
  }

  /**
   * Create Arizona data structure for manual entry
   */
  createArizonaStructure() {
    // Arizona has 15 counties
    const arizonaCounties = [
      'Apache', 'Cochise', 'Coconino', 'Gila', 'Graham',
      'Greenlee', 'La Paz', 'Maricopa', 'Mohave', 'Navajo',
      'Pima', 'Pinal', 'Santa Cruz', 'Yavapai', 'Yuma'
    ];

    return arizonaCounties.map(county => ({
      county: county,
      countyName: county,
      countyFips: this.getArizonaCountyFipsCode(county),
      stateFips: '04', // Arizona FIPS code
      totalVoters: 0,
      democraticVoters: 0,
      republicanVoters: 0,
      otherVoters: 0,
      democraticPercent: 0,
      republicanPercent: 0,
      otherPercent: 0,
      status: 'manual_entry_required',
      message: 'Data needs to be manually entered or fetched from alternative source'
    }));
  }

  /**
   * Parse number from various formats
   */
  parseNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    
    // Remove commas and other formatting
    const cleaned = String(value).replace(/,/g, '').replace(/\$/g, '').trim();
    const parsed = parseFloat(cleaned);
    
    return isNaN(parsed) ? 0 : Math.round(parsed);
  }

  /**
   * Parse generic CSV data
   */
  parseCSVData(csvText, state) {
    try {
      const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      console.log(`📊 Parsed ${records.length} records from CSV for ${state}`);
      return records;

    } catch (error) {
      console.error(`❌ Error parsing CSV for ${state}:`, error.message);
      throw new Error(`Failed to parse CSV data: ${error.message}`);
    }
  }

  /**
   * Fetch data from API
   */
  async fetchFromAPI(state, dataSource) {
    // This is a placeholder - actual implementation will call APIs
    throw new Error(`API method not yet implemented for ${state}. Please configure state-specific loader.`);
  }

  /**
   * Create placeholder data structure for states without configured sources
   */
  createPlaceholderData(state) {
    return {
      state: state.toUpperCase(),
      stateFips: this.getStateFipsCode(state),
      dataSource: 'placeholder',
      dataDate: new Date().toISOString(),
      granularity: 'county',
      status: 'not_configured',
      message: `Voter registration data source not yet configured for ${state}. Please add state-specific loader.`,
      data: [],
      metadata: {
        totalCounties: 0,
        totalTracts: 0,
        coverage: 0
      }
    };
  }

  /**
   * Normalize data to standard format
   */
  normalizeData(rawData, state, dataSource) {
    // Standard format for voter registration data
    const normalized = {
      state: state,
      stateFips: this.getStateFipsCode(state),
      dataSource: dataSource.name,
      dataSourceUrl: dataSource.url,
      dataDate: new Date().toISOString(),
      granularity: dataSource.granularity,
      status: 'success',
      data: [],
      metadata: {
        totalCounties: 0,
        totalTracts: 0,
        totalVoters: 0,
        democraticVoters: 0,
        republicanVoters: 0,
        otherVoters: 0,
        coverage: 0
      }
    };

    // Process raw data based on granularity
    if (dataSource.granularity === 'county') {
      normalized.data = this.processCountyData(rawData, state);
    } else if (dataSource.granularity === 'precinct') {
      normalized.data = this.processPrecinctData(rawData, state);
    } else if (dataSource.granularity === 'district') {
      normalized.data = this.processDistrictData(rawData, state);
    }

    // Calculate metadata
    this.calculateMetadata(normalized);

    return normalized;
  }

  /**
   * Process county-level data
   */
  processCountyData(rawData, state) {
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      console.warn(`⚠️ No county data to process for ${state}`);
      return [];
    }

    // If data is already in the right format (from state-specific parser), return it
    if (rawData[0] && rawData[0].county && rawData[0].totalVoters !== undefined) {
      return rawData;
    }

    // Otherwise, try to process generic format
    const processed = [];
    
    for (const record of rawData) {
      // Try to extract county and voter data from various formats
      const county = record.County || record.COUNTY || record.county || record['County Name'] || '';
      if (!county) continue;

      const totalVoters = this.parseNumber(record.Total || record.TOT || record.total || 0);
      const democraticVoters = this.parseNumber(record.Democratic || record.DEM || record.democratic || 0);
      const republicanVoters = this.parseNumber(record.Republican || record.REP || record.republican || 0);
      const otherVoters = this.parseNumber(record.Other || record.OTH || record.other || 0);

      processed.push({
        county: county.trim(),
        countyName: county.trim(),
        totalVoters: totalVoters || (democraticVoters + republicanVoters + otherVoters),
        democraticVoters: democraticVoters,
        republicanVoters: republicanVoters,
        otherVoters: otherVoters || (totalVoters - democraticVoters - republicanVoters),
        democraticPercent: totalVoters > 0 ? (democraticVoters / totalVoters) * 100 : 0,
        republicanPercent: totalVoters > 0 ? (republicanVoters / totalVoters) * 100 : 0,
        otherPercent: totalVoters > 0 ? ((totalVoters - democraticVoters - republicanVoters) / totalVoters) * 100 : 0
      });
    }

    return processed;
  }

  /**
   * Process precinct-level data
   */
  processPrecinctData(rawData, state) {
    // Placeholder - will process actual precinct data
    return [];
  }

  /**
   * Process district-level data
   */
  processDistrictData(rawData, state) {
    // Placeholder - will process actual district data
    return [];
  }

  /**
   * Calculate metadata from normalized data
   */
  calculateMetadata(normalized) {
    const data = normalized.data;
    
    if (data.length === 0) return;

    // Count unique counties
    const counties = new Set(data.map(d => d.countyFips || d.county)).size;
    normalized.metadata.totalCounties = counties;

    // Sum voters
    normalized.metadata.totalVoters = data.reduce((sum, d) => sum + (d.totalVoters || 0), 0);
    normalized.metadata.democraticVoters = data.reduce((sum, d) => sum + (d.democraticVoters || 0), 0);
    normalized.metadata.republicanVoters = data.reduce((sum, d) => sum + (d.republicanVoters || 0), 0);
    normalized.metadata.otherVoters = data.reduce((sum, d) => sum + (d.otherVoters || 0), 0);
  }

  /**
   * Get loading status for a state
   */
  isLoading(state) {
    return this.loadingStates.has(state.toUpperCase());
  }

  /**
   * Get list of configured states
   */
  getConfiguredStates() {
    return Object.keys(STATE_DATA_SOURCES);
  }

  /**
   * Get list of all states
   */
  getAllStates() {
    return Object.keys(STATE_FIPS_MAP);
  }
}

module.exports = new VoterRegistrationLoader();

