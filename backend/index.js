const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const compression = require('compression');
const localCache = require('./local-cache');
const { GeodistrictAlgorithmService, getDistrictsForState } = require('./services/geodistrict-algorithm');
const latLongDivisionService = require('./services/latlong-division');
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
 * Test Firestore access on startup - exit if credentials are not available
 */
async function testFirestoreAccess() {
  try {
    console.log('🔍 Testing Firestore access...');
    console.log(`   Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'}`);
    console.log(`   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set'}`);
    
    // Try to access Firestore - this will fail if credentials aren't available
    const testDoc = await firestore.collection('census_cache').doc('_startup_test').get();
    console.log('✅ Firestore access verified - credentials are available');
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
 * Get data from cache (local files or Firestore)
 */
async function getFromCache(key) {
  if (USE_LOCAL_CACHE) {
    return await localCache.getFromCache(key);
  } else {
    try {
      console.log(`🔍 FIRESTORE CACHE: Checking cache for key: ${key}`);
      
      const doc = await firestore.collection('census_cache').doc(key).get();
      
      if (!doc.exists) {
        console.log(`❌ FIRESTORE CACHE: No document found for key: ${key}`);
        return null;
      }
      
      const data = doc.data();
      
      // Check if expired
      if (isCacheExpired(data.timestamp, data.ttl)) {
        console.log(`⏰ FIRESTORE CACHE: Cache expired for key: ${key}, deleting`);
        await firestore.collection('census_cache').doc(key).delete();
        return null;
      }
      
      // Check version
      if (data.version !== CACHE_VERSION) {
        console.log(`🔄 FIRESTORE CACHE: Cache version mismatch for key: ${key}, deleting`);
        await firestore.collection('census_cache').doc(key).delete();
        return null;
      }
      
      console.log(`✅ FIRESTORE CACHE HIT: Retrieved data for key: ${key}`);
      // Return the full cache entry (not just data.data) so algorithmVersion is available
      return data;
    } catch (error) {
      console.error('❌ FIRESTORE CACHE ERROR: Failed to get from cache for key:', key);
      console.error('❌ FIRESTORE CACHE ERROR:', error.message);
      console.error('❌ FIRESTORE CACHE ERROR:', error);
      return null;
    }
  }
}

/**
 * Store data in cache (local files or Firestore)
 */
async function setCache(key, data, ttl = CACHE_TTL) {
  if (USE_LOCAL_CACHE) {
    return await localCache.setCache(key, data, ttl);
  } else {
    try {
      console.log(`🔄 FIRESTORE CACHE: Attempting to cache data for key: ${key}`);
      
      const cacheEntry = {
        data: data,
        timestamp: Date.now(),
        ttl: ttl,
        version: CACHE_VERSION,
        source: 'U.S. Census Bureau',
        attribution: 'Data provided by the U.S. Census Bureau (public domain)'
      };
      
      const docRef = firestore.collection('census_cache').doc(key);
      await docRef.set(cacheEntry);
      
      console.log(`✅ FIRESTORE CACHE: Successfully cached data for key: ${key}, size: ${JSON.stringify(data).length} bytes`);
      console.log(`📊 FIRESTORE CACHE: Document path: census_cache/${key}`);
    } catch (error) {
      console.error('❌ FIRESTORE CACHE ERROR: Failed to cache data for key:', key);
      console.error('❌ FIRESTORE CACHE ERROR:', error.message);
      console.error('❌ FIRESTORE CACHE ERROR:', error);
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
    
    // Get county data
    queryParams.set('get', 'NAME,COUNTY');
    queryParams.set('for', 'county:*');
    queryParams.set('in', `state:${state}`);
    
    const apiUrl = `${CENSUS_API_BASE}/${ACS_YEAR}/${ACS_DATASET}?${queryParams.toString()}`;
    console.log(`Fetching counties from Census API: ${apiUrl}`);
    
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
    
    // Add variables
    if (params.variables && params.variables.length > 0) {
      queryParams.set('get', params.variables.join(','));
    } else {
      queryParams.set('get', 'NAME,B01003_001E,B19013_001E,B01002_001E');
    }
    
    // Add geography - now always requires state and county
    if (params.tract) {
      queryParams.set('for', `tract:${params.tract}`);
      queryParams.set('in', `state:${params.state} county:${params.county}`);
    } else {
      queryParams.set('for', 'tract:*');
      queryParams.set('in', `state:${params.state} county:${params.county}`);
    }
    
    const apiUrl = `${CENSUS_API_BASE}/${params.year}/${params.dataset}?${queryParams.toString()}`;
    console.log(`Fetching from Census API: ${apiUrl}`);
    
    const response = await axios.get(apiUrl);
    console.log(`Census API response type:`, typeof response.data);
    console.log(`Census API response length:`, response.data ? response.data.length : 'null');
    console.log(`Census API response preview:`, JSON.stringify(response.data).substring(0, 500));
    
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
  const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
  let whereClause = `STATE_FIPS='${state}'`;
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
    
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
    let whereClause = `STATE_FIPS='${state}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }
    
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
 * Cache algorithm results (supports all algorithm types)
 * Uses normalized caching: tract geometries stored separately at state level
 */
app.post('/api/algorithm/:algorithm/cache', async (req, res) => {
  // Declare size variables outside try block for error handler access
  let normalizedSizeMB, tractCacheSizeMB;
  
  try {
    const { cacheKey, divisionResult, ttl, state } = req.body;

    if (!cacheKey || !divisionResult) {
      return res.status(400).json({ error: 'cacheKey and divisionResult are required' });
    }

    // Extract state from cacheKey if not provided (format: STATE_algorithm_maxIterations)
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

    const algorithm = req.params.algorithm || 'latlong';
    const algorithmVersion = req.body.algorithmVersion || 'unknown';
    
    // Check if data is already normalized by frontend
    let normalizedResult, tractMap;
    const isPreNormalized = divisionResult._normalized && req.body.tractMap && Array.isArray(req.body.tractMap) && req.body.tractMap.length > 0;
    
    if (isPreNormalized) {
      // Frontend already normalized - use provided data
      console.log(`✅ Using pre-normalized data from frontend (${divisionResult._tractCount || 0} tracts, tractMap length: ${req.body.tractMap.length})`);
      normalizedResult = divisionResult;
      tractMap = req.body.tractMap; // Use tract map from frontend
    } else {
      // Normalize on backend: separate tract geometries from step data
      console.log(`🔄 Normalizing on backend (pre-normalized: ${!!divisionResult._normalized}, tractMap provided: ${!!req.body.tractMap}, tractMap length: ${req.body.tractMap?.length || 0})`);
      const compressed = compressGeodistrictResult(divisionResult, stateCode);
      normalizedResult = compressed.normalizedResult;
      tractMap = compressed.tractMap;
    }
    
    // Store state-level tract cache (tract geometries)
    const stateTractCacheKey = `state_tracts_${stateCode}`;
    const stateTractCacheEntry = {
      data: tractMap,
      timestamp: Date.now(),
      ttl: null, // No expiration - tract geometries are static
      version: CACHE_VERSION,
      source: 'state-tract-cache',
      attribution: `Tract geometries for state ${stateCode}`,
      compressed: true,
      tractCount: tractMap.length
    };
    
    // Store normalized algorithm result (without tract geometries)
    const normalizedSize = JSON.stringify(normalizedResult).length;
    const tractCacheSize = JSON.stringify(tractMap).length;
    
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
    normalizedSizeMB = (normalizedSize / (1024 * 1024)).toFixed(2);
    tractCacheSizeMB = (tractCacheSize / (1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - normalizedSize / originalSize) * 100).toFixed(1);
    
    console.log(`📊 Normalization: ${originalSizeMB} MB → ${normalizedSizeMB} MB algorithm + ${tractCacheSizeMB} MB tracts (${compressionRatio}% reduction in algorithm cache)`);
    
    // Check if normalized result is still too large for Firestore (1MB limit)
    if (normalizedSize > 1024 * 1024) {
      console.error(`❌ Normalized algorithm result (${normalizedSizeMB} MB) exceeds Firestore 1MB document limit`);
      return res.status(413).json({
        error: 'Document too large for Firestore',
        message: `Normalized algorithm result (${normalizedSizeMB} MB) exceeds Firestore 1MB document limit.`,
        normalizedSizeMB: parseFloat(normalizedSizeMB),
        tractCacheSizeMB: parseFloat(tractCacheSizeMB),
        maxSizeMB: 1
      });
    }
    
    // Remove undefined values from normalizedResult (Firestore doesn't allow undefined)
    const cleanNormalizedResult = JSON.parse(JSON.stringify(normalizedResult, (key, value) => {
      return value === undefined ? null : value;
    }));
    
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
    // Store state tract cache
    const stateTractDocRef = firestore.collection('census_cache').doc(stateTractCacheKey);
    await stateTractDocRef.set(stateTractCacheEntry);
    
    // Store algorithm cache
    const algorithmDocRef = firestore.collection('census_cache').doc(cacheKey);
    await algorithmDocRef.set(algorithmCacheEntry, { ignoreUndefinedProperties: true });
    
    console.log(`💾 ALGORITHM CACHE (${algorithm}): Cached normalized result for key: ${cacheKey} and ${tractMap.length} tracts for state ${stateCode} (FIRESTORE - shared between localhost and production)`);

    res.json({
      status: 'success',
      message: 'Division result cached successfully (normalized)',
      cacheKey,
      stateTractCacheKey,
      sizes: {
        originalMB: parseFloat(originalSizeMB),
        normalizedMB: parseFloat(normalizedSizeMB),
        tractCacheMB: parseFloat(tractCacheSizeMB),
        compressionRatio: parseFloat(compressionRatio),
        tractCount: tractMap.length
      }
    });
  } catch (error) {
    // Check if it's a size-related error
    if (error.message && error.message.includes('size')) {
      console.error(`❌ Firestore document size limit exceeded`);
      return res.status(413).json({
        error: 'Document too large for Firestore',
        message: `Data exceeds Firestore 1MB document limit.`,
        normalizedSizeMB: normalizedSizeMB ? parseFloat(normalizedSizeMB) : 0,
        tractCacheSizeMB: tractCacheSizeMB ? parseFloat(tractCacheSizeMB) : 0,
        maxSizeMB: 1
      });
    }
    console.error('❌ Error caching algorithm result:', error);
    console.error('Error stack:', error.stack);
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
app.get('/api/algorithm/:algorithm/cache/:cacheKey', async (req, res) => {
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
    const algorithm = req.params.algorithm || 'latlong';

    console.log(`🔍 CACHE LOOKUP (${algorithm}): Key=${cacheKey}, Found=${!!cachedEntry}, Normalized=${cachedEntry?.normalized}, TractCacheKey=${cachedEntry?.tractCacheKey}`);

    if (cachedEntry) {
      // Check algorithm version - if it doesn't match, treat as cache miss
      const cachedVersion = cachedEntry.algorithmVersion;
      const requestedVersion = req.query.algorithmVersion || req.headers['x-algorithm-version'];
      
      console.log(`🔍 VERSION CHECK (${algorithm}): Cached=${cachedVersion}, Requested=${requestedVersion}`);
      
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
      if (requestedVersion && cachedVersion !== requestedVersion) {
        console.log(`🔄 ALGORITHM VERSION MISMATCH (${algorithm}): Cached version ${cachedVersion} != requested ${requestedVersion}. Invalidating cache.`);
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
app.delete('/api/algorithm/:algorithm/cache', async (req, res) => {
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
 * POST /api/algorithm/:algorithm/execute
 * Execute algorithm synchronously (returns complete result)
 */
app.post('/api/algorithm/:algorithm/execute', async (req, res) => {
  try {
    const { state, maxIterations = 100, options = {} } = req.body;
    const algorithm = req.params.algorithm || 'latlong';

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    // Get number of districts for state
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.status(400).json({ error: `Invalid state: ${state}` });
    }

    console.log(`🚀 Executing ${algorithm} algorithm for ${state} (${totalDistricts} districts, maxIterations: ${maxIterations})`);

    // Get tract data from census proxy
    // First, get boundaries
    const boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}`;
    const boundariesResponse = await axios.get(boundariesUrl);
    
    if (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0) {
      return res.status(404).json({ error: `No tract boundaries found for state: ${state}` });
    }

    // Get demographic data
    const demographicUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}`;
    const demographicResponse = await axios.get(demographicUrl);
    
    const demographicData = demographicResponse.data || [];
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
      algorithm,
      options.forceInvalidate || false
    );
    const executionTime = Date.now() - startTime;

    console.log(`✅ Algorithm completed in ${executionTime}ms (${result.steps.length} steps)`);

    res.json({
      result,
      executionTime,
      cacheKey: `${state}_${algorithm}_${maxIterations}`,
      state,
      totalDistricts,
      tractCount: tracts.length
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
app.post('/api/algorithm/:algorithm/execute/step-by-step', async (req, res) => {
  try {
    const { state, maxIterations = 100, options = {} } = req.body;
    const algorithm = req.params.algorithm || 'latlong';

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    // Get number of districts for state
    const totalDistricts = getDistrictsForState(state);
    if (!totalDistricts) {
      return res.status(400).json({ error: `Invalid state: ${state}` });
    }

    console.log(`🚀 Executing ${algorithm} algorithm step-by-step for ${state} (${totalDistricts} districts)`);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Get tract data from census proxy
    try {
      const boundariesUrl = `${req.protocol}://${req.get('host')}/api/census/tract-boundaries?state=${state}`;
      const boundariesResponse = await axios.get(boundariesUrl);
      
      if (!boundariesResponse.data || !boundariesResponse.data.features || boundariesResponse.data.features.length === 0) {
        res.write(`data: ${JSON.stringify({ error: `No tract boundaries found for state: ${state}` })}\n\n`);
        res.end();
        return;
      }

      // Get demographic data
      const demographicUrl = `${req.protocol}://${req.get('host')}/api/census/tract-data?state=${state}`;
      const demographicResponse = await axios.get(demographicUrl);
      
      const demographicData = demographicResponse.data || [];
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
        res.write(`data: ${JSON.stringify({ error: `No tracts found for state: ${state}` })}\n\n`);
        res.end();
        return;
      }

      console.log(`📊 Loaded ${tracts.length} tracts for ${state}`);

      // Execute algorithm step-by-step
      const startTime = Date.now();
      const stepGenerator = algorithmService.executeGeodistrictAlgorithmStepByStep(
        tracts,
        totalDistricts,
        maxIterations,
        algorithm,
        null // onStep callback not needed for generator
      );

      // Stream steps
      for await (const stepData of stepGenerator) {
        res.write(`data: ${JSON.stringify(stepData)}\n\n`);
      }

      const executionTime = Date.now() - startTime;
      console.log(`✅ Algorithm completed in ${executionTime}ms`);

      // Send completion message
      res.write(`data: ${JSON.stringify({ complete: true, executionTime })}\n\n`);
      res.end();
    } catch (error) {
      console.error('❌ Algorithm execution error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message, stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('❌ Algorithm setup error:', error);
    res.status(500).json({
      error: 'Algorithm setup failed',
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
