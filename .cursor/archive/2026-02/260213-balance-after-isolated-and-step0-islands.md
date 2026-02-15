# 260213

## 1630 balance after isolated moved and step 0 island exclusion

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

[Later in chat:]

aftep step 1, isolated tracts are islands that should be ignored (and detected in step 0). does clicking refresh clear the isolated tract detection handling in step 0? why are islands (that may have multiple tracts) being identified as isolated in step 1?

### Response / actions

Plan: [.cursor/plans/balance_after_all_isolated_moved_4e7617d1.plan.md](.cursor/plans/balance_after_all_isolated_moved_4e7617d1.plan.md)

**Balance-after-isolated (plan implementation):**
- **geodistrict-algorithm.js**: Added optional `skipBalancing` to `moveIsolatedTractsToOppositeGroup` (passed through to `_moveTractsToGroup`). Implemented `_getTractSortValue(tract, direction)` and `balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, divisionLines)`: for each division line, resolve sibling group indices, get boundary tracts, sort by distance to dividing line, swap from overpopulated side (with contiguity check) until within `BALANCE_TARGET_VARIANCE`.
- **index.js**: Fast path and cache path for move-all-isolated-tracts now call `moveIsolatedTractsToOppositeGroup(..., true)`; after the move loop, call `balanceSiblingPairsAfterIsolatedMoves(updatedGroups, allTracts, divisionLines)` (or `currentStep.divisionLines` on cache path) before final isolation detection.

**Step 0 island exclusion (islands reported as isolated in step 1):**
- **Root cause**: `initializeAlgorithm` called `createStep(0, ..., null, null)`, so step 0 never ran island detection and never had `islandTractsData`. At step 1, `getStep0IslandTractIds()` returned undefined, so the backend did not exclude any tracts and geographic islands were flagged as isolated.
- **geodistrict-algorithm.js**: Changed `createStep` call in `initializeAlgorithm` to pass `this` and `uniqueTracts` so step 0 runs isolation/island detection and gets `islandTractsData`.
- **index.js**: In `normalizeStepData`, added `islandTractsData: step.islandTractsData || undefined` so cached step 0 preserves island data; reconstruction already spreads normalized step and thus keeps it.

✅ **IMPLEMENTED**: Balance-only-after-all-isolated-moved (plan). ✅ **FIXED**: Step 0 now gets island detection and islandTractsData; refresh and cache both preserve it so step 1+ exclude geographic islands from isolation.
