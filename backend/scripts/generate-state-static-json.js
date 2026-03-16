/**
 * Generate per-state static JSON for CDN/public site. Each file contains state metadata and
 * geodistricts array (party %, population, variance when available). Used so the frontend can
 * load state view from CDN without hitting Firestore/API.
 *
 * Schema: { stateCode, stateName, districtCount, targetPopulation, finalStepNumber, geodistricts: [...], stateMapImageUrl? }
 * geodistricts: [{ groupKey, startDistrictNumber, endDistrictNumber, population?, variance?, pctDem, pctRep, leadingParty, leadingPartyPct, imageUrl? }]
 *
 * Usage:
 *   node backend/scripts/generate-state-static-json.js [path-to-maps_landing.json] [output-dir]
 *   Default: data/maps_landing.json, output dir data/static-states (or states/ under output-dir).
 *   Set GET_MAPS_LANDING_URL to fetch landing from API instead of file.
 *
 * Upload output dir to CDN; set frontend environment.cdnBaseUrl so state JSON is at {cdnBaseUrl}/states/{stateCode}.json.
 */

const fs = require('fs');
const path = require('path');

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

async function loadMapsLanding(inputPath, apiUrl) {
  if (apiUrl) {
    const axios = require('axios');
    const { data } = await axios.get(apiUrl, { timeout: 60000 });
    return data;
  }
  const fullPath = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

function buildStatePayload(stateCode, poly, partyByKey, statePopulation, districtCount) {
  const stateName = STATE_NAMES[stateCode] || stateCode;
  const targetPopulation = districtCount > 0 && statePopulation > 0
    ? Math.round(statePopulation / districtCount)
    : 0;
  const geodistricts = [];
  const polygons = poly.finalDistrictPolygons || [];
  for (let i = 0; i < polygons.length; i++) {
    const groupKey = `${i + 1}-${i + 1}`;
    const party = partyByKey[groupKey];
    const pctDem = party && typeof party.pctDem === 'number' ? party.pctDem : 0.5;
    const pctRep = party && typeof party.pctRep === 'number' ? party.pctRep : 1 - pctDem;
    const leadingParty = pctDem >= 0.5 ? 'D' : 'R';
    const leadingPartyPct = pctDem >= 0.5 ? pctDem : pctRep;
    geodistricts.push({
      groupKey,
      startDistrictNumber: i + 1,
      endDistrictNumber: i + 1,
      population: null,
      variance: null,
      pctDem,
      pctRep,
      leadingParty,
      leadingPartyPct,
    });
  }
  return {
    stateCode,
    stateName,
    districtCount,
    targetPopulation,
    finalStepNumber: poly.finalStepNumber ?? null,
    geodistricts,
    stateMapImageUrl: null,
  };
}

async function main() {
  const inputPath = process.argv[2] || 'data/maps_landing.json';
  const outputDir = process.argv[3] || path.join(process.cwd(), 'data', 'static-states');
  const apiUrl = process.env.GET_MAPS_LANDING_URL || null;

  console.log('Loading maps_landing...');
  const landing = await loadMapsLanding(inputPath, apiUrl);
  const polygonsByState = landing.polygonsByState || {};
  const districtPartyByState = landing.districtPartyByState || {};

  fs.mkdirSync(outputDir, { recursive: true });
  const statesDir = path.join(outputDir, 'states');
  fs.mkdirSync(statesDir, { recursive: true });

  let count = 0;
  for (const stateCode of Object.keys(polygonsByState)) {
    const poly = polygonsByState[stateCode];
    if (!poly.hasFinalStep || !poly.finalDistrictPolygons?.length) continue;
    const partyByKey = districtPartyByState[stateCode] || {};
    const districtCount = poly.finalDistrictPolygons.length;
    const statePopulation = 0;
    const payload = buildStatePayload(stateCode, poly, partyByKey, statePopulation, districtCount);
    const outPath = path.join(statesDir, `${stateCode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    count++;
    console.log('  ', stateCode);
  }
  console.log(`Wrote ${count} state JSON files to ${statesDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
