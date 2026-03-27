# 260326

## 2225 maps US all-states timing and parallel load

### Prompt

/archive

### Response / actions

Archiving the full session (maps page, All states):

- **Earlier prompt:** When displaying all states, is there a delay between district polygon request and map render? **✅ RESOLVED (Ask):** ~100ms `setTimeout` in `ngAfterViewInit` before `initializeMap` / `loadUSMapDistricts`; state outlines added synchronously when each state’s pipeline emits; district polygons use staggered `setTimeout` with `US_MAP_REVEAL_DELAY_MS` = `Math.round(30000/435)` ≈ 69ms per district index; per-state fetches were sequential via `concatMap` at that time.
- **Earlier prompt:** Is data from `getDistrictParty` available from another endpoint with all geodistricts party data? **✅ RESOLVED (Ask):** No single live GET for all districts; bulk shape is `districtPartyByState` on `GET /api/maps/landing` and `GET /api/maps/landing/summaries` (prebuilt GCS / static JSON), same per-group stats as per-state district-party cache.
- **Earlier prompt:** Turn delay between states off. **✅ IMPLEMENTED:** `frontend/src/app/pages/maps-page.component.ts` — `loadUSMapDistricts()` uses `mergeMap` instead of `concatMap` for parallel state loads; completion uses `usMapRevealTimeoutsCompleted` and `tryFinishUSMapLoadWhenRevealsDone()` instead of `usMapLastReceivedStateCode`; removed unused `concatMap` import. Per-district hero stagger unchanged.
