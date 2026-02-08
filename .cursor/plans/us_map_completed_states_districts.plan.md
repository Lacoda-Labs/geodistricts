# US Map: Completed States' Districts + Click District to Switch State

## Overview
1. **US view**: Show district boundaries only for states with a completed final step; when all 50 states are complete, display 435 districts.
2. **Click behavior**: When the user clicks on a district on the US map, switch the view to that district's state (select that state and show the state-level map).

---

## Part 1: US Map Shows Only Completed States' Districts (435 When All Done)

*(Summary of prior plan.)*

- **Load**: When `selectedState === 'ALL'`, call backend to get list of states with final step, then fetch final-step data for each; render their district union polygons on the map with a global district index (colors 1..435 when all complete).
- **US row**: Show total districts = sum of completed states' districts (435 when all done).
- **State table**: Show all states; completed ones show GeoDistricts count, others show "—" or prompt.

---

## Part 2: Click District → Switch to That State

### Behavior
- **Context**: User is on US view (`selectedState === 'ALL'`); map shows districts for completed states.
- **Action**: User clicks on a district polygon (or its popup/layer).
- **Result**: Map switches to **single-state view** for the state that contains that district:
  - Set `selectedState` to that state's code (e.g. `'CA'`, `'TX'`).
  - Call `onStateChange()` so the map re-initializes and runs the algorithm for that state (loading final step or step 0).
  - User sees the selected state's map with all its districts (and can use step slider, etc., as in current state view).

### Implementation

**Where districts are rendered (US view)**  
In `renderUSMapDistricts(completedStatesData)`, each district is drawn as a Leaflet GeoJSON layer and added to `tractLayer`. Each layer corresponds to one state and one district group.

**Data needed on click**  
When building the layer, we already have:
- `stateCode` (from the loop over `completedStatesData`)
- `districtGroup` (e.g. `startDistrictNumber`, `endDistrictNumber`)

**Steps**  
1. **Store state per layer**: When adding each district layer in `renderUSMapDistricts()`, attach the state code (and optionally district index) to the layer so the click handler can read it. Options:
   - Use Leaflet's `layer.options` or a custom property (e.g. `(layer as any).stateCode = stateCode`), or
   - Bind state (and district) in the closure of the click handler.
2. **Add click handler to each US district layer**: When creating `L.geoJSON(unionPolygon, { ... })`, add an `onEachFeature` (or listen on the layer after creation) that calls:
   - `layer.on('click', () => { this.selectStateFromDistrict(stateCode); })`
3. **New method `selectStateFromDistrict(stateCode: string)`**:
   - Set `this.selectedState = stateCode`.
   - Call `this.onStateChange()`.  
   This reuses existing logic: persist to localStorage, clear layers, re-init map, and run `runAlgorithm()` for the selected state.
4. **Optional**: Show cursor pointer on hover for US district layers so it’s clear they are clickable (e.g. set cursor in layer style or in `onEachFeature`).

**Files**  
- [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts):  
  - In `renderUSMapDistricts()`, when adding each district GeoJSON layer, attach `stateCode` to the layer and add a `click` listener that calls `selectStateFromDistrict(stateCode)`.  
  - Add `selectStateFromDistrict(stateCode: string)` that sets `selectedState = stateCode` and calls `onStateChange()`.

**Edge cases**  
- Popup: Existing popup can stay; clicking the polygon (or popup) should still trigger the switch. If the popup has a "View state" link, it can also call `selectStateFromDistrict(stateCode)`.
- Double-click / zoom: If Leaflet’s default double-click zoom interferes, ensure only the click handler runs for the district layer (no need to change default map behavior unless desired).

---

## Summary of code changes (combined)

| Area | Change |
|------|--------|
| Backend | Optional: GET `/api/algorithm/final-step-states` returning `{ stateCodes: string[] }`. |
| MapsPage | `loadUSMapDistricts()`, `renderUSMapDistricts(completedStatesData)`, wire to US view init and `onStateChange`. |
| MapsPage | In `renderUSMapDistricts()`, for each district layer: set `stateCode` on layer and `layer.on('click', () => this.selectStateFromDistrict(stateCode))`. |
| MapsPage | `selectStateFromDistrict(stateCode: string)`: set `selectedState = stateCode`; call `onStateChange()`. |
| MapsPage | US row district count = sum of completed states; state rows show completion. |
| Service (optional) | `getFinalStep(state)` for fetching final step in US view. |
