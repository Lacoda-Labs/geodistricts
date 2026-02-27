# 260226

## Maps party data and district list (All-states + Party column)

### Prompt

public site (GCP) /maps page for All states not showing geodistricts party data for states with completed geodistricts. also, when state selected, the district list shows next column. replace the next column with party.

Then: Implement the plan as specified. Do NOT edit the plan file itself. Mark to-dos in progress and complete.

### Response / actions

Plan: Maps Page: All-States Party Data and District List Party Column (maps_party_data_and_district_list_cf8f858a.plan.md)

✅ **IMPLEMENTED** (all plan to-dos completed):

- **All-states table:** Extended `getStateData()` to derive geodistricts D/R and swing from `allStatesDistrictPartyByState` when `statePartySummaries` and `stateComparison` lack data. Updated `getStateRowData()` and `getUSRowData()` so `hasGeodistrictsPartyData` is true when either summaries or `allStatesDistrictPartyByState` has data for the state. Table now shows GeoDistricts party data for completed states once map district-party fetches finish, even when `GET /api/maps/state-party-summaries` is empty on GCP.

- **District list:** Removed the "Next" column (header and cell). Party column is always visible (no `isDevMode` guard). Added `getGroupPartyDisplayText(group)` (D xx% · R yy% or "–") and `showPartyStatusIcon(i)` for dev status icons. Party cell shows percentage from `districtPartyByGroupKey` when at final step, or "–"; in dev mode, in_progress/fail/missing show status icons and click-to-calc unchanged. Removed unused `.next-division-cell` / `.next-division-icon` SCSS.

Files: `frontend/src/app/pages/maps-page.component.ts`, `maps-page.component.html`, `maps-page.component.scss`.
