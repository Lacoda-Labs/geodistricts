# 260212

## 2045 batch step0 polygons one call, 5s staggered reveal, push

### Prompt

User asked to: (1) Change implementation so all states fetch polygons for all 51 step0 district groups (state boundary polygons) in one call instead of separate calls, and display in the same order over 5 seconds; (2) implement the plan (backend batch endpoint, frontend service and maps page); (3) run /push to git add, commit, and push for geodistricts and gdip.

### Response / actions

- **Plan (read-only)**: Single backend endpoint returns step0 for all 51 states; frontend one batch call; reveal over 5s in same order (CA, TX, FL, …). Plan created and then implemented.
- **Backend** ([backend/index.js](backend/index.js)): Added `GET /api/algorithm/map-polygons-all`. Optional query `?states=CA,TX,...`; if omitted uses default order (descending district count from `CONGRESSIONAL_DISTRICTS_BY_STATE`). `Promise.all(getOrCreateStateBoundaryInCloudStorage(state))` for each state; response `{ statePolygons: [ { stateCode, statePolygon }, ... ] }` in same order.
- **Frontend service** ([frontend/src/app/services/geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)): Added `MapPolygonsAllResponse` and `getMapPolygonsAll(stateCodes)` calling the new endpoint.
- **Maps page** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): `loadUSMapDistricts()` now calls `getMapPolygonsAll(orderedStateCodes)` once, builds `usMapStepDataByState` from response, then uses `timer(0, 5000/51).pipe(take(51))` to reveal states in order over 5s; cache updated when reveal completes.
- **Push**: Committed (3 files) with message "Batch step0 polygons: one API call for all 51 states, 5s staggered reveal"; pushed geodistricts to origin. gdip repo had nothing to commit; reported clean.

✅ **IMPLEMENTED**: Batch step0 polygons endpoint and frontend single-call + 5s staggered reveal. ✅ **DONE**: Git commit and push for geodistricts; gdip already up to date.
