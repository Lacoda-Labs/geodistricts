# 260218

## 2315 union polygons POST-only and never block

### Prompt

all union polygon work should be done by POST union-polygon calls. POST move isolated should never block on building union polygons. union-polygon create should ALWAYS be done by async POST job. NEVER BLOCK on generating union polygons.

### Response / actions

Plan: [.cursor/plans/step_union_polygons_api_5cdd306e.plan.md](.cursor/plans/step_union_polygons_api_5cdd306e.plan.md)

Earlier in the session: summarized GCP console logs (geodistricts.org) and diagnosed why step 5 was spinning—backend was blocked by the step 4 union-polygon job (sequential union fallback ~5 min per group on the main thread).

- **Unify union trigger**: next-step and step-by-step no longer call `runUnionPolygonGenerationJob` directly. They now trigger **POST** `.../union-polygons` via `setImmediate(axios.post(unionPolygonsUrl, {}))` (same as move-all-isolated). Only the POST handler invokes `runUnionPolygonGenerationJob`; doc comments updated.
- **POST move-all-isolated**: Confirmed it never blocks on union building; added comment that it never blocks and unions are built only by async POST.
- **Never block**: In `recreateUnionPolygonsForGroups`, added `yieldConfig` (yield every 50 polygons) and `await new Promise(r => setImmediate(r))` after each district group. In `createUnionPolygon` / `createUnionPolygonsForGroup` (geodistrict-algorithm.js): made both async, added optional `yieldConfig`; in the sequential-union fallback loop, every 50 polygons we `await yieldConfig.yieldFn()` so the event loop can serve other requests. POST union-polygons job is the only place that creates unions and it now yields so the server does not block for minutes.

✅ **IMPLEMENTED**: All union polygon creation is triggered only via POST union-polygons; move-all-isolated never blocks; union job yields between groups and every 50 polygons in the sequential-union path so the server can serve GET step / next-step etc. while unions are building.
