const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enable garbage collection for better memory management
if (global.gc) {
  console.log('Garbage collection is available');
} else {
  console.log('Garbage collection is not available - consider running with --expose-gc');
}

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

// Initialize Secret Manager
const secretClient = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts';
const CENSUS_API_KEY_SECRET_NAME = 'census-api-key-v2';

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
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:4200',
    'https://geodistricts.org',
    'https://www.geodistricts.org'
  ],
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
 * Get Census API key from Secret Manager
 */
async function getCensusApiKey() {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${CENSUS_API_KEY_SECRET_NAME}/versions/latest`,
    });
    
    const apiKey = version.payload.data.toString();
    console.log('Successfully retrieved Census API key from Secret Manager');
    console.log('API Key length:', apiKey.length);
    console.log('API Key hex:', Buffer.from(apiKey).toString('hex'));
    console.log('API Key raw:', JSON.stringify(apiKey));
    return apiKey;
  } catch (error) {
    console.error('Error retrieving Census API key from Secret Manager:', error);
    // Fallback to environment variable for local development
    const fallbackKey = process.env.CENSUS_API_KEY;
    if (fallbackKey) {
      console.log('Using fallback Census API key from environment variable');
      return fallbackKey;
    }
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
  return Date.now() - timestamp > ttl;
}

/**
 * Get data from Firestore cache
 */
async function getFromCache(key) {
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
    return data.data;
  } catch (error) {
    console.error('❌ FIRESTORE CACHE ERROR: Failed to get from cache for key:', key);
    console.error('❌ FIRESTORE CACHE ERROR:', error.message);
    console.error('❌ FIRESTORE CACHE ERROR:', error);
    return null;
  }
}

/**
 * Store data in Firestore cache
 */
async function setCache(key, data, ttl = CACHE_TTL) {
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
        pop: feature.properties.POPULATION || 0
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
    version: CACHE_VERSION
  });
});

/**
 * Test Firestore connectivity
 */
app.get('/api/test/firestore', async (req, res) => {
  try {
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
        tests: ['write', 'read', 'delete'],
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Document not found after write');
    }
  } catch (error) {
    console.error('❌ Firestore test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Firestore connectivity test failed',
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
 * Get census tract data
 */
app.get('/api/census/tract-data', async (req, res) => {
  try {
    const { state, county, tract, variables, year, dataset } = req.query;
    
    const params = {
      state: state || undefined,
      county: county || undefined,
      tract: tract || undefined,
      variables: variables ? variables.split(',') : undefined,
      year: year || ACS_YEAR,
      dataset: dataset || ACS_DATASET
    };
    
    const cacheKey = generateCacheKey('tract_data', params);
    
    // Check cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
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
    
    // Add variables
    if (params.variables && params.variables.length > 0) {
      queryParams.set('get', params.variables.join(','));
    } else {
      queryParams.set('get', 'NAME,B01003_001E,B19013_001E,B01002_001E');
    }
    
    // Add geography
    if (params.tract) {
      queryParams.set('for', `tract:${params.tract}`);
      queryParams.set('in', `state:${params.state} county:${params.county}`);
    } else if (params.county) {
      queryParams.set('for', 'tract:*');
      queryParams.set('in', `state:${params.state} county:${params.county}`);
    } else if (params.state) {
      queryParams.set('for', 'tract:*');
      queryParams.set('in', `state:${params.state}`);
    } else {
      queryParams.set('for', 'tract:*');
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
    
    // Cache a simple marker for large datasets to avoid memory issues
    const cacheMarker = {
      type: 'streamed_large_dataset',
      totalCount: totalFeaturesStreamed,
      timestamp: new Date().toISOString(),
      state: state,
      note: 'Large dataset - will be streamed from source on each request'
    };
    
    // Only add county if it's defined (not undefined)
    if (county) {
      cacheMarker.county = county;
    }
    
    await setCache(cacheKey, cacheMarker);
    
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
    
    // Check cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
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
    
    if (key) {
      // Clear specific cache entry
      await firestore.collection('census_cache').doc(key).delete();
      res.json({ message: `Cache entry ${key} cleared` });
    } else {
      // Clear all cache entries
      const snapshot = await firestore.collection('census_cache').get();
      const batch = firestore.batch();
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      res.json({ message: 'All cache entries cleared' });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ 
      error: 'Failed to clear cache',
      message: error.message 
    });
  }
});

/**
 * Get cache info endpoint
 */
app.get('/api/census/cache-info', async (req, res) => {
  try {
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
    
    res.json(cacheInfo.sort((a, b) => b.timestamp - a.timestamp));
  } catch (error) {
    console.error('Error getting cache info:', error);
    // Return empty array instead of 500 error to prevent service crashes
    res.json([]);
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
