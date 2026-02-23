/**
 * VEST (Voting and Election Science Team) Data Loader Service
 * Downloads, processes, and caches Harvard Dataverse tract-level election data
 * 
 * Data Sources:
 * - 2016: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/NH5S2I
 * - 2020: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ
 * - 2024: Auto-detect when available
 */

const axios = require('axios');
const { parse } = require('csv-parse/sync');
const cloudStorageCache = require('./cloud-storage-cache');
const localCache = require('../local-cache');

/**
 * VEST Dataset Configuration
 */
const VEST_DATASETS = {
  2016: {
    persistentId: 'doi:10.7910/DVN/NH5S2I',
    datasetUrl: 'https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/NH5S2I',
    // Common filename patterns for tract-level data
    tractFilePatterns: ['tract_2016', '*tract*2016*', 'vest_2016_tract', 'tract16', 'tract_16'],
    // Column mappings for 2016
    columnMappings: {
      'G16PREDCli': 'votes_dem_pres_2016',
      'G16PRERTRU': 'votes_rep_pres_2016',
      'G16PREDJOH': 'votes_other_pres_2016',
      'G16USSD': 'votes_dem_sen_2016',
      'G16USSR': 'votes_rep_sen_2016',
      'G16GOVD': 'votes_dem_gov_2016',
      'G16GOVR': 'votes_rep_gov_2016',
    }
  },
  2020: {
    persistentId: 'doi:10.7910/DVN/VOQCHQ',
    datasetUrl: 'https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ',
    tractFilePatterns: ['tract_2020', '*tract*2020*', 'vest_2020_tract', 'tract20', 'tract_20'],
    columnMappings: {
      'G20PREDBID': 'votes_dem_pres_2020',
      'G20PRERTRU': 'votes_rep_pres_2020',
      'G20PREDJOA': 'votes_other_pres_2020',
      'G20USSD': 'votes_dem_sen_2020',
      'G20USSR': 'votes_rep_sen_2020',
      'G20GOVD': 'votes_dem_gov_2020',
      'G20GOVR': 'votes_rep_gov_2020',
    }
  },
  2024: {
    persistentId: null, // To be determined when available
    datasetUrl: null,
    tractFilePatterns: ['tract_2024.csv', '*tract*2024*.csv', 'vest_2024_tract.csv'],
    columnMappings: {
      // Will be determined when 2024 data is available
    }
  }
};

/**
 * VEST Data Loader Class
 */
class VESTDataLoader {
  constructor() {
    this.loadingYears = new Set(); // Track years currently being loaded
    this.dataCache = new Map(); // In-memory cache for processed data
  }

  /**
   * Get cache key for a year
   */
  getCacheKey(year) {
    return `vest_data_tract_${year}`;
  }

  /**
   * Get metadata cache key
   */
  getMetadataCacheKey() {
    return 'vest_data_metadata';
  }

