# 260215

## 2130 tract isolation fast detection, bridge scope, run vs step

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/tract_isolation_and_run_step_modes_96b12c64.plan.md](.cursor/plans/tract_isolation_and_run_step_modes_96b12c64.plan.md)

✅ **IMPLEMENTED**:

- **Fast isolation**: Refactored `detectIsolatedTracts` in `backend/services/geodistrict-algorithm.js` to use one-pass connected components via new `_buildDgAdjacentGroups`; main = largest dgAdjacentGroup, isolated = rest. Same return shape; added `isolatedComponentsByGroup` (steps 1+) for bridge scope.
- **Bridge scope**: `detectBridgeTracts` now accepts optional 4th param `isolatedComponentsByGroup`; when present, runs bridge only for isolated components with 2+ tracts. `resolveIsolationForStep` passes it so run mode uses scoped bridge.
- **Run vs step**: Documented in JSDoc and comment in `backend/index.js`: run mode always runs bridge detection; step mode does not.
- **Tests**: Added `backend/services/geodistrict-algorithm-isolation.test.js` (run with `node backend/services/geodistrict-algorithm-isolation.test.js`); covers _buildDgAdjacentGroups, detectIsolatedTracts shape and isolatedComponentsByGroup, and detectBridgeTracts with/without 4th param.
- **Docs**: Updated `doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md` §4 (one-pass algorithm), §5 (bridge only for 2+ tract components), §2 (main = largest component), new §8 (run vs step mode), renumbered §9–11, implementation notes.
