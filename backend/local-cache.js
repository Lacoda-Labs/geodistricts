const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Local cache configuration
const CACHE_DIR = path.join(__dirname, '..', 'data', 'census-cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = '1.0';

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir() {
  try {
    await fs.access(CACHE_DIR);
  } catch (error) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    console.log(`📁 Created cache directory: ${CACHE_DIR}`);
  }
}

/**
 * Generate cache file path for a given key
 */
function getCacheFilePath(key) {
  // Create a safe filename from the cache key
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safeKey}.json`);
}

/**
 * Generate cache metadata file path
 */
function getCacheMetaPath(key) {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safeKey}.meta.json`);
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
 * Get data from local file cache
 */
async function getFromCache(key) {
  try {
    await ensureCacheDir();
    
    const metaPath = getCacheMetaPath(key);
    const dataPath = getCacheFilePath(key);
    
    console.log(`🔍 LOCAL CACHE: Checking cache for key: ${key}`);
    
    // Check if metadata file exists
    try {
      await fs.access(metaPath);
    } catch (error) {
      console.log(`❌ LOCAL CACHE: No metadata found for key: ${key}`);
      return null;
    }
    
    // Read metadata
    const metaContent = await fs.readFile(metaPath, 'utf8');
    const metadata = JSON.parse(metaContent);
    
    // Check if expired
    if (isCacheExpired(metadata.timestamp, metadata.ttl)) {
      console.log(`⏰ LOCAL CACHE: Cache expired for key: ${key}, deleting`);
      await deleteCacheEntry(key);
      return null;
    }
    
    // Check version
    if (metadata.version !== CACHE_VERSION) {
      console.log(`🔄 LOCAL CACHE: Cache version mismatch for key: ${key}, deleting`);
      await deleteCacheEntry(key);
      return null;
    }
    
    // Read data file
    const dataContent = await fs.readFile(dataPath, 'utf8');
    const data = JSON.parse(dataContent);
    
    console.log(`✅ LOCAL CACHE HIT: Retrieved data for key: ${key}`);
    return data;
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to get from cache for key:', key);
    console.error('❌ LOCAL CACHE ERROR:', error.message);
    return null;
  }
}

/**
 * Store data in local file cache
 */
async function setCache(key, data, ttl = CACHE_TTL) {
  try {
    await ensureCacheDir();
    
    const metaPath = getCacheMetaPath(key);
    const dataPath = getCacheFilePath(key);
    
    console.log(`🔄 LOCAL CACHE: Attempting to cache data for key: ${key}`);
    
    // Create metadata
    const metadata = {
      timestamp: Date.now(),
      ttl: ttl,
      version: CACHE_VERSION,
      source: 'U.S. Census Bureau',
      attribution: 'Data provided by the U.S. Census Bureau (public domain)',
      dataSize: JSON.stringify(data).length
    };
    
    // Write data file
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');
    
    // Write metadata file
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
    
    console.log(`✅ LOCAL CACHE: Successfully cached data for key: ${key}, size: ${metadata.dataSize} bytes`);
    console.log(`📊 LOCAL CACHE: Data file: ${dataPath}`);
    console.log(`📊 LOCAL CACHE: Meta file: ${metaPath}`);
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to cache data for key:', key);
    console.error('❌ LOCAL CACHE ERROR:', error.message);
  }
}

/**
 * Delete a specific cache entry
 */
async function deleteCacheEntry(key) {
  try {
    const metaPath = getCacheMetaPath(key);
    const dataPath = getCacheFilePath(key);
    
    // Delete both files if they exist
    try {
      await fs.unlink(metaPath);
    } catch (error) {
      // File doesn't exist, that's okay
    }
    
    try {
      await fs.unlink(dataPath);
    } catch (error) {
      // File doesn't exist, that's okay
    }
    
    console.log(`🗑️ LOCAL CACHE: Deleted cache entry: ${key}`);
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to delete cache entry:', key);
    console.error('❌ LOCAL CACHE ERROR:', error.message);
  }
}

/**
 * Clear all cache entries
 */
async function clearAllCache() {
  try {
    await ensureCacheDir();
    
    const files = await fs.readdir(CACHE_DIR);
    const deletePromises = files.map(file => {
      const filePath = path.join(CACHE_DIR, file);
      return fs.unlink(filePath);
    });
    
    await Promise.all(deletePromises);
    
    console.log(`🗑️ LOCAL CACHE: Cleared ${files.length} cache files`);
    return files.length;
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to clear cache');
    console.error('❌ LOCAL CACHE ERROR:', error.message);
    return 0;
  }
}

/**
 * Get cache info for all entries
 */
async function getCacheInfo() {
  try {
    await ensureCacheDir();
    
    const files = await fs.readdir(CACHE_DIR);
    const metaFiles = files.filter(file => file.endsWith('.meta.json'));
    const cacheInfo = [];
    
    for (const metaFile of metaFiles) {
      try {
        const metaPath = path.join(CACHE_DIR, metaFile);
        const metaContent = await fs.readFile(metaPath, 'utf8');
        const metadata = JSON.parse(metaContent);
        
        // Extract key from filename
        const key = metaFile.replace('.meta.json', '');
        
        cacheInfo.push({
          key: key,
          timestamp: metadata.timestamp,
          ttl: metadata.ttl,
          version: metadata.version,
          size: metadata.dataSize || 0,
          isExpired: isCacheExpired(metadata.timestamp, metadata.ttl)
        });
      } catch (error) {
        console.warn(`Warning: Could not read metadata for ${metaFile}:`, error.message);
      }
    }
    
    return cacheInfo.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to get cache info');
    console.error('❌ LOCAL CACHE ERROR:', error.message);
    return [];
  }
}

/**
 * Clean up expired cache entries
 */
async function cleanupExpiredCache() {
  try {
    const cacheInfo = await getCacheInfo();
    const expiredEntries = cacheInfo.filter(entry => entry.isExpired);
    
    for (const entry of expiredEntries) {
      await deleteCacheEntry(entry.key);
    }
    
    console.log(`🧹 LOCAL CACHE: Cleaned up ${expiredEntries.length} expired entries`);
    return expiredEntries.length;
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to cleanup expired cache');
    console.error('❌ LOCAL CACHE ERROR:', error.message);
    return 0;
  }
}

/**
 * Get cache directory size
 */
async function getCacheSize() {
  try {
    await ensureCacheDir();
    
    const files = await fs.readdir(CACHE_DIR);
    let totalSize = 0;
    
    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      const stats = await fs.stat(filePath);
      totalSize += stats.size;
    }
    
    return {
      fileCount: files.length,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
  } catch (error) {
    console.error('❌ LOCAL CACHE ERROR: Failed to get cache size');
    return { fileCount: 0, totalSizeBytes: 0, totalSizeMB: '0.00' };
  }
}

module.exports = {
  getFromCache,
  setCache,
  deleteCacheEntry,
  clearAllCache,
  getCacheInfo,
  cleanupExpiredCache,
  getCacheSize,
  CACHE_TTL,
  CACHE_VERSION,
  CACHE_DIR
};
