/**
 * Generate state boundary (union) polygons for all states and save to Cloud Storage.
 * Fetches state boundaries from Census TIGERweb (State_County layer 0) and overwrites existing cache entries.
 * Usage: node scripts/generate-state-union-polygons.js [STATE]
 *   With no arg: process all states. With STATE (e.g. CA): process that state only.
 */

require('dotenv').config();
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const cloudStorageCache = require('../services/cloud-storage-cache');
const { CONGRESSIONAL_DISTRICTS_BY_STATE } = require('../services/geodistrict-algorithm');

const CACHE_VERSION = '1.0';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

const stateFipsMap = {
  'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
  'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
  'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
  'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
  'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
  'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
  'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
  'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
  'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
  'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
  'DC': '11'
};

// Census TIGERweb State_County layer 0 = States (STATE, GEOID, NAME, STUSAB)
const serviceUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query';

async function generateStateBoundary(state) {
  const stateBoundaryKey = `state_boundary_polygon_${state.toUpperCase()}`;
  const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
  const params = new URLSearchParams({
    where: `STATE='${stateFips}'`,
    outFields: 'STATE,GEOID,NAME,STUSAB',
    f: 'geojson',
    outSR: '4326'
  });

  const response = await axios.get(`${serviceUrl}?${params.toString()}`);
  const features = response.data.features || [];
  if (features.length === 0) {
    throw new Error(`No state boundary features returned for state: ${state}`);
  }
  const mainFeature = features[0];
  const unionData = Array.isArray(mainFeature) ? mainFeature : [mainFeature];

  const cloudStoragePath = await cloudStorageCache.set(stateBoundaryKey, unionData, {
    state,
    source: 'tiger-state-boundary',
    polygonCount: '1'
  });

  const metadataEntry = {
    cloudStoragePath,
    timestamp: Date.now(),
    ttl: null,
    version: CACHE_VERSION,
    source: 'tiger-state-boundary',
    tigerBased: true,
    state,
    polygonCount: 1
  };
  await firestore.collection('census_cache').doc(stateBoundaryKey).set(metadataEntry);
  console.log(`💾 Saved state boundary to Cloud Storage (${stateBoundaryKey})`);
}

async function main() {
  const singleState = process.argv[2];
  const states = singleState
    ? [singleState.toUpperCase()]
    : Object.keys(CONGRESSIONAL_DISTRICTS_BY_STATE);

  if (singleState && !CONGRESSIONAL_DISTRICTS_BY_STATE[singleState.toUpperCase()]) {
    console.error(`Unknown state: ${singleState}`);
    process.exit(1);
  }

  await cloudStorageCache.initialize();
  console.log(`🚀 Generating state boundary polygons for ${states.length} state(s)...`);

  const failed = [];
  for (const state of states) {
    try {
      await generateStateBoundary(state);
    } catch (err) {
      console.error(`❌ ${state}: ${err.message}`);
      failed.push(state);
    }
  }

  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`✅ Done. ${states.length} state boundary polygon(s) written to Cloud Storage.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
