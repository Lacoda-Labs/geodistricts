/**
 * One-time sync: refresh maps state comparison and generate maps_landing blob, writing to GCS.
 * Ensures the public /maps page (All states) has party data and polygons.
 *
 * Usage:
 *   node backend/scripts/sync-maps-to-gcs.js [baseUrl]
 *   API_URL=https://geodistricts-api-288960974559.us-central1.run.app node backend/scripts/sync-maps-to-gcs.js
 *
 * Default baseUrl: production API (no trailing /api).
 */

const axios = require('axios');

const PRODUCTION_BASE = 'https://geodistricts-api-288960974559.us-central1.run.app';
const baseUrl = process.argv[2] || process.env.API_URL || PRODUCTION_BASE;

async function main() {
  console.log(`Using API base: ${baseUrl}\n`);

  // 1. Refresh state comparison (119th vs GeoDistricts) -> Firestore and/or GCS
  console.log('1. POST /api/admin/maps-comparison/refresh ...');
  try {
    const { data } = await axios.post(
      `${baseUrl}/api/admin/maps-comparison/refresh`,
      {},
      { timeout: 600000, headers: { 'Content-Type': 'application/json' } }
    );
    console.log('   US:', data.us);
    console.log('   States:', Object.keys(data.states || {}).length);
    console.log('   Meta:', data.meta?.source || data.meta);
  } catch (err) {
    console.error('   Refresh failed:', err.response?.data || err.message);
    process.exit(1);
  }

  // 2. Generate maps_landing and write to GCS (data/maps_landing.json)
  console.log('\n2. POST /api/admin/maps-landing/generate ...');
  try {
    const { data } = await axios.post(
      `${baseUrl}/api/admin/maps-landing/generate`,
      {},
      { timeout: 300000, headers: { 'Content-Type': 'application/json' } }
    );
    console.log('   Result:', data);
    console.log('   Maps landing written to GCS (data/maps_landing.json)');
  } catch (err) {
    console.error('   Generate failed:', err.response?.data || err.message);
    process.exit(1);
  }

  console.log('\nDone. Public /maps (All states) should now serve party data and polygons from GCS.');
}

main();
