/**
 * Run the union polygon generation job in a separate process.
 * ONLY invoked by POST /api/algorithm/step/:state/:stepNumber/union-polygons (main server forks this script).
 * This ensures ALL union polygon creation runs async and never blocks the main server.
 *
 * Usage: node scripts/run-union-polygon-job.js <state> <stepNum> <maxIterations>
 * Example: node scripts/run-union-polygon-job.js CA 2 100
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { runUnionPolygonGenerationJob } = require('../index.js');

const [state, stepNumStr, maxIterationsStr] = process.argv.slice(2);
const stepNum = parseInt(stepNumStr, 10);
const maxIterations = parseInt(maxIterationsStr || '100', 10);

if (!state || isNaN(stepNum) || stepNum < 1) {
  console.error('Usage: node scripts/run-union-polygon-job.js <state> <stepNum> [maxIterations]');
  process.exit(1);
}

runUnionPolygonGenerationJob(state, stepNum, maxIterations)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Union polygon job failed:', err.message);
    process.exit(1);
  });
