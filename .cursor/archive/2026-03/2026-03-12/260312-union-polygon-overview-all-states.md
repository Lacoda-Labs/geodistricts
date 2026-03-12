# 260312

## 1200 union polygon precision and overview blob for All-states map

### Prompt

search archive for discussion on reducing union polygon precision in order to reduce payload for loading All state map. the goal is improve performance by reducing payload to minimum required to display the page, starting with polygons. the idea is considering the pixel dimensions of the displayed map div, the precision of the polygons for districts is far too granular, especially at map zoom levels where the district poylgon is relatively small. estimate the reduction in payload for a large state such as TX.

[Later:] so in this plan, are simplified polygons used only by All state map, while full precision polygons for spceific state maps?

[Later:] i want both the current full union polygon generate, preserved and stored as it behaves today. in addition, i want reduced Precision polygons generated and use to improve performance on the All states map. does you plan do this?

[Later:] build the plan

### Response / actions

Plan: [.cursor/plans/union_polygon_precision_all-states_payload_9bb60446.plan.md](.cursor/plans/union_polygon_precision_all-states_payload_9bb60446.plan.md)

- **Archive search**: No doc explicitly on reducing union polygon precision by pixel/zoom for All-states map. Related: 260218 (tract precision for large states), 260216 (smaller payloads for visualization), 260304 (union properties cleanup), 260224 (line weight). Plan created summarizing findings and TX payload estimate (~50–60% reduction with display simplification).
- **Clarification**: Plan updated so full-precision generation and storage are unchanged; a separate reduced-precision artifact is generated and used **only** for the All-states map (two blobs: `map_polygons_${state}` full, `map_polygons_${state}_overview` simplified).
- **Implementation**: (1) **Backend** ([backend/index.js](backend/index.js)): In `runBuildAllUnionPolygonsForState`, after writing the full map-polygons blob, build overview payload with `simplifyUnionGeometry(..., { decimals: 4, removeDuplicatePoints: true, simplifyTolerance: 0.0001 })` and write `map_polygons_${state}_overview`. `getMapPolygonsForState(stateCode, options)` accepts `{ overview: true }` and reads overview blob (fallback to full blob if overview missing). GET `/api/algorithm/map-polygons/:state` supports `?overview=true` or `?for=all`. (2) **Frontend**: `getMapPolygons(state, options?)` appends `&overview=true` when `options?.overview`. In `loadUSMapDistricts`, calls `getMapPolygons(stateCode, { overview: true })`; single-state load unchanged (no second arg → full precision).
- **Result**: Full union polygons and full map_polygons blob unchanged; overview blob written on build-all; All-states map uses smaller payload when overview exists.
