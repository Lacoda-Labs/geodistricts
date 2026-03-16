export const environment = {
  production: true,
  apiUrl: 'https://geodistricts-api-288960974559.us-central1.run.app/api',
  censusProxyUrl: 'https://geodistricts-api-288960974559.us-central1.run.app', // Production - integrated into geodistricts-api
  /** Base URL for CDN static assets (maps, state JSON). Empty = use API/Leaflet. */
  cdnBaseUrl: '',
  /** Static raster for All-states map (e.g. geodistricts-all-119.webp). Set to CDN path when asset is available. */
  staticAllMapImageUrl: '',
};

