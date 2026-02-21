# 260220

## 1630 zero-adjacency tracts as islands

### Prompt

State: TX
District 18
Tract ID: 010800
⚠️ ISOLATED TRACT
District 18
Tract ID: 010500
⚠️ ISOLATED TRACT
are the only remaining tracts after running new move isolated method.
it appears there may be some tracts that don't have polygons. confirm these tracts don't have adjacent tracts. if so, these should be identified and treated as islands. why are these tracts identified as isolated

[Later: Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.]

### Response / actions

Plan: Treat Zero-Adjacency Tracts as Islands (Exclude from Isolation) — root cause: tracts with no S4 adjacency form 1-tract components and are classified isolated; move skips them (no adjacent district). Fix: at step 0 add them to excludedTractIds so they are excluded from isolation at steps 1+.

✅ **IMPLEMENTED**:

- **createStep (geodistrict-algorithm.js):** At step 0, after water/special exclusion, added logic to collect tract IDs with zero neighbors in the adjacency graph (excluding water/special). Those IDs are appended to `excludedTractIds`, added to `islandTractsData.islandTractsByGroup[0]`, and totals updated. Log: "Step 0: Excluding N tract(s) with no adjacency from isolation in later steps".
- **moveIsolatedComponentsByAdjacency:** When `adjacentIndices.length === 0`, debug log now includes tract IDs (sample + count) for support/debug.
- **Test:** In geodistrict-algorithm-isolation.test.js, added test 7: one tract with geometry and state XX (empty graph) is excluded at step 0 and not reported isolated at step 1 when step0 exclusion set is used. All isolation tests pass.

Re-running the algorithm (or step 0) for TX is required for cached runs to pick up the new exclusion so tracts 010500/010800 are no longer reported as isolated when they have zero adjacency.
