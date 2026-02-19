# 260218

## 1400 union polygon after move isolated

### Prompt

POST union-polygon appears to create polygons with isolated tracts. it could be because after POST move isolated tracts has not saved a the new list of tracts for each sibling DG after the move. make sure the POST union-polygon is call after tracts are update in the step's dg tracts.

(Later) Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [union_polygon_after_move_isolated (plan attached in chat)]

✅ **IMPLEMENTED**: Ensured POST union-polygons runs only after the step's DG tract lists are persisted to the step cache.

- **Fast path (move-all-isolated-tracts):** Before triggering POST union-polygons via `setImmediate`, the handler now builds a step payload from `updatedGroups` and `bodyDivisionLines`, normalizes it with `normalizeStepData`, and **awaits** `setStepCache(stepCacheKey, cacheData)` so the union-polygon job loads post-move tract assignments from cache. Same cache key and payload shape as the cache path.
- **Single move (POST move-isolated-tracts):** After invalidating the step cache, the handler now writes the updated step back using `algorithmState.steps[step]` and `algorithmState.tractCacheKey`, so any later POST union-polygons uses the correct tract list.

Changes in [backend/index.js](backend/index.js) only; no changes to POST union-polygons handler or cache path. All todos completed; linter clean.
