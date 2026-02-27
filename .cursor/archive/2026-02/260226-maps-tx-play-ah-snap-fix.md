# 260226

## 1400 dev/maps TX play Ah Snap fix

### Prompt

/dev/maps page goes Ah Snap after TX play is completed. behaves like a memory leak or an infinite loop.

### Response / actions

- Added debug instrumentation (counters and logs) for `runFinalStepToCompletion`, `renderFinalDistricts`, `refetchFinalStepForStatus`, `triggerPolygonsForAllMissing` to test hypotheses (re-entry loop, render loop, trigger chain, refetch polling).
- **Root cause:** In `runFinalStepToCompletion()`, the move-isolated success callback always called `setTimeout(() => this.runFinalStepToCompletion(), 0)` for both `totalIsolated === 0` and `totalIsolated > 0`. When the backend returned `totalIsolated > 0` (e.g. unmovable tracts), this re-entered `runFinalStepToCompletion` → `moveIsolatedTracts` again → infinite loop → tab crash.
- ✅ **FIXED:** When `totalIsolated > 0`, stop play instead of re-entering: call `pauseSteps()`, clear loading state, set `finalStepPhaseLabel = 'Move isolated tracts (some remaining)'` so the user sees why play stopped. Re-enter only when `totalIsolated === 0` to proceed to the balance phase.
- User confirmed the issue was fixed. Removed all debug instrumentation from `maps-page.component.ts`.
