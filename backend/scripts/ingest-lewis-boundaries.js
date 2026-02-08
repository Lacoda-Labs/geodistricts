/**
 * Ingest congressional district boundaries from JeffreyBLewis/congressional-district-boundaries
 * into Cloud Storage. Data is used only as a data source; runtime reads from our API/cloud.
 *
 * Usage: node scripts/ingest-lewis-boundaries.js [--congress=119]
 * Requires: GOOGLE_CLOUD_PROJECT, CENSUS_DATA_BUCKET (optional), and GCP credentials.
 */

const axios = require('axios');
const cloudStorageCache = require('../services/cloud-storage-cache');
require('dotenv').config();

const GITHUB_API = 'https://api.github.com/repos/JeffreyBLewis/congressional-district-boundaries/contents/GeoJson';
const RAW_BASE = 'https://raw.githubusercontent.com/JeffreyBLewis/congressional-district-boundaries/master/GeoJson';

// Filename pattern: StateName_XXX_to_YYY.geojson (e.g. Alabama_119_to_119.geojson, New_York_119_to_119.geojson)
const FILE_REGEX = /^(.+)_(\d+)_to_(\d+)\.geojson$/i;

function parseFilename(name) {
  const m = name.match(FILE_REGEX);
  if (!m) return null;
  return { stateName: m[1], startCongress: parseInt(m[2], 10), endCongress: parseInt(m[3], 10) };
}

async function listAllGeoJsonFiles() {
  const files = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data } = await axios.get(GITHUB_API, {
      params: { per_page: perPage, page },
      headers: { Accept: 'application/vnd.github.v3+json' }
    });
    if (!Array.isArray(data)) break;
    files.push(...data);
    if (data.length < perPage) break;
    page++;
  }
  return files;
}

async function ingestCongress(congress) {
  console.log(`Ingesting congressional district boundaries for ${congress}th Congress...`);
  await cloudStorageCache.initialize();

  const contents = await listAllGeoJsonFiles();
  const matching = contents
    .filter(f => f.type === 'file' && f.name && f.name.endsWith('.geojson'))
    .map(f => ({ ...f, parsed: parseFilename(f.name) }))
    .filter(f => f.parsed && congress >= f.parsed.startCongress && congress <= f.parsed.endCongress);

  console.log(`Found ${matching.length} state files for Congress ${congress}.`);

  let ok = 0;
  let err = 0;
  for (const file of matching) {
    const { stateName } = file.parsed;
    const url = `${RAW_BASE}/${encodeURIComponent(file.name)}`;
    try {
      const { data } = await axios.get(url, { responseType: 'json', timeout: 60000 });
      const cacheKey = `congressional_boundaries_${congress}_${stateName}`;
      await cloudStorageCache.set(cacheKey, data, { congress: String(congress), stateName });
      ok++;
      console.log(`  OK ${stateName}`);
    } catch (e) {
      err++;
      console.error(`  FAIL ${stateName}:`, e.message);
    }
  }

  console.log(`Done: ${ok} uploaded, ${err} failed.`);
  return { ok, err };
}

const congressArg = process.argv.find(a => a.startsWith('--congress='));
const congress = congressArg ? parseInt(congressArg.split('=')[1], 10) : 119;

if (isNaN(congress) || congress < 1) {
  console.error('Usage: node scripts/ingest-lewis-boundaries.js [--congress=119]');
  process.exit(1);
}

ingestCongress(congress).then(({ ok, err }) => {
  process.exit(err > 0 ? 1 : 0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
