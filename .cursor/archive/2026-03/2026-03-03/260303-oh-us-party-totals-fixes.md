# 260303

## 1600 OH and US row party totals fixes

### Prompt

OH party totals are incorrect for GeoDistricts after completion.

[Follow-up] US (137) should be US (435) showing total number of congressional districts for US (like the state rows). Also, the GeoDistricts totals for US row are 0 but should be totals of all completed states. and swing should be total of swing-column for all completed states.

### Response / actions

- **OH party totals:** Backend `GET /api/maps/state-party-summaries` was choosing the district_party doc with the highest step number per state. For Ohio, a higher-step doc with only one district (e.g. step 0 with one "1-15" group) was selected over a complete 15-district doc. ✅ **FIXED**: In `backend/index.js`, selection now prefers a doc whose district count (D+R) equals the state’s expected districts (`CONGRESSIONAL_DISTRICTS_BY_STATE`). When step numbers tie, the complete doc wins; otherwise higher step still wins.
- **US (435):** US row was showing `usMapTotalDistricts` (137) when "All" was selected. ✅ **FIXED**: `getUSRowData()` in `frontend/src/app/pages/maps-page.component.ts` now always uses `districtCount = 435` for the US row.
- **US GeoDistricts totals and swing:** US row used `stateComparison?.us` only, which could be zero. ✅ **FIXED**: `getUSData()` now computes US GeoDistricts D/R and US swing by summing each state’s values from `getStateData()` over `this.states` (completed states contribute their totals, others 0).
