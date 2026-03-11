# 260310

## 2243 dg-header GeoDistricts party data after clear cache and play

### Prompt

why does NJ, after clear cache and play show geodistricts .dg-header columns with no party data, but district list and map show party data?

### Response / actions

- **Cause:** The dg-header uses `getStateData()` / `getStateRowData()`, which only considered `statePartySummaries`, `stateComparison`, and `allStatesDistrictPartyByState`. The district list and map use `districtPartyByGroupKey` (filled when the run completes and district-party is fetched). In single-state view, `allStatesDistrictPartyByState` is never set for the selected state, so the header showed API data (often zeros) while list/map showed live data.
- **Fix in `maps-page.component.ts`:**
  1. **`getStateData()`:** For `geodistricts` and `swing`, prefer live run data: when `stateCode === selectedState` and `districtPartyByGroupKey` has entries, derive D/R and swing from it (same as list/map); otherwise keep using `allStatesDistrictPartyByState` then API fallbacks.
  2. **`getStateRowData()`:** Set `hasGeodistrictsPartyData` true when the row is for the selected state and `districtPartyByGroupKey` has data, so the header doesn’t hide the D/R column.
- ✅ **FIXED:** After clear-cache-and-play on NJ, the dg-header GeoDistricts D/R and Swing now use `districtPartyByGroupKey` and match the district list and map.
