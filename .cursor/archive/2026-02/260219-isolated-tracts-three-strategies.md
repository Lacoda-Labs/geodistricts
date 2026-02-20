# 260219

## 2230 isolated tracts: three strategies and implementation

### Prompt

rethinking managing isolated tracts, that is, adjusting/moving tracts to ensure contiguity of tracts within a geodistrict, in the same way defering union polygon creation for DG steps until final step is complete, it seems waiting until final step to handle isolated tracts makes sense. then we can take a simplified approach to moving isolated tracts based detecting adjacent tracts that span last division line. thoughts? what am i missing? can you refine the logic? basically the approach (or rethinking) us to establish a grid of lat/long divisions based on sorted geography, then reduce isolated tracts using swapping strategies on adjacent tracts and tracts that span division lines.

### Response / actions

Plan: [.cursor/plans/defer_isolated_tracts_to_final_step.plan.md](.cursor/plans/defer_isolated_tracts_to_final_step.plan.md)

- **Research**: Reviewed TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md, MOVE_ISOLATED_TRACTS_FUNCTION.md, union-polygon deferral, division-line/sibling_DG usage, and resolveIsolationForStep flow.
- **Plan created**: Refined logic (grid = division tree; span = boundary tracts S4-adjacent to sibling; resolve only at final step with swap-only across sibling pairs). Captured three strategies: **1** per-step (current), **2** final-step only, **3** grid-only (no resolution). User asked to treat strategies separately and make strategy 3 the default; plan updated with default column and implementation scope.
- **Build**: User asked to build it.
- ✅ **IMPLEMENTED**:
  - **API** (`backend/index.js`): Request body `isolationStrategy`: `'none'` (default), `'perStep'`, `'finalStepOnly'`. Omitted + `resolveIsolation: true` → `perStep` for backward compatibility. Passed into `executeGeodistrictAlgorithm`.
  - **Algorithm** (`backend/services/geodistrict-algorithm.js`): `executeGeodistrictAlgorithm(..., isolationStrategy)`. Normalize to `strategy`; `none` = no resolution; `perStep` = resolve after each division (unchanged); `finalStepOnly` = resolve once after loop when all single-district, then replace last step with resolved groups and re-call `onStepComplete`. `resolveIsolationForStep` extended with `step0IslandTractIds` and `stepNumber`; all internal `detectIsolatedTracts` calls pass them so step-0 islands are excluded.
  - **Docs** (`doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md`): §8 isolation strategies table and execute API; §9 API documents `isolationStrategy` and legacy `resolveIsolation`.

Result: Default run is grid-only (Strategy 3); optional `isolationStrategy: 'perStep'` or `'finalStepOnly'` for contiguity resolution.
