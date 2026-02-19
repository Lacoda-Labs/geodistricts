/**
 * Simplify union polygon geometry for display and smaller payloads:
 * - Round coordinates to N decimal places (~11m at 4 decimals, ~1.1m at 5)
 * - Remove consecutive duplicate points in each ring
 * - Optionally apply Turf simplify (Douglas-Peucker) to reduce vertex count
 *
 * Use when sending union/district polygons to the client.
 */

const turf = require('@turf/turf');

/**
 * Default options for union polygon simplification.
 * - decimals: 5 (~1.1m precision) is sufficient for map display
 * - simplifyTolerance: 0 = disabled; set in degrees (e.g. 0.00001) for Douglas-Peucker
 */
const DEFAULT_OPTIONS = {
  decimals: 5,
  removeDuplicatePoints: true,
  simplifyTolerance: 0
};

/**
 * Round a single coordinate to N decimal places.
 * @param {number} n
 * @param {number} decimals
 * @returns {number}
 */
function roundToDecimals(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Round coordinates in a ring (array of [lng, lat]) and optionally remove consecutive duplicates.
 * @param {number[][]} ring - GeoJSON ring (closed: first === last)
 * @param {number} decimals
 * @param {boolean} removeDuplicates
 * @returns {number[][]}
 */
function processRing(ring, decimals, removeDuplicates) {
  if (!Array.isArray(ring) || ring.length === 0) return ring;

  let coords = ring.map(pt =>
    Array.isArray(pt) && pt.length >= 2
      ? [roundToDecimals(pt[0], decimals), roundToDecimals(pt[1], decimals)]
      : pt
  );

  if (removeDuplicates) {
    const deduped = [];
    for (let i = 0; i < coords.length; i++) {
      const prev = deduped[deduped.length - 1];
      const curr = coords[i];
      if (!prev || prev[0] !== curr[0] || prev[1] !== curr[1]) {
        deduped.push(curr);
      }
    }
    // Ensure ring stays closed (GeoJSON spec: first position repeated at end)
    if (deduped.length >= 2 && (deduped[0][0] !== deduped[deduped.length - 1][0] || deduped[0][1] !== deduped[deduped.length - 1][1])) {
      deduped.push(deduped[0]);
    }
    coords = deduped;
  }

  return coords;
}

/**
 * Simplify a single Polygon's coordinates (outer ring + holes).
 * @param {object} geom - GeoJSON Polygon geometry { type: 'Polygon', coordinates: [ outer, ...holes ] }
 * @param {object} options
 * @returns {object} New geometry object
 */
function simplifyPolygon(geom, options) {
  const { decimals, removeDuplicatePoints } = options;
  const rings = (geom.coordinates || []).map(ring =>
    processRing(ring, decimals, removeDuplicatePoints)
  );
  return { type: 'Polygon', coordinates: rings };
}

/**
 * Simplify a MultiPolygon's coordinates.
 * @param {object} geom - GeoJSON MultiPolygon geometry
 * @param {object} options
 * @returns {object} New geometry object
 */
function simplifyMultiPolygon(geom, options) {
  const { decimals, removeDuplicatePoints } = options;
  const polygons = (geom.coordinates || []).map(polyCoords =>
    polyCoords.map(ring => processRing(ring, decimals, removeDuplicatePoints))
  );
  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Reduce precision of tract geometry for union/dissolve (round only, no dedup/simplify).
 * Use when state has many tracts to speed up Turf operations; shared boundaries stay aligned.
 *
 * @param {object} geometry - GeoJSON Polygon or MultiPolygon
 * @param {object} [options]
 * @param {number} [options.decimals=5] - Decimal places for coordinates (~1.1m at 5)
 * @returns {object} New geometry object (same type as input), or original if invalid
 */
function reduceTractGeometryPrecision(geometry, options = {}) {
  if (!geometry || !geometry.coordinates) return geometry;
  const decimals = options.decimals ?? DEFAULT_OPTIONS.decimals;
  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates || []).map(ring =>
      processRing(ring, decimals, false)
    );
    return { type: 'Polygon', coordinates: rings };
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons = (geometry.coordinates || []).map(polyCoords =>
      polyCoords.map(ring => processRing(ring, decimals, false))
    );
    return { type: 'MultiPolygon', coordinates: polygons };
  }
  return geometry;
}

/**
 * Simplify union polygon geometry for display: reduce precision, remove duplicate points,
 * and optionally apply Turf simplify.
 *
 * @param {object} geometry - GeoJSON geometry (Polygon or MultiPolygon)
 * @param {object} [options]
 * @param {number} [options.decimals=5] - Decimal places for coordinates (~1.1m at 5)
 * @param {boolean} [options.removeDuplicatePoints=true] - Remove consecutive duplicate points
 * @param {number} [options.simplifyTolerance=0] - If > 0, apply turf.simplify with this tolerance (degrees)
 * @returns {object} New geometry object (same type as input), or original if invalid
 */
function simplifyUnionGeometry(geometry, options = {}) {
  if (!geometry || !geometry.coordinates) return geometry;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { simplifyTolerance } = opts;

  let result;
  if (geometry.type === 'Polygon') {
    result = simplifyPolygon(geometry, opts);
  } else if (geometry.type === 'MultiPolygon') {
    result = simplifyMultiPolygon(geometry, opts);
  } else {
    return geometry;
  }

  if (simplifyTolerance > 0) {
    try {
      const feature = turf.feature(result);
      const simplified = turf.simplify(feature, { tolerance: simplifyTolerance, highQuality: true });
      if (simplified && simplified.geometry) {
        result = simplified.geometry;
      }
    } catch (err) {
      // If simplify fails (e.g. invalid geometry), return result without simplify
    }
  }

  return result;
}

module.exports = {
  simplifyUnionGeometry,
  reduceTractGeometryPrecision,
  DEFAULT_OPTIONS
};
