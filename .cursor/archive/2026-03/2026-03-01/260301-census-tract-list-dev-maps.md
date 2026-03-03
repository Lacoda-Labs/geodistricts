# 250301

## 1200 census tract list on dev/maps info-body

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/census_tract_list_dev_maps_fde33d4f.plan.md](.cursor/plans/census_tract_list_dev_maps_fde33d4f.plan.md)

✅ **IMPLEMENTED**: Census tract list on /dev/maps info-body per plan.

- **TS**: Added `stateCodeToFips` map and `getStateFips(stateCode)`; getter `tractsByCountyForList` (step 0 only, flatten/dedupe by tract ID, group by county FIPS, chunk every 100); `getTractPolygonIcon(tract)` (check_circle / error / info / my_location); `getTractPartyLabel(tract)` (R/D/— from `tractPartyByGeoid`); made `getTractId` public for template.
- **HTML**: State FIPS in `.info-header-state-row` when isDevMode. Step 0: `ng-container` + `.step-0-info-container` (no `step-info-container`), order: `.step-0-isolated-panel` → tract list → rest. Tract list: county accordions (County FIPS: XXX) → chunk accordions (Tracts 1–100, …) → table (Tract ID, Population, Polygon icon, Party). Steps 1+: unchanged `step-info-container` block, no tract list.
- **SCSS**: `.step-0-info-container` (same layout as step-info-container); `.info-header-state-fips`; `.tract-list-dev` (font-size 10px, compact table).
- Fixed template strict check (`tractsByCountyForList && tractsByCountyForList.length`) and population binding; build passes.

## 1230 tract list header county name pop IN fix

### Prompt

- make .mat-expansion-panel-header-title font-size: 12px
- add county name (if available) and county population
- for IN (FIPS 18) no tract accordian tract list is showing

### Response / actions

✅ **IMPLEMENTED**: SCSS: `.tract-list-dev .mat-expansion-panel-header-title { font-size: 12px }`. TS: `tractsByCountyForList` now returns `countyName` (from first tract `properties.COUNTY`) and `countyPopulation` (sum of tract POPULATION); template shows "County FIPS: XXX — Name (pop. N)". IN fix: normalize county FIPS to 3-digit string (`String(raw).replace(/\D/g, '').padStart(3, '0')`) so numeric COUNTY_FIPS (e.g. Indiana) group correctly.

## 1245 IN tract list still empty step 0 full fetch

### Prompt

still no tracts showing for IN

### Response / actions

✅ **FIXED**: Step 0 was loaded with `polygonsOnly: true`, so backend returned no `censusTracts` and tract list was empty. In dev mode: (1) When loading step 0 via GET (e.g. First in visualization-only), use full step (`getStep(..., undefined)` instead of `polygonsOnly: true`) so response includes censusTracts. (2) When clicking First and `loadedSteps[0]` is missing, fetch step 0 with `getStep(state, 0, 100, undefined)` instead of calling `resetToStart()` so IN (and any state) gets full step 0 with tracts for the list.
