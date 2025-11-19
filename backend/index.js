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
const { GeodistrictAlgorithmService, getDistrictsForState, ALGORITHM_VERSION } = require('./services/geodistrict-algorithm');
const latLongDivisionService = require('./services/latlong-division');
const voterRegistrationLoader = require('./services/voter-registration-loader');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enable garbage collection for better memory management
if (global.gc) {
  console.log('Garbage collection is available');
} else {
  console.log('Garbage collection is not available - consider running with --expose-gc');
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
    console.log('🔍 Testing Firestore access...');
    console.log(`   Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'}`);
    console.log(`   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set'}`);
    
    // Try to access Firestore - this will fail if credentials aren't available
    const testDoc = await firestore.collection('census_cache').doc('_startup_test').get();
    console.log('✅ Firestore access verified - credentials are available');
    
    // Test Cloud Storage access (non-blocking - will fallback to Firestore if unavailable)
    try {
      await cloudStorageCache.initialize();
      console.log('✅ Cloud Storage access verified');
    } catch (cloudError) {
      console.warn('⚠️ Cloud Storage initialization warning:', cloudError.message);
      console.warn('⚠️ Cloud Storage will be skipped if unavailable (fallback to Firestore chunking)');
    }
  } catch (error) {
    console.error('❌ FIRESTORE ACCESS ERROR:', error.message);
    console.error('❌ Full error:', error);
    
    if (error.message && error.message.includes('Could not load the default credentials')) {
      console.error('\n❌ FIRESTORE CREDENTIALS ERROR: Could not load default credentials');
      console.error('❌ Please run: gcloud auth application-default login');
      console.error('❌ Or set GOOGLE_APPLICATION_CREDENTIALS environment variable');
      console.error('❌ Make sure Firestore API is enabled: gcloud services enable firestore.googleapis.com');
      process.exit(1);
    } else if (error.message && error.message.includes('PERMISSION_DENIED')) {
      console.error('\n❌ FIRESTORE PERMISSION ERROR: Access denied');
      console.error('❌ Make sure your account has Firestore permissions');
      console.error('❌ Check: gcloud projects get-iam-policy geodistricts');
      process.exit(1);
    } else {
      // Other errors (like network issues) are OK - we'll handle them at runtime
      console.log('⚠️ Firestore test had an error (will continue):', error.message);
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

/**
 * Get unique tract ID from a tract feature
 */
function getTractId(tract) {
  if (!tract || !tract.properties) return null;
  // Try multiple possible ID fields
  return tract.properties.GISJOIN || 
         tract.properties.GEOID || 
         tract.properties.TRACT_FIPS || 
         `${tract.properties.STATE_FIPS || ''}${tract.properties.COUNTY_FIPS || ''}${tract.properties.TRACT_FIPS || ''}` ||
         null;
}

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
    timestamp: new Date().toISOString(),
    endpoints: {
      algorithmExecute: '/api/algorithm/execute',
      algorithmStepByStep: '/api/algorithm/execute/step-by-step',
      algorithmCache: '/api/algorithm/cache'
    }
  });
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
    
    // Cache the result
    await setCache(cacheKey, counties);
    
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
    
    // Cache the result
    await setCache(cacheKey, transformedData);
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
  
  const countResponse = await axios.get(`${serviceUrl}?${countParams.toString()}`);
  return countResponse.data.properties?.count || 0;
}

/**
 * Handle streaming response for large datasets
 */
