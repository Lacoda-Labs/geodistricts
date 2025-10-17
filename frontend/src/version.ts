// Build version information
export const BUILD_VERSION = '2024-01-13-brown-s4';
export const BUILD_DATE = new Date().toISOString();
export const ALGORITHM_VERSION = 'brown-s4-v1.0';

export const VERSION_INFO = {
  buildVersion: BUILD_VERSION,
  buildDate: BUILD_DATE,
  algorithmVersion: ALGORITHM_VERSION,
  features: [
    'Brown University S4 adjacency-based algorithm',
    'Pre-computed adjacency data from Diversity and Disparities dataset',
    'Queen\'s contiguity weights matrix for all US census tracts',
    'Reliable contiguity through external adjacency files',
    'Graph-based directional traversal with S4 data'
  ]
};
