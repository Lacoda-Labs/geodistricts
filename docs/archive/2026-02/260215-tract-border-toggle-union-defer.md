# 260215

## 2245 tract border toggle and defer union polygons

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: tract border toggle (no union polygons until final).

✅ **IMPLEMENTED**:

1. **Frontend** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): In `renderFinalDistricts()`, removed the branch that rendered union polygons when "Show tract boundaries" was off; removed the guard that skipped tract rendering when no unions were available. The map always renders tracts; the toggle only changes border style (show/hide tract borders via `showTractBoundaries`).

2. **Backend createStep** ([backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js)): For steps 1..N, no longer create union polygons; groups return with `unionPolygon`/`unionPolygons` undefined. Step 0 unchanged (TIGER set by caller).

3. **Backend caching** ([backend/index.js](backend/index.js)): Create unions only when caching the final step: `onStepComplete` calls `recreateUnionPolygonsForGroups` only when the step is final (all single-district groups); next-step path calls it only when `isComplete === true`; move-isolated-tracts path calls it before caching. Non-final steps cache without union data; `unionPolygonsCached` is false for them.

All to-dos completed; lints clean.
