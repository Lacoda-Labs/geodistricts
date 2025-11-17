/**
 * Migration script to move large files from Firestore to Cloud Storage
 * This script:
 * 1. Scans Firestore for large documents (> 1MB)
 * 2. Migrates them to Cloud Storage
 * 3. Updates Firestore references to point to Cloud Storage
 */

const { Firestore } = require('@google-cloud/firestore');
const cloudStorageCache = require('../services/cloud-storage-cache');
require('dotenv').config();

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

const FIRESTORE_MAX_SIZE = 1024 * 1024; // 1MB

async function migrateLargeFiles() {
  console.log('🚀 Starting migration to Cloud Storage...');
  
  try {
    // Initialize Cloud Storage
    await cloudStorageCache.initialize();
    
    // Get all documents from census_cache collection
    const snapshot = await firestore.collection('census_cache').get();
    console.log(`📊 Found ${snapshot.size} documents to check`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const docId = doc.id;
      
      // Skip if already migrated to Cloud Storage
      if (data.cloudStoragePath) {
        console.log(`⏭️  Skipping ${docId} - already in Cloud Storage`);
        skippedCount++;
        continue;
      }
      
      // Skip metadata documents (they don't have data field)
      if (!data.data) {
        console.log(`⏭️  Skipping ${docId} - no data field (metadata document)`);
        skippedCount++;
        continue;
      }
      
      // Calculate size
      const dataSize = JSON.stringify(data.data).length;
      
      // Only migrate large files (> 1MB)
      if (dataSize <= FIRESTORE_MAX_SIZE) {
        console.log(`⏭️  Skipping ${docId} - size ${(dataSize / 1024).toFixed(2)} KB (below threshold)`);
        skippedCount++;
        continue;
      }
      
      console.log(`📦 Migrating ${docId} (${(dataSize / (1024 * 1024)).toFixed(2)} MB)...`);
      
      try {
        // Store in Cloud Storage
        const cloudStoragePath = await cloudStorageCache.set(docId, data.data, {
          migrated: 'true',
          originalTimestamp: data.timestamp?.toString() || Date.now().toString(),
          source: data.source || 'migration'
        });
        
        // Update Firestore document with Cloud Storage reference
        await firestore.collection('census_cache').doc(docId).update({
          cloudStoragePath: cloudStoragePath,
          data: null, // Remove data from Firestore (keep metadata)
          storedIn: 'cloud-storage',
          migratedAt: Date.now(),
          originalSize: dataSize,
          originalSizeMB: parseFloat((dataSize / (1024 * 1024)).toFixed(2))
        });
        
        console.log(`✅ Migrated ${docId} to ${cloudStoragePath}`);
        migratedCount++;
      } catch (error) {
        console.error(`❌ Failed to migrate ${docId}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migratedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📦 Total: ${snapshot.size}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  migrateLargeFiles()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Migration error:', error);
      process.exit(1);
    });
}

module.exports = { migrateLargeFiles };

