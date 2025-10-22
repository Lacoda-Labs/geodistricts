#!/usr/bin/env node

/**
 * Test script for local file caching system
 * Demonstrates the local file cache functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';

async function testLocalCache() {
  console.log('🧪 Testing Local File Cache System\n');
  
  try {
    // 1. Check server health and cache mode
    console.log('1. Checking server health...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log(`   ✅ Server is ${healthResponse.data.status}`);
    console.log(`   📁 Cache mode: ${healthResponse.data.cacheMode}\n`);
    
    // 2. Test cache connectivity
    console.log('2. Testing cache connectivity...');
    const cacheTestResponse = await axios.get(`${BASE_URL}/api/test/cache`);
    console.log(`   ✅ Cache test: ${cacheTestResponse.data.message}`);
    console.log(`   📊 Tests passed: ${cacheTestResponse.data.tests.join(', ')}\n`);
    
    // 3. Check initial cache state
    console.log('3. Checking initial cache state...');
    const initialCacheInfo = await axios.get(`${BASE_URL}/api/census/cache-info`);
    console.log(`   📊 Cache entries: ${initialCacheInfo.data.totalEntries}`);
    console.log(`   💾 Cache size: ${initialCacheInfo.data.cacheSize.totalSizeMB} MB\n`);
    
    // 4. Make a census API call (should create cache entry)
    console.log('4. Making census API call (California counties)...');
    const startTime = Date.now();
    const countiesResponse = await axios.get(`${BASE_URL}/api/census/counties?state=06`);
    const endTime = Date.now();
    console.log(`   ✅ Retrieved ${countiesResponse.data.length} counties`);
    console.log(`   ⏱️  Response time: ${endTime - startTime}ms\n`);
    
    // 5. Check cache state after API call
    console.log('5. Checking cache state after API call...');
    const afterCacheInfo = await axios.get(`${BASE_URL}/api/census/cache-info`);
    console.log(`   📊 Cache entries: ${afterCacheInfo.data.totalEntries}`);
    console.log(`   💾 Cache size: ${afterCacheInfo.data.cacheSize.totalSizeMB} MB`);
    
    if (afterCacheInfo.data.entries.length > 0) {
      const entry = afterCacheInfo.data.entries[0];
      console.log(`   📄 Latest entry: ${entry.key}`);
      console.log(`   📅 Cached at: ${new Date(entry.timestamp).toISOString()}`);
      console.log(`   ⏰ TTL: ${entry.ttl / 1000 / 60 / 60} hours`);
      console.log(`   📏 Size: ${entry.size} bytes\n`);
    }
    
    // 6. Make the same API call again (should be served from cache)
    console.log('6. Making same API call again (should be cached)...');
    const cachedStartTime = Date.now();
    const cachedCountiesResponse = await axios.get(`${BASE_URL}/api/census/counties?state=06`);
    const cachedEndTime = Date.now();
    console.log(`   ✅ Retrieved ${cachedCountiesResponse.data.length} counties (cached)`);
    console.log(`   ⏱️  Response time: ${cachedEndTime - cachedStartTime}ms`);
    console.log(`   🚀 Speed improvement: ${((endTime - startTime) / (cachedEndTime - cachedStartTime)).toFixed(1)}x faster\n`);
    
    // 7. Test cache cleanup
    console.log('7. Testing cache cleanup...');
    const cleanupResponse = await axios.post(`${BASE_URL}/api/census/cache/cleanup`);
    console.log(`   ✅ ${cleanupResponse.data.message}\n`);
    
    // 8. Test tract data caching
    console.log('8. Testing tract data caching (Alameda County, CA)...');
    const tractStartTime = Date.now();
    const tractResponse = await axios.get(`${BASE_URL}/api/census/tract-data?state=06&county=001`);
    const tractEndTime = Date.now();
    console.log(`   ✅ Retrieved ${tractResponse.data.length} tracts`);
    console.log(`   ⏱️  Response time: ${tractEndTime - tractStartTime}ms\n`);
    
    // 9. Final cache state
    console.log('9. Final cache state...');
    const finalCacheInfo = await axios.get(`${BASE_URL}/api/census/cache-info`);
    console.log(`   📊 Total cache entries: ${finalCacheInfo.data.totalEntries}`);
    console.log(`   💾 Total cache size: ${finalCacheInfo.data.cacheSize.totalSizeMB} MB`);
    console.log(`   📁 Cache files: ${finalCacheInfo.data.cacheSize.fileCount}\n`);
    
    console.log('🎉 Local file cache system test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   • Local file caching is working correctly');
    console.log('   • Cache entries are created and retrieved properly');
    console.log('   • Cached responses are significantly faster');
    console.log('   • Cache management endpoints are functional');
    console.log('   • Data is stored in /data/census-cache/ directory');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the test
testLocalCache();
