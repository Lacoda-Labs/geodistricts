/**
 * Tract-level party percentage persistence: load VEST data by state,
 * write to Firestore (and Cloud Storage for large payloads), and read back.
 * When USE_LOCAL_CACHE, uses local file cache only.
 * Used by index.js routes and by vest-party.test.js.
 */

const { Firestore } = require('@google-cloud/firestore');
const cloudStorageCache = require('./cloud-storage-cache');
const localCache = require('../local-cache');
const vestDataLoader = require('./vest-data-loader');

const USE_LOCAL_CACHE = process.env.NODE_ENV !== 'production' || process.env.USE_LOCAL_CACHE === 'true';

const CACHE_VERSION = '1.0';
const FIRESTORE_DOC_SIZE_LIMIT = 1024 * 1024; // 1 MiB

let firestore = null;

function getFirestore() {
  if (!firestore) {
    firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
    });
  }
  return firestore;
}

/** State FIPS (2-digit) to state code for grouping VEST tract data by state. 50 states + DC = 51. */
const STATE_FIPS_TO_CODE = {
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

/**
 * Load tract-level party data for a state and year from Firestore/Cloud Storage.
 * @param {string} state - State code (e.g. 'CA')
 * @param {number} year - VEST year (e.g. 2020)
 * @returns {Promise<{ [geoid: string]: { pctDem: number, pctRep: number, pctOther: number } } | null>}
 */
async function loadTractPartyForState(state, year) {
  const key = `tract_party_${state.toUpperCase()}_${year}`;
  try {
    console.log('🔍 loadTractPartyForState:', key);
    console.log('🔍 USE_LOCAL_CACHE:', USE_LOCAL_CACHE);
    if (USE_LOCAL_CACHE) {
      const data = await localCache.getFromCache(key);
      if (!data) return null;
      if (data.geoids && typeof data.geoids === 'object') return data.geoids;
      if (data.data && typeof data.data === 'object' && data.data.geoids) return data.data.geoids;
      return null;
    }
    const db = getFirestore();
    const doc = await db.collection('census_cache').doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.cloudStoragePath && data.cloudStorage) {
      const cloud = await cloudStorageCache.get(key);
      if (cloud && cloud.data && cloud.data.geoids) return cloud.data.geoids;
      return null;
    }
    if (data.geoids && typeof data.geoids === 'object') return data.geoids;
    if (data.data && typeof data.data === 'object' && data.data.geoids) return data.data.geoids;
    return null;
  } catch (err) {
    console.warn(`⚠️ loadTractPartyForState(${state}, ${year}): ${err.message}`);
    return null;
  }
}

/**
 * Run tract-level party percentage persistence job: load VEST tract data for year,
 * group by state, write to Firestore (and Cloud Storage for large states).
 * When only county-level VEST data is available, builds tract-level data via
 * county→tract allocation (vest-data-loader.buildTractDataFromCountyVEST).
 *
 * Tract party is computed once per (state, year) and persisted per tract. Re-run this job
 * when VEST data is refreshed or when the election year changes. District group party at
 * any step is then derived by population-weighted aggregation of these tract percentages.
 *
 * @param {number} year - VEST year (e.g. 2020)
 * @param {{ apiBaseUrl?: string, state?: string }} options - Optional. apiBaseUrl for tract boundaries; state to run for one state only (e.g. 'RI').
 * @returns {Promise<{ statesWritten: string[], statesSkipped: string[], error?: string }>}
 */
