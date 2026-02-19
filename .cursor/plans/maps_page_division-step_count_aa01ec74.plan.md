---
name: Maps page division-step count
overview: Fix the maps page step indicator so total steps = number of division levels (tree depth) to reach single-district groups—e.g. AZ (9 districts) shows "Step 4 of 4" by using ceil(log2(N)) and mapping backend step index to level.
todos: []
isProject: false
---

# Maps Page: Step Count = Division Levels (Tree Depth)

## Correct semantics (from your example)

For AZ (9 districts), steps are **division levels** (rounds), not raw backend indices:

- **Step 0**: 1 group [1–9]
- **Step 1**: 2 groups (5)/(4)
- **Step 2**: 4 groups (3)/(2), (2)/(2)
- **Step 3**: more splits
- **Step 4**: 9 single-district groups

So **total steps = 4** = number of levels required to divide the initial group into N single-district groups. That is the **depth** of the division tree: **ceil(log2(N))** for N districts (ceil(log2(9)) = 4).

Backend still uses **step indices 0..N-1** (e.g. 0..8 for AZ): each index is one division operation; at step index `s` there are `s+1` district groups. So we need to **map** backend step index → display level, and show **total = ceil(log2(N))** and **current = level** for the current step.

## Formulas

- **Target districts** N = `getExpectedTotalSteps()` (e.g. 9 for AZ).
- **Display total steps** = `ceil(log2(N))` (e.g. 4 for AZ).
- **Display current step** = level at current backend step:
  - At backend step index `s`, number of groups = `s + 1` (or `currentStep.districtGroups.length`).
  - Level = `ceil(log2(numGroups))`, so **display step = ceil(log2(currentStepIndex + 1))** (or use `currentStep.districtGroups.length` when available).

Examples for AZ (N=9, total=4):


| Backend index | Groups | Display step |
| ------------- | ------ | ------------ |
| 0             | 1      | 0            |
| 1             | 2      | 1            |
| 2             | 3      | 2            |
| 3             | 4      | 2            |
| 4             | 5      | 3            |
| …             | …      | …            |
| 8             | 9      | 4            |


## Implementation

1. **In [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)** (near `getTotalSteps()` / ~1376):
  - **getDisplayTotalSteps()**: return `Math.max(0, Math.ceil(Math.log2(N)))` where `N = this.getExpectedTotalSteps()` (or 1 if 0 to avoid log(0)). For N=1 (single-district state) return 0 so we don’t show "Step 0 of 0"; handle that in the template if needed.
  - **getDisplayStepIndex()**: return the level for the current step. Use `numGroups = this.currentStep?.districtGroups?.length ?? (this.currentStepIndex + 1)`; then `Math.min(this.getDisplayTotalSteps(), Math.max(0, Math.ceil(Math.log2(numGroups))))` so we never exceed total and we handle step 0 (1 group → level 0).
2. **In [maps-page.component.html](frontend/src/app/pages/maps-page.component.html)** (step indicator, lines 216–217):
  - Replace  
   `Step {{ currentStepIndex }} of {{ getTotalSteps() }}`  
   with  
   `Step {{ getDisplayStepIndex() }} of {{ getDisplayTotalSteps() }}`.
  - Keep the `*ngIf="getTotalSteps() > 0"` (or use `getDisplayTotalSteps() > 0`) so the " of X" part is hidden when there are no division steps.
3. **Edge cases**:
  - N=1 (e.g. WY, VT, AK, etc.): total = 0; show only "Step 0" and hide " of 0" (already handled by `getDisplayTotalSteps() > 0`).
  - Leave **navigation and internal logic unchanged**: `getTotalSteps()` still returns the raw count (e.g. 9) for `canGoToLastStep()`, `goToLastStep()`, and the step bar so last backend index remains N-1.

Result: AZ shows "Step 4 of 4" when complete; intermediate steps show the correct level (e.g. "Step 2 of 4"). Single-district states show "Step 0" with no " of X".