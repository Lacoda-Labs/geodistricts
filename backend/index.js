const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const compression = require('compression');
const localCache = require('./local-cache');
const cloudStorageCache = require('./services/cloud-storage-cache');
const { GeodistrictAlgorithmService, getDistrictsForState, CONGRESSIONAL_DISTRICTS_BY_STATE, ALGORITHM_VERSION } = require('./services/geodistrict-algorithm');
const latLongDivisionService = require('./services/latlong-division');
const voterRegistrationLoader = require('./services/voter-registration-loader');
const vestDataLoader = require('./services/vest-data-loader');
const tractPartyPersistence = require('./services/tract-party-persistence');
const poligeoAnalyst = require('./services/poligeo-analyst');
const congress119Party = require('./services/congress-119-party');
const mapsComparison = require('./services/maps-comparison');
const logger = require('./utils/logger');
const { simplifyUnionGeometry } = require('./utils/geometry-simplify');
require('dotenv').config();

// Cache mode: when true, all backend cache (census, VEST, algorithm steps, tract-party) uses local filesystem only
const USE_LOCAL_CACHE = process.env.NODE_ENV !== 'production' || process.env.USE_LOCAL_CACHE === 'true';
console.log(`🗂️ Cache mode: ${USE_LOCAL_CACHE ? 'LOCAL FILES' : 'FIRESTORE'}`);

const app = express();
const PORT = process.env.PORT || 8080;

// Enable garbage collection for better memory management
if (global.gc) {
  logger.debug('Garbage collection is available');
} else {
  logger.debug('Garbage collection is not available - consider running with --expose-gc');
}

// Firestore: lazy init only when not using local cache (dev can start without GCP credentials)
let _firestore = null;
function getFirestore() {
  if (_firestore === null && !USE_LOCAL_CACHE) {
    _firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
    });
  }
  return _firestore;
}

/**
 * Test Firestore and Cloud Storage access on startup. Skipped when USE_LOCAL_CACHE (dev runs without GCP).
 */
async function testFirestoreAccess() {
  if (USE_LOCAL_CACHE) {
    logger.info('🗂️ Skipping Firestore/Cloud Storage test (local cache mode)');
    return;
  }
  try {
    logger.debug('🔍 Testing Firestore access...');
    logger.debug(`   Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'}`);
    logger.debug(`   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set'}`);
    
    const firestore = getFirestore();
    const testDoc = await getFirestore().collection('census_cache').doc('_startup_test').get();
    logger.info('✅ Firestore access verified - credentials are available');
    
    // Test Cloud Storage access (non-blocking - will fallback to Firestore if unavailable)
    try {
      await cloudStorageCache.initialize();
      logger.info('✅ Cloud Storage access verified');
    } catch (cloudError) {
      logger.warn('⚠️ Cloud Storage initialization warning:', cloudError.message);
      logger.warn('⚠️ Cloud Storage will be skipped if unavailable (fallback to Firestore chunking)');
    }
  } catch (error) {
    logger.error('❌ FIRESTORE ACCESS ERROR:', error.message);
    logger.error('❌ Full error:', error);
    
    if (error.message && error.message.includes('Could not load the default credentials')) {
      // Critical errors that cause exit should always be logged
      console.error('\n❌ FIRESTORE CREDENTIALS ERROR: Could not load default credentials');
      console.error('❌ Please run: gcloud auth application-default login');
      console.error('❌ Or set GOOGLE_APPLICATION_CREDENTIALS environment variable');
      console.error('❌ Make sure Firestore API is enabled: gcloud services enable firestore.googleapis.com');
      process.exit(1);
    } else if (error.message && error.message.includes('PERMISSION_DENIED')) {
      // Critical errors that cause exit should always be logged
      console.error('\n❌ FIRESTORE PERMISSION ERROR: Access denied');
      console.error('❌ Make sure your account has Firestore permissions');
      console.error('❌ Check: gcloud projects get-iam-policy geodistricts');
      process.exit(1);
    } else {
      // Other errors (like network issues) are OK - we'll handle them at runtime
      logger.warn('⚠️ Firestore test had an error (will continue):', error.message);
    }
  }
}

// Initialize Secret Manager
const secretClient = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts';
const CENSUS_API_KEY_SECRET_NAME = 'census-api-key-v2';

// Census API Configuration
const CENSUS_API_BASE = 'https://api.census.gov/data';
const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
// Boundary data: tract, county, and state boundaries are fetched from Census TIGERweb (not ArcGIS/Esri).
// Census TIGERweb Tracts_Blocks layer 10 = Census 2020 Tracts (replaces Esri USA_Census_Tracts)
const TIGERWEB_TRACT_LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10';
// Fallback when TIGERweb is unreachable (e.g. ETIMEDOUT, ECONNABORTED): Esri-hosted USA Census Tracts. Same query pattern; normalize field names.
const TIGERWEB_TRACT_LAYER_FALLBACK = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0';
// Census TIGERweb State_County layer 0 = States (STATE, GEOID, NAME, STUSAB)
const TIGERWEB_STATE_LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0';
const TIGERWEB_REQUEST_TIMEOUT_MS = 45000;
// Smaller batches reduce payload per request and help avoid timeouts; env override optional.
const TIGERWEB_TRACT_BATCH_SIZE = parseInt(process.env.TIGERWEB_TRACT_BATCH_SIZE || '200', 10) || 200;
const ACS_YEAR = '2022';
const ACS_DATASET = 'acs/acs5';

// Cache Configuration
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = '1.0';

// Middleware
app.use(helmet());
app.use(compression());

// CORS configuration - must be before other middleware
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:4200',
      'https://geodistricts.org',
      'https://www.geodistricts.org',
      'http://localhost:4200' // Allow localhost for development
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS: Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Log when request is received (before handler runs)
app.use((req, res, next) => {
  console.log(`📥 Received: ${req.method} ${req.originalUrl || req.url}`);
  next();
});

// Log when request completes (replaces generic combined format with explicit COMPLETED line)
app.use(morgan((tokens, req, res) => {
  const method = tokens.method(req, res);
  const url = tokens.url(req, res);
  const status = tokens.status(req, res);
  const length = tokens.res(req, res, 'content-length') || '-';
  return `✅ COMPLETED: ${method} ${url} ${status} ${length}\n`;
}));
// Increase body parser limit for large algorithm results (up to 200MB)
// Note: Cloud Run has a 32MB limit, but we set this higher for internal processing
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Timeout middleware for long-running requests
app.use((req, res, next) => {
  // Set timeout to 5 minutes for census data requests
  if (req.path.includes('/api/census/')) {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000);
  }
  next();
});

/**
 * Log when making an external data source request (Census, TIGERweb, etc.)
 */
function logExternalFetch(datasource, reason, details = '') {
  const detailStr = details ? ` | ${details}` : '';
  console.log(`>>> EXTERNAL FETCH | ${datasource} | ${reason}${detailStr}`);
}

// Census Proxy Utility Functions
/**
 * Get Census API key - prioritize environment variable for local development
 */
async function getCensusApiKey() {
  // For local development, prioritize environment variable
  const envApiKey = process.env.CENSUS_API_KEY;
  if (envApiKey) {
    console.log('Using Census API key from environment variable (local development)');
    console.log('API Key length:', envApiKey.length);
    console.log('API Key (first 10 chars):', envApiKey.substring(0, 10));
    return envApiKey.trim();
  }
  
  // For production, use Secret Manager
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${CENSUS_API_KEY_SECRET_NAME}/versions/latest`,
    });
    
    let apiKey = version.payload.data.toString();
    // Strip any whitespace characters (including newlines)
    apiKey = apiKey.trim();
    console.log('Successfully retrieved Census API key from Secret Manager (production)');
    console.log('API Key length after trim:', apiKey.length);
    console.log('API Key (first 10 chars):', apiKey.substring(0, 10));
    return apiKey;
  } catch (error) {
    console.error('Error retrieving Census API key from Secret Manager:', error);
    throw new Error('Census API key not found in Secret Manager or environment variables');
  }
}

/**
 * Generate cache key for requests
 */
function generateCacheKey(type, params) {
  // Filter out undefined values to avoid Firestore issues
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([key, value]) => value !== undefined)
  );
  const paramString = JSON.stringify(cleanParams);
  const hash = simpleHash(paramString);
  return `census_${type}_${hash}`;
}

/**
 * Simple hash function
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if cache entry is expired
 */
function isCacheExpired(timestamp, ttl) {
  // If TTL is null, cache never expires
  if (ttl === null || ttl === undefined) {
    return false;
  }
  return Date.now() - timestamp > ttl;
}

/** Known CA Pacific island tract IDs (step-0 geographic islands). Always excluded from isolation at steps 1+. */
const KNOWN_CA_ISLAND_TRACT_IDS = ['06037599000', '06037599100', '06075980401', '06083980100', '06111980000'];

/**
 * Build set of step-0 geographic island tract IDs for exclusion from isolation at steps 1+.
 * Includes water/special tracts (no geometry or tract code 990000/7990000 etc.) so they never appear as isolated.
 * When step 0 was cached before excludedTractIds existed, we add water/special from uniqueTracts here.
/**
 * Derive isolatedTractsByGroup (and isolatedComponentsByGroup) from persisted dgAdjacentGroupsByGroup.
 * Main component = largest by size; rest = isolated. Applies step0IslandSet exclusion when step > 0.
 * @param {Object} dgAdjacentGroupsByGroup - { [groupIndex]: Array<Array<string>> }
 * @param {Set<string>|null} step0IslandSet - Tract IDs to exclude from isolated (step-0 islands + non-movable)
 * @returns {{ isolatedTractsByGroup: Object, isolatedComponentsByGroup: Object }}
 */
function deriveIsolatedFromDgAdjacentGroups(dgAdjacentGroupsByGroup, step0IslandSet) {
  const isolatedTractsByGroup = {};
  const isolatedComponentsByGroup = {};
  for (const [key, components] of Object.entries(dgAdjacentGroupsByGroup)) {
    if (!Array.isArray(components) || components.length === 0) continue;
    let main = components[0];
    for (const comp of components) {
      if (comp.length > main.length) main = comp;
    }
    const isolatedComponents = components.filter(c => c !== main);
    if (isolatedComponents.length === 0) continue;
    let isolatedIds = [];
    const filteredComponents = [];
    for (const comp of isolatedComponents) {
      const filtered = step0IslandSet && step0IslandSet.size > 0
        ? comp.filter(id => !step0IslandSet.has(id))
        : comp;
      if (filtered.length > 0) {
        filteredComponents.push(filtered);
        isolatedIds = isolatedIds.concat(filtered);
      }
    }
    if (isolatedIds.length > 0) {
      isolatedTractsByGroup[key] = isolatedIds;
      isolatedComponentsByGroup[key] = filteredComponents;
    }
  }
  return { isolatedTractsByGroup, isolatedComponentsByGroup };
}

/**
 * For California at step > 0, always merges known Pacific island tract IDs so they are never reported as isolated.
 * @param {Object} algorithmState - Algorithm state (may have steps[0].islandTractsData, uniqueTracts)
 * @param {number} step - Current step number
 * @param {string[]|undefined} bodyStep0IslandTractIds - Optional array from request body
 * @param {string} [stateCode] - State FIPS (e.g. '06') or abbreviation (e.g. 'CA') for CA fallback
 * @returns {Set<string>|null}
 */
function buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds, stateCode) {
  const { getTractId, isWaterOrSpecialTract } = require('./services/geodistrict-algorithm');
  let set = Array.isArray(bodyStep0IslandTractIds) ? new Set(bodyStep0IslandTractIds) : null;
  const hasStep0Data = algorithmState?.steps?.[0]?.islandTractsData;
  const hasUniqueTracts = Array.isArray(algorithmState?.uniqueTracts) && algorithmState.uniqueTracts.length > 0;
  if (!set && step > 0 && (hasStep0Data || hasUniqueTracts)) {
    set = new Set();
    const islandTractsData = hasStep0Data ? algorithmState.steps[0].islandTractsData : null;
    if (islandTractsData?.islandTractsByGroup) {
      const byGroup = islandTractsData.islandTractsByGroup;
      for (const islandGroups of Object.values(byGroup)) {
        if (Array.isArray(islandGroups)) {
          for (const group of islandGroups) {
            if (Array.isArray(group)) group.forEach(id => set.add(id));
            else if (typeof group === 'string') set.add(group);
            else if (group && Array.isArray(group.tractIds)) group.tractIds.forEach(id => set.add(id));
          }
        }
      }
    }
    if (Array.isArray(islandTractsData?.excludedTractIds)) {
      islandTractsData.excludedTractIds.forEach(id => set.add(id));
    }
    // Add water/special tracts from uniqueTracts (covers cache without excludedTractIds, e.g. CA 06017990000, 06061990000)
    const uniqueTracts = algorithmState.uniqueTracts;
    if (Array.isArray(uniqueTracts) && uniqueTracts.length > 0) {
      let added = 0;
      for (const tract of uniqueTracts) {
        if (!isWaterOrSpecialTract(tract)) continue;
        const id = getTractId(tract);
        if (id && !set.has(id)) {
          set.add(id);
          added++;
        }
      }
      if (added > 0) {
        console.log(`🏝️ Step 0 exclusion: added ${added} water/special tract(s) from uniqueTracts (cache had no excludedTractIds)`);
      }
    }
  }
  // California at step > 0: always exclude known Pacific island tracts so they never appear as isolated
  const isCA = stateCode === '06' || stateCode === 'CA';
  if (step > 0 && isCA) {
    if (!set) set = new Set();
    let added = 0;
    for (const id of KNOWN_CA_ISLAND_TRACT_IDS) {
      if (!set.has(id)) {
        set.add(id);
        added++;
      }
    }
    if (added > 0) {
      console.log(`🏝️ Step 0 exclusion: added ${added} known CA Pacific island tract(s) (fallback)`);
    }
  }
  return set;
}

/**
 * Remove step-0 excluded tract IDs from a step's isolatedTractsData (so cached steps show correct list).
 * @param {Object} stepData - Step data with isolatedTractsData
 * @param {Set<string>} exclusionSet - Tract IDs to exclude from isolated lists
 */
function filterIsolatedTractsDataByExclusion(stepData, exclusionSet) {
  if (!stepData?.isolatedTractsData || !exclusionSet || exclusionSet.size === 0) return;
  const data = stepData.isolatedTractsData;
  if (data.isolatedTractIds && Array.isArray(data.isolatedTractIds)) {
    data.isolatedTractIds = data.isolatedTractIds.filter(id => !exclusionSet.has(id));
    data.totalIsolated = data.isolatedTractIds.length;
  }
  if (data.isolatedTractsByGroup && typeof data.isolatedTractsByGroup === 'object') {
    let groupsWithIsolation = 0;
    for (const key of Object.keys(data.isolatedTractsByGroup)) {
      const arr = data.isolatedTractsByGroup[key];
      if (!Array.isArray(arr)) continue;
      data.isolatedTractsByGroup[key] = arr.filter(id => !exclusionSet.has(id));
      if (data.isolatedTractsByGroup[key].length > 0) groupsWithIsolation++;
    }
    data.groupsWithIsolation = groupsWithIsolation;
  }
}

/**
 * Get data from cache (local files, Cloud Storage, or Firestore)
 * Uses Cloud Storage for large files (> 1MB), Firestore for small metadata
 */
async function getFromCache(key) {
  if (USE_LOCAL_CACHE) {
    return await localCache.getFromCache(key);
  } else {
    try {
      // First check Firestore for metadata/reference
      if (process.env.DEBUG_CACHE === 'true') {
        console.log(`🔍 FIRESTORE CACHE: Checking cache for key: ${key}`);
      }
      
      const data = await getCacheDoc(key);
      
      if (data) {
        // Check if expired
        if (isCacheExpired(data.timestamp, data.ttl)) {
          console.log(`⏰ FIRESTORE CACHE: Cache expired for key: ${key}, deleting`);
          await deleteCacheDoc(key);
          // Also delete from Cloud Storage if it exists there
          if (data.cloudStoragePath) {
            try {
              await cloudStorageCache.delete(key);
            } catch (e) {
              // Ignore errors
            }
          }
          return null;
        }
        
        // Check version
        if (data.version !== CACHE_VERSION) {
          console.log(`🔄 FIRESTORE CACHE: Cache version mismatch for key: ${key}, deleting`);
          await deleteCacheDoc(key);
          if (data.cloudStoragePath) {
            try {
              await cloudStorageCache.delete(key);
            } catch (e) {
              // Ignore errors
            }
          }
          return null;
        }
        
        // If data is stored in Cloud Storage, fetch it
        if (data.cloudStoragePath) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`📦 CLOUD STORAGE: Fetching large file from ${data.cloudStoragePath}`);
          }
          const cloudData = await cloudStorageCache.get(key);
          if (cloudData) {
            return {
              ...data,
              data: cloudData.data // Replace reference with actual data
            };
          } else {
            // Cloud Storage file missing, clean up Firestore reference
            console.warn(`⚠️ Cloud Storage file missing for ${key}, cleaning up Firestore reference`);
            await deleteCacheDoc(key);
            return null;
          }
        }
        
        // Data stored directly in Firestore (small files)
        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`✅ FIRESTORE CACHE HIT: Retrieved data for key: ${key}`);
        }
        return data;
      }
      
      // Not in Firestore, check Cloud Storage directly (for migration compatibility)
      if (process.env.DEBUG_CACHE === 'true') {
        console.log(`🔍 CLOUD STORAGE: Checking for key: ${key}`);
      }
      const cloudData = await cloudStorageCache.get(key);
      if (cloudData) {
        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`✅ CLOUD STORAGE HIT: Retrieved data for key: ${key}`);
        }
        return {
          data: cloudData.data,
          timestamp: cloudData.timestamp,
          ttl: null,
          version: CACHE_VERSION,
          source: 'U.S. Census Bureau',
          attribution: 'Data provided by the U.S. Census Bureau (public domain)',
          cloudStoragePath: `gs://${process.env.CENSUS_DATA_BUCKET || 'geodistricts-census-data'}/${cloudStorageCache.getFilePath(key)}`
        };
      }
      
      // Cache miss is expected for uncached entries - only log in debug mode
      if (process.env.DEBUG_CACHE === 'true') {
        console.log(`❌ CACHE MISS: No data found for key: ${key}`);
      }
      return null;
    } catch (error) {
      console.error('❌ CACHE ERROR: Failed to get from cache for key:', key);
      console.error('❌ CACHE ERROR:', error.message);
      return null;
    }
  }
}

/**
 * Store data in cache (local files, Cloud Storage, or Firestore)
 * Automatically uses Cloud Storage for large files (> 1MB), Firestore for small files
 */
async function setCache(key, data, ttl = CACHE_TTL) {
  if (USE_LOCAL_CACHE) {
    return await localCache.setCache(key, data, ttl);
  } else {
    try {
      const dataSize = JSON.stringify(data).length;
      const dataSizeMB = (dataSize / (1024 * 1024)).toFixed(2);
      
      // Use Cloud Storage for large files (> 1MB)
      if (dataSize > 1024 * 1024) {
        console.log(`📦 CLOUD STORAGE: Storing large file (${dataSizeMB} MB) for key: ${key}`);
        
        // Store in Cloud Storage
        const cloudStoragePath = await cloudStorageCache.set(key, data, {
          ttl: ttl ? ttl.toString() : 'null',
          source: 'U.S. Census Bureau'
        });
        
        // Store metadata reference in Firestore
        const cacheEntry = {
          cloudStoragePath: cloudStoragePath,
          timestamp: Date.now(),
          ttl: ttl,
          version: CACHE_VERSION,
          source: 'U.S. Census Bureau',
          attribution: 'Data provided by the U.S. Census Bureau (public domain)',
          size: dataSize,
          sizeMB: parseFloat(dataSizeMB),
          storedIn: 'cloud-storage'
        };
        
        const docRef = getFirestore().collection('census_cache').doc(key);
        await docRef.set(cacheEntry);
        
        console.log(`✅ CLOUD STORAGE: Successfully cached ${dataSizeMB} MB for key: ${key}`);
        console.log(`📊 CLOUD STORAGE: Path: ${cloudStoragePath}`);
      } else {
        // Store small files directly in Firestore
        console.log(`🔄 FIRESTORE CACHE: Storing small file (${dataSizeMB} MB) for key: ${key}`);
        
        const cacheEntry = {
          data: data,
          timestamp: Date.now(),
          ttl: ttl,
          version: CACHE_VERSION,
          source: 'U.S. Census Bureau',
          attribution: 'Data provided by the U.S. Census Bureau (public domain)',
          size: dataSize,
          storedIn: 'firestore'
        };
        
        const docRef = getFirestore().collection('census_cache').doc(key);
        await docRef.set(cacheEntry);
        
        console.log(`✅ FIRESTORE CACHE: Successfully cached data for key: ${key}, size: ${dataSize} bytes`);
        console.log(`📊 FIRESTORE CACHE: Document path: census_cache/${key}`);
      }
    } catch (error) {
      console.error('❌ CACHE ERROR: Failed to cache data for key:', key);
      console.error('❌ CACHE ERROR:', error.message);
      console.error('❌ CACHE ERROR:', error);
    }
  }
}

/**
 * Get a single census_cache document by key. When USE_LOCAL_CACHE, reads from local file cache.
 * When not local, reads from Firestore and resolves Cloud Storage payload if present.
 * @param {string} key - Document ID (e.g. algorithm_step_CA_100_1, state_tracts_CA)
 * @returns {Promise<object|null>} Document data or null
 */
async function getCacheDoc(key) {
  if (USE_LOCAL_CACHE) {
    return await localCache.getFromCache(key);
  }
  const firestore = getFirestore();
  const doc = await firestore.collection('census_cache').doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.cloudStoragePath) {
    try {
      const cloudData = await cloudStorageCache.get(key);
      if (cloudData && cloudData.data) return cloudData.data;
    } catch (err) {
      console.warn(`⚠️ getCacheDoc: Failed to load from Cloud Storage (${key}): ${err.message}`);
    }
    return data;
  }
  return data;
}

/**
 * Set a census_cache document. When USE_LOCAL_CACHE, writes to local file cache only.
 * When not local, writes to Firestore (or Cloud Storage + metadata for large payloads).
 * @param {string} key - Document ID
 * @param {object} data - Full document payload
 * @param {{ ttl?: number }} options - Optional; ttl for expiry
 */
async function setCacheDoc(key, data, options = {}) {
  if (USE_LOCAL_CACHE) {
    return await localCache.setCache(key, data, options.ttl ?? null);
  }
  const firestore = getFirestore();
  const FIRESTORE_INDEX_ERROR = 'too many index entries';
  const sizeBytes = JSON.stringify(data).length;
  try {
    await getFirestore().collection('census_cache').doc(key).set(data);
    return;
  } catch (err) {
    const isIndexError = err.message && err.message.includes(FIRESTORE_INDEX_ERROR);
    const isInvalidArg = err.code === 3 || (err.message && err.message.includes('INVALID_ARGUMENT'));
    if (!isIndexError && !isInvalidArg) throw err;
  }
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`📦 CLOUD STORAGE: Doc too large for Firestore (${sizeMB} MB), storing in Cloud Storage: ${key}`);
  const cloudStoragePath = await cloudStorageCache.set(key, data, {
    source: 'census-cache-doc',
    key
  });
  const metadataEntry = {
    cloudStoragePath,
    cloudStorage: true,
    timestamp: data.timestamp != null ? data.timestamp : Date.now(),
    ttl: data.ttl != null ? data.ttl : options.ttl ?? null
  };
  await getFirestore().collection('census_cache').doc(key).set(metadataEntry);
}

/**
 * Delete a census_cache document. When USE_LOCAL_CACHE, deletes from local file cache.
 * When not local, deletes from Firestore and Cloud Storage if present.
 * @param {string} key - Document ID
 */
async function deleteCacheDoc(key) {
  if (USE_LOCAL_CACHE) {
    return await localCache.deleteCacheEntry(key);
  }
  const firestore = getFirestore();
  const docSnap = await firestore.collection('census_cache').doc(key).get();
  if (docSnap.exists) {
    const data = docSnap.data();
    if (data.cloudStoragePath) {
      try {
        await cloudStorageCache.delete(key);
      } catch (e) {
        // ignore
      }
    }
    await firestore.collection('census_cache').doc(key).delete();
  }
}

/**
 * List census_cache document IDs, optionally filtered by key prefix. Used for emulating Firestore queries in local mode.
 * @param {string} [prefix] - If provided, only return keys that start with prefix
 * @returns {Promise<string[]>}
 */
async function listCacheDocIds(prefix) {
  if (USE_LOCAL_CACHE) {
    const info = await localCache.getCacheInfo();
    let keys = info.map(i => i.key);
    if (prefix) keys = keys.filter(k => k.startsWith(prefix));
    return keys;
  }
  const firestore = getFirestore();
  const snapshot = await getFirestore().collection('census_cache').get();
  let ids = snapshot.docs.map(d => d.id);
  if (prefix) ids = ids.filter(k => k.startsWith(prefix));
  return ids;
}

/**
 * Compress GeoJSON data to reduce size
 */
function compressGeoJson(geojson) {
  if (!geojson || !geojson.features) {
    return geojson;
  }
  
  // Ultra-compress for large datasets
  if (geojson.features.length > 1000) {
    return ultraCompressGeoJson(geojson);
  }
  
  return {
    ...geojson,
    features: geojson.features.map(feature => ({
      ...feature,
      geometry: simplifyGeometry(feature.geometry, 0.0001) // Reduce precision
    }))
  };
}

/**
 * Ultra-compress GeoJSON data for faster transfer
 */
function ultraCompressGeoJson(geojson) {
  if (!geojson || !geojson.features) {
    return geojson;
  }
  
  // Create a more compact format
  const compressedFeatures = geojson.features.map(feature => {
    // Round coordinates to 4 decimal places (about 11m precision)
    const compressCoordinates = (coords) => {
      if (Array.isArray(coords[0])) {
        return coords.map(compressCoordinates);
      }
      return coords.map(coord => Math.round(coord * 10000) / 10000);
    };
    
    return {
      t: feature.type,
      p: {
        s: feature.properties.STATE_FIPS,
        c: feature.properties.COUNTY_FIPS,
        t: feature.properties.TRACT_FIPS,
        pop: feature.properties.POPULATION || 0,
        intptlat: feature.properties.INTPTLAT || null,
        intptlon: feature.properties.INTPTLON || null
      },
      g: {
        t: feature.geometry.type,
        c: compressCoordinates(feature.geometry.coordinates)
      }
    };
  });
  
  return {
    t: 'FeatureCollection',
    f: compressedFeatures
  };
}

/**
 * Normalize and compress GeodistrictResult by:
 * 1. Extract all unique tracts and store them separately in state-level cache
 * 2. Replace full tract arrays with tract ID arrays in DistrictGroups
 * 3. Store only district group metadata (population, bounds, centroid) - NO tract geometries
 * 4. Return normalized result with state reference for tract lookup
 */
function compressGeodistrictResult(result, state) {
  if (!result) return result;
  
  // Use the same getTractId function as normalizeStepData to ensure consistent IDs
  const { getTractId } = require('./services/geodistrict-algorithm');
  
  // Step 1: Collect all unique tracts (for state-level cache)
  const tractMap = new Map(); // tractId -> compressed tract
  const tractIds = new Set();
  
  // Collect tracts from finalDistricts
  if (result.finalDistricts && Array.isArray(result.finalDistricts)) {
    result.finalDistricts.forEach(district => {
      if (district.censusTracts && Array.isArray(district.censusTracts)) {
        district.censusTracts.forEach(tract => {
          const tractId = getTractId(tract);
          if (tractId && !tractIds.has(tractId)) {
            tractIds.add(tractId);
            tractMap.set(tractId, compressTract(tract));
          }
        });
      }
    });
  }
  
  // Collect tracts from steps
  if (result.steps && Array.isArray(result.steps)) {
    result.steps.forEach(step => {
      if (step.districtGroups && Array.isArray(step.districtGroups)) {
        step.districtGroups.forEach(group => {
          if (group.censusTracts && Array.isArray(group.censusTracts)) {
            group.censusTracts.forEach(tract => {
              const tractId = getTractId(tract);
              if (tractId && !tractIds.has(tractId)) {
                tractIds.add(tractId);
                tractMap.set(tractId, compressTract(tract));
              }
            });
          }
        });
      }
    });
  }
  
  // Step 2: Create normalized structure with ONLY tract IDs and district group metadata
  // NO tract geometries are stored in step data
  const normalized = {
    ...result,
    _normalized: true,
    _normalizedVersion: '2.0', // Version 2.0: state-level tract cache
    _state: state, // Reference to state for tract cache lookup
    _tractCount: tractMap.size, // Number of unique tracts (for validation)
    finalDistricts: result.finalDistricts ? result.finalDistricts.map(district => ({
      startDistrictNumber: district.startDistrictNumber,
      endDistrictNumber: district.endDistrictNumber,
      totalDistricts: district.totalDistricts,
      totalPopulation: district.totalPopulation,
      bounds: district.bounds,
      centroid: district.centroid,
      // Only store tract IDs - geometries come from state cache
      censusTractIds: district.censusTracts ? district.censusTracts.map(t => getTractId(t)).filter(Boolean) : []
    })) : result.finalDistricts,
    steps: result.steps ? result.steps.map(step => ({
      step: step.step,
      level: step.level,
      description: step.description,
      totalGroups: step.totalGroups,
      totalDistricts: step.totalDistricts,
      divisionDirection: step.divisionDirection,
      divisionLine: step.divisionLine,
      divisionLines: step.divisionLines,
      // District groups with only metadata and tract IDs
      districtGroups: step.districtGroups ? step.districtGroups.map(group => ({
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.endDistrictNumber,
        totalDistricts: group.totalDistricts,
        totalPopulation: group.totalPopulation,
        bounds: group.bounds,
        centroid: group.centroid,
        lastDivisionDirection: group.lastDivisionDirection ?? null,
        // Only store tract IDs - geometries come from state cache
        censusTractIds: group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []
      })) : step.districtGroups
    })) : result.steps
  };
  
  // Return both normalized result and tract map for state-level caching
  return {
    normalizedResult: normalized,
    tractMap: Array.from(tractMap.entries()) // [tractId, compressedTract][]
  };
}

// Note: getTractId is now imported from geodistrict-algorithm.js to ensure consistent ID format
// This function was removed to avoid ID format mismatches between normalization and reconstruction

/**
 * Compress a single tract (reduce coordinate precision)
 */
function compressTract(tract) {
  if (!tract || !tract.geometry) return tract;
  
  const compressed = {
    type: tract.type,
    properties: tract.properties,
    geometry: {
      type: tract.geometry.type,
      coordinates: compressCoordinates(tract.geometry.coordinates)
    }
  };
  
  return compressed;
}

/**
 * Decompress GeodistrictResult by reconstructing tract arrays from state-level cache
 * @param result Normalized result (without tract geometries)
 * @param tractMap Map of tractId -> tract (from state-level cache)
 */
function decompressGeodistrictResult(result, tractMap) {
  if (!result) return result;
  
  // If not normalized, return as-is
  if (!result._normalized) {
    return result;
  }
  
  // Handle old format (v1.0) with embedded tract lookup
  if (result._tractLookup) {
    const oldTractMap = new Map(result._tractLookup);
    const reconstructTracts = (tractIds) => {
      if (!Array.isArray(tractIds)) return [];
      return tractIds.map(id => oldTractMap.get(id)).filter(Boolean);
    };
    
    const decompressed = {
      ...result,
      finalDistricts: result.finalDistricts ? result.finalDistricts.map(district => ({
        ...district,
        censusTracts: reconstructTracts(district.censusTractIds || [])
      })) : result.finalDistricts,
      steps: result.steps ? result.steps.map(step => ({
        ...step,
        districtGroups: step.districtGroups ? step.districtGroups.map(group => ({
          ...group,
          censusTracts: reconstructTracts(group.censusTractIds || [])
        })) : step.districtGroups
      })) : result.steps
    };
    
    // Clean up metadata
    delete decompressed._normalized;
    delete decompressed._tractLookup;
    decompressed.finalDistricts?.forEach(d => { if (d.censusTractIds) delete d.censusTractIds; });
    decompressed.steps?.forEach(s => {
      s.districtGroups?.forEach(g => { if (g.censusTractIds) delete g.censusTractIds; });
    });
    
    return decompressed;
  }
  
  // Handle new format (v2.0) with state-level tract cache
  if (!tractMap) {
    console.warn('⚠️ No tract map provided for decompression - returning normalized result');
    return result;
  }
  
  // Rebuild tract lookup map from provided tractMap
  const tractLookup = new Map(Array.isArray(tractMap) ? tractMap : Object.entries(tractMap));
  
  // Helper to reconstruct tract array from IDs
  const reconstructTracts = (tractIds) => {
    if (!Array.isArray(tractIds)) return [];
    return tractIds.map(id => tractLookup.get(id)).filter(Boolean);
  };
  
  // Reconstruct finalDistricts
  const decompressed = {
    ...result,
    finalDistricts: result.finalDistricts ? result.finalDistricts.map(district => ({
      ...district,
      censusTracts: reconstructTracts(district.censusTractIds || [])
    })) : result.finalDistricts,
    steps: result.steps ? result.steps.map(step => ({
      ...step,
      districtGroups: step.districtGroups ? step.districtGroups.map(group => ({
        ...group,
        censusTracts: reconstructTracts(group.censusTractIds || [])
      })) : step.districtGroups
    })) : result.steps
  };
  
  // Remove normalization metadata
  delete decompressed._normalized;
  delete decompressed._normalizedVersion;
  delete decompressed._state;
  delete decompressed._tractCount;
  if (decompressed.finalDistricts) {
    decompressed.finalDistricts.forEach(d => {
      if (d.censusTractIds) delete d.censusTractIds;
    });
  }
  if (decompressed.steps) {
    decompressed.steps.forEach(s => {
      if (s.districtGroups) {
        s.districtGroups.forEach(g => {
          if (g.censusTractIds) delete g.censusTractIds;
        });
      }
    });
  }
  
  return decompressed;
}

/**
 * Compress array of tracts by reducing coordinate precision
 */
function compressTractArray(tracts) {
  if (!Array.isArray(tracts)) return tracts;
  
  return tracts.map(tract => {
    if (!tract || !tract.geometry) return tract;
    
    const compressed = { ...tract };
    
    // Reduce coordinate precision to 4 decimal places (~11m precision)
    if (compressed.geometry && compressed.geometry.coordinates) {
      compressed.geometry = {
        ...compressed.geometry,
        coordinates: compressCoordinates(compressed.geometry.coordinates)
      };
    }
    
    return compressed;
  });
}

/**
 * Compress coordinates by reducing precision
 */
function compressCoordinates(coords) {
  if (!Array.isArray(coords)) return coords;
  
  if (typeof coords[0] === 'number') {
    // Single coordinate pair
    return coords.map(coord => Math.round(coord * 10000) / 10000);
  }
  
  // Nested arrays
  return coords.map(compressCoordinates);
}

/**
 * Simplify geometry by reducing coordinate precision
 */
function simplifyGeometry(geometry, tolerance) {
  if (!geometry || !geometry.coordinates) {
    return geometry;
  }
  
  const roundCoord = (coord) => {
    if (Array.isArray(coord)) {
      if (coord.length === 2 && typeof coord[0] === 'number') {
        return [Math.round(coord[0] / tolerance) * tolerance, Math.round(coord[1] / tolerance) * tolerance];
      }
      return coord.map(roundCoord);
    }
    return coord;
  };
  
  return {
    ...geometry,
    coordinates: roundCoord(geometry.coordinates)
  };
}

/**
 * Transform census API response
 */
function transformCensusResponse(response, params) {
  if (!response || response.length === 0) {
    return [];
  }
  
  // Check if response is an array (expected format)
  if (!Array.isArray(response)) {
    console.error('Census API returned non-array response:', response);
    return [];
  }
  
  const headers = response[0];
  const dataRows = response.slice(1);
  
  // Check if dataRows is an array
  if (!Array.isArray(dataRows)) {
    console.error('Census API dataRows is not an array:', dataRows);
    return [];
  }
  
  return dataRows.map(row => {
    const tractData = {
      state: '',
      county: '',
      tract: '',
      name: '',
      population: 0,
      medianHouseholdIncome: 0,
      medianAge: 0
    };
    
    headers.forEach((header, index) => {
      const value = row[index];
      
      switch (header) {
        case 'NAME':
          tractData.name = value;
          break;
        case 'B01003_001E': // Total population
          tractData.population = parseInt(value) || 0;
          break;
        case 'B19013_001E': // Median household income
          tractData.medianHouseholdIncome = parseInt(value) || 0;
          break;
        case 'B01002_001E': // Median age
          tractData.medianAge = parseFloat(value) || 0;
          break;
        case 'B17001_002E': // Poverty status
          tractData.povertyRate = parseInt(value) || 0;
          break;
        case 'B15003_022E': // Bachelor's degree
        case 'B15003_023E': // Master's degree
        case 'B15003_024E': // Professional degree
        case 'B15003_025E': // Doctorate degree
          tractData.educationLevel = (tractData.educationLevel || 0) + (parseInt(value) || 0);
          break;
        case 'state':
          tractData.state = value;
          break;
        case 'county':
          tractData.county = value;
          break;
        case 'tract':
          tractData.tract = value;
          break;
        default:
          tractData[header] = value;
      }
    });
    
    return tractData;
  });
}

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'geodistricts-api',
    version: CACHE_VERSION,
    cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE'
  });
});

/**
 * GET /api/version
 * Get backend version information
 */
app.get('/api/version', (req, res) => {
  const packageJson = require('./package.json');
  res.json({
    version: packageJson.version || '1.0.0',
    name: packageJson.name || 'geodistricts-api',
    nodeVersion: process.version,
    algorithmVersion: ALGORITHM_VERSION,
    timestamp: new Date().toISOString(),
    endpoints: {
      algorithmExecute: '/api/algorithm/execute',
      algorithmStepByStep: '/api/algorithm/execute/step-by-step',
      algorithmCache: '/api/algorithm/cache'
    }
  });
});

/**
 * GET /api/congress/119/party-summary
 * Returns 119th Congress House party counts per state and US total.
 */
app.get('/api/congress/119/party-summary', (req, res) => {
  try {
    const summary = congress119Party.getPartySummary();
    res.json(summary);
  } catch (error) {
    console.error('❌ GET /api/congress/119/party-summary error:', error);
    res.status(500).json({
      error: 'Party summary failed',
      message: error.message,
    });
  }
});

// In-memory cache for maps state comparison (used by GET /api/maps/state-comparison)
let cachedMapsStateComparison = null;

/**
 * GET /api/maps/state-comparison
 * Returns 119th vs GeoDistricts party comparison for maps page state list.
 * Served from cache or data/maps-state-comparison.json. If no file exists, returns 119th-only payload (GeoDistricts zeros).
 */
app.get('/api/maps/state-comparison', (req, res) => {
  try {
    if (cachedMapsStateComparison) {
      return res.json(cachedMapsStateComparison);
    }
    const payload = mapsComparison.loadPersistedComparison();
    if (payload) {
      cachedMapsStateComparison = payload;
      return res.json(payload);
    }
    // Fallback: 119th party only (geodistricts 0/0) so maps page can show real 119th data
    const congressSummary = congress119Party.getPartySummary();
    const states = {};
    let usCongressD = 0;
    let usCongressR = 0;
    for (const [stateCode, counts] of Object.entries(congressSummary.states || {})) {
      const D = counts.D || 0;
      const R = counts.R || 0;
      usCongressD += D;
      usCongressR += R;
      states[stateCode] = {
        congressD: D,
        congressR: R,
        geodistrictsD: 0,
        geodistrictsR: 0,
        swing: -D,
      };
    }
    const fallback = {
      us: {
        congressD: usCongressD,
        congressR: usCongressR,
        geodistrictsD: 0,
        geodistrictsR: 0,
        swing: -usCongressD,
      },
      states,
      meta: { generatedAt: new Date().toISOString(), vestYear: null, congress: 119, source: '119th-only' },
    };
    return res.json(fallback);
  } catch (error) {
    console.error('❌ GET /api/maps/state-comparison error:', error);
    res.status(500).json({
      error: 'State comparison failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/maps/state-party-summaries
 * Returns per-state party summaries for states that have district party % calculated.
 * Used by maps page when "All" is selected to show state-level D/R % and swing from party data.
 * Payload: { summaries: { stateCode: { pctDem, pctRep, geodistrictsD, geodistrictsR, swing } } }
 */
app.get('/api/maps/state-party-summaries', async (req, res) => {
  try {
    const ids = await listCacheDocIds('district_party_');
    const congressSummary = congress119Party.getPartySummary();
    const summaries = {};

    // Fetch all district_party docs in parallel instead of sequentially
    const docList = await Promise.all(ids.map((id) => getCacheDoc(id)));

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const data = docList[i];
      const parts = id.split('_');
      if (parts.length < 4) continue;
      const stateCode = (parts[2] || '').toUpperCase();
      if (stateCode.length !== 2) continue;

      if (!data || !data.districts || typeof data.districts !== 'object') continue;

      const districts = data.districts;
      let totalVotesDem = 0;
      let totalVotesRep = 0;
      let geodistrictsD = 0;
      let geodistrictsR = 0;
      for (const d of Object.values(districts)) {
        const vd = d.votesDem || 0;
        const vr = d.votesRep || 0;
        totalVotesDem += vd;
        totalVotesRep += vr;
        if ((d.pctDem || 0) >= 0.5) geodistrictsD++;
        else geodistrictsR++;
      }
      // Use two-party total (D+R) so percentages sum to 100%
      const totalVotes = totalVotesDem + totalVotesRep;
      const pctDem = totalVotes > 0 ? totalVotesDem / totalVotes : 0;
      const pctRep = totalVotes > 0 ? totalVotesRep / totalVotes : 0;
      const congress = congressSummary.states[stateCode] || { D: 0, R: 0 };
      const congressD = congress.D || 0;
      const swing = geodistrictsD - congressD;

      const stepNum = parseInt(parts[3], 10) || 0;
      const districtCount = geodistrictsD + geodistrictsR;
      const expectedDistricts = CONGRESSIONAL_DISTRICTS_BY_STATE[stateCode];
      const isComplete = expectedDistricts != null && districtCount === expectedDistricts;

      const existing = summaries[stateCode];
      if (!existing) {
        summaries[stateCode] = { pctDem, pctRep, geodistrictsD, geodistrictsR, swing, _step: stepNum, _complete: isComplete };
      } else {
        // Prefer doc that has the expected number of districts (complete run); otherwise prefer higher step.
        const preferCandidate =
          isComplete && !existing._complete ||
          (isComplete === existing._complete && stepNum > (existing._step ?? -1));
        if (preferCandidate) {
          summaries[stateCode] = { pctDem, pctRep, geodistrictsD, geodistrictsR, swing, _step: stepNum, _complete: isComplete };
        }
      }
    }
    for (const stateCode of Object.keys(summaries)) {
      const s = summaries[stateCode];
      delete s._step;
      delete s._complete;
    }

    return res.json({ summaries });
  } catch (error) {
    console.error('❌ GET /api/maps/state-party-summaries error:', error);
    res.status(500).json({
      error: 'State party summaries failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/maps-comparison/refresh
 * Recomputes 119th vs GeoDistricts comparison and persists to data/maps-state-comparison.json.
 * Requires final-step states and VEST data. May take several minutes for all states.
 */
app.post('/api/admin/maps-comparison/refresh', async (req, res) => {
  try {
    const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    console.log(`🔄 Maps comparison refresh started (base: ${baseUrl})`);
    poligeoAnalyst.setApiBaseUrl(baseUrl);

    const payload = await mapsComparison.buildStateComparisonPayload({
      vestYear: parseInt(req.query.vestYear || req.body?.vestYear || '2024', 10),
      getFinalStepStates: async () => {
        const { data } = await axios.get(`${baseUrl}/api/algorithm/final-step-states`);
        return data.stateCodes || [];
      },
      getFinalStep: async (state) => {
        const { data } = await axios.get(`${baseUrl}/api/algorithm/final-step/${state}`);
        return data;
      },
    });

    mapsComparison.savePersistedComparison(payload);
    cachedMapsStateComparison = payload;
    console.log(`✅ Maps comparison refreshed: US ${payload.us.congressD}D/${payload.us.congressR}R → ${payload.us.geodistrictsD}D/${payload.us.geodistrictsR}R GeoDistricts`);
    res.json(payload);
  } catch (error) {
    console.error('❌ POST /api/admin/maps-comparison/refresh error:', error);
    res.status(500).json({
      error: 'Refresh failed',
      message: error.message,
    });
  }
});

/**
 * Test cache connectivity (local files or Firestore)
 */
app.get('/api/test/cache', async (req, res) => {
  try {
    if (USE_LOCAL_CACHE) {
      console.log('🧪 Testing local file cache...');
      
      // Test write
      const testKey = 'test_' + Date.now();
      const testData = { message: 'Hello Local Cache!', timestamp: new Date().toISOString() };
      
      await localCache.setCache(testKey, testData, 300000); // 5 minutes
      console.log('✅ Local cache write test successful');
      
      // Test read
      const retrievedData = await localCache.getFromCache(testKey);
      
      if (retrievedData) {
        console.log('✅ Local cache read test successful');
        
        // Clean up test file
        await localCache.deleteCacheEntry(testKey);
        console.log('✅ Local cache delete test successful');
        
        res.json({
          status: 'success',
          message: 'Local file cache connectivity test passed',
          cacheMode: 'LOCAL_FILES',
          tests: ['write', 'read', 'delete'],
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error('Data not found after write');
      }
    } else {
      console.log('🧪 Testing Firestore connectivity...');
      
      // Test write
      const testKey = 'test_' + Date.now();
      const testData = { message: 'Hello Firestore!', timestamp: new Date().toISOString() };
      
      await setCacheDoc(testKey, {
        data: testData,
        timestamp: Date.now(),
        ttl: 300000, // 5 minutes
        version: CACHE_VERSION,
        source: 'Test',
        attribution: 'Test data'
      });
      
      console.log('✅ Firestore write test successful');
      
      // Test read
      const retrieved = await getCacheDoc(testKey);
      
      if (retrieved) {
        console.log('✅ Firestore read test successful');
        
        // Clean up test document
        await deleteCacheDoc(testKey);
        console.log('✅ Firestore delete test successful');
        
        res.json({
          status: 'success',
          message: 'Firestore connectivity test passed',
          cacheMode: 'FIRESTORE',
          tests: ['write', 'read', 'delete'],
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error('Document not found after write');
      }
    }
  } catch (error) {
    console.error('❌ Cache test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Cache connectivity test failed',
      cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from GeoDistricts API!' });
});

// Census Proxy Routes
/**
 * Get county FIPS codes for a state
 */
app.get('/api/census/counties', async (req, res) => {
  try {
    const { state } = req.query;
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }
    
    const cacheKey = generateCacheKey('counties', { state });
    
    // Check cache first
    const cachedEntry = await getFromCache(cacheKey);
    if (cachedEntry) {
      // Extract data from cache entry (could be nested in data.data or just data)
      const cachedData = cachedEntry.data || cachedEntry;
      return res.json(cachedData);
    }
    
    // Build query parameters for Census API
    const queryParams = new URLSearchParams();
    
    try {
      const apiKey = await getCensusApiKey();
      queryParams.set('key', apiKey);
    } catch (error) {
      console.error('Failed to get Census API key:', error);
      return res.status(500).json({ 
        error: 'Census API key not available',
        message: 'Unable to retrieve Census API key from Secret Manager'
      });
    }
    
    // Convert state abbreviation to FIPS code if needed (Census API requires FIPS)
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    
    const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
    
    // Get county data
    queryParams.set('get', 'NAME,COUNTY');
    queryParams.set('for', 'county:*');
    queryParams.set('in', `state:${stateFips}`);
    
    const apiUrl = `${CENSUS_API_BASE}/${ACS_YEAR}/${ACS_DATASET}?${queryParams.toString()}`;
    if (process.env.DEBUG_CENSUS_API === 'true') {
      console.log(`Fetching counties from Census API: state="${state}" -> FIPS="${stateFips}", url: ${apiUrl}`);
    }
    
    logExternalFetch('Census', 'county FIPS codes for state', `state=${state}`);
    const response = await axios.get(apiUrl);
    
    if (!response.data || !Array.isArray(response.data) || response.data.length < 2) {
      return res.status(500).json({ error: 'Invalid response from Census API' });
    }
    
    const headers = response.data[0];
    const dataRows = response.data.slice(1);
    
    const counties = dataRows.map(row => ({
      name: row[0], // NAME
      fips: row[1], // COUNTY
      state: state
    }));
    
    // Cache the result (never expires - census data is static)
    await setCache(cacheKey, counties, null);
    
    res.json(counties);
  } catch (error) {
    console.error('Error fetching counties:', error);
    res.status(500).json({ 
      error: 'Failed to fetch county data',
      message: error.message 
    });
  }
});

/**
 * Get census tract data by state and county
 */
app.get('/api/census/tract-data', async (req, res) => {
  try {
    const { state, county, tract, variables, year, dataset } = req.query;
    
    // Require both state and county for county-based caching
    if (!state || !county) {
      return res.status(400).json({ 
        error: 'Both state and county parameters are required',
        message: 'Use /api/census/counties to get county FIPS codes for a state'
      });
    }
    
    const params = {
      state: state,
      county: county,
      tract: tract || undefined,
      variables: variables ? variables.split(',') : undefined,
      year: year || ACS_YEAR,
      dataset: dataset || ACS_DATASET
    };
    
    const cacheKey = generateCacheKey('tract_data', params);
    
    // Check cache first (unless force invalidate)
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FORCE INVALIDATE: Bypassing cache for tract data - state: ${state}, county: ${county}`);
    } else {
      const cachedEntry = await getFromCache(cacheKey);
      if (cachedEntry) {
        // Extract data from cache entry (could be nested in data.data or just data)
        const cachedData = cachedEntry.data || cachedEntry;
        console.log(`✅ FIRESTORE CACHE HIT: Retrieved data for key: ${cacheKey}`);
        return res.json(cachedData);
      }
    }
    
    // Build query parameters for Census API
    const queryParams = new URLSearchParams();
    
    try {
      const apiKey = await getCensusApiKey();
      queryParams.set('key', apiKey);
    } catch (error) {
      console.error('Failed to get Census API key:', error);
      return res.status(500).json({ 
        error: 'Census API key not available',
        message: 'Unable to retrieve Census API key from Secret Manager'
      });
    }
    
    // Convert state abbreviation to FIPS code if needed (Census API requires FIPS)
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    
    const stateFips = /^\d{2}$/.test(params.state) ? params.state : (stateFipsMap[params.state.toUpperCase()] || params.state);
    
    // Add variables
    if (params.variables && params.variables.length > 0) {
      queryParams.set('get', params.variables.join(','));
    } else {
      queryParams.set('get', 'NAME,B01003_001E,B19013_001E,B01002_001E');
    }
    
    // Add geography - now always requires state and county (use FIPS code for state)
    if (params.tract) {
      queryParams.set('for', `tract:${params.tract}`);
      queryParams.set('in', `state:${stateFips} county:${params.county}`);
    } else {
      queryParams.set('for', 'tract:*');
      queryParams.set('in', `state:${stateFips} county:${params.county}`);
    }
    
    // Only log detailed API info in debug mode
    if (process.env.DEBUG_CENSUS_API === 'true') {
      console.log(`🔍 Census API query: state="${params.state}" -> FIPS="${stateFips}", county="${params.county}"`);
    }
    
    const apiUrl = `${CENSUS_API_BASE}/${params.year}/${params.dataset}?${queryParams.toString()}`;
    if (process.env.DEBUG_CENSUS_API === 'true') {
      console.log(`Fetching from Census API: ${apiUrl}`);
    }
    
    logExternalFetch('Census', 'tract demographics for state/county', `state=${params.state} county=${params.county}`);
    const response = await axios.get(apiUrl);
    if (process.env.DEBUG_CENSUS_API === 'true') {
      console.log(`Census API response type:`, typeof response.data);
      console.log(`Census API response length:`, response.data ? response.data.length : 'null');
      console.log(`Census API response preview:`, JSON.stringify(response.data).substring(0, 500));
    }
    
    // Check if response is an error message string
    if (typeof response.data === 'string') {
      console.error(`❌ Census API returned error string:`, response.data);
      // Try to parse as JSON in case it's a JSON error message
      try {
        const errorData = JSON.parse(response.data);
        console.error(`❌ Parsed error:`, errorData);
        return res.status(500).json({ 
          error: 'Census API error',
          message: errorData.message || errorData.error || response.data
        });
      } catch (e) {
        // Not JSON, return as-is
        return res.status(500).json({ 
          error: 'Census API error',
          message: response.data
        });
      }
    }
    
    const transformedData = transformCensusResponse(response.data, params);
    
    // Cache the result (never expires - census data is static)
    await setCache(cacheKey, transformedData, null);
    console.log(`💾 FIRESTORE CACHE: Stored ${transformedData.length} tracts for state ${state}, county ${county}`);
    
    // Log if this was a fresh fetch due to force invalidate
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FRESH DATA FETCHED: Retrieved ${transformedData.length} tracts from Census API (cache bypassed)`);
    }
    
    res.json(transformedData);
  } catch (error) {
    console.error('Error fetching tract data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch census tract data',
      message: error.message 
    });
  }
});

/**
 * Bulk fetch tract data for multiple counties in a state
 * POST /api/census/tract-data/bulk
 * Body: { state: "WV", counties: ["001", "003", ...], forceInvalidate: false }
 */
app.post('/api/census/tract-data/bulk', async (req, res) => {
  try {
    const { state, counties, forceInvalidate = false } = req.body;

    if (!state || !counties || !Array.isArray(counties)) {
      return res.status(400).json({
        error: 'State and counties array are required',
        message: 'Use { state: "WV", counties: ["001", "003", ...] }'
      });
    }

    console.log(`🔄 BULK FETCH: Starting bulk fetch for ${state} with ${counties.length} counties`);

    // Process counties in batches to avoid overwhelming the Census API
    const BATCH_SIZE = 5; // Process 5 counties at a time
    const results = [];
    const errors = [];

    for (let i = 0; i < counties.length; i += BATCH_SIZE) {
      const batch = counties.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(counties.length/BATCH_SIZE)}: counties ${batch.join(', ')}`);

      // Fetch data for this batch concurrently
      const batchPromises = batch.map(county => {
        const tractDataUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}&county=${county}${forceInvalidate ? '&forceInvalidate=true' : ''}`;
        return axios.get(tractDataUrl).then(response => {
          const data = response.data || [];
          console.log(`✅ Fetched ${data.length} tracts for county ${county}`);
          return data;
        }).catch(error => {
          console.warn(`⚠️ Failed to fetch tract data for county ${county}:`, error.message);
          errors.push({ county, error: error.message });
          return [];
        });
      });

      // Wait for this batch to complete before starting the next
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to be respectful to the API
      if (i + BATCH_SIZE < counties.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const allTracts = results.flat();
    console.log(`✅ BULK FETCH COMPLETE: Retrieved ${allTracts.length} tracts total for ${state} (${errors.length} errors)`);

    res.json({
      state,
      counties: counties.length,
      tracts: allTracts.length,
      errors: errors.length,
      data: allTracts
    });

  } catch (error) {
    console.error('Error in bulk tract data fetch:', error);
    res.status(500).json({
      error: 'Failed to fetch bulk census tract data',
      message: error.message
    });
  }
});

/**
 * Get tract count for a state/county
 */
async function getTractCount(state, county) {
  // Convert state abbreviation to FIPS code if needed
  const stateFipsMap = {
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
    'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
    'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
    'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
    'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
    'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
    'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
    'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
    'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
    'DC': '11'
  };
  
  const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);

  const whereTiger = `STATE='${stateFips}'${county ? ` AND COUNTY='${county}'` : ''}`;
  const whereEsri = `STATEFP='${stateFips}'${county ? ` AND COUNTYFP='${county}'` : ''}`;

  const tryCount = async (baseUrl, where) => {
    const serviceUrl = `${baseUrl}/query`;
    const countParams = new URLSearchParams({
      where,
      outFields: 'STATE',
      f: 'geojson',
      returnCountOnly: 'true'
    });
    const countResponse = await axios.get(`${serviceUrl}?${countParams.toString()}`, { timeout: TIGERWEB_REQUEST_TIMEOUT_MS });
    return countResponse.data.properties?.count || 0;
  };

  try {
    logExternalFetch('TIGERweb', 'tract count for boundaries query', county ? `state=${state} county=${county}` : `state=${state}`);
    return await tryCount(TIGERWEB_TRACT_LAYER, whereTiger);
  } catch (err) {
    const isNetwork = err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || (err.response && err.response.status >= 500);
    if (isNetwork) {
      console.warn(`⚠️ TIGERweb tract count failed (${err.code || err.message}), trying Esri fallback...`);
      logExternalFetch('Esri USA_Census_Tracts', 'tract count (fallback)', county ? `state=${state} county=${county}` : `state=${state}`);
      return await tryCount(TIGERWEB_TRACT_LAYER_FALLBACK, whereEsri);
    }
    throw err;
  }
}

/**
 * Fetch full tract boundaries for a state (or state+county) in batches.
 * Used when building the canonical tract model so large states get all features
 * without relying on streamed HTTP self-call or 2000-feature cache.
 * @param {string} state - State code (e.g. 'NY')
 * @param {string} [county] - Optional county FIPS
 * @returns {Promise<{ type: string, features: Array }>} GeoJSON FeatureCollection
 */
function normalizeTractFeatureFromTiger(f) {
  const p = f.properties || {};
  return { ...f, properties: { ...p, STATE_FIPS: p.STATE, COUNTY_FIPS: p.COUNTY, TRACT_FIPS: p.TRACT, FIPS: p.GEOID, POPULATION: p.POP100 != null ? p.POP100 : p.POPULATION } };
}
function normalizeTractFeatureFromEsri(f) {
  const p = f.properties || {};
  const state = p.STATE != null ? p.STATE : p.STATEFP;
  const county = p.COUNTY != null ? p.COUNTY : p.COUNTYFP;
  const tract = p.TRACT != null ? p.TRACT : p.TRACTCE;
  const geoid = p.GEOID != null ? p.GEOID : (state != null && county != null && tract != null ? `${String(state).padStart(2, '0')}${String(county).padStart(3, '0')}${String(tract).padStart(6, '0')}` : null);
  return { ...f, properties: { ...p, STATE: state, COUNTY: county, TRACT: tract, GEOID: geoid, STATE_FIPS: state, COUNTY_FIPS: county, TRACT_FIPS: tract, FIPS: geoid, POPULATION: p.POP100 != null ? p.POP100 : p.POPULATION } };
}

async function fetchTractBoundariesForState(state, county) {
  const stateFipsMap = {
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
    'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
    'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
    'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
    'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
    'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
    'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
    'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
    'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
    'DC': '11'
  };
  const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
  let whereClause = `STATE='${stateFips}'`;
  if (county) {
    whereClause += ` AND COUNTY='${county}'`;
  }
  const whereClauseEsri = `STATEFP='${stateFips}'${county ? ` AND COUNTYFP='${county}'` : ''}`;
  const outFieldsTiger = 'STATE,COUNTY,TRACT,GEOID,POP100';
  const outFieldsEsri = '*';

  const doFetch = async (baseUrl, normalizer, logLabel, where) => {
    const serviceUrl = `${baseUrl}/query`;
    const allFeatures = [];
    const batchSize = TIGERWEB_TRACT_BATCH_SIZE;
    let offset = 0;
    let batchIndex = 0;
    while (true) {
      const batchParams = new URLSearchParams({
        where: where,
        outFields: baseUrl === TIGERWEB_TRACT_LAYER_FALLBACK ? outFieldsEsri : outFieldsTiger,
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: batchSize.toString(),
        resultOffset: offset.toString()
      });
      batchIndex++;
      logExternalFetch(logLabel, 'tract boundaries batch (internal)', `state=${state} batch=${batchIndex}`);
      const batchResponse = await axios.get(`${serviceUrl}?${batchParams.toString()}`, { timeout: TIGERWEB_REQUEST_TIMEOUT_MS });
      const batchFeatures = (batchResponse.data.features || []).map(normalizer);
      allFeatures.push(...batchFeatures);
      if (batchFeatures.length < batchSize) break;
      offset += batchSize;
    }
    console.log(`📦 Fetched ${allFeatures.length} tract boundaries for state ${state} (${logLabel}, ${batchIndex} batch(es))`);
    return { type: 'FeatureCollection', features: allFeatures };
  };

  try {
    return await doFetch(TIGERWEB_TRACT_LAYER, normalizeTractFeatureFromTiger, 'TIGERweb', whereClause);
  } catch (err) {
    const isNetwork = err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || (err.response && err.response.status >= 500);
    if (isNetwork) {
      console.warn(`⚠️ TIGERweb tract boundaries failed (${err.code || err.message}), trying Esri fallback...`);
      return await doFetch(TIGERWEB_TRACT_LAYER_FALLBACK, normalizeTractFeatureFromEsri, 'Esri USA_Census_Tracts', whereClauseEsri);
    }
    throw err;
  }
}

/**
 * Handle streaming response for large datasets
 */
async function handleStreamingResponse(req, res, state, county, cacheKey, totalCount) {
  // Convert state abbreviation to FIPS code if needed
  const stateFipsMap = {
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
    'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
    'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
    'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
    'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
    'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
    'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
    'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
    'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
    'DC': '11'
  };
  
  // Use FIPS code if state is already a 2-digit code, otherwise convert
  const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);

  const serviceUrl = `${TIGERWEB_TRACT_LAYER}/query`;
  let whereClause = `STATE='${stateFips}'`;
  if (county) {
    whereClause += ` AND COUNTY='${county}'`;
  }

  console.log(`🔍 Streaming TIGERweb query: state="${state}" -> FIPS="${stateFips}", where="${whereClause}"`);

  // Set up streaming response
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.write('{"type":"FeatureCollection","features":[');

  const batchSize = TIGERWEB_TRACT_BATCH_SIZE;
  const totalBatches = Math.ceil(totalCount / batchSize);
  let isFirstBatch = true;
  let totalFeaturesStreamed = 0;

  // Normalize TIGERweb feature to expected property names (STATE_FIPS, COUNTY_FIPS, TRACT_FIPS, POPULATION)
  function normalizeTractFeature(f) {
    const p = f.properties || {};
    return { ...f, properties: { ...p, STATE_FIPS: p.STATE, COUNTY_FIPS: p.COUNTY, TRACT_FIPS: p.TRACT, FIPS: p.GEOID, POPULATION: p.POP100 != null ? p.POP100 : p.POPULATION } };
  }

  try {
    for (let i = 0; i < totalBatches; i++) {
      const offset = i * batchSize;
      const batchParams = new URLSearchParams({
        where: whereClause,
        outFields: 'STATE,COUNTY,TRACT,GEOID,POP100',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: batchSize.toString(),
        resultOffset: offset.toString()
      });

      console.log(`Streaming batch ${i + 1}/${totalBatches} (offset: ${offset})`);
      logExternalFetch('TIGERweb', 'tract boundaries batch (streaming)', `state=${state} batch=${i + 1}/${totalBatches}`);
      const batchResponse = await axios.get(`${serviceUrl}?${batchParams.toString()}`);
      const batchFeatures = (batchResponse.data.features || []).map(normalizeTractFeature);

      // Stream this batch to client
      if (batchFeatures.length > 0) {
        if (!isFirstBatch) {
          res.write(',');
        }
        isFirstBatch = false;

        // Send features as JSON array
        const featuresJson = batchFeatures.map(feature => JSON.stringify(feature)).join(',');
        res.write(featuresJson);
        
        // Force response to flush
        res.flush();
      }
      
      totalFeaturesStreamed += batchFeatures.length;
      
      // Force garbage collection every few batches
      if (global.gc && i % 3 === 0) {
        global.gc();
      }
    }
    
    // Close the JSON response
    res.write(']}');
    res.end();
    
    // Don't cache large datasets - let them be fetched fresh each time
    // This avoids memory issues and ensures data freshness
    
    console.log(`Streamed ${totalFeaturesStreamed} tract boundaries for state ${state} and cached marker`);
  } catch (error) {
    console.error('Error in streaming response:', error);
    res.status(500).json({ error: 'Failed to stream tract boundaries' });
  }
}

/**
 * Get tract boundaries from TIGERweb
 */
app.get('/api/census/tract-boundaries', async (req, res) => {
  try {
    const { state, county } = req.query;
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }
    
    const cacheParams = { state, county: county || undefined };
    const cacheKey = generateCacheKey('tract_boundaries', cacheParams);
    
    // Check cache first (unless force invalidate)
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FORCE INVALIDATE: Bypassing cache for tract boundaries - state: ${state}, county: ${county || 'all'}`);
    } else {
      const cachedEntry = await getFromCache(cacheKey);
      if (cachedEntry) {
        // Extract data from cache entry (could be nested in data.data or just data)
        const cachedData = cachedEntry.data || cachedEntry;
        console.log(`✅ FIRESTORE CACHE HIT: Retrieved boundaries for key: ${cacheKey}`);
        return res.json(cachedData);
      }
    }

    // For large datasets, use streaming response. Use >= 2000 so we never rely on single-request 2000 cap (TIGER count may be capped at 2000).
    const totalCount = await getTractCount(state, county);
    if (totalCount >= 2000) {
      return handleStreamingResponse(req, res, state, county, cacheKey, totalCount);
    }
    
    // Convert state abbreviation to FIPS code if needed
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    
    // Use FIPS code if state is already a 2-digit code, otherwise convert
    const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);

    const serviceUrl = `${TIGERWEB_TRACT_LAYER}/query`;
    let whereClause = `STATE='${stateFips}'`;
    if (county) {
      whereClause += ` AND COUNTY='${county}'`;
    }

    console.log(`🔍 TIGERweb query: state="${state}" -> FIPS="${stateFips}", where="${whereClause}"`);

    // For smaller datasets, use single request
    const params = new URLSearchParams({
      where: whereClause,
      outFields: 'STATE,COUNTY,TRACT,GEOID,POP100',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: '2000'
    });

    console.log(`Fetching tract boundaries for state ${state} (small dataset)`);
    logExternalFetch('TIGERweb', 'tract boundaries for state/county', county ? `state=${state} county=${county}` : `state=${state}`);
    const response = await axios.get(`${serviceUrl}?${params.toString()}`);
    const rawFeatures = response.data.features || [];
    const normalizeTractFeature = (f) => {
      const p = f.properties || {};
      return { ...f, properties: { ...p, STATE_FIPS: p.STATE, COUNTY_FIPS: p.COUNTY, TRACT_FIPS: p.TRACT, FIPS: p.GEOID, POPULATION: p.POP100 != null ? p.POP100 : p.POPULATION } };
    };
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: rawFeatures.map(normalizeTractFeature)
    };
    
    // Cache the response (never expires - census boundaries are static)
    await setCache(cacheKey, geojsonResponse, null);
    
    console.log(`Retrieved ${geojsonResponse.features.length} tract boundaries for state ${state}`);
    
    // Log if this was a fresh fetch due to force invalidate
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FRESH BOUNDARIES FETCHED: Retrieved ${geojsonResponse.features.length} boundaries from TIGERweb (cache bypassed)`);
    }
    
    res.json(geojsonResponse);
  } catch (error) {
    console.error('Error fetching tract boundaries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tract boundaries',
      message: error.message 
    });
  }
});

/**
 * Get tract GEOIDs only for a state (no geometry). Used by county→tract party allocation.
 */
app.get('/api/census/tract-geoids', async (req, res) => {
  try {
    const { state } = req.query;
    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
    const serviceUrl = `${TIGERWEB_TRACT_LAYER}/query`;
    const pageSize = 2000;
    const geoids = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams({
        where: `STATE='${stateFips}'`,
        outFields: 'GEOID',
        f: 'json',
        returnGeometry: 'false',
        resultRecordCount: String(pageSize),
        resultOffset: String(offset),
      });
      const response = await axios.get(`${serviceUrl}?${params.toString()}`, { timeout: 60000 });
      const features = response.data?.features ?? [];
      for (const f of features) {
        const g = f?.properties?.GEOID;
        if (g) geoids.push(String(g).padStart(11, '0').substring(0, 11));
      }
      offset += features.length;
      hasMore = features.length >= pageSize;
    }
    res.json({ geoids });
  } catch (error) {
    console.error('Error fetching tract GEOIDs:', error);
    res.status(500).json({ error: 'Failed to fetch tract GEOIDs', message: error.message });
  }
});

/**
 * Get state boundaries from TIGERweb
 * Returns the state boundary polygon(s) for a given state
 * At Step 0, this can be used instead of merging all census tracts
 */
app.get('/api/census/state-boundaries', async (req, res) => {
  try {
    const { state } = req.query;
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }
    
    const cacheParams = { state };
    const cacheKey = generateCacheKey('state_boundaries', cacheParams);
    
    // Check cache first (unless force invalidate)
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FORCE INVALIDATE: Bypassing cache for state boundaries - state: ${state}`);
    } else {
      const cachedEntry = await getFromCache(cacheKey);
      if (cachedEntry) {
        const cachedData = cachedEntry.data || cachedEntry;
        console.log(`✅ FIRESTORE CACHE HIT: Retrieved state boundaries for key: ${cacheKey}`);
        return res.json(cachedData);
      }
    }
    
    // Convert state abbreviation to FIPS code if needed
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    
    // Use FIPS code if state is already a 2-digit code, otherwise convert
    const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);

    // Census TIGERweb State_County layer 0 (state boundaries)
    const serviceUrl = `${TIGERWEB_STATE_LAYER}/query`;

    const params = new URLSearchParams({
      where: `STATE='${stateFips}'`,
      outFields: 'STATE,GEOID,NAME,STUSAB',
      f: 'geojson',
      outSR: '4326'
    });

    console.log(`🔍 TIGERweb state boundaries query: state="${state}" -> FIPS="${stateFips}"`);

    logExternalFetch('TIGERweb', 'state boundary polygon', `state=${state}`);
    const response = await axios.get(`${serviceUrl}?${params.toString()}`);
    const rawFeatures = response.data.features || [];
    const normalizeStateFeature = (f) => {
      const p = f.properties || {};
      return { ...f, properties: { ...p, STATE_FIPS: p.STATE ?? p.GEOID, STATE_NAME: p.NAME, STATE_ABBR: p.STUSAB } };
    };
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: rawFeatures.map(normalizeStateFeature)
    };
    
    // Cache the response (never expires - census boundaries are static)
    await setCache(cacheKey, geojsonResponse, null);
    
    console.log(`✅ Retrieved ${geojsonResponse.features.length} state boundary feature(s) for state ${state}`);
    
    // Log if this was a fresh fetch due to force invalidate
    if (req.query.forceInvalidate === 'true') {
      console.log(`🔄 FRESH STATE BOUNDARIES FETCHED: Retrieved ${geojsonResponse.features.length} boundary feature(s) from TIGERweb (cache bypassed)`);
    }
    
    res.json(geojsonResponse);
  } catch (error) {
    console.error('Error fetching state boundaries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch state boundaries',
      message: error.message 
    });
  }
});

/**
 * Clear cache endpoint (for debugging)
 */
app.delete('/api/census/cache', async (req, res) => {
  try {
    const { key } = req.query;
    
    if (USE_LOCAL_CACHE) {
      if (key) {
        // Clear specific cache entry
        await localCache.deleteCacheEntry(key);
        res.json({ 
          message: `Cache entry ${key} cleared`,
          cacheMode: 'LOCAL_FILES'
        });
      } else {
        // Clear all cache entries
        const deletedCount = await localCache.clearAllCache();
        res.json({ 
          message: `All cache entries cleared (${deletedCount} files)`,
          cacheMode: 'LOCAL_FILES',
          deletedCount
        });
      }
    } else {
      if (key) {
        // Clear specific cache entry
        await deleteCacheDoc(key);
        res.json({ 
          message: `Cache entry ${key} cleared`,
          cacheMode: 'FIRESTORE'
        });
      } else {
        // Clear all cache entries
        const firestore = getFirestore();
        const snapshot = await firestore.collection('census_cache').get();
        const batch = firestore.batch();
        
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        res.json({ 
          message: `All cache entries cleared (${snapshot.docs.length} documents)`,
          cacheMode: 'FIRESTORE',
          deletedCount: snapshot.docs.length
        });
      }
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ 
      error: 'Failed to clear cache',
      cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE',
      message: error.message 
    });
  }
});

/**
 * Get cache info endpoint
 */
app.get('/api/census/cache-info', async (req, res) => {
  try {
    if (USE_LOCAL_CACHE) {
      const cacheInfo = await localCache.getCacheInfo();
      const cacheSize = await localCache.getCacheSize();
      
      res.json({
        cacheMode: 'LOCAL_FILES',
        entries: cacheInfo,
        cacheSize: cacheSize,
        totalEntries: cacheInfo.length
      });
    } else {
      const snapshot = await getFirestore().collection('census_cache').get();
      const cacheInfo = [];
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        cacheInfo.push({
          key: doc.id,
          timestamp: data.timestamp,
          ttl: data.ttl,
          version: data.version,
          size: JSON.stringify(data.data).length,
          isExpired: isCacheExpired(data.timestamp, data.ttl)
        });
      });
      
      res.json({
        cacheMode: 'FIRESTORE',
        entries: cacheInfo.sort((a, b) => b.timestamp - a.timestamp),
        totalEntries: cacheInfo.length
      });
    }
  } catch (error) {
    console.error('Error getting cache info:', error);
    // Return empty array instead of 500 error to prevent service crashes
    res.json({
      cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE',
      entries: [],
      totalEntries: 0,
      error: error.message
    });
  }
});

/**
 * Cleanup expired cache entries endpoint
 */
app.post('/api/census/cache/cleanup', async (req, res) => {
  try {
    if (USE_LOCAL_CACHE) {
      const cleanedCount = await localCache.cleanupExpiredCache();
      res.json({
        message: `Cleaned up ${cleanedCount} expired cache entries`,
        cacheMode: 'LOCAL_FILES',
        cleanedCount
      });
    } else {
      // For Firestore, expired entries are automatically cleaned up on access
      res.json({
        message: 'Firestore cache cleanup not needed (automatic cleanup on access)',
        cacheMode: 'FIRESTORE',
        cleanedCount: 0
      });
    }
  } catch (error) {
    console.error('Error cleaning up cache:', error);
    res.status(500).json({
      error: 'Failed to cleanup cache',
      cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE',
      message: error.message
    });
  }
});

/**
 * Helper function to cache algorithm results
 * Uses normalized caching: tract geometries stored separately at state level
 * @param {string} cacheKey - Cache key (e.g., "AZ_latlong_100")
 * @param {object} divisionResult - Algorithm result to cache
 * @param {string} stateCode - State code (e.g., "AZ")
 * @param {string} algorithmVersion - Algorithm version
 * @param {number|null} ttl - Time to live (null = no expiration)
 * @param {Array} tractMap - Optional pre-normalized tract map from frontend
 * @returns {Promise<{success: boolean, cacheKey: string, stateTractCacheKey: string, sizes?: object, error?: string}>}
 */
async function cacheAlgorithmResult(cacheKey, divisionResult, stateCode, algorithmVersion, ttl = null, tractMap = null) {
  try {
    // Check if data is already normalized by frontend
    let normalizedResult, finalTractMap;
    const isPreNormalized = divisionResult._normalized && tractMap && Array.isArray(tractMap) && tractMap.length > 0;
    
    if (isPreNormalized) {
      // Frontend already normalized - use provided data
      console.log(`✅ Using pre-normalized data (${divisionResult._tractCount || 0} tracts, tractMap length: ${tractMap.length})`);
      normalizedResult = divisionResult;
      finalTractMap = tractMap;
    } else {
      // Normalize on backend: separate tract geometries from step data
      console.log(`🔄 Normalizing on backend`);
      const compressed = compressGeodistrictResult(divisionResult, stateCode);
      normalizedResult = compressed.normalizedResult;
      finalTractMap = compressed.tractMap;
    }
    
    // Store normalized algorithm result (without tract geometries)
    const normalizedSize = JSON.stringify(normalizedResult).length;
    const tractCacheSize = JSON.stringify(finalTractMap).length;
    const tractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
    
    // Store state-level tract cache (tract geometries)
    const stateTractCacheKey = `state_tracts_${stateCode}`;

    if (USE_LOCAL_CACHE) {
      await setCacheDoc(stateTractCacheKey, finalTractMap);
      const algorithmCacheEntry = {
        data: normalizedResult,
        timestamp: Date.now(),
        ttl: ttl === null ? null : (ttl || CACHE_TTL),
        version: CACHE_VERSION,
        algorithmVersion: algorithmVersion,
        source: 'algorithm-cache',
        normalized: true,
        state: stateCode,
        tractCacheKey: stateTractCacheKey
      };
      await setCacheDoc(cacheKey, algorithmCacheEntry);
      const tractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
      const originalSizeMB = (JSON.stringify(divisionResult).length / (1024 * 1024)).toFixed(2);
      const normalizedSizeMB = (normalizedSize / (1024 * 1024)).toFixed(2);
      console.log(`💾 LOCAL CACHE: Cached algorithm result for key: ${cacheKey} and ${finalTractMap.length} tracts for state ${stateCode}`);
      return {
        success: true,
        cacheKey,
        stateTractCacheKey,
        sizes: {
          originalMB: parseFloat(originalSizeMB),
          normalizedMB: parseFloat(normalizedSizeMB),
          tractCacheMB: parseFloat(tractCacheSizeMB),
          compressionRatio: tractCacheSize && normalizedSize ? (normalizedSize / tractCacheSize).toFixed(2) : '0',
          tractCount: finalTractMap.length
        }
      };
    }

    const FIRESTORE_MAX_SIZE = 1024 * 1024; // 1MB
    let useCloudStorage = tractCacheSize > FIRESTORE_MAX_SIZE;
    
    if (useCloudStorage) {
      // Store in Cloud Storage (no size limit, no chunking needed)
      console.log(`📦 CLOUD STORAGE: Storing state tract cache (${tractCacheSizeMB} MB) for ${stateCode} in Cloud Storage`);
      
      try {
        const cloudStoragePath = await cloudStorageCache.set(stateTractCacheKey, finalTractMap, {
          state: stateCode,
          tractCount: finalTractMap.length.toString(),
          source: 'state-tract-cache'
        });
        
        // Store metadata reference in Firestore
        const metadataEntry = {
          cloudStoragePath: cloudStoragePath,
          timestamp: Date.now(),
          ttl: null, // No expiration - tract geometries are static
          version: CACHE_VERSION,
          source: 'state-tract-cache-metadata',
          attribution: `Tract geometries metadata for state ${stateCode}`,
          chunked: false,
          cloudStorage: true,
          totalChunks: 0,
          tractCount: finalTractMap.length,
          state: stateCode,
          size: tractCacheSize,
          sizeMB: parseFloat(tractCacheSizeMB)
        };
        
        const metadataDocRef = getFirestore().collection('census_cache').doc(stateTractCacheKey);
        await metadataDocRef.set(metadataEntry);
        
        console.log(`💾 CLOUD STORAGE: Stored ${tractCacheSizeMB} MB tract cache for state ${stateCode} at ${cloudStoragePath}`);
      } catch (error) {
        console.error(`❌ CLOUD STORAGE: Failed to store tract cache for ${stateCode}:`, error.message);
        // Fall back to Firestore chunking if Cloud Storage fails
        console.log(`⚠️ Falling back to Firestore chunking for ${stateCode}`);
        useCloudStorage = false;
      }
    }
    
    // Fallback: Use Firestore chunking for smaller files or if Cloud Storage fails
    if (!useCloudStorage) {
      const needsSplitting = tractCacheSize > FIRESTORE_MAX_SIZE;
      
      if (needsSplitting) {
        // Split tract map into chunks that fit within Firestore's 1MB limit
        console.log(`📦 Tract cache (${tractCacheSizeMB} MB) exceeds Firestore limit, splitting into chunks...`);
        
        const tractArray = Array.isArray(finalTractMap) ? finalTractMap : Array.from(finalTractMap.entries());
        const chunks = [];
        let currentChunk = [];
        let currentChunkSize = 0;
        // Use 70% of limit to account for Firestore document overhead (metadata fields, structure, etc.)
        const CHUNK_DATA_SIZE_LIMIT = FIRESTORE_MAX_SIZE * 0.7; // ~700KB for data field
        
        for (const tract of tractArray) {
          const tractSize = JSON.stringify(tract).length;
          // Estimate full document size: data field + metadata overhead (~200 bytes)
          const estimatedDocSize = currentChunkSize + tractSize + 200;
          
          if (estimatedDocSize > CHUNK_DATA_SIZE_LIMIT && currentChunk.length > 0) {
            // Verify actual chunk document size before saving
            const testChunkEntry = {
              data: currentChunk,
              timestamp: Date.now(),
              ttl: null,
              version: CACHE_VERSION,
              source: 'state-tract-cache-chunk',
              attribution: `Tract geometries chunk for state ${stateCode}`,
              compressed: true,
              chunkIndex: chunks.length,
              totalChunks: 0, // Will be updated later
              tractCount: currentChunk.length,
              state: stateCode
            };
            const testChunkSize = JSON.stringify(testChunkEntry).length;
            
            // If still too large, remove last tract and try again
            if (testChunkSize > FIRESTORE_MAX_SIZE && currentChunk.length > 1) {
              const lastTract = currentChunk.pop();
              currentChunkSize -= JSON.stringify(lastTract).length;
              // Save chunk without the last tract
              chunks.push([...currentChunk]);
              // Start new chunk with the last tract
              currentChunk = [lastTract];
              currentChunkSize = JSON.stringify(lastTract).length;
            } else {
              // Save current chunk and start new one
              chunks.push(currentChunk);
              currentChunk = [tract];
              currentChunkSize = tractSize;
            }
          } else {
            currentChunk.push(tract);
            currentChunkSize += tractSize;
          }
        }
        
        // Add final chunk
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }
        
        // Verify all chunks are within size limit
        const chunkSizes = chunks.map(c => {
          const testEntry = {
            data: c,
            timestamp: Date.now(),
            ttl: null,
            version: CACHE_VERSION,
            source: 'state-tract-cache-chunk',
            attribution: `Tract geometries chunk for state ${stateCode}`,
            compressed: true,
            chunkIndex: 0,
            totalChunks: chunks.length,
            tractCount: c.length,
            state: stateCode
          };
          return JSON.stringify(testEntry).length;
        });
        
        console.log(`📦 Split tract cache into ${chunks.length} chunks (${chunkSizes.map(s => (s / (1024 * 1024)).toFixed(2)).join(', ')} MB each)`);
        
        // Check if any chunk exceeds limit
        const oversizedChunks = chunkSizes.filter(s => s > FIRESTORE_MAX_SIZE);
        if (oversizedChunks.length > 0) {
          console.error(`❌ ${oversizedChunks.length} chunks still exceed Firestore limit. Max chunk size: ${Math.max(...chunkSizes)} bytes`);
          throw new Error(`Even after splitting, ${oversizedChunks.length} chunks exceed Firestore 1MB limit.`);
        }
        
        // Store each chunk as a separate document
        const firestore = getFirestore();
        const batch = firestore.batch();
        for (let i = 0; i < chunks.length; i++) {
          const chunkKey = `${stateTractCacheKey}_chunk_${i}`;
          const chunkDocRef = firestore.collection('census_cache').doc(chunkKey);
          const chunkEntry = {
            data: chunks[i],
            timestamp: Date.now(),
            ttl: null,
            version: CACHE_VERSION,
            source: 'state-tract-cache-chunk',
            attribution: `Tract geometries chunk ${i + 1}/${chunks.length} for state ${stateCode}`,
            compressed: true,
            chunkIndex: i,
            totalChunks: chunks.length,
            tractCount: chunks[i].length,
            state: stateCode
          };
          batch.set(chunkDocRef, chunkEntry);
        }
        
        // Store metadata document with chunk references
        const metadataDocRef = getFirestore().collection('census_cache').doc(stateTractCacheKey);
        const metadataEntry = {
          timestamp: Date.now(),
          ttl: null,
          version: CACHE_VERSION,
          source: 'state-tract-cache-metadata',
          attribution: `Tract geometries metadata for state ${stateCode}`,
          chunked: true,
          totalChunks: chunks.length,
          tractCount: tractArray.length,
          state: stateCode,
          chunkKeys: chunks.map((_, i) => `${stateTractCacheKey}_chunk_${i}`)
        };
        batch.set(metadataDocRef, metadataEntry);
        
        await batch.commit();
        console.log(`💾 Stored tract cache as ${chunks.length} chunks for state ${stateCode}`);
      } else {
        // Store as single document (fits within 1MB limit)
        const stateTractCacheEntry = {
          data: finalTractMap,
          timestamp: Date.now(),
          ttl: null, // No expiration - tract geometries are static
          version: CACHE_VERSION,
          source: 'state-tract-cache',
          attribution: `Tract geometries for state ${stateCode}`,
          compressed: true,
          tractCount: finalTractMap.length,
          chunked: false
        };
        const stateTractDocRef = getFirestore().collection('census_cache').doc(stateTractCacheKey);
        await stateTractDocRef.set(stateTractCacheEntry);
      }
    }
    
    // Calculate original size: if pre-normalized, estimate by adding tract cache size
    // Otherwise use the actual divisionResult size
    let originalSize;
    if (isPreNormalized) {
      // For pre-normalized data, estimate original size by adding tract geometries back
      originalSize = normalizedSize + tractCacheSize;
    } else {
      originalSize = JSON.stringify(divisionResult).length;
    }
    
    const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(2);
    const normalizedSizeMB = (normalizedSize / (1024 * 1024)).toFixed(2);
    const finalTractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - normalizedSize / originalSize) * 100).toFixed(1);
    
    console.log(`📊 Normalization: ${originalSizeMB} MB → ${normalizedSizeMB} MB algorithm + ${finalTractCacheSizeMB} MB tracts (${compressionRatio}% reduction in algorithm cache)`);
    
    // Check if normalized result is still too large for Firestore (1MB limit)
    if (normalizedSize > 1024 * 1024) {
      console.error(`❌ Normalized algorithm result (${normalizedSizeMB} MB) exceeds Firestore 1MB document limit`);
      throw new Error(`Normalized algorithm result (${normalizedSizeMB} MB) exceeds Firestore 1MB document limit.`);
    }
    
    // Remove undefined values from normalizedResult (Firestore doesn't allow undefined)
    const cleanNormalizedResult = JSON.parse(JSON.stringify(normalizedResult, (key, value) => {
      return value === undefined ? null : value;
    }));
    
    const cacheTtl = ttl === null ? null : (ttl || CACHE_TTL);
    
    const algorithmCacheEntry = {
      data: cleanNormalizedResult,
      timestamp: Date.now(),
      ttl: cacheTtl || null,
      version: CACHE_VERSION,
      algorithmVersion: algorithmVersion,
      source: `${algorithm}-algorithm-cache`,
      attribution: `${algorithm} algorithm cached result (normalized)`,
      compressed: true,
      normalized: true,
      state: stateCode,
      tractCacheKey: stateTractCacheKey
    };

    // Algorithm cache always uses Firestore (shared between localhost and production)
    // Note: State tract cache was already stored above (either as chunks or single document)
    
    // Store algorithm cache
    const algorithmDocRef = getFirestore().collection('census_cache').doc(cacheKey);
    await algorithmDocRef.set(algorithmCacheEntry, { ignoreUndefinedProperties: true });
    
    console.log(`💾 ALGORITHM CACHE (${algorithm}): Cached normalized result for key: ${cacheKey} and ${finalTractMap.length} tracts for state ${stateCode}`);
    
    return {
      success: true,
      cacheKey,
      stateTractCacheKey,
      sizes: {
        originalMB: parseFloat(originalSizeMB),
        normalizedMB: parseFloat(normalizedSizeMB),
        tractCacheMB: parseFloat(finalTractCacheSizeMB),
        compressionRatio: parseFloat(compressionRatio),
        tractCount: finalTractMap.length
      }
    };
  } catch (error) {
    console.error('❌ Error caching algorithm result:', error);
    return {
      success: false,
      cacheKey,
      stateTractCacheKey: `state_tracts_${stateCode}`,
      error: error.message
    };
  }
}

/**
 * Cache algorithm results (supports all algorithm types)
 * Uses normalized caching: tract geometries stored separately at state level
 */
app.post('/api/algorithm/cache', async (req, res) => {
  try {
    const { cacheKey, divisionResult, ttl, state } = req.body;

    if (!cacheKey || !divisionResult) {
      return res.status(400).json({ error: 'cacheKey and divisionResult are required' });
    }

    // Extract state from cacheKey if not provided (format: STATE_maxIterations)
    const stateCode = state || cacheKey.split('_')[0] || cacheKey.substring(0, 2);
    if (!stateCode || stateCode.length < 2) {
      return res.status(400).json({ error: 'State code is required (provide in body or ensure cacheKey starts with state code)' });
    }

    // Check request size before processing (Cloud Run has 32MB limit)
    const requestSize = JSON.stringify(req.body).length;
    const requestSizeMB = (requestSize / (1024 * 1024)).toFixed(2);
    console.log(`📦 Cache request size: ${requestSizeMB} MB (${requestSize} bytes)`);
    
    if (requestSize > 32 * 1024 * 1024) {
      console.error(`❌ Request too large: ${requestSizeMB} MB exceeds Cloud Run 32MB limit`);
      return res.status(413).json({
        error: 'Request too large',
        message: `Request size (${requestSizeMB} MB) exceeds Cloud Run 32MB limit. Please compress data before sending.`,
        requestSizeMB: parseFloat(requestSizeMB),
        maxSizeMB: 32
      });
    }

    // Use null TTL if explicitly set to null (no expiration), otherwise use provided TTL or default
    const cacheTtl = ttl === null ? null : (ttl || CACHE_TTL);

    const algorithmVersion = req.body.algorithmVersion || 'unknown';
    
    // Use helper function to cache the result
    const cacheResult = await cacheAlgorithmResult(
      cacheKey,
      divisionResult,
      stateCode,
      algorithmVersion,
      cacheTtl,
      req.body.tractMap // Pass tract map if provided by frontend
    );
    
    if (!cacheResult.success) {
      // Handle errors from caching
      if (cacheResult.error && cacheResult.error.includes('exceeds Firestore')) {
        return res.status(413).json({
          error: 'Document too large for Firestore',
          message: cacheResult.error,
          maxSizeMB: 1
        });
      }
      return res.status(500).json({
        error: 'Failed to cache division result',
        message: cacheResult.error
      });
    }
    
    res.json({
      status: 'success',
      message: 'Division result cached successfully (normalized)',
      cacheKey: cacheResult.cacheKey,
      stateTractCacheKey: cacheResult.stateTractCacheKey,
      sizes: cacheResult.sizes
    });
  } catch (error) {
    console.error('❌ Error caching algorithm result:', error);
    console.error('Error stack:', error.stack);
    
    // Check if it's a size-related error
    if (error.message && error.message.includes('exceeds Firestore')) {
      return res.status(413).json({
        error: 'Document too large for Firestore',
        message: error.message,
        maxSizeMB: 1
      });
    }
    
    res.status(500).json({
      error: 'Failed to cache division result',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * Get cached algorithm results (supports all algorithm types)
 * Handles normalized caching: fetches state-level tract cache and reconstructs full result
 */
app.get('/api/algorithm/cache/:cacheKey', async (req, res) => {
  try {
    const { cacheKey } = req.params;

    if (!cacheKey) {
      return res.status(400).json({ error: 'cacheKey parameter is required' });
    }

    // Log cache mode for debugging
    logger.debug(`🔍 ALGORITHM CACHE CHECK: Key=${cacheKey}, USE_LOCAL_CACHE=${USE_LOCAL_CACHE}, NODE_ENV=${process.env.NODE_ENV}, GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`);

    // Algorithm cache always uses Firestore (shared between localhost and production)
    let cachedEntry;
    logger.debug(`🔍 FIRESTORE ALGORITHM CACHE: Checking Firestore for key: ${cacheKey}`);
    const doc = await getCacheDoc(cacheKey);
    
    if (!doc) {
      logger.debug(`❌ FIRESTORE ALGORITHM CACHE: No document found for key: ${cacheKey}`);
      cachedEntry = null;
    } else {
      const data = doc.data();
      
      // Check if expired
      if (isCacheExpired(data.timestamp, data.ttl)) {
        logger.debug(`⏰ FIRESTORE ALGORITHM CACHE: Cache expired for key: ${cacheKey}, deleting`);
        await deleteCacheDoc(cacheKey);
        cachedEntry = null;
      } else {
        logger.debug(`✅ FIRESTORE ALGORITHM CACHE HIT: Retrieved data for key: ${cacheKey}`);
        cachedEntry = data;
      }
    }
    logger.debug(`🔍 CACHE LOOKUP: Key=${cacheKey}, Found=${!!cachedEntry}, Normalized=${cachedEntry?.normalized}, TractCacheKey=${cachedEntry?.tractCacheKey}`);

    if (cachedEntry) {
      // Check algorithm version - compare against backend's current version
      const cachedVersion = cachedEntry.algorithmVersion;
      const currentVersion = ALGORITHM_VERSION;
      
      console.log(`🔍 VERSION CHECK (${algorithm}): Cached=${cachedVersion || 'missing'}, Current=${currentVersion}`);
      
      // If no version is stored, treat as old cache (pre-versioning) and invalidate
      if (!cachedVersion) {
        console.log(`🔄 ALGORITHM VERSION MISSING (${algorithm}): Old cache entry without version. Invalidating.`);
        // Delete the outdated cache entry (always use Firestore for algorithm cache)
        await deleteCacheDoc(cacheKey);
        return res.json({
          status: 'miss',
          cached: false,
          message: 'Cache entry outdated (no algorithm version)',
          algorithmVersion: currentVersion,
          cachedVersion: null
        });
      }
      
      // If versions don't match, invalidate
      if (cachedVersion !== currentVersion) {
        console.log(`🔄 ALGORITHM VERSION MISMATCH (${algorithm}): Cached version ${cachedVersion} != current ${currentVersion}. Invalidating cache.`);
        // Delete the outdated cache entry (always use Firestore for algorithm cache)
        await deleteCacheDoc(cacheKey);
        return res.json({
          status: 'miss',
          cached: false,
          message: 'Cache entry outdated due to algorithm version change',
          algorithmVersion: currentVersion,
          cachedVersion: cachedVersion
        });
      }
      
      // Handle normalized cache (v2.0) - fetch state-level tract cache
      let decompressedResult;
      if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
        // Fetch state-level tract cache metadata (always uses Firestore)
        let stateTractCache;
        const stateTractData = await getCacheDoc(cachedEntry.tractCacheKey);
        if (stateTractData) {
          if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
            stateTractCache = stateTractData;
          }
        }
        
        // Fetch actual tract data based on storage location
        let tractData = null;
        
        // Check if tract cache is stored in Cloud Storage
        if (stateTractCache && stateTractCache.cloudStorage && stateTractCache.cloudStoragePath) {
          try {
            console.log(`📦 CLOUD STORAGE: Fetching state tract cache from Cloud Storage for key: ${cachedEntry.tractCacheKey}, state: ${stateTractCache.state || 'unknown'}`);
            const cloudStorageResult = await cloudStorageCache.get(cachedEntry.tractCacheKey);
            if (cloudStorageResult && cloudStorageResult.data) {
              tractData = cloudStorageResult.data;
              console.log(`✅ CLOUD STORAGE: Retrieved ${Array.isArray(tractData) ? tractData.length : 'non-array'} tracts from Cloud Storage for state: ${stateTractCache.state || 'unknown'}`);
            } else {
              console.warn(`⚠️ CLOUD STORAGE: No data returned from Cloud Storage for key: ${cachedEntry.tractCacheKey}`);
            }
          } catch (cloudError) {
            console.error(`❌ CLOUD STORAGE: Failed to fetch from Cloud Storage for key ${cachedEntry.tractCacheKey}:`, cloudError.message);
          }
        }
        // Check if tract cache is chunked in Firestore
        else if (stateTractCache && stateTractCache.chunked && stateTractCache.chunkKeys) {
          // Fetch all chunks and combine
          console.log(`📦 FIRESTORE: Fetching ${stateTractCache.totalChunks} tract cache chunks...`);
          const chunkPromises = stateTractCache.chunkKeys.map(chunkKey => 
            getCacheDoc(chunkKey)
          );
          const chunkDocs = await Promise.all(chunkPromises);
          
          // Combine all chunks into single array
          const allTracts = [];
          for (const chunkDoc of chunkDocs) {
            if (chunkDoc) {
              const chunkData = chunkDoc;
              if (chunkData.data && Array.isArray(chunkData.data)) {
                allTracts.push(...chunkData.data);
              }
            }
          }
          
          console.log(`✅ FIRESTORE: Combined ${allTracts.length} tracts from ${chunkDocs.length} chunks`);
          tractData = allTracts;
        }
        // Check if tract cache is stored directly in Firestore document
        else if (stateTractCache) {
          if (stateTractCache.tractMap) {
            tractData = stateTractCache.tractMap;
          } else if (stateTractCache.data) {
            tractData = stateTractCache.data;
          }
        }
        
        if (!tractData || !Array.isArray(tractData) || tractData.length === 0) {
          console.warn(`⚠️ State tract cache not found or empty for key: ${cachedEntry.tractCacheKey}, state: ${stateTractCache?.state || 'unknown'}`);
          return res.json({
            status: 'miss',
            cached: false,
            message: 'State tract cache not found or empty'
          });
        }
        
        // Verify state code matches (safety check)
        if (stateTractCache && stateTractCache.state) {
          const expectedState = stateTractCache.state.toUpperCase();
          const cacheKeyState = cachedEntry.tractCacheKey.replace('state_tracts_', '').toUpperCase();
          if (expectedState !== cacheKeyState) {
            console.error(`❌ STATE CODE MISMATCH: Metadata state (${expectedState}) != cache key state (${cacheKeyState}) for key: ${cachedEntry.tractCacheKey}`);
            return res.json({
              status: 'miss',
              cached: false,
              message: `State code mismatch: expected ${expectedState}, got ${cacheKeyState}`
            });
          }
        }
        
        // Decompress using state-level tract cache
        decompressedResult = decompressGeodistrictResult(cachedEntry.data, tractData);
        console.log(`✅ ALGORITHM CACHE HIT (${algorithm}): Retrieved normalized result for key: ${cacheKey} with ${tractData.length} tracts for state: ${stateTractCache?.state || 'unknown'} (algorithm version: ${cachedVersion || 'unknown'})`);
      } else {
        // Handle old format (v1.0) or non-normalized cache
        decompressedResult = cachedEntry.compressed 
          ? decompressGeodistrictResult(cachedEntry.data)
          : cachedEntry.data;
        console.log(`✅ ALGORITHM CACHE HIT (${algorithm}): Retrieved result for key: ${cacheKey} (algorithm version: ${cachedVersion || 'unknown'})`);
      }
      
      return res.json({
        status: 'success',
        cached: true,
        data: decompressedResult,
        algorithmVersion: cachedVersion || 'unknown'
      });
    } else {
      console.log(`❌ ALGORITHM CACHE MISS (${algorithm}): No cached result for key: ${cacheKey}`);
      return res.json({
        status: 'miss',
        cached: false,
        message: 'No cached result found'
      });
    }
  } catch (error) {
    console.error('Error retrieving cached algorithm result:', error);
    res.status(500).json({
      error: 'Failed to retrieve cached division result',
      message: error.message
    });
  }
});

/**
 * Clear algorithm cache (for debugging, supports all algorithm types)
 */
app.delete('/api/algorithm/cache', async (req, res) => {
  try {
    const { cacheKey } = req.body || {};
    const key = cacheKey || req.query.key;

    if (USE_LOCAL_CACHE) {
      if (key) {
        await localCache.deleteCacheEntry(key);
        res.json({
          message: `Latlong cache entry ${key} cleared`,
          cacheMode: 'LOCAL_FILES'
        });
      } else {
        const deletedCount = await localCache.clearAllCache();
        res.json({
          message: `All latlong cache entries cleared (${deletedCount} files)`,
          cacheMode: 'LOCAL_FILES',
          deletedCount
        });
      }
    } else {
      if (key) {
        await deleteCacheDoc(key);
        res.json({
          message: `Latlong cache entry ${key} cleared`,
          cacheMode: 'FIRESTORE'
        });
      } else {
        // Delete all latlong cache entries (those with 'latlong_division' prefix)
        const firestore = getFirestore();
        const snapshot = await firestore.collection('census_cache')
          .where('source', '==', 'latlong-division-cache')
          .get();

        const batch = firestore.batch();

        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        res.json({
          message: `All latlong cache entries cleared (${snapshot.docs.length} documents)`,
          cacheMode: 'FIRESTORE',
          deletedCount: snapshot.docs.length
        });
      }
    }
  } catch (error) {
    console.error('Error clearing latlong cache:', error);
    res.status(500).json({
      error: 'Failed to clear latlong cache',
      cacheMode: USE_LOCAL_CACHE ? 'LOCAL_FILES' : 'FIRESTORE',
      message: error.message
    });
  }
});

// Initialize algorithm service
const algorithmService = new GeodistrictAlgorithmService(latLongDivisionService);

/**
 * POST /api/algorithm/latlong/divide
 * Divide a district group using lat/long dividing lines
 */
app.post('/api/algorithm/latlong/divide', async (req, res) => {
  if (isAlgorithmPostDisabled()) {
    return res.status(503).json({ error: 'Algorithm execution is disabled (read-only mode). Use local backend for development.' });
  }
  try {
    const { group, direction, forceRecalculate = false } = req.body;

    if (!group) {
      return res.status(400).json({ error: 'group is required' });
    }

    if (!direction || (direction !== 'latitude' && direction !== 'longitude')) {
      return res.status(400).json({ error: 'direction must be "latitude" or "longitude"' });
    }

    console.log(`🔀 Dividing district group ${group.startDistrictNumber}-${group.endDistrictNumber} by ${direction}`);

    // Use the backend's latLongDivisionService to compute the division
    const result = await latLongDivisionService.divideDistrictGroup(group, direction, forceRecalculate);

    res.json({
      status: 'success',
      ...result
    });
  } catch (error) {
    console.error('❌ Error dividing district group:', error);
    res.status(500).json({
      error: 'Failed to divide district group',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * GET /api/algorithm/latlong/cache/:cacheKey
 * Get cached latlong division result
 */
app.get('/api/algorithm/latlong/cache/:cacheKey', async (req, res) => {
  try {
    const { cacheKey } = req.params;

    if (!cacheKey) {
      return res.status(400).json({ error: 'cacheKey parameter is required' });
    }

    console.log(`🔍 LATLONG CACHE CHECK: Key=${cacheKey}`);

    // Use Firestore for latlong cache (same as algorithm cache)
    const doc = await getCacheDoc(cacheKey);
    
    if (!doc) {
      console.log(`❌ LATLONG CACHE MISS: No document found for key: ${cacheKey}`);
      return res.json({
        status: 'miss',
        cached: false
      });
    }

    const data = doc.data();
    
    // Check if expired
    if (isCacheExpired(data.timestamp, data.ttl)) {
      console.log(`⏰ LATLONG CACHE EXPIRED: Cache expired for key: ${cacheKey}, deleting`);
      await deleteCacheDoc(cacheKey);
      return res.json({
        status: 'miss',
        cached: false,
        message: 'Cache entry expired'
      });
    }

    // Check algorithm version if present
    if (data.algorithmVersion) {
      const cachedVersion = data.algorithmVersion;
      const currentVersion = ALGORITHM_VERSION;
      
      if (cachedVersion !== currentVersion) {
        console.log(`🔄 LATLONG CACHE VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}. Invalidating.`);
        await deleteCacheDoc(cacheKey);
        return res.json({
          status: 'miss',
          cached: false,
          message: 'Cache entry outdated due to algorithm version change'
        });
      }
    }

    console.log(`✅ LATLONG CACHE HIT: Retrieved data for key: ${cacheKey}`);
    
    // Handle normalized cache if present
    let divisionResult = data.divisionResult || data.data;
    
    if (data.normalized && data.tractCacheKey) {
      // Fetch state-level tract cache and reconstruct
      const stateTractDoc = await getCacheDoc(data.tractCacheKey);
      if (stateTractDoc) {
        const stateTractData = stateTractDoc;
        if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
          // Reconstruct full result with tract geometries
          // This is simplified - full implementation would reconstruct from normalized format
          divisionResult = data.divisionResult || data.data;
        }
      }
    }

    res.json({
      status: 'hit',
      cached: true,
      data: divisionResult,
      algorithmVersion: data.algorithmVersion || 'unknown'
    });
  } catch (error) {
    console.error('❌ Error retrieving latlong cache:', error);
    res.status(500).json({
      error: 'Failed to retrieve cached result',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * POST /api/algorithm/latlong/cache
 * Store latlong division result in cache
 */
app.post('/api/algorithm/latlong/cache', async (req, res) => {
  try {
    const { cacheKey, divisionResult, ttl, algorithmVersion } = req.body;

    if (!cacheKey || !divisionResult) {
      return res.status(400).json({ error: 'cacheKey and divisionResult are required' });
    }

    const cacheTtl = ttl || (24 * 60 * 60 * 1000); // Default 24 hours
    const version = algorithmVersion || ALGORITHM_VERSION;

    console.log(`💾 LATLONG CACHE STORE: Key=${cacheKey}, Version=${version}`);

    // Store in Firestore with source identifier
    const cacheData = {
      divisionResult,
      algorithmVersion: version,
      timestamp: Date.now(),
      ttl: cacheTtl,
      source: 'latlong-division-cache'
    };

    await setCacheDoc(cacheKey, cacheData);

    console.log(`✅ LATLONG CACHE STORED: Key=${cacheKey}`);

    res.json({
      status: 'success',
      message: 'Division result cached successfully',
      cacheKey
    });
  } catch (error) {
    console.error('❌ Error storing latlong cache:', error);
    res.status(500).json({
      error: 'Failed to cache division result',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * POST /api/algorithm/execute
 * Execute algorithm synchronously (returns complete result)
 */
app.post('/api/algorithm/execute', async (req, res) => {
  if (isAlgorithmPostDisabled()) {
    return res.status(503).json({ error: 'Algorithm execution is disabled (read-only mode). Use local backend for development.' });
  }
  try {
    const { state, maxIterations = 100, options = {} } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    // Get number of districts for state
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.status(400).json({ error: `Invalid state: ${state}` });
    }

    // Use backend's own algorithm version (source of truth)
    const currentVersion = ALGORITHM_VERSION;
    const cacheKey = `${state}_${maxIterations}`;

    logger.info(`🚀 Executing algorithm for ${state} (${totalDistricts} districts, maxIterations: ${maxIterations})`);

    // Check cache first and validate version
    let shouldExecute = true;
    let cachedResult = null;
    
    try {
      const doc = await getCacheDoc(cacheKey);
      
      if (doc) {
        const cachedEntry = doc;
        
        // Check if expired
        if (!isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
          const cachedVersion = cachedEntry.algorithmVersion;
          
          logger.debug(`🔍 CACHE CHECK: Found cached result for ${cacheKey}, cached version: ${cachedVersion || 'missing'}, current version: ${currentVersion}`);
          
          // If no version is stored, treat as old cache and invalidate
          if (!cachedVersion) {
            logger.debug(`🔄 ALGORITHM VERSION MISSING: Old cache entry without version. Invalidating and re-executing.`);
            await deleteCacheDoc(cacheKey);
            // Also delete state tract cache if it exists (both Firestore and Cloud Storage)
            if (cachedEntry.tractCacheKey) {
              try {
                const tractCacheDoc = await getCacheDoc(cachedEntry.tractCacheKey);
                if (tractCacheDoc) {
                  const tractCacheData = tractCacheDoc;
                  // Delete from Cloud Storage if it exists there
                  if (tractCacheData?.cloudStoragePath) {
                    try {
                      await cloudStorageCache.delete(cachedEntry.tractCacheKey);
                      console.log(`🗑️ Deleted state tract cache from Cloud Storage: ${cachedEntry.tractCacheKey}`);
                    } catch (e) {
                      console.warn(`⚠️ Failed to delete Cloud Storage cache: ${e.message}`);
                    }
                  }
                  // Delete Firestore metadata
                  await deleteCacheDoc(cachedEntry.tractCacheKey);
                  console.log(`🗑️ Deleted state tract cache from Firestore: ${cachedEntry.tractCacheKey}`);
                }
              } catch (e) {
                console.warn(`⚠️ Error deleting tract cache: ${e.message}`);
              }
            }
            shouldExecute = true;
          } else if (cachedVersion !== currentVersion) {
            logger.debug(`🔄 ALGORITHM VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}. Invalidating cache and re-executing.`);
            await deleteCacheDoc(cacheKey);
            // Also delete state tract cache if it exists (both Firestore and Cloud Storage)
            if (cachedEntry.tractCacheKey) {
              try {
                const tractCacheDoc = await getCacheDoc(cachedEntry.tractCacheKey);
                if (tractCacheDoc) {
                  const tractCacheData = tractCacheDoc;
                  // Delete from Cloud Storage if it exists there
                  if (tractCacheData?.cloudStoragePath) {
                    try {
                      await cloudStorageCache.delete(cachedEntry.tractCacheKey);
                      console.log(`🗑️ Deleted state tract cache from Cloud Storage: ${cachedEntry.tractCacheKey}`);
                    } catch (e) {
                      console.warn(`⚠️ Failed to delete Cloud Storage cache: ${e.message}`);
                    }
                  }
                  // Delete Firestore metadata
                  await deleteCacheDoc(cachedEntry.tractCacheKey);
                  console.log(`🗑️ Deleted state tract cache from Firestore: ${cachedEntry.tractCacheKey}`);
                }
              } catch (e) {
                console.warn(`⚠️ Error deleting tract cache: ${e.message}`);
              }
            }
            shouldExecute = true;
          } else {
            // Version matches - try to return cached result
            console.log(`✅ CACHE HIT: Version matches (${cachedVersion}), returning cached result`);
            shouldExecute = false;
            cachedResult = cachedEntry;
          }
        } else {
          console.log(`⏰ CACHE EXPIRED: Cache entry expired, re-executing`);
          shouldExecute = true;
        }
      } else {
        logger.debug(`❌ CACHE MISS: No cached result found, executing algorithm`);
        shouldExecute = true;
      }
    } catch (cacheError) {
      console.warn(`⚠️ CACHE CHECK ERROR: ${cacheError.message}, proceeding with execution`);
      shouldExecute = true;
    }

    // If we have a valid cached result, return it
    if (!shouldExecute && cachedResult) {
      // Need to decompress and return the full result
      // For now, we'll execute anyway to ensure we return the full result
      // In the future, we could decompress here, but for now let's just execute
      // to keep the response format consistent
      console.log(`⚠️ Cached result found but decompression needed - executing to ensure full result`);
      shouldExecute = true;
    }

    if (!shouldExecute) {
      // This path won't be taken for now since we're executing anyway
      // But keeping the structure for future optimization
      return res.json({
        result: cachedResult.data,
        executionTime: 0,
        cacheKey,
        state,
        totalDistricts,
        tractCount: 0,
        cached: true
      });
    }

    // Extract forceInvalidate option
    const forceInvalidate = options.forceInvalidate || false;

    // Get tract boundaries: always use internal batch fetch so we get full feature set.
    // getTractCount can be capped by TIGER (e.g. 2000), so we never use tract-boundaries URL here.
    let boundaries;
    console.log(`📡 Fetching boundaries via internal batch fetch for state: ${state}`);
    boundaries = await fetchTractBoundariesForState(state);
    if (!boundaries?.features?.length) {
      console.error(`❌ No tract boundaries found for state: ${state}`);
      return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
    }
    console.log(`📦 Boundaries features count: ${boundaries.features.length}`);

    // Get demographic data - need to fetch for all counties in the state
    // First, get all counties for the state
    const countiesUrl = `${req.protocol}://${req.get('host')}/api/census/counties?state=${state}`;
    console.log(`📡 Fetching counties from: ${countiesUrl}`);
    const countiesResponse = await axios.get(countiesUrl);
    
    const counties = countiesResponse.data || [];
    console.log(`📊 Found ${counties.length} counties for state ${state}`);
    
    // Fetch tract data for each county and combine
    // Use forceInvalidate option from request instead of hardcoding
    const demographicDataPromises = counties.map(county => {
      const countyFips = county.COUNTY || county.county || county.fips;
      const tractDataUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}&county=${countyFips}${forceInvalidate ? '&forceInvalidate=true' : ''}`;
      return axios.get(tractDataUrl).then(response => {
        const data = response.data || [];
        // If cached data was empty (2 bytes = "[]"), log a warning
        if (Array.isArray(data) && data.length === 0) {
          console.warn(`⚠️ Empty tract data for county ${countyFips} (may need fresh fetch)`);
        }
        return data;
      }).catch(error => {
        console.warn(`⚠️ Failed to fetch tract data for county ${countyFips}:`, error.message);
        return [];
      });
    });
    
    const demographicDataArrays = await Promise.all(demographicDataPromises);
    const demographicData = demographicDataArrays.flat();
    
    console.log(`📊 Demographic data count: ${demographicData.length} tracts across ${counties.length} counties`);

    // Load S4 adjacency data BEFORE creating canonical tract model (needed for attachment)
    const s4DataLoader = require('./services/s4-data-loader');
    try {
      await s4DataLoader.loadS4AdjacencyData(state);
      console.log(`✅ Loaded S4 adjacency data for ${state} before creating canonical tract model`);
    } catch (error) {
      console.warn(`⚠️ Failed to load S4 adjacency data for ${state}: ${error.message}`);
    }

    // Use canonical tract model: Census API is PRIMARY source, TIGER polygons and S4 data are attached
    // This uses a Map keyed by tract ID to prevent duplicates
    const { createCanonicalTractMap } = require('./services/canonical-tract-loader');
    const canonicalResult = createCanonicalTractMap(demographicData, boundaries, state);
    
    // Use the GeoJSON features array for compatibility with existing code
    const tracts = canonicalResult.geoJsonFeatures;
    
    console.log(`📊 Canonical tract model: ${canonicalResult.stats.totalCanonicalTracts} tracts, ${canonicalResult.stats.tractsWithGeometry} with geometry`);
    if (canonicalResult.stats.tractsWithoutGeometry > 0) {
      console.warn(`⚠️ ${canonicalResult.stats.tractsWithoutGeometry} tracts have no geometry (missing TIGER polygons)`);
    }

    if (tracts.length === 0) {
      return res.status(404).json({ error: `No tracts found for state: ${state}` });
    }
    
    // Detect and store enclosed tract relationships
    const { detectEnclosedTracts, getTractId } = require('./services/geodistrict-algorithm');
    const enclosedMap = detectEnclosedTracts(tracts);
    
      // Store enclosed/enclosing relationships in tract properties
      // Also assign TRACT_GROUP_ID so enclosed and enclosing tracts always move together
      // Use getTractId to ensure consistent ID format
      const tractIdMap = new Map(); // Map<tractId, tract> for lookup
      for (const tract of tracts) {
        const tractId = getTractId(tract);
        if (tractId) {
          tractIdMap.set(tractId, tract);
        }
      }
      
      // Assign TRACT_GROUP_ID to link enclosed and enclosing tracts together
      let nextGroupId = 1;
      const groupIdMap = new Map(); // Map<tractId, groupId>
      
      for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
        // Check if either tract already has a group ID
        let groupId = groupIdMap.get(enclosedId) || groupIdMap.get(enclosingId);
        if (!groupId) {
          groupId = `group_${nextGroupId++}`;
        }
        // Assign same group ID to both
        groupIdMap.set(enclosedId, groupId);
        groupIdMap.set(enclosingId, groupId);
      }
      
      // Store metadata in tract properties
      for (const tract of tracts) {
        const tractId = getTractId(tract);
        if (!tractId) continue;
        
        if (enclosedMap.has(tractId)) {
          tract.properties.ENCLOSED_BY = enclosedMap.get(tractId);
        }
        // Also store reverse relationship (which tracts this tract encloses)
        const enclosedByThis = [];
        for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
          if (enclosingId === tractId) {
            enclosedByThis.push(enclosedId);
          }
        }
        if (enclosedByThis.length > 0) {
          tract.properties.ENCLOSES = enclosedByThis;
        }
        // Store TRACT_GROUP_ID so they always move together
        if (groupIdMap.has(tractId)) {
          tract.properties.TRACT_GROUP_ID = groupIdMap.get(tractId);
          if (tractId.includes('001700') || tractId.includes('002302') || tractId.includes('48409')) {
            console.log(`🔗 Assigned TRACT_GROUP_ID ${groupIdMap.get(tractId)} to tract ${tractId}`);
          }
        }
      }
      
      console.log(`✅ Assigned ${nextGroupId - 1} tract group IDs for ${enclosedMap.size} enclosed tracts`);

    console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

    // Isolation strategy: 'none' (default, grid-only), 'perStep' (resolve after each division), 'finalStepOnly' (resolve once at final step)
    const isolationStrategy = req.body.isolationStrategy ?? (req.body.resolveIsolation === true ? 'perStep' : 'none');

    // Track tract cache key for step caching
    const tractCacheKey = `state_tracts_${state}`;
    
    // Callback to cache each step as it's completed
    const onStepComplete = async (stepNumber, stepData, shouldCache) => {
      if (!shouldCache) return true;
      
      try {
        // Union polygons are built async via POST .../union-polygons; do not build inline
        const isFinalStep = stepData.districtGroups.length > 0 &&
          stepData.districtGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
        const totalIsolated = stepData.isolatedTractsData?.totalIsolated ?? 0;
        const stepCompleteForUnions = isFinalStep && totalIsolated === 0 && stepNumber > 0;
        // Normalize step data (remove geometries, keep only IDs)
        const normalized = normalizeStepData(stepData, tractCacheKey);
        const unionPolygonCacheKeys = {};
        
        // Create step cache key (run-all uses step_ format)
        const stepCacheKey = `step_${state}_${stepNumber}_${currentVersion}`;
        
        // Store normalized step in Firestore; union polygons will be built by async job
        const stepCacheEntry = {
          ...normalized.normalized,
          timestamp: Date.now(),
          ttl: null, // Steps don't expire
          version: CACHE_VERSION,
          algorithmVersion: currentVersion,
          source: 'step-cache',
          state: state,
          step: stepNumber,
          isComplete: false, // Will be updated when algorithm completes
          unionPolygonsCached: false
        };

        await setCacheDoc(stepCacheKey, stepCacheEntry);
        
        logger.debug(`💾 Cached step ${stepNumber} for ${state} (union polygons will be built when algorithm completes)`);
        if (stepCompleteForUnions) {
          setImmediate(() => {
            const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
            const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${state}?finalStepNumber=${stepNumber}&maxIterations=${maxIterations}`;
            axios.post(buildAllUrl, {}).then(() => {
              console.log(`✅ POST build-all-union-polygons accepted (202) for ${state} final step ${stepNumber}`);
            }).catch((err) => {
              console.error(`❌ Failed to trigger build-all union polygon job for ${state}:`, err.message);
            });
          });
        }
      } catch (error) {
        logger.warn(`⚠️ Failed to cache step ${stepNumber}: ${error.message}`);
      }
      
      return true; // Continue execution
    };

    // Run mode: isolationStrategy 'perStep' = resolve after each division; 'finalStepOnly' = resolve once at end; 'none' = no resolution (default).
    const startTime = Date.now();
    const result = await algorithmService.executeGeodistrictAlgorithm(
      tracts,
      totalDistricts,
      maxIterations,
      options.forceInvalidate || false,
      isolationStrategy === 'perStep', // backward compat: resolveIsolation
      onStepComplete,
      isolationStrategy
    );
    const executionTime = Date.now() - startTime;

    logger.info(`✅ Algorithm completed in ${executionTime}ms (${result.steps.length} steps)`);

    // Verify all steps 1..N-1 are in cache before marking final step complete
    const missingStepIndices = [];
    for (let stepNum = 1; stepNum < result.steps.length; stepNum++) {
      const stepEntry = await getStepCacheEntry(state, stepNum, maxIterations);
      if (!stepEntry) {
        missingStepIndices.push(stepNum);
        logger.warn(`⚠️ Step ${stepNum} not found in cache after algorithm completion`);
      }
    }
    if (missingStepIndices.length > 0) {
      logger.warn(`⚠️ Missing step indices in cache: ${missingStepIndices.join(', ')}`);
    } else if (result.steps.length > 1) {
      logger.debug(`✅ All steps 1..${result.steps.length - 1} verified in cache`);
    }

    // Mark final step as complete in cache
    if (result.steps.length > 0) {
      try {
        const finalStepNumber = result.steps.length - 1;
        const finalStepCacheKey = `step_${state}_${finalStepNumber}_${currentVersion}`;
        if (USE_LOCAL_CACHE) {
          const doc = await getCacheDoc(finalStepCacheKey);
          if (doc) await setCacheDoc(finalStepCacheKey, { ...doc, isComplete: true });
        } else {
          const finalStepDocRef = getFirestore().collection('census_cache').doc(finalStepCacheKey);
          await finalStepDocRef.update({ isComplete: true });
        }
        logger.debug(`✅ Marked final step ${finalStepNumber} as complete`);
      } catch (error) {
        logger.warn(`⚠️ Failed to mark final step as complete: ${error.message}`);
      }
    }

    // Cache the result automatically (async, don't wait for it)
    // Use backend's own algorithm version when caching
    cacheAlgorithmResult(cacheKey, result, state, currentVersion, null, null)
      .then(cacheResult => {
        if (cacheResult.success) {
          logger.debug(`💾 Backend automatically cached result for ${state} (${cacheResult.sizes?.normalizedMB || 0} MB algorithm, ${cacheResult.sizes?.tractCacheMB || 0} MB tracts)`);
        } else {
          logger.warn(`⚠️ Backend caching failed for ${state}: ${cacheResult.error}`);
        }
      })
      .catch(err => {
        logger.error(`❌ Backend caching error for ${state}:`, err.message);
      });

    res.json({
      result,
      executionTime,
      cacheKey,
      state,
      totalDistricts,
      tractCount: tracts.length,
      cached: true // Indicate that backend cached it
    });
  } catch (error) {
    logger.error('❌ Algorithm execution error:', error);
    res.status(500).json({
      error: 'Algorithm execution failed',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * POST /api/algorithm/:algorithm/execute/step-by-step
 * Execute algorithm with step-by-step streaming (Server-Sent Events)
 */
// Note: Algorithm state is now cached in Firestore/Cloud Storage (stateless for Cloud Run)

/**
 * When true, POST algorithm execution (execute, step-by-step, next-step, latlong/divide) returns 503.
 * Set GEODISTRICTS_READONLY=true in production to keep visualization GET-only.
 */
function isAlgorithmPostDisabled() {
  return process.env.GEODISTRICTS_READONLY === 'true';
}

/**
 * Generate a key for algorithm state storage
 */
function getAlgorithmStateKey(state, maxIterations) {
  return `${state}_${maxIterations}`;
}

/**
 * Ensure Step 0 uses TIGER state boundaries instead of tract-based union polygons
 * This is a centralized function to handle step 0 union polygon logic consistently
 * @param {Object} stepData - Step data with districtGroups
 * @param {string} state - State code
 * @param {number} stepNumber - Step number (should be 0)
 * @param {Object} req - Express request object (for building URLs)
 * @returns {Promise<Object>} Updated step data with TIGER state boundaries
 */
async function ensureStep0UsesTigerBoundaries(stepData, state, stepNumber, req) {
  // Only process step 0
  if (stepNumber !== 0 && stepNumber !== '0') {
    return stepData;
  }
  
  if (!stepData || !stepData.districtGroups || stepData.districtGroups.length === 0) {
    console.warn(`⚠️ STEP 0: No district groups in step data, cannot set TIGER boundaries`);
    return stepData;
  }
  
  const step0Group = stepData.districtGroups[0];
  console.log(`🔍 STEP 0: Ensuring TIGER state boundary is set (current: hasUnionPolygon=${!!step0Group.unionPolygon}, hasUnionPolygons=${!!step0Group.unionPolygons})`);
  
  // First, try to load union polygons from cache to check if TIGER-based ones exist
  try {
    const groupsWithUnions = await loadUnionPolygonsFromCache(state, stepNumber, stepData.districtGroups);
    stepData.districtGroups = groupsWithUnions;
    const updatedStep0Group = stepData.districtGroups[0];
    
    // Check if we have a valid TIGER-based union polygon
    let hasValidTigerBoundary = false;
    if (updatedStep0Group.unionPolygon && updatedStep0Group.unionPolygonCacheKey) {
      try {
        const unionCacheDoc = await getCacheDoc(updatedStep0Group.unionPolygonCacheKey);
        if (unionCacheDoc) {
          const metadata = unionCacheDoc;
          hasValidTigerBoundary = metadata.tigerBased === true || metadata.source === 'tiger-state-boundary';
        }
      } catch (e) {
        // If we can't check metadata, assume it's not TIGER-based
        hasValidTigerBoundary = false;
      }
    }
    
    // If no valid TIGER boundary, use same state boundary as "All" states map (getOrCreateStateBoundaryInCloudStorage)
    if (!hasValidTigerBoundary) {
      console.log(`🔍 STEP 0: Using shared state boundary (same as All-states map)...`);
      try {
        const mainStateBoundary = await getOrCreateStateBoundaryInCloudStorage(state);
        if (mainStateBoundary && (mainStateBoundary.type === 'Feature' || mainStateBoundary.geometry)) {
          updatedStep0Group.unionPolygon = mainStateBoundary;
          updatedStep0Group.unionPolygons = [mainStateBoundary];
          const stateBoundaryKey = `state_boundary_polygon_${state.toUpperCase()}`;
          updatedStep0Group.unionPolygonCacheKey = stateBoundaryKey;
          console.log(`✅ STEP 0: Set state boundary from shared cache (${stateBoundaryKey})`);
        } else {
          console.error(`❌ STEP 0: getOrCreateStateBoundaryInCloudStorage returned invalid boundary`);
        }
      } catch (stateBoundaryError) {
        console.error(`❌ STEP 0: Failed to get state boundary: ${stateBoundaryError.message}`);
      }
    } else {
      console.log(`✅ STEP 0: Valid TIGER state boundary already loaded from cache`);
    }
  } catch (unionLoadError) {
    console.warn(`⚠️ STEP 0: Failed to load union polygons from cache: ${unionLoadError.message}, using shared state boundary...`);
    try {
      const mainStateBoundary = await getOrCreateStateBoundaryInCloudStorage(state);
      if (mainStateBoundary && (mainStateBoundary.type === 'Feature' || mainStateBoundary.geometry)) {
        step0Group.unionPolygon = mainStateBoundary;
        step0Group.unionPolygons = [mainStateBoundary];
        const stateBoundaryKey = `state_boundary_polygon_${state.toUpperCase()}`;
        step0Group.unionPolygonCacheKey = stateBoundaryKey;
        console.log(`✅ STEP 0: Set state boundary from shared cache (fallback, ${stateBoundaryKey})`);
      }
    } catch (stateBoundaryError) {
      console.error(`❌ STEP 0: Failed to get state boundary as fallback: ${stateBoundaryError.message}`);
    }
  }
  
  return stepData;
}

/**
 * Load tracts from state tract cache when valid (version, TTL, geometry coverage).
 * Used by step-by-step to skip external boundaries + bulk fetch and keep EXTERNAL FETCH rare.
 * @param {string} state - State code (e.g. 'CA')
 * @returns {Promise<{ tracts: Array, tractCacheKey: string } | null>} Tracts array and key, or null if not usable
 */
async function loadTractsFromStateTractCache(state) {
  const tractCacheKey = `state_tracts_${state}`;
  const { getTractId } = require('./services/geodistrict-algorithm');
  const GEOMETRY_COVERAGE_THRESHOLD = 0.95;

  try {
    let stateTractDoc = await getCacheDoc(tractCacheKey);
    // When local cache is empty (e.g. after clear-cache or first run), try Cloud Storage so we don't refetch from TIGER
    if (!stateTractDoc) {
      try {
        const cloudResult = await cloudStorageCache.get(tractCacheKey);
        if (cloudResult && cloudResult.data) {
          let tractMap = cloudResult.data;
          if (tractMap && tractMap.type === 'FeatureCollection' && Array.isArray(tractMap.features)) {
            tractMap = tractMap.features;
          } else if (!Array.isArray(tractMap)) {
            tractMap = tractMap.data || null;
          }
          if (tractMap && Array.isArray(tractMap) && tractMap.length > 0) {
            let tracts = [];
            if (Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
              tracts = tractMap.map(([, t]) => t).filter(Boolean);
            } else {
              tracts = tractMap.filter(t => t && (t.geometry || (t.type === 'Feature' && t.geometry)));
            }
            if (tracts.length > 0) {
              const sampleSize = Math.min(200, tracts.length);
              const step = Math.max(1, Math.floor(tracts.length / sampleSize));
              let withGeometry = 0;
              for (let i = 0; i < tracts.length && withGeometry < sampleSize; i += step) {
                const t = tracts[i];
                if (t && (t.geometry || (t.type === 'Feature' && t.geometry))) withGeometry++;
              }
              const coverage = sampleSize > 0 ? withGeometry / sampleSize : 0;
              if (coverage >= GEOMETRY_COVERAGE_THRESHOLD) {
                console.log(`✅ STATE TRACT CACHE: Loaded ${tracts.length} tracts for ${state} from Cloud Storage (skip external fetch)`);
                return { tracts, tractCacheKey };
              }
            }
          }
        }
      } catch (cloudErr) {
        console.warn(`⚠️ loadTractsFromStateTractCache(${state}): Cloud Storage fallback failed: ${cloudErr.message}`);
      }
      return null;
    }

    // Local cache (USE_LOCAL_CACHE) stores state_tracts as raw array via setCacheDoc(key, finalTractMap).
    // Firestore/production stores a metadata wrapper with .data / .chunkKeys / .cloudStorage. Accept both.
    let tractMap = null;
    if (Array.isArray(stateTractDoc) && stateTractDoc.length > 0) {
      tractMap = stateTractDoc;
      if (USE_LOCAL_CACHE) {
        console.log(`✅ STATE TRACT CACHE: Found local file cache for ${state} (${stateTractDoc.length} entries), checking geometry coverage...`);
      }
    } else {
      const stateTractData = stateTractDoc;
      if (stateTractData.algorithmVersion !== ALGORITHM_VERSION) return null;
      if (isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) return null;

      if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
        const cloudResult = await cloudStorageCache.get(tractCacheKey);
        if (cloudResult && cloudResult.data) tractMap = cloudResult.data;
      } else if (stateTractData.chunked && stateTractData.chunkKeys) {
        const chunkDocs = await Promise.all(
          stateTractData.chunkKeys.map(key => getCacheDoc(key))
        );
        tractMap = [];
        for (const chunkDoc of chunkDocs) {
          if (chunkDoc && chunkDoc.data && Array.isArray(chunkDoc.data)) {
            tractMap.push(...chunkDoc.data);
          }
        }
      } else if (stateTractData.data && Array.isArray(stateTractData.data)) {
        tractMap = stateTractData.data;
      }
    }
    if (!tractMap || (Array.isArray(tractMap) && tractMap.length === 0)) return null;

    let tracts = [];
    if (Array.isArray(tractMap) && tractMap.length > 0 && Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
      tracts = tractMap.map(([, t]) => t).filter(Boolean);
    } else if (Array.isArray(tractMap)) {
      tracts = tractMap.filter(t => t && (t.geometry || (t.type === 'Feature' && t.geometry)));
    }
    if (tracts.length === 0) return null;

    const sampleSize = Math.min(200, tracts.length);
    const step = Math.max(1, Math.floor(tracts.length / sampleSize));
    let withGeometry = 0;
    for (let i = 0; i < tracts.length && withGeometry < sampleSize; i += step) {
      const t = tracts[i];
      if (t && (t.geometry || (t.type === 'Feature' && t.geometry))) withGeometry++;
    }
    const coverage = sampleSize > 0 ? withGeometry / sampleSize : 0;
    if (coverage < GEOMETRY_COVERAGE_THRESHOLD) return null;

    console.log(`✅ STATE TRACT CACHE: Loaded ${tracts.length} tracts for ${state} (skip external fetch)`);
    return { tracts, tractCacheKey };
  } catch (err) {
    console.warn(`⚠️ loadTractsFromStateTractCache(${state}): ${err.message}`);
    return null;
  }
}

/**
 * Normalize algorithm state for caching (remove full geometries, store only tract IDs)
 * @param {Object} algorithmState - Algorithm state with potentially full geometries
 * @param {string} tractCacheKey - Tract cache key for reference
 * @returns {Object} Normalized algorithm state with only tract IDs
 */
function normalizeAlgorithmState(algorithmState, tractCacheKey) {
  const { getTractId } = require('./services/geodistrict-algorithm');
  
  // Normalize uniqueTracts to uniqueTractIds
  const uniqueTractIds = algorithmState.uniqueTracts 
    ? algorithmState.uniqueTracts.map(tract => getTractId(tract)).filter(Boolean)
    : (algorithmState.uniqueTractIds || []);
  
  // Normalize currentGroups to store only tract IDs
  const normalizedCurrentGroups = algorithmState.currentGroups ? algorithmState.currentGroups.map(group => {
    // If already normalized (has censusTractIds), return as-is
    if (group.censusTractIds && !group.censusTracts) {
      return group;
    }
    
    const normalizedGroup = {
      startDistrictNumber: group.startDistrictNumber,
      endDistrictNumber: group.endDistrictNumber,
      totalDistricts: group.totalDistricts,
      totalPopulation: group.totalPopulation,
      bounds: group.bounds,
      centroid: group.centroid,
      lastDivisionDirection: group.lastDivisionDirection ?? null,
      censusTractIds: group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []
    };
    if (group.unionPolygonCacheKey) {
      normalizedGroup.unionPolygonCacheKey = group.unionPolygonCacheKey;
    }
    return normalizedGroup;
  }) : [];
  
  // Normalize steps array to store only tract IDs
  const normalizedSteps = algorithmState.steps ? algorithmState.steps.map(step => {
    if (!step) return step;
    // If already normalized (has districtGroups with censusTractIds), still serialize Firestore-unsafe fields
    if (step.districtGroups && step.districtGroups.length > 0 && 
        step.districtGroups[0].censusTractIds && !step.districtGroups[0].censusTracts) {
      const stepCopy = { ...step };
      if (stepCopy.dgAdjacentGroupsByGroup) {
        stepCopy.dgAdjacentGroupsByGroup = serializeDgAdjacentGroupsByGroupForFirestore(stepCopy.dgAdjacentGroupsByGroup);
      }
      if (stepCopy.islandTractsData) {
        stepCopy.islandTractsData = serializeIslandTractsDataForFirestore(stepCopy.islandTractsData);
      }
      return stepCopy;
    }
    if (!step.districtGroups) return step;
    const normalized = normalizeStepData(step, tractCacheKey);
    return normalized.normalized;
  }) : [];
  
  return {
    uniqueTractIds,
    tractCacheKey: algorithmState.tractCacheKey || tractCacheKey,
    currentGroups: normalizedCurrentGroups,
    iteration: algorithmState.iteration,
    steps: normalizedSteps,
    algorithmHistory: algorithmState.algorithmHistory || [],
    totalStatePopulation: algorithmState.totalStatePopulation,
    targetDistrictPopulation: algorithmState.targetDistrictPopulation,
    maxIterations: algorithmState.maxIterations,
    state: algorithmState.state
  };
}

/**
 * Cache algorithm state to Firestore/Cloud Storage (stateless for Cloud Run)
 * @param {string} stateKey - Algorithm state key
 * @param {Object} algorithmState - Algorithm state object
 * @returns {Promise<void>}
 */
async function cacheAlgorithmState(stateKey, algorithmState) {
  try {
    // Normalize algorithm state to remove full geometries (store only tract IDs)
    const tractCacheKey = algorithmState.tractCacheKey || `state_tracts_${algorithmState.state || stateKey.split('_')[0]}`;
    const normalizedState = normalizeAlgorithmState(algorithmState, tractCacheKey);
    
    const cacheKey = `algorithm_state_${stateKey}`;
    const stateSize = JSON.stringify(normalizedState).length;
    const stateSizeMB = (stateSize / (1024 * 1024)).toFixed(2);
    const FIRESTORE_MAX_SIZE = 1024 * 1024; // 1MB
    
    // Use Cloud Storage for large state objects (> 1MB)
    if (stateSize > FIRESTORE_MAX_SIZE) {
      console.log(`📦 CLOUD STORAGE: Storing algorithm state (${stateSizeMB} MB) for ${stateKey} in Cloud Storage`);
      
      try {
        const cloudStoragePath = await cloudStorageCache.set(cacheKey, normalizedState, {
          state: normalizedState.state,
          source: 'algorithm-state-cache'
        });
        
        // Store metadata reference in Firestore
        const metadataEntry = {
          cloudStoragePath: cloudStoragePath,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          version: CACHE_VERSION,
          algorithmVersion: ALGORITHM_VERSION,
          source: 'algorithm-state-cache-metadata',
          cloudStorage: true,
          state: normalizedState.state,
          size: stateSize,
          sizeMB: parseFloat(stateSizeMB)
        };
        
        await setCacheDoc(cacheKey, metadataEntry);
        console.log(`💾 CLOUD STORAGE: Stored algorithm state for ${stateKey} at ${cloudStoragePath}`);
      } catch (error) {
        console.error(`❌ CLOUD STORAGE: Failed to store algorithm state: ${error.message}`);
        throw error;
      }
    } else {
      // Store directly in Firestore for smaller state objects
      const cacheEntry = {
        data: normalizedState,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        version: CACHE_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        source: 'algorithm-state-cache',
        cloudStorage: false,
        state: normalizedState.state,
        size: stateSize,
        sizeMB: parseFloat(stateSizeMB)
      };
      
      await setCacheDoc(cacheKey, cacheEntry);
      console.log(`💾 FIRESTORE: Stored algorithm state for ${stateKey} (${stateSizeMB} MB)`);
    }
  } catch (error) {
    console.error(`❌ Failed to cache algorithm state for ${stateKey}: ${error.message}`);
    throw error;
  }
}

/**
 * Reconstruct uniqueTracts from uniqueTractIds using tract cache
 * @param {Object} algorithmState - Algorithm state (may have uniqueTractIds or uniqueTracts)
 * @returns {Promise<Array>} Array of tract features
 */
async function reconstructUniqueTracts(algorithmState) {
  // If already has uniqueTracts, return it
  if (algorithmState.uniqueTracts && Array.isArray(algorithmState.uniqueTracts)) {
    return algorithmState.uniqueTracts;
  }
  
  // Otherwise, reconstruct from uniqueTractIds using tract cache
  if (!algorithmState.uniqueTractIds || !Array.isArray(algorithmState.uniqueTractIds)) {
    console.warn(`⚠️ Algorithm state has neither uniqueTracts nor uniqueTractIds`);
    return [];
  }
  
  const tractCacheKey = algorithmState.tractCacheKey || `state_tracts_${algorithmState.state}`;
  console.log(`🔄 Reconstructing ${algorithmState.uniqueTractIds.length} tracts from cache: ${tractCacheKey}`);
  
  try {
    // Get tract cache
    const stateTractDoc = await getCacheDoc(tractCacheKey);
    if (!stateTractDoc) {
      console.error(`❌ Tract cache not found: ${tractCacheKey}`);
      return [];
    }
    
    const stateTractData = stateTractDoc;
    let tractMap = null;
    
    // Get tract map from Cloud Storage or Firestore
    if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
      const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
      if (cloudStorageResult && cloudStorageResult.data) {
        tractMap = cloudStorageResult.data;
      }
    } else if (stateTractData.chunked && stateTractData.chunkKeys) {
      const chunkDocs = await Promise.all(
        stateTractData.chunkKeys.map(key => getCacheDoc(key))
      );
      const allTracts = [];
      for (const chunkDoc of chunkDocs) {
        if (chunkDoc && chunkDoc.data) {
          allTracts.push(...chunkDoc.data);
        }
      }
      tractMap = allTracts;
    } else if (stateTractData.data) {
      tractMap = stateTractData.data;
    }
    
    if (!tractMap) {
      console.error(`❌ Could not retrieve tract map from cache: ${tractCacheKey}`);
      return [];
    }
    
    // Build lookup map
    const { getTractId } = require('./services/geodistrict-algorithm');
    const lookupMap = new Map();
    
    if (Array.isArray(tractMap)) {
      if (tractMap.length > 0 && Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
        // [id, tract] pairs
        for (const [id, tract] of tractMap) {
          lookupMap.set(id, tract);
        }
      } else {
        // Just tracts
        for (const tract of tractMap) {
          const tractId = getTractId(tract);
          if (tractId) {
            lookupMap.set(tractId, tract);
          }
        }
      }
    }

    // Validate geometry coverage: if too many tracts lack geometry, treat cache as invalid
    const GEOMETRY_COVERAGE_THRESHOLD = 0.95;
    if (lookupMap.size > 0) {
      const entries = Array.from(lookupMap.entries());
      const sampleSize = Math.min(200, entries.length);
      const step = Math.max(1, Math.floor(entries.length / sampleSize));
      let withGeometry = 0;
      let sampled = 0;
      for (let i = 0; i < entries.length && sampled < sampleSize; i += step) {
        const tract = entries[i][1];
        if (tract && (tract.geometry || (tract.type === 'Feature' && tract.geometry))) withGeometry++;
        sampled++;
      }
      const coverage = sampled > 0 ? withGeometry / sampled : 0;
      if (coverage < GEOMETRY_COVERAGE_THRESHOLD) {
        console.error(`❌ TRACT CACHE INVALID: geometry coverage ${(coverage * 100).toFixed(1)}% (${withGeometry}/${sampled}) below ${(GEOMETRY_COVERAGE_THRESHOLD * 100)}%. Refusing to use cache.`);
        return [];
      }
    }
    
    // Reconstruct uniqueTracts from IDs
    const uniqueTracts = [];
    for (const tractId of algorithmState.uniqueTractIds) {
      const tract = lookupMap.get(tractId);
      if (tract) {
        uniqueTracts.push(tract);
      }
    }
    
    console.log(`✅ Reconstructed ${uniqueTracts.length} tracts from ${algorithmState.uniqueTractIds.length} IDs`);
    return uniqueTracts;
  } catch (error) {
    console.error(`❌ Failed to reconstruct uniqueTracts: ${error.message}`);
    return [];
  }
}

/**
 * Retrieve algorithm state from cache (stateless for Cloud Run)
 * @param {string} stateKey - Algorithm state key
 * @returns {Promise<Object|null>} Algorithm state or null if not found/expired
 */
async function getCachedAlgorithmState(stateKey) {
  try {
    const cacheKey = `algorithm_state_${stateKey}`;
    console.log(`🔍 GET-CACHED-STATE: Looking for cached algorithm state with key: ${cacheKey}`);
    const doc = await getCacheDoc(cacheKey);
    
    if (!doc) {
      console.log(`⚠️ GET-CACHED-STATE: Algorithm state cache document not found: ${cacheKey}`);
      if (!USE_LOCAL_CACHE) {
        try {
          const allDocs = await getFirestore().collection('census_cache')
            .where('source', '==', 'algorithm-state-cache-metadata')
            .where('state', '==', stateKey.split('_')[0])
            .limit(5)
            .get();
          console.log(`🔍 GET-CACHED-STATE: Found ${allDocs.size} algorithm state metadata docs for state ${stateKey.split('_')[0]}`);
          allDocs.forEach(d => {
            console.log(`   - Doc ID: ${d.id}, state: ${d.data().state}, size: ${d.data().sizeMB}MB`);
          });
        } catch (listError) {
          console.warn(`⚠️ GET-CACHED-STATE: Could not list docs: ${listError.message}`);
        }
      }
      return null;
    }
    
    const cachedEntry = doc;
    
    console.log(`🔍 GET-CACHED-STATE: Found document, checking validity...`);
    console.log(`   - Has cloudStorage: ${!!cachedEntry.cloudStorage}`);
    console.log(`   - Has cloudStoragePath: ${!!cachedEntry.cloudStoragePath}`);
    console.log(`   - Has data: ${!!cachedEntry.data}`);
    console.log(`   - Algorithm version: ${cachedEntry.algorithmVersion || 'none'}`);
    console.log(`   - Current version: ${ALGORITHM_VERSION}`);
    console.log(`   - Timestamp: ${cachedEntry.timestamp}, TTL: ${cachedEntry.ttl}`);
    
    // Check if expired
    if (isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
      console.log(`⚠️ GET-CACHED-STATE: Cached algorithm state for ${stateKey} is expired`);
      return null;
    }
    
    // Check algorithm version
    if (cachedEntry.algorithmVersion !== ALGORITHM_VERSION) {
      console.log(`⚠️ GET-CACHED-STATE: Cached algorithm state version mismatch (${cachedEntry.algorithmVersion || 'none'} != ${ALGORITHM_VERSION}) for ${stateKey}`);
      return null;
    }
    
    // Retrieve data based on storage location
    if (cachedEntry.cloudStorage && cachedEntry.cloudStoragePath) {
      // Fetch from Cloud Storage
      console.log(`🔍 GET-CACHED-STATE: Fetching from Cloud Storage: ${cachedEntry.cloudStoragePath}`);
      try {
        const cloudStorageResult = await cloudStorageCache.get(cacheKey);
        if (cloudStorageResult && cloudStorageResult.data) {
          console.log(`✅ GET-CACHED-STATE: Retrieved algorithm state for ${stateKey} from Cloud Storage`);
          console.log(`   - Has uniqueTracts: ${!!cloudStorageResult.data.uniqueTracts}`);
          console.log(`   - Has uniqueTractIds: ${!!cloudStorageResult.data.uniqueTractIds}`);
          console.log(`   - Iteration: ${cloudStorageResult.data.iteration}`);
          return cloudStorageResult.data;
        } else {
          console.warn(`⚠️ GET-CACHED-STATE: Cloud Storage returned no data for ${cacheKey}`);
        }
      } catch (error) {
        console.error(`❌ GET-CACHED-STATE: Failed to retrieve algorithm state from Cloud Storage: ${error.message}`);
        return null;
      }
    } else {
      // Fetch from Firestore
      if (cachedEntry.data) {
        console.log(`✅ GET-CACHED-STATE: Retrieved algorithm state for ${stateKey} from Firestore`);
        console.log(`   - Has uniqueTracts: ${!!cachedEntry.data.uniqueTracts}`);
        console.log(`   - Has uniqueTractIds: ${!!cachedEntry.data.uniqueTractIds}`);
        console.log(`   - Iteration: ${cachedEntry.data.iteration}`);
        return cachedEntry.data;
      } else {
        console.warn(`⚠️ GET-CACHED-STATE: Firestore document has no data field`);
      }
    }
    
    console.warn(`⚠️ GET-CACHED-STATE: Could not retrieve algorithm state data for ${stateKey}`);
    return null;
  } catch (error) {
    console.error(`❌ Failed to retrieve cached algorithm state for ${stateKey}: ${error.message}`);
    return null;
  }
}

/**
 * Delete cached algorithm state
 * @param {string} stateKey - Algorithm state key
 * @returns {Promise<void>}
 */
async function deleteCachedAlgorithmState(stateKey) {
  try {
    const cacheKey = `algorithm_state_${stateKey}`;
    const doc = await getCacheDoc(cacheKey);
    
    if (doc) {
      const cachedEntry = doc;
      
      // Delete from Cloud Storage if applicable
      if (cachedEntry.cloudStorage && cachedEntry.cloudStoragePath) {
        try {
          await cloudStorageCache.delete(cacheKey);
          console.log(`🗑️ Deleted algorithm state from Cloud Storage for ${stateKey}`);
        } catch (error) {
          console.warn(`⚠️ Failed to delete algorithm state from Cloud Storage: ${error.message}`);
        }
      }
      
      // Delete from Firestore
      await deleteCacheDoc(cacheKey);
      console.log(`🗑️ Deleted algorithm state cache for ${stateKey}`);
    }
  } catch (error) {
    console.error(`❌ Failed to delete cached algorithm state for ${stateKey}: ${error.message}`);
  }
}

/**
 * Congressional district boundaries (Lewis repo data from cloud storage).
 * State names as in Lewis repo filenames (e.g. Alabama, New_York).
 */
const STATE_CODE_TO_LEWIS_NAME = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New_Hampshire', NJ: 'New_Jersey',
  NM: 'New_Mexico', NY: 'New_York', NC: 'North_Carolina', ND: 'North_Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode_Island', SC: 'South_Carolina', SD: 'South_Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West_Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District_of_Columbia'
};

function resolveStateToLewisName(stateParam) {
  const s = String(stateParam).trim();
  if (s.length === 2) {
    const name = STATE_CODE_TO_LEWIS_NAME[s.toUpperCase()];
    if (name) return name;
  }
  return s.replace(/\s+/g, '_');
}

/**
 * GET /api/congressional-boundaries/:congress
 * List state names that have boundary data for this Congress (from cloud storage).
 */
app.get('/api/congressional-boundaries/:congress', async (req, res) => {
  try {
    const congress = req.params.congress;
    const stateNames = await cloudStorageCache.listCongressionalBoundaryStates(congress);
    return res.json({ congress: Number(congress) || congress, stateNames });
  } catch (error) {
    console.error('GET /api/congressional-boundaries/:congress error:', error);
    res.status(500).json({ error: 'Failed to list congressional boundaries', message: error.message });
  }
});

/**
 * GET /api/congressional-boundaries/:congress/:state
 * Get GeoJSON for one state (state = 2-letter code or state name as stored).
 */
app.get('/api/congressional-boundaries/:congress/:state', async (req, res) => {
  try {
    const { congress, state: stateParam } = req.params;
    const stateName = resolveStateToLewisName(stateParam);
    const result = await cloudStorageCache.getCongressionalBoundary(congress, stateName);
    if (!result) {
      return res.status(404).json({ error: 'Not found', message: `No boundaries for Congress ${congress}, state ${stateName}` });
    }
    return res.json(result.data);
  } catch (error) {
    console.error('GET /api/congressional-boundaries/:congress/:state error:', error);
    res.status(500).json({ error: 'Failed to get congressional boundaries', message: error.message });
  }
});

/**
 * Get or create state boundary polygon in Cloud Storage (for map-polygons endpoint).
 * Returns a single GeoJSON Feature for the state outline. Does not run algorithm or load tracts.
 */
async function getOrCreateStateBoundaryInCloudStorage(state) {
  const stateBoundaryKey = `state_boundary_polygon_${state.toUpperCase()}`;

  // 1. Try dedicated state boundary key in Cloud Storage
  try {
    const result = await cloudStorageCache.get(stateBoundaryKey);
    if (result && result.data) {
      const data = result.data;
      const feature = Array.isArray(data) ? data[0] : data;
      if (feature && (feature.type === 'Feature' || feature.geometry)) {
        console.log(`✅ MAP-POLYGONS: Loaded state boundary from Cloud Storage (${stateBoundaryKey})`);
        return feature;
      }
    }
  } catch (e) {
    console.warn(`⚠️ MAP-POLYGONS: Could not load state boundary from Cloud Storage: ${e.message}`);
  }

  // 2. Try step-0 union polygon key (same state outline)
  const totalDistricts = getDistrictsForState(state);
  if (totalDistricts) {
    const step0Key = `union_polygon_${state}_0_1-${totalDistricts}`;
    try {
      const result = await cloudStorageCache.get(step0Key);
      if (result && result.data) {
        const data = result.data;
        const feature = Array.isArray(data) ? data[0] : data;
        if (feature && (feature.type === 'Feature' || feature.geometry)) {
          console.log(`✅ MAP-POLYGONS: Loaded state boundary from step-0 cache (${step0Key})`);
          return feature;
        }
      }
    } catch (e) {
      console.warn(`⚠️ MAP-POLYGONS: Could not load step-0 polygon: ${e.message}`);
    }
  }

  // 3. Fetch from TIGER and save to Cloud Storage
  const stateFipsMap = {
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
    'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
    'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
    'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
    'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
    'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
    'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
    'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
    'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
    'DC': '11'
  };
  const stateFips = /^\d{2}$/.test(state) ? state : (stateFipsMap[state.toUpperCase()] || state);
  const serviceUrl = `${TIGERWEB_STATE_LAYER}/query`;
  const params = new URLSearchParams({
    where: `STATE='${stateFips}'`,
    outFields: 'STATE,GEOID,NAME,STUSAB',
    f: 'geojson',
    outSR: '4326'
  });

  logExternalFetch('TIGERweb', 'state boundary for cache', `state=${state}`);
  const response = await axios.get(`${serviceUrl}?${params.toString()}`);
  const rawFeatures = response.data.features || [];
  const normalizeStateFeature = (f) => {
    const p = f.properties || {};
    return { ...f, properties: { ...p, STATE_FIPS: p.STATE ?? p.GEOID, STATE_NAME: p.NAME, STATE_ABBR: p.STUSAB } };
  };
  const features = rawFeatures.map(normalizeStateFeature);
  if (features.length === 0) {
    throw new Error(`No state boundary features returned for state: ${state}`);
  }
  const mainFeature = features[0];

  const unionData = Array.isArray(mainFeature) ? mainFeature : [mainFeature];
  const cloudStoragePath = await cloudStorageCache.set(stateBoundaryKey, unionData, {
    state: state,
    source: 'tiger-state-boundary',
    polygonCount: '1'
  });
  const metadataEntry = {
    cloudStoragePath,
    timestamp: Date.now(),
    ttl: null,
    version: CACHE_VERSION,
    source: 'tiger-state-boundary',
    tigerBased: true,
    state: state,
    polygonCount: 1
  };
  await setCacheDoc(stateBoundaryKey, metadataEntry);
  console.log(`💾 MAP-POLYGONS: Saved state boundary to Cloud Storage (${stateBoundaryKey})`);
  return mainFeature;
}

/**
 * Get state boundary and optional final-step district polygons for one state.
 * Single read: map_polygons_${state} blob in Cloud Storage (full response). If missing, state boundary only.
 * No step-doc or N-polygon reads on the request path.
 */
async function getMapPolygonsForState(stateCode) {
  const blobKey = `map_polygons_${stateCode}`;
  const blobResult = await cloudStorageCache.get(blobKey).catch(() => null);
  const data = blobResult && blobResult.data;
  if (data && data.statePolygon && (data.statePolygon.type === 'Feature' || data.statePolygon.geometry)) {
    return {
      statePolygon: data.statePolygon,
      finalDistrictPolygons: Array.isArray(data.finalDistrictPolygons) ? data.finalDistrictPolygons : undefined,
      hasFinalStep: !!data.hasFinalStep && Array.isArray(data.finalDistrictPolygons) && data.finalDistrictPolygons.length > 0,
      finalStepNumber: typeof data.finalStepNumber === 'number' ? data.finalStepNumber : undefined
    };
  }
  const statePolygon = await getOrCreateStateBoundaryInCloudStorage(stateCode);
  return {
    statePolygon,
    finalDistrictPolygons: undefined,
    hasFinalStep: false,
    finalStepNumber: undefined
  };
}

/**
 * GET /api/algorithm/map-polygons/:state
 * Returns only polygon GeoJSON for fast map display: state outline and optional final district polygons.
 * One Cloud Storage read: map_polygons_${state} blob (written by build-all-union-polygons). If missing, state boundary only.
 */
app.get('/api/algorithm/map-polygons/:state', async (req, res) => {
  try {
    const { state } = req.params;
    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }
    const result = await getMapPolygonsForState(state);
    return res.json({
      statePolygon: result.statePolygon,
      finalDistrictPolygons: result.finalDistrictPolygons,
      hasFinalStep: result.hasFinalStep,
      finalStepNumber: result.finalStepNumber
    });
  } catch (error) {
    console.error('❌ GET /api/algorithm/map-polygons error:', error);
    res.status(500).json({
      error: 'Map polygons failed',
      message: error.message
    });
  }
});

/**
 * GET /api/algorithm/final-step-states
 * Returns list of state codes that have a completed final step (current algorithm version).
 */
app.get('/api/algorithm/final-step-states', async (req, res) => {
  try {
    const currentVersion = ALGORITHM_VERSION;
    const stateCodesSet = new Set();

    if (USE_LOCAL_CACHE) {
      const algoIds = await listCacheDocIds('algorithm_step_');
      const stepIds = await listCacheDocIds('step_');
      for (const id of [...algoIds, ...stepIds]) {
        const entry = await getCacheDoc(id);
        if (entry && entry.isComplete === true &&
            (entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
            entry.algorithmVersion === currentVersion && entry.state) {
          stateCodesSet.add(entry.state);
        }
      }
    } else {
      const completeQuery = getFirestore().collection('census_cache')
        .where('isComplete', '==', true);
      const completeSnapshot = await completeQuery.get();
      for (const doc of completeSnapshot.docs) {
        const entry = doc.data();
        if ((entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
            entry.algorithmVersion === currentVersion && entry.state) {
          stateCodesSet.add(entry.state);
        }
      }
    }

    const stateCodes = Array.from(stateCodesSet).sort();
    console.log(`✅ GET /api/algorithm/final-step-states: ${stateCodes.length} states with final step`);
    return res.json({ stateCodes });
  } catch (error) {
    console.error('❌ Final-step-states lookup error:', error);
    res.status(500).json({
      error: 'Final-step-states lookup failed',
      message: error.message
    });
  }
});

/**
 * GET /api/algorithm/step-list/:state
 * Returns step indices and final step number for a state (for visualization step scrubber without fetching each step).
 */
app.get('/api/algorithm/step-list/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    if (!state || state.length < 2) {
      return res.status(400).json({ error: 'Invalid state code' });
    }
    const stateKey = getAlgorithmStateKey(state, maxIterations);
    const algorithmState = await getCachedAlgorithmState(stateKey);
    if (!algorithmState || algorithmState.iteration == null) {
      return res.status(404).json({ error: `No step list for ${state}`, stepIndices: [], finalStepNumber: -1 });
    }
    const finalStepNumber = algorithmState.iteration;
    const stepIndices = Array.from({ length: finalStepNumber + 1 }, (_, i) => i);
    return res.json({ stepIndices, finalStepNumber });
  } catch (error) {
    console.error('❌ Step-list error:', error);
    res.status(500).json({
      error: 'Step list failed',
      message: error.message
    });
  }
});

/**
 * GET /api/algorithm/final-step/:state
 * Get the final (completed) step for a state if available
 */
app.get('/api/algorithm/final-step/:state', async (req, res) => {
  console.log(`🔍 GET /api/algorithm/final-step/:state called with state: ${req.params.state}`);
  // Declare getTractId once at function scope to avoid duplicate declaration errors
  const { getTractId } = require('./services/geodistrict-algorithm');
  try {
    const { state } = req.params;
    const maxIterations = 100; // Default max iterations
    const currentVersion = ALGORITHM_VERSION;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    // Query for all completed steps for this state
    // Try both cache key formats: algorithm_step_{state}_{maxIterations}_{step} and step_{state}_{step}_{version}
    try {
      let finalStepDoc = null;
      let cachedEntry = null;
      let highestStep = -1;
      // Track latest step (any step with data) so we can return it when it's more advanced than highest with union polygons
      let latestStepDoc = null;
      let latestEntry = null;
      let highestStepAny = -1;

      if (USE_LOCAL_CACHE) {
        const algoIds = await listCacheDocIds(`algorithm_step_${state}_`);
        const stepIds = await listCacheDocIds(`step_${state}_`);
        for (const id of [...algoIds, ...stepIds]) {
          const entry = await getCacheDoc(id);
          if (!entry || (entry.source !== 'algorithm-step-cache' && entry.source !== 'step-cache') ||
              entry.algorithmVersion !== currentVersion || entry.step === undefined) continue;
          const stepNum = entry.step;
          const hasStepData = entry.stepData !== undefined || (entry.districtGroups !== undefined && entry.districtGroups?.length > 0);
          if (hasStepData && stepNum > highestStepAny) {
            latestStepDoc = { id };
            latestEntry = entry;
            highestStepAny = stepNum;
          }
          if (entry.unionPolygonsCached === true && stepNum > highestStep) {
            finalStepDoc = { id };
            cachedEntry = entry;
            highestStep = stepNum;
          }
        }
        if (latestEntry && highestStepAny > highestStep) {
          finalStepDoc = latestStepDoc;
          cachedEntry = latestEntry;
          highestStep = highestStepAny;
        } else if (!finalStepDoc && latestEntry) {
          finalStepDoc = latestStepDoc;
          cachedEntry = latestEntry;
          highestStep = highestStepAny;
        }
      } else {
        const stepCacheQuery = getFirestore().collection('census_cache')
          .where('state', '==', state)
          .where('isComplete', '==', true);
        const stepCacheSnapshot = await stepCacheQuery.get();
        if (!stepCacheSnapshot.empty) {
          for (const doc of stepCacheSnapshot.docs) {
            const entry = doc.data();
            if ((entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
                entry.algorithmVersion === currentVersion && entry.step !== undefined) {
              const stepNum = entry.step;
              const hasStepData = entry.stepData !== undefined || (entry.districtGroups !== undefined && entry.districtGroups?.length > 0);
              if (hasStepData && stepNum > highestStepAny) {
                latestStepDoc = doc;
                latestEntry = entry;
                highestStepAny = stepNum;
              }
              if (entry.unionPolygonsCached === true && stepNum > highestStep) {
                finalStepDoc = doc;
                cachedEntry = entry;
                highestStep = stepNum;
              }
            }
          }
        }
        if (!finalStepDoc || !cachedEntry) {
          const algorithmStepsQuery = getFirestore().collection('census_cache')
            .where('state', '==', state)
            .where('source', '==', 'algorithm-step-cache');
          const algorithmStepsSnapshot = await algorithmStepsQuery.get();
          if (!algorithmStepsSnapshot.empty) {
            for (const doc of algorithmStepsSnapshot.docs) {
              const entry = doc.data();
              if (entry.algorithmVersion === currentVersion && entry.step !== undefined) {
                const stepNum = entry.step;
                const hasStepData = entry.stepData !== undefined || (entry.districtGroups !== undefined && entry.districtGroups?.length > 0);
                if (hasStepData && stepNum > highestStepAny) {
                  latestStepDoc = doc;
                  latestEntry = entry;
                  highestStepAny = stepNum;
                }
                if (entry.unionPolygonsCached === true && stepNum > highestStep) {
                  finalStepDoc = doc;
                  cachedEntry = entry;
                  highestStep = stepNum;
                }
              }
            }
          }
          if (!finalStepDoc || !cachedEntry) {
            const stepCacheQuery2 = getFirestore().collection('census_cache')
              .where('state', '==', state)
              .where('source', '==', 'step-cache');
            const stepCacheSnapshot2 = await stepCacheQuery2.get();
            if (!stepCacheSnapshot2.empty) {
              for (const doc of stepCacheSnapshot2.docs) {
                const entry = doc.data();
                if (entry.algorithmVersion === currentVersion && entry.step !== undefined) {
                  const stepNum = entry.step;
                  const hasStepData = entry.stepData !== undefined || (entry.districtGroups !== undefined && entry.districtGroups?.length > 0);
                  if (hasStepData && stepNum > highestStepAny) {
                    latestStepDoc = doc;
                    latestEntry = entry;
                    highestStepAny = stepNum;
                  }
                  if (entry.unionPolygonsCached === true && stepNum > highestStep) {
                    finalStepDoc = doc;
                    cachedEntry = entry;
                    highestStep = stepNum;
                  }
                }
              }
            }
          }
        }
        if (latestEntry && highestStepAny > highestStep) {
          finalStepDoc = latestStepDoc;
          cachedEntry = latestEntry;
          highestStep = highestStepAny;
        } else if (!finalStepDoc && latestEntry) {
          finalStepDoc = latestStepDoc;
          cachedEntry = latestEntry;
          highestStep = highestStepAny;
        }
      }

      if (!finalStepDoc || !cachedEntry) {
        return res.status(404).json({ error: 'No final or latest step found for this state with current algorithm version' });
      }
      
      const finalStepNumber = cachedEntry.step;

      // Validate that the cached entry's state matches the requested state
      if (cachedEntry.state && cachedEntry.state !== state) {
        console.error(`❌ STATE MISMATCH: Cached final step has state '${cachedEntry.state}' but requested state is '${state}'. This is a cache corruption issue.`);
        return res.status(404).json({ error: `Final step cache corruption detected: cached state '${cachedEntry.state}' does not match requested state '${state}'. Please re-run the algorithm.` });
      }

      console.log(`✅ Found final step ${finalStepNumber} for ${state}`);

      // Reconstruct the final step
      // Handle both cache formats:
      // 1. 'algorithm-step-cache' format: has stepData field and tractCacheKey
      // 2. 'step-cache' format: step data is stored directly in the entry, may need reconstruction
      const hasStepDataField = cachedEntry.stepData !== undefined;
      const hasDirectData = cachedEntry.districtGroups !== undefined;
      // Validate tractCacheKey matches the requested state (prevent cross-state contamination)
      let tractCacheKey = cachedEntry.tractCacheKey || `state_tracts_${state}`;
      // Ensure tractCacheKey is for the correct state
      if (!tractCacheKey.includes(`_${state}`) && !tractCacheKey.includes(`/${state}`)) {
        console.warn(`⚠️ TRACT CACHE KEY MISMATCH: tractCacheKey '${tractCacheKey}' does not contain state '${state}', using default`);
        tractCacheKey = `state_tracts_${state}`;
      }
      const needsReconstruction = cachedEntry.normalized || (hasDirectData && cachedEntry.source === 'step-cache');
      
      if (needsReconstruction && (hasStepDataField || hasDirectData)) {
          try {
            const stateTractDoc = await getCacheDoc(tractCacheKey);
            if (stateTractDoc) {
              const stateTractData = stateTractDoc;
              if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
                let tractMap = null;
                if (stateTractData.cloudStorage && stateTractData.cloudStoragePath && tractCacheKey) {
                  const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
                  if (cloudStorageResult && cloudStorageResult.data) {
                    tractMap = cloudStorageResult.data;
                    
                    // Validate that tracts in cache have geometry
                    if (Array.isArray(tractMap) && tractMap.length > 0) {
                      const sampleTract = Array.isArray(tractMap[0]) && tractMap[0].length === 2 ? tractMap[0][1] : tractMap[0];
                      if (!sampleTract || !sampleTract.geometry || (sampleTract.type === 'Feature' && !sampleTract.geometry)) {
                        console.error(`❌ TRACT CACHE CORRUPTED: Tract cache for ${state} contains tracts without geometry. Sample tract:`, sampleTract);
                        console.error(`   The cache file at ${stateTractData.cloudStoragePath} is corrupted and needs to be regenerated.`);
                        return res.status(500).json({ 
                          error: `Tract cache for ${state} is corrupted: tracts are missing geometry data. Please re-run the algorithm to regenerate the cache.`,
                          details: 'The cached tract file contains incomplete data. This usually happens when the cache was created incorrectly.'
                        });
                      }
                      
                      // Check a few more samples to be sure
                      const samplesToCheck = Math.min(10, tractMap.length);
                      let missingGeometryCount = 0;
                      for (let i = 0; i < samplesToCheck; i++) {
                        const sample = Array.isArray(tractMap[i]) && tractMap[i].length === 2 ? tractMap[i][1] : tractMap[i];
                        if (!sample || !sample.geometry || (sample.type === 'Feature' && !sample.geometry)) {
                          missingGeometryCount++;
                        }
                      }
                      
                      if (missingGeometryCount > samplesToCheck * 0.5) {
                        console.error(`❌ TRACT CACHE CORRUPTED: ${missingGeometryCount} out of ${samplesToCheck} sample tracts are missing geometry. Cache is corrupted.`);
                        return res.status(500).json({ 
                          error: `Tract cache for ${state} is corrupted: most tracts are missing geometry data. Please re-run the algorithm to regenerate the cache.`,
                          details: `Sampled ${samplesToCheck} tracts and found ${missingGeometryCount} without geometry.`
                        });
                      }
                    }
                  }
                } else if (stateTractData.chunked && stateTractData.chunkKeys) {
                  const chunkDocs = await Promise.all(
                    stateTractData.chunkKeys.map(key => getCacheDoc(key))
                  );
                  const allTracts = [];
                  for (const chunkDoc of chunkDocs) {
                    if (chunkDoc && chunkDoc.data) {
                      allTracts.push(...chunkDoc.data);
                    }
                  }
                  tractMap = allTracts;
                } else if (stateTractData.tractMap) {
                  tractMap = stateTractData.tractMap;
                } else if (stateTractData.data) {
                  tractMap = stateTractData.data;
                }

                if (tractMap) {
                  // Use stepData field if available, otherwise use cachedEntry directly
                  const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
                  deserializeStepDataFromFirestore(dataToReconstruct);
                  let stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, true, state);
                  
                  // For Step 0, ensure TIGER state boundaries are used
                  if (finalStepNumber === 0 || finalStepNumber === '0') {
                    stepData = await ensureStep0UsesTigerBoundaries(stepData, state, finalStepNumber, req);
                  }
                  
                  if (stepData && stepData.districtGroups && Array.isArray(stepData.districtGroups) && stepData.districtGroups.length > 0) {
                    // If step wasn't marked as complete, update it now for future queries
                    if (!cachedEntry.isComplete) {
                      try {
                        const keyToUpdate = finalStepDoc.id || `algorithm_step_${state}_100_${finalStepNumber}`;
                        await setCacheDoc(keyToUpdate, { ...cachedEntry, isComplete: true });
                        console.log(`✅ Marked step ${finalStepNumber} as complete for future queries`);
                      } catch (updateError) {
                        console.warn(`⚠️ Failed to mark step ${finalStepNumber} as complete: ${updateError.message}`);
                      }
                    }
                    
                    // Cache algorithm state so next-step endpoint can find it
                    // Extract uniqueTracts from tractMap
                    // getTractId already declared at function scope
                    const uniqueTracts = [];
                    if (Array.isArray(tractMap)) {
                      if (tractMap.length > 0 && Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
                        uniqueTracts.push(...tractMap.map(([id, tract]) => tract));
                      } else {
                        uniqueTracts.push(...tractMap);
                      }
                    } else if (tractMap instanceof Map) {
                      uniqueTracts.push(...Array.from(tractMap.values()));
                    }
                    
                    const totalStatePopulation = uniqueTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
                    const totalDistricts = getDistrictsForState(state);
                    const targetDistrictPopulation = totalStatePopulation / totalDistricts;
                    
                    // Build steps array
                    const steps = [];
                    for (let i = 0; i <= finalStepNumber; i++) {
                      steps.push(null);
                    }
                    steps[finalStepNumber] = stepData;
                    
                    // Store minimal algorithm state (without full tract geometries - those are in tract cache)
                    // Only store tract IDs to keep state small and fast to cache/retrieve
                    // getTractId already declared above
                    const uniqueTractIds = uniqueTracts.map(tract => getTractId(tract)).filter(Boolean);
                    
                    const algorithmState = {
                      uniqueTractIds, // Store IDs only, not full geometries
                      tractCacheKey: cachedEntry.tractCacheKey || `state_tracts_${state}`, // Reference to tract cache
                      currentGroups: stepData.districtGroups,
                      iteration: finalStepNumber,
                      steps: steps,
                      algorithmHistory: [],
                      totalStatePopulation,
                      targetDistrictPopulation,
                      maxIterations,
                      state: state
                    };
                    
                    // Cache algorithm state - wait for Firestore metadata write
                    const stateKey = getAlgorithmStateKey(state, maxIterations);
                    try {
                      await cacheAlgorithmState(stateKey, algorithmState);
                      console.log(`✅ Cached algorithm state for ${stateKey} (available for next-step requests)`);
                    } catch (cacheError) {
                      console.warn(`⚠️ Failed to cache algorithm state from final-step: ${cacheError.message}`);
                    }

                    // Per-DG status: use actual geometry so missing cache shows Build Polygons
                    const loadedRecon = await loadDistrictPartyForStep(state, finalStepNumber, maxIterations);
                    const districtPartyDataRecon = loadedRecon && loadedRecon.districts ? loadedRecon.districts : null;
                    const hasUnionGeometryRecon = (g) => !!(g.unionPolygon?.geometry || (Array.isArray(g.unionPolygons) && g.unionPolygons.length > 0));
                    const perGroupStatusRecon = (stepData.districtGroups || []).map(g => {
                      const groupKey = `${g.startDistrictNumber}-${g.endDistrictNumber}`;
                      return {
                        groupKey,
                        polygon: hasUnionGeometryRecon(g) ? 'done' : 'missing',
                        party: (districtPartyDataRecon && districtPartyDataRecon[groupKey]) ? 'done' : 'missing'
                      };
                    });
                    const allPolygonsLoadedRecon = perGroupStatusRecon.every(s => s.polygon === 'done');

                    return res.json({
                      step: finalStepNumber,
                      data: stepData,
                      isComplete: true,
                      unionPolygonsCached: allPolygonsLoadedRecon && cachedEntry.unionPolygonsCached === true,
                      districtPartyPercentagesCalculated: !!(districtPartyDataRecon && Object.keys(districtPartyDataRecon).length > 0),
                      perGroupStatus: perGroupStatusRecon,
                      maxIterations
                    });
                  } else {
                    console.error(`❌ Reconstruction failed for final step ${finalStepNumber}: returned null or incomplete data`);
                    console.error(`   This indicates the tract cache is corrupted or incomplete. The cached step cannot be used.`);
                    // Don't fall through - return error instead of corrupted data
                    return res.status(500).json({ 
                      error: `Final step ${finalStepNumber} cache is corrupted: tract geometries are missing. Please re-run the algorithm to regenerate the cache.`,
                      details: 'Reconstruction failed because tracts in the cache are missing geometry data.'
                    });
                  }
                } else {
                  console.error(`❌ No tract map available for reconstruction of final step ${finalStepNumber}`);
                  return res.status(500).json({ 
                    error: `Final step ${finalStepNumber} cannot be reconstructed: tract cache not found. Please re-run the algorithm.`
                  });
                }
              } else {
                console.error(`❌ Tract cache expired or invalid for final step ${finalStepNumber}`);
                return res.status(500).json({ 
                  error: `Final step ${finalStepNumber} cache is expired or invalid. Please re-run the algorithm.`
                });
              }
            } else {
              console.error(`❌ Tract cache document not found for final step ${finalStepNumber}`);
              return res.status(500).json({ 
                error: `Final step ${finalStepNumber} cannot be reconstructed: tract cache document not found. Please re-run the algorithm.`
              });
            }
          } catch (reconstructError) {
            console.error(`❌ Failed to reconstruct final step from cache: ${reconstructError.message}`);
            return res.status(500).json({ 
              error: `Failed to reconstruct final step ${finalStepNumber}: ${reconstructError.message}. Please re-run the algorithm.`
            });
          }
        }

      // If we reach here, reconstruction was not needed (step data already has full geometries)
      // Check if cached entry has valid step data with actual tract geometries
      // Handle both cache formats: stepData field (algorithm-step-cache) or direct data (step-cache)
      let stepData = hasStepDataField ? cachedEntry.stepData : cachedEntry;
      deserializeStepDataFromFirestore(stepData);
      
      // Validate that step data has actual tract geometries, not just IDs
      const hasValidData = stepData && stepData.districtGroups && Array.isArray(stepData.districtGroups) && stepData.districtGroups.length > 0;
      const hasTractGeometries = hasValidData && stepData.districtGroups.some(group => 
        group.censusTracts && Array.isArray(group.censusTracts) && group.censusTracts.length > 0 &&
        group.censusTracts.some(tract => tract.geometry || (tract.type === 'Feature' && tract.geometry))
      );
      
      // If step data only has tract IDs (normalized), it needs reconstruction
      const hasOnlyTractIds = hasValidData && stepData.districtGroups.some(group => 
        group.censusTractIds && Array.isArray(group.censusTractIds) && group.censusTractIds.length > 0 &&
        (!group.censusTracts || group.censusTracts.length === 0)
      );
      
      if (hasOnlyTractIds && !hasTractGeometries) {
        console.error(`❌ Final step ${finalStepNumber} cache contains only tract IDs (normalized) but reconstruction was skipped or failed`);
        return res.status(500).json({ 
          error: `Final step ${finalStepNumber} cache is normalized (tract IDs only) but cannot be reconstructed. Please re-run the algorithm.`
        });
      }
      
      if (hasValidData && hasTractGeometries) {
        // For Step 0, ALWAYS ensure TIGER state boundaries are used (never tract-based union polygons)
        // For other steps, load union polygons from cache normally
        if (finalStepNumber === 0 || finalStepNumber === '0') {
          stepData = await ensureStep0UsesTigerBoundaries(stepData, state, finalStepNumber, req);
        } else {
          try {
            const groupsWithUnions = await loadUnionPolygonsFromCache(state, finalStepNumber, stepData.districtGroups);
            stepData.districtGroups = groupsWithUnions;
          } catch (unionLoadError) {
            console.warn(`⚠️ Failed to load union polygons from cache: ${unionLoadError.message}`);
          }
        }
        
        // If step wasn't marked as complete, update it now for future queries
        if (!cachedEntry.isComplete) {
          try {
            await finalStepDoc.ref.update({ isComplete: true });
            console.log(`✅ Marked step ${finalStepNumber} as complete for future queries`);
          } catch (updateError) {
            console.warn(`⚠️ Failed to mark step ${finalStepNumber} as complete: ${updateError.message}`);
          }
        }
        // Cache algorithm state so next-step endpoint can find it
        // Extract uniqueTracts from stepData
        const uniqueTracts = [];
        if (stepData.districtGroups && Array.isArray(stepData.districtGroups)) {
          for (const group of stepData.districtGroups) {
            if (group.censusTracts && Array.isArray(group.censusTracts)) {
              uniqueTracts.push(...group.censusTracts);
            }
          }
        }
        
        // Remove duplicates by tract ID
        // getTractId already declared at function scope
        const tractIdMap = new Map();
        for (const tract of uniqueTracts) {
          const tractId = getTractId(tract);
          if (tractId && !tractIdMap.has(tractId)) {
            tractIdMap.set(tractId, tract);
          }
        }
        const deduplicatedTracts = Array.from(tractIdMap.values());
        
        const totalStatePopulation = deduplicatedTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
        const totalDistricts = getDistrictsForState(state);
        const targetDistrictPopulation = totalStatePopulation / totalDistricts;
        
        // Build steps array
        const steps = [];
        for (let i = 0; i <= finalStepNumber; i++) {
          steps.push(null);
        }
        steps[finalStepNumber] = stepData;
        
        // Store minimal algorithm state (without full tract geometries - those are in tract cache)
        // Only store tract IDs to keep state small and fast to cache/retrieve
        // getTractId already declared at function scope
        const uniqueTractIds = deduplicatedTracts.map(tract => getTractId(tract)).filter(Boolean);
        
        const algorithmState = {
          uniqueTractIds, // Store IDs only, not full geometries
          tractCacheKey: cachedEntry.tractCacheKey || `state_tracts_${state}`, // Reference to tract cache
          currentGroups: stepData.districtGroups,
          iteration: finalStepNumber,
          steps: steps,
          algorithmHistory: [],
          totalStatePopulation,
          targetDistrictPopulation,
          maxIterations,
          state: state
        };
        
        // Cache algorithm state - wait for Firestore metadata write
        const stateKey = getAlgorithmStateKey(state, maxIterations);
        try {
          await cacheAlgorithmState(stateKey, algorithmState);
          console.log(`✅ Cached algorithm state for ${stateKey} (available for next-step requests)`);
        } catch (cacheError) {
          console.warn(`⚠️ Failed to cache algorithm state from final-step: ${cacheError.message}`);
        }

        // Per-DG status for union polygon and party % (for dev/maps table). Use actual geometry presence so that when GCS/local cache is cleared we show "missing" and Build Polygons button.
        const loaded = await loadDistrictPartyForStep(state, finalStepNumber, maxIterations);
        const districtPartyData = loaded && loaded.districts ? loaded.districts : null;
        const hasUnionGeometry = (g) => !!(g.unionPolygon?.geometry || (Array.isArray(g.unionPolygons) && g.unionPolygons.length > 0));
        const perGroupStatus = (stepData.districtGroups || []).map(g => {
          const groupKey = `${g.startDistrictNumber}-${g.endDistrictNumber}`;
          return {
            groupKey,
            polygon: hasUnionGeometry(g) ? 'done' : 'missing',
            party: (districtPartyData && districtPartyData[groupKey]) ? 'done' : 'missing'
          };
        });
        const allPolygonsLoaded = perGroupStatus.every(s => s.polygon === 'done');

        // Return step data (from stepData field or directly from entry) with status for dev/maps
        return res.json({
          step: finalStepNumber,
          data: stepData,
          isComplete: true,
          unionPolygonsCached: allPolygonsLoaded && cachedEntry.unionPolygonsCached === true,
          districtPartyPercentagesCalculated: !!(districtPartyData && Object.keys(districtPartyData).length > 0),
          perGroupStatus,
          maxIterations
        });
      } else {
        // Cached entry is incomplete - cannot return valid step data
        console.warn(`⚠️ Final step ${finalStepNumber} cache is incomplete (missing districtGroups or empty), cannot return step data`);
        return res.status(404).json({ error: `Final step ${finalStepNumber} found but data is incomplete. Please re-run the algorithm.` });
      }
    } catch (queryError) {
      console.warn(`⚠️ Failed to query for final step: ${queryError.message}`);
    }

    // No final step found
    return res.status(404).json({ error: 'No final step found for this state' });
  } catch (error) {
    console.error('❌ Final step lookup error:', error);
    res.status(500).json({
      error: 'Final step lookup failed',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/clear-cache
 * Delete all algorithm cache for a state (trash). Removes step 0..N, algorithm state, union polygons.
 * Does NOT delete state_tracts_{state} (census/original-source tract data). After clear, step-by-step
 * will use state tract cache (local or Cloud Storage fallback) when available, avoiding TIGER refetch.
 */
app.post('/api/algorithm/clear-cache', async (req, res) => {
  try {
    const { state, maxIterations = 100 } = req.body || {};
    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }
    const result = await deleteAlgorithmCacheForState(state, maxIterations);
    res.json({
      ok: true,
      message: `Algorithm cache cleared for ${state}`,
      ...result
    });
  } catch (err) {
    console.error('Clear algorithm cache error:', err);
    res.status(500).json({
      error: 'Failed to clear algorithm cache',
      message: err.message
    });
  }
});

/**
 * POST /api/census/clear-state-cache
 * Invalidate local and optionally cloud cache for a state's tract and polygon data.
 * After this, the next load (e.g. dev/maps for that state) will refetch from Census API and TIGER.
 * Body: { state: "NY", cloud: true }
 * - state: required, 2-letter code
 * - cloud: if true, also delete state-tracts/{state}.json and boundaries/{state}.json from Cloud Storage
 */
app.post('/api/census/clear-state-cache', async (req, res) => {
  try {
    const { state, cloud = true } = req.body || {};
    const stateNorm = (state || '').toUpperCase().trim();
    if (!stateNorm || stateNorm.length !== 2) {
      return res.status(400).json({ error: 'State is required (2-letter code)' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await deleteTractAndPolygonCacheForState(stateNorm, { deleteCloud: !!cloud, baseUrl });
    res.json({
      ok: true,
      message: `Tract and polygon cache cleared for ${stateNorm}`,
      ...result
    });
  } catch (err) {
    console.error('Clear state tract cache error:', err);
    res.status(500).json({
      error: 'Failed to clear state tract cache',
      message: err.message
    });
  }
});

/**
 * POST /api/algorithm/restart
 * Delete algorithm cache from step 1 onward and algorithm state; keep step 0.
 * Then loads step 0 from cache and sets algorithm state to iteration 0 so next "Next" runs step 1.
 */
app.post('/api/algorithm/restart', async (req, res) => {
  try {
    const { state, maxIterations = 100 } = req.body || {};
    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }
    await deleteAlgorithmCacheFromStep1ForState(state, maxIterations);

    const stateKey = getAlgorithmStateKey(state, maxIterations);
    const step0CacheKey = `algorithm_step_${state}_${maxIterations}_0`;
    const tractCacheKey = `state_tracts_${state}`;
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.json({ ok: true, message: `Restarted (step 1+ deleted) for ${state}; step 0 not found, call step-by-step to re-init` });
    }

    const step0Doc = await getCacheDoc(step0CacheKey);
    if (!step0Doc) {
      return res.json({ ok: true, message: `Restarted for ${state}; no cached step 0, call step-by-step to load step 0` });
    }

    const cachedEntry = step0Doc;
    if (isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl) || cachedEntry.algorithmVersion !== ALGORITHM_VERSION) {
      return res.json({ ok: true, message: `Restarted for ${state}; step 0 cache expired/version mismatch, call step-by-step` });
    }

    let stepData = cachedEntry.stepData;
    if (!stepData || !stepData.districtGroups || stepData.districtGroups.length === 0) {
      return res.json({ ok: true, message: `Restarted for ${state}; step 0 data invalid, call step-by-step` });
    }
    deserializeStepDataFromFirestore(stepData);

    const group0 = stepData.districtGroups[0];
    const censusTractIds = group0.censusTractIds || (group0.censusTracts && group0.censusTracts.map(t => {
      const { getTractId } = require('./services/geodistrict-algorithm');
      return getTractId(t);
    }).filter(Boolean));
    if (!censusTractIds || censusTractIds.length === 0) {
      return res.json({ ok: true, message: `Restarted for ${state}; step 0 has no tract IDs, call step-by-step` });
    }

    const algorithmStateForCache = {
      uniqueTractIds: censusTractIds,
      tractCacheKey,
      state,
      iteration: 0,
      steps: [stepData],
      currentGroups: stepData.districtGroups,
      totalStatePopulation: group0.totalPopulation,
      targetDistrictPopulation: group0.totalPopulation / totalDistricts,
      maxIterations,
      algorithmHistory: []
    };

    try {
      await cacheAlgorithmState(stateKey, algorithmStateForCache);
      console.log(`✅ RESTART: Set algorithm state to iteration 0 for ${state}`);
    } catch (cacheErr) {
      console.warn(`⚠️ RESTART: Failed to cache algorithm state: ${cacheErr.message}`);
    }

    res.json({
      ok: true,
      message: `Restarted for ${state}; algorithm state set to step 0. Call step-by-step to load step 0 or GET step/0.`
    });
  } catch (err) {
    console.error('Restart error:', err);
    res.status(500).json({
      error: 'Failed to restart',
      message: err.message
    });
  }
});

/**
 * POST /api/algorithm/execute/step-by-step
 * Initialize algorithm and return step 0 only
 */
app.post('/api/algorithm/execute/step-by-step', async (req, res) => {
  if (isAlgorithmPostDisabled()) {
    return res.status(503).json({ error: 'Algorithm execution is disabled (read-only mode). Use local backend for development.' });
  }
  try {
    const { state, maxIterations = 100, options = {} } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    // Get number of districts for state
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.status(400).json({ error: `Invalid state: ${state}` });
    }

    logger.info(`🚀 Initializing algorithm for ${state} (${totalDistricts} districts)`);

    // Extract forceInvalidate option
    const forceInvalidate = options.forceInvalidate || false;
    
    // If forceInvalidate is true, invalidate all step caches for this state
    if (forceInvalidate) {
      console.log(`🔄 FORCE INVALIDATE: Invalidating all step caches for ${state}`);
      await invalidateAllStepCaches(state, maxIterations);
    }

    let tracts = [];
    let canonicalResult = null;

    // Prefer state tract cache when valid to skip external fetch (keep EXTERNAL FETCH rare)
    if (!forceInvalidate) {
      const fromCache = await loadTractsFromStateTractCache(state);
      if (fromCache && fromCache.tracts.length > 0) {
        tracts = fromCache.tracts;
      }
    }

    // Get tract data from census proxy when not loaded from state tract cache
    if (tracts.length === 0) {
      let boundaries;
      // Always use internal batch fetch so we get all tracts (getTractCount can be capped by TIGER).
      console.log(`📡 Step-by-step: fetching boundaries via internal batch fetch for state: ${state}`);
      boundaries = await fetchTractBoundariesForState(state);
      if (!boundaries?.features?.length) {
        return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
      }
      const countiesUrl = `${req.protocol}://${req.get('host')}/api/census/counties?state=${state}`;
      const countiesResponse = await axios.get(countiesUrl);
      const counties = countiesResponse.data || [];
      const countyFipsCodes = counties.map(c => c.COUNTY || c.county || c.fips);
      const bulkResponse = await axios.post(`${req.protocol}://${req.get('host')}/api/census/tract-data/bulk`, {
        state,
        counties: countyFipsCodes,
        forceInvalidate
      });
      const demographicData = bulkResponse.data.data || [];
      const s4DataLoader = require('./services/s4-data-loader');
      try { await s4DataLoader.loadS4AdjacencyData(state); } catch (e) { console.warn(`⚠️ S4 load: ${e.message}`); }
      const { createCanonicalTractMap } = require('./services/canonical-tract-loader');
      canonicalResult = createCanonicalTractMap(demographicData, boundaries, state);
      tracts = canonicalResult.geoJsonFeatures;
      if (canonicalResult.stats?.tractsWithGeometry !== undefined) {
        console.log(`📊 Canonical tract model: ${canonicalResult.stats.totalCanonicalTracts} tracts, ${canonicalResult.stats.tractsWithGeometry} with geometry`);
      }
    }

    if (tracts.length === 0) {
      return res.status(404).json({ error: `No tracts found for state: ${state}` });
    }

    try {
      // Detect and store enclosed tract relationships
      const { detectEnclosedTracts, getTractId } = require('./services/geodistrict-algorithm');
      const enclosedMap = detectEnclosedTracts(tracts);
      
      // Store enclosed/enclosing relationships in tract properties
      // Also assign TRACT_GROUP_ID so enclosed and enclosing tracts always move together
      // Use getTractId to ensure consistent ID format
      const tractIdMap = new Map(); // Map<tractId, tract> for lookup
      for (const tract of tracts) {
        const tractId = getTractId(tract);
        if (tractId) {
          tractIdMap.set(tractId, tract);
        }
      }
      
      // Assign TRACT_GROUP_ID to link enclosed and enclosing tracts together
      let nextGroupId = 1;
      const groupIdMap = new Map(); // Map<tractId, groupId>
      
      for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
        // Check if either tract already has a group ID
        let groupId = groupIdMap.get(enclosedId) || groupIdMap.get(enclosingId);
        if (!groupId) {
          groupId = `group_${nextGroupId++}`;
        }
        // Assign same group ID to both
        groupIdMap.set(enclosedId, groupId);
        groupIdMap.set(enclosingId, groupId);
      }
      
      // Store metadata in tract properties
      for (const tract of tracts) {
        const tractId = getTractId(tract);
        if (!tractId) continue;
        
        if (enclosedMap.has(tractId)) {
          tract.properties.ENCLOSED_BY = enclosedMap.get(tractId);
        }
        // Also store reverse relationship (which tracts this tract encloses)
        const enclosedByThis = [];
        for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
          if (enclosingId === tractId) {
            enclosedByThis.push(enclosedId);
          }
        }
        if (enclosedByThis.length > 0) {
          tract.properties.ENCLOSES = enclosedByThis;
        }
        // Store TRACT_GROUP_ID so they always move together
        if (groupIdMap.has(tractId)) {
          tract.properties.TRACT_GROUP_ID = groupIdMap.get(tractId);
          if (tractId.includes('001700') || tractId.includes('002302')) {
            console.log(`🔗 Assigned TRACT_GROUP_ID ${groupIdMap.get(tractId)} to tract ${tractId}`);
          }
        }
      }
      
      console.log(`✅ Assigned ${nextGroupId - 1} tract group IDs for ${enclosedMap.size} enclosed tracts`);

      console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

      // Check cache for step 0
      const step0CacheKey = `algorithm_step_${state}_${maxIterations}_0`;
      
      if (!forceInvalidate) {
        try {
          const doc = await getCacheDoc(step0CacheKey);
          
          if (doc) {
            const cachedEntry = doc;
            
            if (!isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
              const cachedVersion = cachedEntry.algorithmVersion;
              const currentVersion = ALGORITHM_VERSION;
              
              if (cachedVersion === currentVersion) {
                console.log(`✅ STEP 0 CACHE HIT: Retrieved cached step 0 for ${state}`);
                
                // Reconstruct step data with tract geometries
                let stepData = cachedEntry.stepData;
                deserializeStepDataFromFirestore(stepData);
                // Preserve island (and other) metadata from cache in case reconstruction fails and we rebuild step from fresh tracts
                const preservedStep0Metadata = stepData?.islandTractsData ? { islandTractsData: stepData.islandTractsData } : null;
                
                // For Step 0, ALWAYS use TIGER state boundaries (never use cached tract-based union polygons)
                // Step 0 should NEVER use union polygons created from tracts - only TIGER boundaries
                if (stepData.districtGroups && stepData.districtGroups.length > 0) {
                  const group = stepData.districtGroups[0];
                  let unionCacheKey = group.unionPolygonCacheKey;
                  
                  // Check if there's an old union polygon cache key (from tract-based union polygons)
                  if (unionCacheKey) {
                    // Check if this is a TIGER-based union polygon by checking metadata
                    try {
                      const unionCacheDoc = await getCacheDoc(unionCacheKey);
                      if (unionCacheDoc) {
                        const unionMetadata = unionCacheDoc;
                        // Check if this union polygon is marked as TIGER-based
                        const isTigerBased = unionMetadata.source === 'tiger-state-boundary' || unionMetadata.tigerBased === true;
                        
                        if (!isTigerBased) {
                          // This is an old tract-based union polygon - invalidate it
                          console.log(`🔄 STEP 0: Detected old tract-based union polygon cache, invalidating and replacing with TIGER boundaries`);
                          try {
                            // Delete old union polygon from Cloud Storage
                            await cloudStorageCache.delete(unionCacheKey);
                            // Delete metadata from Firestore
                            await deleteCacheDoc(unionCacheKey);
                            console.log(`🗑️ STEP 0: Deleted old tract-based union polygon cache`);
                          } catch (deleteError) {
                            console.warn(`⚠️ STEP 0: Failed to delete old union polygon cache: ${deleteError.message}`);
                          }
                          // Clear the cache key so we fetch TIGER boundaries below
                          unionCacheKey = null;
                          group.unionPolygonCacheKey = undefined;
                        } else {
                          // This is a TIGER-based union polygon - load it
                          console.log(`🔍 STEP 0: Loading TIGER state boundary from cache (key: ${unionCacheKey})`);
                          const cacheResult = await cloudStorageCache.get(unionCacheKey);
                          if (cacheResult && cacheResult.data) {
                            const unionData = cacheResult.data;
                            if (Array.isArray(unionData)) {
                              group.unionPolygons = unionData;
                              group.unionPolygon = unionData.length > 0 ? unionData[0] : undefined;
                            } else {
                              group.unionPolygon = unionData;
                              group.unionPolygons = [unionData];
                            }
                            console.log(`✅ STEP 0: Loaded TIGER state boundary from cache (verified TIGER-based)`);
                          }
                        }
                      }
                    } catch (metadataError) {
                      console.warn(`⚠️ STEP 0: Failed to check union polygon metadata: ${metadataError.message}, will fetch TIGER boundaries`);
                      unionCacheKey = null;
                    }
                  }
                  
                  // If no valid TIGER-based union polygon was loaded, use shared state boundary (same as All-states map)
                  if (!group.unionPolygon && !group.unionPolygons) {
                    console.log(`🔍 STEP 0: Using shared state boundary (same as All-states map)...`);
                    try {
                      const mainStateBoundary = await getOrCreateStateBoundaryInCloudStorage(state);
                      if (mainStateBoundary && (mainStateBoundary.type === 'Feature' || mainStateBoundary.geometry)) {
                        group.unionPolygon = mainStateBoundary;
                        group.unionPolygons = [mainStateBoundary];
                        const stateBoundaryKey = `state_boundary_polygon_${state.toUpperCase()}`;
                        group.unionPolygonCacheKey = stateBoundaryKey;
                        console.log(`✅ STEP 0: Set state boundary from shared cache (${stateBoundaryKey})`);
                      }
                    } catch (stateBoundaryError) {
                      console.error(`❌ STEP 0: Failed to get state boundary: ${stateBoundaryError.message}`);
                    }
                  }
                }
                
                if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
                  try {
                    const stateTractDoc = await getCacheDoc(cachedEntry.tractCacheKey);
                    if (stateTractDoc) {
                      const stateTractData = stateTractDoc;
                      // Check if state tract cache version matches current algorithm version
                      const stateTractVersion = stateTractData.algorithmVersion;
                      if (stateTractVersion !== ALGORITHM_VERSION) {
                        console.log(`⚠️ State tract cache version mismatch (${stateTractVersion || 'none'} != ${ALGORITHM_VERSION}), skipping reconstruction - will use fresh tracts`);
                        // Trigger immediate regeneration of state tract cache (don't wait, but start it)
                        // The cacheStep0 function will handle the actual regeneration
                      } else if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
                        // Get tract map and reconstruct
                        let tractMap = null;
                        if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
                          const cloudStorageResult = await cloudStorageCache.get(cachedEntry.tractCacheKey);
                          if (cloudStorageResult && cloudStorageResult.data) {
                            tractMap = cloudStorageResult.data;
                          }
                        } else if (stateTractData.chunked && stateTractData.chunkKeys) {
                          const chunkDocs = await Promise.all(
                            stateTractData.chunkKeys.map(key => getCacheDoc(key))
                          );
                          const allTracts = [];
                          for (const chunkDoc of chunkDocs) {
                            if (chunkDoc && chunkDoc.data) {
                              allTracts.push(...chunkDoc.data);
                            }
                          }
                          tractMap = allTracts;
                        } else if (stateTractData.tractMap) {
                          tractMap = stateTractData.tractMap;
                        } else if (stateTractData.data) {
                          tractMap = stateTractData.data;
                        }
                        
                        if (tractMap) {
                          console.log(`🔄 RECONSTRUCTING: Reconstructing step 0 with ${Array.isArray(tractMap) ? tractMap.length : 'non-array'} tracts from cache`);
                          // Don't recreate union polygons during reconstruction - we'll replace tracts and recreate union polygon after
                          stepData = await reconstructStepFromCache(stepData, tractMap, false, state); // Pass flag to skip union polygon creation
                          console.log(`✅ RECONSTRUCTED: Step 0 now has ${stepData.districtGroups?.[0]?.censusTracts?.length || 0} tracts in first group`);
                        } else {
                          console.warn(`⚠️ RECONSTRUCTION: No tractMap available for reconstruction`);
                        }
                      } else {
                        console.log(`⚠️ State tract cache expired, skipping reconstruction - will use fresh tracts`);
                      }
                    } else {
                      console.log(`⚠️ State tract cache not found, skipping reconstruction - will use fresh tracts`);
                    }
                  } catch (reconstructError) {
                    console.warn(`⚠️ Failed to reconstruct step 0 from cache: ${reconstructError.message}`);
                  }
                }

                // If reconstruction returned null (e.g. tract cache invalid/bad geometry), build step 0 from fresh tracts
                const firstGroupTracts = stepData?.districtGroups?.[0]?.censusTracts;
                if (!stepData || !stepData.districtGroups?.length || !(firstGroupTracts && firstGroupTracts.length > 0)) {
                  console.log(`🔄 STEP 0: Reconstruction failed or empty tracts; building step 0 from ${tracts.length} fresh tracts`);
                  const totalStatePopulationFromTracts = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
                  const { calculateBounds, calculateCentroid } = require('./services/geodistrict-algorithm');
                  stepData = {
                    step: 0,
                    districtGroups: [{
                      startDistrictNumber: 1,
                      endDistrictNumber: totalDistricts,
                      totalDistricts,
                      totalPopulation: totalStatePopulationFromTracts,
                      censusTracts: tracts,
                      bounds: calculateBounds(tracts),
                      centroid: calculateCentroid(tracts)
                    }],
                    description: 'Initial state: All tracts in single group'
                  };
                  // Restore island tracts data from cached step so UI and steps 1+ still have it
                  if (preservedStep0Metadata?.islandTractsData) {
                    stepData.islandTractsData = preservedStep0Metadata.islandTractsData;
                  }
                }
                
                // For step 0, use the tracts we just loaded instead of trying to reconstruct from cache
                // Step 0 is the initial state with all tracts, so we can use the fresh tracts
                if (stepData.districtGroups && stepData.districtGroups.length > 0) {
                  // Replace the district group's tracts with the fresh tracts we just loaded
                  stepData.districtGroups[0].censusTracts = tracts;
                  console.log(`✅ STEP 0: Using ${tracts.length} fresh tracts instead of cached reconstruction`);
                  
                  // For Step 0, ensure TIGER state boundaries are used
                  stepData = await ensureStep0UsesTigerBoundaries(stepData, state, 0, req);

                  // Enrich tracts with party data (same as reconstructStepFromCache) so popup and coloring use tract.properties
                  const tractPartyByGeoid = state ? await tractPartyPersistence.loadTractPartyForState(state, 2024) : null;
                  if (tractPartyByGeoid && Object.keys(tractPartyByGeoid).length > 0 && stepData.districtGroups[0].censusTracts) {
                    stepData.districtGroups[0].censusTracts = stepData.districtGroups[0].censusTracts.map(t => {
                      const tid = getTractId(t);
                      const row = tractPartyByGeoid[tid] || tractPartyByGeoid[String(tid)];
                      if (!row) return t;
                      return {
                        ...t,
                        properties: {
                          ...(t.properties || {}),
                          pctDem: row.pctDem,
                          pctRep: row.pctRep,
                          votesDem: row.votesDem,
                          votesRep: row.votesRep,
                          totalVotes: row.totalVotes
                        }
                      };
                    });
                    console.log(`✅ STEP 0: Enriched ${stepData.districtGroups[0].censusTracts.length} tracts with party data`);
                  }
                }
                
                // Reconstruct algorithm state from cached step
                // Calculate total state population from tracts
                const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
                const targetDistrictPopulation = totalStatePopulation / totalDistricts;
                
                // Store only tract IDs to keep state small
                const uniqueTractIds = tracts.map(tract => getTractId(tract)).filter(Boolean);
                
                const algorithmState = {
                  uniqueTractIds, // Store IDs only, not full geometries
                  tractCacheKey: cachedEntry.tractCacheKey || `state_tracts_${state}`, // Reference to tract cache
                  currentGroups: stepData.districtGroups || [],
                  iteration: 0,
                  steps: [stepData], // Include the cached step 0
                  algorithmHistory: [], // Initialize history array
                  totalStatePopulation,
                  targetDistrictPopulation,
                  maxIterations,
                  state: state // State code
                };
                
                const stateKey = getAlgorithmStateKey(state, maxIterations);
                // Cache algorithm state - wait for completion so next-step can find it
                try {
                  await cacheAlgorithmState(stateKey, algorithmState);
                  console.log(`✅ Cached algorithm state for ${stateKey} (available for next-step requests)`);
                } catch (err) {
                  console.warn(`⚠️ Failed to cache algorithm state: ${err.message}`);
                }
                
                return res.json({
                  step: 0,
                  data: stepData,
                  isComplete: false
                });
              } else {
                console.log(`🔄 STEP 0 CACHE VERSION MISMATCH: Invalidating`);
                await deleteCacheDoc(step0CacheKey);
              }
            }
          }
        } catch (cacheError) {
          console.warn(`⚠️ STEP 0 CACHE CHECK ERROR: ${cacheError.message}, proceeding with initialization`);
        }
      }

      // Initialize algorithm and get step 0
      let { step, state: algorithmState } = await algorithmService.initializeAlgorithm(
        tracts,
        totalDistricts,
        maxIterations
      );

      // Cache algorithm state - normalization happens automatically in cacheAlgorithmState
      // This will remove full geometries and store only tract IDs, dramatically reducing size
      const stateKey = getAlgorithmStateKey(state, maxIterations);
      try {
        await cacheAlgorithmState(stateKey, {
          ...algorithmState,
          tractCacheKey: `state_tracts_${state}` // Ensure tract cache key is set
        });
        console.log(`✅ Cached algorithm state for ${stateKey} (available for next-step requests)`);
      } catch (err) {
        console.warn(`⚠️ Failed to cache algorithm state: ${err.message}`);
      }

      logger.info(`✅ Step 0 initialized: ${step.districtGroups[0]?.censusTracts.length || 0} tracts`);

      // For Step 0, ALWAYS use TIGER state boundaries instead of merged tracts
      // Step 0 should NEVER create union polygons from tracts - only use TIGER boundaries
      // Clear any union polygons that might have been created (shouldn't happen, but be safe)
      if (step.districtGroups && step.districtGroups.length > 0) {
        const step0Group = step.districtGroups[0];
        if (step0Group.unionPolygon || step0Group.unionPolygons) {
          console.log(`⚠️ STEP 0: Clearing union polygons created from tracts (should not happen)`);
          step0Group.unionPolygon = undefined;
          step0Group.unionPolygons = undefined;
        }
      }
      
      // Ensure step 0 uses TIGER state boundaries
      step = await ensureStep0UsesTigerBoundaries(step, state, 0, req);

      // Cache step 0 result (async, don't wait)
      // NOTE: TIGER state boundaries are already set above, so they will be cached
      // Note: canonicalResult is in scope from the parent function
      const cacheStep0 = async () => {
        try {
          const tractCacheKey = `state_tracts_${state}`;
          const normalizedStep = normalizeStepData(step, tractCacheKey);
          
          // Store state tract cache if it doesn't exist, version changed, or geometry coverage is bad.
          // This step 0 path is the single writer for state tract cache in step-by-step flow; do not add other writers that strip geometry.
          const existingTractCache = await getCacheDoc(tractCacheKey);
          
          const existingVersion = existingTractCache ? existingTractCache.algorithmVersion : null;
          let shouldRegenerateCache = !existingTractCache || existingVersion !== ALGORITHM_VERSION;

          // When cache exists and version matches, validate geometry coverage or that the file actually exists
          const GEOMETRY_COVERAGE_THRESHOLD = 0.95; // Require at least 95% of tracts to have geometry
          if (!shouldRegenerateCache && existingTractCache) {
            let existingTractMap = null;
            const existingData = existingTractCache;
            if (existingData?.cloudStorage && existingData?.cloudStoragePath) {
              try {
                const cloudResult = await cloudStorageCache.get(tractCacheKey);
                if (cloudResult?.data) existingTractMap = cloudResult.data;
                else {
                  console.log(`🔍 State tract cache metadata exists but Cloud Storage file not found, regenerating...`);
                  shouldRegenerateCache = true;
                }
              } catch (e) {
                console.warn(`⚠️ Could not fetch existing tract cache: ${e.message}, regenerating...`);
                shouldRegenerateCache = true;
              }
            } else if (existingData?.data && Array.isArray(existingData.data)) {
              existingTractMap = existingData.data;
            }
            if (!shouldRegenerateCache && existingTractMap && existingTractMap.length > 0) {
              const sampleSize = Math.min(500, existingTractMap.length);
              const step = Math.max(1, Math.floor(existingTractMap.length / sampleSize));
              let withGeometry = 0;
              let sampled = 0;
              for (let i = 0; i < existingTractMap.length && sampled < sampleSize; i += step) {
                const entry = existingTractMap[i];
                const tract = Array.isArray(entry) && entry.length === 2 ? entry[1] : entry;
                if (tract && (tract.geometry || (tract.type === 'Feature' && tract.geometry))) withGeometry++;
                sampled++;
              }
              const coverage = sampled > 0 ? withGeometry / sampled : 0;
              if (coverage < GEOMETRY_COVERAGE_THRESHOLD) {
                console.log(`🔍 State tract cache geometry coverage ${(coverage * 100).toFixed(1)}% (${withGeometry}/${sampled}) below threshold ${(GEOMETRY_COVERAGE_THRESHOLD * 100)}%, regenerating...`);
                shouldRegenerateCache = true;
              }
            }
          }

          console.log(`🔍 State tract cache check: exists=${!!existingTractCache}, version=${existingVersion || 'none'}, current=${ALGORITHM_VERSION}, shouldRegenerate=${shouldRegenerateCache}`);
          
          if (shouldRegenerateCache) {
            if (existingTractCache) {
              console.log(`🔄 State tract cache regenerating (version mismatch or bad geometry coverage)...`);
              // Delete old Cloud Storage file if it exists
              if (existingTractCache.cloudStorage && existingTractCache.cloudStoragePath) {
                try {
                  await cloudStorageCache.delete(tractCacheKey);
                  console.log(`🗑️ Deleted old Cloud Storage cache for ${state}`);
                } catch (deleteError) {
                  console.warn(`⚠️ Failed to delete old Cloud Storage cache: ${deleteError.message}`);
                }
              }
            } else {
              console.log(`📦 Creating new state tract cache for ${state}`);
            }
            
            // Create tract map from the canonical tract model
            // Use the canonical tractMap (Map) which has the full structure (censusData, s4Adjacency, etc.)
            // Convert Map to array of [id, tract] pairs for caching
            // The canonical model ensures no duplicates (Map enforces uniqueness by tract ID)
            const { getTractId } = require('./services/geodistrict-algorithm');
            
            // Use canonicalResult.tractMap if available (full canonical structure)
            // Otherwise fall back to creating map from geoJsonFeatures
            let tractMap;
            if (canonicalResult && canonicalResult.tractMap) {
              // Convert canonical Map to array of [id, tract] pairs (only tracts with geometry)
              // Cache must contain only tracts with geometry so final-step and map-polygons validation passes
              tractMap = Array.from(canonicalResult.tractMap.entries())
                .filter(([, canonicalTract]) => canonicalTract && canonicalTract.geometry)
                .map(([tractId, canonicalTract]) => {
                  const geoJsonFeature = {
                    type: 'Feature',
                    geometry: canonicalTract.geometry,
                    properties: {
                      ...canonicalTract.properties,
                      _canonicalTractId: canonicalTract.tractId,
                      _hasCensusData: !!canonicalTract.censusData,
                      _hasS4Adjacency: !!canonicalTract.s4Adjacency,
                      _s4Adjacency: canonicalTract.s4Adjacency || null
                    }
                  };
                  return [tractId, geoJsonFeature];
                })
                .filter(([id]) => id);
              
              console.log(`📊 Created tract map from canonical model: ${tractMap.length} tracts with geometry (canonical structure preserved)`);
            } else {
              // Fallback: create map from geoJsonFeatures (legacy behavior)
              tractMap = tracts.map(tract => {
                const tractId = getTractId(tract);
                return [tractId, tract];
              }).filter(([id]) => id); // Filter out tracts without IDs
              
              console.log(`📊 Created tract map from geoJsonFeatures: ${tractMap.length} tracts (legacy format)`);
            }
            
            console.log(`📊 Sample tract IDs: ${tractMap.slice(0, 3).map(([id]) => id).join(', ')}`);
            
            // Store state tract cache using the same method as cacheAlgorithmResult
            const tractCacheSize = JSON.stringify(tractMap).length;
            const tractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
            const FIRESTORE_MAX_SIZE = 1024 * 1024; // 1MB
            const useCloudStorage = tractCacheSize > FIRESTORE_MAX_SIZE;
            
            if (useCloudStorage) {
            // Store in Cloud Storage
            console.log(`📦 CLOUD STORAGE: Storing state tract cache (${tractCacheSizeMB} MB) for ${state} in Cloud Storage`);
            try {
              const cloudStoragePath = await cloudStorageCache.set(tractCacheKey, tractMap, {
                state: state,
                tractCount: tractMap.length.toString(),
                source: 'state-tract-cache'
              });
              
              // Store metadata reference in Firestore
              const metadataEntry = {
                cloudStoragePath: cloudStoragePath,
                timestamp: Date.now(),
                ttl: null, // No expiration - tract geometries are static
                version: CACHE_VERSION,
                algorithmVersion: ALGORITHM_VERSION, // Store algorithm version to detect ID format changes
                source: 'state-tract-cache-metadata',
                attribution: `Tract geometries metadata for state ${state}`,
                chunked: false,
                cloudStorage: true,
                totalChunks: 0,
                tractCount: tractMap.length,
                state: state,
                size: tractCacheSize,
                sizeMB: parseFloat(tractCacheSizeMB)
              };
              
              await setCacheDoc(tractCacheKey, metadataEntry);
              console.log(`💾 CLOUD STORAGE: Stored ${tractCacheSizeMB} MB tract cache for state ${state} at ${cloudStoragePath}`);
            } catch (error) {
              console.warn(`⚠️ Failed to store state tract cache in Cloud Storage: ${error.message}`);
            }
          } else {
            // Store directly in Firestore
            const metadataEntry = {
              data: tractMap,
              timestamp: Date.now(),
              ttl: null, // No expiration - tract geometries are static
              version: CACHE_VERSION,
              algorithmVersion: ALGORITHM_VERSION, // Store algorithm version to detect ID format changes
              source: 'state-tract-cache',
              attribution: `Tract geometries for state ${state}`,
              chunked: false,
              cloudStorage: false,
              tractCount: tractMap.length,
              state: state,
              size: tractCacheSize,
              sizeMB: parseFloat(tractCacheSizeMB)
            };
            
            await setCacheDoc(tractCacheKey, metadataEntry);
            console.log(`💾 FIRESTORE: Stored ${tractCacheSizeMB} MB tract cache for state ${state} in Firestore`);
            }
          } else {
            console.log(`✅ State tract cache already exists for ${state}, skipping storage`);
          }
          
          // Cache union polygons for step 0
          // Log what we're about to cache
          if (step.districtGroups && step.districtGroups.length > 0) {
            const firstGroup = step.districtGroups[0];
            console.log(`🔍 BEFORE CACHING: Group ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber} has unionPolygons: ${Array.isArray(firstGroup.unionPolygons)}, length: ${firstGroup.unionPolygons?.length || 0}, has unionPolygon: ${!!firstGroup.unionPolygon}`);
          }
          const unionPolygonCacheKeys = await cacheUnionPolygons(state, 0, step.districtGroups);
          
          // Add union polygon cache keys to normalized step data
          if (Object.keys(unionPolygonCacheKeys).length > 0) {
            normalizedStep.normalized.districtGroups = normalizedStep.normalized.districtGroups.map((group, index) => {
              if (unionPolygonCacheKeys[index]) {
                group.unionPolygonCacheKey = unionPolygonCacheKeys[index];
              }
              return group;
            });
          }
          
          const cacheData = {
            stepData: normalizedStep.normalized,
            isComplete: false,
            algorithmVersion: ALGORITHM_VERSION,
            timestamp: Date.now(),
            ttl: 24 * 60 * 60 * 1000, // 24 hours
            source: 'algorithm-step-cache',
            normalized: true,
            tractCacheKey: tractCacheKey,
            state: state,
            step: 0,
            unionPolygonsCached: Object.keys(unionPolygonCacheKeys).length > 0
          };

          await setCacheDoc(step0CacheKey, cacheData);
          console.log(`💾 STEP 0 CACHE STORED: Cached step 0 for ${state} with ${Object.keys(unionPolygonCacheKeys).length} union polygon(s)`);
        } catch (cacheError) {
          console.warn(`⚠️ STEP 0 CACHE STORE ERROR: ${cacheError.message}`);
        }
      };

      await cacheStep0();

      // Log what we're returning to frontend
      if (step.districtGroups && step.districtGroups.length > 0) {
        const firstGroup = step.districtGroups[0];
        const hasUnionPolygons = Array.isArray(firstGroup.unionPolygons);
        const unionPolygonsLength = hasUnionPolygons ? firstGroup.unionPolygons.length : 0;
        console.log(`📤 RETURNING STEP 0: Group ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber} has unionPolygons array: ${hasUnionPolygons}, length: ${unionPolygonsLength}, has unionPolygon: ${!!firstGroup.unionPolygon}`);
      }

      // Return step 0
      res.json({
        step: 0,
        data: step,
        isComplete: false
      });
    } catch (error) {
      console.error('❌ Algorithm initialization error:', error);
      res.status(500).json({
        error: 'Algorithm initialization failed',
        message: error.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
      });
    }
  } catch (error) {
    console.error('❌ Algorithm setup error:', error);
    res.status(500).json({
      error: 'Algorithm setup failed',
      message: error.message
    });
  }
});

/**
 * GET /api/algorithm/step/:state/:stepNumber
 * Get a specific step by number from cache
 * Supports both cache formats:
 * - algorithm_step_{state}_{maxIterations}_{step} (step-by-step execution, has stepData field)
 * - step_{state}_{step}_{version} (Run All Steps execution, data directly in document)
 */
app.get('/api/algorithm/union-polygon-keys/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const fromStep = parseInt(req.query.fromStep || '0', 10);
    if (!state || state.length < 2) {
      return res.status(400).json({ error: 'Invalid state code' });
    }
    const keys = await cloudStorageCache.listUnionPolygonKeysForState(state, fromStep);
    const bucket = process.env.CENSUS_DATA_BUCKET || 'geodistricts-census-data';
    const paths = keys.map(key => {
      const match = key.match(/^union_polygon_([A-Z]{2})_(\d+)_(.+)$/);
      const step = match ? match[2] : '0';
      return `gs://${bucket}/union-polygons/${state}/step-${step}/${key}.json`;
    });
    return res.json({ state, fromStep, count: keys.length, keys, paths });
  } catch (err) {
    console.error('List union polygon keys error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/algorithm/census-tracts/:state
 * Return census tract data for a state (for dev/maps tract list). Uses state tract cache when available;
 * on cache miss fetches from census/TIGER, runs enclosed detection, writes state tract cache, returns tracts.
 */
app.get('/api/algorithm/census-tracts/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    if (!state || state.length !== 2) {
      return res.status(400).json({ error: 'Invalid state code' });
    }
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.status(400).json({ error: `Invalid state: ${state}` });
    }

    let tracts = [];
    let canonicalResult = null;

    const fromCache = await loadTractsFromStateTractCache(state);
    if (fromCache && fromCache.tracts.length > 0) {
      return res.json({ tracts: fromCache.tracts });
    }

    // Cache miss: same fetch pipeline as step-by-step; always use internal batch fetch for full tract set
    let boundaries;
    console.log(`📡 Census-tracts: fetching boundaries via internal batch fetch for state: ${state}`);
    boundaries = await fetchTractBoundariesForState(state);
    if (!boundaries?.features?.length) {
      return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
    }
    const countiesUrl = `${req.protocol}://${req.get('host')}/api/census/counties?state=${state}`;
    const countiesResponse = await axios.get(countiesUrl);
    const counties = countiesResponse.data || [];
    const countyFipsCodes = counties.map(c => c.COUNTY || c.county || c.fips);
    const bulkResponse = await axios.post(`${req.protocol}://${req.get('host')}/api/census/tract-data/bulk`, {
      state,
      counties: countyFipsCodes,
      forceInvalidate: false
    });
    const demographicData = bulkResponse.data.data || [];
    const s4DataLoader = require('./services/s4-data-loader');
    try { await s4DataLoader.loadS4AdjacencyData(state); } catch (e) { console.warn(`⚠️ S4 load: ${e.message}`); }
    const { createCanonicalTractMap } = require('./services/canonical-tract-loader');
    canonicalResult = createCanonicalTractMap(demographicData, boundaries, state);
    tracts = canonicalResult.geoJsonFeatures;
    if (tracts.length === 0) {
      return res.status(404).json({ error: `No tracts found for state: ${state}` });
    }

    const { detectEnclosedTracts, getTractId } = require('./services/geodistrict-algorithm');
    const enclosedMap = detectEnclosedTracts(tracts);
    const tractIdMap = new Map();
    for (const tract of tracts) {
      const tractId = getTractId(tract);
      if (tractId) tractIdMap.set(tractId, tract);
    }
    let nextGroupId = 1;
    const groupIdMap = new Map();
    for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
      let groupId = groupIdMap.get(enclosedId) || groupIdMap.get(enclosingId);
      if (!groupId) groupId = `group_${nextGroupId++}`;
      groupIdMap.set(enclosedId, groupId);
      groupIdMap.set(enclosingId, groupId);
    }
    for (const tract of tracts) {
      const tractId = getTractId(tract);
      if (!tractId) continue;
      if (enclosedMap.has(tractId)) tract.properties.ENCLOSED_BY = enclosedMap.get(tractId);
      const enclosedByThis = [];
      for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
        if (enclosingId === tractId) enclosedByThis.push(enclosedId);
      }
      if (enclosedByThis.length > 0) tract.properties.ENCLOSES = enclosedByThis;
      if (groupIdMap.has(tractId)) tract.properties.TRACT_GROUP_ID = groupIdMap.get(tractId);
    }

    const tractCacheKey = `state_tracts_${state}`;
    const existingTractCache = await getCacheDoc(tractCacheKey);
    const existingVersion = existingTractCache ? existingTractCache.algorithmVersion : null;
    let shouldRegenerateCache = !existingTractCache || existingVersion !== ALGORITHM_VERSION;
    const GEOMETRY_COVERAGE_THRESHOLD = 0.95;
    if (!shouldRegenerateCache && existingTractCache) {
      let existingTractMap = null;
      const existingData = existingTractCache;
      if (existingData?.cloudStorage && existingData?.cloudStoragePath) {
        try {
          const cloudResult = await cloudStorageCache.get(tractCacheKey);
          if (cloudResult?.data) existingTractMap = cloudResult.data;
          else shouldRegenerateCache = true;
        } catch (e) {
          shouldRegenerateCache = true;
        }
      } else if (existingData?.data && Array.isArray(existingData.data)) {
        existingTractMap = existingData.data;
      }
      if (!shouldRegenerateCache && existingTractMap && existingTractMap.length > 0) {
        const sampleSize = Math.min(500, existingTractMap.length);
        const step = Math.max(1, Math.floor(existingTractMap.length / sampleSize));
        let withGeometry = 0, sampled = 0;
        for (let i = 0; i < existingTractMap.length && sampled < sampleSize; i += step) {
          const entry = existingTractMap[i];
          const t = Array.isArray(entry) && entry.length === 2 ? entry[1] : entry;
          if (t && (t.geometry || (t.type === 'Feature' && t.geometry))) withGeometry++;
          sampled++;
        }
        if (sampled > 0 && withGeometry / sampled < GEOMETRY_COVERAGE_THRESHOLD) shouldRegenerateCache = true;
      }
    }

    if (shouldRegenerateCache) {
      let tractMap;
      if (canonicalResult && canonicalResult.tractMap) {
        tractMap = Array.from(canonicalResult.tractMap.entries())
          .filter(([, canonicalTract]) => canonicalTract && canonicalTract.geometry)
          .map(([id, canonicalTract]) => {
            const geoJsonFeature = {
              type: 'Feature',
              geometry: canonicalTract.geometry,
              properties: {
                ...canonicalTract.properties,
                _canonicalTractId: canonicalTract.tractId,
                _hasCensusData: !!canonicalTract.censusData,
                _hasS4Adjacency: !!canonicalTract.s4Adjacency,
                _s4Adjacency: canonicalTract.s4Adjacency || null
              }
            };
            return [id, geoJsonFeature];
          })
          .filter(([id]) => id);
      } else {
        tractMap = tracts.map(tract => {
          const tractId = getTractId(tract);
          return [tractId, tract];
        }).filter(([id]) => id);
      }
      const tractCacheSize = JSON.stringify(tractMap).length;
      const tractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
      const FIRESTORE_MAX_SIZE = 1024 * 1024;
      const useCloudStorage = tractCacheSize > FIRESTORE_MAX_SIZE;
      if (useCloudStorage) {
        try {
          const cloudStoragePath = await cloudStorageCache.set(tractCacheKey, tractMap, {
            state,
            tractCount: tractMap.length.toString(),
            source: 'state-tract-cache'
          });
          const metadataEntry = {
            cloudStoragePath,
            timestamp: Date.now(),
            ttl: null,
            version: CACHE_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            source: 'state-tract-cache-metadata',
            attribution: `Tract geometries metadata for state ${state}`,
            chunked: false,
            cloudStorage: true,
            totalChunks: 0,
            tractCount: tractMap.length,
            state,
            size: tractCacheSize,
            sizeMB: parseFloat(tractCacheSizeMB)
          };
          await setCacheDoc(tractCacheKey, metadataEntry);
        } catch (error) {
          console.warn(`⚠️ Failed to store state tract cache in Cloud Storage: ${error.message}`);
        }
      } else {
        const metadataEntry = {
          data: tractMap,
          timestamp: Date.now(),
          ttl: null,
          version: CACHE_VERSION,
          algorithmVersion: ALGORITHM_VERSION,
          source: 'state-tract-cache',
          attribution: `Tract geometries for state ${state}`,
          chunked: false,
          cloudStorage: false,
          tractCount: tractMap.length,
          state,
          size: tractCacheSize,
          sizeMB: parseFloat(tractCacheSizeMB)
        };
        await setCacheDoc(tractCacheKey, metadataEntry);
      }
    }

    return res.json({ tracts });
  } catch (error) {
    console.error('❌ Census-tracts endpoint error:', error);
    res.status(500).json({
      error: 'Failed to get census tracts',
      message: error.message
    });
  }
});

app.get('/api/algorithm/step/:state/:stepNumber', async (req, res) => {
  try {
    const { state, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    const currentVersion = ALGORITHM_VERSION;

    if (isNaN(stepNum) || stepNum < 0) {
      return res.status(400).json({ error: 'Invalid step number' });
    }

    let cachedEntry = null;
    let stepCacheKey = null;

    // Try step-by-step cache format first (algorithm_step_{state}_{maxIterations}_{step})
    stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    cachedEntry = await getCacheDoc(stepCacheKey);
    if (cachedEntry) {
      // Check if expired
      if (cachedEntry.timestamp && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
        cachedEntry = null;
      } else if (cachedEntry.algorithmVersion !== currentVersion) {
        cachedEntry = null;
      }
    }

    // If not found or invalid, try Run All Steps cache format (step_{state}_{step}_{version})
    if (!cachedEntry) {
      stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      cachedEntry = await getCacheDoc(stepCacheKey);
      if (cachedEntry) {
        if (cachedEntry.timestamp && cachedEntry.ttl && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
          cachedEntry = null;
        } else if (cachedEntry.algorithmVersion !== currentVersion) {
          cachedEntry = null;
        }
      }
    }

    // Fallback: use algorithm state blob (recorded state per step) when per-step doc missing
    if (!cachedEntry) {
      const stateKey = getAlgorithmStateKey(state, maxIterations);
      const algorithmState = await getCachedAlgorithmState(stateKey);
      if (algorithmState && algorithmState.steps && algorithmState.steps[stepNum]) {
        const stepFromState = algorithmState.steps[stepNum];
        cachedEntry = {
          stepData: stepFromState,
          normalized: true,
          tractCacheKey: algorithmState.tractCacheKey || `state_tracts_${state}`,
          isComplete: algorithmState.iteration === stepNum
        };
      }
    }

    if (!cachedEntry) {
      return res.status(404).json({ error: `Step ${stepNum} not found in cache for ${state}` });
    }

    const polygonsOnly = req.query.polygonsOnly === 'true';
    if (polygonsOnly && cachedEntry.unionPolygonsCached === true) {
      const groups = cachedEntry.stepData?.districtGroups || cachedEntry.districtGroups || [];
      const sortedGroups = groups
        .filter(g => g && (g.unionPolygonCacheKey || (g.startDistrictNumber != null && g.endDistrictNumber != null)))
        .sort((a, b) => (a.startDistrictNumber || 0) - (b.startDistrictNumber || 0));
      if (sortedGroups.length > 0) {
        try {
          const groupsWithUnions = await loadUnionPolygonsFromCache(state, stepNum, sortedGroups, { unionPolygonsCached: true });
          const districtGroups = groupsWithUnions.map(g => ({
            startDistrictNumber: g.startDistrictNumber,
            endDistrictNumber: g.endDistrictNumber,
            totalPopulation: g.totalPopulation,
            totalDistricts: g.totalDistricts,
            bounds: g.bounds,
            centroid: g.centroid,
            unionPolygon: g.unionPolygon,
            unionPolygons: g.unionPolygons
          }));
          const stepData = {
            step: stepNum,
            level: stepNum,
            districtGroups,
            description: cachedEntry.stepData?.description || `Step ${stepNum}`,
            totalGroups: districtGroups.length,
            totalDistricts: districtGroups.reduce((s, g) => s + (g.totalDistricts || 0), 0),
            divisionDirection: cachedEntry.stepData?.divisionDirection,
            divisionLines: cachedEntry.stepData?.divisionLines || []
          };
          return res.json({
            step: stepNum,
            data: stepData,
            isComplete: cachedEntry.isComplete || false
          });
        } catch (polyErr) {
          console.warn(`⚠️ polygonsOnly load failed, falling back to full step: ${polyErr.message}`);
        }
      }
    }

    // Determine if step data is in 'stepData' field (step-by-step) or directly in cachedEntry (Run All Steps)
    const hasStepDataField = cachedEntry.stepData !== undefined;
    const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
    deserializeStepDataFromFirestore(dataToReconstruct);
    const isNormalized = cachedEntry.normalized;
    const tractCacheKey = cachedEntry.tractCacheKey || `state_tracts_${state}`;

    // Reconstruct step data with tract geometries from state cache if needed
    let stepData = dataToReconstruct;
    let uniqueTractsForExclusion = [];

    // If normalized, reconstruct from state tract cache
    if (isNormalized && tractCacheKey) {
      try {
        // Fetch state-level tract cache
        const stateTractDoc = await getCacheDoc(tractCacheKey);
        
        if (stateTractDoc) {
          const stateTractData = stateTractDoc;
          if (stateTractData.algorithmVersion === currentVersion && 
              (!stateTractData.timestamp || !isCacheExpired(stateTractData.timestamp, stateTractData.ttl))) {
            
            // Get tract map from cache
            let tractMap = null;
            if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
              const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
              if (cloudStorageResult && cloudStorageResult.data) {
                tractMap = cloudStorageResult.data;
              }
            } else if (stateTractData.chunked && stateTractData.chunkKeys) {
              const chunkDocs = await Promise.all(
                stateTractData.chunkKeys.map(key => getCacheDoc(key))
              );
              const allTracts = [];
              for (const chunkDoc of chunkDocs) {
                if (chunkDoc && chunkDoc.data) {
                  allTracts.push(...chunkDoc.data);
                }
              }
              tractMap = allTracts;
            } else if (stateTractData.data) {
              tractMap = stateTractData.data;
            }
            
            // Reconstruct step with tract geometries
            if (tractMap) {
              stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, true, state); // Load union polygons
              if (!stepData || !stepData.districtGroups) {
                return res.status(404).json({ error: `Failed to reconstruct step ${stepNum}` });
              }
              uniqueTractsForExclusion = Array.isArray(tractMap) ? tractMap : Array.from(tractMap.values());
            }
          }
        }
      } catch (reconstructError) {
        console.warn(`⚠️ Failed to reconstruct step ${stepNum}: ${reconstructError.message}`);
        return res.status(500).json({ error: `Failed to reconstruct step ${stepNum}` });
      }
    }

    // Step 0: ensure the single district group contains ALL tracts from state cache (not only cached censusTractIds).
    // Cached step 0 may have been stored when fewer tracts existed (e.g. before TIGER attach or old island-only set).
    if (stepNum === 0 && stepData?.districtGroups?.[0] && uniqueTractsForExclusion.length > 0) {
      const cachedCount = stepData.districtGroups[0].censusTracts?.length ?? 0;
      if (cachedCount < uniqueTractsForExclusion.length) {
        console.log(`🔄 STEP 0: Replacing ${cachedCount} cached tracts with ${uniqueTractsForExclusion.length} tracts from state cache`);
        stepData.districtGroups[0].censusTracts = uniqueTractsForExclusion;
        stepData.districtGroups[0].totalPopulation = uniqueTractsForExclusion.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
        console.log(`✅ STEP 0: GET step/0 now has ${stepData.districtGroups[0].censusTracts.length} tracts`);
      }
    }

    // For step > 0, remove step-0 excluded tracts (islands + water/special) from isolated list
    if (stepNum > 0 && stepData.isolatedTractsData) {
      try {
        let step0Data = null;
        const step0CacheKeyForExclusion = `algorithm_step_${state}_${maxIterations}_0`;
        let step0Doc = await getCacheDoc(step0CacheKeyForExclusion);
        if (step0Doc) {
          const step0Entry = step0Doc;
          if (step0Entry.stepData) {
            step0Data = step0Entry.stepData;
            deserializeStepDataFromFirestore(step0Data);
          }
        }
        if (!step0Data) {
          const step0RunAllKey = `step_${state}_0_${currentVersion}`;
          step0Doc = await getCacheDoc(step0RunAllKey);
          if (step0Doc) {
            const step0Entry = step0Doc;
            step0Data = step0Entry.stepData !== undefined ? step0Entry.stepData : step0Entry;
            deserializeStepDataFromFirestore(step0Data);
          }
        }
        const algorithmStateForSet = {
          steps: step0Data ? [step0Data] : [],
          uniqueTracts: uniqueTractsForExclusion
        };
        const exclusionSet = buildStep0IslandSet(algorithmStateForSet, stepNum, undefined, state);
        if (exclusionSet && exclusionSet.size > 0) {
          filterIsolatedTractsDataByExclusion(stepData, exclusionSet);
        }
      } catch (filterErr) {
        console.warn(`⚠️ Filter isolated tracts by step-0 exclusion: ${filterErr.message}`);
      }
    }

    return res.json({
      step: stepNum,
      data: stepData,
      isComplete: cachedEntry.isComplete || false
    });
  } catch (error) {
    console.error(`❌ Get step error:`, error);
    res.status(500).json({
      error: 'Failed to get step',
      message: error.message
    });
  }
});

/**
 * GET /api/algorithm/step/:state/:stepNumber/union-polygons
 * Return union polygons for a step's district groups if cached. 200 with districtGroups (union fields); 404 if not available.
 */
app.get('/api/algorithm/step/:state/:stepNumber/union-polygons', async (req, res) => {
  try {
    const { state, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    const currentVersion = ALGORITHM_VERSION;

    if (isNaN(stepNum) || stepNum < 0) {
      return res.status(400).json({ error: 'Invalid step number' });
    }

    let cachedEntry = null;
    let stepCacheKey = null;

    stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    let doc = await getCacheDoc(stepCacheKey);
    if (doc) {
      let entry = doc;
      if (entry && (!entry.timestamp || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
        cachedEntry = entry;
      }
    }

    if (!cachedEntry) {
      stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      doc = await getCacheDoc(stepCacheKey);
      if (doc) {
        let entry = doc;
        if (entry && (!entry.timestamp || !entry.ttl || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
          cachedEntry = entry;
        }
      }
    }

    if (!cachedEntry || cachedEntry.unionPolygonsCached !== true) {
      return res.status(404).json({ error: 'Union polygons not available for this step' });
    }

    const groups = cachedEntry.stepData?.districtGroups || cachedEntry.districtGroups || [];
    const sortedGroups = groups
      .filter(g => g && (g.unionPolygonCacheKey || (g.startDistrictNumber != null && g.endDistrictNumber != null)))
      .sort((a, b) => (a.startDistrictNumber || 0) - (b.startDistrictNumber || 0));

    if (sortedGroups.length === 0) {
      return res.status(404).json({ error: 'Union polygons not available for this step' });
    }

    const groupsWithUnions = await loadUnionPolygonsFromCache(state, stepNum, sortedGroups, { unionPolygonsCached: true });
    const payload = groupsWithUnions.map(g => ({
      startDistrictNumber: g.startDistrictNumber,
      endDistrictNumber: g.endDistrictNumber,
      unionPolygon: g.unionPolygon,
      unionPolygons: g.unionPolygons
    }));

    return res.json({ districtGroups: payload });
  } catch (error) {
    console.error('❌ GET union-polygons error:', error);
    res.status(500).json({
      error: 'Union polygons request failed',
      message: error.message
    });
  }
});

/**
 * Background job: generate and cache union polygons for a step.
 * ONLY invoked from POST /api/algorithm/step/:state/:stepNumber/union-polygons (returns 202 immediately).
 * All other code (next-step, step-by-step, move-all-isolated) must trigger union polygons via POST, never call this directly.
 * Yields to the event loop between groups so the server can serve other requests (NEVER BLOCK).
 * @param {string} state - State code
 * @param {number} stepNum - Step number
 * @param {number} maxIterations - Max iterations (for cache key)
 */
async function runUnionPolygonGenerationJob(state, stepNum, maxIterations) {
  const currentVersion = ALGORITHM_VERSION;
  const stepResult = await getStepCacheEntry(state, stepNum, maxIterations);
  if (!stepResult) {
    throw new Error(`Step ${stepNum} not found in cache for ${state}`);
  }
  const { stepCacheKey, cachedEntry } = stepResult;

  const hasStepDataField = cachedEntry.stepData !== undefined;
  const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
  deserializeStepDataFromFirestore(dataToReconstruct);
  const isNormalized = cachedEntry.normalized;
  const tractCacheKey = cachedEntry.tractCacheKey || `state_tracts_${state}`;
  let stepData = dataToReconstruct;

  if (isNormalized && tractCacheKey) {
    const stateTractDoc = await getCacheDoc(tractCacheKey);
    if (!stateTractDoc) throw new Error(`State tract cache not found for ${state}`);
    const stateTractData = stateTractDoc;
    if (stateTractData.algorithmVersion !== currentVersion ||
        (stateTractData.timestamp && stateTractData.ttl && isCacheExpired(stateTractData.timestamp, stateTractData.ttl))) {
      throw new Error('State tract cache expired or version mismatch');
    }
    let tractMap = null;
    if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
      const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
      if (cloudStorageResult && cloudStorageResult.data) tractMap = cloudStorageResult.data;
    } else if (stateTractData.chunked && stateTractData.chunkKeys) {
      const chunkDocs = await Promise.all(stateTractData.chunkKeys.map(key => getCacheDoc(key)));
      const allTracts = [];
      for (const chunkDoc of chunkDocs) {
        if (chunkDoc && chunkDoc.data) allTracts.push(...chunkDoc.data);
      }
      tractMap = allTracts;
    } else if (stateTractData.data) {
      tractMap = stateTractData.data;
    }
    if (!tractMap) throw new Error('State tract data not available for reconstruction');
    stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, false, state);
    if (!stepData || !stepData.districtGroups || stepData.districtGroups.length === 0) {
      throw new Error(`Failed to reconstruct step ${stepNum}`);
    }
  } else if (!stepData.districtGroups || stepData.districtGroups.length === 0) {
    throw new Error(`Step ${stepNum} has no district groups`);
  }

  // POST union-polygons means "always build"; strip any existing union data so we overwrite
  for (const g of stepData.districtGroups) {
    delete g.unionPolygon;
    delete g.unionPolygons;
    delete g.unionPolygonCacheKey;
  }

  const recreated = await recreateUnionPolygonsForGroups(stepData.districtGroups, true, stepNum);
  if (!recreated || recreated.length === 0) {
    throw new Error('Failed to create union polygons for district groups');
  }
  stepData.districtGroups = recreated;

  const unionPolygonCacheKeys = await cacheUnionPolygons(state, stepNum, stepData.districtGroups);
  if (Object.keys(unionPolygonCacheKeys).length === 0) {
    throw new Error('Failed to cache union polygons');
  }

  const entryToWrite = cachedEntry;
  const groupsToUpdate = entryToWrite.stepData?.districtGroups ?? entryToWrite.districtGroups ?? [];
  for (let i = 0; i < groupsToUpdate.length; i++) {
    if (unionPolygonCacheKeys[i]) {
      groupsToUpdate[i].unionPolygonCacheKey = unionPolygonCacheKeys[i];
    }
  }
  entryToWrite.unionPolygonsCached = true;
  entryToWrite.timestamp = Date.now();
  await setStepCache(stepCacheKey, entryToWrite);
  console.log(`✅ Union polygon job completed for ${state} step ${stepNum}`);
}

/**
 * Get step cache entry for a step (tries algorithm_step_ and step_ key formats).
 * @param {string} state - State code
 * @param {number} stepNum - Step number
 * @param {number} maxIterations - Max iterations (for algorithm_step_ key)
 * @returns {Promise<{ stepCacheKey: string, cachedEntry: object }|null>}
 */
async function getStepCacheEntry(state, stepNum, maxIterations) {
  const currentVersion = ALGORITHM_VERSION;

  function entryFromDoc(doc) {
    if (!doc) return null;
    const entry = typeof doc.exists !== 'undefined' ? (doc.exists ? doc.data() : null) : doc;
    return entry;
  }

  let stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
  let doc = await getCacheDoc(stepCacheKey);
  let entry = entryFromDoc(doc);
  if (entry) {
    entry = await resolveStepCacheEntry(stepCacheKey, entry);
    if (entry && (!entry.timestamp || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
      return { stepCacheKey, cachedEntry: entry };
    }
  }
  stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
  doc = await getCacheDoc(stepCacheKey);
  entry = entryFromDoc(doc);
  if (entry) {
    entry = await resolveStepCacheEntry(stepCacheKey, entry);
    if (entry && (!entry.timestamp || !entry.ttl || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
      return { stepCacheKey, cachedEntry: entry };
    }
  }

  // Fallback: use algorithm state blob when per-step doc missing (e.g. final step from reconstruction)
  const stateKey = getAlgorithmStateKey(state, maxIterations);
  const algorithmState = await getCachedAlgorithmState(stateKey);
  if (algorithmState && algorithmState.steps && algorithmState.steps[stepNum]) {
    const stepFromState = algorithmState.steps[stepNum];
    const cachedEntry = {
      stepData: stepFromState,
      normalized: true,
      tractCacheKey: algorithmState.tractCacheKey || `state_tracts_${state}`,
      isComplete: algorithmState.iteration === stepNum
    };
    stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    return { stepCacheKey, cachedEntry };
  }

  return null;
}

/**
 * Build union polygons for final step from tracts, then backfill steps 1..finalStep-1
 * by unioning sibling DG polygons (parent = union of two children). Step 0 unchanged (TIGER only).
 * ONLY invoked when algorithm has completed (final step cached).
 * @param {string} state - State code
 * @param {number} finalStepNumber - Final step number (last step index)
 * @param {number} maxIterations - Max iterations (for cache keys)
 */
async function runBuildAllUnionPolygonsForState(state, finalStepNumber, maxIterations) {
  const turf = require('@turf/turf');
  const { buildMultiPolygonFromFeatures } = require('./services/geodistrict-algorithm');

  console.log(`📐 Build-all union polygons: ${state} final step ${finalStepNumber}`);
  await runUnionPolygonGenerationJob(state, finalStepNumber, maxIterations);
  console.log(`📐 Build-all: final step ${finalStepNumber} union polygons cached`);

  // Write single map-polygons blob so GET map-polygons/:state is one Cloud Storage read (milliseconds).
  const finalStepResult = await getStepCacheEntry(state, finalStepNumber, maxIterations);
  if (finalStepResult && finalStepResult.cachedEntry.unionPolygonsCached === true) {
    const groups = finalStepResult.cachedEntry.stepData?.districtGroups ?? finalStepResult.cachedEntry.districtGroups ?? [];
    const keys = groups
      .filter(g => g && (g.unionPolygonCacheKey || (g.startDistrictNumber != null && g.endDistrictNumber != null)))
      .sort((a, b) => (a.startDistrictNumber || 0) - (b.startDistrictNumber || 0))
      .map(g => g.unionPolygonCacheKey || `union_polygon_${state}_${finalStepNumber}_${g.startDistrictNumber}-${g.endDistrictNumber}`);
    if (keys.length > 0) {
      const statePolygon = await getOrCreateStateBoundaryInCloudStorage(state);
      const cacheResults = await Promise.all(keys.map(key => cloudStorageCache.get(key).catch(() => null)));
      const finalDistrictPolygons = [];
      for (const cacheResult of cacheResults) {
        const unionData = cacheResult && cacheResult.data;
        if (unionData) {
          const features = Array.isArray(unionData) ? unionData : [unionData];
          for (const f of features) {
            if (f && (f.type === 'Feature' || f.geometry)) finalDistrictPolygons.push(f);
          }
        }
      }
      const blobKey = `map_polygons_${state}`;
      await cloudStorageCache.set(blobKey, {
        statePolygon,
        finalDistrictPolygons,
        hasFinalStep: finalDistrictPolygons.length > 0,
        finalStepNumber
      }, { state, source: 'map-polygons-blob' }).catch(err => {
        console.warn(`⚠️ Failed to write map_polygons blob for ${state}:`, err.message);
      });
      console.log(`✅ Map-polygons blob written for ${state} (${finalDistrictPolygons.length} district polygons)`);
    }
  }

  for (let stepNum = finalStepNumber - 1; stepNum >= 1; stepNum--) {
    const stepResult = await getStepCacheEntry(state, stepNum, maxIterations);
    if (!stepResult) {
      console.warn(`⚠️ Build-all: step ${stepNum} not in cache for ${state}, skipping backward pass from step ${stepNum}`);
      continue;
    }
    const { stepCacheKey, cachedEntry } = stepResult;
    const districtGroups = cachedEntry.stepData?.districtGroups ?? cachedEntry.districtGroups ?? [];
    const divisionLines = cachedEntry.stepData?.divisionLines ?? cachedEntry.divisionLines ?? [];
    if (districtGroups.length === 0) {
      console.warn(`⚠️ Build-all: step ${stepNum} has no district groups, skipping`);
      continue;
    }

    const nextStepResult = await getStepCacheEntry(state, stepNum + 1, maxIterations);
    if (!nextStepResult) {
      throw new Error(`Build-all: step ${stepNum + 1} not in cache for ${state} (required for backward pass)`);
    }
    const nextGroups = nextStepResult.cachedEntry.stepData?.districtGroups ?? nextStepResult.cachedEntry.districtGroups ?? [];
    const childGroupsWithPolygons = await loadUnionPolygonsFromCache(state, stepNum + 1, nextGroups, { unionPolygonsCached: true });

    const childPolygonsByKey = {};
    for (const g of childGroupsWithPolygons) {
      const key = `${g.startDistrictNumber}-${g.endDistrictNumber}`;
      let feat = g.unionPolygon;
      if (!feat && g.unionPolygons && g.unionPolygons.length > 0) {
        feat = g.unionPolygons.length === 1 ? g.unionPolygons[0] : buildMultiPolygonFromFeatures(g.unionPolygons);
      }
      if (feat && feat.geometry) childPolygonsByKey[key] = feat;
    }

    const groupsWithPolygons = [];
    for (const group of districtGroups) {
      const dgKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
      let unionFeature = childPolygonsByKey[dgKey];
      if (!unionFeature) {
        const divLine = divisionLines.find(
          (line) => line.parentGroup &&
            line.parentGroup.startDistrictNumber === group.startDistrictNumber &&
            line.parentGroup.endDistrictNumber === group.endDistrictNumber
        );
        if (!divLine || !divLine.siblingGroups || divLine.siblingGroups.length !== 2) {
          console.error(`❌ Build-all: step ${stepNum} DG ${dgKey} has no child polygons and no divisionLine with two siblings`);
          continue;
        }
        const s1 = divLine.siblingGroups[0];
        const s2 = divLine.siblingGroups[1];
        const s1Key = `${s1.startDistrictNumber}-${s1.endDistrictNumber}`;
        const s2Key = `${s2.startDistrictNumber}-${s2.endDistrictNumber}`;
        const poly1 = childPolygonsByKey[s1Key];
        const poly2 = childPolygonsByKey[s2Key];
        if (!poly1 || !poly2) {
          console.error(`❌ Build-all: step ${stepNum} DG ${dgKey} missing child polygon(s): s1=${s1Key} s2=${s2Key}`);
          continue;
        }
        try {
          unionFeature = turf.union(poly1, poly2);
        } catch (err) {
          console.error(`❌ Build-all: turf.union failed for step ${stepNum} DG ${dgKey}:`, err.message);
          continue;
        }
      }
      groupsWithPolygons.push({
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.endDistrictNumber,
        totalDistricts: group.totalDistricts,
        totalPopulation: group.totalPopulation,
        unionPolygon: unionFeature,
        unionPolygons: unionFeature ? [unionFeature] : undefined
      });
    }

    if (groupsWithPolygons.length === 0) {
      console.warn(`⚠️ Build-all: step ${stepNum} produced no polygons, skipping cache write`);
      continue;
    }

    const unionPolygonCacheKeys = await cacheUnionPolygons(state, stepNum, groupsWithPolygons);
    const entryToWrite = cachedEntry;
    const groupsToUpdate = entryToWrite.stepData?.districtGroups ?? entryToWrite.districtGroups ?? [];
    for (let i = 0; i < groupsToUpdate.length; i++) {
      if (unionPolygonCacheKeys[i]) groupsToUpdate[i].unionPolygonCacheKey = unionPolygonCacheKeys[i];
    }
    entryToWrite.unionPolygonsCached = true;
    entryToWrite.timestamp = Date.now();
    await setStepCache(stepCacheKey, entryToWrite);
    console.log(`✅ Build-all: step ${stepNum} union polygons cached (${groupsWithPolygons.length} DGs)`);
  }
  console.log(`✅ Build-all union polygons completed for ${state}`);
}

/**
 * POST /api/algorithm/step/:state/:stepNumber/union-polygons
 * Start background job to generate and cache union polygons. Returns 202 immediately; work runs asynchronously.
 * This is the ONLY endpoint that performs union polygon creation. All other code (next-step, step-by-step, move-all-isolated) must trigger this POST, never build unions inline.
 * Always builds and overwrites any existing cached union polygons for this step.
 */
app.post('/api/algorithm/step/:state/:stepNumber/union-polygons', async (req, res) => {
  try {
    const { state, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    console.log(`📥 Received: POST /api/algorithm/step/${state}/${stepNumber}/union-polygons (trigger build job)`);
    const currentVersion = ALGORITHM_VERSION;

    if (isNaN(stepNum) || stepNum < 0) {
      return res.status(400).json({ error: 'Invalid step number' });
    }
    if (stepNum === 0) {
      return res.status(400).json({ error: 'Step 0 uses TIGER state boundaries only; union polygons are not generated from tracts' });
    }

    let stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    let doc = await getCacheDoc(stepCacheKey);
    let cachedEntry = null;
    if (doc) {
      let entry = doc;
      if (entry && (!entry.timestamp || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
        cachedEntry = entry;
      }
    }
    if (!cachedEntry) {
      stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      doc = await getCacheDoc(stepCacheKey);
      if (doc) {
        let entry = doc;
        if (entry && (!entry.timestamp || !entry.ttl || !isCacheExpired(entry.timestamp, entry.ttl)) && entry.algorithmVersion === currentVersion) {
          cachedEntry = entry;
        }
      }
    }
    if (!cachedEntry) {
      return res.status(404).json({ error: `Step ${stepNum} not found in cache for ${state}` });
    }

    // Run union polygon job in a separate process so the main server NEVER blocks on union polygon creation.
    // ALL union polygon runs MUST be async via this POST endpoint; the job runs in a child process.
    const { fork } = require('child_process');
    const workerPath = require('path').join(__dirname, 'scripts', 'run-union-polygon-job.js');
    const child = fork(workerPath, [state, String(stepNum), String(maxIterations)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: process.env,
      cwd: __dirname
    });
    child.on('error', (err) => console.error(`❌ Union polygon worker failed for ${state} step ${stepNum}:`, err.message));
    child.on('exit', (code, sig) => {
      if (code !== 0 && code != null) console.error(`❌ Union polygon worker exited with code ${code} for ${state} step ${stepNum}`);
    });

    return res.status(202).json({
      accepted: true,
      message: 'Union polygon generation started',
      state,
      step: stepNum
    });
  } catch (error) {
    console.error('❌ POST union-polygons error:', error);
    res.status(500).json({
      error: 'Union polygons generation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/build-all-union-polygons/:state
 * Start background job to build union polygons for final step (from tracts) then backfill steps 1..finalStep-1 (union of child DGs). Returns 202 immediately.
 * Query: finalStepNumber (required), maxIterations (optional, default 100).
 */
app.post('/api/algorithm/build-all-union-polygons/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const finalStepNumber = parseInt(req.query.finalStepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    if (!state || state.length !== 2) {
      return res.status(400).json({ error: 'Invalid state code' });
    }
    if (isNaN(finalStepNumber) || finalStepNumber < 1) {
      return res.status(400).json({ error: 'finalStepNumber query param is required and must be >= 1' });
    }
    console.log(`📥 Received: POST /api/algorithm/build-all-union-polygons/${state} (finalStep=${finalStepNumber})`);
    const { fork } = require('child_process');
    const workerPath = require('path').join(__dirname, 'scripts', 'run-build-all-union-polygons-job.js');
    const child = fork(workerPath, [state, String(finalStepNumber), String(maxIterations)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: process.env,
      cwd: __dirname
    });
    child.on('error', (err) => console.error(`❌ Build-all union polygon worker failed for ${state}:`, err.message));
    child.on('exit', (code, sig) => {
      if (code !== 0 && code != null) console.error(`❌ Build-all union polygon worker exited with code ${code} for ${state}`);
    });
    return res.status(202).json({
      accepted: true,
      message: 'Build-all union polygon generation started',
      state,
      finalStepNumber
    });
  } catch (error) {
    console.error('❌ POST build-all-union-polygons error:', error);
    res.status(500).json({
      error: 'Build-all union polygons failed',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/tract-party-persistence
 * Trigger tract-level party % persistence for a VEST year. Returns 202 when accepted.
 */
app.post('/api/algorithm/tract-party-persistence', async (req, res) => {
  try {
    const year = parseInt(req.body?.year || req.query?.year || '2024', 10);
    if (isNaN(year) || year < 2016) {
      return res.status(400).json({ error: 'Valid year (2016 or later) is required' });
    }
    const apiBaseUrl = `${req.protocol}://${req.get('host')}`;
    setImmediate(async () => {
      try {
        await tractPartyPersistence.runTractPartyPersistenceJob(year, { apiBaseUrl });
      } catch (e) {
        console.error('❌ Tract party persistence job error:', e.message);
      }
    });
    return res.status(202).json({ accepted: true, message: `Tract party persistence started for ${year}`, year });
  } catch (error) {
    console.error('❌ POST tract-party-persistence error:', error);
    res.status(500).json({ error: 'Tract party persistence failed', message: error.message });
  }
});

/**
 * GET /api/algorithm/tract-party/:state/:year
 * Return tract-level party percentages for a state and year (for coloring or district aggregation).
 */
app.get('/api/algorithm/tract-party/:state/:year', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const year = parseInt(req.params.year, 10);
    if (!state || state.length !== 2 || isNaN(year)) {
      return res.status(400).json({ error: 'Invalid state or year' });
    }
    const geoids = await tractPartyPersistence.loadTractPartyForState(state, year);
    if (geoids == null) {
      return res.json({ state, year, geoids: {}, available: false });
    }
    return res.json({ state, year, geoids, available: true });
  } catch (error) {
    console.error('❌ GET tract-party error:', error);
    res.status(500).json({ error: 'Failed to load tract party data', message: error.message });
  }
});

/** Default VEST year for district party aggregation */
const DEFAULT_VEST_YEAR = 2024;

/**
 * Load district-level party percentages for a state/step (from cache).
 * @param {string} state - State code
 * @param {number} stepNumber - Final step number
 * @param {number} maxIterations - Max iterations (for cache key)
 * @param {number|null} [vestYear] - VEST year for cache key (default 2024). If null, uses legacy key only.
 * @returns {Promise<{ districts: object, vestYear?: number } | null>}
 */
async function loadDistrictPartyForStep(state, stepNumber, maxIterations, vestYear = 2024) {
  const keyWithYear = `district_party_${state}_${stepNumber}_${maxIterations}_${vestYear}`;
  const legacyKey = `district_party_${state}_${stepNumber}_${maxIterations}`;
  try {
    let data = await getCacheDoc(vestYear != null ? keyWithYear : legacyKey);
    // Do not fall back to legacy key when vestYear === 2024; pre-fix legacy cache has inflated vote totals.
    if (!data && vestYear !== 2024) {
      data = await getCacheDoc(legacyKey);
    }
    if (!data || !data.districts || typeof data.districts !== 'object') return null;
    return { districts: data.districts, vestYear: data.vestYear ?? vestYear };
  } catch (err) {
    console.warn(`⚠️ loadDistrictPartyForStep(${state}, ${stepNumber}): ${err.message}`);
    return null;
  }
}

/**
 * Return unique 11-digit tract GEOIDs from a list of tract IDs (avoids double-counting when censusTractIds has duplicates).
 * @param {string[]|number[]} tractIds - Raw tract IDs from a district group
 * @returns {string[]}
 */
function uniqueTractGeoids(tractIds) {
  if (!Array.isArray(tractIds) || tractIds.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const id of tractIds) {
    const geoid = String(id).padStart(11, '0').substring(0, 11);
    if (geoid.length === 11 && !seen.has(geoid)) {
      seen.add(geoid);
      out.push(geoid);
    }
  }
  return out;
}

/**
 * Compute district-level party for any step by summing persisted tract totals (no persistence).
 * Used when GET district-party is called for a step that has no cached doc (e.g. intermediate steps).
 * @param {string} state - State code
 * @param {number} stepNumber - Step number (0, 1, 2, ... or final)
 * @param {number} maxIterations - Max iterations (for step cache lookup)
 * @param {number} [vestYear] - VEST year (default 2024)
 * @returns {Promise<{ districts: object, vestYear: number } | null>}
 */
async function computeDistrictPartyForStep(state, stepNumber, maxIterations, vestYear = DEFAULT_VEST_YEAR) {
  const { getTractId } = require('./services/geodistrict-algorithm');
  const stepResult = await getStepCacheEntry(state, stepNumber, maxIterations);
  if (!stepResult) return null;
  const districtGroups = stepResult.cachedEntry.stepData?.districtGroups ?? stepResult.cachedEntry.districtGroups ?? [];
  if (districtGroups.length === 0) return null;
  const tractParty = await tractPartyPersistence.loadTractPartyForState(state, vestYear);
  if (!tractParty || Object.keys(tractParty).length === 0) return null;
  const districts = {};
  for (const group of districtGroups) {
    const tractIds = group.censusTractIds && group.censusTractIds.length > 0
      ? group.censusTractIds
      : (group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []);
    const uniqueGeoids = uniqueTractGeoids(tractIds);
    let votesDem = 0;
    let votesRep = 0;
    let totalVotes = 0;
    for (const geoid of uniqueGeoids) {
      const row = tractParty[geoid];
      if (row) {
        votesDem += row.votesDem || 0;
        votesRep += row.votesRep || 0;
        totalVotes += row.totalVotes || 0;
      }
    }
    const twoPartyTotal = votesDem + votesRep;
    const pctDem = twoPartyTotal > 0 ? votesDem / twoPartyTotal : 0;
    const pctRep = twoPartyTotal > 0 ? votesRep / twoPartyTotal : 0;
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    districts[groupKey] = { pctDem, pctRep, votesDem, votesRep, totalVotes };
  }
  return { districts, vestYear };
}

/**
 * Run district-level party % job for final step: aggregate tract party data by DG and persist.
 * @param {string} state - State code
 * @param {number} finalStepNumber - Final step number
 * @param {number} maxIterations - Max iterations (for cache keys)
 * @param {number} [vestYear] - VEST year (default 2024)
 * @returns {Promise<{ success: boolean, districtsWritten: number, error?: string }>}
 */
async function runDistrictPartyJob(state, finalStepNumber, maxIterations, vestYear = DEFAULT_VEST_YEAR) {
  const { getTractId } = require('./services/geodistrict-algorithm');
  try {
    const stepResult = await getStepCacheEntry(state, finalStepNumber, maxIterations);
    if (!stepResult) {
      return { success: false, districtsWritten: 0, error: 'Final step not found in cache' };
    }
    const districtGroups = stepResult.cachedEntry.stepData?.districtGroups ?? stepResult.cachedEntry.districtGroups ?? [];
    if (districtGroups.length === 0) {
      return { success: false, districtsWritten: 0, error: 'Final step has no district groups' };
    }
    const tractParty = await tractPartyPersistence.loadTractPartyForState(state, vestYear);
    if (!tractParty || Object.keys(tractParty).length === 0) {
      return { success: false, districtsWritten: 0, error: 'Tract party data not found. Run POST /api/algorithm/tract-party-persistence first.' };
    }
    const districts = {};
    for (const group of districtGroups) {
      const tractIds = group.censusTractIds && group.censusTractIds.length > 0
        ? group.censusTractIds
        : (group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []);
      const uniqueGeoids = uniqueTractGeoids(tractIds);
      let votesDem = 0;
      let votesRep = 0;
      let totalVotes = 0;
      for (const geoid of uniqueGeoids) {
        const row = tractParty[geoid];
        if (row) {
          votesDem += row.votesDem || 0;
          votesRep += row.votesRep || 0;
          totalVotes += row.totalVotes || 0;
        }
      }
      // Use two-party total (D+R) as denominator so percentages are share of two-party vote and sum to 100%.
      // Tract totalVotes can be total ballots (when from county allocation), so totalVotes may exceed D+R.
      const twoPartyTotal = votesDem + votesRep;
      const pctDem = twoPartyTotal > 0 ? votesDem / twoPartyTotal : 0;
      const pctRep = twoPartyTotal > 0 ? votesRep / twoPartyTotal : 0;
      const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
      districts[groupKey] = { pctDem, pctRep, votesDem, votesRep, totalVotes };
    }
    const key = `district_party_${state}_${finalStepNumber}_${maxIterations}_${vestYear}`;
    const districtPartyDoc = {
      districts,
      state,
      step: finalStepNumber,
      maxIterations,
      vestYear,
      timestamp: Date.now(),
      ttl: null,
      version: CACHE_VERSION,
      source: 'district-party-job'
    };
    await setCacheDoc(key, districtPartyDoc);
    try {
      await cloudStorageCache.set(key, districtPartyDoc, {
        state,
        step: String(finalStepNumber),
        maxIterations: String(maxIterations),
        vestYear: String(vestYear)
      });
      console.log(`💾 District party: also wrote ${state} step ${finalStepNumber} to cloud storage`);
    } catch (cloudErr) {
      console.warn(`⚠️ District party: cloud write skipped for ${state}:`, cloudErr.message);
    }
    console.log(`💾 District party: wrote ${state} step ${finalStepNumber} (${Object.keys(districts).length} districts)`);
    return { success: true, districtsWritten: Object.keys(districts).length };
  } catch (err) {
    console.error('❌ runDistrictPartyJob:', err.message);
    return { success: false, districtsWritten: 0, error: err.message };
  }
}

/**
 * POST /api/algorithm/district-party/:state
 * Trigger district-level party % job for final step. Query: finalStepNumber, maxIterations (optional), vestYear (optional, default 2024).
 * Returns 202 when accepted (job runs async).
 */
app.post('/api/algorithm/district-party/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const finalStepNumber = parseInt(req.query.finalStepNumber || req.body?.finalStepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || req.body?.maxIterations || '100', 10);
    const vestYear = parseInt(req.query.vestYear || req.body?.vestYear || String(DEFAULT_VEST_YEAR), 10);
    if (!state || state.length !== 2) {
      return res.status(400).json({ error: 'Invalid state code' });
    }
    if (isNaN(finalStepNumber) || finalStepNumber < 0) {
      return res.status(400).json({ error: 'finalStepNumber is required and must be >= 0' });
    }
    setImmediate(async () => {
      try {
        await runDistrictPartyJob(state, finalStepNumber, maxIterations, vestYear);
      } catch (e) {
        console.error('❌ District party job error:', e.message);
      }
    });
    return res.status(202).json({
      accepted: true,
      message: 'District party calculation started',
      state,
      finalStepNumber,
      maxIterations
    });
  } catch (error) {
    console.error('❌ POST district-party error:', error);
    res.status(500).json({ error: 'District party job failed', message: error.message });
  }
});

/**
 * GET /api/algorithm/district-party/:state/:stepNumber
 * Return district-level party percentages for a state and step. Works for any step (0, 1, 2, ... final).
 * If no cached doc exists for that step, computes on the fly by summing persisted tract totals.
 * Query: maxIterations (optional), vestYear (optional, default 2024).
 */
app.get('/api/algorithm/district-party/:state/:stepNumber', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const stepNumber = parseInt(req.params.stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    const vestYear = req.query.vestYear !== undefined && req.query.vestYear !== '' ? parseInt(req.query.vestYear, 10) : 2024;
    if (!state || state.length !== 2 || isNaN(stepNumber)) {
      return res.status(400).json({ error: 'Invalid state or step number' });
    }
    let loaded = await loadDistrictPartyForStep(state, stepNumber, maxIterations, vestYear);
    if (loaded == null) {
      loaded = await computeDistrictPartyForStep(state, stepNumber, maxIterations, vestYear);
      if (loaded == null) {
        return res.status(404).json({ error: 'District party data not found. Ensure step is cached and tract party persistence has been run (POST /api/algorithm/tract-party-persistence).' });
      }
    }
    return res.json({ state, step: stepNumber, maxIterations, districts: loaded.districts, vestYear: loaded.vestYear });
  } catch (error) {
    console.error('❌ GET district-party error:', error);
    res.status(500).json({ error: 'Failed to load district party data', message: error.message });
  }
});

/**
 * POST /api/algorithm/district-party-for-group/:state
 * Compute and persist party % for a single district group. Body/query: finalStepNumber, maxIterations (optional), groupKey (e.g. "1-1").
 * Returns 202 when accepted.
 */
app.post('/api/algorithm/district-party-for-group/:state', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const finalStepNumber = parseInt(req.body?.finalStepNumber || req.query.finalStepNumber, 10);
    const maxIterations = parseInt(req.body?.maxIterations || req.query.maxIterations || '100', 10);
    const groupKey = (req.body?.groupKey || req.query.groupKey || '').trim();
    if (!state || state.length !== 2 || isNaN(finalStepNumber) || finalStepNumber < 0 || !groupKey) {
      return res.status(400).json({ error: 'state, finalStepNumber (>=0), and groupKey (e.g. "1-1" or "1-38") are required' });
    }
    const { getTractId } = require('./services/geodistrict-algorithm');
    const stepResult = await getStepCacheEntry(state, finalStepNumber, maxIterations);
    if (!stepResult) {
      return res.status(404).json({ error: 'Final step not found in cache' });
    }
    const districtGroups = stepResult.cachedEntry.stepData?.districtGroups ?? stepResult.cachedEntry.districtGroups ?? [];
    const group = districtGroups.find(g => `${g.startDistrictNumber}-${g.endDistrictNumber}` === groupKey);
    if (!group) {
      return res.status(404).json({ error: `District group ${groupKey} not found` });
    }
    const tractParty = await tractPartyPersistence.loadTractPartyForState(state, DEFAULT_VEST_YEAR);
    if (!tractParty || Object.keys(tractParty).length === 0) {
      return res.status(503).json({ error: 'Tract party data not found. Run POST /api/algorithm/tract-party-persistence first.' });
    }
    const tractIds = group.censusTractIds && group.censusTractIds.length > 0
      ? group.censusTractIds
      : (group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []);
    const uniqueGeoids = uniqueTractGeoids(tractIds);
    let votesDem = 0, votesRep = 0, totalVotes = 0;
    for (const geoid of uniqueGeoids) {
      const row = tractParty[geoid];
      if (row) {
        votesDem += row.votesDem || 0;
        votesRep += row.votesRep || 0;
        totalVotes += row.totalVotes || 0;
      }
    }
    // Use two-party total (D+R) as denominator so percentages are share of two-party vote and sum to 100%.
    const twoPartyTotal = votesDem + votesRep;
    const pctDem = twoPartyTotal > 0 ? votesDem / twoPartyTotal : 0;
    const pctRep = twoPartyTotal > 0 ? votesRep / twoPartyTotal : 0;
    const vestYear = DEFAULT_VEST_YEAR;
    const key = `district_party_${state}_${finalStepNumber}_${maxIterations}_${vestYear}`;
    let prev = await getCacheDoc(key) || {};
    if (!prev.districts && vestYear === 2024) {
      const legacy = await getCacheDoc(`district_party_${state}_${finalStepNumber}_${maxIterations}`) || {};
      if (legacy.districts) prev = legacy;
    }
    const districts = prev.districts && typeof prev.districts === 'object' ? { ...prev.districts } : {};
    districts[groupKey] = { pctDem, pctRep, votesDem, votesRep, totalVotes };
    const districtPartyDoc = {
      districts,
      state,
      step: finalStepNumber,
      maxIterations,
      vestYear,
      timestamp: Date.now(),
      ttl: null,
      version: CACHE_VERSION,
      source: 'district-party-job'
    };
    await setCacheDoc(key, districtPartyDoc);
    try {
      await cloudStorageCache.set(key, districtPartyDoc, {
        state,
        step: String(finalStepNumber),
        maxIterations: String(maxIterations),
        vestYear: String(vestYear)
      });
      console.log(`💾 District party: also wrote ${state} step ${finalStepNumber} to cloud storage`);
    } catch (cloudErr) {
      console.warn(`⚠️ District party: cloud write skipped for ${state}:`, cloudErr.message);
    }
    return res.json({ ok: true, groupKey, pctDem, pctRep, votesDem, votesRep, totalVotes });
  } catch (error) {
    console.error('❌ POST district-party-for-group error:', error);
    res.status(500).json({ error: 'District party for group failed', message: error.message });
  }
});

/**
 * POST /api/algorithm/step/:state/:stepNumber/union-polygon-for-group
 * Build and cache union polygon for a single district group. Query: groupKey (e.g. "1-1"), maxIterations (optional).
 * Returns 200 with updated group cache key or 202 if job is async.
 */
app.post('/api/algorithm/step/:state/:stepNumber/union-polygon-for-group', async (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase();
    const stepNum = parseInt(req.params.stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || req.body?.maxIterations || '100', 10);
    const groupKey = (req.query.groupKey || req.body?.groupKey || '').trim();
    if (!state || state.length !== 2 || isNaN(stepNum) || stepNum < 0 || !groupKey) {
      return res.status(400).json({ error: 'state, stepNumber, and groupKey (e.g. "1-1") are required' });
    }
    const currentVersion = ALGORITHM_VERSION;
    let stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    let doc = await getCacheDoc(stepCacheKey);
    let cachedEntry = doc || null;
    if (!cachedEntry || cachedEntry.algorithmVersion !== currentVersion) {
      stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      doc = await getCacheDoc(stepCacheKey);
      cachedEntry = doc || null;
    }
    if (!cachedEntry || !cachedEntry.stepData?.districtGroups?.length && !cachedEntry.districtGroups?.length) {
      return res.status(404).json({ error: 'Step not found or has no district groups' });
    }
    const dataToReconstruct = cachedEntry.stepData || cachedEntry;
    deserializeStepDataFromFirestore(dataToReconstruct);
    const tractCacheKey = cachedEntry.tractCacheKey || `state_tracts_${state}`;
    let stepData = dataToReconstruct;
    const isNormalized = cachedEntry.normalized;
    if (isNormalized && tractCacheKey) {
      const stateTractDoc = await getCacheDoc(tractCacheKey);
      if (!stateTractDoc) {
        return res.status(500).json({ error: 'State tract cache not found for reconstruction' });
      }
      const stateTractData = stateTractDoc;
      let tractMap = null;
      if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
        const cloud = await cloudStorageCache.get(tractCacheKey);
        if (cloud && cloud.data) tractMap = cloud.data;
      } else if (stateTractData.chunked && stateTractData.chunkKeys) {
        const chunkDocs = await Promise.all(stateTractData.chunkKeys.map(k => getCacheDoc(k)));
        tractMap = [];
        for (const c of chunkDocs) {
          if (c.exists && c.data().data) tractMap.push(...c.data().data);
        }
      } else if (stateTractData.data) {
        tractMap = stateTractData.data;
      }
      if (!tractMap) return res.status(500).json({ error: 'Tract data not available' });
      stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, false, state);
      if (!stepData?.districtGroups?.length) return res.status(500).json({ error: 'Reconstruction failed' });
    }
    const groups = stepData.districtGroups || [];
    const groupIndex = groups.findIndex(g => `${g.startDistrictNumber}-${g.endDistrictNumber}` === groupKey);
    if (groupIndex === -1) {
      return res.status(404).json({ error: `District group ${groupKey} not found in step` });
    }
    const singleGroup = groups[groupIndex];
    delete singleGroup.unionPolygon;
    delete singleGroup.unionPolygons;
    delete singleGroup.unionPolygonCacheKey;
    const recreated = await recreateUnionPolygonsForGroups([singleGroup], true, stepNum);
    if (!recreated || recreated.length === 0) {
      return res.status(500).json({ error: 'Failed to create union polygon for group' });
    }
    const unionPolygonCacheKeys = await cacheUnionPolygons(state, stepNum, recreated);
    const newCacheKey = unionPolygonCacheKeys[0];
    if (!newCacheKey) {
      return res.status(500).json({ error: 'Failed to cache union polygon' });
    }
    const entryToWrite = cachedEntry;
    const groupsToUpdate = entryToWrite.stepData?.districtGroups ?? entryToWrite.districtGroups ?? [];
    if (groupsToUpdate[groupIndex]) groupsToUpdate[groupIndex].unionPolygonCacheKey = newCacheKey;
    await setStepCache(stepCacheKey, entryToWrite);
    return res.json({ ok: true, groupKey, unionPolygonCacheKey: newCacheKey });
  } catch (error) {
    console.error('❌ POST union-polygon-for-group error:', error);
    res.status(500).json({ error: 'Union polygon for group failed', message: error.message });
  }
});

/**
 * Rehydrate algorithm state from step 0 cache when state doc is missing (e.g. cache write failed after step-by-step).
 * So "Next from step 0" works even if algorithm_state_* was never or no longer present.
 * @param {string} state - State code
 * @param {number} maxIterations - Max iterations
 * @returns {Promise<Object|null>} Algorithm state or null
 */
async function rehydrateAlgorithmStateFromStep0(state, maxIterations) {
  const step0CacheKey = `algorithm_step_${state}_${maxIterations}_0`;
  const { getTractId } = require('./services/geodistrict-algorithm');
  try {
    const doc = await getCacheDoc(step0CacheKey);
    if (!doc) return null;
    const cachedEntry = doc;
    if (isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) return null;
    if (cachedEntry.algorithmVersion !== ALGORITHM_VERSION) return null;

    let stepData = cachedEntry.stepData;
    if (!stepData || !stepData.districtGroups || stepData.districtGroups.length === 0) return null;
    deserializeStepDataFromFirestore(stepData);

    const fromCache = await loadTractsFromStateTractCache(state);
    if (!fromCache || !fromCache.tracts || fromCache.tracts.length === 0) return null;
    const tracts = fromCache.tracts;
    const tractCacheKey = cachedEntry.tractCacheKey || fromCache.tractCacheKey || `state_tracts_${state}`;

    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) return null;
    const totalStatePopulation = tracts.reduce((sum, t) => sum + (t.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    const uniqueTractIds = tracts.map(t => getTractId(t)).filter(Boolean);
    const firstGroup = stepData.districtGroups[0];
    const currentGroups = stepData.districtGroups.map(group => {
      const censusTractIds = group.censusTractIds && group.censusTractIds.length > 0
        ? group.censusTractIds
        : (group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []);
      return {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.endDistrictNumber,
        totalDistricts: group.totalDistricts,
        totalPopulation: group.totalPopulation,
        bounds: group.bounds,
        centroid: group.centroid,
        lastDivisionDirection: group.lastDivisionDirection ?? null,
        censusTractIds,
        unionPolygonCacheKey: group.unionPolygonCacheKey
      };
    });

    const algorithmState = {
      uniqueTractIds,
      tractCacheKey,
      currentGroups,
      iteration: 0,
      steps: [stepData],
      algorithmHistory: [],
      totalStatePopulation,
      targetDistrictPopulation,
      maxIterations,
      state
    };

    const stateKey = getAlgorithmStateKey(state, maxIterations);
    await cacheAlgorithmState(stateKey, algorithmState);
    console.log(`✅ NEXT-STEP: Rehydrated algorithm state for ${stateKey} from step 0 cache`);
    return algorithmState;
  } catch (err) {
    console.warn(`⚠️ NEXT-STEP: Rehydrate from step 0 failed: ${err.message}`);
    return null;
  }
}

/**
 * POST /api/algorithm/execute/next-step
 * Execute the next step of the algorithm
 * Caches step results for fast retrieval on subsequent requests
 */
app.post('/api/algorithm/execute/next-step', async (req, res) => {
  if (isAlgorithmPostDisabled()) {
    return res.status(503).json({ error: 'Algorithm execution is disabled (read-only mode). Use local backend for development.' });
  }
  console.log(`🚀 NEXT-STEP: POST /api/algorithm/execute/next-step called`);
  console.log(`   Request body:`, JSON.stringify(req.body));
  try {
    const { state, maxIterations = 100, options = {} } = req.body;

    if (!state) {
      console.error(`❌ NEXT-STEP: State is required but not provided`);
      return res.status(400).json({ error: 'State is required' });
    }

    console.log(`🔍 NEXT-STEP: Processing request for state: ${state}, maxIterations: ${maxIterations}`);
    const stateKey = getAlgorithmStateKey(state, maxIterations);
    console.log(`🔍 NEXT-STEP: Looking for algorithm state with key: ${stateKey}`);
    let algorithmState = await getCachedAlgorithmState(stateKey);

    if (!algorithmState) {
      console.log(`🔄 NEXT-STEP: Algorithm state not found, attempting rehydration from step 0 cache...`);
      algorithmState = await rehydrateAlgorithmStateFromStep0(state, maxIterations);
    }
    if (!algorithmState) {
      console.error(`❌ NEXT-STEP: Algorithm state not found for ${stateKey}. This may be a timing issue if state was just cached.`);
      return res.status(404).json({ error: 'Algorithm not initialized. Call /execute/step-by-step first.' });
    }
    
    console.log(`✅ NEXT-STEP: Found algorithm state for ${stateKey}, iteration: ${algorithmState.iteration}`);

    // Reconstruct uniqueTracts if needed (from uniqueTractIds)
    if (!algorithmState.uniqueTracts && algorithmState.uniqueTractIds) {
      algorithmState.uniqueTracts = await reconstructUniqueTracts(algorithmState);
    }

    if (!algorithmState.uniqueTracts || algorithmState.uniqueTracts.length === 0) {
      console.error(`❌ NEXT-STEP: No tracts available for ${stateKey} (tract cache missing or invalid). Use force refresh to regenerate.`);
      return res.status(400).json({
        error: 'State tract cache is missing or invalid (e.g. Cloud Storage file not found or bad geometry). In admin mode, click the trash icon to clear cache, then load step 0 again to regenerate.'
      });
    }

    // Reconstruct currentGroups with actual censusTracts from uniqueTracts if needed
    if (algorithmState.currentGroups && algorithmState.uniqueTracts) {
      const { getTractId } = require('./services/geodistrict-algorithm');
      // Build lookup map from uniqueTracts
      const tractLookup = new Map();
      for (const tract of algorithmState.uniqueTracts) {
        const tractId = getTractId(tract);
        if (tractId) {
          tractLookup.set(tractId, tract);
        }
      }
      
      // Reconstruct censusTracts for each group from censusTractIds
      algorithmState.currentGroups = algorithmState.currentGroups.map(group => {
        // If group already has censusTracts, return as-is
        if (group.censusTracts && Array.isArray(group.censusTracts) && group.censusTracts.length > 0) {
          return group;
        }
        
        // Otherwise, reconstruct from censusTractIds
        if (group.censusTractIds && Array.isArray(group.censusTractIds)) {
          const censusTracts = group.censusTractIds
            .map(id => tractLookup.get(id))
            .filter(Boolean);
          
          return {
            ...group,
            censusTracts
          };
        }
        
        // No censusTractIds either - return group as-is (will likely fail later)
        return group;
      });
      
      const totalReconstructed = algorithmState.currentGroups.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0);
      console.log(`✅ Reconstructed ${totalReconstructed} tracts across ${algorithmState.currentGroups.length} currentGroups`);
    }

    const nextStepNumber = algorithmState.iteration + 1;
    const forceInvalidate = options.forceInvalidate || false;
    const moveBalanceAfterStep = options.moveBalanceAfterStep === true;

    // Create cache key for this specific step
    const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${nextStepNumber}`;

    // Check cache first (unless forceInvalidate is true)
    if (!forceInvalidate) {
      try {
        const doc = await getCacheDoc(stepCacheKey);
        
        if (doc) {
          let cachedEntry = doc;
          
          // Check if expired
          if (cachedEntry && !isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
            // Check algorithm version
            const cachedVersion = cachedEntry.algorithmVersion;
            const currentVersion = ALGORITHM_VERSION;
            
            if (cachedVersion === currentVersion) {
                console.log(`✅ NEXT-STEP: Step ${nextStepNumber} cache HIT for ${state} - returning from cache (not re-executing)`);
              
              // Reconstruct step data with tract geometries from state cache if needed
              let stepData = cachedEntry.stepData;
              deserializeStepDataFromFirestore(stepData);
              // Ensure step number is set for reconstruction (union polygon load uses it)
              if (stepData && stepData.step === undefined && cachedEntry.step !== undefined) {
                stepData.step = cachedEntry.step;
              }
              
              // If normalized, reconstruct from state tract cache
              if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
                try {
                  // Fetch state-level tract cache
                  let stateTractCache;
                  const stateTractDoc = await getCacheDoc(cachedEntry.tractCacheKey);
                  
                  if (stateTractDoc) {
                    const stateTractData = stateTractDoc;
                    // Check if state tract cache version matches current algorithm version
                    const stateTractVersion = stateTractData.algorithmVersion;
                    if (stateTractVersion !== ALGORITHM_VERSION) {
                      console.log(`⚠️ State tract cache version mismatch (${stateTractVersion || 'none'} != ${ALGORITHM_VERSION}) for step ${nextStepNumber}, cannot reconstruct - will need to re-execute step`);
                      // Don't set stateTractCache, so we skip reconstruction
                    } else if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
                      stateTractCache = stateTractData;
                    } else {
                      console.log(`⚠️ State tract cache expired for step ${nextStepNumber}, cannot reconstruct - will need to re-execute step`);
                    }
                  } else {
                    console.log(`⚠️ State tract cache not found for step ${nextStepNumber}, cannot reconstruct - will need to re-execute step`);
                  }
                  
                  // Get tract map from cache (handle different storage formats)
                  let tractMap = null;
                  
                  // Handle Cloud Storage
                  if (stateTractCache && stateTractCache.cloudStorage && stateTractCache.cloudStoragePath) {
                    try {
                      const cloudStorageResult = await cloudStorageCache.get(cachedEntry.tractCacheKey);
                      if (cloudStorageResult && cloudStorageResult.data) {
                        tractMap = cloudStorageResult.data;
                      }
                    } catch (cloudError) {
                      console.warn(`⚠️ Failed to fetch from Cloud Storage: ${cloudError.message}`);
                    }
                  }
                  // Handle chunked Firestore
                  else if (stateTractCache && stateTractCache.chunked && stateTractCache.chunkKeys) {
                    console.log(`📦 Fetching ${stateTractCache.totalChunks} tract cache chunks...`);
                    const chunkPromises = stateTractCache.chunkKeys.map(chunkKey => 
                      getCacheDoc(chunkKey)
                    );
                    const chunkDocs = await Promise.all(chunkPromises);
                    
                    const allTracts = [];
                    for (const chunkDoc of chunkDocs) {
                      if (chunkDoc) {
                        const chunkData = chunkDoc;
                        if (chunkData.data && Array.isArray(chunkData.data)) {
                          allTracts.push(...chunkData.data);
                        }
                      }
                    }
                    tractMap = allTracts;
                  }
                  // Handle simple tractMap array
                  else if (stateTractCache && stateTractCache.tractMap) {
                    tractMap = stateTractCache.tractMap;
                  }
                  // Handle data array directly
                  else if (stateTractCache && stateTractCache.data && Array.isArray(stateTractCache.data)) {
                    tractMap = stateTractCache.data;
                  }
                  
                  // Reconstruct step with tract geometries
                  if (tractMap) {
                    stepData = await reconstructStepFromCache(stepData, tractMap, true, state);
                    const totalReconstructed = stepData.districtGroups?.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0) || 0;
                    if (totalReconstructed === 0) {
                      console.warn(`⚠️ Step ${nextStepNumber} reconstruction resulted in 0 tracts - cache may have wrong ID format, will need to re-execute`);
                      // Force re-execution by returning null or throwing
                      throw new Error('Reconstruction failed - 0 tracts found');
                    }
                  } else {
                    console.warn(`⚠️ No tractMap available for step ${nextStepNumber} reconstruction - will need to re-execute`);
                    throw new Error('No tractMap available for reconstruction');
                  }
                } catch (reconstructError) {
                  console.warn(`⚠️ Failed to reconstruct step ${nextStepNumber} from cache: ${reconstructError.message}, will re-execute`);
                  // Force re-execution by not returning cached data
                  throw reconstructError;
                }
              }
              
              // Update algorithm state to reflect this step was executed
              // We need to reconstruct the state from the cached step
              // Ensure steps array includes this step
              const updatedSteps = [...(algorithmState.steps || [])];
              // Pad array if needed
              while (updatedSteps.length <= nextStepNumber) {
                updatedSteps.push(null);
              }
              updatedSteps[nextStepNumber] = stepData;
              
              const updatedState = {
                ...algorithmState,
                iteration: nextStepNumber,
                currentGroups: stepData.districtGroups || algorithmState.currentGroups,
                steps: updatedSteps
              };
              
              // Only treat as algorithm complete (and delete state) when this step has union polygons cached.
              // Legacy step caches may have isComplete: true without unionPolygonsCached (e.g. fast path before fix).
              const trulyComplete = (cachedEntry.isComplete === true) && (cachedEntry.unionPolygonsCached === true);
              if (trulyComplete) {
                await deleteCachedAlgorithmState(stateKey);
                console.log(`✅ Algorithm completed after ${nextStepNumber} iterations (from cache)`);
              } else {
                await cacheAlgorithmState(stateKey, updatedState);
              }
              
              return res.json({
                step: nextStepNumber,
                data: stepData,
                isComplete: trulyComplete
              });
            } else {
              console.log(`🔄 STEP CACHE VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}, invalidating`);
              await deleteCacheDoc(stepCacheKey);
            }
          } else {
            console.log(`⏰ STEP CACHE EXPIRED: Cache expired for step ${nextStepNumber}, deleting`);
            await deleteCacheDoc(stepCacheKey);
          }
        }
      } catch (cacheError) {
        console.warn(`⚠️ STEP CACHE CHECK ERROR: ${cacheError.message}, proceeding with execution`);
      }
    }

    console.log(`🚀 NEXT-STEP: Step ${nextStepNumber} cache MISS for ${state} - executing step (not from cache)`);
    logger.info(`🚀 Executing next step for ${state} (iteration ${nextStepNumber})`);

    // Execute next step
    let step, updatedState, isComplete;
    ({ step, state: updatedState, isComplete } = await algorithmService.executeNextStep(algorithmState));

    // Optional: resolve isolation and balance after this step (when "Move/balance per step" is checked in UI)
    if (moveBalanceAfterStep && nextStepNumber > 0) {
      try {
        const { getTractId } = require('./services/geodistrict-algorithm');
        const allTracts = [];
        for (const g of step.districtGroups || []) {
          for (const t of g.censusTracts || []) {
            if (t && getTractId(t)) allTracts.push(t);
          }
        }
        let step0IslandSet = new Set();
        const step0 = updatedState.steps && updatedState.steps[0] ? updatedState.steps[0] : null;
        if (step0 && step0.islandTractsData) {
          const id = step0.islandTractsData;
          if (id.islandTractsByGroup) {
            for (const islandGroups of Object.values(id.islandTractsByGroup)) {
              if (Array.isArray(islandGroups)) {
                for (const group of islandGroups) {
                  if (Array.isArray(group)) group.forEach(tid => step0IslandSet.add(tid));
                  else if (typeof group === 'string') step0IslandSet.add(group);
                  else if (group && Array.isArray(group.tractIds)) group.tractIds.forEach(tid => step0IslandSet.add(tid));
                }
              }
            }
          }
          if (Array.isArray(id.excludedTractIds)) id.excludedTractIds.forEach(tid => step0IslandSet.add(tid));
        }
        const step0IslandTractIds = step0IslandSet.size > 0 ? step0IslandSet : null;

        const isFinalStep = step.districtGroups.length > 0 && step.districtGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
        let groups = step.districtGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));

        if (isFinalStep) {
          try {
            const s4DataLoader = require('./services/s4-data-loader');
            const stateForS4 = s4DataLoader.normalizeStateForS4(state);
            await s4DataLoader.loadS4AdjacencyData(stateForS4);
          } catch (s4Err) {
            console.warn(`⚠️ Failed to load S4 adjacency data for ${state}: ${s4Err.message}`);
          }
          const resolutionResult = algorithmService.resolveIsolationForFinalStep(groups, allTracts, step0IslandTractIds, nextStepNumber);
          groups = resolutionResult.districtGroups;
          const totalPopulation = groups.reduce((sum, g) => sum + (g.censusTracts || []).reduce((s, t) => s + (t.properties?.POPULATION || 0), 0), 0);
          const targetDistrictPopulation = totalPopulation / groups.length;
          groups = algorithmService.balanceDistrictsByVariance(groups, allTracts, targetDistrictPopulation);
          const maxAbsVariancePercent = (grps) => {
            let max = 0;
            for (const g of grps) {
              const pop = (g.censusTracts || []).reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
              const n = g.totalDistricts != null ? g.totalDistricts : (g.endDistrictNumber - g.startDistrictNumber + 1);
              const target = targetDistrictPopulation * n;
              if (target <= 0) continue;
              const v = Math.abs(((pop - target) / target) * 100);
              if (v > max) max = v;
            }
            return max;
          };
          const improvementThresholdPercent = 1.0;
          const resolveIsolated = () => {
            for (let isoIter = 0; isoIter < 10; isoIter++) {
              const isolationResult = algorithmService.detectIsolatedTracts(groups, allTracts, nextStepNumber, step0IslandSet);
              if (isolationResult.isolatedTractIds.size === 0) return;
              try {
                const moveResult = algorithmService.moveIsolatedComponentsByAdjacency(groups, allTracts, isolationResult, step0IslandSet);
                groups = moveResult.districtGroups;
                if (moveResult.unmovableTractIds && moveResult.unmovableTractIds.length > 0) {
                  moveResult.unmovableTractIds.forEach(id => step0IslandSet.add(id));
                }
                if (moveResult.movedTractCount === 0) return;
              } catch (moveErr) {
                console.warn(`Next-step move/balance: move isolated failed: ${moveErr.message}`);
                return;
              }
            }
          };
          resolveIsolated();
          const worstBeforeSecond = maxAbsVariancePercent(groups);
          groups = algorithmService.balanceDistrictsByVariance(groups, allTracts, targetDistrictPopulation);
          const worstAfterSecond = maxAbsVariancePercent(groups);
          if (worstBeforeSecond - worstAfterSecond >= improvementThresholdPercent) {
            resolveIsolated();
            groups = algorithmService.balanceDistrictsByVariance(groups, allTracts, targetDistrictPopulation);
          }
          step = { ...step, districtGroups: groups, isolatedTractsData: { isolatedTractsByGroup: {}, isolatedTractIds: [], totalIsolated: 0, groupsWithIsolation: 0 } };
          isComplete = true;
          const stepsCopy = [...(updatedState.steps || [])];
          while (stepsCopy.length <= nextStepNumber) stepsCopy.push(null);
          stepsCopy[nextStepNumber] = step;
          updatedState = { ...updatedState, currentGroups: groups, steps: stepsCopy };
          const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
          const districtPartyUrl = `${baseUrl}/api/algorithm/district-party/${state}?finalStepNumber=${nextStepNumber}&maxIterations=${maxIterations}`;
          setImmediate(() => {
            axios.post(districtPartyUrl, {}).then(() => {
              console.log(`✅ POST district-party accepted (202) for ${state} final step ${nextStepNumber} after next-step move/balance`);
            }).catch((err) => {
              console.error(`❌ Failed to trigger district-party job for ${state}:`, err.message);
            });
          });
          console.log(`✅ NEXT-STEP: Move/balance applied at final step ${nextStepNumber} for ${state}`);
        } else {
          const resolutionResult = algorithmService.resolveIsolationForStep(groups, allTracts, step.divisionLines || [], step0IslandTractIds, nextStepNumber);
          groups = resolutionResult.districtGroups;
          const divisionLinesForBalance = step.divisionLines || [];
          console.log(`🔧 NEXT-STEP: Running sibling-pair balance for ${divisionLinesForBalance.length} division lines (step ${nextStepNumber}, ${groups.length} groups)`);
          try {
            groups = algorithmService.balanceSiblingPairsAfterIsolatedMoves(groups, allTracts, divisionLinesForBalance);
            console.log(`✅ NEXT-STEP: Sibling-pair balance complete`);
          } catch (balanceErr) {
            console.warn(`⚠️ Sibling-pair balance failed: ${balanceErr.message}, using groups after resolve only`);
          }
          step = { ...step, districtGroups: groups };
          const stepsCopy = [...(updatedState.steps || [])];
          while (stepsCopy.length <= nextStepNumber) stepsCopy.push(null);
          stepsCopy[nextStepNumber] = step;
          updatedState = { ...updatedState, currentGroups: groups, steps: stepsCopy };
          console.log(`✅ NEXT-STEP: Move/balance applied at step ${nextStepNumber} for ${state}`);
        }
      } catch (moveBalanceErr) {
        console.warn(`⚠️ Move/balance after step ${nextStepNumber} failed: ${moveBalanceErr.message}, returning step without move/balance`);
        if (moveBalanceErr.stack) console.warn(moveBalanceErr.stack);
      }
    }

    // Cache the step result (await so step is durably recorded before response). Union polygons built async via job.
    const cacheStepResult = async () => {
      try {
        const tractCacheKey = `state_tracts_${state}`;
        const totalIsolated = step.isolatedTractsData?.totalIsolated ?? 0;
        const stepCompleteForUnions = isComplete && totalIsolated === 0 && nextStepNumber > 0;
        // Normalize step data (store tract IDs; no geometries). No union polygon cache keys yet.
        const normalizedStep = normalizeStepData(step, tractCacheKey);
        const cacheData = {
          stepData: normalizedStep.normalized,
          isComplete,
          algorithmVersion: ALGORITHM_VERSION,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          source: 'algorithm-step-cache',
          normalized: true,
          tractCacheKey,
          state,
          step: nextStepNumber,
          unionPolygonsCached: false
        };

        await setStepCache(stepCacheKey, cacheData);
        console.log(`💾 STEP CACHE STORED: Cached step ${nextStepNumber} for ${state} (union polygons built only when algorithm completes)`);
        if (stepCompleteForUnions && isComplete) {
          setImmediate(() => {
            const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
            const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${state}?finalStepNumber=${nextStepNumber}&maxIterations=${maxIterations}`;
            axios.post(buildAllUrl, {}).then(() => {
              console.log(`✅ POST build-all-union-polygons accepted (202) for ${state} final step ${nextStepNumber}`);
            }).catch((err) => {
              console.error(`❌ Failed to trigger build-all union polygon job for ${state}:`, err.message);
            });
          });
        }
      } catch (cacheError) {
        console.warn(`⚠️ STEP CACHE STORE ERROR: ${cacheError.message}`);
      }
    };
    
    await cacheStepResult();

    if (isComplete) {
      // Remove state from cache when complete
      await deleteCachedAlgorithmState(stateKey);
      console.log(`✅ Algorithm completed after ${updatedState.iteration} iterations`);
    } else {
      // Cache updated state
      await cacheAlgorithmState(stateKey, updatedState);
    }

    // Enrich step tracts with party data so client gets same coloring as after refresh (cache-hit path enriches via reconstructStepFromCache)
    step = await enrichStepTractsWithParty(step, state);

    res.json({
      step: updatedState.iteration,
      data: step,
      isComplete
    });
  } catch (error) {
    console.error('❌ Next step execution error:', error);
    res.status(500).json({
      error: 'Next step execution failed',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

/**
 * Remove all undefined values from an object (recursively)
 * Firestore doesn't allow undefined values
 * Also removes complex nested objects that Firestore can't store (like GeoJSON geometries)
 */
function removeUndefinedValues(obj, depth = 0) {
  // Prevent infinite recursion with depth limit
  if (depth > 10) {
    return null;
  }
  
  if (obj === null || obj === undefined) {
    return null;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item, depth + 1)).filter(item => item !== null && item !== undefined);
  }
  
  // Handle primitives
  if (typeof obj !== 'object') {
    return obj;
  }
  
  // Handle Date objects - convert to timestamp
  if (obj instanceof Date) {
    return obj.getTime();
  }
  
  // Skip complex nested objects that Firestore can't handle
  // Check for GeoJSON-like structures (objects with 'type' and 'geometry' or 'coordinates')
  if (obj.type && (obj.geometry || obj.coordinates)) {
    // This looks like a GeoJSON feature or geometry - skip it
    return null;
  }
  
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      const cleanedValue = removeUndefinedValues(value, depth + 1);
      if (cleanedValue !== undefined && cleanedValue !== null) {
        cleaned[key] = cleanedValue;
      }
    }
  }
  return cleaned;
}

/**
 * Resolve step cache entry: if Firestore doc has step data in Cloud Storage, fetch and return full payload.
 * @param {string} stepCacheKey - Document ID (e.g. algorithm_step_CA_100_1)
 * @param {object} firestoreData - Data from Firestore doc
 * @returns {Promise<object|null>} Full step cache entry (with stepData) or null
 */
async function resolveStepCacheEntry(stepCacheKey, firestoreData) {
  if (!firestoreData) return null;
  if (!firestoreData.cloudStorage || !firestoreData.cloudStoragePath) {
    return firestoreData;
  }
  try {
    const cloudResult = await cloudStorageCache.get(stepCacheKey);
    if (cloudResult && cloudResult.data) {
      return cloudResult.data;
    }
  } catch (err) {
    console.warn(`⚠️ Failed to load step cache from Cloud Storage (${stepCacheKey}): ${err.message}`);
  }
  return firestoreData;
}

/**
 * Write step cache. Uses setCacheDoc (local file when USE_LOCAL_CACHE, else Firestore/Cloud Storage).
 * @param {string} stepCacheKey - Document ID
 * @param {object} cacheData - Full step cache payload (stepData, unionPolygonsCached, etc.)
 * @returns {Promise<void>}
 */
async function setStepCache(stepCacheKey, cacheData) {
  await setCacheDoc(stepCacheKey, cacheData);
}

/**
 * Cache union polygons for a step's district groups in Cloud Storage
 * @param {string} stateCode - State code
 * @param {number} stepNumber - Step number
 * @param {Array} districtGroups - District groups with union polygons
 * @returns {Promise<Object>} Map of group indices to cache keys
 */
async function cacheUnionPolygons(stateCode, stepNumber, districtGroups) {
  const unionPolygonCacheKeys = {};
  const isStep0 = stepNumber === 0 || stepNumber === '0';

  for (let i = 0; i < districtGroups.length; i++) {
    const group = districtGroups[i];
    if (!group.unionPolygon && !group.unionPolygons) {
      continue; // Skip groups without union polygons
    }

    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;

    // Step 0: use shared state boundary key (same as All-states map). Skip write - already in Cloud Storage.
    if (isStep0 && group.unionPolygonCacheKey && group.unionPolygonCacheKey.startsWith('state_boundary_polygon_')) {
      unionPolygonCacheKeys[i] = group.unionPolygonCacheKey;
      console.log(`💾 STEP 0: Using shared state boundary key (${group.unionPolygonCacheKey}) - no duplicate write`);
      continue;
    }

    const unionCacheKey = `union_polygon_${stateCode}_${stepNumber}_${groupKey}`;

    try {
      let unionData = group.unionPolygons || (group.unionPolygon ? [group.unionPolygon] : null);

      // Normalize single Polygon to MultiPolygon so cached union polygons have consistent geometry type (fixes TX 33 etc.)
      if (unionData && unionData.length === 1 && unionData[0]?.geometry?.type === 'Polygon') {
        const f = unionData[0];
        unionData = [{
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: [f.geometry.coordinates] },
          properties: f.properties || {}
        }];
      }

      if (isStep0) {
        const hasArray = Array.isArray(group.unionPolygons);
        const polygonCount = Array.isArray(unionData) ? unionData.length : (unionData ? 1 : 0);
        console.log(`🔍 STEP 0: Caching TIGER state boundary - Group ${groupKey} - will cache: ${polygonCount} TIGER state boundary/ies`);
      }

      if (unionData) {
        const unionSize = JSON.stringify(unionData).length;
        const unionSizeMB = (unionSize / (1024 * 1024)).toFixed(2);

        const cloudStoragePath = await cloudStorageCache.set(unionCacheKey, unionData, {
          state: stateCode,
          step: stepNumber.toString(),
          group: groupKey,
          source: 'union-polygon-cache',
          polygonCount: Array.isArray(unionData) ? unionData.length.toString() : '1'
        });
        console.log(`💾 CLOUD STORAGE: Union polygon written for ${stateCode} step ${stepNumber} group ${groupKey} -> ${cloudStoragePath}`);

        const metadataEntry = {
          cloudStoragePath: cloudStoragePath,
          timestamp: Date.now(),
          ttl: null,
          version: CACHE_VERSION,
          source: isStep0 ? 'tiger-state-boundary' : 'union-polygon-cache-metadata',
          tigerBased: isStep0,
          attribution: isStep0
            ? `TIGER state boundary for ${stateCode} step ${stepNumber} group ${groupKey}`
            : `Union polygon(s) for ${stateCode} step ${stepNumber} group ${groupKey}`,
          chunked: false,
          cloudStorage: true,
          state: stateCode,
          step: stepNumber,
          group: groupKey,
          polygonCount: Array.isArray(unionData) ? unionData.length : 1,
          size: unionSize,
          sizeMB: parseFloat(unionSizeMB)
        };

        if (USE_LOCAL_CACHE) {
          await localCache.setCache(unionCacheKey, { ...metadataEntry, data: unionData }, null);
        } else {
          await setCacheDoc(unionCacheKey, metadataEntry);
        }
        unionPolygonCacheKeys[i] = unionCacheKey;

        const polygonCount = Array.isArray(unionData) ? unionData.length : 1;
        const sourceLabel = isStep0 ? 'TIGER state boundary' : 'union polygon(s)';
        console.log(`💾 CLOUD STORAGE: Cached ${polygonCount} ${sourceLabel} for ${stateCode} step ${stepNumber} group ${groupKey} (${unionSizeMB} MB)${polygonCount > 1 ? ` - main + ${polygonCount - 1} island(s)` : ''}`);
      }
    } catch (error) {
      console.error(`❌ Failed to cache union polygon for ${stateCode} step ${stepNumber} group ${groupKey}:`, error.message);
    }
  }

  return unionPolygonCacheKeys;
}

/**
 * Load union polygons from cache for a step's district groups
 * @param {string} stateCode - State code
 * @param {number} stepNumber - Step number
 * @param {Array} districtGroups - District groups (normalized, with cache keys)
 * @param {{ unionPolygonsCached?: boolean }} [options] - When unionPolygonsCached is false, skip Cloud Storage (step not known to have polygons cached)
 * @returns {Promise<Array>} District groups with union polygons loaded
 */
async function loadUnionPolygonsFromCache(stateCode, stepNumber, districtGroups, options = {}) {
  if (options.unionPolygonsCached === false) {
    return [...districtGroups];
  }
  const groupsWithUnions = [];
  const isStep0 = stepNumber === 0 || stepNumber === '0';

  for (let i = 0; i < districtGroups.length; i++) {
    const group = districtGroups[i];
    let unionCacheKey = group.unionPolygonCacheKey;
    
    // If no cache key, try to generate one from group info (for old cached data that doesn't have the key)
    if (!unionCacheKey && group.startDistrictNumber && group.endDistrictNumber) {
      const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
      unionCacheKey = `union_polygon_${stateCode}_${stepNumber}_${groupKey}`;
    }
    
    if (!unionCacheKey) {
      // No cache key and can't generate one - group doesn't have cached union polygon
      groupsWithUnions.push(group);
      continue;
    }
    
    // Validate cache key matches requested state
    // Cache key format: union_polygon_{stateCode}_{stepNumber}_{groupKey}
    const cacheKeyStateMatch = unionCacheKey.match(/union_polygon_([A-Z]{2})_/);
    if (cacheKeyStateMatch && cacheKeyStateMatch[1] !== stateCode) {
      console.error(`❌ UNION POLYGON STATE MISMATCH: Cache key '${unionCacheKey}' contains state '${cacheKeyStateMatch[1]}' but requested state is '${stateCode}'. Skipping this union polygon.`);
      groupsWithUnions.push(group);
      continue;
    }
    
    try {
      // Check metadata first to determine if this is TIGER-based or tract-based
      const unionCacheDoc = await getCacheDoc(unionCacheKey);
      let isTigerBased = false;
      let polygonType = 'unknown';
      
      if (unionCacheDoc) {
        const metadata = unionCacheDoc;
        isTigerBased = metadata.tigerBased === true || metadata.source === 'tiger-state-boundary';
        polygonType = isTigerBased ? 'TIGER state boundary' : 'tract-based union polygon';
      } else {
        // No metadata - assume it's an old tract-based union polygon
        polygonType = 'tract-based union polygon (no metadata)';
      }
      
      // For Step 0, reject tract-based union polygons and require TIGER boundaries
      if (isStep0 && !isTigerBased) {
        console.log(`🔄 STEP 0: Detected old ${polygonType}, invalidating and will fetch TIGER state boundary`);
        try {
          // Delete old union polygon from Cloud Storage
          await cloudStorageCache.delete(unionCacheKey);
          // Delete metadata from Firestore
          await deleteCacheDoc(unionCacheKey);
          console.log(`🗑️ STEP 0: Deleted old ${polygonType} cache`);
        } catch (deleteError) {
          console.warn(`⚠️ STEP 0: Failed to delete old union polygon cache: ${deleteError.message}`);
        }
        // Clear cache key and union polygon properties so caller knows to fetch TIGER boundaries
        unionCacheKey = null;
        group.unionPolygonCacheKey = undefined;
        group.unionPolygon = undefined;
        group.unionPolygons = undefined;
        groupsWithUnions.push(group);
        continue;
      }
      
      // Load: prefer local blob (doc.data) when present, else Cloud Storage
      if (unionCacheKey) {
        let unionData = null;
        if (unionCacheDoc && unionCacheDoc.data !== undefined) {
          unionData = unionCacheDoc.data;
        } else {
          const cacheResult = await cloudStorageCache.get(unionCacheKey);
          if (cacheResult && cacheResult.data) unionData = cacheResult.data;
        }

        if (unionData) {
          // Ensure each item is a GeoJSON Feature (cache may contain raw Polygon/MultiPolygon geometry)
          const toFeature = (item) => {
            if (!item) return null;
            if (item.type === 'Feature' && item.geometry) return item;
            if ((item.type === 'Polygon' || item.type === 'MultiPolygon') && item.coordinates) {
              return { type: 'Feature', geometry: { type: item.type, coordinates: item.coordinates }, properties: {} };
            }
            return item;
          };
          const rawList = Array.isArray(unionData) ? unionData : [unionData];
          const features = rawList.map(toFeature).filter(Boolean);
          if (features.length > 0) {
            group.unionPolygons = features;
            group.unionPolygon = features[0];
          }

          // Store the cache key for future reference
          group.unionPolygonCacheKey = unionCacheKey;

          // Log with clear indication of source
          const polygonCount = features.length;
          const sourceLabel = isTigerBased ? 'TIGER state boundary' : 'tract-based union polygon';
          const sizeMB = unionCacheDoc && unionCacheDoc.sizeMB != null ? unionCacheDoc.sizeMB : 'unknown';
          const source = unionCacheDoc && unionCacheDoc.data !== undefined ? 'LOCAL CACHE' : 'CLOUD STORAGE';
          const geomType = group.unionPolygon && group.unionPolygon.geometry ? group.unionPolygon.geometry.type : '?';
          console.log(`✅ ${source}: Loaded ${polygonCount} ${sourceLabel} from cache for ${stateCode} step ${stepNumber} group ${group.startDistrictNumber}-${group.endDistrictNumber} (${sizeMB} MB, geometry: ${geomType})`);
        } else {
          // Cache miss (e.g. GCS deleted): clear so UI shows "missing" and Build Polygons button appears
          console.warn(`⚠️ Union polygon cache not found for key: ${unionCacheKey} - clearing group union data`);
          group.unionPolygonCacheKey = undefined;
          group.unionPolygon = undefined;
          group.unionPolygons = undefined;
        }
      }
    } catch (error) {
      console.error(`❌ Failed to load union polygon from cache for key ${unionCacheKey}:`, error.message);
    }
    
    groupsWithUnions.push(group);
  }
  
  return groupsWithUnions;
}

/**
 * Firestore does not allow arrays containing arrays. islandTractsData.islandTractsByGroup
 * is { [groupIndex]: string[][] }. Convert to { [groupIndex]: Array<{ tractIds: string[] }> } for storage.
 */
function serializeIslandTractsDataForFirestore(islandTractsData) {
  if (!islandTractsData || !islandTractsData.islandTractsByGroup) return undefined;
  const byGroup = islandTractsData.islandTractsByGroup;
  const serialized = {};
  for (const [key, islandGroups] of Object.entries(byGroup)) {
    if (!Array.isArray(islandGroups)) continue;
    serialized[key] = islandGroups.map((group) =>
      Array.isArray(group) ? { tractIds: group } : { tractIds: [group] }
    );
  }
  const result = {
    islandTractsByGroup: serialized,
    totalIslandTracts: islandTractsData.totalIslandTracts,
    totalIslandGroups: islandTractsData.totalIslandGroups,
    groupsWithIslands: islandTractsData.groupsWithIslands
  };
  if (Array.isArray(islandTractsData.excludedTractIds)) {
    result.excludedTractIds = islandTractsData.excludedTractIds;
  }
  return result;
}

/**
 * Restore islandTractsData from Firestore-safe shape to runtime shape (array-of-arrays per group).
 */
function deserializeIslandTractsDataFromFirestore(islandTractsData) {
  if (!islandTractsData || !islandTractsData.islandTractsByGroup) return islandTractsData;
  const byGroup = islandTractsData.islandTractsByGroup;
  const restored = {};
  for (const [key, arr] of Object.entries(byGroup)) {
    if (!Array.isArray(arr)) continue;
    restored[key] = arr.map((item) => {
      if (item && Array.isArray(item.tractIds)) return item.tractIds;
      if (Array.isArray(item)) return item; // legacy or already runtime shape
      return item ? [item] : [];
    });
  }
  const result = { ...islandTractsData, islandTractsByGroup: restored };
  if (Array.isArray(islandTractsData.excludedTractIds)) {
    result.excludedTractIds = islandTractsData.excludedTractIds;
  }
  return result;
}

/**
 * Firestore-safe serialize dgAdjacentGroupsByGroup: each component becomes { tractIds: string[] }.
 */
function serializeDgAdjacentGroupsByGroupForFirestore(dgAdjacentGroupsByGroup) {
  if (!dgAdjacentGroupsByGroup || typeof dgAdjacentGroupsByGroup !== 'object') return undefined;
  const serialized = {};
  for (const [key, components] of Object.entries(dgAdjacentGroupsByGroup)) {
    if (!Array.isArray(components)) continue;
    serialized[key] = components.map(comp =>
      Array.isArray(comp) ? { tractIds: comp } : (comp && comp.tractIds ? comp : { tractIds: [comp] })
    );
  }
  return Object.keys(serialized).length > 0 ? serialized : undefined;
}

/**
 * Restore dgAdjacentGroupsByGroup from Firestore shape to array-of-arrays per group.
 */
function deserializeDgAdjacentGroupsByGroupFromFirestore(dgAdjacentGroupsByGroup) {
  if (!dgAdjacentGroupsByGroup || typeof dgAdjacentGroupsByGroup !== 'object') return undefined;
  const restored = {};
  for (const [key, arr] of Object.entries(dgAdjacentGroupsByGroup)) {
    if (!Array.isArray(arr)) continue;
    restored[key] = arr.map((item) => {
      if (item && Array.isArray(item.tractIds)) return item.tractIds;
      if (Array.isArray(item)) return item;
      return item ? [item] : [];
    });
  }
  return Object.keys(restored).length > 0 ? restored : undefined;
}

/**
 * When stepData was read from Firestore, restore any Firestore-safe fields to runtime shapes.
 * Call after cachedEntry.stepData before using in algorithm or API responses.
 */
function deserializeStepDataFromFirestore(stepData) {
  if (!stepData) return stepData;
  if (stepData.islandTractsData) {
    stepData.islandTractsData = deserializeIslandTractsDataFromFirestore(stepData.islandTractsData);
  }
  if (stepData.dgAdjacentGroupsByGroup) {
    stepData.dgAdjacentGroupsByGroup = deserializeDgAdjacentGroupsByGroupFromFirestore(stepData.dgAdjacentGroupsByGroup);
  }
  return stepData;
}

/**
 * Normalize step data for caching (extract tract IDs, reference existing state tract cache)
 * Removes all nested GeoJSON geometries and complex objects that Firestore can't store
 */
function normalizeStepData(step, tractCacheKey) {
  if (!step || !step.districtGroups) {
    return { normalized: removeUndefinedValues(step) };
  }

  const { getTractId } = require('./services/geodistrict-algorithm');

  // Create normalized step with only tract IDs
  // Tract geometries are already stored in state-level cache from initialization
  const normalized = {
    step: step.step,
    level: step.level,
    description: step.description,
    totalGroups: step.totalGroups,
    totalDistricts: step.totalDistricts,
    divisionDirection: step.divisionDirection,
    divisionLine: step.divisionLine,
    // Preserve state field if present (important for reconstruction validation)
    state: step.state || undefined,
    // Normalize divisionLines - keep only simple properties, remove any nested geometries
    divisionLines: step.divisionLines ? step.divisionLines.map(line => ({
      line: line.line,
      direction: line.direction,
      parentGroup: line.parentGroup ? {
        startDistrictNumber: line.parentGroup.startDistrictNumber,
        endDistrictNumber: line.parentGroup.endDistrictNumber,
        totalDistricts: line.parentGroup.totalDistricts
      } : undefined,
      ratio: line.ratio,
      intersectingTractIds: line.intersectingTractIds,
      siblingGroups: line.siblingGroups ? line.siblingGroups.map(sibling => ({
        startDistrictNumber: sibling.startDistrictNumber,
        endDistrictNumber: sibling.endDistrictNumber,
        totalDistricts: sibling.totalDistricts
      })) : undefined,
      step: line.step // Preserve step number for finding most recent division
    })) : step.divisionLines,
    // Preserve isolated tracts data if present (shape is already Firestore-safe: object of string[])
    isolatedTractsData: step.isolatedTractsData || undefined,
    // Step-level excluded tract IDs (unmovable tracts treated as islands for this step)
    excludedTractIds: Array.isArray(step.excludedTractIds) ? step.excludedTractIds : undefined,
    // Step-0 island tracts: use Firestore-safe shape (no array-of-arrays)
    islandTractsData: serializeIslandTractsDataForFirestore(step.islandTractsData),
    // Connected components per group: Firestore-safe shape (array of { tractIds } per group)
    dgAdjacentGroupsByGroup: serializeDgAdjacentGroupsByGroupForFirestore(step.dgAdjacentGroupsByGroup),
    districtGroups: step.districtGroups.map((group, index) => {
      const normalizedGroup = {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.endDistrictNumber,
        totalDistricts: group.totalDistricts,
        totalPopulation: group.totalPopulation,
        bounds: group.bounds, // Simple object with numbers
        centroid: group.centroid, // Simple object with numbers
        lastDivisionDirection: group.lastDivisionDirection ?? null,
        censusTractIds: group.censusTracts ? group.censusTracts.map(t => getTractId(t)).filter(Boolean) : []
      };
      
      // Store union polygon cache key if it exists (set during caching)
      if (group.unionPolygonCacheKey) {
        normalizedGroup.unionPolygonCacheKey = group.unionPolygonCacheKey;
      }
      
      // Explicitly exclude unionPolygon, unionPolygons, and censusTracts (they contain nested GeoJSON that Firestore can't store)
      // Don't set to undefined - Firestore doesn't allow undefined
      return normalizedGroup;
    })
  };
  
  // Remove all undefined values before returning (Firestore doesn't allow undefined)
  return {
    normalized: removeUndefinedValues(normalized)
  };
}

/**
 * Invalidate all step caches for a given state
 * Deletes all step caches (step 0 and all subsequent steps) for the state/algorithm
 * This is used when forceInvalidate is true to ensure a fresh start
 */
async function invalidateAllStepCaches(state, maxIterations) {
  const currentVersion = ALGORITHM_VERSION;
  let deletedCount = 0;

  if (USE_LOCAL_CACHE) {
    for (let stepNum = 0; stepNum <= 100; stepNum++) {
      try {
        const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
        const doc = await getCacheDoc(stepCacheKey);
        if (doc) { await deleteCacheDoc(stepCacheKey); deletedCount++; }
      } catch (e) { /* continue */ }
      try {
        const runAllCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
        const doc = await getCacheDoc(runAllCacheKey);
        if (doc) { await deleteCacheDoc(runAllCacheKey); deletedCount++; }
      } catch (e) { /* continue */ }
    }
    console.log(`🗑️ Invalidated ${deletedCount} step cache(s) (all steps) for ${state}`);
    return;
  }

  try {
    const stepCacheQuery = getFirestore().collection('census_cache')
      .where('state', '==', state);
    
    const stepCacheSnapshot = await stepCacheQuery.get();
    for (const doc of stepCacheSnapshot.docs) {
      const cacheKey = doc.id;
      const data = doc.data();
      
      // Check if this is a step cache (either algorithm-step-cache or step-cache source)
      if (data.source === 'algorithm-step-cache' || data.source === 'step-cache') {
        // Check if this matches our state and algorithm version
        if (data.algorithmVersion === currentVersion) {
          // Check if it's a step cache by matching the cache key pattern
          const algorithmStepMatch = cacheKey.match(/algorithm_step_(\w+)_(\d+)_(\d+)/);
          const runAllStepMatch = cacheKey.match(/step_(\w+)_(\d+)_(.+)/);
          
          if (algorithmStepMatch && algorithmStepMatch[1] === state && parseInt(algorithmStepMatch[2]) === maxIterations) {
            await deleteCacheDoc(doc.id);
            deletedCount++;
          } else if (runAllStepMatch && runAllStepMatch[1] === state) {
            await deleteCacheDoc(doc.id);
            deletedCount++;
          }
        }
      }
    }
    
    // Also use fallback method to ensure we catch all step caches
    // Delete algorithm_step format
    for (let stepNum = 0; stepNum <= 100; stepNum++) {
      const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
      try {
        const doc = await getCacheDoc(stepCacheKey);
        if (doc) {
          await deleteCacheDoc(stepCacheKey);
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
      
      // Delete step_ format (Run All Steps) - try current version
      const runAllCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      try {
        const doc = await getCacheDoc(runAllCacheKey);
        if (doc) {
          await deleteCacheDoc(runAllCacheKey);
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
    }
    
    console.log(`🗑️ Invalidated ${deletedCount} step cache(s) (all steps) for ${state}`);
  } catch (queryError) {
    console.warn(`⚠️ Failed to query and invalidate all step caches: ${queryError.message}`);
    // Fallback: try to delete steps 0-100 for both cache formats
    let deletedCount = 0;
    const currentVersion = ALGORITHM_VERSION;
    for (let stepNum = 0; stepNum <= 100; stepNum++) {
      // Delete algorithm_step format
      const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
      try {
        const doc = await getCacheDoc(stepCacheKey);
        if (doc) {
          await deleteCacheDoc(stepCacheKey);
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
      
      // Delete step_ format (Run All Steps)
      const runAllCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      try {
        const doc = await getCacheDoc(runAllCacheKey);
        if (doc) {
          await deleteCacheDoc(runAllCacheKey);
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
    }
    console.log(`🗑️ Invalidated ${deletedCount} step cache(s) (steps 0-100) for ${state} using fallback method`);
  }
}

/**
 * Invalidate all subsequent step caches for a given step
 * Uses Firestore query to find and delete all step caches for the state/algorithm
 */
async function invalidateSubsequentStepCaches(state, maxIterations, step) {
  if (USE_LOCAL_CACHE) {
    let deletedCount = 0;
    for (let nextStep = step + 1; nextStep <= 100; nextStep++) {
      try {
        const nextStepCacheKey = `algorithm_step_${state}_${maxIterations}_${nextStep}`;
        const doc = await getCacheDoc(nextStepCacheKey);
        if (doc) { await deleteCacheDoc(nextStepCacheKey); deletedCount++; }
      } catch (e) { /* continue */ }
    }
    console.log(`🗑️ Invalidated ${deletedCount} subsequent step cache(s) (steps ${step + 1}+) for ${state}`);
    return;
  }

  try {
    const stepCacheQuery = getFirestore().collection('census_cache')
      .where('source', '==', 'algorithm-step-cache');
    
    const stepCacheSnapshot = await stepCacheQuery.get();
    let deletedCount = 0;
    for (const doc of stepCacheSnapshot.docs) {
      const cacheKey = doc.id;
      const data = doc.data();
      // Check if this is a step cache for this state/algorithm and step number > step
      const stepMatch = cacheKey.match(/algorithm_step_(\w+)_(\d+)_(\d+)/);
      if (stepMatch && stepMatch[1] === state && parseInt(stepMatch[2]) === maxIterations) {
        const stepNum = parseInt(stepMatch[3]);
        if (stepNum > step) {
          await deleteCacheDoc(doc.id);
          deletedCount++;
        }
      }
    }
    console.log(`🗑️ Invalidated ${deletedCount} subsequent step cache(s) (steps ${step + 1}+) for ${state}`);
  } catch (queryError) {
    console.warn(`⚠️ Failed to query and invalidate subsequent step caches: ${queryError.message}`);
    // Fallback: try to delete steps up to a reasonable limit (e.g., 100)
    let deletedCount = 0;
    for (let nextStep = step + 1; nextStep <= 100; nextStep++) {
      const nextStepCacheKey = `algorithm_step_${state}_${maxIterations}_${nextStep}`;
      try {
        await deleteCacheDoc(nextStepCacheKey);
        deletedCount++;
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
    }
    console.log(`🗑️ Invalidated ${deletedCount} subsequent step cache(s) (steps ${step + 1} to 100) for ${state} using fallback method`);
  }
}

/**
 * Delete tract and polygon cache for a state (local and optionally Cloud Storage).
 * Removes: state_tracts_{state}, tract_boundaries for state, tract_data for each county.
 * Use before reloading a state so data is refetched from Census/TIGER.
 * @param {string} state - 2-letter state code
 * @param {{ deleteCloud?: boolean, baseUrl?: string }} options - baseUrl used to fetch counties list (self-call)
 * @returns {Promise<{ localDeleted: number, cloud?: { stateTracts: boolean, boundaries: boolean } }>}
 */
async function deleteTractAndPolygonCacheForState(state, options = {}) {
  const { deleteCloud = true, baseUrl } = options;
  const stateNorm = (state || '').toUpperCase().trim();
  let localDeleted = 0;

  // 1. Local: state tract cache
  const tractCacheKey = `state_tracts_${stateNorm}`;
  try {
    const doc = await getCacheDoc(tractCacheKey);
    if (doc) {
      await deleteCacheDoc(tractCacheKey);
      localDeleted++;
    }
  } catch (e) { /* ignore */ }

  // 2. Local: tract boundaries (key is hashed from { state })
  const boundariesCacheKey = generateCacheKey('tract_boundaries', { state: stateNorm });
  try {
    const doc = await getCacheDoc(boundariesCacheKey);
    if (doc) {
      await deleteCacheDoc(boundariesCacheKey);
      localDeleted++;
    }
  } catch (e) { /* ignore */ }

  // 3. Local: tract_data per county (need county list)
  if (baseUrl) {
    try {
      const countiesRes = await axios.get(`${baseUrl}/api/census/counties?state=${stateNorm}`);
      const counties = countiesRes.data || [];
      for (const c of counties) {
        const countyFips = c.fips || c.COUNTY || c.county;
        if (!countyFips) continue;
        const tractDataKey = generateCacheKey('tract_data', { state: stateNorm, county: countyFips });
        try {
          const doc = await getCacheDoc(tractDataKey);
          if (doc) {
            await deleteCacheDoc(tractDataKey);
            localDeleted++;
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn(`⚠️ Could not fetch counties for ${stateNorm} to clear tract_data: ${e.message}`);
    }
  }

  let cloudResult;
  if (deleteCloud) {
    try {
      cloudResult = await cloudStorageCache.deleteStateTractAndBoundariesFiles(stateNorm);
    } catch (e) {
      console.warn(`⚠️ Cloud Storage delete for ${stateNorm}: ${e.message}`);
      cloudResult = { stateTracts: false, boundaries: false };
    }
  }

  console.log(`🗑️ CLEAR-STATE-CACHE: ${stateNorm} local=${localDeleted}${cloudResult ? ` cloud(stateTracts=${cloudResult.stateTracts}, boundaries=${cloudResult.boundaries})` : ''}`);
  return { localDeleted, ...(cloudResult && { cloud: cloudResult }) };
}

/**
 * Delete all algorithm cache for a state (trash/clear-cache).
 * Removes step 0..N, algorithm state, and union polygons from Firestore and Cloud Storage.
 * Does NOT touch external data (tract boundaries, census tract data, state tract cache).
 */
async function deleteAlgorithmCacheForState(state, maxIterations) {
  const stateNorm = (state || '').toUpperCase().trim();
  const stateKey = getAlgorithmStateKey(stateNorm, maxIterations);
  const currentVersion = ALGORITHM_VERSION;
  let firestoreDeleted = 0;

  // 1. Delete all step docs: algorithm_step_{state}_{maxIterations}_* (never state_tracts_*)
  for (let stepNum = 0; stepNum <= 100; stepNum++) {
    const stepCacheKey = `algorithm_step_${stateNorm}_${maxIterations}_${stepNum}`;
    try {
      const doc = await getCacheDoc(stepCacheKey);
      if (doc) {
        await deleteCacheDoc(stepCacheKey);
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
    const runAllKey = `step_${stateNorm}_${stepNum}_${currentVersion}`;
    try {
      const doc = await getCacheDoc(runAllKey);
      if (doc) {
        await deleteCacheDoc(runAllKey);
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }
  // Explicit: do not delete state_tracts_{state} — that is census/original-source data, not algorithm cache

  // 2. Delete algorithm state (Firestore + Cloud Storage)
  await deleteCachedAlgorithmState(stateKey);
  firestoreDeleted++; // count as one logical delete

  // 3. List union polygon keys, delete cache docs and (when not local) Cloud Storage files
  if (USE_LOCAL_CACHE) {
    const allKeys = await listCacheDocIds(`union_polygon_${stateNorm}_`);
    for (const key of allKeys) {
      if (key.startsWith('state_tracts_')) continue; // Never delete census tract cache (original-source data)
      try {
        const doc = await getCacheDoc(key);
        if (doc) { await deleteCacheDoc(key); firestoreDeleted++; }
      } catch (e) { /* continue */ }
    }
    console.log(`🗑️ CLEAR-CACHE: Deleted algorithm cache for ${stateNorm}: ${firestoreDeleted} local doc(s) (state_tracts preserved)`);
    return { firestoreDeleted, cloudDeleted: 0 };
  }
  const unionKeys = await cloudStorageCache.listUnionPolygonKeysForState(stateNorm, 0);
  for (const key of unionKeys) {
    try {
      const d = await getCacheDoc(key);
      if (d) { await deleteCacheDoc(key); firestoreDeleted++; }
    } catch (e) { /* continue */ }
  }
  const cloudResult = await cloudStorageCache.deleteUnionPolygonsForState(stateNorm, 0);
  console.log(`🗑️ CLEAR-CACHE: Deleted algorithm cache for ${stateNorm}: ${firestoreDeleted} Firestore doc(s), ${cloudResult.deleted} Cloud Storage union file(s)`);
  return { firestoreDeleted, cloudDeleted: cloudResult.deleted };
}

/**
 * Delete algorithm cache from step 1 onward and algorithm state (restart).
 * Keeps step 0 and its union polygon. Caller should then set algorithm state to iteration 0.
 */
async function deleteAlgorithmCacheFromStep1ForState(state, maxIterations) {
  const stateNorm = (state || '').toUpperCase().trim();
  const stateKey = getAlgorithmStateKey(stateNorm, maxIterations);
  const currentVersion = ALGORITHM_VERSION;
  let firestoreDeleted = 0;

  // 1. Delete step docs for step >= 1 only
  for (let stepNum = 1; stepNum <= 100; stepNum++) {
    const stepCacheKey = `algorithm_step_${stateNorm}_${maxIterations}_${stepNum}`;
    try {
      const doc = await getCacheDoc(stepCacheKey);
      if (doc) {
        await deleteCacheDoc(stepCacheKey);
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
    const runAllKey = `step_${stateNorm}_${stepNum}_${currentVersion}`;
    try {
      const doc = await getCacheDoc(runAllKey);
      if (doc) {
        await deleteCacheDoc(runAllKey);
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }

  // 2. Delete algorithm state (Firestore + Cloud Storage)
  await deleteCachedAlgorithmState(stateKey);
  firestoreDeleted++;

  // 3. List union polygon keys (step >= 1), delete cache docs and (when not local) Cloud files
  if (USE_LOCAL_CACHE) {
    const allKeys = await listCacheDocIds(`union_polygon_${stateNorm}_`);
    for (const key of allKeys) {
      const stepMatch = key.match(/union_polygon_\w+_(\d+)_/);
      if (stepMatch && parseInt(stepMatch[1], 10) >= 1) {
        try {
          const d = await getCacheDoc(key);
          if (d) { await deleteCacheDoc(key); firestoreDeleted++; }
        } catch (e) { /* continue */ }
      }
    }
    console.log(`🗑️ RESTART: Deleted algorithm cache from step 1 for ${stateNorm}: ${firestoreDeleted} local doc(s)`);
    return { firestoreDeleted, cloudDeleted: 0 };
  }
  const unionKeys = await cloudStorageCache.listUnionPolygonKeysForState(stateNorm, 1);
  for (const key of unionKeys) {
    try {
      const d = await getCacheDoc(key);
      if (d) { await deleteCacheDoc(key); firestoreDeleted++; }
    } catch (e) { /* continue */ }
  }
  const cloudResult = await cloudStorageCache.deleteUnionPolygonsForState(stateNorm, 1);
  console.log(`🗑️ RESTART: Deleted algorithm cache from step 1 for ${stateNorm}: ${firestoreDeleted} Firestore doc(s), ${cloudResult.deleted} Cloud Storage union file(s)`);
  return { firestoreDeleted, cloudDeleted: cloudResult.deleted };
}

/**
/**
 * Enrich a step's census tracts with party data (pctDem, pctRep, etc.) so the client can color by party
 * without needing a separate tract-party request. Used when returning step from executeNextStep (cache miss)
 * so the result matches what the client gets after refresh (reconstructStepFromCache enriches cached steps).
 * @param {Object} step - Step data with districtGroups[].censusTracts (full tract objects)
 * @param {string} state - State code (e.g. 'TX')
 * @returns {Promise<Object>} Step with tract.properties enriched (new object, does not mutate)
 */
async function enrichStepTractsWithParty(step, state) {
  if (!state || !step || !step.districtGroups || step.districtGroups.length === 0) return step;
  const tractPartyByGeoid = await tractPartyPersistence.loadTractPartyForState(state, 2024);
  if (!tractPartyByGeoid || Object.keys(tractPartyByGeoid).length === 0) return step;
  const { getTractId } = require('./services/geodistrict-algorithm');
  const districtGroups = step.districtGroups.map(group => {
    if (!group.censusTracts || group.censusTracts.length === 0) return group;
    const censusTracts = group.censusTracts.map(t => {
      const tid = getTractId(t);
      const row = tractPartyByGeoid[tid] || tractPartyByGeoid[String(tid)];
      if (!row) return t;
      return {
        ...t,
        properties: {
          ...(t.properties || {}),
          pctDem: row.pctDem,
          pctRep: row.pctRep,
          votesDem: row.votesDem,
          votesRep: row.votesRep,
          totalVotes: row.totalVotes
        }
      };
    });
    return { ...group, censusTracts };
  });
  console.log(`✅ NEXT-STEP: Enriched step tracts with party data (${Object.keys(tractPartyByGeoid).length} tract party rows)`);
  return { ...step, districtGroups };
}

/**
 * Reconstruct step data with tract geometries from state cache
 * @param {Object} normalizedStep - Normalized step data from cache
 * @param {Array} tractMap - Map of tract IDs to tract geometries
 * @param {boolean} recreateUnionPolygons - Whether to recreate union polygons (default: true)
 * @param {string} requestedState - The state code that was requested (for validation and union polygon loading)
 * @returns {Promise<Object>} Reconstructed step data
 */
async function reconstructStepFromCache(normalizedStep, tractMap, recreateUnionPolygons = true, requestedState = null) {
  if (!normalizedStep || !normalizedStep.districtGroups || !tractMap) {
    console.warn(`⚠️ RECONSTRUCT: Missing data - normalizedStep: ${!!normalizedStep}, districtGroups: ${!!normalizedStep?.districtGroups}, tractMap: ${!!tractMap}`);
    // Return null to indicate reconstruction failed - don't return incomplete data
    return null;
  }

  console.log(`🔄 RECONSTRUCT: Starting reconstruction - ${normalizedStep.districtGroups.length} groups, tractMap type: ${Array.isArray(tractMap) ? 'array' : typeof tractMap}, length: ${Array.isArray(tractMap) ? tractMap.length : 'N/A'}`);

  // Build tract lookup map
  // tractMap can be: array of [id, tract] pairs, array of tracts, object with tract IDs as keys, or Map
  let tractLookup;
  if (Array.isArray(tractMap)) {
    // Check if it's an array of [id, tract] pairs by checking if first element is a 2-element array
    // AND the second element looks like a tract (has geometry property)
    const isIdTractPairs = tractMap.length > 0 && 
                          Array.isArray(tractMap[0]) && 
                          tractMap[0].length === 2 &&
                          tractMap[0][1] &&
                          typeof tractMap[0][1] === 'object' &&
                          (tractMap[0][1].geometry || tractMap[0][1].properties);
    
    if (isIdTractPairs) {
      // Array of [id, tract] pairs
      console.log(`🔄 RECONSTRUCT: Treating as array of [id, tract] pairs`);
      tractLookup = new Map(tractMap);
      console.log(`✅ RECONSTRUCT: Built lookup map with ${tractLookup.size} tracts from [id, tract] pairs`);
    } else {
      // Array of tracts - need to extract IDs
      console.log(`🔄 RECONSTRUCT: Treating as array of tracts, extracting IDs...`);
      const { getTractId } = require('./services/geodistrict-algorithm');
      tractLookup = new Map();
      let extractedCount = 0;
      for (const tract of tractMap) {
        const tractId = getTractId(tract);
        if (tractId) {
          tractLookup.set(tractId, tract);
          extractedCount++;
        }
      }
      console.log(`✅ RECONSTRUCT: Built lookup map with ${tractLookup.size} tracts (extracted ${extractedCount} IDs from ${tractMap.length} tracts)`);
    }
  } else if (tractMap instanceof Map) {
    console.log(`🔄 RECONSTRUCT: tractMap is already a Map`);
    tractLookup = tractMap;
  } else if (typeof tractMap === 'object' && tractMap !== null) {
    console.log(`🔄 RECONSTRUCT: Treating as object, extracting tracts...`);
    // Object with tract IDs as keys (common format from Cloud Storage JSON)
    const { getTractId } = require('./services/geodistrict-algorithm');
    tractLookup = new Map();
    
    // Try to determine if it's an object with tract IDs as keys, or an array-like object
    if (tractMap.length !== undefined && Array.isArray(Object.values(tractMap)[0])) {
      // It might be an array-like object, try to iterate
      for (const value of Object.values(tractMap)) {
        if (Array.isArray(value)) {
          // It's an array of tracts
          for (const tract of value) {
            const tractId = getTractId(tract);
            if (tractId) {
              tractLookup.set(tractId, tract);
            }
          }
        } else if (value && typeof value === 'object' && value.geometry) {
          // It's a single tract object
          const tractId = getTractId(value);
          if (tractId) {
            tractLookup.set(tractId, value);
          }
        }
      }
    } else {
      // Object with tract IDs as keys
      for (const [tractId, tract] of Object.entries(tractMap)) {
        if (tract && typeof tract === 'object') {
          tractLookup.set(tractId, tract);
        }
      }
    }
  } else {
    console.warn('⚠️ Unexpected tractMap format:', typeof tractMap, Array.isArray(tractMap) ? 'array' : 'not array', tractMap instanceof Map ? 'Map' : 'not Map');
    return normalizedStep;
  }

  // Reconstruct district groups with full tract data
  console.log(`🔄 RECONSTRUCT: Reconstructing ${normalizedStep.districtGroups.length} district groups`);
  console.log(`   Lookup map has ${tractLookup.size} entries`);
  
  // Debug: Show sample tract IDs from lookup and from cached step
  if (tractLookup.size > 0) {
    const sampleLookupIds = Array.from(tractLookup.keys()).slice(0, 3);
    console.log(`   Sample lookup IDs: ${sampleLookupIds.join(', ')}`);
  }
  
  // Validate state code if provided
  // Tract IDs are 11-digit FIPS codes where first 2 digits are state code
  // State codes: CA=06, AZ=04, etc.
  const stateCodeMap = {
    'CA': '06', 'AZ': '04', 'TX': '48', 'FL': '12', 'NY': '36',
    'IL': '17', 'PA': '42', 'OH': '39', 'GA': '13', 'NC': '37',
    'MI': '26', 'NJ': '34', 'VA': '51', 'WA': '53', 'MA': '25',
    'TN': '47', 'IN': '18', 'MO': '29', 'MD': '24', 'WI': '55',
    'CO': '08', 'MN': '27', 'SC': '45', 'AL': '01', 'LA': '22',
    'KY': '21', 'OR': '41', 'OK': '40', 'CT': '09', 'UT': '49',
    'IA': '19', 'NV': '32', 'AR': '05', 'MS': '28', 'KS': '20',
    'NM': '35', 'NE': '31', 'WV': '54', 'ID': '16', 'HI': '15',
    'NH': '33', 'ME': '23', 'RI': '44', 'MT': '30', 'DE': '10',
    'SD': '46', 'ND': '38', 'AK': '02', 'DC': '11', 'VT': '50',
    'WY': '56'
  };
  
  const expectedStateFips = requestedState ? stateCodeMap[requestedState.toUpperCase()] : null;
  
  // Validate lookup map contains tracts for the correct state
  if (expectedStateFips && tractLookup.size > 0) {
    const sampleLookupId = Array.from(tractLookup.keys())[0];
    if (typeof sampleLookupId === 'string' && sampleLookupId.length >= 2) {
      const lookupStateFips = sampleLookupId.substring(0, 2);
      if (lookupStateFips !== expectedStateFips) {
        console.error(`❌ STATE MISMATCH IN LOOKUP MAP: Requested state ${requestedState} (FIPS: ${expectedStateFips}), but lookup map contains tracts starting with ${lookupStateFips}. Wrong state tract cache loaded!`);
        // Return null to prevent using wrong state data
        return null;
      }
    }
  }

  // Enrich tracts with party data from tract_party_{state}_{year} so popup and coloring can use tract.properties
  let tractPartyByGeoid = null;
  if (requestedState) {
    tractPartyByGeoid = await tractPartyPersistence.loadTractPartyForState(requestedState, 2024);
    if (tractPartyByGeoid && Object.keys(tractPartyByGeoid).length > 0) {
      console.log(`✅ RECONSTRUCT: Enriching tracts with party data (${Object.keys(tractPartyByGeoid).length} tract party rows)`);
    }
  }
  
  const reconstructed = {
    ...normalizedStep,
    districtGroups: normalizedStep.districtGroups.map((group, idx) => {
      const tractIds = group.censusTractIds || [];
      if (tractIds.length > 0) {
        const sampleStepIds = tractIds.slice(0, 3);
        console.log(`   Group ${idx + 1}: Sample step IDs: ${sampleStepIds.join(', ')}`);
        
        // Validate that tract IDs match the requested state
        if (expectedStateFips && sampleStepIds.length > 0) {
          const firstTractId = sampleStepIds[0];
          if (typeof firstTractId === 'string' && firstTractId.length >= 2) {
            const tractStateFips = firstTractId.substring(0, 2);
            if (tractStateFips !== expectedStateFips) {
              console.error(`❌ STATE MISMATCH: Requested state ${requestedState} (FIPS: ${expectedStateFips}), but tract IDs start with ${tractStateFips}. This cached step may be for a different state!`);
              // Don't return null - let it continue but log the error
            }
          }
        }
      }
      
      let tracts = tractIds.map(id => tractLookup.get(id)).filter(Boolean);
      const missingCount = tractIds.length - tracts.length;
      
      if (missingCount > 0) {
        // Show some missing IDs for debugging
        const missingIds = tractIds.filter(id => !tractLookup.has(id)).slice(0, 3);
        console.log(`   ⚠️ Group ${idx + 1}: ${missingCount} missing tracts. Sample missing IDs: ${missingIds.join(', ')}`);
      }

      // Enrich each tract with party metadata (pctDem, pctRep, votesDem, votesRep, totalVotes) so popup and coloring use tract.properties
      if (tractPartyByGeoid && Object.keys(tractPartyByGeoid).length > 0) {
        const { getTractId } = require('./services/geodistrict-algorithm');
        tracts = tracts.map(t => {
          const tid = getTractId(t);
          const row = tractPartyByGeoid[tid] || tractPartyByGeoid[String(tid)];
          if (!row) return t;
          return {
            ...t,
            properties: {
              ...(t.properties || {}),
              pctDem: row.pctDem,
              pctRep: row.pctRep,
              votesDem: row.votesDem,
              votesRep: row.votesRep,
              totalVotes: row.totalVotes
            }
          };
        });
      }
      
      // Validate that reconstructed tracts have geometry
      const tractsWithoutGeometry = tracts.filter(t => !t.geometry || (t.type === 'Feature' && !t.geometry));
      if (tractsWithoutGeometry.length > 0) {
        const sampleTractIds = tractsWithoutGeometry.slice(0, 3).map(t => {
          const { getTractId } = require('./services/geodistrict-algorithm');
          return getTractId(t);
        });
        console.error(`❌ GEOMETRY MISSING: Group ${idx + 1} has ${tractsWithoutGeometry.length} tracts without geometry. Sample tract IDs: ${sampleTractIds.join(', ')}`);
        console.error(`   This indicates the tract cache may be corrupted or contain incomplete data.`);
      }
      
      console.log(`   Group ${idx + 1}: ${tractIds.length} tract IDs, ${tracts.length} tracts found in lookup`);
      return {
        ...group,
        censusTracts: tracts
      };
    })
  };

  // Remove censusTractIds after reconstruction
  reconstructed.districtGroups.forEach(g => {
    if (g.censusTractIds) delete g.censusTractIds;
  });

  // Preserve step metadata so cache-loaded steps expose isolation/island data when present.
  // Do not expose isolatedTractsData that looks wrong (e.g. half-state from wrong step); client will run detection.
  const maxIsolatedPerGroup = 200;
  const byGroup = normalizedStep.isolatedTractsData?.isolatedTractsByGroup;
  const isolatedReasonable = byGroup && typeof byGroup === 'object' &&
    !Object.values(byGroup).some(list => Array.isArray(list) && list.length > maxIsolatedPerGroup);
  if (normalizedStep.isolatedTractsData != null && isolatedReasonable) {
    reconstructed.isolatedTractsData = normalizedStep.isolatedTractsData;
  }
  if (normalizedStep.islandTractsData != null) reconstructed.islandTractsData = normalizedStep.islandTractsData;
  if (normalizedStep.divisionLines != null) reconstructed.divisionLines = normalizedStep.divisionLines;
  if (normalizedStep.dgAdjacentGroupsByGroup != null) reconstructed.dgAdjacentGroupsByGroup = normalizedStep.dgAdjacentGroupsByGroup;

  // Update tract properties (tract_DG, parent_DG, sibling_DG) based on divisionLines
  // This ensures reconstructed steps have correct DG properties even if cached with old properties
  if (normalizedStep.divisionLines && Array.isArray(normalizedStep.divisionLines)) {
    console.log(`🔄 RECONSTRUCT: Updating tract DG properties from ${normalizedStep.divisionLines.length} division line(s)`);
    const { getTractId } = require('./services/geodistrict-algorithm');
    
    // Process divisionLines in order to build up the DG hierarchy
    for (const divLine of normalizedStep.divisionLines) {
      if (divLine.siblingGroups && Array.isArray(divLine.siblingGroups) && divLine.siblingGroups.length === 2) {
        const firstSibling = divLine.siblingGroups[0];
        const secondSibling = divLine.siblingGroups[1];
        const parentGroup = divLine.parentGroup;
        
        if (firstSibling && secondSibling && parentGroup) {
          // Always use full format: DG{start}-{end} even when start === end (e.g., DG2-2, not DG2)
          const firstSiblingDG = `DG${firstSibling.startDistrictNumber}-${firstSibling.endDistrictNumber}`;
          const secondSiblingDG = `DG${secondSibling.startDistrictNumber}-${secondSibling.endDistrictNumber}`;
          const parentDG = `DG${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}`;
          
          // Find the groups matching these DGs and update their tracts
          for (const group of reconstructed.districtGroups) {
            const groupDG = `DG${group.startDistrictNumber}-${group.endDistrictNumber}`;
            
            if (groupDG === firstSiblingDG) {
              // Update tracts in first sibling group
              for (const tract of group.censusTracts || []) {
                if (!tract.properties) tract.properties = {};
                tract.properties.tract_DG = firstSiblingDG;
                tract.properties.parent_DG = parentDG;
                tract.properties.sibling_DG = secondSiblingDG;
              }
            } else if (groupDG === secondSiblingDG) {
              // Update tracts in second sibling group
              for (const tract of group.censusTracts || []) {
                if (!tract.properties) tract.properties = {};
                tract.properties.tract_DG = secondSiblingDG;
                tract.properties.parent_DG = parentDG;
                tract.properties.sibling_DG = firstSiblingDG;
              }
            }
          }
        }
      }
    }
    console.log(`✅ RECONSTRUCT: Updated tract DG properties from divisionLines`);
  }

  // Ensure ENCLOSED_BY / ENCLOSES / TRACT_GROUP_ID are set (e.g. when tract cache predates enclosed detection or for TX enclosed tracts)
  const allTractsForEnclosed = reconstructed.districtGroups.flatMap(g => g.censusTracts || []);
  if (allTractsForEnclosed.length > 0) {
    const { detectEnclosedTracts, getTractId } = require('./services/geodistrict-algorithm');
    const enclosedMap = detectEnclosedTracts(allTractsForEnclosed);
    if (enclosedMap.size > 0) {
      let nextGroupId = 1;
      const groupIdMap = new Map();
      for (const [enclosedId, enclosingId] of enclosedMap.entries()) {
        let groupId = groupIdMap.get(enclosedId) || groupIdMap.get(enclosingId);
        if (!groupId) groupId = `group_${nextGroupId++}`;
        groupIdMap.set(enclosedId, groupId);
        groupIdMap.set(enclosingId, groupId);
      }
      for (const tract of allTractsForEnclosed) {
        const tractId = getTractId(tract);
        if (!tractId) continue;
        if (enclosedMap.has(tractId)) {
          if (!tract.properties) tract.properties = {};
          tract.properties.ENCLOSED_BY = enclosedMap.get(tractId);
        }
        const enclosedByThis = [];
        for (const [eid, encId] of enclosedMap.entries()) {
          if (encId === tractId) enclosedByThis.push(eid);
        }
        if (enclosedByThis.length > 0) {
          if (!tract.properties) tract.properties = {};
          tract.properties.ENCLOSES = enclosedByThis;
        }
        if (groupIdMap.has(tractId)) {
          if (!tract.properties) tract.properties = {};
          tract.properties.TRACT_GROUP_ID = groupIdMap.get(tractId);
        }
      }
      console.log(`✅ RECONSTRUCT: Assigned ENCLOSED_BY/TRACT_GROUP_ID for ${enclosedMap.size} enclosed tract(s)`);
    }
  }

  const totalTracts = reconstructed.districtGroups.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0);
  console.log(`✅ RECONSTRUCT: Completed - total ${totalTracts} tracts reconstructed across ${reconstructed.districtGroups.length} groups`);
  
  // Final validation: Check if any tracts are missing geometry
  let totalTractsWithoutGeometry = 0;
  for (const group of reconstructed.districtGroups) {
    if (group.censusTracts) {
      for (const tract of group.censusTracts) {
        if (!tract.geometry || (tract.type === 'Feature' && !tract.geometry)) {
          totalTractsWithoutGeometry++;
        }
      }
    }
  }

  // Allow reconstruction when only a small number of tracts lack geometry (e.g. water/special-purpose tracts with no TIGER geometry)
  const missingThreshold = Math.max(50, Math.ceil(totalTracts * 0.01));
  if (totalTractsWithoutGeometry > missingThreshold) {
    const percentage = ((totalTractsWithoutGeometry / totalTracts) * 100).toFixed(1);
    console.error(`❌ RECONSTRUCT FAILED: ${totalTractsWithoutGeometry} out of ${totalTracts} tracts (${percentage}%) are missing geometry (threshold: ${missingThreshold}).`);
    console.error(`   This indicates the tract cache is corrupted or incomplete. Returning null to force re-execution.`);
    return null; // Return null to force re-execution
  }

  if (totalTractsWithoutGeometry > 0) {
    const percentage = ((totalTractsWithoutGeometry / totalTracts) * 100).toFixed(1);
    console.warn(`⚠️ RECONSTRUCT: ${totalTractsWithoutGeometry} tract(s) (${percentage}%) missing geometry - excluding from reconstructed groups (within threshold ${missingThreshold}).`);
    for (const group of reconstructed.districtGroups) {
      if (group.censusTracts) {
        group.censusTracts = group.censusTracts.filter(t =>
          t && (t.geometry || (t.type === 'Feature' && t.geometry))
        );
      }
    }
  }

  // Load union polygons from cache if available, otherwise recreate them
  // However, if recreateUnionPolygons is false, skip this (e.g., when tracts will be replaced anyway)
  if (recreateUnionPolygons) {
    // Try to load union polygons from cache first
    const stepNumber = normalizedStep.step;
    // Use requestedState if provided, otherwise try to infer from normalizedStep or tractMap
    const stateCode = requestedState || normalizedStep.state || (tractMap && tractMap.length > 0 ? 
      (tractMap[0][1]?.properties?.STATE || tractMap[0][1]?.properties?.state) : null);
    
    if (stateCode && stepNumber !== undefined) {
      try {
        // Load union polygons from cache - use the requested state to ensure we load the correct polygons
        const groupsWithUnions = await loadUnionPolygonsFromCache(stateCode, stepNumber, reconstructed.districtGroups);
        reconstructed.districtGroups = groupsWithUnions;
        
        // Check if all groups have union polygons loaded
        const loadedCount = reconstructed.districtGroups.filter(g => g.unionPolygon || g.unionPolygons).length;
        const allLoaded = loadedCount === reconstructed.districtGroups.length;
        
        if (allLoaded) {
          // Check if union polygons are TIGER-based (for step 0) or tract-based
          // stepNumber is already defined above from normalizedStep.step
          const isStep0 = stepNumber === 0 || stepNumber === '0';
          let tigerCount = 0;
          let tractCount = 0;
          for (const group of reconstructed.districtGroups) {
            if (group.unionPolygonCacheKey) {
              try {
                const unionCacheDoc = await getCacheDoc(group.unionPolygonCacheKey);
                if (unionCacheDoc) {
                  const metadata = unionCacheDoc;
                  if (metadata.tigerBased === true || metadata.source === 'tiger-state-boundary') {
                    tigerCount++;
                  } else {
                    tractCount++;
                  }
                }
              } catch (e) {
                // Ignore errors
              }
            }
          }
          const sourceInfo = isStep0 && tigerCount > 0 
            ? ` (${tigerCount} TIGER state boundary/ies)` 
            : tractCount > 0 
              ? ` (${tractCount} tract-based union polygon(s))`
              : '';
          console.log(`✅ RECONSTRUCT: Loaded union polygons from cache for ${reconstructed.districtGroups.length} district groups${sourceInfo}`);
        } else {
          // Some groups missing - unions are built async via POST .../union-polygons; do not recreate inline
          const isStep0 = stepNumber === 0 || stepNumber === '0';
          const totalIsolated = normalizedStep.isolatedTractsData?.totalIsolated ?? 0;
          if (isStep0) {
            console.log(`⚠️ RECONSTRUCT: Step 0 union polygons missing from cache - caller should fetch TIGER state boundaries`);
          } else if (totalIsolated > 0) {
            console.log(`⚠️ RECONSTRUCT: Step has ${totalIsolated} isolated tract(s); union polygons built after move-isolated.`);
          } else {
            console.log(`⚠️ RECONSTRUCT: Only ${loadedCount}/${reconstructed.districtGroups.length} union polygons in cache; client can call POST .../union-polygons or poll GET.`);
          }
        }
      } catch (error) {
        const isStep0 = stepNumber === 0 || stepNumber === '0';
        const totalIsolated = normalizedStep.isolatedTractsData?.totalIsolated ?? 0;
        if (isStep0) {
          console.warn(`⚠️ RECONSTRUCT: Failed to load Step 0 union polygons from cache: ${error.message} - caller should fetch TIGER state boundaries`);
        } else if (totalIsolated > 0) {
          console.log(`⚠️ RECONSTRUCT: Skipping union polygon load - step has ${totalIsolated} isolated tract(s).`);
        } else {
          console.warn(`⚠️ RECONSTRUCT: Failed to load union polygons from cache: ${error.message} - client can call POST .../union-polygons.`);
        }
      }
    } else {
      // No state/step info
      const isStep0 = stepNumber === 0 || stepNumber === '0';
      if (isStep0) {
        console.warn(`⚠️ RECONSTRUCT: Step 0 missing state/step info - caller should fetch TIGER state boundaries`);
      } else {
        console.log(`⚠️ RECONSTRUCT: Missing state/step info for union polygons - client can call POST .../union-polygons.`);
      }
    }
  } else {
    console.log(`⏭️ RECONSTRUCT: Skipping union polygon recreation (will be created after tract replacement)`);
  }
  
  return reconstructed;
}

/**
 * Recreate union polygons for district groups (helper function)
 * @param {Array} districtGroups - District groups to recreate union polygons for
 * @param {boolean} suppressVerboseLogging - If true, suppress component-level logging
 * @param {number} stepNumber - Step number (optional, used at Step 0 to structure polygons as main + islands)
 */
async function recreateUnionPolygonsForGroups(districtGroups, suppressVerboseLogging = false, stepNumber = null) {
  const isStep0 = stepNumber === 0 || stepNumber === '0';
  
  // For Step 0, NEVER create union polygons from tracts - must use TIGER state boundaries
  if (isStep0) {
    console.error(`❌ RECONSTRUCT: recreateUnionPolygonsForGroups called for Step 0 - this should never happen! Step 0 must use TIGER state boundaries, not tract-based union polygons.`);
    return districtGroups; // Return groups unchanged - caller should fetch TIGER boundaries instead
  }
  
  const { createUnionPolygonsForGroup, createUnionPolygon, buildMultiPolygonFromFeatures } = require('./services/geodistrict-algorithm');
  const { GeodistrictAlgorithmService } = require('./services/geodistrict-algorithm');
  const latLongDivisionService = require('./services/latlong-division');
  const algorithmService = new GeodistrictAlgorithmService(latLongDivisionService);
  
  // Build adjacency graph from all tracts for union polygon creation
  let adjacencyGraph = null;
  try {
    // Collect all tracts from all groups
    const allTracts = [];
    for (const group of districtGroups) {
      if (group.censusTracts) {
        allTracts.push(...group.censusTracts);
      }
    }
    if (allTracts.length > 0) {
      adjacencyGraph = algorithmService.buildGeometryAdjacencyGraph(allTracts);
    }
  } catch (error) {
    console.warn(`⚠️ RECONSTRUCT: Failed to build adjacency graph for union polygon recreation: ${error.message}`);
  }

  const totalStateTracts = districtGroups.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0);
  
  // Temporarily suppress console.log if suppressVerboseLogging is true
  const originalLog = console.log;
  if (suppressVerboseLogging) {
    console.log = (...args) => {
      // Only suppress "Created union polygon X/Y" messages, keep important ones
      const message = args[0];
      if (typeof message === 'string' && message.includes('Created union polygon') && message.includes('for component')) {
        return; // Suppress this log
      }
      originalLog.apply(console, args);
    };
  }
  
  // Yield to event loop periodically so server can serve other requests (NEVER BLOCK on union polygon work).
  const yieldConfig = {
    yieldEvery: 25,
    yieldFn: () => new Promise(r => setImmediate(r))
  };
  try {
    // Recreate union polygons for each district group (only for non-Step-0).
    for (const group of districtGroups) {
      // Skip if already has union polygons (from cache)
      if (group.unionPolygon || group.unionPolygons) {
        continue;
      }
      
      if (group.censusTracts && group.censusTracts.length > 0) {
        // At non-Step-0: one union polygon per DG (contiguous = one Polygon, islands = one MultiPolygon)
        let unionResult = await createUnionPolygonsForGroup(group, adjacencyGraph, true, stepNumber, totalStateTracts, yieldConfig);
        if (!unionResult) {
          unionResult = await createUnionPolygon(group, totalStateTracts, yieldConfig); // Fallback so contiguous DG always has a polygon
        }
        if (unionResult) {
          if (Array.isArray(unionResult) && unionResult.length > 0) {
            const multi = buildMultiPolygonFromFeatures(unionResult);
            group.unionPolygon = multi || unionResult[0];
            group.unionPolygons = unionResult;
          } else {
            // Single feature: normalize Polygon to MultiPolygon for consistent type in cache and UI
            const feat = unionResult;
            if (feat.geometry?.type === 'Polygon') {
              group.unionPolygon = {
                type: 'Feature',
                geometry: { type: 'MultiPolygon', coordinates: [feat.geometry.coordinates] },
                properties: feat.properties || {}
              };
              group.unionPolygons = [group.unionPolygon];
            } else {
              group.unionPolygon = feat;
              group.unionPolygons = undefined;
            }
          }
        }
      }
      // Yield after each group so other requests can be served.
      await new Promise(r => setImmediate(r));
    }
  } finally {
    // Restore original console.log
    if (suppressVerboseLogging) {
      console.log = originalLog;
    }
  }
  
  const recreatedCount = districtGroups.filter(g => g.unionPolygon || g.unionPolygons).length;
  console.log(`✅ RECONSTRUCT: Recreated union polygons for ${recreatedCount}/${districtGroups.length} district groups`);

  return districtGroups;
}


/**
 * ============================================================================
 * VOTER REGISTRATION DATA ENDPOINTS
 * ============================================================================
 */

/**
 * GET /api/voter-registration/states
 * Get list of all states and their data source status
 */
app.get('/api/voter-registration/states', async (req, res) => {
  try {
    const allStates = voterRegistrationLoader.getAllStates();
    const configuredStates = voterRegistrationLoader.getConfiguredStates();
    
    const states = allStates.map(state => ({
      code: state,
      fips: voterRegistrationLoader.getStateFipsCode(state),
      configured: configuredStates.includes(state),
      dataSource: voterRegistrationLoader.getStateDataSource(state),
      loading: voterRegistrationLoader.isLoading(state)
    }));

    res.json({
      states,
      total: states.length,
      configured: configuredStates.length,
      unconfigured: states.length - configuredStates.length
    });
  } catch (error) {
    console.error('Error getting states list:', error);
    res.status(500).json({
      error: 'Failed to get states list',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/detect-isolated-tracts
 * Detect isolated tracts in the current district groups without fixing them
 */
app.post('/api/algorithm/detect-isolated-tracts', async (req, res) => {
  try {
    const { districtGroups, allTracts, stepNumber, step0IslandTractIds } = req.body;

    if (!districtGroups || !Array.isArray(districtGroups)) {
      return res.status(400).json({ error: 'districtGroups array is required' });
    }

    if (!allTracts || !Array.isArray(allTracts)) {
      return res.status(400).json({ error: 'allTracts array is required' });
    }

    let step0IslandSet = Array.isArray(step0IslandTractIds) ? new Set(step0IslandTractIds) : (step0IslandTractIds || null);

    // Ensure S4 adjacency data is loaded (required for isolation detection)
    let stateForExclusion = '';
    if (allTracts.length > 0) {
      const first = allTracts[0];
      let state = first?.properties?.['STATE'] ?? first?.properties?.state ?? first?.properties?.['STATE_FIPS'] ?? '';
      if (state === '' && first?.properties?.GEOID) {
        const geoid = String(first.properties.GEOID);
        if (geoid.length >= 2) state = geoid.substring(0, 2);
      }
      if (typeof state === 'number') state = String(state).padStart(2, '0');
      else if (typeof state === 'string' && state.length === 1) state = state.padStart(2, '0');
      stateForExclusion = state;
      if (state) {
        try {
          const s4DataLoader = require('./services/s4-data-loader');
          state = s4DataLoader.normalizeStateForS4(state);
          await s4DataLoader.loadS4AdjacencyData(state);
          console.log(`✅ Loaded S4 adjacency data for ${state} before isolation detection`);
        } catch (error) {
          console.warn(`⚠️ Failed to load S4 adjacency data for ${state}: ${error.message}`);
          console.warn(`   Isolation detection may be inaccurate without adjacency data`);
        }
      }
    }
    // California at step > 0: ensure known Pacific island tracts are excluded even when frontend sends no step-0 island list
    const stepNum = stepNumber != null ? Number(stepNumber) : 0;
    const isCA = stateForExclusion === '06' || stateForExclusion === 'CA';
    if (stepNum > 0 && isCA) {
      if (!step0IslandSet) step0IslandSet = new Set();
      KNOWN_CA_ISLAND_TRACT_IDS.forEach(id => step0IslandSet.add(id));
    }
    console.log(`🔍 Detecting isolated tracts for ${districtGroups.length} groups with ${allTracts.length} total tracts` + (step0IslandSet?.size ? ` (excluding ${step0IslandSet.size} step-0 island tracts)` : ''));

    // Call the detection method (stepNumber and step0IslandTractIds exclude geographic islands from isolation at steps 1+)
    const detectionResult = algorithmService.detectIsolatedTracts(districtGroups, allTracts, stepNumber ?? null, step0IslandSet);

    // Convert Sets to Arrays for JSON serialization
    const isolatedTractsByGroup = {};
    detectionResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
      isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
    });

    const isolatedTractIds = Array.from(detectionResult.isolatedTractIds);

    res.json({
      isolatedTractsByGroup,
      isolatedTractIds,
      totalIsolated: isolatedTractIds.length,
      groupsWithIsolation: Object.keys(isolatedTractsByGroup).length,
      groupStats: detectionResult.groupStats || []
    });
  } catch (error) {
    console.error('Error detecting isolated tracts:', error);
    res.status(500).json({
      error: 'Failed to detect isolated tracts',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/detect-bridge-tracts
 * Detect bridge tracts that could connect isolated tracts
 */
app.post('/api/algorithm/detect-bridge-tracts', async (req, res) => {
  try {
    const { districtGroups, allTracts, isolatedTractsByGroup } = req.body;

    if (!districtGroups || !Array.isArray(districtGroups)) {
      return res.status(400).json({ error: 'districtGroups array is required' });
    }

    if (!allTracts || !Array.isArray(allTracts)) {
      return res.status(400).json({ error: 'allTracts array is required' });
    }

    if (!isolatedTractsByGroup || typeof isolatedTractsByGroup !== 'object') {
      return res.status(400).json({ error: 'isolatedTractsByGroup object is required' });
    }

    console.log(`🌉 Detecting bridge tracts for ${Object.keys(isolatedTractsByGroup).length} groups with isolated tracts`);

    // Convert isolatedTractsByGroup back to Map format
    const isolatedTractsByGroupMap = new Map();
    for (const [groupIndexStr, tractIds] of Object.entries(isolatedTractsByGroup)) {
      const groupIndex = parseInt(groupIndexStr);
      isolatedTractsByGroupMap.set(groupIndex, new Set(tractIds));
    }

    // Call the detection method
    const bridgeResult = algorithmService.detectBridgeTracts(districtGroups, allTracts, isolatedTractsByGroupMap);

    // Convert Map to object for JSON serialization
    const bridgeTractsByIsolatedGroup = {};
    bridgeResult.bridgeTractsByIsolatedGroup.forEach((bridgeTracts, groupIndex) => {
      bridgeTractsByIsolatedGroup[groupIndex] = bridgeTracts;
    });

    res.json({
      bridgeTractsByIsolatedGroup,
      totalBridgeTracts: Object.values(bridgeTractsByIsolatedGroup).reduce((sum, bridges) => sum + bridges.length, 0)
    });
  } catch (error) {
    console.error('Error detecting bridge tracts:', error);
    res.status(500).json({
      error: 'Failed to detect bridge tracts',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/move-bridge-tracts
 * Move bridge tracts to isolated group and re-run isolation detection
 */
app.post('/api/algorithm/move-bridge-tracts', async (req, res) => {
  try {
    const { districtGroups, allTracts, isolatedGroupIndex, bridgeTractIds, divisionLines, state, step, maxIterations = 100 } = req.body;

    if (!districtGroups || !Array.isArray(districtGroups)) {
      return res.status(400).json({ error: 'districtGroups array is required' });
    }

    if (!allTracts || !Array.isArray(allTracts)) {
      return res.status(400).json({ error: 'allTracts array is required' });
    }

    if (typeof isolatedGroupIndex !== 'number' || isolatedGroupIndex < 0) {
      return res.status(400).json({ error: 'isolatedGroupIndex number is required' });
    }

    if (!bridgeTractIds || !Array.isArray(bridgeTractIds)) {
      return res.status(400).json({ error: 'bridgeTractIds array is required' });
    }

    console.log(`🔄 Moving ${bridgeTractIds.length} bridge tract(s) to sibling group of isolated group ${isolatedGroupIndex}`);

    // Call the move method with divisionLines (sibling relationships) if provided
    const result = algorithmService.moveBridgeTractsAndRecheck(
      districtGroups,
      allTracts,
      isolatedGroupIndex,
      bridgeTractIds,
      divisionLines || null
    );

    // Update algorithm state and invalidate cached step if state and step are provided
    if (state && typeof step === 'number') {
      const stateKey = getAlgorithmStateKey(state, maxIterations);
      const algorithmState = await getCachedAlgorithmState(stateKey);
      
      if (algorithmState) {
        // Update currentGroups in algorithm state with the moved groups
        algorithmState.currentGroups = result.districtGroups;
        
        // Update the step in the steps array if it exists
        if (algorithmState.steps && algorithmState.steps.length > step) {
          algorithmState.steps[step] = {
            ...algorithmState.steps[step],
            districtGroups: result.districtGroups
          };
        }
        
        // Cache updated algorithm state
        await cacheAlgorithmState(stateKey, algorithmState);
        
        // Invalidate cached step so subsequent steps use the updated data
        const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${step}`;
        try {
          await deleteCacheDoc(stepCacheKey);
          console.log(`🗑️ Invalidated cached step ${step} for ${state} after moving bridge tracts`);
        } catch (deleteError) {
          console.warn(`⚠️ Failed to invalidate cached step ${step}: ${deleteError.message}`);
        }
        
        // Also invalidate all subsequent step caches since they depend on this step
        await invalidateSubsequentStepCaches(state, maxIterations, step);
      } else {
        console.warn(`⚠️ Algorithm state not found for ${state}, cannot update state or invalidate cache`);
      }
    }

    // Run isolation detection once after the move (instead of inside moveBridgeTractsAndRecheck)
    const isolationResult = algorithmService.detectIsolatedTracts(result.districtGroups, allTracts);

    // Convert isolation result Map to object for JSON serialization
    const isolatedTractsByGroup = {};
    isolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
      isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
    });

    res.json({
      districtGroups: result.districtGroups,
      isolationResult: {
        isolatedTractsByGroup,
        isolatedTractIds: Array.from(isolationResult.isolatedTractIds),
        totalIsolated: isolationResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(isolatedTractsByGroup).length
      }
    });
  } catch (error) {
    console.error('Error moving bridge tracts:', error);
    res.status(500).json({
      error: 'Failed to move bridge tracts',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/move-isolated-tracts
 * Move isolated tracts to opposite group (group with adjacent neighbors) and re-run isolation detection
 */
app.post('/api/algorithm/move-isolated-tracts', async (req, res) => {
  try {
    const { districtGroups, allTracts, isolatedGroupIndex, isolatedTractIds, divisionLines, state, step, maxIterations = 100 } = req.body;

    if (!districtGroups || !Array.isArray(districtGroups)) {
      return res.status(400).json({ error: 'districtGroups array is required' });
    }

    if (!allTracts || !Array.isArray(allTracts)) {
      return res.status(400).json({ error: 'allTracts array is required' });
    }

    if (typeof isolatedGroupIndex !== 'number' || isolatedGroupIndex < 0) {
      return res.status(400).json({ error: 'isolatedGroupIndex number is required' });
    }

    if (!isolatedTractIds || !Array.isArray(isolatedTractIds)) {
      return res.status(400).json({ error: 'isolatedTractIds array is required' });
    }

    // Preload S4 adjacency data so move and post-move isolation detection use a full graph (avoids hang when S4 was not yet in memory)
    let stateForS4 = state || (allTracts.length > 0 && (allTracts[0]?.properties?.STATE || allTracts[0]?.properties?.state || allTracts[0]?.properties?.STATE_FIPS)) || '';
    if (stateForS4) {
      try {
        const s4DataLoader = require('./services/s4-data-loader');
        stateForS4 = s4DataLoader.normalizeStateForS4(stateForS4);
        await s4DataLoader.loadS4AdjacencyData(stateForS4);
        console.log(`✅ Loaded S4 adjacency data for ${stateForS4} before move isolated tracts`);
      } catch (s4Err) {
        console.warn(`⚠️ Failed to load S4 adjacency data for ${stateForS4}: ${s4Err.message}`);
      }
    }

    console.log(`🔄 Moving ${isolatedTractIds.length} isolated tract(s) from group ${isolatedGroupIndex} to opposite group`);

    // Call the move method with divisionLines (sibling relationships) if provided. No balancing during isolation move.
    const result = algorithmService.moveIsolatedTractsToOppositeGroup(
      districtGroups,
      allTracts,
      isolatedGroupIndex,
      isolatedTractIds,
      divisionLines || null,
      true
    );

    // Update algorithm state and invalidate cached step if state and step are provided
    if (state && typeof step === 'number') {
      const stateKey = getAlgorithmStateKey(state, maxIterations);
      const algorithmState = await getCachedAlgorithmState(stateKey);
      
      if (algorithmState) {
        // Update currentGroups in algorithm state with the moved groups
        algorithmState.currentGroups = result.districtGroups;
        
        // Update the step in the steps array if it exists
        if (algorithmState.steps && algorithmState.steps.length > step) {
          algorithmState.steps[step] = {
            ...algorithmState.steps[step],
            districtGroups: result.districtGroups
          };
        }
        
        // Cache updated algorithm state
        await cacheAlgorithmState(stateKey, algorithmState);
        
        // Invalidate cached step so subsequent steps use the updated data
        const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${step}`;
        try {
          await deleteCacheDoc(stepCacheKey);
          console.log(`🗑️ Invalidated cached step ${step} for ${state} after moving isolated tracts`);
        } catch (deleteError) {
          console.warn(`⚠️ Failed to invalidate cached step ${step}: ${deleteError.message}`);
        }
        
        // Also invalidate all subsequent step caches since they depend on this step
        await invalidateSubsequentStepCaches(state, maxIterations, step);

        // Write the updated step back to cache so any later POST union-polygons uses post-move DG tracts
        if (algorithmState.steps && algorithmState.steps[step] && algorithmState.tractCacheKey) {
          const updatedStep = algorithmState.steps[step];
          const normalizedStep = normalizeStepData(updatedStep, algorithmState.tractCacheKey);
          const cacheData = {
            stepData: normalizedStep.normalized,
            isComplete: false,
            algorithmVersion: ALGORITHM_VERSION,
            timestamp: Date.now(),
            ttl: 24 * 60 * 60 * 1000, // 24 hours
            source: 'algorithm-step-cache',
            normalized: true,
            tractCacheKey: algorithmState.tractCacheKey,
            state: state,
            step: step,
            unionPolygonsCached: false
          };
          try {
            await setStepCache(stepCacheKey, cacheData);
            console.log(`💾 STEP CACHE STORED (move-isolated-tracts): Saved updated step ${step} for ${state} with post-move DG tracts`);
          } catch (writeErr) {
            console.warn(`⚠️ Failed to write step cache after move-isolated-tracts: ${writeErr.message}`);
          }
        }
      } else {
        console.warn(`⚠️ Algorithm state not found for ${state}, cannot update state or invalidate cache`);
      }
    }

    // Run isolation detection once after the move (instead of inside moveIsolatedTractsToOppositeGroup)
    const isolationResult = algorithmService.detectIsolatedTracts(result.districtGroups, allTracts);

    // Convert isolation result Map to object for JSON serialization
    const isolatedTractsByGroup = {};
    isolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
      isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
    });

    res.json({
      districtGroups: result.districtGroups,
      isolationResult: {
        isolatedTractsByGroup,
        isolatedTractIds: Array.from(isolationResult.isolatedTractIds),
        totalIsolated: isolationResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(isolatedTractsByGroup).length
      }
    });
  } catch (error) {
    console.error('Error moving isolated tracts:', error);
    res.status(500).json({
      error: 'Failed to move isolated tracts',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/move-all-isolated-tracts
 * Move all isolated tracts for a step - just swap tracts between DGs (fast path when frontend sends full data).
 * Fallback: load from step cache when districtGroups not provided.
 * NEVER blocks on union polygon work: union polygons are built only by async POST .../union-polygons (triggered here via setImmediate(axios.post)).
 */
app.post('/api/algorithm/move-all-isolated-tracts', async (req, res) => {
  try {
    const { state, step, maxIterations = 100, isolatedTractsData: frontendIsolatedTractsData, districtGroups: bodyDistrictGroups, divisionLines: bodyDivisionLines, step0IslandTractIds: bodyStep0IslandTractIds } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    if (typeof step !== 'number' || step < 0) {
      return res.status(400).json({ error: 'Valid step number is required' });
    }

    // Preload S4 adjacency data so move and post-move isolation detection use a full graph (avoids hang when S4 was not yet in memory)
    try {
      const s4DataLoader = require('./services/s4-data-loader');
      const stateForS4 = s4DataLoader.normalizeStateForS4(state);
      await s4DataLoader.loadS4AdjacencyData(stateForS4);
      console.log(`✅ Loaded S4 adjacency data for ${stateForS4} before move all isolated tracts`);
    } catch (s4Err) {
      console.warn(`⚠️ Failed to load S4 adjacency data for ${state}: ${s4Err.message}`);
    }

    // Fast path: frontend sent full district groups + isolated data. No cache I/O - just swap tracts in memory.
    const hasBodyGroups = bodyDistrictGroups && Array.isArray(bodyDistrictGroups) && bodyDistrictGroups.length > 0;
    const hasCensusTracts = hasBodyGroups && bodyDistrictGroups.every(g => Array.isArray(g.censusTracts));
    const hasBodyIsolated = frontendIsolatedTractsData && frontendIsolatedTractsData.isolatedTractsByGroup &&
      Object.keys(frontendIsolatedTractsData.isolatedTractsByGroup).length > 0;
    const canUseFastPath = hasBodyGroups && hasCensusTracts && hasBodyIsolated;

    if (!canUseFastPath) {
      const reasons = [];
      if (!hasBodyGroups) reasons.push('no body district groups');
      else if (!hasCensusTracts) reasons.push('district groups missing censusTracts (send full tract objects for fast path)');
      if (!hasBodyIsolated) reasons.push('no body isolated data');
      console.log(`⚠️ Move-all-isolated using cache path: ${reasons.join('; ')}`);
    }

    if (canUseFastPath) {
      const { getTractId } = require('./services/geodistrict-algorithm');
      const allTracts = [];
      for (const group of bodyDistrictGroups) {
        for (const t of group.censusTracts || []) {
          if (t && getTractId(t)) allTracts.push(t);
        }
      }
      let step0IslandSet = Array.isArray(bodyStep0IslandTractIds) ? new Set(bodyStep0IslandTractIds) : null;
      // California at step > 0: exclude known Pacific island tracts so they are not reported as isolated
      const stateNorm = (typeof state === 'string' && state.length >= 2) ? state.substring(0, 2) : state;
      const isCA = stateNorm === '06' || state === 'CA';
      if (step > 0 && isCA) {
        if (!step0IslandSet) step0IslandSet = new Set();
        KNOWN_CA_ISLAND_TRACT_IDS.forEach(id => step0IslandSet.add(id));
      }
      let updatedGroups = bodyDistrictGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));
      const divisionLines = bodyDivisionLines || [];
      const isFinalStep = updatedGroups.length > 0 && updatedGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
      const maxIter = 10;

      if (isFinalStep) {
        // Final step: use adjacency-based move (whole-component, sibling-first) for Move Isolated Tracts button
        // Unmovable tracts (no adjacent district) are merged into step0IslandSet so they are treated as islands for this step
        if (!step0IslandSet) step0IslandSet = new Set();
        let iterationCount = 0;
        while (iterationCount < maxIter) {
          iterationCount++;
          const isolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
          if (isolationResult.isolatedTractIds.size === 0) break;
          try {
            const moveResult = algorithmService.moveIsolatedComponentsByAdjacency(updatedGroups, allTracts, isolationResult, step0IslandSet);
            updatedGroups = moveResult.districtGroups;
            if (moveResult.unmovableTractIds && moveResult.unmovableTractIds.length > 0) {
              moveResult.unmovableTractIds.forEach(id => step0IslandSet.add(id));
              console.log(`🏝️ Final step: added ${moveResult.unmovableTractIds.length} unmovable tract(s) to island list for this step: ${moveResult.unmovableTractIds.slice(0, 5).join(', ')}${moveResult.unmovableTractIds.length > 5 ? '...' : ''}`);
            }
            if (moveResult.movedTractCount === 0) break;
          } catch (moveErr) {
            return res.status(500).json({ error: 'Failed to move isolated tracts (final step)', message: moveErr.message });
          }
        }
      } else {
        // Non-final step: use sibling-only move (existing behavior)
        let isolatedTractsByGroup = frontendIsolatedTractsData.isolatedTractsByGroup;
        let groupIndices = Object.keys(isolatedTractsByGroup).map(idx => parseInt(idx)).sort((a, b) => a - b);
        let iterationCount = 0;
        const skippedByGroup = {};
        while (groupIndices.length > 0 && iterationCount < maxIter) {
          iterationCount++;
          for (const groupIndex of groupIndices) {
            const isolatedTractIds = isolatedTractsByGroup[groupIndex.toString()] || [];
            if (isolatedTractIds.length === 0) continue;
            try {
              const result = algorithmService.moveIsolatedTractsToOppositeGroup(
                updatedGroups, allTracts, groupIndex, isolatedTractIds, divisionLines.length ? divisionLines : null, true
              );
              updatedGroups = result.districtGroups;
              if (result.skippedTractIds && result.skippedTractIds.length > 0) {
                if (!skippedByGroup[groupIndex]) skippedByGroup[groupIndex] = new Set();
                result.skippedTractIds.forEach(id => skippedByGroup[groupIndex].add(id));
              }
            } catch (moveErr) {
              return res.status(500).json({ error: 'Failed to move isolated tracts', message: moveErr.message });
            }
          }
          const isolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
          if (isolationResult.isolatedTractIds.size === 0) break;
          isolatedTractsByGroup = {};
          isolationResult.isolatedTractsByGroup.forEach((tractIds, idx) => {
            const skipped = skippedByGroup[idx];
            const list = Array.from(tractIds);
            const filtered = skipped ? list.filter(id => !skipped.has(id)) : list;
            if (filtered.length > 0) isolatedTractsByGroup[idx] = filtered;
          });
          groupIndices = Object.keys(isolatedTractsByGroup).map(idx => parseInt(idx)).sort((a, b) => a - b);
        }
      }

      const finalIsolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
      const finalIsolatedTractsByGroup = {};
      finalIsolationResult.isolatedTractsByGroup.forEach((tractIds, idx) => { finalIsolatedTractsByGroup[idx] = Array.from(tractIds); });

      const totalRemaining = finalIsolationResult.isolatedTractIds.size;
      const stepCompleteForUnions = totalRemaining === 0 && step > 0;
      const excludedTractIdsForStep = step0IslandSet && step0IslandSet.size > 0 ? Array.from(step0IslandSet) : undefined;
      if (stepCompleteForUnions) {
        // Persist updated step to cache before triggering POST union-polygons so the job uses post-move DG tracts
        const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${step}`;
        const tractCacheKey = `state_tracts_${state}`;
        const stepPayload = {
          state,
          step,
          districtGroups: updatedGroups,
          divisionLines: bodyDivisionLines || [],
          isolatedTractsData: {
            isolatedTractsByGroup: finalIsolatedTractsByGroup,
            isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
            totalIsolated: finalIsolationResult.isolatedTractIds.size,
            groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
          },
          ...(excludedTractIdsForStep && excludedTractIdsForStep.length > 0 && { excludedTractIds: excludedTractIdsForStep })
        };
        const normalizedStep = normalizeStepData(stepPayload, tractCacheKey);
        const cacheData = {
          stepData: normalizedStep.normalized,
          isComplete: false, // Only final algorithm step is complete; this step still has more divisions to run
          algorithmVersion: ALGORITHM_VERSION,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          source: 'algorithm-step-cache',
          normalized: true,
          tractCacheKey,
          state,
          step,
          unionPolygonsCached: false
        };
        try {
          await setStepCache(stepCacheKey, cacheData);
          console.log(`💾 STEP CACHE STORED (fast path): Saved updated step ${step} for ${state} before POST union-polygons`);
        } catch (cacheErr) {
          console.warn(`⚠️ Failed to save step cache before union-polygons (fast path): ${cacheErr.message}`);
        }
        const isFinalStep = updatedGroups.length > 0 && updatedGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
        if (isFinalStep) {
          console.log(`📤 Step complete after move-all-isolated (final step): requesting POST build-all-union-polygons for ${state} step ${step}`);
          const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
          const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${state}?finalStepNumber=${step}&maxIterations=${maxIterations}`;
          setImmediate(() => {
            axios.post(buildAllUrl, {}).then(() => {
              console.log(`✅ POST build-all-union-polygons accepted (202) for ${state} final step ${step}`);
            }).catch((err) => {
              console.error(`❌ Failed to trigger build-all union polygon job for ${state}:`, err.message);
            });
          });
        }
      }
      // Union polygons are built async via build-all job when final step completes; client can poll GET or show tracts with blended borders
      return res.json({
        districtGroups: updatedGroups,
        isolationResult: {
          isolatedTractsByGroup: finalIsolatedTractsByGroup,
          isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
          totalIsolated: totalRemaining,
          groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
        },
        ...(excludedTractIdsForStep && excludedTractIdsForStep.length > 0 && { excludedTractIds: excludedTractIdsForStep }),
        ...(totalRemaining > 0 && { hint: 'Some tracts could not be moved (no adjacent tract in target group). Try Detect Bridge Tracts, then Move Bridge Tracts.' })
      });
    }

    logger.info(`🔄 Moving all isolated tracts for ${state} step ${step} (cache path)`);

    // Get algorithm state
    const stateKey = getAlgorithmStateKey(state, maxIterations);
    console.log(`🔍 Looking for algorithm state with key: ${stateKey}`);
    let algorithmState = await getCachedAlgorithmState(stateKey);

    const currentVersion = ALGORITHM_VERSION;

    // If algorithm state not found, try to reconstruct it from cached step
    if (!algorithmState) {
      console.log(`⚠️ Algorithm state not found, attempting to reconstruct from cached step ${step}...`);
      
      // Try both step cache key formats (same as get-step): algorithm_step_ first, then step_
      const algoStepKey = `algorithm_step_${state}_${maxIterations}_${step}`;
      let stepDoc = await getCacheDoc(algoStepKey);
      let cachedEntry = stepDoc || null;

      if (cachedEntry) {
        if (cachedEntry.timestamp && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
          cachedEntry = null;
        } else if (cachedEntry.algorithmVersion !== currentVersion) {
          cachedEntry = null;
        }
      }

      if (!cachedEntry) {
        stepDoc = await getCacheDoc(`step_${state}_${step}_${currentVersion}`);
        if (stepDoc) {
          cachedEntry = stepDoc;
          if (cachedEntry.timestamp && cachedEntry.ttl && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
            cachedEntry = null;
          } else if (cachedEntry.algorithmVersion !== currentVersion) {
            cachedEntry = null;
          }
        }
      }

      if (!cachedEntry) {
        console.error(`❌ Step ${step} cache not found for ${state}`);
        return res.status(404).json({ error: `Step ${step} not found in cache. Please initialize the algorithm first.` });
      }

      const hasStepDataField = cachedEntry.stepData !== undefined;
      const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
      deserializeStepDataFromFirestore(dataToReconstruct);
      if (!dataToReconstruct || !dataToReconstruct.districtGroups) {
        console.error(`❌ Step ${step} cache exists but has no step data or districtGroups`);
        return res.status(404).json({ error: `Step ${step} cache is incomplete. Please re-run the algorithm.` });
      }

      // Get state tract cache (try state as-is, then lowercase, then uppercase for key flexibility)
      const tractCacheKeysToTry = [
        `state_tracts_${state}`,
        `state_tracts_${state.toLowerCase()}`,
        `state_tracts_${state.toUpperCase()}`
      ].filter((key, idx, arr) => arr.indexOf(key) === idx);
      let stateTractDoc = null;
      let tractCacheKey = null;
      for (const key of tractCacheKeysToTry) {
        const doc = await getCacheDoc(key);
        if (doc) {
          stateTractDoc = doc;
          tractCacheKey = key;
          break;
        }
      }
      if (!stateTractDoc || !stateTractDoc.exists) {
        console.error(`❌ State tract cache not found for ${state} (tried: ${tractCacheKeysToTry.join(', ')})`);
        return res.status(404).json({ error: `State tract cache not found. Please initialize the algorithm first.` });
      }

      const stateTractData = stateTractDoc;
      let tractMap = null;
      
      // Get tract map from Cloud Storage or Firestore
      if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
        const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
        if (cloudStorageResult && cloudStorageResult.data) {
          tractMap = cloudStorageResult.data;
        }
      } else if (stateTractData.chunked && stateTractData.chunkKeys) {
        const chunkDocs = await Promise.all(
          stateTractData.chunkKeys.map(key => getCacheDoc(key))
        );
        const allTracts = [];
        for (const chunkDoc of chunkDocs) {
          if (chunkDoc && chunkDoc.data) {
            allTracts.push(...chunkDoc.data);
          }
        }
        tractMap = allTracts;
      } else if (stateTractData.data) {
        tractMap = stateTractData.data;
      }
      
      if (!tractMap) {
        console.error(`❌ Could not retrieve tract map from state cache`);
        return res.status(404).json({ error: `Could not retrieve tract data. Please re-run the algorithm.` });
      }
      
      // Reconstruct step data
      const stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, false, state);
      if (!stepData || !stepData.districtGroups) {
        console.error(`❌ Failed to reconstruct step ${step} from cache`);
        return res.status(404).json({ error: `Failed to reconstruct step ${step}. Please re-run the algorithm.` });
      }
      
      // Build algorithm state from reconstructed step
      // Extract uniqueTracts from tractMap
      const { getTractId } = require('./services/geodistrict-algorithm');
      const uniqueTracts = [];
      if (Array.isArray(tractMap)) {
        // Check if it's [id, tract] pairs or just tracts
        if (tractMap.length > 0 && Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
          uniqueTracts.push(...tractMap.map(([id, tract]) => tract));
        } else {
          uniqueTracts.push(...tractMap);
        }
      } else if (tractMap instanceof Map) {
        uniqueTracts.push(...Array.from(tractMap.values()));
      } else if (typeof tractMap === 'object') {
        uniqueTracts.push(...Object.values(tractMap));
      }
      
      // Calculate population
      const totalStatePopulation = uniqueTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
      const totalDistricts = getDistrictsForState(state);
      const targetDistrictPopulation = totalStatePopulation / totalDistricts;
      
      // Build steps array (we only have the current step, so create minimal array)
      const steps = [];
      for (let i = 0; i <= step; i++) {
        steps.push(null); // Pad with nulls
      }
      steps[step] = stepData;
      
      // Reconstruct algorithm state
      algorithmState = {
        uniqueTracts,
        currentGroups: stepData.districtGroups,
        iteration: step,
        steps: steps,
        algorithmHistory: [],
        totalStatePopulation,
        targetDistrictPopulation,
        maxIterations,
        state: state
      };
      
      // Cache reconstructed algorithm state
      await cacheAlgorithmState(stateKey, algorithmState);
      console.log(`✅ Reconstructed and cached algorithm state from cached step ${step} for ${state}`);
    }

    // Get current step from algorithm state
    if (!algorithmState.steps || algorithmState.steps.length <= step) {
      return res.status(404).json({ error: `Step ${step} not found in algorithm state` });
    }

    let currentStep = algorithmState.steps[step];

    // If step was loaded from cached algorithm state, groups may be normalized (censusTractIds only, no censusTracts).
    // Reconstruct from step cache so we have full censusTracts for the move.
    const needsReconstruct = currentStep.districtGroups && currentStep.districtGroups.some(g =>
      !Array.isArray(g.censusTracts) || (g.censusTractIds && g.censusTractIds.length > 0 && (!g.censusTracts || g.censusTracts.length === 0))
    );
    if (needsReconstruct) {
      console.log(`⚠️ Step ${step} has normalized groups (no censusTracts), reconstructing from step cache...`);
      const algoStepKeyReconstruct = `algorithm_step_${state}_${maxIterations}_${step}`;
      let stepDoc = await getCacheDoc(algoStepKeyReconstruct);
      let cachedEntry = stepDoc || null;
      if (cachedEntry && cachedEntry.timestamp && !isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl) && cachedEntry.algorithmVersion === currentVersion) {
        // use as-is
      } else {
        cachedEntry = null;
        stepDoc = await getCacheDoc(`step_${state}_${step}_${currentVersion}`);
        if (stepDoc) {
          cachedEntry = stepDoc;
          if (cachedEntry && ((cachedEntry.timestamp && cachedEntry.ttl && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) || cachedEntry.algorithmVersion !== currentVersion)) {
            cachedEntry = null;
          }
        }
      }
      if (cachedEntry) {
        const hasStepDataField = cachedEntry.stepData !== undefined;
        const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
        deserializeStepDataFromFirestore(dataToReconstruct);
        const tractCacheKeysToTry = [`state_tracts_${state}`, `state_tracts_${state.toLowerCase()}`, `state_tracts_${state.toUpperCase()}`];
        let tractMap = null;
        for (const key of tractCacheKeysToTry) {
          const stateTractDoc = await getCacheDoc(key);
          if (!stateTractDoc.exists) continue;
          const stateTractData = stateTractDoc;
          if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
            const cloudStorageResult = await cloudStorageCache.get(key);
            if (cloudStorageResult && cloudStorageResult.data) tractMap = cloudStorageResult.data;
          } else if (stateTractData.chunked && stateTractData.chunkKeys) {
            const chunkDocs = await Promise.all(stateTractData.chunkKeys.map(k => getCacheDoc(k)));
            tractMap = [];
            for (const chunkDoc of chunkDocs) {
              if (chunkDoc && chunkDoc.data) tractMap.push(...chunkDoc.data);
            }
          } else if (stateTractData.data) {
            tractMap = stateTractData.data;
          }
          if (tractMap) break;
        }
        if (tractMap) {
          const stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, false, state);
          if (stepData && stepData.districtGroups) {
            currentStep = stepData;
            algorithmState.steps[step] = stepData;
            if (!algorithmState.uniqueTracts) {
              const uniqueTracts = [];
              if (Array.isArray(tractMap)) {
                if (tractMap.length > 0 && Array.isArray(tractMap[0]) && tractMap[0].length === 2) {
                  uniqueTracts.push(...tractMap.map(([id, t]) => t));
                } else {
                  uniqueTracts.push(...tractMap);
                }
              } else if (tractMap instanceof Map) {
                uniqueTracts.push(...Array.from(tractMap.values()));
              } else if (typeof tractMap === 'object') {
                uniqueTracts.push(...Object.values(tractMap));
              }
              algorithmState.uniqueTracts = uniqueTracts;
            }
            console.log(`✅ Reconstructed step ${step} with full censusTracts for move`);
          }
        }
      }
    }

    const step0IslandSetForMove = buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds, state);

    // Check if S4 adjacency data is available (if not, cached data might be broken)
    let hasS4Data = false;
    try {
      const s4DataLoader = require('./services/s4-data-loader');
      const stateForS4 = s4DataLoader.normalizeStateForS4(state);
      await s4DataLoader.loadS4AdjacencyData(stateForS4);
      hasS4Data = true;
      console.log(`✅ S4 adjacency data available for ${stateForS4} - will prefer fresh detection over potentially broken cached data`);
    } catch (s4Err) {
      console.log(`⚠️ S4 adjacency data not available for ${state} - will use cached isolated data`);
    }

    // Get isolated tracts data: prefer request body (client's isolated list), then validated dgAdjacentGroupsByGroup, then step cache, then detect.
    // Use req.body explicitly so we never miss body-isolated when cache path runs.
    const bodyIsolated = req.body && req.body.isolatedTractsData && req.body.isolatedTractsData.isolatedTractsByGroup &&
      typeof req.body.isolatedTractsData.isolatedTractsByGroup === 'object' &&
      Object.keys(req.body.isolatedTractsData.isolatedTractsByGroup).length > 0
      ? req.body.isolatedTractsData.isolatedTractsByGroup
      : null;

    const numGroups = currentStep.districtGroups && currentStep.districtGroups.length;
    const dgAdjacentValid = currentStep.dgAdjacentGroupsByGroup && typeof currentStep.dgAdjacentGroupsByGroup === 'object' &&
      Object.keys(currentStep.dgAdjacentGroupsByGroup).length > 0 &&
      (numGroups == null || Object.keys(currentStep.dgAdjacentGroupsByGroup).length === numGroups);

    const MAX_ISOLATED_PER_GROUP = 200; // Reject derived/cached lists that look like wrong-step (e.g. half state)
    const MAX_ISOLATED_TOTAL = 500;     // Reject body/cache when total isolated is huge (stale/wrong step)
    const isReasonableIsolatedList = (byGroup) => {
      if (!byGroup || typeof byGroup !== 'object') return false;
      let total = 0;
      for (const list of Object.values(byGroup)) {
        const n = Array.isArray(list) ? list.length : 0;
        if (n > MAX_ISOLATED_PER_GROUP) return false;
        total += n;
      }
      return total <= MAX_ISOLATED_TOTAL;
    };

    // Log at start what we're trying to get
    console.log(`🔄 MOVE ISOLATED: Starting for step ${step}, checking sources in order: body → stepCacheDoc → stepCache → dgAdjacent → detect`);

    let isolatedTractsByGroup = {};
    let isolatedSource = null; // 'body' | 'stepCacheDoc' | 'stepCache' | 'dgAdjacent' | 'detect'
    if (bodyIsolated && isReasonableIsolatedList(bodyIsolated)) {
      isolatedTractsByGroup = bodyIsolated;
      isolatedSource = 'body';
      const total = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      const sample = Object.entries(isolatedTractsByGroup).flatMap(([k, arr]) => (Array.isArray(arr) ? arr : []).slice(0, 5)).slice(0, 10);
      console.log(`📥 MOVE ISOLATED: Using isolated tracts from request body: total=${total}, groups=${Object.keys(isolatedTractsByGroup).length}, sample IDs: ${sample.join(', ')}${total > 10 ? '...' : ''}`);
    } else if (bodyIsolated) {
      console.warn(`⚠️ MOVE ISOLATED: Rejecting body isolated list (per-group >${MAX_ISOLATED_PER_GROUP} or total >${MAX_ISOLATED_TOTAL}), will use cache or detect`);
    }

    // Prefer step cache doc (written when step was created) over in-memory state / dgAdjacent so we use the correct cached list
    if (Object.keys(isolatedTractsByGroup).length === 0 && step > 0) {
      const algoStepKey = `algorithm_step_${state}_${maxIterations}_${step}`;
      let stepDoc = await getCacheDoc(algoStepKey);
      let stepCachedEntry = stepDoc || null;
      if (stepCachedEntry && stepCachedEntry.algorithmVersion === currentVersion && stepCachedEntry.stepData && stepCachedEntry.stepData.isolatedTractsData) {
        const cachedByGroup = stepCachedEntry.stepData.isolatedTractsData.isolatedTractsByGroup;
        if (cachedByGroup && typeof cachedByGroup === 'object' && isReasonableIsolatedList(cachedByGroup)) {
          isolatedTractsByGroup = cachedByGroup;
          isolatedSource = 'stepCacheDoc';
          currentStep.isolatedTractsData = stepCachedEntry.stepData.isolatedTractsData;
          algorithmState.steps[step] = currentStep;
          const total = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
          const sample = Object.entries(isolatedTractsByGroup).flatMap(([k, arr]) => (Array.isArray(arr) ? arr : []).slice(0, 5)).slice(0, 10);
          console.log(`📥 MOVE ISOLATED: Using isolated tracts from step cache doc (algorithm_step_*): total=${total}, groups=${Object.keys(isolatedTractsByGroup).length}, sample IDs: ${sample.join(', ')}${total > 10 ? '...' : ''}`);
        }
      }
      if (Object.keys(isolatedTractsByGroup).length === 0) {
        stepDoc = await getCacheDoc(`step_${state}_${step}_${currentVersion}`);
        stepCachedEntry = stepDoc || null;
        const dataToUse = stepCachedEntry?.stepData !== undefined ? stepCachedEntry.stepData : stepCachedEntry;
        if (dataToUse?.isolatedTractsData?.isolatedTractsByGroup && isReasonableIsolatedList(dataToUse.isolatedTractsData.isolatedTractsByGroup)) {
          isolatedTractsByGroup = dataToUse.isolatedTractsData.isolatedTractsByGroup;
          isolatedSource = 'stepCacheDoc';
          currentStep.isolatedTractsData = dataToUse.isolatedTractsData;
          algorithmState.steps[step] = currentStep;
          const total = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
          console.log(`📥 MOVE ISOLATED: Using isolated tracts from step cache doc (step_*): total=${total}, groups=${Object.keys(isolatedTractsByGroup).length}`);
        }
      }
    }

    if (Object.keys(isolatedTractsByGroup).length === 0 && currentStep.isolatedTractsData && currentStep.isolatedTractsData.isolatedTractsByGroup && Object.keys(currentStep.isolatedTractsData.isolatedTractsByGroup).length > 0) {
      if (isReasonableIsolatedList(currentStep.isolatedTractsData.isolatedTractsByGroup)) {
        isolatedTractsByGroup = currentStep.isolatedTractsData.isolatedTractsByGroup;
        isolatedSource = 'stepCache';
        const total = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
        const sample = Object.entries(isolatedTractsByGroup).flatMap(([k, arr]) => (Array.isArray(arr) ? arr : []).slice(0, 5)).slice(0, 10);
        console.log(`📥 MOVE ISOLATED: Using isolated tracts from in-memory step cache: total=${total}, groups=${Object.keys(isolatedTractsByGroup).length}, sample IDs: ${sample.join(', ')}${total > 10 ? '...' : ''}`);
      } else {
        console.warn(`⚠️ Step cache isolated list has >${MAX_ISOLATED_PER_GROUP} in a group or total >${MAX_ISOLATED_TOTAL} (wrong step?), skipping step cache`);
      }
    }
    if (Object.keys(isolatedTractsByGroup).length === 0 && dgAdjacentValid) {
      const derived = deriveIsolatedFromDgAdjacentGroups(currentStep.dgAdjacentGroupsByGroup, step0IslandSetForMove);
      if (isReasonableIsolatedList(derived.isolatedTractsByGroup)) {
        isolatedTractsByGroup = derived.isolatedTractsByGroup;
        isolatedSource = 'dgAdjacent';
        const total = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
        console.log(`📥 MOVE ISOLATED: Using isolated tracts derived from dgAdjacentGroupsByGroup: total=${total}, groups=${Object.keys(isolatedTractsByGroup).length}`);
      } else {
        console.warn(`⚠️ Derived isolated list has >${MAX_ISOLATED_PER_GROUP} in a group or total >${MAX_ISOLATED_TOTAL} (wrong step?), skipping dgAdjacentGroupsByGroup`);
      }
    }

    // If we have cached data but it looks broken (e.g. almost all tracts isolated when S4 data is available), prefer fresh detection
    const totalTractsInGroups = currentStep.districtGroups?.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0) || 0;
    const cachedTotal = Object.values(isolatedTractsByGroup).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    const looksBroken = hasS4Data && cachedTotal > 0 && totalTractsInGroups > 100 && cachedTotal > totalTractsInGroups * 0.5; // >50% of tracts isolated looks suspicious

    if (looksBroken && isolatedSource !== 'detect') {
      console.log(`⚠️ Cached isolated data looks broken (${cachedTotal} of ${totalTractsInGroups} tracts isolated when S4 data available), discarding ${isolatedSource} data and running fresh detection...`);
      Object.keys(isolatedTractsByGroup).forEach(k => delete isolatedTractsByGroup[k]);
      isolatedSource = null;
    }

    if (Object.keys(isolatedTractsByGroup).length === 0) {
      // Last resort: detect (e.g. no cache, first request after step created elsewhere)
      console.log(`${hasS4Data ? '✅' : '⚠️'} ${hasS4Data ? 'Fresh' : 'Fallback'} isolation detection (S4 ${hasS4Data ? 'available' : 'unavailable'})...`);
      if (!algorithmState.uniqueTracts && algorithmState.uniqueTractIds) {
        algorithmState.uniqueTracts = await reconstructUniqueTracts(algorithmState);
      }
      const allTractsForDetect = algorithmState.uniqueTracts || [];
      const step0IslandForDetect = buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds, state);
      const detectionResult = algorithmService.detectIsolatedTracts(currentStep.districtGroups, allTractsForDetect, step, step0IslandForDetect);
      detectionResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
      });
      isolatedSource = 'detect';
      const detTotal = detectionResult.isolatedTractIds.size;
      const detSample = Array.from(detectionResult.isolatedTractIds).slice(0, 10);
      console.log(`📥 MOVE ISOLATED: Using isolated tracts from ${hasS4Data ? 'fresh' : 'fallback'} detection: total=${detTotal}, groups=${Object.keys(isolatedTractsByGroup).length}, sample IDs: ${detSample.join(', ')}${detTotal > 10 ? '...' : ''}`);
      currentStep.isolatedTractsData = {
        isolatedTractsByGroup,
        isolatedTractIds: Array.from(detectionResult.isolatedTractIds),
        totalIsolated: detectionResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(isolatedTractsByGroup).length
      };
      algorithmState.steps[step] = currentStep;
    }

    // Reconstruct uniqueTracts if needed
    if (!algorithmState.uniqueTracts && algorithmState.uniqueTractIds) {
      algorithmState.uniqueTracts = await reconstructUniqueTracts(algorithmState);
    }
    const allTracts = algorithmState.uniqueTracts || [];

    if (step0IslandSetForMove && step0IslandSetForMove.size > 0) {
      console.log(`🏝️ Excluding ${step0IslandSetForMove.size} step-0 island tract(s) from isolation detection`);
    }

    // Get all groups with isolated tracts
    const groupIndices = Object.keys(isolatedTractsByGroup)
      .map(idx => parseInt(idx))
      .sort((a, b) => a - b);

    if (groupIndices.length === 0) {
      return res.json({
        districtGroups: currentStep.districtGroups,
        isolationResult: {
          isolatedTractsByGroup: {},
          isolatedTractIds: [],
          totalIsolated: 0,
          groupsWithIsolation: 0
        },
        message: 'No isolated tracts to move'
      });
    }

    console.log(`🔄 Processing ${groupIndices.length} group(s) with isolated tracts: ${groupIndices.join(', ')}`);

    // Process all groups with isolated tracts recursively until no more isolated tracts remain
    // Guard: ensure every group has iterable censusTracts (reconstructed steps should have arrays)
    let updatedGroups = currentStep.districtGroups.map(group => {
      const tracts = Array.isArray(group.censusTracts) ? group.censusTracts : [];
      return { ...group, censusTracts: [...tracts] };
    });

    let iterationCount = 0;
    const maxProcessingIterations = 10; // Safety limit to prevent infinite loops
    // Tracts we skipped (no neighbor in any group) per group - do not retry to avoid infinite loop
    const skippedByGroup = {};

    // Recursively process until no more isolated tracts remain
    while (groupIndices.length > 0 && iterationCount < maxProcessingIterations) {
      iterationCount++;
      // One line per iteration

      // Process each group sequentially in this iteration
      for (const groupIndex of groupIndices) {
        const isolatedTractIds = isolatedTractsByGroup[groupIndex.toString()] || [];
        
        if (isolatedTractIds.length === 0) {
          continue;
        }

        // Per-group move summary (no per-tract logs)

        try {
          const result = algorithmService.moveIsolatedTractsToOppositeGroup(
            updatedGroups,
            allTracts,
            groupIndex,
            isolatedTractIds,
            currentStep.divisionLines || null,
            true
          );
          updatedGroups = result.districtGroups;
          if (result.skippedTractIds && result.skippedTractIds.length > 0) {
            if (!skippedByGroup[groupIndex]) skippedByGroup[groupIndex] = new Set();
            result.skippedTractIds.forEach(id => skippedByGroup[groupIndex].add(id));
          }
        } catch (moveErr) {
          console.error(`❌ moveIsolatedTractsToOppositeGroup failed for group ${groupIndex}:`, moveErr.message);
          return res.status(500).json({
            error: 'Failed to move isolated tracts',
            message: moveErr.message || 'Cannot find sibling group. Ensure the step was cached with division lines.'
          });
        }
      }

      // Re-detect isolation after all moves in this iteration
      const isolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSetForMove);
      
      // Convert Map to object; exclude skipped tracts so we don't retry them (avoids infinite loop)
      const newIsolatedTractsByGroup = {};
      isolationResult.isolatedTractsByGroup.forEach((tractIds, idx) => {
        const skipped = skippedByGroup[idx];
        const list = Array.from(tractIds);
        const filtered = skipped ? list.filter(id => !skipped.has(id)) : list;
        if (filtered.length > 0) newIsolatedTractsByGroup[idx] = filtered;
      });

      // Check if we're done (no remaining movable isolated tracts)
      const remainingCount = Object.values(newIsolatedTractsByGroup).reduce((sum, arr) => sum + arr.length, 0);
      if (remainingCount === 0) {
        console.log(`✅ All movable isolated tracts moved after ${iterationCount} iteration(s)`);
        break;
      }

      // Update for next iteration
      isolatedTractsByGroup = newIsolatedTractsByGroup;
      const newGroupIndices = Object.keys(isolatedTractsByGroup)
        .map(idx => parseInt(idx))
        .sort((a, b) => a - b);
      
      groupIndices.length = 0;
      groupIndices.push(...newGroupIndices);
    }

    if (iterationCount >= maxProcessingIterations) {
      console.warn(`⚠️ Reached max iterations (${maxProcessingIterations}) while processing isolated tracts`);
    }

    // Final isolation detection
    const finalIsolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSetForMove);
    
    // Convert isolation result Map to object for JSON serialization
    const finalIsolatedTractsByGroup = {};
    finalIsolationResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
      finalIsolatedTractsByGroup[groupIndex] = Array.from(tractIds);
    });

    // Update algorithm state
    algorithmState.currentGroups = updatedGroups;
    algorithmState.steps[step] = {
      ...currentStep,
      districtGroups: updatedGroups,
      isolatedTractsData: {
        isolatedTractsByGroup: finalIsolatedTractsByGroup,
        isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
        totalIsolated: finalIsolationResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
      }
    };
    
    // Cache updated algorithm state
    await cacheAlgorithmState(stateKey, algorithmState);

    // Invalidate cached step and all subsequent steps
    const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${step}`;
    try {
      await deleteCacheDoc(stepCacheKey);
      console.log(`🗑️ Invalidated cached step ${step} for ${state} after moving isolated tracts`);
    } catch (deleteError) {
      console.warn(`⚠️ Failed to invalidate cached step ${step}: ${deleteError.message}`);
    }

    // Invalidate all subsequent step caches
    await invalidateSubsequentStepCaches(state, maxIterations, step);

    // Save the updated step back to cache; union polygons will be built by async job (POST .../union-polygons)
    // This ensures that on page reload, the final step with moved tracts is loaded
    try {
      const tractCacheKey = `state_tracts_${state}`;
      const updatedStep = {
        ...currentStep,
        districtGroups: updatedGroups,
        isolatedTractsData: {
          isolatedTractsByGroup: finalIsolatedTractsByGroup,
          isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
          totalIsolated: finalIsolationResult.isolatedTractIds.size,
          groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
        }
      };

      // Normalize step data (store tract IDs instead of full geometries)
      const normalizedStep = normalizeStepData(updatedStep, tractCacheKey);
      const totalRemaining = finalIsolationResult.isolatedTractIds.size;
      const stepCompleteForUnions = totalRemaining === 0 && step > 0;

      // Save the updated step to cache; union polygons built async via job
      const cacheData = {
        stepData: normalizedStep.normalized,
        isComplete: stepCompleteForUnions, // True when all movable isolated tracts have been moved
        algorithmVersion: ALGORITHM_VERSION,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        source: 'algorithm-step-cache',
        normalized: true,
        tractCacheKey: tractCacheKey,
        state: state,
        step: step,
        unionPolygonsCached: false
      };

      await setStepCache(stepCacheKey, cacheData);
      console.log(`💾 STEP CACHE STORED: Saved updated step ${step} for ${state} (union polygons built when final step completes)`);
      if (stepCompleteForUnions) {
        const isFinalStep = updatedGroups.length > 0 && updatedGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
        if (isFinalStep) {
          console.log(`📤 Step complete after move-all-isolated (final step): requesting POST build-all-union-polygons for ${state} step ${step}`);
          const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
          const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${state}?finalStepNumber=${step}&maxIterations=${maxIterations}`;
          setImmediate(() => {
            axios.post(buildAllUrl, {}).then(() => {
              console.log(`✅ POST build-all-union-polygons accepted (202) for ${state} final step ${step}`);
            }).catch((err) => {
              console.error(`❌ Failed to trigger build-all union polygon job for ${state}:`, err.message);
            });
          });
        }
      }
    } catch (cacheError) {
      console.warn(`⚠️ STEP CACHE STORE ERROR: Failed to save updated step after moving isolated tracts: ${cacheError.message}`);
      // Don't fail the request if caching fails
    }

    // Reduce response payload: aggressively simplify union geometry for JSON (client timeout avoidance).
    // Cached polygons in Cloud Storage keep full precision; response uses 4 decimals + Douglas–Peucker.
    const responseGroups = updatedGroups.map(g => {
      const out = { ...g };
      if (g.unionPolygon?.geometry) {
        out.unionPolygon = {
          ...g.unionPolygon,
          geometry: simplifyUnionGeometry(g.unionPolygon.geometry, {
            decimals: 4,
            removeDuplicatePoints: true,
            simplifyTolerance: 0.0001
          })
        };
      }
      if (Array.isArray(g.unionPolygons) && g.unionPolygons.length > 0) {
        out.unionPolygons = g.unionPolygons.map(f => (f?.geometry
          ? { ...f, geometry: simplifyUnionGeometry(f.geometry, { decimals: 4, removeDuplicatePoints: true, simplifyTolerance: 0.0001 }) }
          : f));
      }
      return out;
    });

    res.json({
      districtGroups: responseGroups,
      isolationResult: {
        isolatedTractsByGroup: finalIsolatedTractsByGroup,
        isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
        totalIsolated: finalIsolationResult.isolatedTractIds.size,
        groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
      }
    });
  } catch (error) {
    console.error('Error moving all isolated tracts:', error);
    res.status(500).json({
      error: 'Failed to move all isolated tracts',
      message: error.message
    });
  }
});

/**
 * POST /api/algorithm/balance-after-isolated
 * At final step: run variance-prioritized balance until tolerance or best, then resolve isolated tracts, then balance again; divisionLines optional.
 * Otherwise: run balanceSiblingPairsAfterIsolatedMoves (divisionLines required).
 */
app.post('/api/algorithm/balance-after-isolated', async (req, res) => {
  try {
    const { state, step, districtGroups, divisionLines, step0IslandTractIds: bodyStep0IslandTractIds, maxIterations: bodyMaxIterations } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }
    if (typeof step !== 'number' || step < 0) {
      return res.status(400).json({ error: 'Valid step number is required' });
    }
    if (!Array.isArray(districtGroups) || districtGroups.length === 0) {
      return res.status(400).json({ error: 'districtGroups is required and must be a non-empty array' });
    }

    const isFinalStep = districtGroups.length > 0 && districtGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);
    if (!isFinalStep && (!Array.isArray(divisionLines) || divisionLines.length === 0)) {
      return res.status(400).json({ error: 'divisionLines is required and must be a non-empty array when not at final step' });
    }

    try {
      const s4DataLoader = require('./services/s4-data-loader');
      const stateForS4 = s4DataLoader.normalizeStateForS4(state);
      await s4DataLoader.loadS4AdjacencyData(stateForS4);
    } catch (s4Err) {
      console.warn(`⚠️ Failed to load S4 adjacency data for ${state}: ${s4Err.message}`);
    }

    const { getTractId } = require('./services/geodistrict-algorithm');
    const allTracts = [];
    for (const group of districtGroups) {
      for (const t of group.censusTracts || []) {
        if (t && getTractId(t)) allTracts.push(t);
      }
    }
    const updatedGroups = districtGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));

    let balanced;
    let noMoreBalancingPossible;
    if (isFinalStep) {
      const totalPopulation = updatedGroups.reduce((sum, g) => sum + (g.censusTracts || []).reduce((s, t) => s + (t.properties?.POPULATION || 0), 0), 0);
      const targetDistrictPopulation = totalPopulation / updatedGroups.length;
      const maxAbsVariancePercent = (groups) => {
        let max = 0;
        for (const g of groups) {
          const pop = (g.censusTracts || []).reduce((s, t) => s + (t.properties?.POPULATION || 0), 0);
          const n = g.totalDistricts != null ? g.totalDistricts : (g.endDistrictNumber - g.startDistrictNumber + 1);
          const target = targetDistrictPopulation * n;
          if (target <= 0) continue;
          const v = Math.abs(((pop - target) / target) * 100);
          if (v > max) max = v;
        }
        return max;
      };
      const improvementThresholdPercent = 1.0; // target variance; stop when balance doesn't improve by at least this much
      // Balance until within tolerance or no improving move
      balanced = algorithmService.balanceDistrictsByVariance(updatedGroups, allTracts, targetDistrictPopulation);
      let step0IslandSet = Array.isArray(bodyStep0IslandTractIds) ? new Set(bodyStep0IslandTractIds) : new Set();
      noMoreBalancingPossible = false;
      const maxIsolationIter = 10;
      const resolveIsolated = () => {
        for (let isoIter = 0; isoIter < maxIsolationIter; isoIter++) {
          const isolationResult = algorithmService.detectIsolatedTracts(balanced, allTracts, step, step0IslandSet);
          if (isolationResult.isolatedTractIds.size === 0) return;
          try {
            const moveResult = algorithmService.moveIsolatedComponentsByAdjacency(balanced, allTracts, isolationResult, step0IslandSet);
            balanced = moveResult.districtGroups;
            if (moveResult.unmovableTractIds && moveResult.unmovableTractIds.length > 0) {
              moveResult.unmovableTractIds.forEach(id => step0IslandSet.add(id));
            }
            if (moveResult.movedTractCount === 0) return;
          } catch (moveErr) {
            console.warn(`Balance-after-isolated: move isolated failed: ${moveErr.message}`);
            return;
          }
        }
      };
      resolveIsolated();
      const worstBeforeSecond = maxAbsVariancePercent(balanced);
      balanced = algorithmService.balanceDistrictsByVariance(balanced, allTracts, targetDistrictPopulation);
      const worstAfterSecond = maxAbsVariancePercent(balanced);
      // If second balance didn't improve worst variance by at least threshold, we've balanced as far as possible
      if (worstBeforeSecond - worstAfterSecond < improvementThresholdPercent) {
        noMoreBalancingPossible = true;
        // Skip third balance; some districts may remain outside target variance
      } else {
        resolveIsolated();
        balanced = algorithmService.balanceDistrictsByVariance(balanced, allTracts, targetDistrictPopulation);
      }
    } else {
      balanced = algorithmService.balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, divisionLines);
    }

    // At final step, mark step complete and trigger union polygon creation so the balanced result is persisted
    if (isFinalStep && balanced) {
      const maxIterations = typeof bodyMaxIterations === 'number' && bodyMaxIterations > 0 ? bodyMaxIterations : 100;
      const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${step}`;
      const tractCacheKey = `state_tracts_${state}`;
      const excludedTractIdsForStep = (bodyStep0IslandTractIds && Array.isArray(bodyStep0IslandTractIds) && bodyStep0IslandTractIds.length > 0) ? bodyStep0IslandTractIds : undefined;
      const stepPayload = {
        state,
        step,
        districtGroups: balanced,
        divisionLines: Array.isArray(divisionLines) ? divisionLines : [],
        isolatedTractsData: {
          isolatedTractsByGroup: {},
          isolatedTractIds: [],
          totalIsolated: 0,
          groupsWithIsolation: 0
        },
        ...(excludedTractIdsForStep && { excludedTractIds: excludedTractIdsForStep })
      };
      const normalizedStep = normalizeStepData(stepPayload, tractCacheKey);
      const cacheData = {
        stepData: normalizedStep.normalized,
        isComplete: true,
        algorithmVersion: ALGORITHM_VERSION,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        source: 'algorithm-step-cache',
        normalized: true,
        tractCacheKey,
        state,
        step,
        unionPolygonsCached: false
      };
      try {
        await setStepCache(stepCacheKey, cacheData);
        console.log(`💾 STEP CACHE STORED (balance-after-isolated): Marked final step ${step} complete for ${state}`);
        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${state}?finalStepNumber=${step}&maxIterations=${maxIterations}`;
        const districtPartyUrl = `${baseUrl}/api/algorithm/district-party/${state}?finalStepNumber=${step}&maxIterations=${maxIterations}`;
        setImmediate(() => {
          axios.post(buildAllUrl, {}).then(() => {
            console.log(`✅ POST build-all-union-polygons accepted (202) for ${state} final step ${step} after balance`);
          }).catch((err) => {
            console.error(`❌ Failed to trigger build-all union polygon job for ${state}:`, err.message);
          });
          axios.post(districtPartyUrl, {}).then(() => {
            console.log(`✅ POST district-party accepted (202) for ${state} final step ${step} after balance`);
          }).catch((err) => {
            console.error(`❌ Failed to trigger district-party job for ${state}:`, err.message);
          });
        });
      } catch (cacheErr) {
        console.warn(`⚠️ Failed to save step cache after balance (final step): ${cacheErr.message}`);
      }
    }

    const responsePayload = { districtGroups: balanced };
    if (isFinalStep && typeof noMoreBalancingPossible === 'boolean') {
      responsePayload.noMoreBalancingPossible = noMoreBalancingPossible;
    }
    return res.json(responsePayload);
  } catch (error) {
    console.error('Error balancing after isolated:', error);
    res.status(500).json({
      error: 'Failed to balance districts',
      message: error.message
    });
  }
});

/**
 * GET /api/voter-registration/:state
 * Get voter registration data for a specific state
 */
app.get('/api/voter-registration/:state', async (req, res) => {
  try {
    const { state } = req.params;
    const stateUpper = state.toUpperCase();

    // Check cache first
    const cacheKey = `voter_registration_${stateUpper}`;
    const cached = await getFromCache(cacheKey);
    
    if (cached && cached.data) {
      console.log(`✅ CACHE HIT: Voter registration data for ${state}`);
      // Return the cached data (should already be in the correct format)
      // cached.data should be the VoterRegistrationData object
      return res.json(cached.data);
    }

    // If not cached, check if data exists in storage
    // For now, return status indicating data needs to be fetched
    res.status(404).json({
      state: stateUpper,
      status: 'not_loaded',
      message: `Voter registration data not yet loaded for ${state}. Use POST /api/voter-registration/:state/fetch to load data.`
    });
  } catch (error) {
    console.error(`Error getting voter registration data for ${req.params.state}:`, error);
    res.status(500).json({
      error: 'Failed to get voter registration data',
      message: error.message
    });
  }
});

/**
 * POST /api/voter-registration/:state/fetch
 * Fetch and store voter registration data for a specific state
 */
app.post('/api/voter-registration/:state/fetch', async (req, res) => {
  try {
    const { state } = req.params;
    const stateUpper = state.toUpperCase();
    const { forceRefresh = false } = req.body;

    // Check if already loading
    if (voterRegistrationLoader.isLoading(stateUpper)) {
      return res.status(409).json({
        error: 'Data is already being loaded',
        message: `Voter registration data is currently being fetched for ${state}. Please wait.`
      });
    }

    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheKey = `voter_registration_${stateUpper}`;
      const cached = await getFromCache(cacheKey);
      
      if (cached && cached.data) {
        console.log(`✅ CACHE HIT: Voter registration data for ${state}`);
        return res.json({
          ...cached.data,
          cached: true,
          message: 'Data retrieved from cache. Use forceRefresh=true to fetch fresh data.'
        });
      }
    }

    console.log(`📥 Fetching voter registration data for ${state}...`);

    // Fetch data (this will be async, but we'll wait for it)
    const voterData = await voterRegistrationLoader.fetchVoterRegistrationData(stateUpper);

    // Store in cache
    const cacheKey = `voter_registration_${stateUpper}`;
    const dataSize = JSON.stringify(voterData).length;
    
    // Use Cloud Storage for large files (> 1MB), Firestore for small files
    await setCache(cacheKey, voterData, CACHE_TTL);

    console.log(`✅ Successfully fetched and cached voter registration data for ${state} (${(dataSize / 1024).toFixed(2)} KB)`);

    res.json({
      ...voterData,
      cached: false,
      message: 'Data successfully fetched and cached'
    });

  } catch (error) {
    console.error(`Error fetching voter registration data for ${req.params.state}:`, error);
    res.status(500).json({
      error: 'Failed to fetch voter registration data',
      message: error.message,
      state: req.params.state.toUpperCase()
    });
  }
});

/**
 * GET /api/voter-registration/:state/status
 * Get loading status for a state
 */
app.get('/api/voter-registration/:state/status', async (req, res) => {
  try {
    const { state } = req.params;
    const stateUpper = state.toUpperCase();
    
    const cacheKey = `voter_registration_${stateUpper}`;
    let cached = null;
    let lastUpdated = null;
    
    try {
      cached = await getFromCache(cacheKey);
      if (cached && cached.timestamp) {
        // Handle both number and Date timestamp formats
        const timestamp = typeof cached.timestamp === 'number' 
          ? cached.timestamp 
          : (cached.timestamp instanceof Date ? cached.timestamp.getTime() : Date.parse(cached.timestamp));
        lastUpdated = new Date(timestamp).toISOString();
      }
    } catch (cacheError) {
      console.warn(`⚠️ Error checking cache for ${stateUpper}:`, cacheError.message);
      // Continue without cache data
    }
    
    const dataSource = voterRegistrationLoader.getStateDataSource(stateUpper);
    
    res.json({
      state: stateUpper,
      loading: voterRegistrationLoader.isLoading(stateUpper),
      cached: !!cached,
      dataSource: dataSource || null,
      lastUpdated: lastUpdated
    });
  } catch (error) {
    console.error(`Error getting status for ${req.params.state}:`, error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

/**
 * DELETE /api/voter-registration/:state
 * Delete cached voter registration data for a state
 */
app.delete('/api/voter-registration/:state', async (req, res) => {
  try {
    const { state } = req.params;
    const stateUpper = state.toUpperCase();
    const cacheKey = `voter_registration_${stateUpper}`;

    // Delete from Firestore
    try {
      await deleteCacheDoc(cacheKey);
    } catch (e) {
      // Ignore if doesn't exist
    }

    // Delete from Cloud Storage if exists
    try {
      await cloudStorageCache.delete(cacheKey);
    } catch (e) {
      // Ignore if doesn't exist
    }

    console.log(`🗑️ Deleted cached voter registration data for ${state}`);

    res.json({
      state: stateUpper,
      message: 'Cached data deleted successfully'
    });
  } catch (error) {
    console.error(`Error deleting voter registration data for ${req.params.state}:`, error);
    res.status(500).json({
      error: 'Failed to delete cached data',
      message: error.message
    });
  }
});

/**
 * POLIGEO ANALYST ENDPOINTS
 */

/**
 * GET /api/poligeo/state-summary
 * Get state-level party data summary from VEST data
 */
app.get('/api/poligeo/state-summary', async (req, res) => {
  try {
    const { state, year = 2024 } = req.query;

    if (!state) {
      return res.status(400).json({
        error: 'State parameter is required',
        message: 'Please provide a state code (e.g., CA, NY, TX)'
      });
    }

    // Get VEST data for the year
    const vestData = await vestDataLoader.loadVESTData(parseInt(year));
    
    if (!vestData.countyData) {
      return res.status(404).json({
        error: 'County-level data not available',
        message: `VEST county-level data is not available for ${year}. Please process local files first.`
      });
    }

    // Filter counties by state
    const stateFipsMap = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };

    const stateFips = stateFipsMap[state.toUpperCase()] || state;
    const stateCounties = Object.values(vestData.countyData).filter(
      county => county.stateFips === stateFips || county.state === state.toUpperCase()
    );

    if (stateCounties.length === 0) {
      return res.status(404).json({
        error: 'No data found',
        message: `No VEST data found for state ${state} in year ${year}`
      });
    }

    // Aggregate state totals
    let totalDemVotes = 0;
    let totalRepVotes = 0;
    let totalVotes = 0;

    for (const county of stateCounties) {
      totalDemVotes += county.votes_dem_pres || 0;
      totalRepVotes += county.votes_rep_pres || 0;
      totalVotes += county.total_votes_pres || 0;
    }

    const demPercent = totalVotes > 0 ? (totalDemVotes / totalVotes) * 100 : 0;
    const repPercent = totalVotes > 0 ? (totalRepVotes / totalVotes) * 100 : 0;
    const demAdvantage = demPercent - repPercent;

    // Determine party lean
    let partyLean = 'Competitive';
    let partyLeanColor = 'neutral';
    if (demAdvantage > 10) {
      partyLean = 'Strong Democratic';
      partyLeanColor = 'democratic';
    } else if (demAdvantage > 5) {
      partyLean = 'Lean Democratic';
      partyLeanColor = 'democratic';
    } else if (demAdvantage < -10) {
      partyLean = 'Strong Republican';
      partyLeanColor = 'republican';
    } else if (demAdvantage < -5) {
      partyLean = 'Lean Republican';
      partyLeanColor = 'republican';
    }

    res.json({
      state: state.toUpperCase(),
      year: parseInt(year),
      totalCounties: stateCounties.length,
      totalVotes: Math.round(totalVotes),
      votesDem: Math.round(totalDemVotes),
      votesRep: Math.round(totalRepVotes),
      pctDem: parseFloat(demPercent.toFixed(2)),
      pctRep: parseFloat(repPercent.toFixed(2)),
      demAdvantage: parseFloat(demAdvantage.toFixed(2)),
      partyLean,
      partyLeanColor,
      counties: stateCounties.map(c => ({
        countyName: c.countyName,
        countyFips: c.countyFips,
        votesDem: c.votes_dem_pres,
        votesRep: c.votes_rep_pres,
        totalVotes: c.total_votes_pres,
        pctDem: c.total_votes_pres > 0 ? ((c.votes_dem_pres / c.total_votes_pres) * 100).toFixed(2) : 0,
        pctRep: c.total_votes_pres > 0 ? ((c.votes_rep_pres / c.total_votes_pres) * 100).toFixed(2) : 0,
      }))
    });
  } catch (error) {
    console.error('Error getting state summary:', error);
    res.status(500).json({
      error: 'Failed to get state summary',
      message: error.message
    });
  }
});

/**
 * POST /api/poligeo/analyze
 * Main analysis endpoint accepting multiple input formats
 * 
 * Request body:
 * {
 *   "input_format": "geoid" | "polygon" | "district",
 *   "input_data": <GEOID list/array/CSV | GeoJSON polygon | district name>,
 *   "geodistrict_name": "Optional name for the geodistrict",
 *   "state": "Optional state code (required for polygon format)"
 * }
 */
app.post('/api/poligeo/analyze', async (req, res) => {
  try {
    const { input_format, input_data, geodistrict_name, state } = req.body;

    if (!input_format || !input_data) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'input_format and input_data are required'
      });
    }

    // Set API base URL for internal service calls
    const protocol = req.protocol;
    const host = req.get('host');
    poligeoAnalyst.setApiBaseUrl(`${protocol}://${host}`);

    console.log(`📊 PoliGeo Analyst: Analyzing geodistrict with format: ${input_format}`);

    const result = await poligeoAnalyst.analyze({
      input_format,
      input_data,
      geodistrict_name,
      state,
    });

    res.json(result);
  } catch (error) {
    console.error('Error in PoliGeo Analyst:', error);
    res.status(500).json({
      error: 'Failed to analyze geodistrict',
      message: error.message
    });
  }
});

/**
 * GET /api/poligeo/vest-data/status
 * Check VEST data availability and last update
 */
app.get('/api/poligeo/vest-data/status', async (req, res) => {
  try {
    const status = await vestDataLoader.getStatus();
    
    // Also check for local files
    const fs = require('fs').promises;
    const path = require('path');
    const vestDataDir = path.join(__dirname, 'data', 'vest');
    const dataverseFilesDir = path.join(vestDataDir, 'dataverse_files');
    
    const localFiles = {
      dataverseFiles: [],
      directFiles: [],
    };
    
    try {
      // Check dataverse_files directory
      const dataverseFiles = await fs.readdir(dataverseFilesDir);
      localFiles.dataverseFiles = dataverseFiles.filter(f => 
        (f.endsWith('.csv') || f.endsWith('.tab') || f.endsWith('.tsv')) &&
        !f.endsWith('.md') && !f.endsWith('.xml')
      );
    } catch (error) {
      // Directory doesn't exist, that's OK
    }
    
    try {
      // Check direct vest directory
      const directFiles = await fs.readdir(vestDataDir);
      localFiles.directFiles = directFiles.filter(f => 
        (f.endsWith('.csv') || f.endsWith('.tab') || f.endsWith('.tsv')) &&
        !f.endsWith('.md') && !f.endsWith('.xml')
      );
    } catch (error) {
      // Directory doesn't exist, that's OK
    }
    
    res.json({
      ...status,
      localFiles,
    });
  } catch (error) {
    console.error('Error getting VEST data status:', error);
    res.status(500).json({
      error: 'Failed to get VEST data status',
      message: error.message
    });
  }
});

/**
 * POST /api/poligeo/vest-data/process-local
 * Process locally downloaded VEST files (from dataverse_files directory)
 * 
 * Request body:
 * {
 *   "year": 2016 | 2020 | 2024 (optional, processes all if not specified),
 *   "forceRefresh": boolean (optional, default: false)
 * }
 */
app.post('/api/poligeo/vest-data/process-local', async (req, res) => {
  try {
    const { year, forceRefresh = false } = req.body;

    if (year) {
      // Process specific year
      if (![2016, 2020, 2024].includes(year)) {
        return res.status(400).json({
          error: 'Invalid year',
          message: 'Year must be 2016, 2020, or 2024'
        });
      }

      if (vestDataLoader.isLoading(year)) {
        return res.status(409).json({
          error: 'Data is already being loaded',
          message: `VEST data for ${year} is currently being processed. Please wait.`
        });
      }

      console.log(`📥 Processing local VEST data for ${year}...`);
      const data = await vestDataLoader.loadVESTData(year, forceRefresh);

      res.json({
        year,
        status: 'success',
        message: `VEST data for ${year} processed successfully from local files`,
        metadata: data.metadata,
        dataType: data.metadata?.dataType || 'unknown',
      });
    } else {
      // Process all available years
      const years = [2016, 2020, 2024];
      const results = {};

      for (const y of years) {
        try {
          if (vestDataLoader.isLoading(y)) {
            results[y] = {
              status: 'skipped',
              message: `Already processing ${y}`
            };
            continue;
          }

          // Check if 2024 is available
          if (y === 2024) {
            try {
              console.log(`📥 Processing local VEST data for ${y}...`);
              const data = await vestDataLoader.loadVESTData(y, forceRefresh);
              results[y] = {
                status: 'success',
                metadata: data.metadata,
                dataType: data.metadata?.dataType || 'unknown',
              };
            } catch (error) {
              if (error.message.includes('not yet available') || error.message.includes('not configured')) {
                results[y] = {
                  status: 'not_available',
                  message: `2024 VEST data is not yet available`,
                };
              } else {
                throw error;
              }
            }
          } else {
            console.log(`📥 Processing local VEST data for ${y}...`);
            const data = await vestDataLoader.loadVESTData(y, forceRefresh);
            results[y] = {
              status: 'success',
              metadata: data.metadata,
              dataType: data.metadata?.dataType || 'unknown',
            };
          }
        } catch (error) {
          results[y] = {
            status: 'error',
            message: error.message,
          };
        }
      }

      res.json({
        status: 'completed',
        results,
        message: 'Local VEST data processing completed for all available years'
      });
    }
  } catch (error) {
    console.error('Error processing local VEST data:', error);
    res.status(500).json({
      error: 'Failed to process local VEST data',
      message: error.message
    });
  }
});

/**
 * POST /api/poligeo/vest-data/download
 * Manually trigger VEST data download/refresh from Dataverse
 * 
 * Request body:
 * {
 *   "year": 2016 | 2020 | 2024 (optional, downloads all if not specified),
 *   "forceRefresh": boolean (optional, default: false)
 * }
 */
app.post('/api/poligeo/vest-data/download', async (req, res) => {
  try {
    const { year, forceRefresh = false } = req.body;

    if (year) {
      // Download specific year
      if (![2016, 2020, 2024].includes(year)) {
        return res.status(400).json({
          error: 'Invalid year',
          message: 'Year must be 2016, 2020, or 2024'
        });
      }

      if (vestDataLoader.isLoading(year)) {
        return res.status(409).json({
          error: 'Data is already being loaded',
          message: `VEST data for ${year} is currently being downloaded. Please wait.`
        });
      }

      // Check if 2024 is available
      if (year === 2024) {
        try {
          console.log(`📥 Attempting to download VEST data for ${year}...`);
          const data = await vestDataLoader.loadVESTData(year, forceRefresh);
          res.json({
            year,
            status: 'success',
            message: `VEST data for ${year} loaded successfully`,
            metadata: data.metadata,
          });
        } catch (error) {
          if (error.message.includes('not yet available') || error.message.includes('not configured')) {
            return res.json({
              year,
              status: 'not_available',
              message: `2024 VEST data is not yet available from Harvard Dataverse`,
            });
          }
          throw error;
        }
      } else {
        console.log(`📥 Downloading VEST data for ${year}...`);
        const data = await vestDataLoader.loadVESTData(year, forceRefresh);

        res.json({
          year,
          status: 'success',
          message: `VEST data for ${year} loaded successfully`,
          metadata: data.metadata,
        });
      }
    } else {
      // Download all available years
      const years = [2016, 2020, 2024];
      const results = {};

      for (const y of years) {
        try {
          if (vestDataLoader.isLoading(y)) {
            results[y] = {
              status: 'skipped',
              message: `Already loading ${y}`
            };
            continue;
          }

          // Check if year is configured (2024 might not be available yet)
          if (y === 2024) {
            const status = await vestDataLoader.getStatus();
            // If 2024 doesn't have a persistentId configured, skip it gracefully
            try {
              console.log(`📥 Attempting to download VEST data for ${y}...`);
              const data = await vestDataLoader.loadVESTData(y, forceRefresh);
              results[y] = {
                status: 'success',
                metadata: data.metadata,
              };
            } catch (error) {
              if (error.message.includes('not yet available') || error.message.includes('not configured')) {
                results[y] = {
                  status: 'not_available',
                  message: `2024 VEST data is not yet available`,
                };
              } else {
                throw error;
              }
            }
          } else {
            console.log(`📥 Downloading VEST data for ${y}...`);
            const data = await vestDataLoader.loadVESTData(y, forceRefresh);
            results[y] = {
              status: 'success',
              metadata: data.metadata,
            };
          }
        } catch (error) {
          results[y] = {
            status: 'error',
            message: error.message,
          };
        }
      }

      res.json({
        status: 'completed',
        results,
        message: 'VEST data download completed for all available years'
      });
    }
  } catch (error) {
    console.error('Error downloading VEST data:', error);
    res.status(500).json({
      error: 'Failed to download VEST data',
      message: error.message
    });
  }
});

/**
 * POST /api/vest/bulk-download-persist
 * Download all VEST data for a year and persist tract party data for all states
 *
 * Request body:
 * {
 *   "year": 2024 (optional, defaults to 2024),
 *   "apiBaseUrl": "http://localhost:3000" (optional, for county allocation)
 * }
 */
app.post('/api/vest/bulk-download-persist', async (req, res) => {
  try {
    const year = parseInt(req.body.year || 2024, 10);
    const apiBaseUrl = req.body.apiBaseUrl;

    if (![2016, 2020, 2024].includes(year)) {
      return res.status(400).json({
        error: 'Invalid year',
        message: 'Year must be 2016, 2020, or 2024'
      });
    }

    console.log(`🚀 Starting bulk VEST ${year} download and persistence via API...`);

    // Import the bulk persistence service
    const vestBulkPersistence = require('./services/vest-bulk-persistence');

    // Start the async job (don't await, return 202 immediately)
    vestBulkPersistence.downloadAndPersistAll(year, { apiBaseUrl }).then(results => {
      console.log(`✅ Bulk VEST ${year} download complete:`, {
        statesProcessed: results.statesProcessed?.length || 0,
        totalTracts: results.totalTracts || 0,
        duration: results.endTime ? ((results.endTime - results.startTime) / 1000).toFixed(1) + 's' : 'unknown'
      });

      if (results.error) {
        console.error(`❌ Bulk VEST ${year} download failed:`, results.error);
      }
    }).catch(error => {
      console.error(`❌ Bulk VEST ${year} download error:`, error);
    });

    res.status(202).json({
      message: `Bulk download and persistence started for VEST ${year}`,
      status: 'running',
      year,
      note: 'This process may take 30+ minutes. Check server logs for progress.'
    });

  } catch (error) {
    console.error('Error starting bulk download:', error);
    res.status(500).json({
      error: 'Failed to start bulk download',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server only when run directly (not when required by union-polygon worker)
if (require.main === module) {
  (async () => {
    await testFirestoreAccess();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })();
}

module.exports = { app, runUnionPolygonGenerationJob, runBuildAllUnionPolygonsForState };
