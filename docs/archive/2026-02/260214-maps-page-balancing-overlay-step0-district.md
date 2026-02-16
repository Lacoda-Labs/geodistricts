# 260214

## 1530 maps page balancing column, overlay, step 0, district label

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

[Later:] For the code present, we get this error: Object literal may only specify known properties, and 'balancingTractIdsByGroup' does not exist in type ... Fix it, verify, and then give a concise explanation.

[Later:] in district list, when DG has just one district (is complete), change the value in the District column to not be "Districts" but "District"

### Response / actions

Plan: maps page isolated tracts + overlay + step 0 (balancing column, progress label, step 0 single label).

- **Backend**: Added `getBalancingTractIdsForGroup()` in [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js); extended `POST /api/algorithm/detect-isolated-tracts` in [backend/index.js](backend/index.js) to return `balancingTractIdsByGroup`.
- **Frontend**: Service types and detect response include `balancingTractIdsByGroup`; [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) stores it in `isolatedTractsData`, `getIsolatedTractsList()` returns `balancingTractIds` per row; template added "Balancing Tracts" column. Added `loadingMessage`, set to step-specific text when Next is clicked ("Processing Step N - dividing by latitude/longitude..."); overlay binds `{{ loadingMessage }}`. Step 0 block simplified to single "Step 0: Initial State" and one paragraph (no 0.1/0.2).
- **Type fix**: Added `balancingTractIdsByGroup` to the component's inline type for `isolatedTractsData` so assignments type-check.
- **District label**: In district-groups table, when `group.startDistrictNumber === group.endDistrictNumber` show "District X", otherwise "Districts X - Y" ([maps-page.component.html](frontend/src/app/pages/maps-page.component.html)).

✅ **IMPLEMENTED**: Balancing tracts column, next-step progress label on overlay, Step 0 single label, type fix, District vs Districts in list.
