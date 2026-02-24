#!/usr/bin/env node

/**
 * Run tract-level party % persistence for a VEST year.
 * Builds tract_party_{state}_{year} data (from VEST) so district-party and
 * district-party-for-group endpoints have data to aggregate.
 *
 * Usage: node scripts/run-tract-party-persistence.js [year]
 *        cd backend && npm run tract-party
 * Example: node scripts/run-tract-party-persistence.js 2020
 *
 * Prerequisite: VEST data for the year (e.g. run ./scripts/run-vest-download.sh first,
 * or let vest-data-loader download on first run).
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const tractPartyPersistence = require('../services/tract-party-persistence');

const yearArg = process.argv[2];
const YEAR = yearArg ? parseInt(yearArg, 10) : parseInt(process.env.VEST_YEAR || '2024', 10);

if (isNaN(YEAR) || YEAR < 2016) {
  console.error('Usage: node scripts/run-tract-party-persistence.js [year]');
  console.error('  year: 2016 or later (default: 2020 or VEST_YEAR)');
  process.exit(1);
}

console.log(`Running tract party persistence for year ${YEAR}...`);

tractPartyPersistence
  .runTractPartyPersistenceJob(YEAR, {})
  .then((result) => {
    if (result.error) {
      console.error('❌', result.error);
      process.exit(1);
    }
    console.log('States written:', result.statesWritten?.length ?? 0, result.statesWritten ?? []);
    if (result.statesSkipped?.length) {
      console.log('States skipped:', result.statesSkipped.length, result.statesSkipped);
    }
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
