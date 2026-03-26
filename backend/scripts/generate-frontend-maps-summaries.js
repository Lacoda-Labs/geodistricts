/**
 * Build frontend/public/maps/maps-landing-summaries.json for static-first maps page (no polygons).
 * Applies applyFreshCongress119ToComparisonPayload so 119th counts match data/congress-119-party.json.
 *
 * Usage (from repo root):
 *   node backend/scripts/generate-frontend-maps-summaries.js [path-to-maps_landing.json]
 *   Or: GET_MAPS_LANDING_URL=https://.../api/maps/landing node backend/scripts/generate-frontend-maps-summaries.js
 *
 * Output: frontend/public/maps/maps-landing-summaries.json (path relative to repo root)
 *
 * Requires maps_landing to include stateComparison, statePartySummaries, districtPartyByState.
 * See doc/pages/STATIC_MAPS_CDN.md.
 */

const fs = require('fs');
const path = require('path');
const mapsComparison = require('../services/maps-comparison');

async function loadMapsLanding(inputPath, apiUrl) {
  if (apiUrl) {
    const axios = require('axios');
    const { data } = await axios.get(apiUrl, { timeout: 120000 });
    return data;
  }
  const fullPath = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

function findRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'frontend', 'public'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function main() {
  const inputPath = process.argv[2] || 'data/maps_landing.json';
  const apiUrl = process.env.GET_MAPS_LANDING_URL || null;
  const repoRoot = findRepoRoot();
  const outFile = path.join(repoRoot, 'frontend', 'public', 'maps', 'maps-landing-summaries.json');

  console.log('Loading landing...');
  const landing = await loadMapsLanding(inputPath, apiUrl);

  let stateComparison = landing.stateComparison || null;
  if (stateComparison) {
    stateComparison = mapsComparison.applyFreshCongress119ToComparisonPayload(stateComparison);
  }

  const summariesPayload = {
    stateComparison,
    statePartySummaries: landing.statePartySummaries || { summaries: {} },
    districtPartyByState: landing.districtPartyByState || {},
    meta: landing.meta || { generatedAt: new Date().toISOString(), source: 'generate-frontend-maps-summaries' },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(summariesPayload, null, 2), 'utf8');
  console.log('Wrote', outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
