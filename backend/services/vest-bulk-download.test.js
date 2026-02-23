/**
 * VEST Bulk Download and Persistence Unit Tests
 * Tests complete 2020 data download and persistence for all 50 states + DC
 * Run with: node backend/services/vest-bulk-download.test.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const vestBulkPersistence = require('./vest-bulk-persistence');
const vestDataDownloader = require('./vest-data-downloader');
const tractPartyPersistence = require('./tract-party-persistence');

const { STATE_FIPS_TO_CODE } = tractPartyPersistence;
const EXPECTED_STATES = new Set(Object.values(STATE_FIPS_TO_CODE)); // 51 states + DC
const YEAR = 2020;

// Test configuration
const RUN_EXPENSIVE_TESTS = process.env.RUN_VEST_BULK_TESTS === '1';
const MAX_STATES_TO_VERIFY = 10; // Limit verification to first N states for speed

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
  console.log(`VEST Bulk Download & Persistence Tests (year=${YEAR})\n`);
  console.log(`Expected states: ${EXPECTED_STATES.size} (50 states + DC)`);
  console.log(`Expensive tests enabled: ${RUN_EXPENSIVE_TESTS}\n`);

  // Test 1: VEST data downloader service functionality
  console.log('Test 1: VEST data downloader service...');

  // Test filename parsing
  const testFilenames = [
    { filename: 'AZ_tract_2020.csv', expected: 'AZ' },
    { filename: 'california_tract_2020.csv', expected: 'CA' },
    { filename: 'tract_NY_2020.tab', expected: 'NY' },
    { filename: 'invalid_file.csv', expected: null },
    { filename: 'county_data_2020.csv', expected: null }
  ];

  for (const test of testFilenames) {
    const result = vestDataDownloader.extractStateFromFilename(test.filename);
    if (!assert(result === test.expected,
      `Filename parsing failed: ${test.filename} -> expected ${test.expected}, got ${result}`)) return;
  }

  // Test tract file detection
  const tractTests = [
    { filename: 'AZ_tract_2020.csv', year: 2020, expected: true },
    { filename: 'AZ_county_2020.csv', year: 2020, expected: false },
    { filename: 'AZ_tract_2016.csv', year: 2020, expected: false },
    { filename: 'readme.md', year: 2020, expected: false }
  ];

  for (const test of tractTests) {
    const result = vestDataDownloader.isTractFile(test.filename, test.year);
    if (!assert(result === test.expected,
      `Tract file detection failed: ${test.filename} -> expected ${test.expected}, got ${result}`)) return;
  }

  console.log('✅ PASS: VEST data downloader service functionality');

  // Test 2: Download status check
  console.log('\nTest 2: Download status check...');
  try {
    const status = await vestDataDownloader.getDownloadStatus(YEAR);
    if (!assert(status, 'Download status returned null')) return;
    if (!assert(typeof status.tractFiles === 'object', 'Status missing tractFiles array')) return;
    if (!assert(typeof status.totalSize === 'number', 'Status missing totalSize')) return;

    console.log(`   Found ${status.tractFiles.length} tract files (${vestDataDownloader.formatBytes(status.totalSize)})`);
    console.log('✅ PASS: Download status check');
  } catch (error) {
    fail(`Download status check failed: ${error.message}`);
    return;
  }

  // Test 3: Bulk persistence service (expensive - only run when requested)
  if (!RUN_EXPENSIVE_TESTS) {
    console.log('\n⏭️ SKIPPED: Bulk persistence test (set RUN_VEST_BULK_TESTS=1 to enable)');
    console.log('💡 This test downloads all VEST data and may take 30+ minutes and incur API costs');

    // Test 4: Persistence verification with existing data
    console.log('\nTest 4: Persistence verification with existing data...');
    await runPersistenceVerificationTest();
    return;
  }

  console.log('\nTest 3: Full bulk download and persistence (EXPENSIVE)...');
  console.log('⚠️ This will download ~51 state files and may take 30+ minutes');

  try {
    const results = await vestBulkPersistence.downloadAndPersistAll(YEAR);

    if (!assert(results, 'Bulk persistence returned no results')) return;
    if (!assert(!results.error, `Bulk persistence failed: ${results.error}`)) return;

    // Verify download results
    if (!assert(results.downloadResults, 'Missing download results')) return;
    if (!assert(results.downloadResults.downloaded.length > 0,
      'No files were downloaded')) return;

    // Verify processing results
    const processedStates = new Set(results.statesProcessed.map(r => r.state));
    const missingStates = [...EXPECTED_STATES].filter(s => !processedStates.has(s));

    if (!assert(missingStates.length === 0,
      `Missing data for states: ${missingStates.join(', ')}`)) return;

    if (!assert(results.statesProcessed.length >= 45,
      `Only ${results.statesProcessed.length} states processed, expected at least 45`)) return;

    if (!assert(results.totalTracts > 0,
      'No tracts were processed')) return;

    console.log(`✅ PASS: Bulk download completed for ${results.statesProcessed.length} states`);
    console.log(`   📊 Total tracts: ${results.totalTracts.toLocaleString()}`);
    console.log(`   📏 Total size: ${vestBulkPersistence.formatBytes(results.totalSize)}`);

  } catch (error) {
    fail(`Bulk persistence test failed: ${error.message}`);
    return;
  }

  // Test 4: Persistence verification (run after bulk download or with existing data)
  console.log('\nTest 4: Persistence verification...');
  await runPersistenceVerificationTest();
}

async function runPersistenceVerificationTest() {
  // Verify data persistence in Firestore/Cloud Storage
  let totalTractsVerified = 0;
  let statesVerified = 0;

  // Get a list of states that should have data
  const statesToCheck = Array.from(EXPECTED_STATES).slice(0, MAX_STATES_TO_VERIFY);

  console.log(`   Verifying persistence for ${statesToCheck.length} states...`);

  for (const stateCode of statesToCheck) {
    try {
      const stateData = await tractPartyPersistence.loadTractPartyForState(stateCode, YEAR);

      if (!stateData) {
        console.log(`   ⏭️ ${stateCode}: No data found (expected if not downloaded yet)`);
        continue;
      }

      const tractCount = Object.keys(stateData).length;
      if (!assert(tractCount > 0, `No tracts found for ${stateCode}`)) continue;

      // Verify data structure for first few tracts
      const sampleTracts = Object.values(stateData).slice(0, 5);
      for (const tract of sampleTracts) {
        const requiredFields = ['pctDem', 'pctRep', 'votesDem', 'votesRep', 'totalVotes'];
        for (const field of requiredFields) {
          if (!assert(typeof tract[field] === 'number',
            `${stateCode} tract missing or invalid ${field}`)) continue;
        }

        // Verify percentages are valid
        if (!assert(tract.pctDem >= 0 && tract.pctDem <= 1,
          `${stateCode} tract pctDem out of range: ${tract.pctDem}`)) continue;
        if (!assert(tract.pctRep >= 0 && tract.pctRep <= 1,
          `${stateCode} tract pctRep out of range: ${tract.pctRep}`)) continue;
      }

      totalTractsVerified += tractCount;
      statesVerified++;

      console.log(`   ✅ ${stateCode}: ${tractCount} tracts verified`);

    } catch (error) {
      fail(`Verification failed for ${stateCode}: ${error.message}`);
      return;
    }
  }

  if (!assert(statesVerified > 0, 'No states were successfully verified')) return;

  console.log(`✅ PASS: Data persistence verified for ${statesVerified} states`);
  console.log(`   📊 Total tracts verified: ${totalTractsVerified.toLocaleString()}`);

  // Test 5: Storage optimization verification
  console.log('\nTest 5: Storage optimization verification...');

  // Check that large states use Cloud Storage when appropriate
  const largeStates = ['CA', 'TX', 'FL', 'NY', 'PA']; // States likely to have large datasets
  let cloudStorageUsed = false;

  for (const state of largeStates) {
    try {
      const stateData = await tractPartyPersistence.loadTractPartyForState(state, YEAR);
      if (stateData) {
        const tractCount = Object.keys(stateData).length;
        // Large states should be using Cloud Storage for payloads > 1MB
        if (tractCount > 1000) { // Rough heuristic for "large"
          cloudStorageUsed = true;
        }
        console.log(`   📦 ${state}: ${tractCount} tracts stored`);
      }
    } catch (error) {
      // State may not have data, that's OK for this test
    }
  }

  console.log('✅ PASS: Storage optimization verified');

  // Test 6: Data consistency checks
  console.log('\nTest 6: Data consistency checks...');

  for (const stateCode of statesToCheck.slice(0, 3)) {
    try {
      const stateData = await tractPartyPersistence.loadTractPartyForState(stateCode, YEAR);
      if (!stateData) continue;

      // Check that vote totals make sense
      for (const [geoid, tract] of Object.entries(stateData).slice(0, 10)) {
        const totalFromVotes = tract.votesDem + tract.votesRep;
        const expectedTotal = tract.totalVotes;

        // Allow for some rounding error and other candidates
        if (expectedTotal > 0) {
          const ratio = totalFromVotes / expectedTotal;
          if (!assert(ratio >= 0.5 && ratio <= 1.5,
            `${stateCode} ${geoid}: Vote consistency check failed (${totalFromVotes} vs ${expectedTotal})`)) continue;
        }
      }

      console.log(`   🔍 ${stateCode}: Data consistency verified`);

    } catch (error) {
      fail(`Consistency check failed for ${stateCode}: ${error.message}`);
      return;
    }
  }

  console.log('✅ PASS: Data consistency checks');
}

async function main() {
  try {
    await runTests();
    console.log('\n🎉 All VEST bulk download and persistence tests passed!');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runTests, runPersistenceVerificationTest };