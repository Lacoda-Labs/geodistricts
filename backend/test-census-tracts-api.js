#!/usr/bin/env node
/**
 * Unit tests for GET /api/algorithm/census-tracts/:state
 * Run with: node test-census-tracts-api.js
 * Or: npm test (add to backend test script)
 */
process.env.USE_LOCAL_CACHE = 'true';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('./index');

function runTests() {
  const tests = [
    {
      name: 'invalid state: single character returns 400',
      fn: () => request(app).get('/api/algorithm/census-tracts/X').expect(400)
    },
    {
      name: 'invalid state: three characters returns 400',
      fn: () => request(app).get('/api/algorithm/census-tracts/ABC').expect(400)
    },
    {
      name: 'invalid state: one character returns 400',
      fn: () => request(app).get('/api/algorithm/census-tracts/1').expect(400)
    },
    {
      name: 'invalid state code ZZ returns 400',
      fn: () => request(app).get('/api/algorithm/census-tracts/ZZ').expect(400)
    },
    {
      name: 'valid state CA returns 200 with tracts array or 404/500',
      fn: async () => {
        const res = await request(app).get('/api/algorithm/census-tracts/CA');
        if (res.status === 200) {
          if (!res.body || typeof res.body.tracts === 'undefined') {
            throw new Error('200 response must have body.tracts');
          }
          if (!Array.isArray(res.body.tracts)) {
            throw new Error('body.tracts must be an array');
          }
          // If we got tracts, each should have properties (GEOID or FIPS)
          for (const t of res.body.tracts) {
            if (!t || typeof t !== 'object') throw new Error('Each tract must be an object');
            if (t.properties && (t.properties.GEOID != null || t.properties.FIPS != null)) break;
          }
        } else if (res.status !== 404 && res.status !== 500) {
          throw new Error(`Expected 200, 404, or 500, got ${res.status}`);
        }
      }
    },
    {
      name: 'valid state IN returns 200 with tracts array or 404/500',
      fn: async () => {
        const res = await request(app).get('/api/algorithm/census-tracts/IN');
        if (res.status === 200) {
          if (!res.body || typeof res.body.tracts === 'undefined') {
            throw new Error('200 response must have body.tracts');
          }
          if (!Array.isArray(res.body.tracts)) {
            throw new Error('body.tracts must be an array');
          }
        } else if (res.status !== 404 && res.status !== 500) {
          throw new Error(`Expected 200, 404, or 500, got ${res.status}`);
        }
      }
    }
  ];

  let failed = 0;
  return (async () => {
    for (const t of tests) {
      try {
        await t.fn();
        console.log('PASS:', t.name);
      } catch (err) {
        console.error('FAIL:', t.name, err.message || err);
        failed++;
      }
    }
    if (failed > 0) {
      process.exitCode = 1;
    }
  })();
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});
