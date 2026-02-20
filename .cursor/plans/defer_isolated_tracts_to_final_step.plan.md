---
name: ""
overview: ""
todos: []
isProject: false
---

# Defer Isolated Tract Handling to Final Step (Refined Logic)

## Three isolation strategies

Tract isolation is treated as **three separate strategies** (config/API: e.g. `perStep` | `finalStepOnly` | `none`). **Default: Strategy 3 (grid-only).**

| Strategy | Name             | Default | When resolution runs                                                                                           | Contiguity goal                                                                        |
| -------- | ---------------- | ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **1**    | Per-step         |         | After each division; step not “complete” until resolved                                                        | Enforce contiguity at every step                                                       |
| **2**    | Final-step only  |         | After final geodistrict grid is established; one resolution phase using sibling pairs and boundary/span tracts | Same contiguity, single resolution phase                                               |
| **3**    | Grid-only (none) | **yes** | No resolution                                                                                                  | Drop contiguity; final geodistricts = grid assignment only (proximity over contiguity) |


- **Strategy 1** (per-step): Resolve before a step is completed; detect/move isolated and bridge after each division.
- **Strategy 2** (final-step only): Wait until final grid, then resolve isolated using move/balancing approaches restricted to division-line-spanning swaps.
- **Strategy 3** (grid-only, **default**): No resolution. Remove contiguous-tracts requirement; final geodistricts are determined purely by the grid (proximity over contiguity). Simplest behavior; districts may contain disconnected tracts.

Implementation scope: **Strategy 3 is the default** (no isolation resolution). **Strategy 2** is implemented as an option (defer resolution to final step). **Strategy 1** remains as an option (current per-step resolution).

---

## Your idea (summary)

- **Defer** isolation resolution until the **final step** (analogous to deferring union polygon creation until the final step is cached).
- **Establish a grid** of lat/long divisions from the sorted geography (the existing division tree).
- **Reduce isolated tracts** using swapping strategies on:
  - Adjacent tracts (S4 neighbors across a division), and
  - Tracts that **span** the division line (boundary tracts).

## Refined logic

### 1. Run divisions only (no per-step isolation)

- Execute the algorithm **without** calling `resolveIsolationForStep` after each division.
- Each step: divide all multi-district DGs by sorted lat/long; no detect/move isolated, no bridge.
- Continue until all groups are single-district (final step). Same as today when `resolveIsolation: false` for the division loop, but we still need one resolution phase at the end.

### 2. “Grid” of divisions

- The “grid” is the **binary tree of splits**, not a literal 2D grid. Each internal node is one division line (lat or lng) with:
  - `parentGroup`, `siblingGroups` (the two child DGs), `line`, `direction`.
- At **final step** we have N single-district DGs. Each DG’s **sibling** is uniquely defined: the other child from the split that created this DG. That relationship is already on every tract: `tract.properties.sibling_DG` (and `divisionLines` in step-by-step only hold that step’s splits; for full run we don’t currently accumulate all division lines in one array, but we don’t need to—sibling comes from tract props).

So: **establishing the grid** = use existing division structure; for each final DG, sibling = `sibling_DG` from any tract in that DG.

### 3. “Tracts that span the division line”

- **Span** = tracts that sit on either side of the division and are **adjacent across it** (S4 neighbor in the sibling DG). That is exactly the **boundary tracts** used today for compensating moves: tracts in DG A that have at least one S4 neighbor in sibling DG B.
- Optionally you could also define “span” as tracts whose bbox/centroid is within ε of the division line; that would be a subset. The current code does **not** populate `intersectingTractIds` in `divideTractsBySortedArray` (it returns `[]`). So the practical definition that matches current behavior and your goal is: **boundary tracts = S4-adjacent to sibling DG**.

### 4. Simplified resolution at final step (swap-only across division)

- **Input**: Final step district groups (all single-district), `allTracts`, S4 graph, step-0 island set (exclude from “isolated”).
- **Detection**: Same as now—for each DG, main component via S4 within the group; isolated = not in main component; exclude step-0 islands.
- **Resolution** (only allow moves that respect the division tree):
  - **Sibling pair**: For each DG with isolation, sibling = `sibling_DG` (from tract props). Only consider moves between this DG and that sibling.
  - **Candidate moves**:
    1. **Move isolated → sibling**
      Isolated tract must have ≥1 S4 neighbor in sibling (otherwise it would stay isolated). Then **compensating move**: pick a boundary tract in the sibling (S4-adjacent to this DG) whose move to this DG minimizes population variance and does not create new isolation; swap.
    2. **Move boundary tract from sibling → this DG (bridge)**
      Tract in sibling that is S4-adjacent to both an isolated tract in this DG and to the main component of this DG. Move it here; optionally compensate with a boundary tract from this DG to sibling (same population/variance rule).
  - **Iterate**: Re-detect isolation after each batch of moves until no isolated tracts or max iterations.

