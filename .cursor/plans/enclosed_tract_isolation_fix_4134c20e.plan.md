---
name: Enclosed tract isolation fix
overview: Fix the bug where enclosed (donut-hole) tract 48409011100 appears in the isolated tracts list at TX Step 1 by excluding tracts with ENCLOSED_BY from isolation detection at steps &gt; 0, and verify GDIP-004 §3.3 is consistent with the implementation.
todos: []
isProject: false
---

# Enclosed tract in isolated list (TX 48409011100) – root cause and fix

## Root cause

**Isolation detection** in [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) (`detectIsolatedTracts`) excludes only **step-0 island tract IDs** (`step0IslandTractIds`) from the isolated set at steps 1+. It does **not** exclude tracts that are **enclosed** (donut-hole tracts with `ENCLOSED_BY`).

- **Step 0** correctly assigns `ENCLOSED_BY` and `TRACT_GROUP_ID` to enclosed tracts (e.g. in [backend/index.js](backend/index.js) ~3368–3418 and ~5132–5180, and in `reconstructStepFromCache` ~8729–8765).
- **Sorting/division** keeps enclosed with enclosing via [backend/services/latlong-division.js](backend/services/latlong-division.js) (sort value = enclosing tract’s boundary ± ε, and `TRACT_GROUP_ID` movement in `divideTractsBySortedArray`).
- **Connected components** in `detectIsolatedTracts` use S4 adjacency only. An enclosed tract may have **no S4 adjacency** to its enclosing tract (interior “donut hole” often has no shared boundary in Census/S4 data), so it forms a **1-tract component** and is classified as isolated.
- **Step 0 exclusion list** (`excludedTractIds`) only includes water/special and zero-adjacency tracts ([backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) ~1770–1827); enclosed tracts are **never** added there.

So tract 48409011100 is correctly marked as enclosed at step 0 and stays with its enclosing tract through division, but when isolation is run at step 1 it is still reported as isolated because it is never excluded by property.

## Fix (implementation)

**1. Exclude enclosed tracts from the isolated set in `detectIsolatedTracts`**

In [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js), inside `detectIsolatedTracts` (around 2519–2592):

- **Before** the per-group loop (or at the start of the loop): build a set of **enclosed tract IDs** from the current step’s data by iterating `districtGroups` and, for each `group.censusTracts`, adding `getTractId(tract)` to a set when `tract.properties?.ENCLOSED_BY` is set.
- **After** the existing block that removes `step0IslandTractIds` from `groupIsolatedTractIds` (lines 2585–2589), add a similar block: for steps > 0, remove every tract ID that is in the enclosed set from `groupIsolatedTractIds`.

Effect: any tract that has `ENCLOSED_BY` in the current step is treated as “allowed” and will not appear in `isolatedTractsByGroup` or `isolatedTractIds`, matching GDIP-004 §3.1.1 and §3.2.

**2. Optional: add enclosed count to debug logging**

When the enclosed set is non-empty and any IDs were removed from `groupIsolatedTractIds`, log that enclosed tracts were excluded (e.g. count and optionally first few IDs) so debugging stays clear.

**3. No API or frontend change**

Exclusion is done inside `detectIsolatedTracts` using properties already on the request payload (`districtGroups`/tract properties). The detect-isolated-tracts API and frontend calls remain unchanged.

## GDIP-004 §3 (isolated tracts) – consistency check

- **§3.1.1** says enclosed (donut-hole) tracts “should be treated as part of the enclosing tract” and “detected during initial step 0 and identified with properties at the tract level.” The implementation already detects them at step 0 and sets `ENCLOSED_BY`/`TRACT_GROUP_ID`; the missing piece was excluding them from the **isolated** set at steps 1+, which the fix adds.
- **§3.2** says “Total number of reachable tracts should exclude **allowed** isolated tracts detected during initial step 0.” “Allowed” includes both geographic islands (already excluded via `step0IslandTractIds`) and enclosed tracts (after the fix, excluded via `ENCLOSED_BY`). So the fix aligns behavior with §3.2.
- **§3.3** (resolution: bridge tracts and sibling tract swap) is about **how** to resolve tracts that are still considered isolated after exclusions. The implementation already does bridge detection and move-isolated (sibling swap). No change needed for §3.3; the fix only narrows **which** tracts count as isolated so enclosed tracts are never offered for resolution.

**Conclusion:** The fix makes the implementation consistent with GDIP-004 §3.1.1 and §3.2. §3.3 remains correct as the resolution strategy for the (reduced) set of isolated tracts.

## Optional doc updates

- **[doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md)** §4 “Algorithm”: add a bullet that at steps 1+, after removing `step0IslandTractIds`, also remove any tract ID that has `ENCLOSED_BY` (enclosed/donut-hole tract), since they are allowed and follow their enclosing tract.

## Verification

- Run TX to step 1 and confirm tract 48409011100 no longer appears in the isolated tracts list.
- If step 0 shows 48409011100 in the “Enclosed tracts” list with an enclosing tract, that confirms it is detected as enclosed; after the fix, it should not appear in “Isolated tracts” at step 1.

