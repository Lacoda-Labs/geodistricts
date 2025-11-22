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
}

// Export singleton instance
module.exports = new CloudStorageCache();

