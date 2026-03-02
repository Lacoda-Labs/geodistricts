# 260301

## 1200 sequential geodistrict polygons fetch

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/sequential_geodistrict_polygons_fetch_0138a1c4.plan.md](.cursor/plans/sequential_geodistrict_polygons_fetch_0138a1c4.plan.md)

✅ **IMPLEMENTED**: Sequential fetch for geodistrict polygons (435 max).

- **Maps page** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): Replaced single `getMapPolygonsAll()` call with sequential `getMapPolygons(state)` via `from(orderedStateCodes).pipe(concatMap(...))`. Added `onStatePolygonsReceived(stateCode, response)` to append stepData, update totals, and call `addUSMapRevealItem` for state outline + each district so the map reveals state-by-state as data arrives. Added `finishUSMapLoad()` to set cache and clear loading. On sequence complete, run `forkJoin(getDistrictParty(...))` for states with final step, then call `finishUSMapLoad()`. Set `isLoading` true at start and false on complete/error.
- **Service** ([frontend/src/app/services/geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)): Removed `getMapPolygonsAll()` and `MapPolygonsAllResponse`.
- **Backend** ([backend/index.js](backend/index.js)): Removed `GET /api/algorithm/map-polygons-all` and `DEFAULT_STATE_CODES_ORDER`. Kept `GET /api/algorithm/map-polygons/:state` as the single source for polygons per state.
