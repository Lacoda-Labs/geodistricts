# 260222

## 1430 Implement isolation balance union party plan

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [isolation_balance_union_party_9fed0afd.plan.md](.cursor/plans/isolation_balance_union_party_9fed0afd.plan.md) (workspace plan).

✅ **IMPLEMENTED**:

1. **Isolation detection at each step** — In [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts), all four step-load paths (initial load, reset to step 0, loadStepFromCache/goToStep, goToNextStep) now always clear `isolatedTractIds` / `isolatedTractsData` and call `detectIsolatedTracts()` when step index/number > 0 and step has `districtGroups`. Removed use of cached `step.isolatedTractsData` to skip detection.

2. **Balance button only after isolation resolved** — In [frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html), the Balance button in the isolated-tracts header now has `hasUnresolvedIsolation` in its `[disabled]` condition and a conditional tooltip ("Resolve isolated tracts first" when unresolved, else "Balance sibling district groups after moving isolated tracts").

3. **District-party job after balance at final step** — In [backend/index.js](backend/index.js), the `balance-after-isolated` handler now triggers `POST /api/algorithm/district-party/:state` with `finalStepNumber` and `maxIterations` in the same `setImmediate` block as the existing build-all-union-polygons trigger, so party percentages are computed per DG once the step is complete.
