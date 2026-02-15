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
const poligeoAnalyst = require('./services/poligeo-analyst');
const congress119Party = require('./services/congress-119-party');
const mapsComparison = require('./services/maps-comparison');
const logger = require('./utils/logger');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enable garbage collection for better memory management
if (global.gc) {
  logger.debug('Garbage collection is available');
} else {
  logger.debug('Garbage collection is not available - consider running with --expose-gc');
}

// Initialize Firestore (for production)
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

/**
 * Test Firestore and Cloud Storage access on startup
 */
async function testFirestoreAccess() {
  try {
    logger.debug('🔍 Testing Firestore access...');
    logger.debug(`   Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'}`);
    logger.debug(`   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set'}`);
    
    // Try to access Firestore - this will fail if credentials aren't available
    const testDoc = await firestore.collection('census_cache').doc('_startup_test').get();
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

// Determine cache mode based on environment
const USE_LOCAL_CACHE = process.env.NODE_ENV !== 'production' || process.env.USE_LOCAL_CACHE === 'true';
console.log(`🗂️ Cache mode: ${USE_LOCAL_CACHE ? 'LOCAL FILES' : 'FIRESTORE'}`);

// Census API Configuration
const CENSUS_API_BASE = 'https://api.census.gov/data';
const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const ALTERNATIVE_TIGERWEB = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0';
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

app.use(morgan('combined'));
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

/**
 * Build set of step-0 geographic island tract IDs for exclusion from isolation at steps 1+.
 * @param {Object} algorithmState - Algorithm state (may have steps[0].islandTractsData)
 * @param {number} step - Current step number
 * @param {string[]|undefined} bodyStep0IslandTractIds - Optional array from request body
 * @returns {Set<string>|null}
 */
function buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds) {
  let set = Array.isArray(bodyStep0IslandTractIds) ? new Set(bodyStep0IslandTractIds) : null;
  if (!set && step > 0 && algorithmState?.steps?.[0]?.islandTractsData?.islandTractsByGroup) {
    const byGroup = algorithmState.steps[0].islandTractsData.islandTractsByGroup;
    set = new Set();
    for (const islandGroups of Object.values(byGroup)) {
      if (Array.isArray(islandGroups)) {
        for (const group of islandGroups) {
          if (Array.isArray(group)) group.forEach(id => set.add(id));
          else if (typeof group === 'string') set.add(group);
        }
      }
    }
  }
  return set;
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
      
      const doc = await firestore.collection('census_cache').doc(key).get();
      
      if (doc.exists) {
        const data = doc.data();
        
        // Check if expired
        if (isCacheExpired(data.timestamp, data.ttl)) {
          console.log(`⏰ FIRESTORE CACHE: Cache expired for key: ${key}, deleting`);
          await firestore.collection('census_cache').doc(key).delete();
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
          await firestore.collection('census_cache').doc(key).delete();
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
            await firestore.collection('census_cache').doc(key).delete();
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
        
        const docRef = firestore.collection('census_cache').doc(key);
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
        
        const docRef = firestore.collection('census_cache').doc(key);
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
      vestYear: parseInt(req.query.vestYear || req.body?.vestYear || '2020', 10),
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
      
      await firestore.collection('census_cache').doc(testKey).set({
        data: testData,
        timestamp: Date.now(),
        ttl: 300000, // 5 minutes
        version: CACHE_VERSION,
        source: 'Test',
        attribution: 'Test data'
      });
      
      console.log('✅ Firestore write test successful');
      
      // Test read
      const doc = await firestore.collection('census_cache').doc(testKey).get();
      
      if (doc.exists) {
        console.log('✅ Firestore read test successful');
        
        // Clean up test document
        await firestore.collection('census_cache').doc(testKey).delete();
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
  
  const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
  let whereClause = `STATE_FIPS='${stateFips}'`;
  if (county) {
    whereClause += ` AND COUNTY_FIPS='${county}'`;
  }
  
  const countParams = new URLSearchParams({
    where: whereClause,
    outFields: 'STATE_FIPS',
    f: 'geojson',
    returnCountOnly: 'true'
  });
  
  logExternalFetch('TIGERweb', 'tract count for boundaries query', county ? `state=${state} county=${county}` : `state=${state}`);
  const countResponse = await axios.get(`${serviceUrl}?${countParams.toString()}`);
  return countResponse.data.properties?.count || 0;
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
  
  const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
  let whereClause = `STATE_FIPS='${stateFips}'`;
  if (county) {
    whereClause += ` AND COUNTY_FIPS='${county}'`;
  }
  
  console.log(`🔍 Streaming TIGERweb query: state="${state}" -> FIPS="${stateFips}", where="${whereClause}"`);
  
  // Set up streaming response
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.write('{"type":"FeatureCollection","features":[');
  
  const batchSize = 500;
  const totalBatches = Math.ceil(totalCount / batchSize);
  let isFirstBatch = true;
  let totalFeaturesStreamed = 0;
  
  try {
    for (let i = 0; i < totalBatches; i++) {
      const offset = i * batchSize;
      const batchParams = new URLSearchParams({
        where: whereClause,
        outFields: 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,POPULATION',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: batchSize.toString(),
        resultOffset: offset.toString()
      });
      
      console.log(`Streaming batch ${i + 1}/${totalBatches} (offset: ${offset})`);
      logExternalFetch('TIGERweb', 'tract boundaries batch (streaming)', `state=${state} batch=${i + 1}/${totalBatches}`);
      const batchResponse = await axios.get(`${serviceUrl}?${batchParams.toString()}`);
      const batchFeatures = batchResponse.data.features || [];
      
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

    // For large datasets, use streaming response
    const totalCount = await getTractCount(state, county);
    if (totalCount > 2000) {
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
    
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
    let whereClause = `STATE_FIPS='${stateFips}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }
    
    console.log(`🔍 TIGERweb query: state="${state}" -> FIPS="${stateFips}", where="${whereClause}"`);
    
    // For smaller datasets, use single request
    const params = new URLSearchParams({
      where: whereClause,
      outFields: 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,POPULATION',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: '2000'
    });
    
    console.log(`Fetching tract boundaries for state ${state} (small dataset)`);
    logExternalFetch('TIGERweb', 'tract boundaries for state/county', county ? `state=${state} county=${county}` : `state=${state}`);
    const response = await axios.get(`${serviceUrl}?${params.toString()}`);
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: response.data.features || []
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
    
    // Use USA_States_Generalized_Boundaries service from same organization as census tracts
    // This ensures consistency with TIGER data
    const serviceUrl = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0/query';
    
    const params = new URLSearchParams({
      where: `STATE_FIPS='${stateFips}'`,
      outFields: 'STATE_FIPS,STATE_NAME,STATE_ABBR',
      f: 'geojson',
      outSR: '4326'
    });
    
    console.log(`🔍 TIGERweb state boundaries query: state="${state}" -> FIPS="${stateFips}"`);
    
    logExternalFetch('TIGERweb', 'state boundary polygon', `state=${state}`);
    const response = await axios.get(`${serviceUrl}?${params.toString()}`);
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: response.data.features || []
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
        await firestore.collection('census_cache').doc(key).delete();
        res.json({ 
          message: `Cache entry ${key} cleared`,
          cacheMode: 'FIRESTORE'
        });
      } else {
        // Clear all cache entries
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
      const snapshot = await firestore.collection('census_cache').get();
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
    // Use Cloud Storage for large files (> 1MB) instead of Firestore chunking
    const FIRESTORE_MAX_SIZE = 1024 * 1024; // 1MB
    let useCloudStorage = tractCacheSize > FIRESTORE_MAX_SIZE;
    const stateTractCacheKey = `state_tracts_${stateCode}`;
    
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
        
        const metadataDocRef = firestore.collection('census_cache').doc(stateTractCacheKey);
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
        const metadataDocRef = firestore.collection('census_cache').doc(stateTractCacheKey);
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
        const stateTractDocRef = firestore.collection('census_cache').doc(stateTractCacheKey);
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
    const algorithmDocRef = firestore.collection('census_cache').doc(cacheKey);
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
    const doc = await firestore.collection('census_cache').doc(cacheKey).get();
    
    if (!doc.exists) {
      logger.debug(`❌ FIRESTORE ALGORITHM CACHE: No document found for key: ${cacheKey}`);
      cachedEntry = null;
    } else {
      const data = doc.data();
      
      // Check if expired
      if (isCacheExpired(data.timestamp, data.ttl)) {
        logger.debug(`⏰ FIRESTORE ALGORITHM CACHE: Cache expired for key: ${cacheKey}, deleting`);
        await firestore.collection('census_cache').doc(cacheKey).delete();
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
        await firestore.collection('census_cache').doc(cacheKey).delete();
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
        await firestore.collection('census_cache').doc(cacheKey).delete();
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
        const stateTractDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
        if (stateTractDoc.exists) {
          const stateTractData = stateTractDoc.data();
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
            firestore.collection('census_cache').doc(chunkKey).get()
          );
          const chunkDocs = await Promise.all(chunkPromises);
          
          // Combine all chunks into single array
          const allTracts = [];
          for (const chunkDoc of chunkDocs) {
            if (chunkDoc.exists) {
              const chunkData = chunkDoc.data();
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
        await firestore.collection('census_cache').doc(key).delete();
        res.json({
          message: `Latlong cache entry ${key} cleared`,
          cacheMode: 'FIRESTORE'
        });
      } else {
        // Delete all latlong cache entries (those with 'latlong_division' prefix)
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
    const doc = await firestore.collection('census_cache').doc(cacheKey).get();
    
    if (!doc.exists) {
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
      await firestore.collection('census_cache').doc(cacheKey).delete();
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
        await firestore.collection('census_cache').doc(cacheKey).delete();
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
      const stateTractDoc = await firestore.collection('census_cache').doc(data.tractCacheKey).get();
      if (stateTractDoc.exists) {
        const stateTractData = stateTractDoc.data();
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

    await firestore.collection('census_cache').doc(cacheKey).set(cacheData);

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
      const doc = await firestore.collection('census_cache').doc(cacheKey).get();
      
      if (doc.exists) {
        const cachedEntry = doc.data();
        
        // Check if expired
        if (!isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
          const cachedVersion = cachedEntry.algorithmVersion;
          
          logger.debug(`🔍 CACHE CHECK: Found cached result for ${cacheKey}, cached version: ${cachedVersion || 'missing'}, current version: ${currentVersion}`);
          
          // If no version is stored, treat as old cache and invalidate
          if (!cachedVersion) {
            logger.debug(`🔄 ALGORITHM VERSION MISSING: Old cache entry without version. Invalidating and re-executing.`);
            await firestore.collection('census_cache').doc(cacheKey).delete();
            // Also delete state tract cache if it exists (both Firestore and Cloud Storage)
            if (cachedEntry.tractCacheKey) {
              try {
                const tractCacheDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
                if (tractCacheDoc.exists) {
                  const tractCacheData = tractCacheDoc.data();
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
                  await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).delete();
                  console.log(`🗑️ Deleted state tract cache from Firestore: ${cachedEntry.tractCacheKey}`);
                }
              } catch (e) {
                console.warn(`⚠️ Error deleting tract cache: ${e.message}`);
              }
            }
            shouldExecute = true;
          } else if (cachedVersion !== currentVersion) {
            logger.debug(`🔄 ALGORITHM VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}. Invalidating cache and re-executing.`);
            await firestore.collection('census_cache').doc(cacheKey).delete();
            // Also delete state tract cache if it exists (both Firestore and Cloud Storage)
            if (cachedEntry.tractCacheKey) {
              try {
                const tractCacheDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
                if (tractCacheDoc.exists) {
                  const tractCacheData = tractCacheDoc.data();
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
                  await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).delete();
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

    // Get tract data from census proxy
    // First, get boundaries - use forceInvalidate option, or force if cache is empty
    let boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}`;
    if (forceInvalidate) {
      boundariesUrl += '&forceInvalidate=true';
    }
    console.log(`📡 Fetching boundaries from: ${boundariesUrl}`);
    let boundariesResponse = await axios.get(boundariesUrl);
    
    console.log(`📦 Boundaries response status: ${boundariesResponse.status}`);
    console.log(`📦 Boundaries response data type: ${typeof boundariesResponse.data}`);
    console.log(`📦 Boundaries response has features: ${!!boundariesResponse.data?.features}`);
    console.log(`📦 Boundaries features count: ${boundariesResponse.data?.features?.length || 0}`);
    
    // If cached data is empty, force invalidate and fetch fresh (unless already forced)
    if (!forceInvalidate && (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0)) {
      console.warn(`⚠️ Cached boundaries are empty, forcing fresh fetch...`);
      boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}&forceInvalidate=true`;
      boundariesResponse = await axios.get(boundariesUrl);
      console.log(`📦 Fresh boundaries features count: ${boundariesResponse.data?.features?.length || 0}`);
    }
    
    if (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0) {
      console.error(`❌ No tract boundaries found after fresh fetch - data:`, JSON.stringify(boundariesResponse.data).substring(0, 200));
      return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
    }

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
    const boundaries = boundariesResponse.data;

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
          if (tractId.includes('001700') || tractId.includes('002302')) {
            console.log(`🔗 Assigned TRACT_GROUP_ID ${groupIdMap.get(tractId)} to tract ${tractId}`);
          }
        }
      }
      
      console.log(`✅ Assigned ${nextGroupId - 1} tract group IDs for ${enclosedMap.size} enclosed tracts`);

    console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

    // Check if isolation resolution is requested (for "run all steps" execution)
    const resolveIsolation = req.body.resolveIsolation === true;
    
    // Track tract cache key for step caching
    const tractCacheKey = `state_tracts_${state}`;
    
    // Callback to cache each step as it's completed
    const onStepComplete = async (stepNumber, stepData, shouldCache) => {
      if (!shouldCache) return true;
      
      try {
        // Normalize step data (remove geometries, keep only IDs)
        const normalized = normalizeStepData(stepData, tractCacheKey);
        
        // Cache union polygons for this step
        const unionPolygonCacheKeys = await cacheUnionPolygons(state, stepNumber, stepData.districtGroups);
        
        // Add union polygon cache keys to normalized groups
        if (Object.keys(unionPolygonCacheKeys).length > 0) {
          normalized.normalized.districtGroups = normalized.normalized.districtGroups.map((group, index) => {
            if (unionPolygonCacheKeys[index]) {
              group.unionPolygonCacheKey = unionPolygonCacheKeys[index];
            }
            return group;
          });
        }
        
        // Create step cache key
        const stepCacheKey = `step_${state}_${stepNumber}_${currentVersion}`;
        
        // Store normalized step in Firestore (unionPolygonsCached only when we successfully cached union polygons)
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
          unionPolygonsCached: Object.keys(unionPolygonCacheKeys).length > 0
        };

        const stepDocRef = firestore.collection('census_cache').doc(stepCacheKey);
        await stepDocRef.set(stepCacheEntry);
        
        logger.debug(`💾 Cached step ${stepNumber} for ${state} with ${Object.keys(unionPolygonCacheKeys).length} union polygon(s)`);
      } catch (error) {
        logger.warn(`⚠️ Failed to cache step ${stepNumber}: ${error.message}`);
      }
      
      return true; // Continue execution
    };

    // Execute algorithm with isolation resolution if requested
    const startTime = Date.now();
    const result = await algorithmService.executeGeodistrictAlgorithm(
      tracts,
      totalDistricts,
      maxIterations,
      options.forceInvalidate || false,
      resolveIsolation, // Enable isolation resolution
      onStepComplete // Always cache each step once calculated (record state per step)
    );
    const executionTime = Date.now() - startTime;

    logger.info(`✅ Algorithm completed in ${executionTime}ms (${result.steps.length} steps)`);
    
    // Mark final step as complete in cache
    if (result.steps.length > 0) {
      try {
        const finalStepNumber = result.steps.length - 1;
        const finalStepCacheKey = `step_${state}_${finalStepNumber}_${currentVersion}`;
        const finalStepDocRef = firestore.collection('census_cache').doc(finalStepCacheKey);
        await finalStepDocRef.update({ isComplete: true });
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
        const unionCacheDoc = await firestore.collection('census_cache').doc(updatedStep0Group.unionPolygonCacheKey).get();
        if (unionCacheDoc.exists) {
          const metadata = unionCacheDoc.data();
          hasValidTigerBoundary = metadata.tigerBased === true || metadata.source === 'tiger-state-boundary';
        }
      } catch (e) {
        // If we can't check metadata, assume it's not TIGER-based
        hasValidTigerBoundary = false;
      }
    }
    
    // If no valid TIGER boundary, fetch it
    if (!hasValidTigerBoundary) {
      console.log(`⚠️ STEP 0: No valid TIGER state boundary found, fetching from TIGERweb...`);
      try {
        const stateBoundariesUrl = `${req.protocol}://${req.get('host')}/api/census/state-boundaries?state=${state}`;
        const stateBoundariesResponse = await axios.get(stateBoundariesUrl);
        const stateBoundaries = stateBoundariesResponse.data;
        
        if (stateBoundaries && stateBoundaries.features && stateBoundaries.features.length > 0) {
          const mainStateBoundary = stateBoundaries.features[0];
          updatedStep0Group.unionPolygon = mainStateBoundary;
          updatedStep0Group.unionPolygons = [mainStateBoundary];
          console.log(`✅ STEP 0: Fetched and set TIGER state boundary from TIGERweb`);
          
          // Cache the TIGER state boundary
          try {
            const unionCacheKeys = await cacheUnionPolygons(state, 0, stepData.districtGroups);
            if (Object.keys(unionCacheKeys).length > 0) {
              console.log(`💾 STEP 0: Cached TIGER state boundary polygon for step 0`);
            }
          } catch (cacheError) {
            console.warn(`⚠️ STEP 0: Failed to cache TIGER state boundary: ${cacheError.message}`);
          }
        } else {
          console.error(`❌ STEP 0: TIGER state boundaries response empty`);
        }
      } catch (stateBoundaryError) {
        console.error(`❌ STEP 0: Failed to fetch TIGER state boundaries: ${stateBoundaryError.message}`);
      }
    } else {
      console.log(`✅ STEP 0: Valid TIGER state boundary already loaded from cache`);
    }
  } catch (unionLoadError) {
    console.warn(`⚠️ STEP 0: Failed to load union polygons from cache: ${unionLoadError.message}, fetching TIGER boundaries...`);
    // Fetch TIGER boundaries as fallback
    try {
      const stateBoundariesUrl = `${req.protocol}://${req.get('host')}/api/census/state-boundaries?state=${state}`;
      const stateBoundariesResponse = await axios.get(stateBoundariesUrl);
      const stateBoundaries = stateBoundariesResponse.data;
      
      if (stateBoundaries && stateBoundaries.features && stateBoundaries.features.length > 0) {
        const mainStateBoundary = stateBoundaries.features[0];
        step0Group.unionPolygon = mainStateBoundary;
        step0Group.unionPolygons = [mainStateBoundary];
        console.log(`✅ STEP 0: Fetched TIGER state boundary as fallback`);
        
        // Cache the TIGER state boundary
        try {
          const unionCacheKeys = await cacheUnionPolygons(state, 0, stepData.districtGroups);
          if (Object.keys(unionCacheKeys).length > 0) {
            console.log(`💾 STEP 0: Cached TIGER state boundary polygon for step 0 (fallback)`);
          }
        } catch (cacheError) {
          console.warn(`⚠️ STEP 0: Failed to cache TIGER state boundary: ${cacheError.message}`);
        }
      }
    } catch (stateBoundaryError) {
      console.error(`❌ STEP 0: Failed to fetch TIGER state boundaries as fallback: ${stateBoundaryError.message}`);
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
    const stateTractDoc = await firestore.collection('census_cache').doc(tractCacheKey).get();
    if (!stateTractDoc.exists) return null;

    const stateTractData = stateTractDoc.data();
    if (stateTractData.algorithmVersion !== ALGORITHM_VERSION) return null;
    if (isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) return null;

    let tractMap = null;
    if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
      const cloudResult = await cloudStorageCache.get(tractCacheKey);
      if (cloudResult && cloudResult.data) tractMap = cloudResult.data;
    } else if (stateTractData.chunked && stateTractData.chunkKeys) {
      const chunkDocs = await Promise.all(
        stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
      );
      tractMap = [];
      for (const chunkDoc of chunkDocs) {
        if (chunkDoc.exists && chunkDoc.data().data && Array.isArray(chunkDoc.data().data)) {
          tractMap.push(...chunkDoc.data().data);
        }
      }
    } else if (stateTractData.data && Array.isArray(stateTractData.data)) {
      tractMap = stateTractData.data;
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
    // If already normalized (has districtGroups with censusTractIds), return as-is
    if (step.districtGroups && step.districtGroups.length > 0 && 
        step.districtGroups[0].censusTractIds && !step.districtGroups[0].censusTracts) {
      return step;
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
        
        await firestore.collection('census_cache').doc(cacheKey).set(metadataEntry);
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
      
      await firestore.collection('census_cache').doc(cacheKey).set(cacheEntry);
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
    const stateTractDoc = await firestore.collection('census_cache').doc(tractCacheKey).get();
    if (!stateTractDoc.exists) {
      console.error(`❌ Tract cache not found: ${tractCacheKey}`);
      return [];
    }
    
    const stateTractData = stateTractDoc.data();
    let tractMap = null;
    
    // Get tract map from Cloud Storage or Firestore
    if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
      const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
      if (cloudStorageResult && cloudStorageResult.data) {
        tractMap = cloudStorageResult.data;
      }
    } else if (stateTractData.chunked && stateTractData.chunkKeys) {
      const chunkDocs = await Promise.all(
        stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
      );
      const allTracts = [];
      for (const chunkDoc of chunkDocs) {
        if (chunkDoc.exists && chunkDoc.data().data) {
          allTracts.push(...chunkDoc.data().data);
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
    const doc = await firestore.collection('census_cache').doc(cacheKey).get();
    
    if (!doc.exists) {
      console.log(`⚠️ GET-CACHED-STATE: Algorithm state cache document not found: ${cacheKey}`);
      // Try to list what documents exist for debugging
      try {
        const allDocs = await firestore.collection('census_cache')
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
      return null;
    }
    
    const cachedEntry = doc.data();
    
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
    const doc = await firestore.collection('census_cache').doc(cacheKey).get();
    
    if (doc.exists) {
      const cachedEntry = doc.data();
      
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
      await firestore.collection('census_cache').doc(cacheKey).delete();
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
  const serviceUrl = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0/query';
  const params = new URLSearchParams({
    where: `STATE_FIPS='${stateFips}'`,
    outFields: 'STATE_FIPS,STATE_NAME,STATE_ABBR',
    f: 'geojson',
    outSR: '4326'
  });

  logExternalFetch('TIGERweb', 'state boundary for cache', `state=${state}`);
  const response = await axios.get(`${serviceUrl}?${params.toString()}`);
  const features = response.data.features || [];
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
  await firestore.collection('census_cache').doc(stateBoundaryKey).set(metadataEntry);
  console.log(`💾 MAP-POLYGONS: Saved state boundary to Cloud Storage (${stateBoundaryKey})`);
  return mainFeature;
}

/**
 * GET /api/algorithm/map-polygons/:state
 * Returns only polygon GeoJSON for fast map display: state outline and optional final district polygons.
 * Does not run algorithm or load tract data. All polygons from Cloud Storage.
 */
app.get('/api/algorithm/map-polygons/:state', async (req, res) => {
  try {
    const { state } = req.params;
    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }
    const currentVersion = ALGORITHM_VERSION;

    let hasFinalStep = false;
    const finalDistrictPolygons = [];

    // Fetch state boundary and all step-cache queries in parallel to reduce latency
    const [statePolygon, stepCacheSnapshot, algorithmStepsSnapshot, stepCacheSnapshot2] = await Promise.all([
      getOrCreateStateBoundaryInCloudStorage(state),
      firestore.collection('census_cache').where('state', '==', state).where('isComplete', '==', true).get(),
      firestore.collection('census_cache').where('state', '==', state).where('source', '==', 'algorithm-step-cache').get(),
      firestore.collection('census_cache').where('state', '==', state).where('source', '==', 'step-cache').get()
    ]);

    let finalStepDoc = null;
    let cachedEntry = null;
    let highestStep = -1;

    function considerEntry(doc, entry) {
      if ((entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
          entry.algorithmVersion === currentVersion &&
          entry.step !== undefined &&
          entry.step > highestStep &&
          entry.unionPolygonsCached === true) {
        finalStepDoc = doc;
        cachedEntry = entry;
        highestStep = entry.step;
      }
    }

    if (!stepCacheSnapshot.empty) {
      for (const doc of stepCacheSnapshot.docs) considerEntry(doc, doc.data());
    }
    if (!finalStepDoc && !algorithmStepsSnapshot.empty) {
      for (const doc of algorithmStepsSnapshot.docs) considerEntry(doc, doc.data());
    }
    if (!finalStepDoc && !stepCacheSnapshot2.empty) {
      for (const doc of stepCacheSnapshot2.docs) considerEntry(doc, doc.data());
    }

    // Only load union polygons from Cloud Storage when step has unionPolygonsCached (files known to exist)
    if (finalStepDoc && cachedEntry && cachedEntry.unionPolygonsCached === true) {
      const groups = cachedEntry.stepData?.districtGroups || cachedEntry.districtGroups || [];
      const sortedGroups = groups
        .filter(g => g && (g.unionPolygonCacheKey || (g.startDistrictNumber != null && g.endDistrictNumber != null)))
        .sort((a, b) => (a.startDistrictNumber || 0) - (b.startDistrictNumber || 0));

      const unionCacheKeys = [];
      for (const group of sortedGroups) {
        let unionCacheKey = group.unionPolygonCacheKey;
        if (!unionCacheKey && group.startDistrictNumber != null && group.endDistrictNumber != null) {
          unionCacheKey = `union_polygon_${state}_${cachedEntry.step}_${group.startDistrictNumber}-${group.endDistrictNumber}`;
        }
        if (unionCacheKey) unionCacheKeys.push(unionCacheKey);
      }
      const cacheResults = await Promise.all(unionCacheKeys.map(key => cloudStorageCache.get(key).catch(() => null)));
      for (const cacheResult of cacheResults) {
        if (cacheResult && cacheResult.data) {
          const unionData = cacheResult.data;
          const features = Array.isArray(unionData) ? unionData : [unionData];
          for (const f of features) {
            if (f && (f.type === 'Feature' || f.geometry)) finalDistrictPolygons.push(f);
          }
        }
      }
      hasFinalStep = finalDistrictPolygons.length > 0;
    }

    return res.json({
      statePolygon,
      finalDistrictPolygons: hasFinalStep ? finalDistrictPolygons : undefined,
      hasFinalStep
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
 * Default state code order for map-polygons-all (descending district count, matches frontend states array).
 */
const DEFAULT_STATE_CODES_ORDER = Object.entries(CONGRESSIONAL_DISTRICTS_BY_STATE)
  .sort((a, b) => (b[1] - a[1]))
  .map(([code]) => code);

/**
 * GET /api/algorithm/map-polygons-all
 * Returns step0 (state boundary) polygons for all 51 states in one response.
 * Query: states=CA,TX,FL,... (optional; if omitted uses default order by district count descending).
 */
app.get('/api/algorithm/map-polygons-all', async (req, res) => {
  try {
    const stateCodes = req.query.states
      ? req.query.states.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_STATE_CODES_ORDER;

    if (stateCodes.length === 0) {
      return res.status(400).json({ error: 'At least one state is required' });
    }

    const results = await Promise.all(
      stateCodes.map(async (stateCode) => {
        const statePolygon = await getOrCreateStateBoundaryInCloudStorage(stateCode);
        return { stateCode, statePolygon };
      })
    );

    return res.json({ statePolygons: results });
  } catch (error) {
    console.error('❌ GET /api/algorithm/map-polygons-all error:', error);
    res.status(500).json({
      error: 'Map polygons all failed',
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

    // Query docs with isComplete: true (final steps)
    const completeQuery = firestore.collection('census_cache')
      .where('isComplete', '==', true);

    const completeSnapshot = await completeQuery.get();

    for (const doc of completeSnapshot.docs) {
      const entry = doc.data();
      if ((entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
          entry.algorithmVersion === currentVersion &&
          entry.state) {
        stateCodesSet.add(entry.state);
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
      // First, try to find the highest step number with isComplete: true
      // Query for steps with source='algorithm-step-cache'
      // Note: Query by state and isComplete only (no orderBy to avoid index requirement), then filter by source and algorithmVersion in memory
      let finalStepDoc = null;
      let cachedEntry = null;
      let highestStep = -1;
      
      const stepCacheQuery = firestore.collection('census_cache')
        .where('state', '==', state)
        .where('isComplete', '==', true);

      const stepCacheSnapshot = await stepCacheQuery.get();

      if (!stepCacheSnapshot.empty) {
        // Find the highest step that matches the current algorithm version and has union polygons cached
        for (const doc of stepCacheSnapshot.docs) {
          const entry = doc.data();
          // Filter by source, algorithm version, unionPolygonsCached, and find the highest step
          if ((entry.source === 'algorithm-step-cache' || entry.source === 'step-cache') &&
              entry.algorithmVersion === currentVersion &&
              entry.step !== undefined &&
              entry.step > highestStep &&
              entry.unionPolygonsCached === true) {
            finalStepDoc = doc;
            cachedEntry = entry;
            highestStep = entry.step;
          }
        }
      }

      // Fallback: If no step with isComplete: true and unionPolygonsCached found, query for all steps for this state
      if (!finalStepDoc || !cachedEntry) {
        console.log(`ℹ️ No step with isComplete: true and unionPolygonsCached found, searching for highest step number...`);

        // Try 'algorithm-step-cache' source first
        const algorithmStepsQuery = firestore.collection('census_cache')
          .where('state', '==', state)
          .where('source', '==', 'algorithm-step-cache');

        const algorithmStepsSnapshot = await algorithmStepsQuery.get();

        if (!algorithmStepsSnapshot.empty) {
          for (const doc of algorithmStepsSnapshot.docs) {
            const entry = doc.data();
            if (entry.algorithmVersion === currentVersion &&
                entry.step !== undefined &&
                entry.step > highestStep &&
                entry.unionPolygonsCached === true) {
              finalStepDoc = doc;
              cachedEntry = entry;
              highestStep = entry.step;
            }
          }
        }

        // Also try 'step-cache' source (used by /api/algorithm/execute endpoint)
        const stepCacheQuery = firestore.collection('census_cache')
          .where('state', '==', state)
          .where('source', '==', 'step-cache');

        const stepCacheSnapshot = await stepCacheQuery.get();

        if (!stepCacheSnapshot.empty) {
          for (const doc of stepCacheSnapshot.docs) {
            const entry = doc.data();
            if (entry.algorithmVersion === currentVersion &&
                entry.step !== undefined &&
                entry.step > highestStep &&
                entry.unionPolygonsCached === true) {
              finalStepDoc = doc;
              cachedEntry = entry;
              highestStep = entry.step;
            }
          }
        }
      }

      if (!finalStepDoc || !cachedEntry) {
        return res.status(404).json({ error: 'No final step found for this state with current algorithm version (no step with union polygons cached)' });
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
            const stateTractDoc = await firestore.collection('census_cache').doc(tractCacheKey).get();
            if (stateTractDoc.exists) {
              const stateTractData = stateTractDoc.data();
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
                    stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
                  );
                  const allTracts = [];
                  for (const chunkDoc of chunkDocs) {
                    if (chunkDoc.exists && chunkDoc.data().data) {
                      allTracts.push(...chunkDoc.data().data);
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
                  let stepData = await reconstructStepFromCache(dataToReconstruct, tractMap, true, state);
                  
                  // For Step 0, ensure TIGER state boundaries are used
                  if (finalStepNumber === 0 || finalStepNumber === '0') {
                    stepData = await ensureStep0UsesTigerBoundaries(stepData, state, finalStepNumber, req);
                  }
                  
                  if (stepData && stepData.districtGroups && Array.isArray(stepData.districtGroups) && stepData.districtGroups.length > 0) {
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
                    
                    return res.json({
                      step: finalStepNumber,
                      data: stepData,
                      isComplete: true
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
        
        // Return step data (from stepData field or directly from entry)
        return res.json({
          step: finalStepNumber,
          data: stepData,
          isComplete: true
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
 * Does NOT touch external data (tract boundaries, census tract data, state tract cache).
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

    const step0Doc = await firestore.collection('census_cache').doc(step0CacheKey).get();
    if (!step0Doc.exists) {
      return res.json({ ok: true, message: `Restarted for ${state}; no cached step 0, call step-by-step to load step 0` });
    }

    const cachedEntry = step0Doc.data();
    if (isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl) || cachedEntry.algorithmVersion !== ALGORITHM_VERSION) {
      return res.json({ ok: true, message: `Restarted for ${state}; step 0 cache expired/version mismatch, call step-by-step` });
    }

    let stepData = cachedEntry.stepData;
    if (!stepData || !stepData.districtGroups || stepData.districtGroups.length === 0) {
      return res.json({ ok: true, message: `Restarted for ${state}; step 0 data invalid, call step-by-step` });
    }

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
      const boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}` + (forceInvalidate ? '&forceInvalidate=true' : '');
      const boundariesResponse = await axios.get(boundariesUrl);
      if (!boundariesResponse.data?.features?.length) {
        if (!forceInvalidate) {
          const fresh = await axios.get(`${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}&forceInvalidate=true`);
          if (fresh.data?.features?.length) boundariesResponse.data = fresh.data;
        }
        if (!boundariesResponse.data?.features?.length) {
          return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
        }
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
      const boundaries = boundariesResponse.data;
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
          const doc = await firestore.collection('census_cache').doc(step0CacheKey).get();
          
          if (doc.exists) {
            const cachedEntry = doc.data();
            
            if (!isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
              const cachedVersion = cachedEntry.algorithmVersion;
              const currentVersion = ALGORITHM_VERSION;
              
              if (cachedVersion === currentVersion) {
                console.log(`✅ STEP 0 CACHE HIT: Retrieved cached step 0 for ${state}`);
                
                // Reconstruct step data with tract geometries
                let stepData = cachedEntry.stepData;
                
                // For Step 0, ALWAYS use TIGER state boundaries (never use cached tract-based union polygons)
                // Step 0 should NEVER use union polygons created from tracts - only TIGER boundaries
                if (stepData.districtGroups && stepData.districtGroups.length > 0) {
                  const group = stepData.districtGroups[0];
                  let unionCacheKey = group.unionPolygonCacheKey;
                  
                  // Check if there's an old union polygon cache key (from tract-based union polygons)
                  if (unionCacheKey) {
                    // Check if this is a TIGER-based union polygon by checking metadata
                    try {
                      const unionCacheDoc = await firestore.collection('census_cache').doc(unionCacheKey).get();
                      if (unionCacheDoc.exists) {
                        const unionMetadata = unionCacheDoc.data();
                        // Check if this union polygon is marked as TIGER-based
                        const isTigerBased = unionMetadata.source === 'tiger-state-boundary' || unionMetadata.tigerBased === true;
                        
                        if (!isTigerBased) {
                          // This is an old tract-based union polygon - invalidate it
                          console.log(`🔄 STEP 0: Detected old tract-based union polygon cache, invalidating and replacing with TIGER boundaries`);
                          try {
                            // Delete old union polygon from Cloud Storage
                            await cloudStorageCache.delete(unionCacheKey);
                            // Delete metadata from Firestore
                            await firestore.collection('census_cache').doc(unionCacheKey).delete();
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
                  
                  // If no valid TIGER-based union polygon was loaded, fetch TIGER boundaries
                  if (!group.unionPolygon && !group.unionPolygons) {
                    console.log(`🔍 STEP 0: Fetching TIGER state boundaries (no valid cache found)`);
                    try {
                      const stateBoundariesUrl = `${req.protocol}://${req.get('host')}/api/census/state-boundaries?state=${state}`;
                      const stateBoundariesResponse = await axios.get(stateBoundariesUrl);
                      const stateBoundaries = stateBoundariesResponse.data;
                      
                      if (stateBoundaries && stateBoundaries.features && stateBoundaries.features.length > 0) {
                        const mainStateBoundary = stateBoundaries.features[0];
                        group.unionPolygon = mainStateBoundary;
                        group.unionPolygons = [mainStateBoundary];
                        console.log(`✅ STEP 0: Fetched and set TIGER state boundary from TIGERweb`);
                        
                        // Cache the TIGER state boundary with metadata indicating it's TIGER-based
                        try {
                          const unionCacheKeys = await cacheUnionPolygons(state, 0, stepData.districtGroups);
                          // Mark the cached union polygon as TIGER-based
                          if (Object.keys(unionCacheKeys).length > 0) {
                            const newUnionCacheKey = unionCacheKeys[0];
                            await firestore.collection('census_cache').doc(newUnionCacheKey).update({
                              source: 'tiger-state-boundary',
                              tigerBased: true
                            });
                            console.log(`💾 STEP 0: Cached TIGER state boundary with metadata`);
                          }
                        } catch (cacheError) {
                          console.warn(`⚠️ STEP 0: Failed to cache TIGER state boundary: ${cacheError.message}`);
                        }
                      }
                    } catch (stateBoundaryError) {
                      console.error(`❌ STEP 0: Failed to fetch TIGER state boundaries: ${stateBoundaryError.message}`);
                    }
                  }
                }
                
                if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
                  try {
                    const stateTractDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
                    if (stateTractDoc.exists) {
                      const stateTractData = stateTractDoc.data();
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
                            stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
                          );
                          const allTracts = [];
                          for (const chunkDoc of chunkDocs) {
                            if (chunkDoc.exists && chunkDoc.data().data) {
                              allTracts.push(...chunkDoc.data().data);
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
                }
                
                // For step 0, use the tracts we just loaded instead of trying to reconstruct from cache
                // Step 0 is the initial state with all tracts, so we can use the fresh tracts
                if (stepData.districtGroups && stepData.districtGroups.length > 0) {
                  // Replace the district group's tracts with the fresh tracts we just loaded
                  stepData.districtGroups[0].censusTracts = tracts;
                  console.log(`✅ STEP 0: Using ${tracts.length} fresh tracts instead of cached reconstruction`);
                  
                  // For Step 0, ensure TIGER state boundaries are used
                  stepData = await ensureStep0UsesTigerBoundaries(stepData, state, 0, req);
                }
                
                // Ensure step 0 has island tracts data so steps 1+ can exclude geographic islands from isolation
                if (stepData && stepData.districtGroups && stepData.districtGroups[0]?.censusTracts?.length > 0 &&
                    (!stepData.islandTractsData?.islandTractsByGroup || Object.keys(stepData.islandTractsData.islandTractsByGroup).length === 0)) {
                  try {
                    const s4DataLoader = require('./services/s4-data-loader');
                    await s4DataLoader.loadS4AdjacencyData(state);
                    const allTractsForDetect = stepData.districtGroups[0].censusTracts;
                    const detectionResult = algorithmService.detectIsolatedTracts(stepData.districtGroups, allTractsForDetect, 0, null);
                    if (detectionResult.islandTractsByGroup && detectionResult.islandTractsByGroup.size > 0) {
                      const islandTractsByGroup = {};
                      detectionResult.islandTractsByGroup.forEach((islandGroups, groupIndex) => {
                        islandTractsByGroup[groupIndex] = islandGroups;
                      });
                      const totalIslandTracts = Object.values(islandTractsByGroup).reduce((sum, groups) =>
                        sum + groups.reduce((s, g) => s + g.length, 0), 0);
                      stepData.islandTractsData = {
                        islandTractsByGroup,
                        totalIslandTracts,
                        totalIslandGroups: Object.values(islandTractsByGroup).reduce((sum, groups) => sum + groups.length, 0),
                        groupsWithIslands: Object.keys(islandTractsByGroup).length
                      };
                      console.log(`🏝️ STEP 0 (cache path): Detected ${totalIslandTracts} island tract(s) for exclusion at steps 1+`);
                    }
                  } catch (e) {
                    console.warn(`⚠️ STEP 0 (cache path): Island detection failed: ${e.message}`);
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
                await firestore.collection('census_cache').doc(step0CacheKey).delete();
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
          const existingTractCache = await firestore.collection('census_cache').doc(tractCacheKey).get();
          
          const existingVersion = existingTractCache.exists ? existingTractCache.data()?.algorithmVersion : null;
          let shouldRegenerateCache = !existingTractCache.exists || existingVersion !== ALGORITHM_VERSION;

          // When cache exists and version matches, validate geometry coverage or that the file actually exists
          const GEOMETRY_COVERAGE_THRESHOLD = 0.95; // Require at least 95% of tracts to have geometry
          if (!shouldRegenerateCache && existingTractCache.exists) {
            let existingTractMap = null;
            const existingData = existingTractCache.data();
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

          console.log(`🔍 State tract cache check: exists=${existingTractCache.exists}, version=${existingVersion || 'none'}, current=${ALGORITHM_VERSION}, shouldRegenerate=${shouldRegenerateCache}`);
          
          if (shouldRegenerateCache) {
            if (existingTractCache.exists) {
              console.log(`🔄 State tract cache regenerating (version mismatch or bad geometry coverage)...`);
              // Delete old Cloud Storage file if it exists
              if (existingTractCache.data()?.cloudStorage && existingTractCache.data()?.cloudStoragePath) {
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
              // Convert canonical Map to array of [id, tract] pairs
              // The canonical tract has: tractId, censusData, geometry, s4Adjacency, properties
              tractMap = Array.from(canonicalResult.tractMap.entries()).map(([tractId, canonicalTract]) => {
                // Convert canonical tract to GeoJSON feature format for compatibility
                // But preserve all canonical data including S4 adjacency
                const geoJsonFeature = {
                  type: 'Feature',
                  geometry: canonicalTract.geometry,
                  properties: {
                    ...canonicalTract.properties,
                    // Preserve canonical structure metadata
                    _canonicalTractId: canonicalTract.tractId,
                    _hasCensusData: !!canonicalTract.censusData,
                    _hasS4Adjacency: !!canonicalTract.s4Adjacency,
                    // Preserve S4 adjacency data if available
                    _s4Adjacency: canonicalTract.s4Adjacency || null
                  }
                };
                return [tractId, geoJsonFeature];
              }).filter(([id]) => id); // Filter out tracts without IDs
              
              console.log(`📊 Created tract map from canonical model: ${tractMap.length} tracts (canonical structure preserved)`);
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
              
              await firestore.collection('census_cache').doc(tractCacheKey).set(metadataEntry);
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
            
            await firestore.collection('census_cache').doc(tractCacheKey).set(metadataEntry);
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

          await firestore.collection('census_cache').doc(step0CacheKey).set(cacheData);
          console.log(`💾 STEP 0 CACHE STORED: Cached step 0 for ${state} with ${Object.keys(unionPolygonCacheKeys).length} union polygon(s)`);
        } catch (cacheError) {
          console.warn(`⚠️ STEP 0 CACHE STORE ERROR: ${cacheError.message}`);
        }
      };
      
      cacheStep0();

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
app.get('/api/algorithm/step/:state/:stepNumber', async (req, res) => {
  try {
    const { state, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber, 10);
    const maxIterations = parseInt(req.query.maxIterations || '100', 10);
    const currentVersion = ALGORITHM_VERSION;

    if (isNaN(stepNum) || stepNum < 0) {
      return res.status(400).json({ error: 'Invalid step number' });
    }

    let doc = null;
    let cachedEntry = null;
    let stepCacheKey = null;

    // Try step-by-step cache format first (algorithm_step_{state}_{maxIterations}_{step})
    stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
    
    if (doc.exists) {
      cachedEntry = doc.data();
      // Check if expired
      if (cachedEntry.timestamp && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
        cachedEntry = null; // Mark as invalid
      } else if (cachedEntry.algorithmVersion !== currentVersion) {
        cachedEntry = null; // Mark as invalid
      }
    }

    // If not found or invalid, try Run All Steps cache format (step_{state}_{step}_{version})
    if (!cachedEntry) {
      stepCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
      
      if (doc.exists) {
        cachedEntry = doc.data();
        // Check if expired (Run All Steps uses ttl: null, so only check timestamp if ttl exists)
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

    // Determine if step data is in 'stepData' field (step-by-step) or directly in cachedEntry (Run All Steps)
    const hasStepDataField = cachedEntry.stepData !== undefined;
    const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
    const isNormalized = cachedEntry.normalized;
    const tractCacheKey = cachedEntry.tractCacheKey || `state_tracts_${state}`;

    // Reconstruct step data with tract geometries from state cache if needed
    let stepData = dataToReconstruct;
    
    // If normalized, reconstruct from state tract cache
    if (isNormalized && tractCacheKey) {
      try {
        // Fetch state-level tract cache
        const stateTractDoc = await firestore.collection('census_cache').doc(tractCacheKey).get();
        
        if (stateTractDoc.exists) {
          const stateTractData = stateTractDoc.data();
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
                stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
              );
              const allTracts = [];
              for (const chunkDoc of chunkDocs) {
                if (chunkDoc.exists && chunkDoc.data().data) {
                  allTracts.push(...chunkDoc.data().data);
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
            }
          }
        }
      } catch (reconstructError) {
        console.warn(`⚠️ Failed to reconstruct step ${stepNum}: ${reconstructError.message}`);
        return res.status(500).json({ error: `Failed to reconstruct step ${stepNum}` });
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
 * POST /api/algorithm/execute/next-step
 * Execute the next step of the algorithm
 * Caches step results for fast retrieval on subsequent requests
 */
app.post('/api/algorithm/execute/next-step', async (req, res) => {
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

    // Create cache key for this specific step
    const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${nextStepNumber}`;

    // Check cache first (unless forceInvalidate is true)
    if (!forceInvalidate) {
      try {
        const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
        
        if (doc.exists) {
          const cachedEntry = doc.data();
          
          // Check if expired
          if (!isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
            // Check algorithm version
            const cachedVersion = cachedEntry.algorithmVersion;
            const currentVersion = ALGORITHM_VERSION;
            
            if (cachedVersion === currentVersion) {
                logger.debug(`✅ STEP CACHE HIT: Retrieved cached step ${nextStepNumber} for ${state}`);
              
              // Reconstruct step data with tract geometries from state cache if needed
              let stepData = cachedEntry.stepData;
              
              // If normalized, reconstruct from state tract cache
              if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
                try {
                  // Fetch state-level tract cache
                  let stateTractCache;
                  const stateTractDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
                  
                  if (stateTractDoc.exists) {
                    const stateTractData = stateTractDoc.data();
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
                      firestore.collection('census_cache').doc(chunkKey).get()
                    );
                    const chunkDocs = await Promise.all(chunkPromises);
                    
                    const allTracts = [];
                    for (const chunkDoc of chunkDocs) {
                      if (chunkDoc.exists) {
                        const chunkData = chunkDoc.data();
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
              
              if (cachedEntry.isComplete) {
                await deleteCachedAlgorithmState(stateKey);
                console.log(`✅ Algorithm completed after ${nextStepNumber} iterations (from cache)`);
              } else {
                await cacheAlgorithmState(stateKey, updatedState);
              }
              
              return res.json({
                step: nextStepNumber,
                data: stepData,
                isComplete: cachedEntry.isComplete || false
              });
            } else {
              console.log(`🔄 STEP CACHE VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}, invalidating`);
              await firestore.collection('census_cache').doc(stepCacheKey).delete();
            }
          } else {
            console.log(`⏰ STEP CACHE EXPIRED: Cache expired for step ${nextStepNumber}, deleting`);
            await firestore.collection('census_cache').doc(stepCacheKey).delete();
          }
        }
      } catch (cacheError) {
        console.warn(`⚠️ STEP CACHE CHECK ERROR: ${cacheError.message}, proceeding with execution`);
      }
    }

    logger.info(`🚀 Executing next step for ${state} (iteration ${nextStepNumber})`);

    // Execute next step
    const { step, state: updatedState, isComplete } = await algorithmService.executeNextStep(algorithmState);

    // Cache the step result (await so step is durably recorded before response)
    const cacheStepResult = async () => {
      try {
        // Normalize step data (store tract IDs instead of full geometries)
        // Use existing state tract cache key (should already exist from initialization)
        const tractCacheKey = `state_tracts_${state}`;
        const normalizedStep = normalizeStepData(step, tractCacheKey);
        
        const cacheData = {
          stepData: normalizedStep.normalized,
          isComplete,
          algorithmVersion: ALGORITHM_VERSION,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          source: 'algorithm-step-cache',
          normalized: true,
          tractCacheKey: tractCacheKey,
          state: state,
          step: nextStepNumber
        };

        await firestore.collection('census_cache').doc(stepCacheKey).set(cacheData);
        console.log(`💾 STEP CACHE STORED: Cached step ${nextStepNumber} for ${state}`);
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
 * Cache union polygons for a step's district groups in Cloud Storage
 * @param {string} stateCode - State code
 * @param {number} stepNumber - Step number
 * @param {Array} districtGroups - District groups with union polygons
 * @returns {Promise<Object>} Map of group indices to cache keys
 */
async function cacheUnionPolygons(stateCode, stepNumber, districtGroups) {
  const unionPolygonCacheKeys = {};
  
  for (let i = 0; i < districtGroups.length; i++) {
    const group = districtGroups[i];
    if (!group.unionPolygon && !group.unionPolygons) {
      continue; // Skip groups without union polygons
    }
    
    // Create cache key for this group's union polygon(s)
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    const unionCacheKey = `union_polygon_${stateCode}_${stepNumber}_${groupKey}`;
    
    try {
      // Store union polygon(s) - can be single polygon or array
      // At Step 0, prefer unionPolygons array (main + islands) over single unionPolygon
      const unionData = group.unionPolygons || (group.unionPolygon ? [group.unionPolygon] : null);
      
      // Log what we're caching for debugging
      const isStep0 = stepNumber === 0 || stepNumber === '0';
      if (isStep0) {
        const hasArray = Array.isArray(group.unionPolygons);
        const hasSingle = !!group.unionPolygon;
        const arrayLength = hasArray ? group.unionPolygons.length : 0;
        const polygonCount = Array.isArray(unionData) ? unionData.length : (unionData ? 1 : 0);
        console.log(`🔍 STEP 0: Caching TIGER state boundary - Group ${groupKey} - has unionPolygons array: ${hasArray} (length: ${arrayLength}), has unionPolygon: ${hasSingle}, will cache: ${polygonCount} TIGER state boundary/ies`);
      }
      
      if (unionData) {
        const unionSize = JSON.stringify(unionData).length;
        const unionSizeMB = (unionSize / (1024 * 1024)).toFixed(2);
        
        // Always use Cloud Storage for union polygons (they can be large)
        const cloudStoragePath = await cloudStorageCache.set(unionCacheKey, unionData, {
          state: stateCode,
          step: stepNumber.toString(),
          group: groupKey,
          source: 'union-polygon-cache',
          polygonCount: Array.isArray(unionData) ? unionData.length.toString() : '1'
        });
        
        // Store metadata in Firestore
        // For Step 0, mark as TIGER-based to distinguish from tract-based union polygons
        const isStep0 = stepNumber === 0 || stepNumber === '0';
        const metadataEntry = {
          cloudStoragePath: cloudStoragePath,
          timestamp: Date.now(),
          ttl: null, // No expiration - union polygons are static for a given step
          version: CACHE_VERSION,
          source: isStep0 ? 'tiger-state-boundary' : 'union-polygon-cache-metadata',
          tigerBased: isStep0, // Mark Step 0 union polygons as TIGER-based
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
        
        await firestore.collection('census_cache').doc(unionCacheKey).set(metadataEntry);
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
      const unionCacheDoc = await firestore.collection('census_cache').doc(unionCacheKey).get();
      let isTigerBased = false;
      let polygonType = 'unknown';
      
      if (unionCacheDoc.exists) {
        const metadata = unionCacheDoc.data();
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
          await firestore.collection('census_cache').doc(unionCacheKey).delete();
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
      
      // Load from Cloud Storage
      if (unionCacheKey) {
        const cacheResult = await cloudStorageCache.get(unionCacheKey);
        
        if (cacheResult && cacheResult.data) {
          const unionData = cacheResult.data;
          
          // Handle both single polygon and array of polygons
          if (Array.isArray(unionData)) {
            group.unionPolygons = unionData;
            group.unionPolygon = unionData.length > 0 ? unionData[0] : undefined;
          } else {
            group.unionPolygon = unionData;
            group.unionPolygons = [unionData];
          }
          
          // Store the cache key for future reference
          group.unionPolygonCacheKey = unionCacheKey;
          
          // Log with clear indication of source
          const polygonCount = Array.isArray(unionData) ? unionData.length : 1;
          const sourceLabel = isTigerBased ? 'TIGER state boundary' : 'tract-based union polygon';
          const sizeMB = unionCacheDoc.exists ? (unionCacheDoc.data().sizeMB || 'unknown') : 'unknown';
          console.log(`✅ CLOUD STORAGE: Loaded ${polygonCount} ${sourceLabel} from cache for ${stateCode} step ${stepNumber} group ${group.startDistrictNumber}-${group.endDistrictNumber} (${sizeMB} MB)`);
        } else {
          console.warn(`⚠️ Union polygon cache not found for key: ${unionCacheKey}`);
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
    // Preserve isolated tracts data if present
    isolatedTractsData: step.isolatedTractsData || undefined,
    // Preserve step-0 island tracts so steps 1+ can exclude them from isolation
    islandTractsData: step.islandTractsData || undefined,
    districtGroups: step.districtGroups.map((group, index) => {
      const normalizedGroup = {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.endDistrictNumber,
        totalDistricts: group.totalDistricts,
        totalPopulation: group.totalPopulation,
        bounds: group.bounds, // Simple object with numbers
        centroid: group.centroid, // Simple object with numbers
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
  try {
    const currentVersion = ALGORITHM_VERSION;
    let deletedCount = 0;
    
    // Query for all step caches for this state/algorithm (both source types)
    // Query by state to find all step caches
    const stepCacheQuery = firestore.collection('census_cache')
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
            await doc.ref.delete();
            deletedCount++;
          } else if (runAllStepMatch && runAllStepMatch[1] === state) {
            await doc.ref.delete();
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
        const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
        if (doc.exists) {
          await doc.ref.delete();
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
      
      // Delete step_ format (Run All Steps) - try current version
      const runAllCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      try {
        const doc = await firestore.collection('census_cache').doc(runAllCacheKey).get();
        if (doc.exists) {
          await doc.ref.delete();
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
        const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
        if (doc.exists) {
          await doc.ref.delete();
          deletedCount++;
        }
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
      
      // Delete step_ format (Run All Steps)
      const runAllCacheKey = `step_${state}_${stepNum}_${currentVersion}`;
      try {
        const doc = await firestore.collection('census_cache').doc(runAllCacheKey).get();
        if (doc.exists) {
          await doc.ref.delete();
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
  try {
    // Query for all step caches for this state/algorithm
    const stepCacheQuery = firestore.collection('census_cache')
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
          await doc.ref.delete();
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
        await firestore.collection('census_cache').doc(nextStepCacheKey).delete();
        deletedCount++;
      } catch (deleteError) {
        // Continue with other steps even if one fails
      }
    }
    console.log(`🗑️ Invalidated ${deletedCount} subsequent step cache(s) (steps ${step + 1} to 100) for ${state} using fallback method`);
  }
}

/**
 * Delete all algorithm cache for a state (trash/clear-cache).
 * Removes step 0..N, algorithm state, and union polygons from Firestore and Cloud Storage.
 * Does NOT touch external data (tract boundaries, census tract data, state tract cache).
 */
async function deleteAlgorithmCacheForState(state, maxIterations) {
  const stateKey = getAlgorithmStateKey(state, maxIterations);
  const currentVersion = ALGORITHM_VERSION;
  let firestoreDeleted = 0;

  // 1. Delete all step docs: algorithm_step_{state}_{maxIterations}_*
  for (let stepNum = 0; stepNum <= 100; stepNum++) {
    const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    try {
      const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
      if (doc.exists) {
        await doc.ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
    const runAllKey = `step_${state}_${stepNum}_${currentVersion}`;
    try {
      const doc = await firestore.collection('census_cache').doc(runAllKey).get();
      if (doc.exists) {
        await doc.ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }

  // 2. Delete algorithm state (Firestore + Cloud Storage)
  await deleteCachedAlgorithmState(stateKey);
  firestoreDeleted++; // count as one logical delete

  // 3. List union polygon keys from Cloud Storage, delete Firestore docs for each, then delete Cloud files
  const unionKeys = await cloudStorageCache.listUnionPolygonKeysForState(state, 0);
  for (const key of unionKeys) {
    try {
      const ref = firestore.collection('census_cache').doc(key);
      const d = await ref.get();
      if (d.exists) {
        await ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }
  const cloudResult = await cloudStorageCache.deleteUnionPolygonsForState(state, 0);
  console.log(`🗑️ CLEAR-CACHE: Deleted algorithm cache for ${state}: ${firestoreDeleted} Firestore doc(s), ${cloudResult.deleted} Cloud Storage union file(s)`);
  return { firestoreDeleted, cloudDeleted: cloudResult.deleted };
}

/**
 * Delete algorithm cache from step 1 onward and algorithm state (restart).
 * Keeps step 0 and its union polygon. Caller should then set algorithm state to iteration 0.
 */
async function deleteAlgorithmCacheFromStep1ForState(state, maxIterations) {
  const stateKey = getAlgorithmStateKey(state, maxIterations);
  const currentVersion = ALGORITHM_VERSION;
  let firestoreDeleted = 0;

  // 1. Delete step docs for step >= 1 only
  for (let stepNum = 1; stepNum <= 100; stepNum++) {
    const stepCacheKey = `algorithm_step_${state}_${maxIterations}_${stepNum}`;
    try {
      const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
      if (doc.exists) {
        await doc.ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
    const runAllKey = `step_${state}_${stepNum}_${currentVersion}`;
    try {
      const doc = await firestore.collection('census_cache').doc(runAllKey).get();
      if (doc.exists) {
        await doc.ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }

  // 2. Delete algorithm state (Firestore + Cloud Storage)
  await deleteCachedAlgorithmState(stateKey);
  firestoreDeleted++;

  // 3. List union polygon keys from Cloud Storage (step >= 1), delete Firestore docs, then delete Cloud files
  const unionKeys = await cloudStorageCache.listUnionPolygonKeysForState(state, 1);
  for (const key of unionKeys) {
    try {
      const ref = firestore.collection('census_cache').doc(key);
      const d = await ref.get();
      if (d.exists) {
        await ref.delete();
        firestoreDeleted++;
      }
    } catch (e) { /* continue */ }
  }
  const cloudResult = await cloudStorageCache.deleteUnionPolygonsForState(state, 1);
  console.log(`🗑️ RESTART: Deleted algorithm cache from step 1 for ${state}: ${firestoreDeleted} Firestore doc(s), ${cloudResult.deleted} Cloud Storage union file(s)`);
  return { firestoreDeleted, cloudDeleted: cloudResult.deleted };
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
      
      const tracts = tractIds.map(id => tractLookup.get(id)).filter(Boolean);
      const missingCount = tractIds.length - tracts.length;
      
      if (missingCount > 0) {
        // Show some missing IDs for debugging
        const missingIds = tractIds.filter(id => !tractLookup.has(id)).slice(0, 3);
        console.log(`   ⚠️ Group ${idx + 1}: ${missingCount} missing tracts. Sample missing IDs: ${missingIds.join(', ')}`);
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
  
  if (totalTractsWithoutGeometry > 0) {
    const percentage = ((totalTractsWithoutGeometry / totalTracts) * 100).toFixed(1);
    console.error(`❌ RECONSTRUCT FAILED: ${totalTractsWithoutGeometry} out of ${totalTracts} tracts (${percentage}%) are missing geometry.`);
    console.error(`   This indicates the tract cache is corrupted or incomplete. Returning null to force re-execution.`);
    return null; // Return null to force re-execution
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
                const unionCacheDoc = await firestore.collection('census_cache').doc(group.unionPolygonCacheKey).get();
                if (unionCacheDoc.exists) {
                  const metadata = unionCacheDoc.data();
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
          // Some groups missing - need to recreate
          const isStep0 = stepNumber === 0 || stepNumber === '0';
          if (isStep0) {
            // For Step 0, fetch TIGER state boundaries instead of creating union polygons from tracts
            console.log(`⚠️ RECONSTRUCT: Step 0 union polygons missing from cache, fetching TIGER state boundaries...`);
            // Note: TIGER boundaries should be fetched by the caller (e.g., in final-step endpoint)
            // We can't fetch them here without access to req object, so we'll leave them empty
            // The caller should handle fetching TIGER boundaries for step 0
            console.warn(`⚠️ RECONSTRUCT: Step 0 groups missing union polygons - caller should fetch TIGER state boundaries`);
          } else {
            console.log(`⚠️ RECONSTRUCT: Only ${loadedCount}/${reconstructed.districtGroups.length} union polygons loaded from cache, recreating missing ones...`);
            await recreateUnionPolygonsForGroups(reconstructed.districtGroups, true, stepNumber); // Pass step number for proper structure
          }
        }
      } catch (error) {
        const isStep0 = stepNumber === 0 || stepNumber === '0';
        if (isStep0) {
          console.warn(`⚠️ RECONSTRUCT: Failed to load Step 0 union polygons from cache: ${error.message} - caller should fetch TIGER state boundaries`);
        } else {
          console.warn(`⚠️ RECONSTRUCT: Failed to load union polygons from cache: ${error.message}, recreating...`);
          await recreateUnionPolygonsForGroups(reconstructed.districtGroups, true, stepNumber); // Pass step number for proper structure
        }
      }
    } else {
      // No state/step info - check if it's step 0
      const isStep0 = stepNumber === 0 || stepNumber === '0';
      if (isStep0) {
        console.warn(`⚠️ RECONSTRUCT: Step 0 missing state/step info - caller should fetch TIGER state boundaries`);
      } else {
        console.log(`⚠️ RECONSTRUCT: Missing state/step info, recreating union polygons...`);
        await recreateUnionPolygonsForGroups(reconstructed.districtGroups, true, stepNumber); // Pass step number for proper structure
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
  
  const { createUnionPolygonsForGroup } = require('./services/geodistrict-algorithm');
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
  
  try {
    // Recreate union polygons for each district group (only for non-Step-0)
    for (const group of districtGroups) {
      // Skip if already has union polygons (from cache)
      if (group.unionPolygon || group.unionPolygons) {
        continue;
      }
      
      if (group.censusTracts && group.censusTracts.length > 0) {
        // At non-Step-0 steps: Use forceSingleUnion=true to create one union polygon for all tracts (for visualization)
        const unionResult = createUnionPolygonsForGroup(group, adjacencyGraph, true, stepNumber);
        
        if (unionResult) {
          if (Array.isArray(unionResult) && unionResult.length > 0) {
            // Multiple polygons: store as array with main first, then islands
            group.unionPolygon = unionResult[0]; // Main polygon (for backward compatibility)
            group.unionPolygons = unionResult; // Array with main + islands
          } else {
            // Single polygon: store as unionPolygon
            group.unionPolygon = unionResult;
            group.unionPolygons = undefined; // Clear array if single polygon
          }
        }
      }
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

    const step0IslandSet = Array.isArray(step0IslandTractIds) ? new Set(step0IslandTractIds) : (step0IslandTractIds || null);
    console.log(`🔍 Detecting isolated tracts for ${districtGroups.length} groups with ${allTracts.length} total tracts` + (step0IslandSet?.size ? ` (excluding ${step0IslandSet.size} step-0 island tracts)` : ''));

    // Ensure S4 adjacency data is loaded (required for isolation detection)
    if (allTracts.length > 0) {
      let state = allTracts[0]?.properties?.['STATE'] || allTracts[0]?.properties?.state || allTracts[0]?.properties?.['STATE_FIPS'] || '';
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

    // Call the detection method (stepNumber and step0IslandTractIds exclude geographic islands from isolation at steps 1+)
    const detectionResult = algorithmService.detectIsolatedTracts(districtGroups, allTracts, stepNumber ?? null, step0IslandSet);

    // Convert Sets to Arrays for JSON serialization
    const isolatedTractsByGroup = {};
    detectionResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
      isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
    });

    const isolatedTractIds = Array.from(detectionResult.isolatedTractIds);

    // For each group with isolated tracts, get balancing tract IDs (preview for UI)
    const balancingTractIdsByGroup = {};
    for (const groupIndexStr of Object.keys(isolatedTractsByGroup)) {
      const groupIndex = parseInt(groupIndexStr, 10);
      const ids = algorithmService.getBalancingTractIdsForGroup(districtGroups, allTracts, groupIndex);
      balancingTractIdsByGroup[groupIndexStr] = ids && ids.length > 0 ? ids : [];
    }

    res.json({
      isolatedTractsByGroup,
      isolatedTractIds,
      totalIsolated: isolatedTractIds.length,
      groupsWithIsolation: Object.keys(isolatedTractsByGroup).length,
      groupStats: detectionResult.groupStats || [],
      balancingTractIdsByGroup
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
          await firestore.collection('census_cache').doc(stepCacheKey).delete();
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

    console.log(`🔄 Moving ${isolatedTractIds.length} isolated tract(s) from group ${isolatedGroupIndex} to opposite group`);

    // Call the move method with divisionLines (sibling relationships) if provided
    const result = algorithmService.moveIsolatedTractsToOppositeGroup(
      districtGroups,
      allTracts,
      isolatedGroupIndex,
      isolatedTractIds,
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
          await firestore.collection('census_cache').doc(stepCacheKey).delete();
          console.log(`🗑️ Invalidated cached step ${step} for ${state} after moving isolated tracts`);
        } catch (deleteError) {
          console.warn(`⚠️ Failed to invalidate cached step ${step}: ${deleteError.message}`);
        }
        
        // Also invalidate all subsequent step caches since they depend on this step
        await invalidateSubsequentStepCaches(state, maxIterations, step);
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

    // Fast path: frontend sent full district groups + isolated data. No cache I/O - just swap tracts in memory.
    const canUseFastPath = bodyDistrictGroups && Array.isArray(bodyDistrictGroups) && bodyDistrictGroups.length > 0 &&
      bodyDistrictGroups.every(g => Array.isArray(g.censusTracts)) &&
      frontendIsolatedTractsData && frontendIsolatedTractsData.isolatedTractsByGroup &&
      Object.keys(frontendIsolatedTractsData.isolatedTractsByGroup).length > 0;

    if (canUseFastPath) {
      const { getTractId } = require('./services/geodistrict-algorithm');
      const allTracts = [];
      for (const group of bodyDistrictGroups) {
        for (const t of group.censusTracts || []) {
          if (t && getTractId(t)) allTracts.push(t);
        }
      }
      const step0IslandSet = Array.isArray(bodyStep0IslandTractIds) ? new Set(bodyStep0IslandTractIds) : null;
      let isolatedTractsByGroup = frontendIsolatedTractsData.isolatedTractsByGroup;
      let updatedGroups = bodyDistrictGroups.map(g => ({ ...g, censusTracts: [...(g.censusTracts || [])] }));
      const divisionLines = bodyDivisionLines || [];
      let groupIndices = Object.keys(isolatedTractsByGroup).map(idx => parseInt(idx)).sort((a, b) => a - b);
      let iterationCount = 0;
      const maxIter = 10;
      // Tracts we skipped (no neighbor in target) per group - do not retry to avoid infinite loop
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

      if (divisionLines && divisionLines.length > 0) {
        updatedGroups = algorithmService.balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, divisionLines);
      }

      const finalIsolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
      const finalIsolatedTractsByGroup = {};
      finalIsolationResult.isolatedTractsByGroup.forEach((tractIds, idx) => { finalIsolatedTractsByGroup[idx] = Array.from(tractIds); });

      const totalRemaining = finalIsolationResult.isolatedTractIds.size;
      return res.json({
        districtGroups: updatedGroups,
        isolationResult: {
          isolatedTractsByGroup: finalIsolatedTractsByGroup,
          isolatedTractIds: Array.from(finalIsolationResult.isolatedTractIds),
          totalIsolated: totalRemaining,
          groupsWithIsolation: Object.keys(finalIsolatedTractsByGroup).length
        },
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
      let stepDoc = await firestore.collection('census_cache').doc(`algorithm_step_${state}_${maxIterations}_${step}`).get();
      let cachedEntry = stepDoc.exists ? stepDoc.data() : null;

      if (cachedEntry) {
        if (cachedEntry.timestamp && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) {
          cachedEntry = null;
        } else if (cachedEntry.algorithmVersion !== currentVersion) {
          cachedEntry = null;
        }
      }

      if (!cachedEntry) {
        stepDoc = await firestore.collection('census_cache').doc(`step_${state}_${step}_${currentVersion}`).get();
        if (stepDoc.exists) {
          cachedEntry = stepDoc.data();
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
        const doc = await firestore.collection('census_cache').doc(key).get();
        if (doc.exists) {
          stateTractDoc = doc;
          tractCacheKey = key;
          break;
        }
      }
      if (!stateTractDoc || !stateTractDoc.exists) {
        console.error(`❌ State tract cache not found for ${state} (tried: ${tractCacheKeysToTry.join(', ')})`);
        return res.status(404).json({ error: `State tract cache not found. Please initialize the algorithm first.` });
      }

      const stateTractData = stateTractDoc.data();
      let tractMap = null;
      
      // Get tract map from Cloud Storage or Firestore
      if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
        const cloudStorageResult = await cloudStorageCache.get(tractCacheKey);
        if (cloudStorageResult && cloudStorageResult.data) {
          tractMap = cloudStorageResult.data;
        }
      } else if (stateTractData.chunked && stateTractData.chunkKeys) {
        const chunkDocs = await Promise.all(
          stateTractData.chunkKeys.map(key => firestore.collection('census_cache').doc(key).get())
        );
        const allTracts = [];
        for (const chunkDoc of chunkDocs) {
          if (chunkDoc.exists && chunkDoc.data().data) {
            allTracts.push(...chunkDoc.data().data);
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
      let stepDoc = await firestore.collection('census_cache').doc(`algorithm_step_${state}_${maxIterations}_${step}`).get();
      let cachedEntry = stepDoc.exists ? stepDoc.data() : null;
      if (cachedEntry && cachedEntry.timestamp && !isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl) && cachedEntry.algorithmVersion === currentVersion) {
        // use as-is
      } else {
        cachedEntry = null;
        stepDoc = await firestore.collection('census_cache').doc(`step_${state}_${step}_${currentVersion}`).get();
        if (stepDoc.exists) {
          cachedEntry = stepDoc.data();
          if (cachedEntry && ((cachedEntry.timestamp && cachedEntry.ttl && isCacheExpired(cachedEntry.timestamp, cachedEntry.ttl)) || cachedEntry.algorithmVersion !== currentVersion)) {
            cachedEntry = null;
          }
        }
      }
      if (cachedEntry) {
        const hasStepDataField = cachedEntry.stepData !== undefined;
        const dataToReconstruct = hasStepDataField ? cachedEntry.stepData : cachedEntry;
        const tractCacheKeysToTry = [`state_tracts_${state}`, `state_tracts_${state.toLowerCase()}`, `state_tracts_${state.toUpperCase()}`];
        let tractMap = null;
        for (const key of tractCacheKeysToTry) {
          const stateTractDoc = await firestore.collection('census_cache').doc(key).get();
          if (!stateTractDoc.exists) continue;
          const stateTractData = stateTractDoc.data();
          if (stateTractData.cloudStorage && stateTractData.cloudStoragePath) {
            const cloudStorageResult = await cloudStorageCache.get(key);
            if (cloudStorageResult && cloudStorageResult.data) tractMap = cloudStorageResult.data;
          } else if (stateTractData.chunked && stateTractData.chunkKeys) {
            const chunkDocs = await Promise.all(stateTractData.chunkKeys.map(k => firestore.collection('census_cache').doc(k).get()));
            tractMap = [];
            for (const chunkDoc of chunkDocs) {
              if (chunkDoc.exists && chunkDoc.data().data) tractMap.push(...chunkDoc.data().data);
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

    // Get isolated tracts data: step cache, then optional frontend-supplied body, then detect
    let isolatedTractsByGroup = {};
    if (currentStep.isolatedTractsData && currentStep.isolatedTractsData.isolatedTractsByGroup && Object.keys(currentStep.isolatedTractsData.isolatedTractsByGroup).length > 0) {
      isolatedTractsByGroup = currentStep.isolatedTractsData.isolatedTractsByGroup;
      console.log(`📥 Using isolated tracts data from step cache`);
    } else if (frontendIsolatedTractsData && frontendIsolatedTractsData.isolatedTractsByGroup && Object.keys(frontendIsolatedTractsData.isolatedTractsByGroup).length > 0) {
      isolatedTractsByGroup = frontendIsolatedTractsData.isolatedTractsByGroup;
      console.log(`📥 Using isolated tracts data from request body`);
    } else {
      // Detect isolated tracts now (for backward compatibility)
      console.log(`⚠️ No isolated tracts data in step cache or request, detecting now...`);
      // Reconstruct uniqueTracts if needed
    if (!algorithmState.uniqueTracts && algorithmState.uniqueTractIds) {
      algorithmState.uniqueTracts = await reconstructUniqueTracts(algorithmState);
    }
    const allTractsForDetect = algorithmState.uniqueTracts || [];
      const step0IslandForDetect = buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds);
      const detectionResult = algorithmService.detectIsolatedTracts(currentStep.districtGroups, allTractsForDetect, step, step0IslandForDetect);
      // Convert Map to object
      detectionResult.isolatedTractsByGroup.forEach((tractIds, groupIndex) => {
        isolatedTractsByGroup[groupIndex] = Array.from(tractIds);
      });
      
      // Update step with detected data
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

    const step0IslandSet = buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds);
    if (step0IslandSet && step0IslandSet.size > 0) {
      console.log(`🏝️ Excluding ${step0IslandSet.size} step-0 island tract(s) from isolation detection`);
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
    // Tracts we skipped (no neighbor in target) per group - do not retry to avoid infinite loop
    const skippedByGroup = {};

    // Recursively process until no more isolated tracts remain
    while (groupIndices.length > 0 && iterationCount < maxProcessingIterations) {
      iterationCount++;
      console.log(`🔄 Iteration ${iterationCount}: Processing ${groupIndices.length} group(s) with isolated tracts: ${groupIndices.join(', ')}`);

      // Process each group sequentially in this iteration
      for (const groupIndex of groupIndices) {
        const isolatedTractIds = isolatedTractsByGroup[groupIndex.toString()] || [];
        
        if (isolatedTractIds.length === 0) {
          continue;
        }

        console.log(`   Moving ${isolatedTractIds.length} isolated tract(s) from group ${groupIndex}`);

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
      const isolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
      
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
      
      console.log(`🔄 Still have ${remainingCount} isolated tracts in ${Object.keys(newIsolatedTractsByGroup).length} groups. Continuing...`);
      
      groupIndices.length = 0;
      groupIndices.push(...newGroupIndices);
    }

    if (iterationCount >= maxProcessingIterations) {
      console.warn(`⚠️ Reached max iterations (${maxProcessingIterations}) while processing isolated tracts`);
    }

    if (currentStep.divisionLines && currentStep.divisionLines.length > 0) {
      updatedGroups = algorithmService.balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, currentStep.divisionLines);
    }

    // Final isolation detection
    const finalIsolationResult = algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet);
    
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
      await firestore.collection('census_cache').doc(stepCacheKey).delete();
      console.log(`🗑️ Invalidated cached step ${step} for ${state} after moving isolated tracts`);
    } catch (deleteError) {
      console.warn(`⚠️ Failed to invalidate cached step ${step}: ${deleteError.message}`);
    }

    // Invalidate all subsequent step caches
    await invalidateSubsequentStepCaches(state, maxIterations, step);

    // Recreate union polygons for all groups after moving isolated tracts
    // Clear existing union polygons first to force recreation
    for (const group of updatedGroups) {
      group.unionPolygon = undefined;
      group.unionPolygons = undefined;
    }
    await recreateUnionPolygonsForGroups(updatedGroups, true, step); // Pass step number for proper structure

    // Save the updated step back to cache as the final step (since isolated tracts have been moved)
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

      // Cache union polygons for this updated step
      const unionPolygonCacheKeys = await cacheUnionPolygons(state, step, updatedGroups);
      
      // Add union polygon cache keys to normalized groups
      if (Object.keys(unionPolygonCacheKeys).length > 0) {
        normalizedStep.normalized.districtGroups = normalizedStep.normalized.districtGroups.map((group, index) => {
          if (unionPolygonCacheKeys[index]) {
            group.unionPolygonCacheKey = unionPolygonCacheKeys[index];
          }
          return group;
        });
      }

      // Save the updated step to cache with isComplete: true (this is the final step after moving isolated tracts)
      const cacheData = {
        stepData: normalizedStep.normalized,
        isComplete: true, // Mark as complete since isolated tracts have been moved
        algorithmVersion: ALGORITHM_VERSION,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        source: 'algorithm-step-cache',
        normalized: true,
        tractCacheKey: tractCacheKey,
        state: state,
        step: step,
        unionPolygonsCached: Object.keys(unionPolygonCacheKeys).length > 0
      };

      await firestore.collection('census_cache').doc(stepCacheKey).set(cacheData);
      console.log(`💾 STEP CACHE STORED: Saved updated step ${step} for ${state} as final step (after moving isolated tracts)`);
    } catch (cacheError) {
      console.warn(`⚠️ STEP CACHE STORE ERROR: Failed to save updated step after moving isolated tracts: ${cacheError.message}`);
      // Don't fail the request if caching fails
    }

    res.json({
      districtGroups: updatedGroups,
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
      await firestore.collection('census_cache').doc(cacheKey).delete();
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
    const { state, year = 2020 } = req.query;

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server after testing Firestore access
(async () => {
  await testFirestoreAccess();
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})();

module.exports = app;
