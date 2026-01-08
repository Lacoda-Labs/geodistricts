#!/usr/bin/env node

/**
 * Pre-download and cache census data for all states
 * 
 * This script iterates through all 50 states + DC and downloads their census tract data,
 * which will populate the Firestore cache for faster access later.
 * 
 * Usage:
 *   node scripts/preload-census-data.js [options]
 * 
 * Options:
 *   --api-url <url>     Base URL for the API (default: http://localhost:8080)
 *   --force             Force re-download even if data is cached
 *   --states <list>     Comma-separated list of state codes to download (default: all)
 *   --delay <ms>        Delay between states in milliseconds (default: 2000)
 */

// Load axios - script should be run from backend directory or have axios installed
const axios = require('axios');

// All 50 states + DC
const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC'
];

// Parse command line arguments
const args = process.argv.slice(2);
const apiUrl = args.includes('--api-url') 
  ? args[args.indexOf('--api-url') + 1] 
  : process.env.API_URL || 'http://localhost:8081';
const forceInvalidate = args.includes('--force');
const delay = args.includes('--delay')
  ? parseInt(args[args.indexOf('--delay') + 1], 10)
  : 2000;

let statesToProcess = ALL_STATES;
if (args.includes('--states')) {
  const stateList = args[args.indexOf('--states') + 1];
  statesToProcess = stateList.split(',').map(s => s.trim().toUpperCase());
}

// Statistics
const stats = {
  total: statesToProcess.length,
  completed: 0,
  failed: 0,
  skipped: 0,
  totalTracts: 0,
  totalCounties: 0,
  errors: []
};

// Helper to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to format time
const formatTime = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

// Helper to print progress
const printProgress = (state, status, details = '') => {
  const timestamp = new Date().toISOString();
  const progress = `[${stats.completed + stats.failed + stats.skipped}/${stats.total}]`;
  console.log(`${timestamp} ${progress} ${state}: ${status} ${details}`);
};

// Get counties for a state
async function getCountiesForState(state) {
  try {
    const response = await axios.get(`${apiUrl}/api/census/counties`, {
      params: { state },
      timeout: 60000
    });
    return response.data || [];
  } catch (error) {
    throw new Error(`Failed to get counties for ${state}: ${error.message}`);
  }
}

// Download tract data for a state using bulk endpoint
async function downloadTractDataForState(state) {
  try {
    // First, get all counties for this state
    printProgress(state, '📋', 'Fetching counties...');
    const counties = await getCountiesForState(state);
    
    if (!counties || counties.length === 0) {
      printProgress(state, '⚠️', 'No counties found');
      stats.skipped++;
      return { state, counties: 0, tracts: 0, error: 'No counties found' };
    }

    const countyFips = counties.map(c => c.fips || c.COUNTY).filter(Boolean);
    printProgress(state, '📊', `Found ${countyFips.length} counties`);

    // Use bulk endpoint to download all tract data
    printProgress(state, '⬇️', `Downloading tract data for ${countyFips.length} counties...`);
    const startTime = Date.now();
    
    const response = await axios.post(
      `${apiUrl}/api/census/tract-data/bulk`,
      {
        state,
        counties: countyFips,
        forceInvalidate
      },
      {
        timeout: 600000 // 10 minute timeout for large states
      }
    );

    const duration = Date.now() - startTime;
    const result = response.data;
    
    if (result.errors && result.errors > 0) {
      printProgress(state, '⚠️', `Completed with ${result.errors} errors in ${formatTime(duration)}`);
    } else {
      printProgress(state, '✅', `${result.tracts} tracts in ${formatTime(duration)}`);
    }

    stats.totalTracts += result.tracts || 0;
    stats.totalCounties += result.counties || 0;
    stats.completed++;

    return {
      state,
      counties: result.counties || countyFips.length,
      tracts: result.tracts || 0,
      errors: result.errors || 0,
      duration
    };

  } catch (error) {
    stats.failed++;
    stats.errors.push({ state, error: error.message });
    printProgress(state, '❌', `Error: ${error.message}`);
    
    // If it's a timeout or network error, log it but continue
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      printProgress(state, '⏱️', 'Request timed out - state may be too large');
    }
    
    return {
      state,
      counties: 0,
      tracts: 0,
      error: error.message
    };
  }
}

// Main execution
async function main() {
  console.log('\n🚀 Starting census data pre-download');
  console.log(`📡 API URL: ${apiUrl}`);
  console.log(`📦 States to process: ${statesToProcess.length}`);
  console.log(`🔄 Force invalidate: ${forceInvalidate ? 'Yes' : 'No'}`);
  console.log(`⏱️  Delay between states: ${delay}ms`);
  console.log('');

  const overallStartTime = Date.now();

  // Process states sequentially to avoid overwhelming the API
  for (let i = 0; i < statesToProcess.length; i++) {
    const state = statesToProcess[i];
    
    await downloadTractDataForState(state);
    
    // Add delay between states (except for the last one)
    if (i < statesToProcess.length - 1) {
      await sleep(delay);
    }
  }

  const overallDuration = Date.now() - overallStartTime;

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total states processed: ${stats.total}`);
  console.log(`✅ Completed: ${stats.completed}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`⚠️  Skipped: ${stats.skipped}`);
  console.log(`📊 Total counties: ${stats.totalCounties}`);
  console.log(`📊 Total tracts: ${stats.totalTracts.toLocaleString()}`);
  console.log(`⏱️  Total time: ${formatTime(overallDuration)}`);
  
  if (stats.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    stats.errors.forEach(({ state, error }) => {
      console.log(`   ${state}: ${error}`);
    });
  }

  console.log('\n✨ Pre-download complete!\n');
  
  // Exit with appropriate code
  process.exit(stats.failed > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled error:', error);
  process.exit(1);
});

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});









