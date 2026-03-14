/**
 * Generate maps_landing blob and write to GCS (data/maps_landing.json).
 * Calls POST /api/admin/maps-landing/generate on the running API.
 * Run after algorithm + build-all-union-polygons + maps-comparison refresh.
 *
 * Usage: node backend/scripts/generate-maps-landing.js [baseUrl]
 * Example: node backend/scripts/generate-maps-landing.js http://localhost:8080
 */

const axios = require('axios');

const baseUrl = process.argv[2] || process.env.API_URL || 'http://localhost:8080';

async function main() {
  console.log(`Calling POST ${baseUrl}/api/admin/maps-landing/generate ...`);
  try {
    const { data } = await axios.post(
      `${baseUrl}/api/admin/maps-landing/generate`,
      {},
      {
        timeout: 300000,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    console.log('Result:', data);
    console.log('Maps landing written to GCS (data/maps_landing.json)');
  } catch (err) {
    console.error('Generate failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
