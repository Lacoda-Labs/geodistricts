# 260308

## 1620 remove blue division lines show red only

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

[Plan: Remove blue draggable lines; show only red division lines (option 1 & 2)]

### Response / actions

Plan: [.cursor/plans/remove_blue_division_lines_show_red_only_d35c698d.plan.md](.cursor/plans/remove_blue_division_lines_show_red_only_d35c698d.plan.md)

✅ **IMPLEMENTED** in [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) and [frontend/src/app/pages/maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss):

- Division button now calls only `renderDivisionLines()` (removed `updateDivisionLineAndLabels()`). Removed final `updateDivisionLineAndLabels()` from `updateSliderHighlightOnLayers()` and `removeDivisionLineControls()` from `clearSliderHighlight()`.
- Deleted blue-line feature: `updateDivisionLineAndLabels`, `updateDivisionLinesForMultipleDgs`, `removeDivisionLineControls`, `updateDivisionLinePositionOnly`, `applyDivisionLinePosition`, `applyDivisionLinePositionForDg` (and their drag handlers).
- Removed unused state: `divisionLineDragHandle`, `divisionLineLabelNorth/South`, `divisionLineDragging`, `divisionLineControlsByDg`, `sortSliderValueByDgIndex`, `sliderPositionLineLayer`; removed `sortSliderValueByDgIndex` reset and obsolete comment in `clearDivisionLines()`.
- Removed dead CSS: `.division-line-handle`, `.division-line-label`, `.division-label`, `.division-label-first`, `.division-label-second` from maps-page.component.scss.

With "Show division lines" on, only red dashed division lines (Phase 1/2) are shown; no blue polylines or handles. Verification: Step 1 → 1 red line, Step 2 → 3, Step 3 → 7.
