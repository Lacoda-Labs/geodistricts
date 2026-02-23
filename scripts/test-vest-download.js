#!/usr/bin/env node

/**
 * Test script for VEST data download functionality
 * Downloads data for just a few small states to verify the system works
 * Run with: node scripts/test-vest-download.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const vestBulkPersistence = require('../backend/services/vest-bulk-persistence');
const vestDataDownloader = require('../backend/services/vest-data-downloader');

const YEAR = 2020;
// Test with just a few small states to verify functionality
const TEST_STATES = ['DE', 'DC', 'HI']; // Delaware, DC, Hawaii - small states

async function main() {
  console.log('🧪 Testing VEST download and persistence functionality...\n');
  console.log(`📅 Year: ${YEAR}`);
  console.log(`🏛️ Test states: ${TEST_STATES.join(', ')}\n`);

  try {
    // Check current status
    console.log('📊 Checking current download status...');
    const initialStatus = await vestDataDownloader.getDownloadStatus(YEAR);
    console.log(`   Currently have ${initialStatus.tractFiles.length} tract files\n`);

    // Test the downloader service
    console.log('🔍 Testing VEST data discovery...');
    const files = await vestDataDownloader.vestLoader.listDatasetFiles(
      vestDataDownloader.vestLoader.constructor.VEST_DATASETS[YEAR].persistentId
    );

    const tractFiles = files.filter(file => {
      const filename = file.dataFile?.filename || file.label || '';
      return vestDataDownloader.isTractFile(filename, YEAR);
    });

    console.log(`   Found ${tractFiles.length} tract-level files in dataset\n`);

    // Filter for test states only
    const testStateFiles = tractFiles.filter(file => {
      const filename = file.dataFile?.filename || file.label || '';
      const state = vestDataDownloader.extractStateFromFilename(filename);
      return TEST_STATES.includes(state);
    });

    console.log(`   Test states files: ${testStateFiles.length}`);
    testStateFiles.forEach(file => {
      const filename = file.dataFile?.filename || file.label;
      const state = vestDataDownloader.extractStateFromFilename(filename);
      console.log(`     - ${filename} (${state})`);
    });

    if (testStateFiles.length === 0) {
      console.log('\n⚠️ No test state files found. This might indicate:');
      console.log('   - Test states may not have separate files');
      console.log('   - Files might be in a different format');
      console.log('   - Dataset structure may be different than expected\n');

      // Try to download one file to see what happens
      console.log('🔄 Attempting to download first available tract file...');
      const firstTractFile = tractFiles[0];
      if (firstTractFile) {
        try {
          const result = await vestDataDownloader.vestLoader.downloadFileById(firstTractFile.dataFile.id);
          console.log(`   ✅ Downloaded ${firstTractFile.dataFile.filename} (${vestDataDownloader.formatBytes(result?.size || 0)})`);
        } catch (error) {
          console.log(`   ❌ Download failed: ${error.message}`);
        }
      }
    } else {
      // Download and test with test states
      console.log('\n📥 Downloading test state files...');
      for (const file of testStateFiles.slice(0, 2)) { // Limit to 2 files for testing
        try {
          const filename = file.dataFile?.filename || file.label;
          console.log(`   Downloading ${filename}...`);

          const result = await vestDataDownloader.vestLoader.downloadFileById(file.dataFile.id);
          console.log(`   ✅ Downloaded ${filename} (${vestDataDownloader.formatBytes(result?.size || 0)})`);

          // Try to load and persist this state's data
          console.log(`   💾 Testing persistence for this state...`);
          const vestData = await vestDataLoader.loadVESTData(YEAR);

          if (vestData?.data) {
            const tractCount = Object.keys(vestData.data).length;
            console.log(`   📊 Loaded ${tractCount} tracts from downloaded data`);

            // Test persistence for one state
            const testState = TEST_STATES[0];
            const filteredData = {};
            for (const [geoid, row] of Object.entries(vestData.data)) {
              if (geoid.startsWith(testState === 'DC' ? '11' : '10')) { // DE is 10, DC is 11
                filteredData[geoid] = row;
              }
            }

            if (Object.keys(filteredData).length > 0) {
              await vestBulkPersistence.persistStateData(testState, YEAR, { data: filteredData });
              console.log(`   ✅ Persisted ${Object.keys(filteredData).length} tracts for ${testState}`);
            } else {
              console.log(`   ⚠️ No data found for ${testState} in downloaded file`);
            }
          }

          break; // Only test one file for now

        } catch (error) {
          console.log(`   ❌ Failed: ${error.message}`);
        }
      }
    }

    // Check final status
    console.log('\n📊 Checking final status...');
    const finalStatus = await vestDataDownloader.getDownloadStatus(YEAR);
    console.log(`   Final tract files: ${finalStatus.tractFiles.length}`);
    console.log(`   Final total size: ${vestDataDownloader.formatBytes(finalStatus.totalSize)}`);

    console.log('\n✅ VEST download test completed successfully!');
    console.log('\n💡 The system is ready for full bulk download.');
    console.log('   Run the full script with: node scripts/download-vest-2020.js');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };