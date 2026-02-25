# 260224

## 2253 play final step move balance and completion flow

### Prompt

when play button is clicked, also run move isolated tracts until no more moves possible, then run balance tracts until no more balancing is possible (i.e. all district variances within tolerance or no significant consecutive improvement, which should then trigger creating union polygons job and calc party percentages job. add labels for move and balance action requests and when state geodistricting is complete.

### Response / actions

✅ **IMPLEMENTED**: Play-at-final-step completion flow and phase labels.

- **playSteps()**: When at final step (`atFinalStepForPlay`), calls `runFinalStepToCompletion()` instead of `nextStep()`. Added private getter `atFinalStepForPlay` (final step = all single-district groups) so the flow runs on both `/maps` and `/dev/maps` (no `isDevMode` requirement).
- **runFinalStepToCompletion()**: Runs move isolated until `totalIsolated === 0`, then balance until `noMoreBalancingPossible`, then `triggerPolygonsForAllMissing()` and `triggerDistrictPartyIfNeeded()`, then pauses and shows "State geodistricting complete" for 5s. Uses `finalStepPhaseLabel` for "Move isolated tracts" / "Balance tracts" / "State geodistricting complete".
- **moveIsolatedTracts(onSuccess?, onError?)** and **balanceDistrictsAfterIsolated(onSuccess?, onError?)**: Added optional callbacks for chaining; early return when no isolated data calls `onSuccess({ isolationResult: { totalIsolated: 0 } })` so play continues to balance.
- **Template**: Phase label shown when `finalStepPhaseLabel` is set; SCSS for `.final-step-phase-label`.

**Follow-up fixes:**

- **Play not calling move**: Switched play to use `atFinalStepForPlay` instead of `isFinalStepActive` so completion flow runs when not in dev mode; ensured move’s early return invokes `onSuccess` so flow proceeds.
- **Play stops after isolated tract detection**: (1) **onStepDisplayComplete()**: When `!canGoToNextStep()` and `atFinalStepForPlay`, call `runFinalStepToCompletion()` instead of `pauseSteps()`. (2) **Final step waits for detection**: In the next-step handler, when the received step is the final step, call `detectIsolatedTracts(onComplete)` and only in `onComplete` run `renderFinalDistricts()` and `onStepDisplayComplete()`, so isolation data is set before the completion flow runs. (3) **detectIsolatedTracts(onComplete?)**: Added optional callback invoked on success/error; persist `currentStep.isolatedTractsData` from detection result so move has step data.
