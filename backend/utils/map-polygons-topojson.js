/**
 * Convert map-polygons API payload shapes to TopoJSON for smaller responses when
 * clients pass format=topojson. Uses topojson-server topology() with quantization.
 */

const { topology } = require('topojson-server');

/** ~1e5 matches ~5 decimal degree quantization (see topojson-server docs). */
const MAP_POLYGONS_TOPO_QUANTIZATION = 1e5;

function toFeature(geomOrFeature) {
  if (!geomOrFeature) return null;
  if (geomOrFeature.type === 'Feature' && geomOrFeature.geometry) {
    return geomOrFeature;
  }
  if (geomOrFeature.geometry) {
    return { type: 'Feature', properties: geomOrFeature.properties || {}, geometry: geomOrFeature.geometry };
  }
  if (geomOrFeature.type && geomOrFeature.coordinates) {
    return { type: 'Feature', properties: {}, geometry: geomOrFeature };
  }
  return null;
}

/**
 * @param {{ statePolygon?: object, finalDistrictPolygons?: object[] }} result - same fields as map-polygons JSON
 * @returns {object} TopoJSON Topology with objects statePolygon and/or districts (FeatureCollections)
 */
function mapPolygonsResultToTopology(result) {
  const objects = {};
  const stateFeat = toFeature(result.statePolygon);
  if (stateFeat && stateFeat.geometry) {
    objects.statePolygon = { type: 'FeatureCollection', features: [stateFeat] };
  }
  const rawDistricts = Array.isArray(result.finalDistrictPolygons) ? result.finalDistrictPolygons : [];
  const districtFeatures = rawDistricts.map(toFeature).filter((f) => f && f.geometry);
  if (districtFeatures.length > 0) {
    objects.districts = { type: 'FeatureCollection', features: districtFeatures };
  }
  if (Object.keys(objects).length === 0) {
    return null;
  }
  return topology(objects, MAP_POLYGONS_TOPO_QUANTIZATION);
}

module.exports = {
  mapPolygonsResultToTopology,
  MAP_POLYGONS_TOPO_QUANTIZATION
};
