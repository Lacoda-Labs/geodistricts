# 260219

## 1600 union polygons backward pass

### Prompt

thinking about union polygons, does it make sense to wait until final step is completed and final geodistricts have been calculated?
at that point union polygons are created for the final geodistracts.
but once those are created, those GD polygons can be used to create union polygons for previous step. it is just moving backwards in the division process, using previous step but using final district tracts to build "final tract list" for each DG and union polygons of siblings DGs should create parent DG (from previous steps). make sense?

(Follow-up: Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.)

### Response / actions

Plan: [.cursor/plans/union_polygons_backward_pass_abee06be.plan.md](.cursor/plans/union_polygons_backward_pass_abee06be.plan.md)

- Confirmed the design: wait until final step is done, build union polygons for the final step from tracts, then backfill steps 1..N−1 by unioning sibling DG polygons (parent = union of two children) using `divisionLines`; Step 0 stays TIGER-only.
- ✅ **IMPLEMENTED** (backend):
  1. **getStepCacheEntry(state, stepNum, maxIterations)** — resolves step cache for either key format (`algorithm_step_*` or `step_*`).
  2. **runBuildAllUnionPolygonsForState(state, finalStepNumber, maxIterations)** — runs existing tract-based union job for the final step, then backward pass from finalStep−1 down to 1: for each step K, loads step K+1 polygons from cache, builds parent DGs via `turf.union(sibling1, sibling2)` or reuses same-DG polygon; writes polygons and updates step cache with `unionPolygonsCached` and per-group cache keys.
  3. **POST /api/algorithm/build-all-union-polygons/:state** — query params `finalStepNumber` (required), `maxIterations` (optional); returns 202 and forks build-all worker.
  4. **Worker** `backend/scripts/run-build-all-union-polygons-job.js` — invokes `runBuildAllUnionPolygonsForState`; exported from `index.js`.
- **Triggers**: Run-all triggers build-all when final step is cached (instead of per-step POST). Next-step triggers build-all only when `isComplete`. Move-all-isolated (both paths) triggers build-all only when the completed step is the final step (all single-district DGs). No per-step POST for intermediate steps.
- Per-step POST `.../union-polygons` left in place for on-demand/repair; GET step and GET union-polygons unchanged.
