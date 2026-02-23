/**
 * VEST Bulk Persistence Service
 * Downloads all VEST data for a year and persists it for all states.
 * When USE_LOCAL_CACHE, writes to local file cache only.
 */

const vestDataDownloader = require('./vest-data-downloader');
const vestDataLoader = require('./vest-data-loader');
const tractPartyPersistence = require('./tract-party-persistence');
const localCache = require('../local-cache');
const cloudStorageCache = require('./cloud-storage-cache');
const { Firestore } = require('@google-cloud/firestore');

const USE_LOCAL_CACHE = process.env.NODE_ENV !== 'production' || process.env.USE_LOCAL_CACHE === 'true';
let _firestore = null;
function getFirestore() {
  if (!_firestore) _firestore = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts' });
  return _firestore;
}

const { STATE_FIPS_TO_CODE } = tractPartyPersistence;

class VESTBulkPersistence {

  /**
   * Download all VEST data for a year and persist tract party data for all states
   * @param {number} year - Election year (default: 2020)
   * @param {Object} options - Optional configuration
   * @returns {Promise<Object>} - Results summary
   */
  async downloadAndPersistAll(year = 2020, options = {}) {
    const results = {
      year,
      statesProcessed: [],
      statesFailed: [],
      statesSkipped: [],
      totalTracts: 0,
      totalSize: 0,
      startTime: new Date(),
      endTime: null,
      downloadResults: null,
      error: null,
      dryRun: options.dryRun || false
    };

    try {
      console.log(`🚀 Starting VEST ${year} bulk download and persistence...`);
      if (results.dryRun) {
        console.log(`🔍 DRY RUN MODE - No actual downloads or data persistence will occur`);
      }
      console.log(`⏰ Start time: ${results.startTime.toISOString()}`);

      // Phase 1: Download all tract files
      console.log(`\n📥 Phase 1: Downloading tract files...`);
      if (results.dryRun) {
        // Simulate download results for dry run
        results.downloadResults = {
          downloaded: [
            { state: 'CA', filename: 'CA_tract_2020.csv', fileId: 'simulated', size: 5242880 },
            { state: 'TX', filename: 'TX_tract_2020.csv', fileId: 'simulated', size: 3145728 },
            { state: 'FL', filename: 'FL_tract_2020.csv', fileId: 'simulated', size: 2097152 },
            { state: 'NY', filename: 'NY_tract_2020.csv', fileId: 'simulated', size: 1572864 },
            { state: 'PA', filename: 'PA_tract_2020.csv', fileId: 'simulated', size: 1048576 }
          ],
          failed: [],
          skipped: []
        };
        console.log(`🔍 DRY RUN: Simulated download of ${results.downloadResults.downloaded.length} files`);
      } else {
        results.downloadResults = await vestDataDownloader.downloadAllTractFilesForYear(year);
      }

      if (results.downloadResults.downloaded.length === 0) {
        throw new Error('No tract files were successfully downloaded');
      }

      // Phase 2: Process and persist data for each state
      console.log(`\n💾 Phase 2: Processing and persisting data...`);

      const processedStates = new Set();

      for (const download of results.downloadResults.downloaded) {
        try {
          const state = download.state;

          if (!state) {
            console.warn(`⚠️ Skipping file ${download.filename} - no state identified`);
            results.statesSkipped.push({
              filename: download.filename,
              reason: 'No state identified'
            });
            continue;
          }

          if (processedStates.has(state)) {
            console.log(`⏭️ Skipping ${download.filename} - already processed ${state}`);
            continue;
          }

          console.log(`\n🏛️ Processing ${state} (${download.filename})...`);

          // Load VEST data for this specific state
          let vestData, tractCount, dataSize;

          if (results.dryRun) {
            // Simulate data loading and persistence
            tractCount = Math.floor(Math.random() * 5000) + 1000; // Simulate 1000-6000 tracts
            dataSize = tractCount * 150; // Rough estimate of 150 bytes per tract record
            console.log(`🔍 DRY RUN: Simulated loading ${tractCount} tracts for ${state}`);
          } else {
            vestData = await this.loadVESTDataForState(year, state);

            if (!vestData?.data || Object.keys(vestData.data).length === 0) {
              console.warn(`⚠️ No tract data found for ${state}, trying county allocation...`);

              // Try county-to-tract allocation if available
              const allocatedData = await this.tryCountyAllocation(year, state, options);
              if (allocatedData) {
                await this.persistStateData(state, year, allocatedData);
                tractCount = Object.keys(allocatedData.data).length;
                results.statesProcessed.push({
                  state,
                  tracts: tractCount,
                  method: 'county_allocation',
                  filename: download.filename
                });
                results.totalTracts += tractCount;
                processedStates.add(state);
                console.log(`✅ ${state}: ${tractCount} tracts allocated and persisted`);
              } else {
                results.statesFailed.push({
                  state,
                  error: 'No tract or county data available',
                  filename: download.filename
                });
              }
              continue;
            }

            // Persist the tract data
            tractCount = await this.persistStateData(state, year, vestData);
            dataSize = this.calculateDataSize(vestData.data);
          }

          results.statesProcessed.push({
            state,
            tracts: tractCount,
            method: 'tract_direct',
            filename: download.filename,
            size: dataSize
          });

          results.totalTracts += tractCount;
          results.totalSize += dataSize;
          processedStates.add(state);

          console.log(`✅ ${state}: ${tractCount} tracts persisted (${this.formatBytes(dataSize)})`);

        } catch (error) {
          console.error(`❌ Failed to process ${download.filename}:`, error.message);
          results.statesFailed.push({
            filename: download.filename,
            state: download.state,
            error: error.message
          });
        }
      }

      // Check for missing states
      const expectedStates = new Set(Object.values(STATE_FIPS_TO_CODE));
      const processedStateCodes = new Set(results.statesProcessed.map(r => r.state));
      const missingStates = [...expectedStates].filter(s => !processedStateCodes.has(s));

      if (missingStates.length > 0) {
        console.log(`\n⚠️ Missing states: ${missingStates.join(', ')}`);
        for (const state of missingStates) {
          results.statesSkipped.push({
            state,
            reason: 'No data file found'
          });
        }
      }

      results.endTime = new Date();
      const duration = (results.endTime - results.startTime) / 1000;

      console.log(`\n🎉 Bulk persistence complete!`);
      console.log(`📊 Final Results:`);
      console.log(`   • States processed: ${results.statesProcessed.length}`);
      console.log(`   • Total tracts: ${results.totalTracts.toLocaleString()}`);
      console.log(`   • Total data size: ${this.formatBytes(results.totalSize)}`);
      console.log(`   • Duration: ${duration.toFixed(1)}s`);
      console.log(`   • Failed states: ${results.statesFailed.length}`);
      console.log(`   • Skipped states: ${results.statesSkipped.length}`);

      return results;

    } catch (error) {
      console.error('❌ Bulk persistence failed:', error.message);
      results.endTime = new Date();
      results.error = error.message;
      return results;
    }
  }