async function runTractPartyPersistenceJob(year, options = {}) {
  const statesWritten = [];
  const statesSkipped = [];
  const { apiBaseUrl, state: stateFilter } = options;
  const stateCodeFilter = stateFilter ? String(stateFilter).toUpperCase() : null;
  try {
    console.log('🔍 runTractPartyPersistenceJob:', year, stateCodeFilter ? `(state: ${stateCodeFilter})` : '');
    let vestData = await vestDataLoader.loadVESTData(year);
    if (!vestData.data || typeof vestData.data !== 'object' || Object.keys(vestData.data).length === 0) {
      if (vestData.countyData && Object.keys(vestData.countyData).length > 0) {
        console.log('📊 Building tract-level party data from county VEST data...');
        vestData = await vestDataLoader.buildTractDataFromCountyVEST(year, apiBaseUrl, stateCodeFilter ? { stateCode: stateCodeFilter } : {});
      }
      if (!vestData.data || Object.keys(vestData.data).length === 0) {
        return { statesWritten: [], statesSkipped: [], error: 'VEST tract-level data not available for this year. Use tract-level CSV or county-level file (countypres) with tract boundaries.' };
      }
    }
    const byState = {};
    for (const [geoid, row] of Object.entries(vestData.data)) {
      const stateFips = (row.state_fips || String(geoid).substring(0, 2)).padStart(2, '0');
      const stateCode = STATE_FIPS_TO_CODE[stateFips];
      if (!stateCode) continue;
      if (stateCodeFilter && stateCode !== stateCodeFilter) continue;
      if (!byState[stateCode]) byState[stateCode] = {};
      const normalizedGeoid = String(geoid).padStart(11, '0').substring(0, 11);
      const pctDemValue = Number(row.pct_dem_pres);
      const pctRepValue = Number(row.pct_rep_pres);
      const pctOtherValue = Number(row.pct_other_pres);
      const pctDem = Number.isFinite(pctDemValue) ? pctDemValue : 0;
      const pctRep = Number.isFinite(pctRepValue) ? pctRepValue : 0;
      const pctOtherRaw = Number.isFinite(pctOtherValue)
        ? pctOtherValue
        : Math.max(0, 1 - pctDem - pctRep);
      const pctOther = Math.max(0, Math.min(1, pctOtherRaw));
      byState[stateCode][normalizedGeoid] = {
        pctDem,
        pctRep,
        pctOther
      };
    }
    if (USE_LOCAL_CACHE) {
      for (const [stateCode, geoids] of Object.entries(byState)) {
        const tractCount = Object.keys(geoids).length;
        if (tractCount === 0) { statesSkipped.push(stateCode); continue; }
        const payload = { geoids, year, state: stateCode, tractCount, timestamp: Date.now() };
        const key = `tract_party_${stateCode}_${year}`;
        try {
          await localCache.setCache(key, payload, null);
          statesWritten.push(stateCode);
          console.log(`💾 Tract party: wrote ${stateCode} ${year} (${tractCount} tracts) to local cache`);
          try {
            await cloudStorageCache.set(key, payload, { state: stateCode, year: String(year), tractCount: String(tractCount) });
            console.log(`💾 Tract party: also wrote ${stateCode} ${year} to cloud storage`);
          } catch (cloudErr) {
            console.warn(`⚠️ Tract party: cloud write skipped for ${stateCode} ${year}:`, cloudErr.message);
          }
        } catch (writeErr) {
          console.error(`❌ Tract party write failed for ${stateCode}:`, writeErr.message);
          statesSkipped.push(stateCode);
        }
      }
    } else {
      const db = getFirestore();
      for (const [stateCode, geoids] of Object.entries(byState)) {
        const tractCount = Object.keys(geoids).length;
        if (tractCount === 0) { statesSkipped.push(stateCode); continue; }
        const payload = { geoids, year, state: stateCode, tractCount, timestamp: Date.now() };
        const key = `tract_party_${stateCode}_${year}`;
        const jsonSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        try {
          if (jsonSize >= FIRESTORE_DOC_SIZE_LIMIT) {
            const path = await cloudStorageCache.set(key, payload, { state: stateCode, year: String(year), tractCount: String(tractCount) });
            await db.collection('census_cache').doc(key).set({
              cloudStoragePath: path,
              cloudStorage: true,
              timestamp: Date.now(),
              ttl: null,
              version: CACHE_VERSION,
              source: 'vest-tract-party-persistence',
              state: stateCode,
              year,
              tractCount,
              size: jsonSize
            });
          } else {
            await db.collection('census_cache').doc(key).set({
              geoids,
              year,
              state: stateCode,
              tractCount,
              timestamp: Date.now(),
              ttl: null,
              version: CACHE_VERSION,
              source: 'vest-tract-party-persistence'
            });
          }
          statesWritten.push(stateCode);
          console.log(`💾 Tract party: wrote ${stateCode} ${year} (${tractCount} tracts)`);
        } catch (writeErr) {
          console.error(`❌ Tract party write failed for ${stateCode}:`, writeErr.message);
          statesSkipped.push(stateCode);
        }
      }
    }
    return { statesWritten, statesSkipped };
  } catch (err) {
    console.error('❌ runTractPartyPersistenceJob:', err.message);
    return { statesWritten, statesSkipped, error: err.message };
  }
}

module.exports = {
  STATE_FIPS_TO_CODE,
  loadTractPartyForState,
  runTractPartyPersistenceJob
};