async function handleStreamingResponse(req, res, state, county, cacheKey, totalCount) {
  const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
  let whereClause = `STATE_FIPS='${state}'`;
  if (county) {
    whereClause += ` AND COUNTY_FIPS='${county}'`;
  }
  
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
    const response = await axios.get(`${serviceUrl}?${params.toString()}`);
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: response.data.features || []
    };
    
    // Cache the response
    await setCache(cacheKey, geojsonResponse);
    
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
    console.log(`🔍 ALGORITHM CACHE CHECK: Key=${cacheKey}, USE_LOCAL_CACHE=${USE_LOCAL_CACHE}, NODE_ENV=${process.env.NODE_ENV}, GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`);

    // Algorithm cache always uses Firestore (shared between localhost and production)
    let cachedEntry;
    console.log(`🔍 FIRESTORE ALGORITHM CACHE: Checking Firestore for key: ${cacheKey}`);
    const doc = await firestore.collection('census_cache').doc(cacheKey).get();
    
    if (!doc.exists) {
      console.log(`❌ FIRESTORE ALGORITHM CACHE: No document found for key: ${cacheKey}`);
      cachedEntry = null;
    } else {
      const data = doc.data();
      
      // Check if expired
      if (isCacheExpired(data.timestamp, data.ttl)) {
        console.log(`⏰ FIRESTORE ALGORITHM CACHE: Cache expired for key: ${cacheKey}, deleting`);
        await firestore.collection('census_cache').doc(cacheKey).delete();
        cachedEntry = null;
      } else {
        console.log(`✅ FIRESTORE ALGORITHM CACHE HIT: Retrieved data for key: ${cacheKey}`);
        cachedEntry = data;
      }
    }
    console.log(`🔍 CACHE LOOKUP: Key=${cacheKey}, Found=${!!cachedEntry}, Normalized=${cachedEntry?.normalized}, TractCacheKey=${cachedEntry?.tractCacheKey}`);

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
          message: 'Cache entry outdated (no algorithm version)'
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
          message: 'Cache entry outdated due to algorithm version change'
        });
      }
      
      // Handle normalized cache (v2.0) - fetch state-level tract cache
      let decompressedResult;
      if (cachedEntry.normalized && cachedEntry.tractCacheKey) {
        // Fetch state-level tract cache (always uses Firestore)
        let stateTractCache;
        const stateTractDoc = await firestore.collection('census_cache').doc(cachedEntry.tractCacheKey).get();
        if (stateTractDoc.exists) {
          const stateTractData = stateTractDoc.data();
          if (!isCacheExpired(stateTractData.timestamp, stateTractData.ttl)) {
            stateTractCache = stateTractData;
          }
        }
        
        // Check if tract cache is chunked
        if (stateTractCache && stateTractCache.chunked && stateTractCache.chunkKeys) {
          // Fetch all chunks and combine
          console.log(`📦 Fetching ${stateTractCache.totalChunks} tract cache chunks...`);
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
          
          console.log(`✅ Combined ${allTracts.length} tracts from ${chunkDocs.length} chunks`);
          stateTractCache = {
            ...stateTractCache,
            data: allTracts,
            tractCount: allTracts.length
          };
        }
        
        if (!stateTractCache || !stateTractCache.data) {
          console.warn(`⚠️ State tract cache not found for key: ${cachedEntry.tractCacheKey}`);
          return res.json({
            status: 'miss',
            cached: false,
            message: 'State tract cache not found'
          });
        }
        
        // Decompress using state-level tract cache
        decompressedResult = decompressGeodistrictResult(cachedEntry.data, stateTractCache.data);
        console.log(`✅ ALGORITHM CACHE HIT (${algorithm}): Retrieved normalized result for key: ${cacheKey} with ${stateTractCache.tractCount || stateTractCache.data?.length || 0} tracts (algorithm version: ${cachedVersion || 'unknown'})`);
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

    console.log(`🚀 Executing algorithm for ${state} (${totalDistricts} districts, maxIterations: ${maxIterations}, version: ${currentVersion})`);

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
          
          console.log(`🔍 CACHE CHECK: Found cached result for ${cacheKey}, cached version: ${cachedVersion || 'missing'}, current version: ${currentVersion}`);
          
          // If no version is stored, treat as old cache and invalidate
          if (!cachedVersion) {
            console.log(`🔄 ALGORITHM VERSION MISSING: Old cache entry without version. Invalidating and re-executing.`);
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
            console.log(`🔄 ALGORITHM VERSION MISMATCH: Cached version ${cachedVersion} != current ${currentVersion}. Invalidating cache and re-executing.`);
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
        console.log(`❌ CACHE MISS: No cached result found, executing algorithm`);
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

    // Get tract data from census proxy
    // First, get boundaries - force invalidate if cache is empty
    let boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}`;
    console.log(`📡 Fetching boundaries from: ${boundariesUrl}`);
    let boundariesResponse = await axios.get(boundariesUrl);
    
    console.log(`📦 Boundaries response status: ${boundariesResponse.status}`);
    console.log(`📦 Boundaries response data type: ${typeof boundariesResponse.data}`);
    console.log(`📦 Boundaries response has features: ${!!boundariesResponse.data?.features}`);
    console.log(`📦 Boundaries features count: ${boundariesResponse.data?.features?.length || 0}`);
    
    // If cached data is empty, force invalidate and fetch fresh
    if (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0) {
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
    // Force invalidate to bypass cached empty responses from when we used state abbreviations instead of FIPS codes
    const demographicDataPromises = counties.map(county => {
      const countyFips = county.COUNTY || county.county || county.fips;
      const tractDataUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}&county=${countyFips}&forceInvalidate=true`;
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

    // Combine boundary and demographic data
    const tracts = boundaries.features.map(feature => {
      const tractId = feature.properties?.TRACT_FIPS || feature.properties?.GEOID;
      const demographic = demographicData.find(d => {
        const dTractId = d.GEO_ID?.split('US')[1] || d.GEOID || d.TRACT_FIPS;
        return dTractId === tractId;
      });

      return {
        ...feature,
        properties: {
          ...feature.properties,
          ...demographic,
          POPULATION: demographic?.B01001_001E || feature.properties?.POPULATION || 0,
          STATE: state
        }
      };
    });

    if (tracts.length === 0) {
      return res.status(404).json({ error: `No tracts found for state: ${state}` });
    }

    console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

    // Execute algorithm
    const startTime = Date.now();
    const result = await algorithmService.executeGeodistrictAlgorithm(
      tracts,
      totalDistricts,
      maxIterations,
      options.forceInvalidate || false
    );
    const executionTime = Date.now() - startTime;

    console.log(`✅ Algorithm completed in ${executionTime}ms (${result.steps.length} steps)`);

    // Cache the result automatically (async, don't wait for it)
    // Use backend's own algorithm version when caching
    cacheAlgorithmResult(cacheKey, result, state, currentVersion, null, null)
      .then(cacheResult => {
        if (cacheResult.success) {
          console.log(`💾 Backend automatically cached result for ${state} (${cacheResult.sizes?.normalizedMB || 0} MB algorithm, ${cacheResult.sizes?.tractCacheMB || 0} MB tracts)`);
        } else {
          console.warn(`⚠️ Backend caching failed for ${state}: ${cacheResult.error}`);
        }
      })
      .catch(err => {
        console.error(`❌ Backend caching error for ${state}:`, err.message);
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
    console.error('❌ Algorithm execution error:', error);
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
// Store algorithm state in memory (keyed by state+algorithm+maxIterations)
const algorithmStateStore = new Map();

/**
 * Generate a key for algorithm state storage
 */
function getAlgorithmStateKey(state, maxIterations) {
  return `${state}_${maxIterations}`;
}

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

    console.log(`🚀 Initializing algorithm for ${state} (${totalDistricts} districts)`);

    // Get tract data from census proxy
    try {
      const boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}`;
      const boundariesResponse = await axios.get(boundariesUrl);
      
      if (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0) {
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
      // Force invalidate to bypass cached empty responses from when we used state abbreviations instead of FIPS codes
      const demographicDataPromises = counties.map(county => {
        const countyFips = county.COUNTY || county.county || county.fips;
        const tractDataUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}&county=${countyFips}&forceInvalidate=true`;
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

      // Combine boundary and demographic data
      const tracts = boundaries.features.map(feature => {
        const tractId = feature.properties?.TRACT_FIPS || feature.properties?.GEOID;
        const demographic = demographicData.find(d => {
          const dTractId = d.GEO_ID?.split('US')[1] || d.GEOID || d.TRACT_FIPS;
          return dTractId === tractId;
        });

        return {
          ...feature,
          properties: {
            ...feature.properties,
            ...demographic,
            POPULATION: demographic?.B01001_001E || feature.properties?.POPULATION || 0,
            STATE: state
          }
        };
      });

      if (tracts.length === 0) {
        return res.status(404).json({ error: `No tracts found for state: ${state}` });
      }

      console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

      // Initialize algorithm and get step 0
      const { step, state: algorithmState } = await algorithmService.initializeAlgorithm(
        tracts,
        totalDistricts,
        maxIterations
      );

      // Store algorithm state
      const stateKey = getAlgorithmStateKey(state, maxIterations);
      algorithmStateStore.set(stateKey, algorithmState);

      console.log(`✅ Step 0 initialized: ${step.districtGroups[0]?.censusTracts.length || 0} tracts`);

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
 * POST /api/algorithm/execute/next-step
 * Execute the next step of the algorithm
 */
app.post('/api/algorithm/execute/next-step', async (req, res) => {
  try {
    const { state, maxIterations = 100 } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    const stateKey = getAlgorithmStateKey(state, maxIterations);
    const algorithmState = algorithmStateStore.get(stateKey);

    if (!algorithmState) {
      return res.status(404).json({ error: 'Algorithm not initialized. Call /execute/step-by-step first.' });
    }

    console.log(`🚀 Executing next step for ${state} (iteration ${algorithmState.iteration + 1})`);

    // Execute next step
    const { step, state: updatedState, isComplete } = await algorithmService.executeNextStep(algorithmState);

    if (isComplete) {
      // Remove state from store when complete
      algorithmStateStore.delete(stateKey);
      console.log(`✅ Algorithm completed after ${updatedState.iteration} iterations`);
    } else {
      // Update stored state
      algorithmStateStore.set(stateKey, updatedState);
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
