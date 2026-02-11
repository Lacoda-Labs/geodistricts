/**
 * Build static hero assets for the home page: precomputed CONUS path JSON and a raster image.
 * Fetches 119th Congress GeoJSON from Lewis repo, projects to CONUS viewBox, writes:
 *   - frontend/public/assets/hero-conus-119.json  (for animated SVG)
 *   - frontend/public/assets/hero-conus-119.svg    (intermediate, light stroke)
 *   - frontend/public/assets/hero-conus-119.webp  (transparent, light gray lines)
 *
 * Usage: node scripts/build-hero-asset.js
 * Requires: npm install axios puppeteer (axios at root; puppeteer for SVG→WebP)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONGRESS = 119;
const GITHUB_API = 'https://api.github.com/repos/JeffreyBLewis/congressional-district-boundaries/contents/GeoJson';
const RAW_BASE = 'https://raw.githubusercontent.com/JeffreyBLewis/congressional-district-boundaries/master/GeoJson';

// Match frontend CONUS_BOUNDS (geo-svg.ts) – viewBox 0 0 800 500, CONUS in (40,40)-(760,460)
const CONUS_BOUNDS = {
  minLng: -125,
  minLat: 24,
  maxLng: -66,
  maxLat: 50,
  x1: 40,
  y1: 40,
  x2: 760,
  y2: 460
};

const CONUS_EXCLUDE = new Set(['Alaska', 'Hawaii']);
const FILE_REGEX = /^(.+)_(\d+)_to_(\d+)\.geojson$/i;
const ASSETS_DIR = path.join(__dirname, '..', 'frontend', 'public', 'assets');

function project(lng, lat, b) {
  const x = b.x1 + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (b.x2 - b.x1);
  const y = b.y2 - ((lat - b.minLat) / (b.maxLat - b.minLat)) * (b.y2 - b.y1);
  return [x, y];
}

function ringToPathD(ring, b) {
  if (!ring || ring.length < 2) return '';
  const [x0, y0] = project(ring[0][0], ring[0][1], b);
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1], b);
    d += ` L ${x} ${y}`;
  }
  return d + ' Z';
}

function geometryToPathDs(geom, b) {
  const out = [];
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    geom.coordinates.forEach(ring => {
      const d = ringToPathD(ring, b);
      if (d) out.push(d);
    });
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    geom.coordinates.forEach(poly => {
      poly.forEach(ring => {
        const d = ringToPathD(ring, b);
        if (d) out.push(d);
      });
    });
  }
  return out;
}

/** One array of path d strings per feature (district). */
function featureCollectionToPathDsByFeature(collection, b) {
  return (collection.features || [])
    .map(f => geometryToPathDs(f.geometry, b))
    .filter(p => p.length > 0);
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'GeoDistricts' } }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return httpsGet(new URL(res.headers.location, url).href).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
    });
    req.on('error', reject);
  });
}

async function listGeoJsonFiles() {
  const url = GITHUB_API + '?per_page=100';
  const data = await httpsGet(url);
  if (!Array.isArray(data)) return [];
  return data.filter(f => f.type === 'file' && f.name && f.name.endsWith('.geojson'));
}

async function fetchGeoJson(filename) {
  const url = `${RAW_BASE}/${encodeURIComponent(filename)}`;
  return httpsGet(url);
}

async function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  console.log('Listing GeoJSON files...');
  const files = await listGeoJsonFiles();
  const matching = files
    .map(f => {
      const m = f.name.match(FILE_REGEX);
      if (!m) return null;
      const start = parseInt(m[2], 10);
      const end = parseInt(m[3], 10);
      if (CONGRESS < start || CONGRESS > end) return null;
      if (CONUS_EXCLUDE.has(m[1])) return null;
      return { stateName: m[1], name: f.name };
    })
    .filter(Boolean);

  console.log(`Fetching ${matching.length} CONUS state GeoJSON files...`);
  const districts = [];
  const allPathDs = [];

  for (const { stateName, name } of matching) {
    try {
      const geo = await fetchGeoJson(name);
      const byFeature = featureCollectionToPathDsByFeature(geo, CONUS_BOUNDS);
      byFeature.forEach(paths => {
        districts.push({ paths, stateKey: stateName });
        allPathDs.push(...paths);
      });
    } catch (e) {
      console.error(`  Skip ${stateName}: ${e.message}`);
    }
  }

  const viewBox = '0 0 800 500';
  const payload = { viewBox, districts };

  const jsonPath = path.join(ASSETS_DIR, 'hero-conus-119.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload), 'utf8');
  console.log(`Wrote ${jsonPath}`);

  function buildSvg(strokeColor) {
    const paths = allPathDs
      .map(d => `<path d="${d.replace(/"/g, '&quot;')}" fill="none" stroke="${strokeColor}" stroke-width="0.6"/>`)
      .join('\n  ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="800" height="500">
  <g class="boundaries-layer">
  ${paths}
  </g>
</svg>`;
  }

  const strokeLightGray = 'rgba(80, 80, 80, 0.6)';
  const svgForWebp = buildSvg(strokeLightGray);
  const svgPath = path.join(ASSETS_DIR, 'hero-conus-119.svg');
  fs.writeFileSync(svgPath, svgForWebp, 'utf8');
  console.log(`Wrote ${svgPath}`);

  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setViewport({ width: 800, height: 500, deviceScaleFactor: 2 });

    const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;} body { background: transparent !important; }</style></head><body>${svgForWebp}</body></html>`;
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const el = await page.$('svg');
    if (!el) throw new Error('SVG not found');
    const webpPath = path.join(ASSETS_DIR, 'hero-conus-119.webp');
    await el.screenshot({ path: webpPath, type: 'webp', omitBackground: true });
    await browser.close();
    console.log('Wrote hero-conus-119.webp');
  } catch (e) {
    console.warn('Could not generate WebP (install puppeteer: npm install puppeteer):', e.message);
  }

  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
