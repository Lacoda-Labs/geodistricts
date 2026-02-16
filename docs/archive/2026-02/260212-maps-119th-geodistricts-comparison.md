# 260212

## 1830 maps 119th and GeoDistricts comparison

### Prompt

User asked to implement the plan for Maps Page 119th Congress and GeoDistricts party comparison: update maps state list with real 119th Congress party affiliation (435 districts), use VEST data to calculate/map GeoDistricts (tract lists + PoliGeo), compute differences and swing, persist data for fast presentation on the maps page (app-state-row). Plan was attached; todos were already created. Implement fully and mark todos complete.

### Response / actions

✅ **IMPLEMENTED**:

- **119th party**: Added `data/congress-119-party.json` (per-state D/R counts, 435 seats). Backend `congress-119-party.js` with `getPartySummary()` and `getUsHouseByState(state)`. `GET /api/congress/119/party-summary`. Wired `representation-comparison.loadDistrictRepresentation()` to use 119th data for `usHouse`.
- **GeoDistricts VEST**: New `backend/services/maps-comparison.js` — `buildStateComparisonPayload()` gets final-step states and step data (via provided getters), extracts tract IDs per district group, runs PoliGeo `analyzeFromGeoids()` per group, assigns D/R by `pct_dem_pres >= 0.5`, aggregates state and US, computes swing.
- **Persistence and API**: Payload `{ us, states, meta }` saved to `data/maps-state-comparison.json`. `GET /api/maps/state-comparison` (cache then file; fallback 119th-only). `POST /api/admin/maps-comparison/refresh` recomputes and persists. Script `backend/scripts/refresh-maps-comparison.js` to trigger refresh.
- **Frontend**: Maps page fetches state-comparison on init; `stateComparison` drives `getUSData`/`getStateData` (and thus `getUSRowData`/`getStateRowData`). State-row swing displays with correct sign for negative values.
- **Docs**: Short “Maps page state list” section in `doc/pages/POLIGEO_ANALYST.md`.
