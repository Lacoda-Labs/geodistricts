# 260224

## 1200 maps All states final districts party colors and play sequence

### Prompt

why does 'All" states on maps page no longer show final district polygons for states that have completed final step. also, change the line color on those geodistrict polygons to black. district coloring should be same as specific state selected.

[Later in chat: state district colors to be rendered similar to when state is selected (no party colors used); when AZ selected vs All selected, all should have same coloring—per-district party colors; confirm play button order follows same sequence as manual Next → Move → Balance.]

### Response / actions

✅ **FIXED** (All states not showing final districts): Backend `getMapPolygonsForState` was reading union polygon keys via `getCacheDoc(key)`, which with local cache returns only metadata; union polygon payload lives in Cloud Storage. Now union polygon keys always use `cloudStorageCache.get(key)` so All view receives final district polygons.

✅ **IMPLEMENTED**: Geodistrict polygon stroke set to black in All view (`addUSMapRevealItem`, `renderUSMapDistricts`) and in single-state map (`renderMapPolygons`). District fill uses per-district coloring: `getDistrictColor` (then updated to party-based, see below).

✅ **IMPLEMENTED** (party colors on All view): Backend returns `finalStepNumber` in map-polygons and map-polygons-all. Frontend fetches district party for all states with final step (after map-polygons-all or when restoring cache) into `allStatesDistrictPartyByState`. `getUSMapDistrictFillColor(stateCode, groupKey?)` uses per-district party when available (`getTractColorByParty`), else state-level (`statePartySummaries` or 119th). All view reveal and `renderUSMapDistricts` pass `groupKey` so each district gets the same red/blue party coloring as when that state is selected.

✅ **CONFIRMED** (play sequence): Play flow already matches manual order—(1) next-step until final step (detect-isolated-tracts at final step), (2) move isolated (loop until 0), (3) balance (loop until noMoreBalancingPossible), (4) trigger polygon + district-party. Added JSDoc on `playSteps()` documenting this sequence.
