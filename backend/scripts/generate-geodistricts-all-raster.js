/**
 * Generate a static raster image (WebP) of the All-states GeoDistricts map for CDN/public site.
 * Uses maps_landing data: projects CONUS final district polygons to 800×500 (same as hero) and
 * fills by party (same color scale as frontend). Output: geodistricts-all-119.webp.
 *
 * Usage:
 *   node backend/scripts/generate-geodistricts-all-raster.js [path-to-maps_landing.json] [output.webp]
 *   If path omitted, reads data/maps_landing.json from repo root (or from API if GET_MAPS_LANDING_URL set).
 *   Example with API: GET_MAPS_LANDING_URL=https://your-api.run.app/api/maps/landing node backend/scripts/generate-geodistricts-all-raster.js
 *
 * Upload output to your CDN bucket and set frontend environment.staticAllMapImageUrl or cdnBaseUrl + geodistricts-all-119.webp.
 * See doc/pages/STATIC_MAPS_CDN.md.
 *
 * Requires: sharp (npm dependency). Run from repo root.
 */

const fs = require('fs');
const path = require('path');
const { buildLandingSvgConus, writeSvgToWebpFile } = require('../lib/polygon-raster-webp');

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
  const outputPath = process.argv[3] || path.join(process.cwd(), 'data', 'geodistricts-all-119.webp');
  const apiUrl = process.env.GET_MAPS_LANDING_URL || null;

  console.log('Loading maps_landing...');
  const landing = await loadMapsLanding(inputPath, apiUrl);
  if (!landing.polygonsByState && !landing.stateComparison) {
    console.error('Invalid maps_landing: missing polygonsByState');
    process.exit(1);
  }

  console.log('Building SVG...');
  const svg = buildLandingSvgConus(landing);
  const outDir = path.dirname(outputPath);
  if (outDir && outDir !== '.') {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (_e) {
      // ignore
    }
  }

  console.log('Rasterizing to WebP...');
  await writeSvgToWebpFile(svg, outputPath);

  console.log('Wrote', outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
