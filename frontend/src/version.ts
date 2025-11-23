// Build version information
export const BUILD_VERSION = '2025-11-12-latlong-cached';
export const BUILD_DATE = new Date().toISOString();
export const ALGORITHM_VERSION = '20251122-0827';

export const VERSION_INFO = {
  buildVersion: BUILD_VERSION,
  buildDate: BUILD_DATE,
  algorithmVersion: ALGORITHM_VERSION,
  features: [
    'Lat/Long Division Algorithm with Firestore Caching',
    'Population-balanced district division using latitude/longitude lines',
    'Cached division steps to avoid recalculating',
    'Force invalidate option to bypass cache when needed',
    'Optimized for performance with backend caching'
  ]
};
