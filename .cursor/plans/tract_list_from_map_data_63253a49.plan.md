---
name: Tract list from map data
overview: Use the same tract data that drives the map and info popup—currentStep.districtGroups[].censusTracts—to populate the step-0 tract list. No new APIs; fix the getter so the list is never empty when the map has tracts.
todos: []
isProject: false
---

# Tract list from map data (single source of truth)

## What’s going wrong

The map and popup already use `**currentStep.districtGroups[].censusTracts**` (same 1693 tracts for IN). The tract list does not, because:

1. **Priority is wrong:** In dev mode the getter **prefers `devTractList`** (from GET `/api/algorithm/census-tracts/:state`) over `currentStep`. So:
  - If `devTractList` is **empty** (e.g. census-tracts returned `{ tracts: [] }` or that request ran and failed in a way that left `[]`), the condition `this.devTractList != null` is still true (empty array), so the getter uses `devTractList` and the list stays empty even though `currentStep` has 1693 tracts.
  - If the census-tracts request is never sent or fails and sets `devTractList = null`, the list falls back to `currentStep` and would show tracts—so the empty-list case is likely the “empty devTractList wins” bug above.
2. **Two sources for the same UI:** The list was designed to optionally use a separate census-tracts endpoint. That adds a second code path and failure mode. The map never uses that endpoint; it only uses step/final-step data. So the list can show nothing while the map shows everything.

## Fix: one source of truth

Use the **same** tract array the map uses for the list: `**currentStep.districtGroups` → flatMap `censusTracts`**.

### 1. Change `tractsByCountyForList` getter (maps-page.component.ts)

- **When `currentStepIndex === 0` and `currentStep?.districtGroups` has at least one group with `censusTracts`:**  
Build the list **only** from `currentStep.districtGroups` (flatMap `g.censusTracts || []`, dedupe by tract ID, then group by county and chunk).  
Do **not** use `devTractList` for the list when step data has tracts.
- **Otherwise:**  
If you still want a fallback when there is no step (e.g. before Run), you can keep using `devTractList` when non-empty; otherwise return `[]`.

Concretely in [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (around 5933–5947):

- First, if `currentStep?.districtGroups?.length` and any group has `censusTracts?.length > 0`, set `tracts` from `currentStep.districtGroups` (existing flatMap + dedupe logic).
- Else, if in dev and `devTractList?.length > 0` and state matches, use `devTractList`.
- Else set `tracts = []` / return `[]`.

So: **prefer step data when it has tracts; only then consider devTractList.** The list will always match what the map is drawing (same `currentStep` and same `censusTracts`).

### 2. Optional cleanup

- `**ensureDevTractListLoaded` / census-tracts endpoint:** You can keep them for other uses (e.g. preloading before step 0 exists) or remove the list’s use of `devTractList` entirely and rely only on `currentStep`. For “list = what the map shows,” the minimal fix is the getter change above; cleanup can be a follow-up.
- **Empty-state message:** The “Loading tract list…” / “No tract data…” block can stay; once the list is driven by `currentStep`, it will disappear as soon as step 0 is loaded with tracts (e.g. after Run or GET final-step).

### 3. No backend or API changes

No new endpoints and no change to how the map gets data. Only the **source** used by the tract list changes so it uses the same `currentStep.districtGroups[].censusTracts` as the map and popup.

---

## Summary


| Current behavior                                                         | After fix                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| List prefers `devTractList`; empty `devTractList` can override step data | List prefers `currentStep.districtGroups[].censusTracts` when present          |
| List can be empty while map shows 1693 tracts                            | List is built from the same tract array as the map → list and map stay in sync |


Single change: adjust [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) `tractsByCountyForList` so that at step 0 it uses `currentStep.districtGroups` (with tracts) first, and only falls back to `devTractList` when step data has no tracts.