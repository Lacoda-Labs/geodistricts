/**
 * Trigger maps state comparison refresh (119th vs GeoDistricts).
 * Calls POST /api/admin/maps-comparison/refresh on the running API.
 * Usage: node backend/scripts/refresh-maps-comparison.js [baseUrl]
 * Example: node backend/scripts/refresh-maps-comparison.js http://localhost:8080
 */

const axios = require('axios');

const baseUrl = process.argv[2] || process.env.API_URL || 'http://localhost:8080';

async function main() {
  console.log(`Calling POST ${baseUrl}/api/admin/maps-comparison/refresh ...`);
  try {
    const { data } = await axios.post(`${baseUrl}/api/admin/maps-comparison/refresh`, {}, {
      timeout: 600000,
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('US:', data.us);
    console.log('States:', Object.keys(data.states || {}).length);
    console.log('Meta:', data.meta);
    console.log('Saved to data/maps-state-comparison.json');
  } catch (err) {
    console.error('Refresh failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
