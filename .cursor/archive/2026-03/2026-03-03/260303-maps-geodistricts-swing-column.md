# 260303

## 1500 maps page GeoDistricts party data and swing column

### Prompt

see browser tab, https://geodistricts.org/maps does not show GeoDistricts party data or swing column delta.

### Response / actions

- **Cause:** GeoDistricts D/R and Swing columns were only shown when `hasGeodistrictsPartyData` was true. That flag was set only from `statePartySummaries` (GET /api/maps/state-party-summaries) or `allStatesDistrictPartyByState` (from All-state district-party fetches). When state-party-summaries was empty and All-state load hadn’t run, columns stayed hidden even though GET /api/maps/state-comparison was already returning the data (including 119th-only fallback with geodistrictsD, geodistrictsR, swing).
- **Change:** Treated `stateComparison` as a source for “we have GeoDistricts party data”: US row uses `stateComparison?.us != null`; state rows use `stateComparison?.states?.[stateCode] != null` in addition to existing checks.
- **File:** `frontend/src/app/pages/maps-page.component.ts` — updated `getUSRowData()` and `getStateRowData()` so GeoDistricts and Swing columns show whenever state-comparison API data is present.

✅ **FIXED**: Maps page at https://geodistricts.org/maps now shows GeoDistricts party data and Swing column delta once state-comparison is loaded.
