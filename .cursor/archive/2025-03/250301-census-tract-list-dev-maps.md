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
