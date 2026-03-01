# 260226

## 1230 TX party data and play button bounce

### Prompt

TX is still broken. bad party data. @localhost-1772174821898.log
also, play button is bahaving differently, bouncing around between steps.

### Response / actions

✅ **IMPLEMENTED** (no plan file):

**Party data (TX and all states):**
- Pass `vestYear=2024` explicitly in `fetchDistrictPartyForCurrentStep()` and in both All-states `forkJoin` district-party calls so the backend always uses the 2024 cache key and never legacy inflated data.
- Documented that re-running "Calc Party %" (or play to completion) for TX refreshes district party cache; if still wrong, tract party persistence for TX may need re-run.

**Play / step bouncing:**
- In visualization mode when loading a step via GET, store the step at `loadedSteps[nextIndex]` (requested index) instead of `loadedSteps[loadedIndex]` so a mismatched API `stepIndex` cannot overwrite another slot and cause step jumping.
- When displaying an already-loaded step from `loadedSteps`, set `isLoading = false` and `isLoadingSteps = false` so play does not get stuck.
- Added `_runningFinalStepCompletion` guard so `runFinalStepToCompletion()` is not re-entered while move-isolated or balance is in flight; cleared on pause or when each phase finishes. Prevents double triggers from delayed `onStepDisplayComplete` callbacks.

All changes in [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts). Log file was not in workspace so fixes were based on described behavior.