  /**
   * Load VEST data for a specific state
   * @param {number} year - Election year
   * @param {string} state - State code
   * @returns {Promise<Object>} - VEST data for the state
   */
  async loadVESTDataForState(year, state) {
    // This would ideally filter the data loading to only the specific state
    // For now, we'll load all data and filter it
    const allData = await vestDataLoader.loadVESTData(year);

    if (!allData?.data) return null;

    // Filter data for the specific state
    const stateFips = Object.keys(STATE_FIPS_TO_CODE).find(
      fips => STATE_FIPS_TO_CODE[fips] === state
    );

    if (!stateFips) return null;

    const stateData = {};
    for (const [geoid, row] of Object.entries(allData.data)) {
      const geoidFips = geoid.substring(0, 2);
      if (geoidFips === stateFips) {
        stateData[geoid] = row;
      }
    }

    return {
      data: stateData,
      metadata: allData.metadata
    };
  }

  /**
   * Try county-to-tract allocation for states without tract data
   * @param {number} year - Election year
   * @param {string} state - State code
   * @param {Object} options - Options including API base URL
   * @returns {Promise<Object|null>} - Allocated data or null
   */
  async tryCountyAllocation(year, state, options) {
    try {
      const allocatedData = await vestDataLoader.buildTractDataFromCountyVEST(year, options.apiBaseUrl);

      if (!allocatedData?.data || Object.keys(allocatedData.data).length === 0) {
        return null;
      }

      // Filter for the specific state
      const stateFips = Object.keys(STATE_FIPS_TO_CODE).find(
        fips => STATE_FIPS_TO_CODE[fips] === state
      );

      if (!stateFips) return null;

      const stateData = {};
      for (const [geoid, row] of Object.entries(allocatedData.data)) {
        const geoidFips = geoid.substring(0, 2);
        if (geoidFips === stateFips) {
          stateData[geoid] = row;
        }
      }

      return Object.keys(stateData).length > 0 ? { data: stateData, metadata: allocatedData.metadata } : null;

    } catch (error) {
      console.warn(`County allocation failed for ${state}:`, error.message);
      return null;
    }
  }

