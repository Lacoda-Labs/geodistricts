/**
 * Generate a static raster image (WebP) of the All-states GeoDistricts map for CDN/public site.
 * Uses maps_landing data: projects CONUS final district polygons to 800×500 (same as hero) and
 * fills by party (same color scale as frontend). Output: geodistricts-all-119.webp.
 *
 * Usage:
 *   node backend/scripts/generate-geodistricts-all-raster.js [path-to-maps_landing.json] [output.webp]
 *   If path omitted, reads data/maps_landing.json from repo root (or from API if GET_MAPS_LANDING_URL set).
 *   Example with API: GET_MAPS_LANDING_URL=https://your-api.run.app/api/maps/landing node backend/scripts/generate-geodistricts-all-raster.js
 *   Upload output to GCS/CDN and set frontend environment.staticAllMapImageUrl (or cdnBaseUrl) to the asset URL.
 *
 * Requires: sharp (npm dependency). Run from repo root.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Same as frontend CONUS_BOUNDS (geo-svg.ts) – continental US in 800×500 viewBox
const CONUS = {
  minLng: -125,
  minLat: 24,
  maxLng: -66,
  maxLat: 50,
  x1: 40,
  y1: 40,
  x2: 760,
  y2: 460,
};

// Party color stops (match maps-page.component.ts DEMOCRATIC_STOPS / REPUBLICAN_STOPS)
const REP_STOPS = [
  { v: 100, hex: '#FFCDD2' }, { v: 200, hex: '#EF9A9A' }, { v: 300, hex: '#E57373' },
  { v: 400, hex: '#E57373' }, { v: 500, hex: '#E57373' },
];
const DEM_STOPS = [
  { v: 100, hex: '#BBDEFB' }, { v: 200, hex: '#90CAF9' }, { v: 300, hex: '#64B5F6' },
  { v: 400, hex: '#64B5F6' }, { v: 500, hex: '#64B5F6' },
];

function colorFromStops(value, stops) {
  const v = Math.max(100, Math.min(500, value));
  const index = Math.min(4, Math.max(0, Math.round((v - 100) / 100)));
  return stops[index].hex;
}

function getTractColorByParty(pctDem) {
  const t = Math.max(0, Math.min(1, pctDem));
  if (t >= 0.5) {
    const value = 100 + ((t - 0.5) / 0.5) * 400;
    return colorFromStops(value, DEM_STOPS);
  }
  const pctRep = 1 - t;
  const value = 100 + ((pctRep - 0.5) / 0.5) * 400;
  return colorFromStops(value, REP_STOPS);
}

function project(lng, lat) {
  const x = CONUS.x1 + ((lng - CONUS.minLng) / (CONUS.maxLng - CONUS.minLng)) * (CONUS.x2 - CONUS.x1);
  const y = CONUS.y2 - ((lat - CONUS.minLat) / (CONUS.maxLat - CONUS.minLat)) * (CONUS.y2 - CONUS.y1);
  return [x, y];
}

function ringToPathD(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return '';
  const [first, ...rest] = ring;
  const [x0, y0] = project(first[0], first[1]);
  let d = `M ${x0} ${y0}`;
  for (const c of rest) {
    const [x, y] = project(c[0], c[1]);
    d += ` L ${x} ${y}`;
  }
  return d + ' Z';
}

function polygonToPathDs(feature) {
  const geom = feature && feature.geometry;
  if (!geom || geom.type !== 'Polygon') return [];
  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const paths = [];
  paths.push(ringToPathD(coords[0]));
  for (let i = 1; i < coords.length; i++) paths.push(ringToPathD(coords[i]));
  return paths;
}

function multiPolygonToPathDs(feature) {
  const geom = feature && feature.geometry;
  if (!geom || geom.type !== 'MultiPolygon') return [];
  const paths = [];
  for (const polygon of geom.coordinates || []) {
    if (polygon && polygon[0]) paths.push(ringToPathD(polygon[0]));
  }
  return paths;
}

function featureToPathDs(feature) {
  const geom = feature && feature.geometry;
  if (!geom) return [];
  if (geom.type === 'Polygon') return polygonToPathDs(feature);
  if (geom.type === 'MultiPolygon') return multiPolygonToPathDs(feature);
  return [];
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function buildSvg(landing) {
  const polygonsByState = landing.polygonsByState || {};
  const districtPartyByState = landing.districtPartyByState || {};
  const paths = [];
  for (const stateCode of Object.keys(polygonsByState)) {
    const poly = polygonsByState[stateCode];
    if (!poly || !poly.finalDistrictPolygons || !Array.isArray(poly.finalDistrictPolygons)) continue;
    const partyByKey = districtPartyByState[stateCode] || {};
    poly.finalDistrictPolygons.forEach((feature, index) => {
      const groupKey = `${index + 1}-${index + 1}`;
      const party = partyByKey[groupKey];
      const pctDem = party && typeof party.pctDem === 'number' ? party.pctDem : 0.5;
      const fill = getTractColorByParty(pctDem);
      const pathDs = featureToPathDs(feature);
      for (const d of pathDs) {
        if (d) paths.push({ d, fill });
      }
    });
  }
  const pathElements = paths
    .map((p) => `<path d="${escapeXml(p.d)}" fill="${escapeXml(p.fill)}" stroke="#333" stroke-width="0.5"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <rect width="800" height="500" fill="#f5f5f5"/>
  <g>${pathElements}</g>
</svg>`;
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
  const svg = buildSvg(landing);
  const outDir = path.dirname(outputPath);
  if (outDir && outDir !== '.') {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  console.log('Rasterizing to WebP...');
  await sharp(Buffer.from(svg))
    .webp({ quality: 90 })
    .toFile(outputPath);

  console.log('Wrote', outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
