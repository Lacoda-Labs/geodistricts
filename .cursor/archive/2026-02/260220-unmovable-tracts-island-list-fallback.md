# 260220

## 1700 unmovable tracts island list fallback

### Prompt

48409010800
Districts 18
48409010500
are still showing as isolated after move. 
clicked trash icon to clear cache, clicked play, clicked move.
these two show isolated and can't be moved. why did step 0 not identify.
as a fallback, move them to island list for step/district group.

### Response / actions

- **Why step 0 didn't exclude them:** Step 0 only excludes zero-adjacency tracts (no S4 neighbors). These two likely have S4 neighbors but all in the same district (18), so they are isolated (disconnected from main component) but not zero-adjacency; step 0 does not exclude them.
- **Fallback:** Treat unmovable tracts (no adjacent district in move) as islands for the current step: add them to the step's exclusion list so they are not reported as isolated and the step can complete.

✅ **IMPLEMENTED**:

- **moveIsolatedComponentsByAdjacency:** Collects tract IDs when `adjacentIndices.length === 0` into `unmovableTractIds` and returns them. Merges unmovable into `islandSet` in **resolveIsolationForFinalStep** for the next iteration.
- **POST move-all-isolated-tracts (final step):** Merges `moveResult.unmovableTractIds` into `step0IslandSet`, uses it for final isolation detection (so response shows 0 isolated for those). Adds `excludedTractIds` to step payload when persisting and to JSON response. **normalizeStepData** now persists `excludedTractIds` on the normalized step.
- **Frontend:** Added `getStep0IslandTractIdsForRequest()` (step-0 islands merged with `currentStep.excludedTractIds`). Detect and move use it for `step0IslandTractIds`. Move response stores `excludedTractIds` on current step. Re-detect after bridge move uses the same merged list.

Result: After Move isolated tracts, 48409010500 and 48409010800 are added to the step island list, excluded from isolation, UI shows 0 isolated; `excludedTractIds` is persisted and sent so future detect/move and cached step load keep treating them as islands for that step.