  /**
   * List files in a Dataverse dataset
   */
  async listDatasetFiles(persistentId, version = ':latest') {
    try {
      const url = `https://dataverse.harvard.edu/api/datasets/:persistentId/versions/${version}/files?persistentId=${persistentId}`;
      console.log(`📋 Listing files in dataset: ${persistentId}`);
      console.log(`>>> EXTERNAL FETCH | Harvard Dataverse | list files in VEST dataset | persistentId=${persistentId}`);
      
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'Accept': 'application/json',
        },
      });

      // Handle different response structures
      if (response.data) {
        // Standard structure: { status: 'OK', data: [...] }
        if (response.data.data && Array.isArray(response.data.data)) {
          return response.data.data;
        }
        // Alternative structure: direct array
        if (Array.isArray(response.data)) {
          return response.data;
        }
        // Some APIs return { files: [...] }
        if (response.data.files && Array.isArray(response.data.files)) {
          return response.data.files;
        }
      }
      
      throw new Error('Invalid response structure from Dataverse API');
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const message = error.response.data?.message || statusText;
        throw new Error(`Dataverse API error (${status}): ${message}`);
      }
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout while connecting to Dataverse API');
      }
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error('Could not connect to Dataverse API. Please check your internet connection.');
      }
      throw new Error(`Failed to list dataset files: ${error.message}`);
    }
  }

  /**
   * Find tract-level CSV/TAB file in dataset files
   * Searches through files and directories recursively
   */
  findTractFile(files, patterns) {
    // Flatten files array (handle both direct files and directory structures)
    const allFiles = [];
    
    const flattenFiles = (fileList) => {
      for (const file of fileList) {
        if (file.dataFile) {
          // It's a file
          allFiles.push(file);
        } else if (file.directoryLabel && file.files) {
          // It's a directory, recurse
          flattenFiles(file.files);
        }
      }
    };
    
    flattenFiles(files);
    
    // Search for matching file (CSV or TAB format)
    for (const file of allFiles) {
      const fileName = file.dataFile?.filename || file.label || '';
      const fileNameLower = fileName.toLowerCase();
      
      // Must be a CSV or TAB file
      if (!fileNameLower.endsWith('.csv') && !fileNameLower.endsWith('.tab') && !fileNameLower.endsWith('.tsv')) {
        continue;
      }
      
      // Check if filename matches any pattern
      for (const pattern of patterns) {
        const patternLower = pattern.toLowerCase().replace(/\*/g, '').replace('.csv', '');
        // Check if pattern is contained in filename (flexible matching)
        if (fileNameLower.includes(patternLower)) {
          console.log(`✅ Matched file "${fileName}" to pattern "${pattern}"`);
          return file;
        }
      }
    }
    
    // If no exact match, try to find any file with "tract" in the name
    for (const file of allFiles) {
      const fileName = file.dataFile?.filename || file.label || '';
      const fileNameLower = fileName.toLowerCase();
      
      if (fileNameLower.includes('tract') && 
          (fileNameLower.endsWith('.csv') || fileNameLower.endsWith('.tab') || fileNameLower.endsWith('.tsv'))) {
        console.log(`⚠️ Found tract file by keyword search: "${fileName}"`);
        return file;
      }
    }
    
    // Last resort: look for any data file that might contain tract data
    // VEST datasets sometimes have tract data in state-specific files or combined files
    console.log(`⚠️ No tract file found. Available files: ${allFiles.map(f => f.dataFile?.filename || f.label).join(', ')}`);
    console.log(`💡 Note: VEST tract-level data may be in state-specific files or require manual download from the dataset page.`);
    
    return null;
  }

  /**
   * Download a file from Dataverse by file ID
   */
  async downloadFileById(fileId) {
    try {
      const url = `https://dataverse.harvard.edu/api/access/datafile/${fileId}`;
      console.log(`📥 Downloading file ID: ${fileId}`);
      console.log(`>>> EXTERNAL FETCH | Harvard Dataverse | download VEST data file by ID | fileId=${fileId}`);
      
      const response = await axios.get(url, {
        timeout: 300000, // 5 minute timeout for large files
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
          'Accept': 'text/csv, text/tab-separated-values, */*',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Failed to download file: ${error.response.status} - ${error.response.statusText}`);
      }
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Download a file from Dataverse by persistent ID
   */
  async downloadFileByPersistentId(persistentId) {
    try {
      const url = `https://dataverse.harvard.edu/api/access/datafile/:persistentId?persistentId=${persistentId}`;
      console.log(`📥 Downloading file with persistent ID: ${persistentId}`);
      console.log(`>>> EXTERNAL FETCH | Harvard Dataverse | download VEST data file by persistent ID | persistentId=${persistentId}`);
      
      const response = await axios.get(url, {
        timeout: 300000, // 5 minute timeout for large files
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
          'Accept': 'text/csv, text/tab-separated-values, */*',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Failed to download file: ${error.response.status} - ${error.response.statusText}`);
      }
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Download VEST data from Harvard Dataverse
   * Uses Dataverse API to list files, find tract-level CSV, and download it
   */
  async downloadVESTData(year) {
    const config = VEST_DATASETS[year];
    if (!config) {
      throw new Error(`VEST data not configured for year ${year}`);
    }

    if (year === 2024 && !config.persistentId) {
      throw new Error('2024 VEST data not yet available');
    }

    if (!config.persistentId) {
      throw new Error(`No persistent ID configured for year ${year}`);
    }

    try {
      console.log(`🔍 Searching for tract-level CSV in dataset ${config.persistentId}...`);
      
      // List files in the dataset
      const files = await this.listDatasetFiles(config.persistentId);
      
      if (!files || files.length === 0) {
        throw new Error('No files found in dataset');
      }

      console.log(`📋 Found ${files.length} files in dataset`);

      // Find the tract-level CSV file
      const tractFile = this.findTractFile(files, config.tractFilePatterns);
      
      if (!tractFile) {
        // Log available files for debugging
        const availableFiles = files.map(f => f.dataFile?.filename || f.label || 'unknown').join(', ');
        console.warn(`⚠️ Tract-level file not found. Available files: ${availableFiles}`);
        console.warn(`💡 VEST tract-level data may be in state-specific files or subdirectories.`);
        console.warn(`💡 Please visit ${config.datasetUrl} to manually download tract-level files.`);
        throw new Error(
          `Tract-level file not found in dataset. ` +
          `The VEST dataset structure may require manual download of tract-level files. ` +
          `Please visit ${config.datasetUrl} and download the tract-level CSV/TAB files manually, ` +
          `then place them in data/vest/ directory as tract_${year}.csv or tract_${year}.tab`
        );
      }

      const fileName = tractFile.dataFile?.filename || tractFile.label || 'unknown';
      console.log(`✅ Found tract file: ${fileName}`);

      // Download the file
      let csvData;
      
      // Try file ID first (most reliable)
      if (tractFile.dataFile?.id) {
        console.log(`📥 Downloading using file ID: ${tractFile.dataFile.id}`);
        csvData = await this.downloadFileById(tractFile.dataFile.id);
      } else if (tractFile.dataFile?.persistentId) {
        // Try persistent ID
        console.log(`📥 Downloading using persistent ID: ${tractFile.dataFile.persistentId}`);
        csvData = await this.downloadFileByPersistentId(tractFile.dataFile.persistentId);
      } else {
        throw new Error('File ID or persistent ID not found in file metadata');
      }

      console.log(`✅ Successfully downloaded ${(csvData.length / 1024 / 1024).toFixed(2)} MB of VEST data for ${year}`);
      
      return csvData;

    } catch (error) {
      console.error(`❌ Error downloading VEST data for ${year}:`, error.message);
      throw new Error(`Failed to download VEST data from Dataverse: ${error.message}. You can manually download from ${config.datasetUrl}`);
    }
  }

  /**
   * Ensure data directory exists
   */
  async ensureDataDirectory() {
    const fs = require('fs').promises;
    const path = require('path');
    const dataDir = path.join(__dirname, '..', 'data', 'vest');
    
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's OK
      if (error.code !== 'EEXIST') {
        console.warn(`⚠️ Could not create data directory: ${error.message}`);
      }
    }
    
    return dataDir;
  }

  /**
   * Allocate county-level votes to tracts using spatial methods
   * Uses areal weighting (proportional to tract area within county)
   * Optionally uses dasymetric weighting (proportional to population) if available
   */
  async allocateCountyToTracts(countyData, year, state = null) {
    const turf = require('@turf/turf');
    const axios = require('axios');
    
    console.log(`🔄 Allocating county-level votes to tracts for ${year}...`);
    
    // Group county data by county FIPS
    const countyVotes = {};
    for (const record of countyData) {
      const countyFips = String(record.county_fips || record.county_fips || '').padStart(5, '0');
      if (!countyFips || countyFips === '00000') continue;
      
      if (!countyVotes[countyFips]) {
        countyVotes[countyFips] = {
          countyFips,
          votes_dem_pres: 0,
          votes_rep_pres: 0,
          total_votes_pres: 0,
        };
      }
      
      // Aggregate votes by party
      const yearSuffix = year.toString().substring(2);
      const demKey = `G${yearSuffix}PREDBID` || `G${yearSuffix}PREDCli`;
      const repKey = `G${yearSuffix}PRERTRU`;
      
      const demVotes = this.parseNumber(record[demKey] || (record.party === 'DEMOCRAT' ? record.candidatevotes : 0));
      const repVotes = this.parseNumber(record[repKey] || (record.party === 'REPUBLICAN' ? record.candidatevotes : 0));
      
      if (record.party === 'DEMOCRAT' || record.party === 'DEM') {
        countyVotes[countyFips].votes_dem_pres += demVotes;
      } else if (record.party === 'REPUBLICAN' || record.party === 'REP') {
        countyVotes[countyFips].votes_rep_pres += repVotes;
      }
      
      countyVotes[countyFips].total_votes_pres += this.parseNumber(record.totalvotes || record.total_votes || 0);
    }
    
    console.log(`📊 Found votes for ${Object.keys(countyVotes).length} counties`);
    
    // For now, use simple proportional allocation based on tract area
    // In production, you'd load actual tract boundaries and do spatial intersection
    // This is a placeholder that allocates evenly - should be replaced with actual spatial allocation
    const processedData = {};
    
    // TODO: Implement actual spatial allocation
    // 1. Load tract boundaries for each state/county
    // 2. Load county boundaries
    // 3. Calculate intersection area for each tract-county pair
    // 4. Allocate votes proportionally
    
    console.log(`⚠️ County-to-tract allocation not yet fully implemented. Using placeholder allocation.`);
    console.log(`💡 To implement: Load tract boundaries, calculate spatial intersections, and allocate votes proportionally.`);
    
    return {
      data: processedData,
      metadata: {
        year,
        totalCounties: Object.keys(countyVotes).length,
        allocationMethod: 'county_to_tract_placeholder',
        note: 'County-to-tract allocation requires spatial intersection - not yet implemented',
      }
    };
  }

  /**
   * Process county-level VEST data
   */
  async processCountyLevelData(rawData, year) {
    try {
      // Detect delimiter
      const isTabDelimited = rawData.includes('\t') && !rawData.split('\n')[0].includes(',');
      const delimiter = isTabDelimited ? '\t' : ',';
      
      console.log(`📊 Processing ${isTabDelimited ? 'TAB' : 'CSV'} delimited county-level data for ${year}...`);
      
      // Parse CSV/TAB
      const records = parse(rawData, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: delimiter,
      });

      // Filter for the specific year
      const yearRecords = records.filter(r => {
        const recordYear = parseInt(r.year || r.YEAR || 0);
        return recordYear === year;
      });

      console.log(`📊 Found ${yearRecords.length} county records for ${year}`);

      // Filter for presidential elections
      const presRecords = yearRecords.filter(r => {
        const office = (r.office || r.OFFICE || '').toUpperCase();
        return office.includes('PRESIDENT') || office === 'US PRESIDENT';
      });

      console.log(`📊 Found ${presRecords.length} presidential county records for ${year}`);

      // Group by county and aggregate votes
      const countyVotes = {};
      for (const record of presRecords) {
        // County FIPS in VEST data is numeric (e.g., 1001.0) - this is already a 5-digit FIPS (state + county)
        let countyFipsRaw = record.county_fips || record.COUNTY_FIPS;
        if (countyFipsRaw === null || countyFipsRaw === undefined || countyFipsRaw === '') {
          continue;
        }
        
        // Handle numeric format (e.g., 1001.0) - convert to 5-digit string
        // VEST data uses 5-digit FIPS codes (state FIPS + county FIPS)
        const countyFips5 = String(Math.floor(parseFloat(countyFipsRaw))).padStart(5, '0');
        if (!countyFips5 || countyFips5 === '00000') continue;

        // Extract state and county FIPS from 5-digit code
        const stateFips = countyFips5.substring(0, 2);
        const countyFips = countyFips5.substring(2, 5);
        
        // Get state code for reference
        const stateCode = (record.state_po || record.STATE_PO || '').toUpperCase();

        if (!countyVotes[countyFips5]) {
          countyVotes[countyFips5] = {
            countyFips5,
            countyFips, // Last 3 digits
            countyName: record.county_name || record.COUNTY_NAME || '',
            state: stateCode,
            stateFips,
            votes_dem_pres: 0,
            votes_rep_pres: 0,
            total_votes_pres: 0,
          };
        }

        // Aggregate votes by party
        const party = (record.party || record.PARTY || '').toUpperCase();
        const candidateVotes = this.parseNumber(record.candidatevotes || record.CANDIDATEVOTES || 0);
        const totalVotes = this.parseNumber(record.totalvotes || record.TOTALVOTES || 0);

        if (party === 'DEMOCRAT' || party === 'DEM') {
          countyVotes[countyFips5].votes_dem_pres += candidateVotes;
        } else if (party === 'REPUBLICAN' || party === 'REP') {
          countyVotes[countyFips5].votes_rep_pres += candidateVotes;
        }

        // Use the maximum total votes (should be consistent per county)
        if (totalVotes > countyVotes[countyFips5].total_votes_pres) {
          countyVotes[countyFips5].total_votes_pres = totalVotes;
        }
      }

      console.log(`✅ Processed ${Object.keys(countyVotes).length} counties for ${year}`);

      return {
        countyData: countyVotes,
        metadata: {
          year,
          totalCounties: Object.keys(countyVotes).length,
          totalRecords: presRecords.length,
          processedAt: new Date().toISOString(),
        }
      };
    } catch (error) {
      console.error(`❌ Error processing county-level VEST data for ${year}:`, error);
      throw error;
    }
  }

  /**
   * Load VEST data from local file (if manually downloaded)
   * Checks multiple possible locations and file formats
   * Now handles both tract-level and county-level data
   */
  async loadFromLocalFile(year) {
    const fs = require('fs').promises;
    const path = require('path');
    
    // __dirname is backend/services, so we need to go up one level to backend, then into data/vest
    const vestDataDir = path.join(__dirname, '..', 'data', 'vest');
    const dataverseFilesDir = path.join(vestDataDir, 'dataverse_files');
    
    // Debug: Log the paths being checked
    console.log(`🔍 Checking for VEST data files for year ${year}`);
    console.log(`   Vest data dir: ${vestDataDir}`);
    console.log(`   Dataverse files dir: ${dataverseFilesDir}`);
    
    // Check if directories exist
    try {
      await fs.access(dataverseFilesDir);
      console.log(`✅ Dataverse files directory exists`);
    } catch (error) {
      console.warn(`⚠️ Dataverse files directory does not exist: ${dataverseFilesDir}`);
    }
    
    // Possible file locations and names
    const possibleFiles = [
      // Direct in vest directory
      path.join(vestDataDir, `tract_${year}.csv`),
      path.join(vestDataDir, `tract_${year}.tab`),
      path.join(vestDataDir, `tract_${year}.tsv`),
      // In dataverse_files subdirectory
      path.join(dataverseFilesDir, `tract_${year}.csv`),
      path.join(dataverseFilesDir, `tract_${year}.tab`),
      path.join(dataverseFilesDir, `tract_${year}.tsv`),
      // Alternative naming patterns
      path.join(dataverseFilesDir, `vest_${year}_tract.csv`),
      path.join(dataverseFilesDir, `vest_${year}_tract.tab`),
      path.join(dataverseFilesDir, `tract${year}.csv`),
      path.join(dataverseFilesDir, `tract${year}.tab`),
      // County-level files (will be allocated to tracts)
      path.join(dataverseFilesDir, `countypres_2000-2024.csv`),
      path.join(dataverseFilesDir, `countypres_2000-2024.tab`),
    ];
    
    // Try each possible file location
    for (const filePath of possibleFiles) {
      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        if (fileContent && fileContent.length > 0) {
          console.log(`✅ Found VEST data file at: ${filePath}`);
          // Check if it's a county-level file
          if (filePath.includes('county') || filePath.includes('countypres')) {
            console.log(`📊 Detected as county-level file - will process for year ${year}`);
            return { content: fileContent, isCountyLevel: true };
          }
          return fileContent;
        }
      } catch (error) {
        // File doesn't exist at this location, try next
        if (error.code !== 'ENOENT') {
          console.warn(`⚠️ Error reading ${filePath}: ${error.message}`);
        }
        continue;
      }
    }
    
    // Now check for county-level files (after checking for tract-level files)
    // This includes multi-year files like countypres_2000-2024.csv
    
    // If no tract file found, check for county-level files that can be allocated
    try {
      const files = await fs.readdir(dataverseFilesDir);
      const countyFiles = files.filter(f => 
        (f.endsWith('.csv') || f.endsWith('.tab') || f.endsWith('.tsv')) &&
        (f.includes('county') || f.includes('pres')) &&
        !f.endsWith('.md') &&
        !f.endsWith('.xml') &&
        !f.includes('sources') // Exclude sources file
      );
      
      if (countyFiles.length > 0) {
        console.log(`📊 Found county-level file(s): ${countyFiles.join(', ')}`);
        console.log(`💡 Will process county-level data and allocate to tracts using spatial methods.`);
        
        // Try to load county-level file (prefer files that contain the year or are multi-year)
        // Sort to prefer files that might contain the year
        const sortedFiles = countyFiles.sort((a, b) => {
          const aHasYear = a.includes(year.toString());
          const bHasYear = b.includes(year.toString());
          if (aHasYear && !bHasYear) return -1;
          if (!aHasYear && bHasYear) return 1;
          // Prefer files with date ranges (like countypres_2000-2024)
          const aHasRange = /\d{4}-\d{4}/.test(a);
          const bHasRange = /\d{4}-\d{4}/.test(b);
          if (aHasRange && !bHasRange) return -1;
          if (!aHasRange && bHasRange) return 1;
          return 0;
        });
        
        for (const countyFile of sortedFiles) {
          try {
            const filePath = path.join(dataverseFilesDir, countyFile);
            const fileContent = await fs.readFile(filePath, 'utf8');
            if (fileContent && fileContent.length > 0) {
              console.log(`✅ Found county-level VEST data file: ${countyFile}`);
              // Mark as county-level for processing
              return { content: fileContent, isCountyLevel: true };
            }
          } catch (error) {
            console.warn(`⚠️ Error reading county file ${countyFile}: ${error.message}`);
            continue;
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read - log but don't fail yet
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️ Error reading dataverse_files directory: ${error.message}`);
      }
    }
    
    throw new Error(
      `VEST data file not found for ${year}. ` +
      `Checked locations: ${possibleFiles.slice(0, 3).join(', ')}... ` +
      `Also checked dataverse_files directory for county-level files. ` +
      `Please ensure VEST data files (tract-level or county-level) are in data/vest/ or data/vest/dataverse_files/`
    );
  }

  /**
   * Process raw CSV/TAB data into normalized format
   */
  processVESTData(rawData, year) {
    const config = VEST_DATASETS[year];
    if (!config) {
      throw new Error(`VEST data not configured for year ${year}`);
    }

    try {
      // Detect delimiter (CSV uses comma, TAB uses tab)
      const isTabDelimited = rawData.includes('\t') && !rawData.split('\n')[0].includes(',');
      const delimiter = isTabDelimited ? '\t' : ',';
      
      console.log(`📊 Processing ${isTabDelimited ? 'TAB' : 'CSV'} delimited data for ${year}...`);
      
      // Parse CSV/TAB
      const records = parse(rawData, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: delimiter,
      });

      console.log(`📊 Processing ${records.length} VEST records for ${year}...`);

      // Process each record
      const processedData = {};
      let processedCount = 0;
      let missingGeoidCount = 0;
      let missingVoteDataCount = 0;

      for (const record of records) {
        // Extract GEOID (11-digit census tract FIPS)
        const geoid = record.GEOID || record.geoid || record.GEOID20 || record.GEOID10;
        
        if (!geoid) {
          missingGeoidCount++;
          continue;
        }

        // Normalize GEOID to 11 digits
        const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);

        // Extract and map vote columns
        const demPresKey = config.columnMappings['G' + year.toString().substring(2) + 'PREDBID'] || 
                          config.columnMappings['G' + year.toString().substring(2) + 'PREDCli'] || 
                          Object.keys(record).find(k => k.includes('PRED') && (k.includes('BID') || k.includes('Cli')));
        const repPresKey = config.columnMappings['G' + year.toString().substring(2) + 'PRERTRU'] || 
                          Object.keys(record).find(k => k.includes('PRER') && k.includes('TRU'));

        const votesDemPres = this.parseNumber(record[demPresKey] || record[`G${year.toString().substring(2)}PREDBID`] || record[`G${year.toString().substring(2)}PREDCli`] || 0);
        const votesRepPres = this.parseNumber(record[repPresKey] || record[`G${year.toString().substring(2)}PRERTRU`] || 0);

        // Calculate total presidential votes
        const totalPres = votesDemPres + votesRepPres;

        if (totalPres === 0) {
          missingVoteDataCount++;
          // Still include the tract with zero votes for coverage tracking
        }

        // Calculate percentages
        const pctDemPres = totalPres > 0 ? votesDemPres / totalPres : 0;
        const pctRepPres = totalPres > 0 ? votesRepPres / totalPres : 0;

        // Extract state and county FIPS from GEOID (first 2 digits = state, next 3 = county)
        const stateFips = normalizedGeoid.substring(0, 2);
        const countyFips = normalizedGeoid.substring(2, 5);

        // Store processed data indexed by GEOID
        processedData[normalizedGeoid] = {
          GEOID: normalizedGeoid,
          state_fips: stateFips,
          county_fips: countyFips,
          votes_dem_pres: votesDemPres,
          votes_rep_pres: votesRepPres,
          total_votes_pres: totalPres,
          pct_dem_pres: pctDemPres,
          pct_rep_pres: pctRepPres,
        };

        processedCount++;
      }

      console.log(`✅ Processed ${processedCount} tracts for ${year}`);
      if (missingGeoidCount > 0) {
        console.warn(`⚠️ Skipped ${missingGeoidCount} records missing GEOID`);
      }
      if (missingVoteDataCount > 0) {
        console.warn(`⚠️ Found ${missingVoteDataCount} tracts with zero presidential votes`);
      }

      return {
        data: processedData,
        metadata: {
          year,
          totalTracts: processedCount,
          missingGeoidCount,
          missingVoteDataCount,
          coverage: processedCount / records.length,
          processedAt: new Date().toISOString(),
        }
      };
    } catch (error) {
      console.error(`❌ Error processing VEST data for ${year}:`, error);
      throw error;
    }
  }

  /**
   * Parse number from string, handling commas and other formatting
   */
  parseNumber(value) {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    if (typeof value === 'number') {
      return value;
    }
    // Remove commas and other non-numeric characters except decimal point
    const cleaned = String(value).replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }

  /**
   * Load VEST data for a specific year
   * Tries cache first, then loads from file/API
   */
  async loadVESTData(year, forceRefresh = false) {
    if (this.loadingYears.has(year)) {
      throw new Error(`VEST data is already being loaded for year ${year}`);
    }

    // Check in-memory cache first
    if (!forceRefresh && this.dataCache.has(year)) {
      console.log(`✅ VEST data for ${year} found in memory cache`);
      return this.dataCache.get(year);
    }

    // Check persistent cache
    const cacheKey = this.getCacheKey(year);
    if (!forceRefresh) {
      try {
        // Try cloud storage first
        const cloudData = await cloudStorageCache.get(cacheKey);
        if (cloudData && cloudData.data) {
          console.log(`✅ VEST data for ${year} found in cloud storage cache`);
          this.dataCache.set(year, cloudData.data);
          return cloudData.data;
        }

        // Try local cache
        const localData = await localCache.getFromCache(cacheKey);
        if (localData) {
          console.log(`✅ VEST data for ${year} found in local cache`);
          this.dataCache.set(year, localData);
          return localData;
        }
      } catch (error) {
        console.warn(`⚠️ Error checking cache for ${year}:`, error.message);
      }
    }

    // Load and process data
    this.loadingYears.add(year);
    try {
      console.log(`📥 Loading VEST data for ${year}...`);

      // Try to load from local file first (for manual downloads)
      let rawData;
      let isCountyLevel = false;
      try {
        const fileResult = await this.loadFromLocalFile(year);
        if (typeof fileResult === 'object' && fileResult.isCountyLevel) {
          rawData = fileResult.content;
          isCountyLevel = true;
          console.log(`✅ Loaded county-level VEST data from local file for ${year}`);
        } else {
          rawData = fileResult;
          console.log(`✅ Loaded VEST data from local file for ${year}`);
        }
      } catch (error) {
        // If local file not found, try to download from Dataverse
        console.log(`⚠️ Local file not found, attempting download from Harvard Dataverse...`);
        try {
          rawData = await this.downloadVESTData(year);
          console.log(`✅ Successfully downloaded VEST data from Dataverse for ${year}`);
          
          // Save to local file for future use
          try {
            const fs = require('fs').promises;
            const path = require('path');
            await this.ensureDataDirectory();
            const filePath = path.join(__dirname, '..', '..', 'data', 'vest', `tract_${year}.csv`);
            await fs.writeFile(filePath, rawData, 'utf8');
            console.log(`💾 Saved downloaded data to ${filePath} for future use`);
          } catch (saveError) {
            console.warn(`⚠️ Could not save downloaded data to local file: ${saveError.message}`);
            // Continue anyway - we have the data in memory
          }
        } catch (downloadError) {
          throw new Error(`Could not load VEST data for ${year}. Local file error: ${error.message}. Download error: ${downloadError.message}`);
        }
      }

      // Process the data - check if it's county-level or tract-level
      let processed;
      if (isCountyLevel) {
        console.log(`🔄 Processing county-level data for ${year}...`);
        const countyData = await this.processCountyLevelData(rawData, year);
        // County-level data will be allocated to tracts on-demand using spatial intersection
        processed = {
          data: {}, // Will be populated when tracts are requested
          countyData: countyData.countyData,
          metadata: {
            ...countyData.metadata,
            dataType: 'county_level',
            allocationMethod: 'spatial_intersection',
            note: 'County-level data will be allocated to tracts on-demand using spatial intersection',
          }
        };
      } else {
        // Process as tract-level data
        processed = this.processVESTData(rawData, year);
      }

      // Cache the processed data
      this.dataCache.set(year, processed);

      // Store in persistent cache (use cloud storage for large files)
      const dataSize = JSON.stringify(processed).length;
      if (dataSize > 1024 * 1024) {
        // Large file - use cloud storage
        await cloudStorageCache.set(cacheKey, processed, {
          year,
          type: 'vest_tract_data',
          source: 'harvard_dataverse',
        });
      } else {
        // Small file - use local cache
        await localCache.setCache(cacheKey, processed, null); // No expiration for VEST data
      }

      console.log(`✅ Successfully loaded and cached VEST data for ${year}`);
      return processed;

    } catch (error) {
      console.error(`❌ Error loading VEST data for ${year}:`, error.message);
      throw error;
    } finally {
      this.loadingYears.delete(year);
    }
  }

  /**
   * Load county boundaries for a state from Census TIGER
   */
  async loadCountyBoundaries(state, apiBaseUrl = null) {
    const axios = require('axios');
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
    const serviceUrl = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties/FeatureServer/0/query';

    const params = new URLSearchParams({
      where: `STATE_FIPS='${stateFips}'`,
      outFields: 'STATE_FIPS,COUNTY_FIPS,COUNTY_NAME,GEOID',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: '5000'
    });

    try {
      console.log(`>>> EXTERNAL FETCH | ArcGIS | county boundaries for state (VEST) | state=${state}`);
      const response = await axios.get(`${serviceUrl}?${params.toString()}`, {
        timeout: 60000,
      });

      return {
        type: 'FeatureCollection',
        features: response.data.features || []
      };
    } catch (error) {
      console.error(`Error loading county boundaries for ${state}:`, error.message);
      throw new Error(`Failed to load county boundaries: ${error.message}`);
    }
  }

  /**
   * Allocate county votes to a specific tract using spatial intersection
   * For tracts fully enclosed in a county: use county data directly
   * For tracts spanning multiple counties: calculate weighted average based on intersection area
   */
  async allocateCountyVotesToTract(geoid, year, vestData, tractFeature = null, apiBaseUrl = null) {
    if (!vestData.countyData) {
      // Not county-level data, return null to use direct lookup
      return null;
    }

    const turf = require('@turf/turf');
    const spatialAnalyzer = require('./spatial-analyzer');

    const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
    const stateFips = normalizedGeoid.substring(0, 2);
    const countyFips = normalizedGeoid.substring(2, 5);
    const countyFips5 = stateFips + countyFips;

    // Get state code from FIPS
    const stateFipsMap = {
      '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
      '08': 'CO', '09': 'CT', '10': 'DE', '12': 'FL', '13': 'GA',
      '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
      '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
      '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO',
      '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
      '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
      '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC',
      '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT',
      '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
      '11': 'DC'
    };
    const stateCode = stateFipsMap[stateFips] || stateFips;

    // Load tract feature if not provided
    let tractGeometry = tractFeature;
    if (!tractGeometry) {
      try {
        const tractBoundaries = await spatialAnalyzer.loadTractBoundaries(stateCode, apiBaseUrl);
        const tract = tractBoundaries.features.find(f => {
          const tractGeoid = spatialAnalyzer.getTractGeoid(f);
          return tractGeoid === normalizedGeoid;
        });
        if (tract) {
          tractGeometry = tract;
        } else {
          // Tract not found - use simple county assignment
          const countyVotes = vestData.countyData[countyFips5];
          if (countyVotes) {
            return {
              GEOID: normalizedGeoid,
              state_fips: stateFips,
              county_fips: countyFips,
              votes_dem_pres: countyVotes.votes_dem_pres,
              votes_rep_pres: countyVotes.votes_rep_pres,
              total_votes_pres: countyVotes.total_votes_pres,
              pct_dem_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_dem_pres / countyVotes.total_votes_pres : 0,
              pct_rep_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_rep_pres / countyVotes.total_votes_pres : 0,
              allocationMethod: 'county_fallback',
            };
          }
          return null;
        }
      } catch (error) {
        console.warn(`⚠️ Could not load tract geometry for ${geoid}: ${error.message}, using county fallback`);
        const countyVotes = vestData.countyData[countyFips5];
        if (countyVotes) {
          return {
            GEOID: normalizedGeoid,
            state_fips: stateFips,
            county_fips: countyFips,
            votes_dem_pres: countyVotes.votes_dem_pres,
            votes_rep_pres: countyVotes.votes_rep_pres,
            total_votes_pres: countyVotes.total_votes_pres,
            pct_dem_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_dem_pres / countyVotes.total_votes_pres : 0,
            pct_rep_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_rep_pres / countyVotes.total_votes_pres : 0,
            allocationMethod: 'county_fallback',
          };
        }
        return null;
      }
    }

    // Convert tract to GeoJSON feature if needed
    let tractFeatureGeoJson;
    if (tractGeometry.geometry) {
      tractFeatureGeoJson = tractGeometry;
    } else if (tractGeometry.type === 'Feature') {
      tractFeatureGeoJson = tractGeometry;
    } else {
      tractFeatureGeoJson = turf.feature(tractGeometry);
    }

    // Load county boundaries
    let countyBoundaries;
    try {
      countyBoundaries = await this.loadCountyBoundaries(stateCode, apiBaseUrl);
    } catch (error) {
      console.warn(`⚠️ Could not load county boundaries: ${error.message}, using county fallback`);
      const countyVotes = vestData.countyData[countyFips5];
      if (countyVotes) {
        return {
          GEOID: normalizedGeoid,
          state_fips: stateFips,
          county_fips: countyFips,
          votes_dem_pres: countyVotes.votes_dem_pres,
          votes_rep_pres: countyVotes.votes_rep_pres,
          total_votes_pres: countyVotes.total_votes_pres,
          pct_dem_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_dem_pres / countyVotes.total_votes_pres : 0,
          pct_rep_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_rep_pres / countyVotes.total_votes_pres : 0,
          allocationMethod: 'county_fallback',
        };
      }
      return null;
    }

    // Find intersecting counties and calculate intersection areas
    const tractArea = turf.area(tractFeatureGeoJson); // Area in square meters
    const countyIntersections = [];

    for (const countyFeature of countyBoundaries.features) {
      try {
        // Check if tract intersects with county
        if (turf.intersect(tractFeatureGeoJson, countyFeature)) {
          const intersection = turf.intersect(tractFeatureGeoJson, countyFeature);
          if (intersection) {
            const intersectionArea = turf.area(intersection);
            const intersectionRatio = tractArea > 0 ? intersectionArea / tractArea : 0;

            // Get county FIPS
            const countyFipsFromFeature = countyFeature.properties?.COUNTY_FIPS || 
                                         countyFeature.properties?.county_fips ||
                                         countyFeature.properties?.GEOID?.substring(2, 5);
            
            if (countyFipsFromFeature) {
              const stateFipsFromFeature = countyFeature.properties?.STATE_FIPS || 
                                          countyFeature.properties?.state_fips ||
                                          countyFeature.properties?.GEOID?.substring(0, 2);
              const countyFips5FromFeature = String(stateFipsFromFeature).padStart(2, '0') + 
                                             String(countyFipsFromFeature).padStart(3, '0');

              countyIntersections.push({
                countyFips5: countyFips5FromFeature,
                intersectionArea,
                intersectionRatio,
                countyFeature,
              });
            }
          }
        }
      } catch (error) {
        // Skip counties that cause errors
        continue;
      }
    }

    if (countyIntersections.length === 0) {
      // No intersections found - use primary county as fallback
      const countyVotes = vestData.countyData[countyFips5];
      if (countyVotes) {
        return {
          GEOID: normalizedGeoid,
          state_fips: stateFips,
          county_fips: countyFips,
          votes_dem_pres: countyVotes.votes_dem_pres,
          votes_rep_pres: countyVotes.votes_rep_pres,
          total_votes_pres: countyVotes.total_votes_pres,
          pct_dem_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_dem_pres / countyVotes.total_votes_pres : 0,
          pct_rep_pres: countyVotes.total_votes_pres > 0 ? countyVotes.votes_rep_pres / countyVotes.total_votes_pres : 0,
          allocationMethod: 'county_fallback_no_intersection',
        };
      }
      return null;
    }

    // Normalize intersection ratios (should sum to 1.0)
    const totalRatio = countyIntersections.reduce((sum, ci) => sum + ci.intersectionRatio, 0);
    if (totalRatio > 0) {
      countyIntersections.forEach(ci => {
        ci.intersectionRatio = ci.intersectionRatio / totalRatio;
      });
    }

    // Allocate votes based on intersection ratios
    let totalDemVotes = 0;
    let totalRepVotes = 0;
    let totalVotes = 0;
    const allocationDetails = [];

    for (const intersection of countyIntersections) {
      const countyVotes = vestData.countyData[intersection.countyFips5];
      if (countyVotes) {
        const demVotes = countyVotes.votes_dem_pres * intersection.intersectionRatio;
        const repVotes = countyVotes.votes_rep_pres * intersection.intersectionRatio;
        const countyTotalVotes = countyVotes.total_votes_pres * intersection.intersectionRatio;

        totalDemVotes += demVotes;
        totalRepVotes += repVotes;
        totalVotes += countyTotalVotes;

        allocationDetails.push({
          countyFips5: intersection.countyFips5,
          ratio: intersection.intersectionRatio,
          demVotes: demVotes,
          repVotes: repVotes,
        });
      }
    }

    const pctDem = totalVotes > 0 ? totalDemVotes / totalVotes : 0;
    const pctRep = totalVotes > 0 ? totalRepVotes / totalVotes : 0;

    return {
      GEOID: normalizedGeoid,
      state_fips: stateFips,
      county_fips: countyFips,
      votes_dem_pres: Math.round(totalDemVotes),
      votes_rep_pres: Math.round(totalRepVotes),
      total_votes_pres: Math.round(totalVotes),
      pct_dem_pres: parseFloat(pctDem.toFixed(6)),
      pct_rep_pres: parseFloat(pctRep.toFixed(6)),
      allocationMethod: countyIntersections.length === 1 ? 'fully_enclosed' : 'weighted_average',
      allocationDetails: countyIntersections.length > 1 ? allocationDetails : undefined,
      intersectingCounties: countyIntersections.length,
    };
  }

  /**
   * Get VEST data for specific tracts by GEOID
   * Handles both tract-level and county-level data (with on-demand allocation)
   */
  async getTractData(geoids, year = 2020, apiBaseUrl = null) {
    const vestData = await this.loadVESTData(year);
    const results = {};

    // Check if we have direct tract-level data
    if (vestData.data && Object.keys(vestData.data).length > 0) {
      // Direct tract-level data
      for (const geoid of geoids) {
        const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
        if (vestData.data[normalizedGeoid]) {
          results[normalizedGeoid] = vestData.data[normalizedGeoid];
        }
      }
    } else if (vestData.countyData) {
      // County-level data - allocate on-demand using spatial intersection
      console.log(`🔄 Allocating county votes to ${geoids.length} tracts using spatial intersection...`);
      
      // Load tract boundaries once for all tracts (more efficient)
      const stateFips = String(geoids[0]).padStart(11, '0').substring(0, 2);
      const stateFipsMap = {
        '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
        '08': 'CO', '09': 'CT', '10': 'DE', '12': 'FL', '13': 'GA',
        '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
        '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
        '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO',
        '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
        '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
        '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC',
        '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT',
        '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
        '11': 'DC'
      };
      const stateCode = stateFipsMap[stateFips] || stateFips;
      
      const spatialAnalyzer = require('./spatial-analyzer');
      let tractBoundaries = null;
      try {
        tractBoundaries = await spatialAnalyzer.loadTractBoundaries(stateCode, apiBaseUrl);
      } catch (error) {
        console.warn(`⚠️ Could not load tract boundaries: ${error.message}`);
      }

      // Allocate votes for each tract
      for (const geoid of geoids) {
        const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
        
        // Find tract feature if boundaries are loaded
        let tractFeature = null;
        if (tractBoundaries) {
          tractFeature = tractBoundaries.features.find(f => {
            const tractGeoid = spatialAnalyzer.getTractGeoid(f);
            return tractGeoid === normalizedGeoid;
          });
        }

        const allocated = await this.allocateCountyVotesToTract(normalizedGeoid, year, vestData, tractFeature, apiBaseUrl);
        if (allocated) {
          results[normalizedGeoid] = allocated;
        }
      }
    }

    return results;
  }

  /**
   * Build tract-level party data from county-level VEST data by allocating county
   * votes to tracts (spatial intersection or county fallback). Use when loadVESTData
   * returns countyData but empty data (e.g. countypres file only).
   * @param {number} year - VEST year (e.g. 2020)
   * @param {string|null} apiBaseUrl - Backend base URL for tract boundaries (optional)
   * @returns {Promise<{ data: object, countyData?: object, metadata: object }>}
   */
  async buildTractDataFromCountyVEST(year, apiBaseUrl = null) {
    const vestData = await this.loadVESTData(year);
    if (vestData.data && Object.keys(vestData.data).length > 0) {
      return vestData;
    }
    if (!vestData.countyData || Object.keys(vestData.countyData).length === 0) {
      return vestData;
    }
    const stateFipsMap = {
      '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
      '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA',
      '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
      '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
      '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO',
      '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
      '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
      '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC',
      '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT',
      '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY'
    };
    const stateFipsInCountyData = new Set();
    for (const c of Object.values(vestData.countyData)) {
      if (c.stateFips) stateFipsInCountyData.add(String(c.stateFips).padStart(2, '0'));
    }
    const spatialAnalyzer = require('./spatial-analyzer');
    const data = {};
    let totalTracts = 0;
    for (const stateFips of stateFipsInCountyData) {
      const stateCode = stateFipsMap[stateFips];
      if (!stateCode) continue;
      try {
        const boundaries = await spatialAnalyzer.loadTractBoundaries(stateCode, apiBaseUrl);
        const geoids = (boundaries.features || []).map(f => spatialAnalyzer.getTractGeoid(f)).filter(Boolean);
        if (geoids.length === 0) continue;
        const tractResults = await this.getTractData(geoids, year, apiBaseUrl);
        for (const [geoid, row] of Object.entries(tractResults)) {
          data[geoid] = row;
          totalTracts++;
        }
        console.log(`✅ County→tract allocation: ${stateCode} ${geoids.length} tracts`);
      } catch (err) {
        console.warn(`⚠️ Skipped ${stateCode}: ${err.message}`);
      }
    }
    return {
      data,
      countyData: vestData.countyData,
      metadata: {
        year,
        totalTracts,
        dataType: 'county_allocated',
        processedAt: new Date().toISOString(),
      }
    };
  }

  /**
   * Get status of VEST data availability
   */
  async getStatus() {
    const status = {
      availableYears: [],
      lastUpdated: null,
      metadata: {},
    };

    for (const year of [2016, 2020, 2024]) {
      try {
        const cacheKey = this.getCacheKey(year);
        
        // Check if data exists in cache
        const cloudData = await cloudStorageCache.get(cacheKey);
        const localData = cloudData ? null : await localCache.getFromCache(cacheKey);
        
        if (cloudData || localData) {
          status.availableYears.push(year);
          const data = cloudData?.data || localData;
          if (data?.metadata?.processedAt) {
            const processedAt = new Date(data.metadata.processedAt);
            if (!status.lastUpdated || processedAt > status.lastUpdated) {
              status.lastUpdated = processedAt;
            }
          }
          status.metadata[year] = data?.metadata || {};
        }
      } catch (error) {
        // Year not available
        console.warn(`VEST data for ${year} not available:`, error.message);
      }
    }

    return status;
  }

  /**
   * Check if a year is currently being loaded
   */
  isLoading(year) {
    return this.loadingYears.has(year);
  }
}

// Export singleton instance
module.exports = new VESTDataLoader();

