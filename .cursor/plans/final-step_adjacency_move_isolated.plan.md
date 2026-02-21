---
name: "Final-step adjacency move isolated"
overview: "Add adjacency-based move-isolated method for final step; use it in both run-mode (Strategy 2) and when the user clicks Move Isolated Tracts at final step (Strategy 3 or manual)."
todos: []
isProject: false
---

# Final-Step Adjacency-Based Move Isolated Tracts

## Scope

- **Strategy 2** (`finalStepOnly`): Automatic resolution at final step uses the **new** adjacency-based, whole-component move.
- **Strategy 3** (`none`): No automatic resolution, but the UI still shows **Move Isolated Tracts** at the final step. When the user clicks that button, the backend must use the **new** method (not the current sibling-only move).

So the new method is used in two places:
1. **Run mode**: When `isolationStrategy === 'finalStepOnly'`, the automatic final-step resolution uses the new method.
2. **Button at final step**: When the user clicks "Move Isolated Tracts" and the current step is the final step (all single-district DGs), the backend endpoint `POST /api/algorithm/move-all-isolated-tracts` uses the new method.

## Current behavior

- **Run final-step**: `executeGeodistrictAlgorithm` calls `resolveIsolationForStep`, which uses `moveIsolatedTractsToOppositeGroup` (sibling-only, flat list per group).
- **Button**: `maps-page.component.ts` `moveIsolatedTracts()` → `moveAllIsolatedTractsFromStep()` → `POST /api/algorithm/move-all-isolated-tracts`. Backend fast path (when `districtGroups` + `isolatedTractsData` sent) loops over groups and calls `moveIsolatedTractsToOppositeGroup` for each.

## New method behavior (unchanged from original plan)

1. **Adjacency-based target**: For each isolated **component** (from `isolatedComponentsByGroup`), find DGs that are S4-adjacent (neighbors of any tract in the component that belong to another DG).
2. **Prioritize sibling**: Among those adjacent DGs, prefer the one that is `sibling_DG` from the division tree.
3. **Swap entire group**: Move the **entire** isolated component to the chosen target in one operation.

## Implementation updates

### Backend: new move and helpers (geodistrict-algorithm.js)

- Add `_getAdjacentGroupIndicesForComponent(componentTractIds, sourceGroupIndex, tractIdToGroupIndex, adjacencyGraph)`.
- Add `_chooseTargetGroupForComponent(adjacentGroupIndices, componentTractIds, districtGroups, allTracts)` (sibling-first).
- Add `moveIsolatedComponentsByAdjacency(districtGroups, allTracts, isolationResult, step0IslandTractIds)` that iterates by component and uses the two helpers, then `_moveTractsToGroup` for each whole component.

### Backend: when to use the new method

**A) Run mode (Strategy 2)**  
- When `strategy === 'finalStepOnly'` and we are at the final step, call a resolution that uses `moveIsolatedComponentsByAdjacency` (e.g. new `resolveIsolationForFinalStep` or a flag in `resolveIsolationForStep`).

**B) Move-all-isolated endpoint (button at final step)**  
- In [backend/index.js](backend/index.js) `POST /api/algorithm/move-all-isolated-tracts` fast path, **before** the existing loop that calls `moveIsolatedTractsToOppositeGroup`:
  - Detect if current step is final step:  
    `const isFinalStep = bodyDistrictGroups.length > 0 && bodyDistrictGroups.every(g => g.startDistrictNumber === g.endDistrictNumber);`
  - If `isFinalStep`, run the new flow:
    - Call `algorithmService.detectIsolatedTracts(updatedGroups, allTracts, step, step0IslandSet)` to get full result including `isolatedComponentsByGroup`.
    - Call `algorithmService.moveIsolatedComponentsByAdjacency(updatedGroups, allTracts, isolationResult, step0IslandSet)` in a loop until no isolated (or max iterations), re-detecting after each call.
    - Use the returned `updatedGroups` and run the same final isolation detection and response building as the current path (including step cache, build-all-union-polygons when step complete).
  - If not `isFinalStep`, keep the existing loop using `moveIsolatedTractsToOppositeGroup`.

No frontend change: the button already calls the same endpoint with the same payload; the backend branches on "all single-district groups" to choose the move strategy.

### Files to touch

| Area | File |
|------|------|
| Helpers + new move | [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) |
| Run-mode final-step | Same: `executeGeodistrictAlgorithm` + resolve path |
| **Button at final step** | [backend/index.js](backend/index.js) `POST /api/algorithm/move-all-isolated-tracts` fast path |
| Docs | [doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md) |
| Tests | [backend/services/geodistrict-algorithm-isolation.test.js](backend/services/geodistrict-algorithm-isolation.test.js) |

## Summary

- Strategy 3 (and any manual final step): **Move Isolated Tracts** button → same API → backend uses **new** adjacency-based, whole-component move when all groups are single-district.
- Strategy 2: automatic final-step resolution also uses the new method.
- No UI or API contract change; backend infers final step from `districtGroups` (every group has `startDistrictNumber === endDistrictNumber`).
