/**
 * Maps comparison: 119th Congress vs GeoDistricts party summary
 * Builds payload { us, states, meta } for GET /api/maps/state-comparison.
 * Refresh job: load 119th party, get final-step states and step data, run PoliGeo per geodistrict, aggregate D/R, compute swing, persist.
 */

const path = require('path');
const fs = require('fs');
const congress119Party = require('./congress-119-party');
const poligeoAnalyst = require('./poligeo-analyst');
const { getTractId } = require('./geodistrict-algorithm');
const { CONGRESSIONAL_DISTRICTS_BY_STATE } = require('./geodistrict-algorithm');

const VEST_YEAR_DEFAULT = 2024;
const COMPARISON_FILENAME = 'maps-state-comparison.json';

function getComparisonDataPath() {
  const fromServices = path.join(__dirname, '..', '..', 'data', COMPARISON_FILENAME);
  if (fs.existsSync(path.join(__dirname, '..', '..', 'data'))) return fromServices;
  const fromBackend = path.join(__dirname, '..', 'data', COMPARISON_FILENAME);
  return fromBackend;
}

/**
 * Load persisted comparison payload from data/maps-state-comparison.json
 * @returns {Object|null} { us, states, meta } or null
 */
function loadPersistedComparison() {
  const dataPath = getComparisonDataPath();
  if (!fs.existsSync(dataPath)) return null;
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('⚠️ Failed to load maps-state-comparison.json:', err.message);
    return null;
  }
}

/**
 * Save comparison payload to data/maps-state-comparison.json
 * @param {Object} payload - { us, states, meta }
 */
function savePersistedComparison(payload) {
  const dataPath = getComparisonDataPath();
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create data dir ${dir}: ${err.message}`);
    }
  }
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Extract 11-digit tract GEOIDs from a district group (censusTracts or censusTractIds).
 * @param {Object} group - district group from final step
 * @returns {string[]}
 */
function extractTractIdsFromGroup(group) {
  const ids = [];
  if (group.censusTractIds && Array.isArray(group.censusTractIds)) {
    for (const id of group.censusTractIds) {
      const normalized = String(id).replace(/\D/g, '').padStart(11, '0').substring(0, 11);
      if (normalized.length === 11) ids.push(normalized);
    }
  }
  if (group.censusTracts && Array.isArray(group.censusTracts)) {
    for (const tract of group.censusTracts) {
      const id = getTractId(tract) || tract.properties?.GEOID || tract.properties?.GEO_ID?.replace(/^US/, '');
      if (id) {
        const normalized = String(id).replace(/\D/g, '').padStart(11, '0').substring(0, 11);
        if (normalized.length === 11) ids.push(normalized);
      }
    }
  }
  return [...new Set(ids)];
}

/**
 * Assign one seat to D or R from PoliGeo result (pct_dem_pres >= 0.5 => D).
 * @param {Object} analysisResult - result from poligeo analyzeFromGeoids
 * @param {number} vestYear
 * @returns {'D'|'R'}
 */
function assignPartyFromAnalysis(analysisResult, vestYear) {
  const year = vestYear || Math.max(...(analysisResult.source_years || []));
  const results = analysisResult.results || {};
  const yearResult = results[year] || results[Object.keys(results).sort().pop()];
  if (!yearResult) return 'R';
  const pctDem = yearResult.pct_dem_pres != null ? yearResult.pct_dem_pres : 0.5;
  return pctDem >= 0.5 ? 'D' : 'R';
}

/**
 * Build full state comparison payload.
 * @param {Object} options
 * @param {() => Promise<string[]>} options.getFinalStepStates - returns state codes that have a final step
 * @param {(state: string) => Promise<{ data?: { districtGroups?: Array } }>} options.getFinalStep - returns final step for state
 * @param {number} [options.vestYear=2024]
 * @returns {Promise<{ us: Object, states: Object, meta: Object }>}
 */
async function buildStateComparisonPayload(options = {}) {
  const getFinalStepStates = options.getFinalStepStates || (async () => []);
  const getFinalStep = options.getFinalStep || (async () => ({ data: {} }));
  const vestYear = options.vestYear ?? VEST_YEAR_DEFAULT;

  const congressSummary = congress119Party.getPartySummary();
  const allStateCodes = Object.keys(CONGRESSIONAL_DISTRICTS_BY_STATE || {}).length
    ? Object.keys(CONGRESSIONAL_DISTRICTS_BY_STATE)
    : Object.keys(congressSummary.states || {});

  const finalStepStateCodes = await getFinalStepStates();
  const states = {};
  let usCongressD = 0;
  let usCongressR = 0;
  let usGeodistrictsD = 0;
  let usGeodistrictsR = 0;

  for (const stateCode of allStateCodes) {
    const congress = congressSummary.states[stateCode] || { D: 0, R: 0 };
    const congressD = congress.D || 0;
    const congressR = congress.R || 0;
    usCongressD += congressD;
    usCongressR += congressR;

    let geodistrictsD = 0;
    let geodistrictsR = 0;

    if (finalStepStateCodes.includes(stateCode)) {
      try {
        const stepResponse = await getFinalStep(stateCode);
        const stepData = stepResponse?.data || stepResponse;
        const groups = stepData?.districtGroups || [];
        for (const group of groups) {
          const geoids = extractTractIdsFromGroup(group);
          if (geoids.length === 0) continue;
          try {
            const analysis = await poligeoAnalyst.analyzeFromGeoids(geoids);
            const party = assignPartyFromAnalysis(analysis, vestYear);
            if (party === 'D') geodistrictsD++;
            else geodistrictsR++;
          } catch (err) {
            console.warn(`⚠️ PoliGeo failed for ${stateCode} group (${geoids.length} tracts):`, err.message);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Final step failed for ${stateCode}:`, err.message);
      }
    }

    usGeodistrictsD += geodistrictsD;
    usGeodistrictsR += geodistrictsR;

    const swing = geodistrictsD - congressD;
    states[stateCode] = {
      congressD,
      congressR,
      geodistrictsD,
      geodistrictsR,
      swing,
    };
  }

  const usSwing = usGeodistrictsD - usCongressD;
  const us = {
    congressD: usCongressD,
    congressR: usCongressR,
    geodistrictsD: usGeodistrictsD,
    geodistrictsR: usGeodistrictsR,
    swing: usSwing,
  };

  const meta = {
    generatedAt: new Date().toISOString(),
    vestYear,
    congress: 119,
  };

  return { us, states, meta };
}

module.exports = {
  buildStateComparisonPayload,
  extractTractIdsFromGroup,
  assignPartyFromAnalysis,
  loadPersistedComparison,
  savePersistedComparison,
  getComparisonDataPath,
};
