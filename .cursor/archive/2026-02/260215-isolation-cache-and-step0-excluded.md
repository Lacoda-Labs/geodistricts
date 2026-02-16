# 260215

## 1430 isolation cache and step0 excluded

### Prompt

/archive

### Response / actions

Session covered two fixes:

1. **Move-all-isolated still using huge list** — Cached step 1 could contain bad `isolatedTractsData` (e.g. 4538 tracts in one group). Backend was returning it from `reconstructStepFromCache`, so the frontend sent it back and the API tried to move thousands of tracts (all skipped). ✅ **FIXED**: In `reconstructStepFromCache` (backend/index.js), do not attach `isolatedTractsData` when any group has >200 isolated tracts (same cap as move handler). Client then gets no isolation data and runs fallback detection, so the list is correct.

2. **Step 1 isolated list included 5 island tracts** — Step 0 identifies both geographic island tracts (`islandTractsByGroup`) and water/special tracts (`excludedTractIds`). Frontend `getStep0IslandTractIds()` only used `islandTractsByGroup`, so water/special (e.g. 06017990000, 06061990000) were never sent and appeared as isolated at step 1. ✅ **FIXED**: `getStep0IslandTractIds()` (maps-page.component.ts) now includes `excludedTractIds` in the list sent as `step0IslandTractIds` to detect-isolated and move-all-isolated, so both island and water/special tracts are excluded from isolation at steps 1+.
