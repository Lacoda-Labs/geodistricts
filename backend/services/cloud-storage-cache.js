/**
 * Cloud Storage Cache Service
 * Handles large file storage (> 1MB) in Google Cloud Storage
 * Used for: tract boundaries, state tract cache, and other large static data
 */

const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Initialize Cloud Storage
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

// Bucket name for census data
const BUCKET_NAME = process.env.CENSUS_DATA_BUCKET || 'geodistricts-census-data';
const CACHE_VERSION = '1.0';

// Size threshold for using Cloud Storage (1MB)
const CLOUD_STORAGE_THRESHOLD = 1024 * 1024; // 1MB

class CloudStorageCache {
  constructor() {
    this.bucket = null;
    this.initialized = false;
  }

  /**
   * Initialize bucket (create if doesn't exist)
   */
  async initialize() {
    if (this.initialized) return;

    try {
      this.bucket = storage.bucket(BUCKET_NAME);
      const [exists] = await this.bucket.exists();
      
      if (!exists) {
        console.log(`📦 Creating Cloud Storage bucket: ${BUCKET_NAME}`);
        await storage.createBucket(BUCKET_NAME, {
          location: 'US',
          storageClass: 'STANDARD',
          versioning: {
            enabled: false
          }
        });
        console.log(`✅ Created bucket: ${BUCKET_NAME}`);
      } else {
        console.log(`✅ Using existing bucket: ${BUCKET_NAME}`);
      }
      
      this.initialized = true;
    } catch (error) {
      console.error(`❌ Failed to initialize Cloud Storage bucket:`, error.message);
      throw error;
    }
  }

  /**
   * Get file path for a cache key
   */
  getFilePath(cacheKey, type = 'data') {
    // Organize by type: boundaries, demographics, state-tracts, voter-registration, etc.
    if (cacheKey.startsWith('census_tract_boundaries_')) {
      const state = this.extractStateFromKey(cacheKey);
      return `boundaries/${state || 'unknown'}.json`;
    } else if (cacheKey.startsWith('state_tracts_')) {
      // Extract state code: state_tracts_{stateCode} -> {stateCode}
      // Take only the first 2 characters after the prefix to ensure we get just the state code
      const statePart = cacheKey.replace('state_tracts_', '').toUpperCase();
      // Extract just the state code (first 2 uppercase letters)
      const stateMatch = statePart.match(/^([A-Z]{2})/);
      const state = stateMatch ? stateMatch[1] : statePart.substring(0, 2);
      if (!state || state.length !== 2) {
        console.error(`❌ Invalid state code extracted from cache key: ${cacheKey}, got: ${state}`);
        return `state-tracts/unknown.json`;
      }
      console.log(`📁 CLOUD STORAGE: File path for key ${cacheKey} -> state-tracts/${state}.json`);
      return `state-tracts/${state}.json`;
    } else if (cacheKey.startsWith('census_tract_data_')) {
      // Keep county-level data organized
      return `demographics/${cacheKey}.json`;
    } else if (cacheKey.startsWith('voter_registration_')) {
      const state = cacheKey.replace('voter_registration_', '').toUpperCase();
      return `voter-registration/${state}.json`;
    } else if (cacheKey.startsWith('union_polygon_')) {
      // Extract state and step from key: union_polygon_{state}_{step}_{group}
      const parts = cacheKey.replace('union_polygon_', '').split('_');
      const state = parts[0]?.toUpperCase() || 'unknown';
      const step = parts[1] || 'unknown';
      return `union-polygons/${state}/step-${step}/${cacheKey}.json`;
    } else if (cacheKey.startsWith('congressional_boundaries_')) {
      // congressional_boundaries_{congress}_{stateName} -> congressional-boundaries/{congress}/{stateName}.json
      const rest = cacheKey.replace('congressional_boundaries_', '');
      const firstUnderscore = rest.indexOf('_');
      if (firstUnderscore === -1) return `congressional-boundaries/${rest}.json`;
      const congress = rest.substring(0, firstUnderscore);
      const stateName = rest.substring(firstUnderscore + 1);
      return `congressional-boundaries/${congress}/${stateName}.json`;
    } else if (cacheKey.startsWith('district_party_')) {
      // district_party_{state}_{step}_{maxIterations}_{vestYear} -> district-party/{state}/{step}_{maxIterations}_{vestYear}.json
      const rest = cacheKey.replace('district_party_', '');
      const parts = rest.split('_');
      const state = (parts[0] || 'unknown').toUpperCase();
      const step = parts[1] || 'unknown';
      const maxIterations = parts[2] || 'unknown';
      const vestYear = parts[3] || 'unknown';
      return `district-party/${state}/${step}_${maxIterations}_${vestYear}.json`;
    } else if (cacheKey.startsWith('tract_party_')) {
      // tract_party_{state}_{year} -> tract-party/{state}/{year}.json
      const rest = cacheKey.replace('tract_party_', '');
      const parts = rest.split('_');
      const state = (parts[0] || 'unknown').toUpperCase();
      const year = parts[1] || 'unknown';
      return `tract-party/${state}/${year}.json`;
    } else {
      // Default: store in root with key as filename
      return `${type}/${cacheKey}.json`;
    }
  }

