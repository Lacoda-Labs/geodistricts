export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080/api',
  censusProxyUrl: 'http://localhost:8080', // Local development - integrated into geodistricts-api
  /** Base URL for CDN static assets (maps, state JSON). Empty = use API/Leaflet. */
  cdnBaseUrl: '',
  /** Static raster for All-states map (e.g. geodistricts-all-119.webp). Empty = use Leaflet + polygons. */
  staticAllMapImageUrl: '',
};