  /**
   * Persist tract party data for a single state
   * @param {string} state - State code
   * @param {number} year - Election year
   * @param {Object} vestData - VEST data object with data property
   * @returns {Promise<number>} - Number of tracts persisted
   */
  async persistStateData(state, year, vestData) {
    if (!vestData?.data) {
      throw new Error('No data to persist');
    }

    // Group data by state (should already be filtered)
    const byState = {};
    const stateFips = Object.keys(STATE_FIPS_TO_CODE).find(
      fips => STATE_FIPS_TO_CODE[fips] === state
    );

    if (!stateFips) {
      throw new Error(`Invalid state code: ${state}`);
    }

    byState[state] = {};

    for (const [geoid, row] of Object.entries(vestData.data)) {
      const geoidFips = geoid.substring(0, 2);
      if (geoidFips === stateFips) {
        const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
        byState[state][normalizedGeoid] = {
          pctDem: row.pct_dem_pres ?? 0,
          pctRep: row.pct_rep_pres ?? 0,
          votesDem: row.votes_dem_pres ?? 0,
          votesRep: row.votes_rep_pres ?? 0,
          totalVotes: row.total_votes_pres ?? 0
        };
      }
    }

    const tractCount = Object.keys(byState[state]).length;
    if (tractCount === 0) {
      throw new Error('No tracts found for state');
    }

    const payload = {
      geoids: byState[state],
      year,
      state,
      tractCount,
      timestamp: Date.now()
    };

    const key = `tract_party_${state}_${year}`;

    if (USE_LOCAL_CACHE) {
      await localCache.setCache(key, payload, null);
      return tractCount;
    }

    const db = getFirestore();
    const jsonSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    if (jsonSize >= tractPartyPersistence.FIRESTORE_DOC_SIZE_LIMIT) {
      const path = await cloudStorageCache.set(key, payload, {
        state,
        year: String(year),
        tractCount: String(tractCount)
      });
      await db.collection('census_cache').doc(key).set({
        cloudStoragePath: path,
        cloudStorage: true,
        timestamp: Date.now(),
        ttl: null,
        version: tractPartyPersistence.CACHE_VERSION,
        source: 'vest-bulk-persistence',
        state,
        year,
        tractCount,
        size: jsonSize
      });
    } else {
      await db.collection('census_cache').doc(key).set({
        geoids: byState[state],
        year,
        state,
        tractCount,
        timestamp: Date.now(),
        ttl: null,
        version: tractPartyPersistence.CACHE_VERSION,
        source: 'vest-bulk-persistence'
      });
    }

    return tractCount;
  }

  /**
   * Calculate approximate data size
   * @param {Object} data - Data object
   * @returns {number} - Size in bytes
   */
  calculateDataSize(data) {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  /**
   * Format bytes for display
   * @param {number} bytes - Number of bytes
   * @returns {string} - Formatted size string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new VESTBulkPersistence();