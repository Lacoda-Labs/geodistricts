/**
 * Shared helpers: GeoJSON polygons -> SVG string -> WebP (Sharp).
 * Used by generate-geodistricts-all-raster.js and generate-state-map-rasters.js.
 */

const sharp = require('sharp');

/** CONUS viewport matching frontend geo-svg CONUS_BOUNDS (800×500 viewBox). */
const CONUS_VIEW = {
  minLng: -125,
  minLat: 24,
  maxLng: -66,
  maxLat: 50,
  x1: 40,
  y1: 40,
  x2: 760,
  y2: 460,
  width: 800,
  height: 500,
};

const REP_STOPS = [
  { v: 100, hex: '#FFCDD2' },
  { v: 200, hex: '#EF9A9A' },
  { v: 300, hex: '#E57373' },
  { v: 400, hex: '#E57373' },
  { v: 500, hex: '#E57373' },
];
const DEM_STOPS = [
  { v: 100, hex: '#BBDEFB' },
  { v: 200, hex: '#90CAF9' },
  { v: 300, hex: '#64B5F6' },
  { v: 400, hex: '#64B5F6' },
  { v: 500, hex: '#64B5F6' },
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

function createProjector(view) {
  const { minLng, minLat, maxLng, maxLat, x1, y1, x2, y2 } = view;
  return function project(lng, lat) {
    const x = x1 + ((lng - minLng) / (maxLng - minLng)) * (x2 - x1);
    const y = y2 - ((lat - minLat) / (maxLat - minLat)) * (y2 - y1);
    return [x, y];
  };
}

function ringToPathD(ring, project) {
  if (!Array.isArray(ring) || ring.length < 2) return '';
  const [first, ...rest] = ring;
  const [x0, y0] = project(first[0], first[1]);
  let d = `M ${x0} ${y0}`;
  for (const c of rest) {
    const [x, y] = project(c[0], c[1]);
    d += ` L ${x} ${y}`;
  }
  return `${d} Z`;
}

function polygonToPathDs(feature, project) {
  const geom = feature && feature.geometry;
  if (!geom || geom.type !== 'Polygon') return [];
  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const paths = [ringToPathD(coords[0], project)];
  for (let i = 1; i < coords.length; i++) paths.push(ringToPathD(coords[i], project));
  return paths;
}

function multiPolygonToPathDs(feature, project) {
  const geom = feature && feature.geometry;
  if (!geom || geom.type !== 'MultiPolygon') return [];
  const paths = [];
  for (const polygon of geom.coordinates || []) {
    if (polygon && polygon[0]) paths.push(ringToPathD(polygon[0], project));
  }
  return paths;
}

function featureToPathDs(feature, project) {
  const geom = feature && feature.geometry;
  if (!geom) return [];
  if (geom.type === 'Polygon') return polygonToPathDs(feature, project);
  if (geom.type === 'MultiPolygon') return multiPolygonToPathDs(feature, project);
  return [];
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extendBounds(bounds, lng, lat) {
  if (bounds == null) {
    return { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat };
  }
  return {
    minLng: Math.min(bounds.minLng, lng),
    maxLng: Math.max(bounds.maxLng, lng),
    minLat: Math.min(bounds.minLat, lat),
    maxLat: Math.max(bounds.maxLat, lat),
  };
}

function boundsFromRing(ring, bounds) {
  let b = bounds;
  if (!Array.isArray(ring)) return b;
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    b = extendBounds(b, c[0], c[1]);
  }
  return b;
}

function boundsFromFeature(feature) {
  const geom = feature && feature.geometry;
  if (!geom) return null;
  let b = null;
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates || []) b = boundsFromRing(ring, b);
  } else if (geom.type === 'MultiPolygon') {
    for (const polygon of geom.coordinates || []) {
      if (polygon && polygon[0]) b = boundsFromRing(polygon[0], b);
    }
  }
  return b;
}

function mergeBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minLng: Math.min(a.minLng, b.minLng),
    maxLng: Math.max(a.maxLng, b.maxLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat),
  };
}

function padBounds(bounds, padRatio = 0.06) {
  if (!bounds) return CONUS_VIEW;
  const dLng = (bounds.maxLng - bounds.minLng) * padRatio || 0.5;
  const dLat = (bounds.maxLat - bounds.minLat) * padRatio || 0.5;
  return {
    minLng: bounds.minLng - dLng,
    maxLng: bounds.maxLng + dLng,
    minLat: bounds.minLat - dLat,
    maxLat: bounds.maxLat + dLat,
  };
}

/**
 * Build SVG for full US landing payload (CONUS projection).
 * @param {object} landing - maps_landing { polygonsByState, districtPartyByState }
 */
function buildLandingSvgConus(landing) {
  const project = createProjector(CONUS_VIEW);
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
      const pathDs = featureToPathDs(feature, project);
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

/**
 * One state's final districts (and optional state outline) to SVG in 800×500.
 * @param {object} poly - { finalDistrictPolygons[], statePolygon? }
 * @param {object} partyByKey - district_party map for groupKey
 */
function buildStateDistrictsSvg(poly, partyByKey) {
  let b = null;
  const features = [];
  if (poly.statePolygon) {
    const sb = boundsFromFeature(poly.statePolygon);
    b = mergeBounds(b, sb);
    features.push({ feature: poly.statePolygon, pctDem: null, isOutline: true });
  }
  const districts = poly.finalDistrictPolygons || [];
  districts.forEach((feature, index) => {
    const fb = boundsFromFeature(feature);
    b = mergeBounds(b, fb);
    const groupKey = `${index + 1}-${index + 1}`;
    const party = partyByKey[groupKey];
    const pctDem = party && typeof party.pctDem === 'number' ? party.pctDem : 0.5;
    features.push({ feature, pctDem, isOutline: false });
  });
  const padded = padBounds(b);
  const view = {
    ...CONUS_VIEW,
    minLng: padded.minLng,
    maxLng: padded.maxLng,
    minLat: padded.minLat,
    maxLat: padded.maxLat,
  };
  const project = createProjector(view);
  const pathEls = [];
  for (const { feature, pctDem, isOutline } of features) {
    const pathDs = featureToPathDs(feature, project);
    const fill = isOutline ? '#e8e8e8' : getTractColorByParty(pctDem);
    const stroke = isOutline ? '#666' : '#333';
    const sw = isOutline ? 1 : 0.5;
    for (const d of pathDs) {
      if (d) pathEls.push(`<path d="${escapeXml(d)}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <rect width="800" height="500" fill="#f5f5f5"/>
  <g>${pathEls.join('\n')}</g>
</svg>`;
}

/**
 * @param {string} svgString
 * @param {string} outputPath
 * @param {{ quality?: number }} opts
 */
async function writeSvgToWebpFile(svgString, outputPath, opts = {}) {
  const quality = opts.quality ?? 90;
  await sharp(Buffer.from(svgString)).webp({ quality }).toFile(outputPath);
}

module.exports = {
  CONUS_VIEW,
  getTractColorByParty,
  buildLandingSvgConus,
  buildStateDistrictsSvg,
  writeSvgToWebpFile,
  featureToPathDs,
  boundsFromFeature,
  mergeBounds,
  padBounds,
};