  /**
   * Extract state code from cache key if possible
   */
  extractStateFromKey(cacheKey) {
    // Try to extract state from various key formats
    const stateMatch = cacheKey.match(/_([A-Z]{2})_/);
    return stateMatch ? stateMatch[1] : null;
  }

  /**
   * Store data in Cloud Storage
   * @param {string} cacheKey - Cache key
   * @param {any} data - Data to store
   * @param {object} metadata - Optional metadata
   * @returns {Promise<string>} Cloud Storage file path
   */
  async set(cacheKey, data, metadata = {}) {
    await this.initialize();

    const filePath = this.getFilePath(cacheKey);
    
    // Validate state code consistency for state_tracts keys
    if (cacheKey.startsWith('state_tracts_')) {
      const extractedState = cacheKey.replace('state_tracts_', '').toUpperCase().substring(0, 2);
      const metadataState = metadata.state ? metadata.state.toUpperCase() : null;
      
      if (metadataState && extractedState !== metadataState) {
        console.error(`❌ STATE CODE MISMATCH: Cache key state (${extractedState}) != metadata state (${metadataState}) for key: ${cacheKey}`);
        throw new Error(`State code mismatch: cache key has ${extractedState} but metadata has ${metadataState}`);
      }
      
      // Ensure metadata has the correct state code
      if (!metadataState) {
        metadata.state = extractedState;
        console.log(`📝 Added missing state code to metadata: ${extractedState} for key: ${cacheKey}`);
      }
      
      console.log(`💾 CLOUD STORAGE: Storing state tract cache for state: ${extractedState}, key: ${cacheKey}, path: ${filePath}`);
    }
    
    const file = this.bucket.file(filePath);

    // Convert data to JSON string
    const jsonData = JSON.stringify(data);
    const dataSize = Buffer.byteLength(jsonData, 'utf8');

    // Upload to Cloud Storage
    await file.save(jsonData, {
      metadata: {
        contentType: 'application/json',
        cacheControl: 'public, max-age=31536000', // 1 year cache
        metadata: {
          cacheKey,
          cacheVersion: CACHE_VERSION,
          timestamp: Date.now().toString(),
          ...metadata
        }
      }
    });

    console.log(`💾 Cloud Storage: Stored ${(dataSize / (1024 * 1024)).toFixed(2)} MB at gs://${BUCKET_NAME}/${filePath}`);

    return `gs://${BUCKET_NAME}/${filePath}`;
  }

