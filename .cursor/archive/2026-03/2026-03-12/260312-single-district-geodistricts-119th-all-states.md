# 260312

## 0029 single-district states GeoDistricts match 119th on All states

### Prompt

for states that only have one district, when on All states map, these are correcly disable from selection. however the geodistricts columns should match the 199th column. no need to create final step for these states since there are no steps. instead when on All states adjust totals for each 1 district state to match 119th party, and adjust top US row geodistricts totals accordingly.

### Response / actions

✅ **IMPLEMENTED**: In `maps-page.component.ts`:

1. **`getStateData`** — When `selectedState === 'ALL'` and the state is single-district (`isSingleDistrictState(stateCode)`), return 119th Congress D/R for `source === 'geodistricts'` (from `stateComparison.states[stateCode]`) and `'0'` for `source === 'swing'`, so single-district state rows show GeoDistricts column matching 119th and zero change.

2. **`getStateRowData`** — Extended `hasGeodistrictsPartyData` so single-district states on All states view are treated as having GeoDistricts data when 119th data exists, so their D/R and delta display correctly.

3. **US row** — No code change. `getUSData('geodistricts', …)` already sums `getStateData(…, 'geodistricts', …)` over all states; with the new behavior that sum now includes single-district states’ 119th seats, so the top US row GeoDistricts totals are correct.

Single-district states (AK, DC, DE, ND, SD, VT, WY) remain non-selectable; their GeoDistricts column and the US summary row now reflect 119th party for those states.
