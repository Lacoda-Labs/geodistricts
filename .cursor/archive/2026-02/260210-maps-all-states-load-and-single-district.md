# Archive: Maps page All-states load + single-district handling (2026-02-10)

## Summary

1. **All-states load:** When the maps page loads with "All states" selected, Phase 1 fetches all 51 state union polygons in one backend call and draws state outlines; Phase 2 fetches each state's map polygons via 51 separate calls (only for multi-district states) in order by congressional district count descending.
2. **Single-district states:** States with one congressional district do not call any algorithm or map-polygon APIs, are not selectable on the maps page, but remain in the state list so they still show in the overall table and total.

## Implementation details

### Backend
- **New endpoint:** `GET /api/algorithm/state-union-polygons-all` returns state boundary polygons for all 51 states (from Cloud Storage key `state_boundary_polygon_${state}`). Uses `CONGRESSIONAL_DISTRICTS_BY_STATE` for the state list.

### Frontend service
- **Types:** `AllStateUnionPolygonsResponse` with `statePolygons: Array<{ stateCode; polygon }>`.
- **Method:** `getAllStateUnionPolygons()` calls the new endpoint.

### Maps page
- **DC added** to the hardcoded `states` array (51 entries, sorted by districts descending).
- **Layers:** `stateOutlinesLayer` added below `tractLayer` for state outlines in ALL view.
- **loadUSMapDistricts():**
  - Phase 1: `getAllStateUnionPolygons()` → draw state outlines on `stateOutlinesLayer`.
  - Phase 2: Only states with `districts > 1`; placeholder entries for single-district states (no API) so table and `usMapTotalDistricts` stay correct. Uses `concatMap` over ordered state codes to fetch `getMapPolygons(state)` and render districts progressively.
- **Helper:** `mapPolygonsResponseToStepData()` converts `MapPolygonsResponse` to `GeodistrictStep` for `renderUSMapDistricts()`.

### Single-district states
- **isSingleDistrictState(stateCode):** `getStateDistrictCount(stateCode) <= 1`.
- **No API calls:** Phase 2 skips single-district states; `loadMapPolygons()` and `runAlgorithm()` return early for them.
- **Not selectable:** State rows use `[clickable]="!isSingleDistrictState(state.code)"`; `selectStateFromTable()` returns if single-district; `onStateChange()` resets to `'ALL'` if the selected state is single-district (e.g. from URL/localStorage).
- **Placeholders:** `placeholderStepDataForSingleDistrictState()` provides step data with one district group and no geometry for the US map list.

## Files touched

- `backend/index.js` – New endpoint; import `CONGRESSIONAL_DISTRICTS_BY_STATE`.
- `frontend/src/app/services/geodistrict-algorithm.service.ts` – `AllStateUnionPolygonsResponse`, `getAllStateUnionPolygons()`.
- `frontend/src/app/pages/maps-page.component.ts` – DC in `states`; `stateOutlinesLayer`; refactored `loadUSMapDistricts()`; single-district guards and helpers.
- `frontend/src/app/pages/maps-page.component.html` – State row `[clickable]` bound to `!isSingleDistrictState(state.code)`.
