/**
 * VEST party unit tests: (1) VEST data for all 50 states + DC, (2) party percentages
 * for first 10 tracts per state, (3) party data persisted to Firestore/GCS, (4) query
 * party data for a given tract.
 * Run with: node backend/services/vest-party.test.js
 * Optional: RUN_VEST_STORAGE_TEST=1 to run Test 3 (requires GCP/Firestore).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const vestDataLoader = require('./vest-data-loader');
const tractPartyPersistence = require('./tract-party-persistence');

const { STATE_FIPS_TO_CODE } = tractPartyPersistence;
const VEST_YEAR = 2020;
const EXPECTED_STATE_CODES = new Set(Object.values(STATE_FIPS_TO_CODE)); // 51 states + DC

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function assert(condition, msg) {
  if (!condition) {
    fail(msg);
    return false;
  }
  return true;
}

async function runTests() {
  console.log('VEST Party Unit Tests (year=%s)\n', VEST_YEAR);

  // Load VEST data once for Tests 1, 2, 4 (VEST-only)
  let vestData;
  try {
    vestData = await vestDataLoader.loadVESTData(VEST_YEAR);
  } catch (err) {
    fail(`VEST data not loadable: ${err.message}. Ensure data is in backend/data/vest/ or cached.`);
    return;
  }

  if (!vestData.data || typeof vestData.data !== 'object' || Object.keys(vestData.data).length === 0) {
    fail('VEST tract-level data is empty. Use tract-level CSV for ' + VEST_YEAR + '.');
    return;
  }

  // --- Test 1: VEST data available for all 50 states + DC
  const stateCodesInData = new Set();
  for (const [geoid, row] of Object.entries(vestData.data)) {
    const stateFips = (row.state_fips || String(geoid).substring(0, 2)).padStart(2, '0');
    const stateCode = STATE_FIPS_TO_CODE[stateFips];
    if (stateCode) stateCodesInData.add(stateCode);
  }
  const missing = [...EXPECTED_STATE_CODES].filter(s => !stateCodesInData.has(s));
  if (!assert(missing.length === 0, `Test 1: VEST data missing states: ${missing.join(', ') || 'none'}. Expected 51 state codes.`)) return;
  if (!assert(stateCodesInData.size === 51, `Test 1: Expected 51 state codes in data, got ${stateCodesInData.size}`)) return;
  console.log('PASS: Test 1 – VEST data has tracts for all 51 state codes (50 states + DC)');

  // --- Test 2: Party percentages for first 10 tracts per state
  const byState = {};
  for (const [geoid, row] of Object.entries(vestData.data)) {
    const stateFips = (row.state_fips || String(geoid).substring(0, 2)).padStart(2, '0');
    const stateCode = STATE_FIPS_TO_CODE[stateFips];
    if (!stateCode) continue;
    if (!byState[stateCode]) byState[stateCode] = [];
    byState[stateCode].push(geoid);
  }
  for (const stateCode of Object.keys(byState)) {
    byState[stateCode].sort();
  }
  let test2Ok = true;
  for (const stateCode of Object.keys(byState)) {
    const geoids = byState[stateCode].slice(0, 10);
    for (const geoid of geoids) {
      const row = vestData.data[geoid];
      if (!row) continue;
      const pctDem = row.pct_dem_pres;
      const pctRep = row.pct_rep_pres;
      const votesDem = row.votes_dem_pres;
      const votesRep = row.votes_rep_pres;
      const totalVotes = row.total_votes_pres;
      if (typeof pctDem !== 'number' || pctDem < 0 || pctDem > 1) {
        fail(`Test 2: ${stateCode} tract ${geoid} pct_dem_pres invalid: ${pctDem}`);
        test2Ok = false;
        break;
      }
      if (typeof pctRep !== 'number' || pctRep < 0 || pctRep > 1) {
        fail(`Test 2: ${stateCode} tract ${geoid} pct_rep_pres invalid: ${pctRep}`);
        test2Ok = false;
        break;
      }
      if (pctDem + pctRep > 1.0001) {
        fail(`Test 2: ${stateCode} tract ${geoid} pct_dem + pct_rep > 1`);
        test2Ok = false;
        break;
      }
      if (typeof votesDem !== 'number' || votesDem < 0 || typeof votesRep !== 'number' || votesRep < 0 || typeof totalVotes !== 'number' || totalVotes < 0) {
        fail(`Test 2: ${stateCode} tract ${geoid} vote fields must be non-negative numbers`);
        test2Ok = false;
        break;
      }
      if (totalVotes > 0) {
        const expectedPctDem = votesDem / totalVotes;
        const expectedPctRep = votesRep / totalVotes;
        if (Math.abs(pctDem - expectedPctDem) > 0.001 || Math.abs(pctRep - expectedPctRep) > 0.001) {
          fail(`Test 2: ${stateCode} tract ${geoid} percentages inconsistent with votes`);
          test2Ok = false;
          break;
        }
      }
    }
    if (!test2Ok) break;
  }
  if (!test2Ok) return;
  console.log('PASS: Test 2 – First 10 tracts per state have valid party % and vote fields');

  // --- Test 4 (VEST-only): Query party data for a given tract
  const sampleState = 'CA';
  const sampleGeoids = byState[sampleState];
  if (!sampleGeoids || sampleGeoids.length === 0) {
    fail('Test 4: No tracts for sample state ' + sampleState);
    return;
  }
  const sampleGeoid = sampleGeoids[0];
  const sampleRow = vestData.data[sampleGeoid];
  if (!assert(sampleRow, 'Test 4: Sample tract row missing')) return;
  const required = ['pct_dem_pres', 'pct_rep_pres', 'votes_dem_pres', 'votes_rep_pres', 'total_votes_pres'];
  for (const key of required) {
    if (!assert(typeof sampleRow[key] === 'number', `Test 4: Sample tract missing or non-numeric ${key}`)) return;
  }
  console.log('PASS: Test 4 – Query party data for a given tract (VEST path), tract %s', sampleGeoid);

  // --- Test 3: Party percentages stored in cloud storage (optional, requires GCP)
  const runStorageTest = process.env.RUN_VEST_STORAGE_TEST === '1';
  if (runStorageTest) {
    console.log('\nRunning Test 3 (persistence + read-back)...');
    const result = await tractPartyPersistence.runTractPartyPersistenceJob(VEST_YEAR);
    if (result.error) {
      fail(`Test 3: Persistence job failed: ${result.error}`);
      return;
    }
    if (result.statesWritten.length === 0) {
      fail('Test 3: No states written by persistence job');
      return;
    }
    const checkStates = result.statesWritten.slice(0, 5);
    for (const stateCode of checkStates) {
      const geoids = await tractPartyPersistence.loadTractPartyForState(stateCode, VEST_YEAR);
      if (!assert(geoids && typeof geoids === 'object' && Object.keys(geoids).length > 0, `Test 3: No data read back for ${stateCode}`)) return;
      const firstGeoid = Object.keys(geoids)[0];
      const entry = geoids[firstGeoid];
      if (!assert(entry && typeof entry.pctDem === 'number' && typeof entry.pctRep === 'number' && typeof entry.votesDem === 'number' && typeof entry.votesRep === 'number' && typeof entry.totalVotes === 'number', `Test 3: Read-back entry for ${stateCode} missing required fields`)) return;
    }
    console.log('PASS: Test 3 – Party percentages stored and read back from Firestore/GCS');

    // Test 4 storage path: query one tract from stored data
    const stored = await tractPartyPersistence.loadTractPartyForState(sampleState, VEST_YEAR);
    if (stored && stored[sampleGeoid]) {
      const e = stored[sampleGeoid];
      if (typeof e.pctDem === 'number' && typeof e.pctRep === 'number' && typeof e.votesDem === 'number' && typeof e.votesRep === 'number' && typeof e.totalVotes === 'number') {
        console.log('PASS: Test 4 – Query party data for a given tract (storage path), tract %s', sampleGeoid);
      }
    }
  } else {
    console.log('\nSkipped: Test 3 (requires Firestore/GCS). Set RUN_VEST_STORAGE_TEST=1 and configure GCP to run.');
  }

  console.log('\nAll VEST party tests passed.');
}

runTests().catch(err => {
  console.error('Unhandled error:', err);
  process.exitCode = 1;
});
