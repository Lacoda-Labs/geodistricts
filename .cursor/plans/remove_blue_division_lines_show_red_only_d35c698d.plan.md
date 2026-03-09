---
name: Remove blue division lines show red only
overview: Remove the old blue draggable division lines (sort-visualization feature) and ensure the red dashed division lines (Phase 1/2 shared-border lines) are the only division lines shown when the toggle is on, with clear verification steps.
todos: []
isProject: false
---

# Remove blue draggable lines; show only red division lines (option 1 & 2)

## 1. What the blue lines are

The **blue lines with blue dots** are the old "sort visualization" feature in [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts):

- `**updateDivisionLineAndLabels()`** (single DG) and `**updateDivisionLinesForMultipleDgs()`** (multiple DGs) draw blue polylines (`color: '#1976d2'`), one per district group, at the current "split" position (derived from `sortSliderValue` / `sortSliderValueByDgIndex`).
- They add a **draggable handle** (blue circle) and **population labels** (N/W and S/E) so the line doubles as the control for the split position.
- These are the only layers using `sliderPositionLineLayer`, `divisionLineDragHandle`, `divisionLineLabelNorth/South`, and `divisionLineControlsByDg`.

So the blue lines are exactly the "old feature that attempted to visualize sorting" and are safe to remove as a unit.

## 2. Why the red lines (option 1 & 2) are not visible

- When "Show division lines" is toggled on, the code runs **both** `renderDivisionLines()` and `updateDivisionLineAndLabels()` (see division button handler around 596–598).
- `**renderDivisionLines()`** clears `divisionLineLayers`, then adds the **red** dashed lines (Phase 1 clipped / Phase 2 shared boundary) via `addStaticDivisionLinesForStep` and `animateCurrentStepDivisionLines`. For the **current** step, `animateCurrentStepDivisionLines` runs **asynchronously** (about 1.5s).
- `**updateDivisionLineAndLabels()`** then runs and draws the **blue** lines and handles on top.
- So you see 2–3 blue lines immediately; the red line(s) for the current step appear only after the animation, and can be hidden or hard to notice under/next to the blue lines.

So the red lines are implemented and run; they are just overshadowed by the blue ones and (for the current step) delayed by animation.

## 3. How the red lines (option 1 & 2) work and how to verify

- **What they are:** Red dashed polylines (`color: '#ff0000'`, `weight: 2`, `dashArray: '10, 5'`) drawn by `createStaticDivisionLine` and `createAnimatedDivisionLine`, using `getDivisionLineCoordinates()` (Phase 1: clipped to sibling bounds; Phase 2: shared boundary from union polygons when available).
- **When they are drawn:** Only when "Show division lines" is on, inside `renderDivisionLines()`:
  - For **previous steps** (stepIdx < current): static red lines via `addStaticDivisionLinesForStep`.
  - For **current step**: static red lines on the final step, or **animated** red line(s) on intermediate steps (e.g. Step 1).
- **Expected counts:** Step 1 → 1 red line; Step 2 → 3 red lines; Step 3 → 7 red lines (cumulative splits).
- **How to verify after removing blue:**
  1. Clear cache, load TX, go to Step 0, then Next to Step 1. Turn "Show division lines" on (grid/lines button on the map).
  2. You should see **one** red dashed line between the two district groups (and no blue lines).
  3. Advance to Step 2: **three** red dashed lines; Step 3: **seven** red dashed lines.
  4. Red lines follow the sibling boundary (clipped straight line or, when union data exists, the actual shared boundary).

## 4. What to remove (blue lines and related code)

Remove only code that exists to draw or control the blue draggable lines. Do not remove `divisionLineLayers` / `divisionLinesByStep` or the red-line logic (createStaticDivisionLine, createAnimatedDivisionLine, getDivisionLineCoordinates, getSharedBoundaryFromUnions, getBoundsForGroupInStep, etc.).

**Remove or stop calling:**


| Item                                                                                   | Action                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateDivisionLineAndLabels()`                                                        | Delete method body and all call sites, or delete entire method and remove every call.                                                           |
| `updateDivisionLinesForMultipleDgs()`                                                  | Delete entire method.                                                                                                                           |
| `removeDivisionLineControls()`                                                         | Delete method. Remove all call sites (toggle path, `clearSliderHighlight`, and inside the now-deleted `updateDivisionLineAndLabels`).           |
| Blue line/handle/label creation                                                        | Removed as part of the two methods above (no more `L.polyline` with `#1976d2`, no more `division-line-handle` / `division-line-label` markers). |
| Drag handlers that call `applyDivisionLinePosition` / `applyDivisionLinePositionForDg` | Removed with the methods that add the blue line and handle (so nothing will call these anymore).                                                |
| `applyDivisionLinePosition`, `applyDivisionLinePositionForDg`                          | Can be removed as dead code after the above (only callers were the blue-line drag handlers).                                                    |
| `updateDivisionLinePositionOnly`                                                       | Only used by the blue-line drag logic; remove or leave as no-op.                                                                                |


**Keep but change:**


| Item                                             | Change                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Division button click handler (591–599)          | Call only `component.renderDivisionLines()`. Remove the `component.updateDivisionLineAndLabels()` call. |
| `updateSliderHighlightOnLayers()`                | Remove the final `this.updateDivisionLineAndLabels()` call so it only updates tract highlight styles.   |
| `clearSliderHighlight()`                         | Remove the `this.removeDivisionLineControls()` call (only clears blue controls; no longer needed).      |
| `onStepDisplayComplete` (or wherever 3367 lives) | Remove the `this.updateDivisionLineAndLabels()` call.                                                   |


**State to remove or leave unused:**

- `sliderPositionLineLayer`, `divisionLineDragHandle`, `divisionLineLabelNorth`, `divisionLineLabelSouth`, `divisionLineDragging`, `divisionLineControlsByDg`, `sortSliderValueByDgIndex` – only used by the blue line/handle/labels and their drag logic. Can be removed or left as unused; removing keeps the file clearer.
- `sortSliderValue` and the tract highlight in `updateSliderHighlightOnLayers` – optional: keep if you want a static “split position” tract highlight at midpoint; otherwise the slider value and highlight can be removed in a follow-up.

**Scoped change:** All edits in [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (and any map control setup that calls the removed methods). Template references to `currentStep.divisionLines` are for **Balance districts** and similar (step data from backend); do not remove those. CSS for `.division-line-handle` and `.division-line-label` in [maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss) can be removed or left; removing avoids dead styles.

## 5. Verification checklist (after implementation)

- With "Show division lines" on and no blue lines: Step 1 shows 1 red dashed line; Step 2 shows 3; Step 3 shows 7.
- No blue polylines or blue circle markers on the map when the toggle is on.
- Balance districts / Move isolated tracts still work (they depend on `currentStep.divisionLines` from the backend, not on the removed UI).
- Optional: confirm in browser dev tools that only red division line layers are added when the toggle is on.

