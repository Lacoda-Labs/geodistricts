# 260213

## 1530 step label and move isolated tracts

### Prompt

Implement the plan: (1) Fix "Step 2 of 1" by making total steps deterministic from the selected state. (2) Fix "Move Isolated Tracts" doing nothing: backend try both step cache key formats and accept optional frontend isolatedTractsData; frontend send isolatedTractsData and show errors in the Isolated Tracts section.

### Response / actions

✅ **IMPLEMENTED**:

- **Step label**: Injected `CongressionalDistrictsService` in maps-page; added `getExpectedTotalSteps()` using `getDistrictsForState(selectedState)`; updated `getTotalSteps()` to `Math.max(totalSteps, loadedSteps.length, getExpectedTotalSteps())` so the label shows e.g. "Step 2 of 9" for AZ.
- **Move Isolated Tracts – backend**: move-all-isolated-tracts now tries both cache key formats (`algorithm_step_*` then `step_*_version`) with expiry/version checks; accepts optional `isolatedTractsData` in body and uses it when step cache has none; uses `dataToReconstruct` (stepData or cachedEntry) for Run All–style docs.
- **Move Isolated Tracts – frontend**: `moveAllIsolatedTractsFromStep` accepts optional 4th param `isolatedTractsData` and sends it in POST body; maps-page passes step or component isolated data and clears `errorMessage` on success.
- **UX**: Isolated Tracts panel shows `errorMessage` when set (new `.isolated-tracts-error` block and styles).

All plan todos completed; lints clean.
