export const environment = {
  production: true,
  apiUrl: 'https://geodistricts-api-288960974559.us-central1.run.app/api',
  censusProxyUrl: 'https://geodistricts-api-288960974559.us-central1.run.app', // Production - integrated into geodistricts-api
  /**
   * CDN base for `states/{ST}.json` and `states/{ST}.webp` (no trailing slash).
   * Example: `https://storage.googleapis.com/YOUR_BUCKET/maps`
   */
  cdnBaseUrl: 'https://maps-cdn.geodistricts.org/public-maps',
  /**
   * Full URL to national GeoDistricts WebP, or leave empty to use `{cdnBaseUrl}/geodistricts-all-119.webp`.
   * Generate: `node backend/scripts/generate-geodistricts-all-raster.js`; upload to CDN. See doc/pages/STATIC_MAPS_CDN.md
   */
  staticAllMapImageUrl: '',
};

