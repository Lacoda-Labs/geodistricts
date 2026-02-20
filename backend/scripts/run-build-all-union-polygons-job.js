/**
 * Run the build-all union polygon job in a separate process.
 * Builds final step from tracts, then backfills steps 1..finalStep-1 by unioning child DG polygons.
 * Invoked by POST /api/algorithm/build-all-union-polygons/:state (main server forks this script).
 *
 * Usage: node scripts/run-build-all-union-polygons-job.js <state> <finalStepNumber> [maxIterations]
 * Example: node scripts/run-build-all-union-polygons-job.js CA 5 100
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { runBuildAllUnionPolygonsForState } = require('../index.js');

const [state, finalStepStr, maxIterationsStr] = process.argv.slice(2);
const finalStepNumber = parseInt(finalStepStr, 10);
const maxIterations = parseInt(maxIterationsStr || '100', 10);

if (!state || isNaN(finalStepNumber) || finalStepNumber < 1) {
  console.error('Usage: node scripts/run-build-all-union-polygons-job.js <state> <finalStepNumber> [maxIterations]');
  process.exit(1);
}

runBuildAllUnionPolygonsForState(state, finalStepNumber, maxIterations)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Build-all union polygon job failed:', err.message);
    process.exit(1);
  });
