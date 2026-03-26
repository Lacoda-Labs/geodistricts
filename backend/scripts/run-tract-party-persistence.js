#!/usr/bin/env node

/**
 * Run tract-level party % persistence for a VEST year.
 * Builds tract_party_{state}_{year} data (from VEST) so district-party and
 * district-party-for-group endpoints have data to aggregate.
 *
 * Tract party calculation is intended to be run from local dev. Output is always
 * written to the local filesystem (backend/data/census-cache/). GCP (Firestore/GCS)
 * is not used when running this script.
 *
 * Usage: node scripts/run-tract-party-persistence.js [year] [state]
 *        cd backend && npm run tract-party
 * Example: node scripts/run-tract-party-persistence.js 2024
 * Example: node scripts/run-tract-party-persistence.js 2024 RI
 *
 * Prerequisite: VEST data for the year (e.g. run ./scripts/run-vest-download.sh first,
 * or let vest-data-loader download on first run).
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

// Always use local cache for tract party when run via this script (dev pipeline).
process.env.USE_LOCAL_CACHE = 'true';

const tractPartyPersistence = require('../services/tract-party-persistence');

const yearArg = process.argv[2];
const stateArg = process.argv[3];
const YEAR = yearArg ? parseInt(yearArg, 10) : parseInt(process.env.VEST_YEAR || '2024', 10);
const STATE_OPT =
  stateArg && String(stateArg).trim().length === 2 ? String(stateArg).trim().toUpperCase() : null;

if (isNaN(YEAR) || YEAR < 2016) {
  console.error('Usage: node scripts/run-tract-party-persistence.js [year] [state]');
  console.error('  year: 2016 or later (default: 2024 or VEST_YEAR)');
  console.error('  state: optional 2-letter code (e.g. RI) to persist one state only');
  process.exit(1);
}

console.log(
  `Running tract party persistence for year ${YEAR}${STATE_OPT ? ` (state: ${STATE_OPT})` : ''}...`
);

tractPartyPersistence
  .runTractPartyPersistenceJob(YEAR, STATE_OPT ? { state: STATE_OPT } : {})
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
