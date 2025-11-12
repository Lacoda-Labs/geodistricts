const axios = require('axios');

const BASE_URL = 'http://localhost:8080';

// Test data for latlong division result
const testCacheKey = 'test_latlong_division_' + Date.now();
const testDivisionResult = {
  groups: [
    {
      startDistrictNumber: 1,
      endDistrictNumber: 2,
      censusTracts: [],
      totalDistricts: 2,
      totalPopulation: 100000,
      bounds: { north: 40, south: 30, east: -100, west: -110 },
      centroid: { lat: 35, lng: -105 }
    }
  ],
  history: ['Test division completed'],
  dividingLine: 35.5,
  intersectingTractIds: ['test-tract-1']
};

async function testLatlongCaching() {
  try {
    console.log('🧪 Testing LatLong Division Caching...');

    // Test 1: Store division result in cache
    console.log('📝 Test 1: Storing division result...');
    const storeResponse = await axios.post(`${BASE_URL}/api/algorithm/latlong/cache`, {
      cacheKey: testCacheKey,
      divisionResult: testDivisionResult,
      ttl: 3600000 // 1 hour
    });

    console.log('✅ Store response:', storeResponse.data);

    // Test 2: Retrieve division result from cache
    console.log('📖 Test 2: Retrieving division result...');
    const retrieveResponse = await axios.get(`${BASE_URL}/api/algorithm/latlong/cache/${testCacheKey}`);

    console.log('✅ Retrieve response:', retrieveResponse.data);

    // Test 3: Verify cache hit
    if (retrieveResponse.data.cached && retrieveResponse.data.data) {
      console.log('✅ Cache hit confirmed!');

      // Verify data integrity
      const cachedData = retrieveResponse.data.data;
      if (cachedData.dividingLine === testDivisionResult.dividingLine) {
        console.log('✅ Data integrity verified!');
      } else {
        console.log('❌ Data integrity check failed!');
      }
    } else {
      console.log('❌ Cache miss - this should have been a hit!');
    }

    // Test 4: Test cache miss with non-existent key
    console.log('📖 Test 3: Testing cache miss...');
    try {
      const missResponse = await axios.get(`${BASE_URL}/api/algorithm/latlong/cache/non_existent_key`);
      console.log('✅ Miss response:', missResponse.data);
    } catch (error) {
      console.log('❌ Unexpected error on cache miss:', error.message);
    }

    console.log('🎉 All LatLong caching tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testLatlongCaching();
}

module.exports = { testLatlongCaching };
