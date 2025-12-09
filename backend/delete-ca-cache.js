#!/usr/bin/env node

/**
 * Script to delete CA step and union polygon caches from Firestore and Cloud Storage
 */

const { Firestore } = require('@google-cloud/firestore');
const cloudStorageCache = require('./services/cloud-storage-cache');
require('dotenv').config();

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
});

const STATE = 'CA';
const MAX_ITERATIONS = 100; // Common maxIterations value

async function deleteCACaches() {
  try {
    console.log(`🗑️ Starting deletion of CA caches...`);
    
    // Initialize Cloud Storage
    await cloudStorageCache.initialize();
    
    let deletedStepCaches = 0;
    let deletedUnionPolygonCaches = 0;
    let deletedCloudStorageObjects = 0;
    
    // 1. Delete all step caches for CA
    console.log(`\n📋 Deleting step caches for ${STATE}...`);
    
    // Query for all step caches for CA
    const stepCacheQuery = firestore.collection('census_cache')
      .where('state', '==', STATE);
    
    const stepCacheSnapshot = await stepCacheQuery.get();
    
    for (const doc of stepCacheSnapshot.docs) {
      const cacheKey = doc.id;
      const data = doc.data();
      
      // Check if this is a step cache
      if (data.source === 'algorithm-step-cache' || data.source === 'step-cache') {
        // Check if it matches CA and maxIterations pattern
        const algorithmStepMatch = cacheKey.match(/algorithm_step_(\w+)_(\d+)_(\d+)/);
        const runAllStepMatch = cacheKey.match(/step_(\w+)_(\d+)_(.+)/);
        
        if (algorithmStepMatch && algorithmStepMatch[1] === STATE) {
          await doc.ref.delete();
          deletedStepCaches++;
          console.log(`   ✅ Deleted step cache: ${cacheKey}`);
        } else if (runAllStepMatch && runAllStepMatch[1] === STATE) {
          await doc.ref.delete();
          deletedStepCaches++;
          console.log(`   ✅ Deleted step cache: ${cacheKey}`);
        }
      }
    }
    
    // Also try direct deletion for common step numbers (0-100)
    for (let stepNum = 0; stepNum <= 100; stepNum++) {
      const stepCacheKey = `algorithm_step_${STATE}_${MAX_ITERATIONS}_${stepNum}`;
      try {
        const doc = await firestore.collection('census_cache').doc(stepCacheKey).get();
        if (doc.exists) {
          await doc.ref.delete();
          deletedStepCaches++;
          console.log(`   ✅ Deleted step cache: ${stepCacheKey}`);
        }
      } catch (error) {
        // Continue if already deleted or doesn't exist
      }
    }
    
    // 2. Delete all union polygon caches for CA
    console.log(`\n📋 Deleting union polygon caches for ${STATE}...`);
    
    // Query for all union polygon cache documents (they have source: 'union-polygon-cache')
    const unionPolygonQuery = firestore.collection('census_cache')
      .where('source', '==', 'union-polygon-cache');
    
    const unionPolygonSnapshot = await unionPolygonQuery.get();
    
    for (const doc of unionPolygonSnapshot.docs) {
      const cacheKey = doc.id;
      const data = doc.data();
      
      // Check if this is a CA union polygon cache
      if (cacheKey.startsWith(`union_polygon_${STATE}_`)) {
        // Delete from Firestore
        await doc.ref.delete();
        deletedUnionPolygonCaches++;
        console.log(`   ✅ Deleted union polygon cache metadata: ${cacheKey}`);
        
        // Delete from Cloud Storage
        try {
          await cloudStorageCache.delete(cacheKey);
          deletedCloudStorageObjects++;
          console.log(`   ✅ Deleted union polygon from Cloud Storage: ${cacheKey}`);
        } catch (cloudError) {
          console.warn(`   ⚠️ Failed to delete from Cloud Storage (may not exist): ${cacheKey} - ${cloudError.message}`);
        }
      }
    }
    
    // Also try direct deletion for common union polygon cache keys
    // Union polygon keys follow pattern: union_polygon_${state}_${step}_${groupKey}
    // For CA Step 0, the group is typically 1-52
    const commonUnionKeys = [
      `union_polygon_${STATE}_0_1-52`,
      // Add more common keys if needed
    ];
    
    for (const unionKey of commonUnionKeys) {
      try {
        const doc = await firestore.collection('census_cache').doc(unionKey).get();
        if (doc.exists) {
          await doc.ref.delete();
          deletedUnionPolygonCaches++;
          console.log(`   ✅ Deleted union polygon cache metadata: ${unionKey}`);
        }
        
        // Try to delete from Cloud Storage
        try {
          await cloudStorageCache.delete(unionKey);
          deletedCloudStorageObjects++;
          console.log(`   ✅ Deleted union polygon from Cloud Storage: ${unionKey}`);
        } catch (cloudError) {
          // May not exist in Cloud Storage
        }
      } catch (error) {
        // Continue if doesn't exist
      }
    }
    
    // Summary
    console.log(`\n✅ Deletion complete!`);
    console.log(`   Step caches deleted: ${deletedStepCaches}`);
    console.log(`   Union polygon cache metadata deleted: ${deletedUnionPolygonCaches}`);
    console.log(`   Cloud Storage objects deleted: ${deletedCloudStorageObjects}`);
    
  } catch (error) {
    console.error(`❌ Error deleting CA caches:`, error);
    process.exit(1);
  }
}

// Run the script
deleteCACaches()
  .then(() => {
    console.log(`\n✅ Script completed successfully`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`❌ Script failed:`, error);
    process.exit(1);
  });