  /**
   * Get data from Cloud Storage
   * @param {string} cacheKey - Cache key
   * @returns {Promise<{data: any, metadata: object} | null>}
   */
  async get(cacheKey) {
    await this.initialize();

    const filePath = this.getFilePath(cacheKey);
    
    // Log state code for state_tracts keys
    if (cacheKey.startsWith('state_tracts_')) {
      const extractedState = cacheKey.replace('state_tracts_', '').toUpperCase().substring(0, 2);
      console.log(`📥 CLOUD STORAGE: Retrieving state tract cache for state: ${extractedState}, key: ${cacheKey}, path: ${filePath}`);
    }
    
    const file = this.bucket.file(filePath);

    try {
      const [exists] = await file.exists();
      if (!exists) {
        console.log(`❌ CLOUD STORAGE: File not found at ${filePath} for key: ${cacheKey}`);
        return null;
      }

      // Download file
      const [contents] = await file.download();
      const data = JSON.parse(contents.toString('utf8'));

      // Get metadata
      const [metadata] = await file.getMetadata();
      const fileMetadata = metadata.metadata || {};
      
      // Validate state code for state_tracts keys
      if (cacheKey.startsWith('state_tracts_')) {
        const extractedState = cacheKey.replace('state_tracts_', '').toUpperCase().substring(0, 2);
        const metadataState = fileMetadata.state ? fileMetadata.state.toUpperCase() : null;
        
        if (metadataState && extractedState !== metadataState) {
          console.error(`❌ STATE CODE MISMATCH ON RETRIEVAL: Cache key state (${extractedState}) != file metadata state (${metadataState}) for key: ${cacheKey}`);
          throw new Error(`State code mismatch: expected ${extractedState} but file has ${metadataState}`);
        }
        
        console.log(`✅ CLOUD STORAGE: Retrieved ${(contents.length / (1024 * 1024)).toFixed(2)} MB from gs://${BUCKET_NAME}/${filePath} for state: ${extractedState}`);
      } else {
        console.log(`✅ Cloud Storage: Retrieved ${(contents.length / (1024 * 1024)).toFixed(2)} MB from gs://${BUCKET_NAME}/${filePath}`);
      }

      return {
        data,
        metadata: fileMetadata,
        timestamp: parseInt(fileMetadata.timestamp || Date.now().toString()),
        size: contents.length
      };
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      console.error(`❌ Cloud Storage: Error retrieving ${cacheKey}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if file exists in Cloud Storage
   * @param {string} cacheKey - Cache key
   * @returns {Promise<boolean>}
   */
  async exists(cacheKey) {
    await this.initialize();

    const filePath = this.getFilePath(cacheKey);
    const file = this.bucket.file(filePath);

    try {
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete file from Cloud Storage
   * @param {string} cacheKey - Cache key
   * @returns {Promise<void>}
   */
  async delete(cacheKey) {
    await this.initialize();

    const filePath = this.getFilePath(cacheKey);
    const file = this.bucket.file(filePath);

    try {
      await file.delete();
      console.log(`🗑️ Cloud Storage: Deleted gs://${BUCKET_NAME}/${filePath}`);
    } catch (error) {
      if (error.code === 404) {
        // File doesn't exist, that's OK
        return;
      }
      throw error;
    }
  }

  /**
   * Get public URL for a file (if bucket is public)
   * @param {string} cacheKey - Cache key
   * @returns {Promise<string>}
   */
  async getPublicUrl(cacheKey) {
    await this.initialize();

    const filePath = this.getFilePath(cacheKey);
    const file = this.bucket.file(filePath);

    // Generate signed URL (valid for 1 hour)
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    return url;
  }

  /**
   * Check if data should be stored in Cloud Storage based on size
   * @param {any} data - Data to check
   * @returns {boolean}
   */
  shouldUseCloudStorage(data) {
    const size = JSON.stringify(data).length;
    return size > CLOUD_STORAGE_THRESHOLD;
  }

  /**
   * List union polygon cache keys for a state (from Cloud Storage paths).
   * @param {string} state - State code (e.g. 'CA')
   * @param {number} fromStep - Only include keys for step >= fromStep (default 0).
   * @returns {Promise<string[]>} Cache keys (e.g. ['union_polygon_CA_0_1-52', ...])
   */
  async listUnionPolygonKeysForState(state, fromStep = 0) {
    await this.initialize();
    const stateUpper = (state || '').toUpperCase();
    if (!stateUpper || stateUpper.length < 2) return [];
    const prefix = `union-polygons/${stateUpper}/`;
    const [files] = await this.bucket.getFiles({ prefix });
    const keys = [];
    for (const file of files) {
      const name = file.name;
      const stepMatch = name.match(/step-(\d+)\//);
      const stepNum = stepMatch ? parseInt(stepMatch[1], 10) : -1;
      if (stepNum < fromStep) continue;
      const cacheKeyMatch = name.match(/\/([^/]+)\.json$/);
      if (cacheKeyMatch) keys.push(cacheKeyMatch[1]);
    }
    return keys;
  }

  /**
   * List and delete union polygon files for a state.
   * @param {string} state - State code (e.g. 'CA')
   * @param {number} fromStep - Only delete files for step >= fromStep (default 0). Use 1 for restart (keep step 0).
   * @returns {Promise<{ deleted: number, keys: string[] }>} Count and keys deleted
   */
  async deleteUnionPolygonsForState(state, fromStep = 0) {
    await this.initialize();
    const stateUpper = (state || '').toUpperCase();
    if (!stateUpper || stateUpper.length < 2) {
      return { deleted: 0, keys: [] };
    }
    const prefix = `union-polygons/${stateUpper}/`;
    const [files] = await this.bucket.getFiles({ prefix });
    const keys = [];
    for (const file of files) {
      const name = file.name;
      const stepMatch = name.match(/step-(\d+)\//);
      const stepNum = stepMatch ? parseInt(stepMatch[1], 10) : -1;
      if (stepNum < fromStep) continue;
      const cacheKeyMatch = name.match(/\/([^/]+)\.json$/);
      const cacheKey = cacheKeyMatch ? cacheKeyMatch[1] : null;
      if (cacheKey) {
        try {
          await file.delete();
          keys.push(cacheKey);
        } catch (err) {
          if (err.code !== 404) console.warn(`⚠️ Failed to delete ${name}: ${err.message}`);
        }
      }
    }
    if (keys.length > 0) {
      console.log(`🗑️ Cloud Storage: Deleted ${keys.length} union polygon file(s) for ${stateUpper} (step >= ${fromStep})`);
    }
    return { deleted: keys.length, keys };
  }

  /**
   * List state names that have congressional boundary data for a given Congress.
   * @param {number|string} congress - Congress number (e.g. 119)
   * @returns {Promise<string[]>} - State names (as stored, e.g. "Alabama", "New_York")
   */
  async listCongressionalBoundaryStates(congress) {
    await this.initialize();
    const prefix = `congressional-boundaries/${congress}/`;
    const [files] = await this.bucket.getFiles({ prefix });
    const stateNames = files
      .map(f => f.name.replace(prefix, '').replace(/\.json$/i, ''))
      .filter(Boolean);
    return stateNames;
  }

  /**
   * Get congressional boundary GeoJSON by congress and state name (cache key format).
   * @param {number|string} congress
   * @param {string} stateName - As stored (e.g. "Alabama", "New_York")
   * @returns {Promise<{data: any} | null>}
   */
  async getCongressionalBoundary(congress, stateName) {
    const cacheKey = `congressional_boundaries_${congress}_${stateName}`;
    const result = await this.get(cacheKey);
    return result ? { data: result.data } : null;
  }
}

// Export singleton instance
module.exports = new CloudStorageCache();

