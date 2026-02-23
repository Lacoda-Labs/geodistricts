#!/usr/bin/env node

/**
 * VEST 2020 Data Download Script (Wrapper)
 * This script has module loading issues. Use the wrapper script instead:
 *
 * Run with: ./scripts/run-vest-download.sh
 *
 * Environment variables:
 * - RUN_VEST_BULK_TESTS=1 : Run full test suite after completion
 * - VEST_YEAR=2020 : Override default year
 * - VEST_DRY_RUN=1 : Dry run mode (no actual downloads)
 */

const path = require('path');

async function main() {
  // Change to backend directory first for proper module resolution
  process.chdir(path.join(__dirname, '..', 'backend'));

  // Load environment variables manually if .env file exists
  const fs = require('fs');
  const envPath = '.env';
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = envContent.split('\n').filter(line => line.includes('='));
    for (const envVar of envVars) {
      const [key, ...valueParts] = envVar.split('=');
      const value = valueParts.join('=').trim();
      if (key && value) {
        process.env[key.trim()] = value;
      }
    }
  }

  // Now require the services after directory change
  const vestBulkPersistence = require('./services/vest-bulk-persistence');
  const vestDataDownloader = require('./services/vest-data-downloader');

  const YEAR = parseInt(process.env.VEST_YEAR || '2020', 10);
  const RUN_TESTS_AFTER = process.env.RUN_VEST_BULK_TESTS === '1';
  const DRY_RUN = process.env.VEST_DRY_RUN === '1';

  console.log(`🔍 Dry run mode: ${DRY_RUN}`);

  console.log('🚀 Starting VEST 2020 bulk download and persistence...\n');
  console.log(`📅 Year: ${YEAR}`);
  console.log(`🧪 Run tests after: ${RUN_TESTS_AFTER}\n`);

  const startTime = new Date();
  console.log(`⏰ Start time: ${startTime.toISOString()}\n`);

  try {
    // Check current status before starting
    console.log('📊 Checking current download status...');
    const initialStatus = await vestDataDownloader.getDownloadStatus(YEAR);
    console.log(`   Currently have ${initialStatus.tractFiles.length} tract files`);
    console.log(`   Total size: ${vestDataDownloader.formatBytes(initialStatus.totalSize)}\n`);

    // Execute bulk download and persistence
    console.log('🔄 Starting bulk download and persistence process...\n');
    const results = await vestBulkPersistence.downloadAndPersistAll(YEAR, { dryRun: DRY_RUN });

    if (results.error) {
      console.error('❌ Process failed:', results.error);
      process.exit(1);
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    // Print comprehensive results
    console.log('\n🎉 VEST bulk download and persistence complete!');
    console.log('═'.repeat(60));
    console.log(`📅 Year: ${YEAR}`);
    console.log(`⏰ Duration: ${duration.toFixed(1)}s`);
    console.log(`📊 States processed: ${results.statesProcessed.length}`);
    console.log(`🏛️ Total tracts: ${results.totalTracts.toLocaleString()}`);
    console.log(`📏 Total data size: ${vestBulkPersistence.formatBytes(results.totalSize)}`);
    console.log(`❌ Failed states: ${results.statesFailed.length}`);
    console.log(`⏭️ Skipped states: ${results.statesSkipped.length}`);

    if (results.statesProcessed.length > 0) {
      console.log('\n✅ Successfully processed states:');
      const stateSummary = results.statesProcessed.map(r =>
        `${r.state} (${r.tracts.toLocaleString()} tracts${r.size ? `, ${vestBulkPersistence.formatBytes(r.size)}` : ''})`
      ).join(', ');
      console.log(`   ${stateSummary}`);
    }

    if (results.statesFailed.length > 0) {
      console.log('\n❌ Failed states:');
      results.statesFailed.forEach(failure => {
        console.log(`   ${failure.state || failure.filename}: ${failure.error}`);
      });
    }

    if (results.statesSkipped.length > 0) {
      console.log('\n⏭️ Skipped items:');
      results.statesSkipped.forEach(skip => {
        console.log(`   ${skip.state || skip.filename}: ${skip.reason}`);
      });
    }

    console.log('\n📈 Performance Summary:');
    const avgTractsPerSecond = results.totalTracts / duration;
    console.log(`   Average processing rate: ${avgTractsPerSecond.toFixed(1)} tracts/second`);

    if (results.downloadResults) {
      console.log('\n📥 Download Summary:');
      console.log(`   Files downloaded: ${results.downloadResults.downloaded.length}`);
      console.log(`   Files failed: ${results.downloadResults.failed.length}`);
      console.log(`   Files skipped: ${results.downloadResults.skipped.length}`);
    }

    console.log('═'.repeat(60));

    // Check final status
    console.log('\n📊 Checking final download status...');
    const finalStatus = await vestDataDownloader.getDownloadStatus(YEAR);
    console.log(`   Final tract files: ${finalStatus.tractFiles.length}`);
    console.log(`   Final total size: ${vestDataDownloader.formatBytes(finalStatus.totalSize)}`);

  // Run tests if requested
  if (RUN_TESTS_AFTER) {
    console.log('\n🧪 Running comprehensive test suite...');
    const { runTests } = require('./services/vest-bulk-download.test');

      // Temporarily enable expensive tests for the run
      process.env.RUN_VEST_BULK_TESTS = '1';

      await runTests();
      console.log('\n✅ All tests completed successfully!');
    } else {
      console.log('\n💡 Tip: Run with RUN_VEST_BULK_TESTS=1 to execute full test suite');
    }

    console.log('\n🎯 Next Steps:');
    console.log('   1. Verify data in Firestore/Cloud Storage');
    console.log('   2. Test frontend tract coloring functionality');
    console.log('   3. Run district-level party aggregation if needed');

  } catch (error) {
    console.error('\n❌ Script failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// This script has module loading issues. Use ./scripts/run-vest-download.sh instead
if (require.main === module) {
  console.error('❌ This script has module loading issues.');
  console.error('✅ Use the wrapper script instead: ./scripts/run-vest-download.sh');
  console.error('');
  console.error('Environment variables:');
  console.error('  VEST_DRY_RUN=1        - Dry run mode (no downloads)');
  console.error('  RUN_VEST_BULK_TESTS=1 - Run tests after completion');
  console.error('  VEST_YEAR=2020        - Override default year');
  process.exit(1);
}

module.exports = { main };