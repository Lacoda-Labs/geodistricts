# 260218

## 1600 maps page division-step count

### Prompt

/archive

### Response / actions

Chat archived.

---

Earlier in the session: user reported maps page showed "Step 4 of 9" for AZ (completed state); wanted total steps to reflect only division steps to reach target districts. User clarified that for AZ (9 districts) total should be 4 (division levels / tree depth): Step 0 = 1 group, Step 1 = 2 groups, Step 2 = 4 groups, Step 3 = more splits, Step 4 = 9 single-district groups. Plan: [.cursor/plans/maps_page_division-step_count_aa01ec74.plan.md](.cursor/plans/maps_page_division-step_count_aa01ec74.plan.md)

✅ **IMPLEMENTED**:

- **maps-page.component.ts**: Added `getDisplayTotalSteps()` (returns `ceil(log2(N))` for N target districts; 0 when N ≤ 1) and `getDisplayStepIndex()` (level from `currentStep.districtGroups.length` or `currentStepIndex + 1`, clamped to display total). Left `getTotalSteps()` unchanged for navigation/step bar.
- **maps-page.component.html**: Step indicator now shows `Step {{ getDisplayStepIndex() }} of {{ getDisplayTotalSteps() }}`; " of X" only when `getDisplayTotalSteps() > 0`. AZ now shows "Step 4 of 4" when complete; single-district states show "Step 0" with no " of X".