This keeps the same **swap + balance** semantics as today but restricts candidates to **sibling pairs** and **boundary tracts**, so the “grid” and “span” ideas are encoded as: only swap across the last division line (sibling pair) and only use boundary (spanning) tracts for compensation/bridge.

### 5. What you might be missing

- **Step 0 islands**: At final step we must still **exclude** step-0 geographic islands from the isolated set (they are not division-induced). So final-step resolution still needs `step0IslandTractIds` from step 0.
- **Re-detection loop**: Moving tracts can create new isolation in the target DG. So we still need to **re-detect isolation** after moves and repeat (as in current `resolveIsolationForStep`). The “simplified” part is the **candidate set** (sibling + boundary), not the need to iterate.
- **Full division-line history (optional)**: If we ever want “all division lines” in one place (e.g. for visualization or for a stricter “span” definition by coordinate), we’d need to **accumulate** division lines across steps in the main loop (currently each step only keeps that step’s `divisionLines`). For the refined logic above, tract `sibling_DG` is enough.
- **Bridge vs move-isolated order**: At final step we can keep the same strategy: try bridge moves first (move boundary tract from sibling into this DG to connect isolated to main), then move remaining isolated to sibling with compensating boundary move. Or we could try only “move isolated + compensate” and only use bridge when that doesn’t suffice.
- **Population balance**: Same as now—compensating move chooses boundary tract that keeps sibling pair within target variance and doesn’t create new isolation.

### 6. Implementation options

- **A. Minimal change**: Add a run mode (e.g. `resolveIsolationAtFinalStepOnly: true` or strategy `finalStepOnly`) that:
  - Skips `resolveIsolationForStep` after each division.
  - After the loop, when `currentGroups` are all single-district, call a **single** `resolveIsolationForFinalStep(currentGroups, uniqueTracts, step0IslandTractIds)` that uses the same move/bridge/balance logic but **restricts** to sibling pairs and boundary tracts (and gets sibling from `sibling_DG`). Reuse existing `detectIsolatedTracts`, `moveIsolatedTractsToOppositeGroup`, `detectBridgeTracts`, `moveBridgeTractsAndRecheck`, and `_findBalancingTract`; only ensure we never consider non-sibling as target and we only pick boundary tracts for compensation.
- **B. New function**: Implement `resolveIsolationForFinalStep` from scratch: (1) detect isolated (with step-0 exclusion), (2) for each DG with isolation get sibling from `sibling_DG`, (3) build boundary sets (S4-adjacent to sibling), (4) apply bridge then move-isolated + compensate using only boundary tracts, (5) re-detect and iterate. This makes the “only division-line-spanning swaps” rule explicit and easier to tune.
- **C. Optional “span” refinement**: When dividing, record the two boundary tract IDs (last tract of first group, first tract of second group) in `divisionResult.intersectingTractIds` (or a new field) so “tracts that span the division line” can be defined as that small set for even cheaper candidate selection. Then in final-step resolution, prefer those as compensating/bridge candidates when available.

## Recommendation

- **Concept**: Deferring isolation to the final step and restricting to **sibling pairs** and **boundary (span) tracts** is consistent and simplifies the mental model (one resolution phase, one clear candidate set).
- **Completeness**: Keep step-0 island exclusion, re-detection loop, and population balance; optionally accumulate full division-line history if you want a coordinate-based “span” later.
- **Implementation**: Option A or B; add a strategy flag (e.g. `perStep` | `finalStepOnly` | `none`) with **default `none` (Strategy 3)** so you can compare strategies on the same states. Document all three strategies in the tract-isolation/contiguity spec.

## References

- Current isolation flow: [doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md)
- Move isolated (DG swap, balance): [doc/history/MOVE_ISOLATED_TRACTS_FUNCTION.md](doc/history/MOVE_ISOLATED_TRACTS_FUNCTION.md)
- Union deferral (final step only): [docs/archive/2026-02/260215-tract-border-toggle-union-defer.md](docs/archive/2026-02/260215-tract-border-toggle-union-defer.md)
- Division (sorted array, division line): [backend/services/latlong-division.js](backend/services/latlong-division.js) `divideTractsBySortedArray`, [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) loop and `divisionLines` push
- Resolution today: [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) `resolveIsolationForStep`, `executeGeodistrictAlgorithm` (resolveIsolation branch)

