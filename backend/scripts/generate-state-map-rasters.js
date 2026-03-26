/**
 * Per-state GeoDistricts map rasters (WebP) for CDN. One file per state with final polygons.
 *
 * Usage:
 *   node backend/scripts/generate-state-map-rasters.js [path-to-maps_landing.json] [output-base-dir]
 *   Default: data/maps_landing.json, output base data/static-states → writes data/static-states/states/{ST}.webp (same folder as generate-state-static-json JSON)
 *   GET_MAPS_LANDING_URL=https://.../api/maps/landing to fetch landing JSON
 *
 * Upload *.webp next to state JSON on CDN (e.g. {cdnBaseUrl}/states/CA.webp).
 * Run generate-state-static-json.js with CDN_PUBLIC_BASE_URL so stateMapImageUrl is set.
 *
 * See doc/pages/STATIC_MAPS_CDN.md.
 */

const fs = require('fs');
const path = require('path');
const { buildStateDistrictsSvg, writeSvgToWebpFile } = require('../lib/polygon-raster-webp');

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

async function main() {
  const inputPath = process.argv[2] || 'data/maps_landing.json';
  const outputBase = process.argv[3] || path.join(process.cwd(), 'data', 'static-states');
  const outputDir = path.join(outputBase, 'states');
  const apiUrl = process.env.GET_MAPS_LANDING_URL || null;

  console.log('Loading maps_landing...');
  const landing = await loadMapsLanding(inputPath, apiUrl);
  const polygonsByState = landing.polygonsByState || {};
  const districtPartyByState = landing.districtPartyByState || {};

  fs.mkdirSync(outputDir, { recursive: true });

  let count = 0;
  for (const stateCode of Object.keys(polygonsByState)) {
    const poly = polygonsByState[stateCode];
    if (!poly.hasFinalStep || !poly.finalDistrictPolygons?.length) continue;
    const partyByKey = districtPartyByState[stateCode] || {};
    const svg = buildStateDistrictsSvg(poly, partyByKey);
    const outPath = path.join(outputDir, `${stateCode}.webp`);
    await writeSvgToWebpFile(svg, outPath);
    count++;
    console.log('  ', stateCode, '->', outPath);
  }
  console.log(`Wrote ${count} state WebP files to ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
