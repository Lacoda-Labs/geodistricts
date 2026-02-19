---
name: Maps page division-step count
overview: Fix the maps page step indicator so the total shows only division steps (e.g. AZ shows "Step 8 of 8" instead of "Step 8 of 9") by adding a display-only total that excludes the initial state step.
todos: []
isProject: false
---

# Maps Page: Show Division Steps Only in Step Indicator

## Problem

On the maps page, the step indicator shows **"Step X of N"** where N is the full backend step count (initial state + all divisions). For example, Arizona (9 districts) shows **"Step 4 of 9"** (or "Step 8 of 9" when completed). The total should count only **division steps** to reach the target number of districts: for N districts that is **N - 1** divisions (step 0 is the initial state, steps 1..N-1 are the divisions). So AZ should show **"Step X of 8"**.

## Root cause

- Backend (and [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)) use **step indices 0..N-1** for N districts: index 0 = initial state, indices 1..N-1 = division steps.
- [getTotalSteps()](frontend/src/app/pages/maps-page.component.ts) (lines 1373–1376) returns the full count: `Math.max(this.totalSteps, loaded, expected)` (e.g. 9 for AZ).
- The template [frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html) (lines 216–217) displays:  
`Step {{ currentStepIndex }} of {{ getTotalSteps() }}`.

So the displayed total is one too large because it includes the initial state.

## Approach

- **Do not change** `getTotalSteps()`. It is used for **navigation** (e.g. [canGoToLastStep()](frontend/src/app/pages/maps-page.component.ts), [goToLastStep()](frontend/src/app/pages/maps-page.component.ts)) and for the step bar; the last step index must remain `getTotalSteps() - 1` (e.g. 8 for AZ).
- Add a **display-only** total that counts only division steps, and use it only in the step label.

Same pattern is already used elsewhere:

- [state-map-page.component.ts](frontend/src/app/pages/state-map-page.component.ts): `getTotalDivisionSteps(): Math.max(0, this.divisionSteps.length - 1)` and template shows "Step {{ getDisplayStepNumber() }} of {{ getTotalDivisionSteps() }}".
- [geodistrict-viewer.component.ts](frontend/src/app/components/geodistrict-viewer.component.ts): `getTotalDivisionSteps(): Math.max(0, this.algorithmResult.steps.length - 1)`.

## Implementation

1. **Add `getDisplayTotalSteps()` in [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)**
  - Place it next to `getTotalSteps()` (after line 1376).  
  - Return `Math.max(0, this.getTotalSteps() - 1)` so the displayed total is “division steps only” (e.g. 8 for AZ).
2. **Update [maps-page.component.html](frontend/src/app/pages/maps-page.component.html)**
  - In the step indicator (lines 216–217), change  
   `of {{ getTotalSteps() }}`  
   to  
   `of {{ getDisplayTotalSteps() }}`.  
  - Keep `Step {{ currentStepIndex }}` unchanged so the current position still runs 0..N-1 (e.g. “Step 8 of 8” when on the final step).

Result: for a state with N districts, the label will show “Step 0 of (N-1)” … “Step (N-1) of (N-1)” (e.g. “Step 8 of 8” for AZ when complete), while navigation and step bar logic continue to use the full step count internally.