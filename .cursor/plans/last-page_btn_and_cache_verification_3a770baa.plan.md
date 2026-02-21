---
name: Last-page btn and cache verification
overview: Fix the last-page button by loading the final step from the backend when it is not already in loadedSteps, and add backend verification that all steps are cached when the algorithm run completes (final step path).
todos: []
isProject: false
---

# Last-page button fix and final-step cache verification

## 1. Why the last-page button doesn't work

- **Behavior:** The "last page" (last step) button calls `[goToLastStep()](frontend/src/app/pages/maps-page.component.ts)` in the maps page. That method uses `getTotalSteps() - 1` as `lastIndex`; `getTotalSteps()` returns `Math.max(this.totalSteps, loaded, expected)` so the total can be the **expected** count (e.g. 53 for CA) even when only step 0 (or a few steps) have been loaded.
- **Bug:** If the user has not yet navigated to the final step, `loadedSteps[lastIndex]` is `undefined`. The code then falls back to "highest loaded step" and never fetches the final step from the backend, so the button either does nothing or only moves to the highest index already in memory.
- **Root cause:** When the last step is not in `loadedSteps`, the code does not call the API to load it (unlike `previousStep()`, which calls `getStep()` when the previous step is missing).

## 2. Fix: Load final step when last step is not in `loadedSteps`

**File:** [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)

- In `goToLastStep()` (around lines 2210–2247), when `loadedSteps[lastIndex]` is falsy:
  - Do **not** only "go to highest loaded step."
  - Call `this.geodistrictService.getFinalStep(this.selectedState)` (same API used on initial load at line 1205).
  - On success: set `loadedSteps[lastIndex] = data`, `currentStepIndex = lastIndex`, `currentStep = data`, update `totalSteps` if needed, clear isolation/selection state, then call `renderFinalDistricts()`.
  - Optionally set a short loading state (e.g. `isLoading` / `loadingMessage`) while the request is in flight.
  - On error: set `errorMessage` and leave position unchanged.
- Keep the existing "already at last step" and "step already in memory" early returns; only add the fetch path when the last step is not loaded.
- Ensure `canGoToLastStep()` remains correct: it already uses `getTotalSteps()` and `currentStepIndex < total - 1`, so it will stay enabled when we are not on the last step (even if that step is not yet in `loadedSteps`).

This mirrors the pattern used in `previousStep()` (requesting the step via `getStep()` when it is not in `loadedSteps`) and reuses the existing `getFinalStep()` API.

---

## 3. Confirm all steps cached when final step runs (backend)

**Current behavior:** In the run-all path in [backend/index.js](backend/index.js), `onStepComplete` is invoked for each **division** step (iterations 1 through N). Each call writes one step to Firestore (`step_${state}_${stepNumber}_${currentVersion}`). Step **0** is never passed to `onStepComplete` in this path (it is only in the in-memory `result.steps`). After the algorithm returns, the handler marks the **final** step document with `isComplete: true` (lines 3158–3168) and does not verify that every step 0..N-1 was successfully written.

**Goal:** When the algorithm run completes (final steps path), confirm that all steps that should be cached are present before (or when) marking the final step complete.

**Options:**

- **A. Verify after algorithm completes:** After `executeGeodistrictAlgorithm` returns and before (or after) marking the final step as complete, verify that step documents exist for indices **1** through `result.steps.length - 1` (run-all does not currently cache step 0 in `onStepComplete`). Use existing `getStepCacheEntry(state, stepNum, maxIterations)` (or equivalent Firestore read with `step_${state}_${stepNum}_${currentVersion}`). If any step is missing, log a clear warning and optionally do not set `isComplete: true` on the final step until the gap is resolved (or retry caching for that step).
- **B. Cache step 0 in run-all and verify 0..N-1:** In the algorithm service, call `onStepComplete(0, step0, true)` after creating step 0 (so run-all also caches step 0). Then in the route handler, after the algorithm completes, verify that steps 0 through `result.steps.length - 1` exist in Firestore; if any are missing, log and optionally avoid marking final as complete.

**Recommendation:** Implement **A** first (verify steps 1..N-1) with a simple loop and `getStepCacheEntry`; log a warning for any missing step and still mark the final step complete so behavior is backward compatible. Optionally add a follow-up to cache step 0 in run-all (B) so "all steps" truly includes step 0.

**Concrete steps:**

- In [backend/index.js](backend/index.js), immediately after `logger.info(\`✅ Algorithm completed...)` (around 3155) and before "Mark final step as complete in cache":
  - Loop `stepNum` from 1 to `result.steps.length - 1`.
  - For each, call `getStepCacheEntry(state, stepNum, maxIterations)` (or the same key format used by `onStepComplete`: `step_${state}_${stepNum}_${currentVersion}`).
  - If any step is missing, log: e.g. `logger.warn(\`⚠️ Step ${stepNum} not found in cache after algorithm completion)` and optionally collect missing indices.
  - After the loop, optionally log a single summary: e.g. "All steps 1..N verified in cache" or "Missing step indices: ...".
- Then proceed with the existing "Mark final step as complete in cache" block.

No change to the algorithm service is strictly required for verification; only the route handler needs the verification loop. Caching step 0 in run-all can be a separate change if desired.

---

## Summary


| Item               | Location                                                                                 | Change                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last-page button   | [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) `goToLastStep()` | When `loadedSteps[lastIndex]` is missing, call `getFinalStep(selectedState)`, then assign to `loadedSteps`, update `currentStepIndex`/`currentStep`, and render. |
| Cache verification | [backend/index.js](backend/index.js) run-all handler after algorithm completes           | Loop steps 1..result.steps.length-1, call `getStepCacheEntry` for each, log warning for any missing step and a short summary.                                    |


