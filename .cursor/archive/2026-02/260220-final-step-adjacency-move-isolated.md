# 260220

## 1600 final-step adjacency-based move isolated tracts

### Prompt

create a new moving isolated tracts method to be used only when strategy 2 and 3 are used, i.e. moving isolated tracts only at final step.
this new move method should use adjacency to determine the district to swap with. for isolated tracts groups, then entire group should be swapped with the adjecent district priotizing sibling groups from previous steps.

[Later: strategy 3 shows a move isolated tract button at final step. this button should call the new method.]

[Later: build the plan]

### Response / actions

Plan: [.cursor/plans/final-step_adjacency_move_isolated.plan.md](.cursor/plans/final-step_adjacency_move_isolated.plan.md)

✅ **IMPLEMENTED**:

- **Backend (geodistrict-algorithm.js):** Added `_getAdjacentGroupIndicesForComponent` (S4-adjacent DGs for an isolated component), `_chooseTargetGroupForComponent` (sibling-first among adjacent), and `moveIsolatedComponentsByAdjacency` (moves whole isolated components by adjacency, sibling-priority). Added `resolveIsolationForFinalStep` (same detect/bridge/move loop as resolveIsolationForStep but uses adjacency move for isolated). Strategy 2 run-mode now calls `resolveIsolationForFinalStep` at final step instead of `resolveIsolationForStep`.
- **Backend (index.js):** In `POST /api/algorithm/move-all-isolated-tracts` fast path, when every group is single-district (final step), use `moveIsolatedComponentsByAdjacency` in a loop (detect → move → re-detect) instead of the per-group `moveIsolatedTractsToOppositeGroup` loop. Non–final step keeps existing sibling-only behavior.
- **Docs:** Updated TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md with §6b (final-step adjacency-based move), implementation function list, and move-all-isolated-tracts final-step behavior.
- **Tests:** Added two tests in geodistrict-algorithm-isolation.test.js for `_getAdjacentGroupIndicesForComponent` and `_chooseTargetGroupForComponent`. All isolation tests pass.

No frontend or API contract changes; Move Isolated Tracts button at final step (e.g. Strategy 3) now triggers the new method via the same endpoint.
