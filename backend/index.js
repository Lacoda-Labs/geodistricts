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

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

// Initialize Secret Manager
const secretClient = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts';
const CENSUS_API_KEY_SECRET_NAME = 'census-api-key';

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
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  const paramString = JSON.stringify(params);
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
    const doc = await firestore.collection('census_cache').doc(key).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data();
    
    // Check if expired
    if (isCacheExpired(data.timestamp, data.ttl)) {
      await firestore.collection('census_cache').doc(key).delete();
      return null;
    }
    
    // Check version
    if (data.version !== CACHE_VERSION) {
      await firestore.collection('census_cache').doc(key).delete();
      return null;
    }
    
    console.log(`Cache hit for key: ${key}`);
    return data.data;
  } catch (error) {
    console.error('Error getting from cache:', error);
    return null;
  }
}

/**
 * Store data in Firestore cache
 */
async function setCache(key, data, ttl = CACHE_TTL) {
  try {
    const cacheEntry = {
      data: data,
      timestamp: Date.now(),
      ttl: ttl,
      version: CACHE_VERSION,
      source: 'U.S. Census Bureau',
      attribution: 'Data provided by the U.S. Census Bureau (public domain)'
    };
    
    await firestore.collection('census_cache').doc(key).set(cacheEntry);
    console.log(`Cached data for key: ${key}, size: ${JSON.stringify(data).length} bytes`);
  } catch (error) {
    console.error('Error setting cache:', error);
  }
}

/**
 * Compress GeoJSON data to reduce size
 */
function compressGeoJson(geojson) {
  if (!geojson || !geojson.features) {
    return geojson;
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
  
  const headers = response[0];
  const dataRows = response.slice(1);
  
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
 * Get tract boundaries from TIGERweb
 */
app.get('/api/census/tract-boundaries', async (req, res) => {
  try {
    const { state, county } = req.query;
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }
    
    const params = { state, county: county || undefined };
    const cacheKey = generateCacheKey('tract_boundaries', params);
    
    // Check cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }
    
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
    let whereClause = `STATE_FIPS='${state}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }
    
    // First, get the total count
    const countParams = new URLSearchParams({
      where: whereClause,
      outFields: 'STATE_FIPS',
      f: 'geojson',
      returnCountOnly: 'true'
    });
    
    console.log(`Getting tract count for state: ${state}`);
    const countResponse = await axios.get(`${serviceUrl}?${countParams.toString()}`);
    const totalCount = countResponse.data.properties?.count || 0;
    
    if (totalCount === 0) {
      const emptyResponse = { type: 'FeatureCollection', features: [] };
      await setCache(cacheKey, emptyResponse);
      return res.json(emptyResponse);
    }
    
    let allFeatures = [];
    
    if (totalCount > 2000) {
      // Use pagination for large datasets
      const batchSize = 2000;
      const totalBatches = Math.ceil(totalCount / batchSize);
      
      console.log(`Fetching ${totalCount} tracts in ${totalBatches} batches`);
      
      const batchPromises = [];
      for (let i = 0; i < totalBatches; i++) {
        const offset = i * batchSize;
        const batchParams = new URLSearchParams({
          where: whereClause,
          outFields: 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,STATE_ABBR,POPULATION,SQMI',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: batchSize.toString(),
          resultOffset: offset.toString()
        });
        
        batchPromises.push(
          axios.get(`${serviceUrl}?${batchParams.toString()}`)
            .then(response => response.data.features || [])
        );
      }
      
      const batchResults = await Promise.all(batchPromises);
      allFeatures = batchResults.flat();
    } else {
      // Single request for smaller datasets
      const params = new URLSearchParams({
        where: whereClause,
        outFields: 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,STATE_ABBR,POPULATION,SQMI',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: '2000'
      });
      
      const response = await axios.get(`${serviceUrl}?${params.toString()}`);
      allFeatures = response.data.features || [];
    }
    
    const geojsonResponse = {
      type: 'FeatureCollection',
      features: allFeatures
    };
    
    // Compress and cache the result
    const compressedData = compressGeoJson(geojsonResponse);
    await setCache(cacheKey, compressedData);
    
    console.log(`Fetched ${allFeatures.length} tract boundaries for state ${state}`);
    res.json(compressedData);
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
      await firestore.collection('census_cache').doc(key).delete();
      res.json({ message: `Cache entry ${key} cleared` });
    } else {
      // Clear all census cache entries
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
    res.status(500).json({ 
      error: 'Failed to get cache info',
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
