# 260301

## 1830 backend unit test for GET census-tracts

### Prompt

create a unit test for Backend – GET /api/algorithm/census-tracts/:state

### Response / actions

✅ **IMPLEMENTED**: Backend unit test for GET /api/algorithm/census-tracts/:state.

- Added **supertest** (^7.0.0) to `backend/package.json` devDependencies.
- Created **backend/test-census-tracts-api.js**: sets `USE_LOCAL_CACHE=true` and `NODE_ENV=test`, requires exported `app` from `index.js`, uses supertest to hit the route. Tests: invalid state returns 400 (single char, three chars, one char, invalid code ZZ); valid state CA and IN return 200 with `body.tracts` array (or 404/500 when no cache/network). Async test runner waits for all cases and sets process.exitCode on failure.
- Updated **backend/package.json** test script to run the new test: `npm run test:isolation && npm run test:vest && node test-census-tracts-api.js`.

All six tests pass. Run with `cd backend && node test-census-tracts-api.js` or `npm test`.
