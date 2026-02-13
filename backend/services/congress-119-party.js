/**
 * 119th Congress party affiliation loader
 * Reads data/congress-119-party.json and provides D/R counts per state and US total.
 * Used by maps-comparison and representation-comparison; exposed via GET /api/congress/119/party-summary.
 */

const path = require('path');
const fs = require('fs');

let cachedSummary = null;
let cachedUsHouseByState = null;

/**
 * Resolve path to data file (works when run from project root or backend/)
 */
function getDataPath() {
  const fromServices = path.join(__dirname, '..', '..', 'data', 'congress-119-party.json');
  if (fs.existsSync(fromServices)) return fromServices;
  const fromBackend = path.join(__dirname, '..', 'data', 'congress-119-party.json');
  if (fs.existsSync(fromBackend)) return fromBackend;
  return fromServices;
}

/**
 * Load raw data from JSON file
 */
function loadRaw() {
  const dataPath = getDataPath();
  if (!fs.existsSync(dataPath)) {
    return null;
  }
  const raw = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Get party summary: { us: { D, R }, states: { [stateCode]: { D, R } } }
 */
function getPartySummary() {
  if (cachedSummary) return cachedSummary;
  const data = loadRaw();
  if (!data || !data.states) {
    cachedSummary = { us: { D: 0, R: 0 }, states: {} };
    return cachedSummary;
  }
  let totalD = 0;
  let totalR = 0;
  const states = {};
  for (const [stateCode, counts] of Object.entries(data.states)) {
    const D = counts.D || 0;
    const R = counts.R || 0;
    states[stateCode] = { D, R };
    totalD += D;
    totalR += R;
  }
  cachedSummary = {
    us: { D: totalD, R: totalR },
    states,
  };
  return cachedSummary;
}

/**
 * Get US House delegation for a state (for representation-comparison)
 * Returns array of { district: '1', party: 'D'|'R' } in district order.
 */
function getUsHouseByState(stateCode) {
  if (cachedUsHouseByState && cachedUsHouseByState[stateCode]) {
    return cachedUsHouseByState[stateCode];
  }
  const data = loadRaw();
  if (!data || !data.states || !data.states[stateCode]) {
    return [];
  }
  const counts = data.states[stateCode];
  const result = [];
  for (let i = 0; i < (counts.D || 0); i++) {
    result.push({ district: String(result.length + 1), party: 'D' });
  }
  for (let i = 0; i < (counts.R || 0); i++) {
    result.push({ district: String(result.length + 1), party: 'R' });
  }
  if (!cachedUsHouseByState) cachedUsHouseByState = {};
  cachedUsHouseByState[stateCode] = result;
  return result;
}

function clearCache() {
  cachedSummary = null;
  cachedUsHouseByState = null;
}

module.exports = {
  getPartySummary,
  getUsHouseByState,
  loadRaw,
  clearCache,
};
