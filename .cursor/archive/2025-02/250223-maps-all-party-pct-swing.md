# 250223

## 1500 maps All view party % and swing

### Prompt

on maps page, when "All" states are selected, for states that have party % calculated for completed geodistricts show the precentage total for the state and update swing column.

### Response / actions

✅ **IMPLEMENTED**:

- **Backend** ([backend/index.js](backend/index.js)): Added `GET /api/maps/state-party-summaries`. Lists `district_party_*` cache docs, aggregates per state to vote-share (pctDem, pctRep), seat counts (geodistrictsD/R from pctDem ≥ 0.5), and swing (geodistrictsD − congressD). Returns `{ summaries: { stateCode: { pctDem, pctRep, geodistrictsD, geodistrictsR, swing } } }`.
- **Frontend** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): Fetch state-party-summaries in `ngOnInit`; store in `statePartySummaries`. `getStateData()` uses party summary for geodistricts and swing when present; `getStateRowData()` passes `geodistrictsPctDem` / `geodistrictsPctRep` for states with party data.
- **State row** ([frontend/src/app/components/state-row.component.ts](frontend/src/app/components/state-row.component.ts), [state-row.component.html](frontend/src/app/components/state-row.component.html)): Extended `StateRowData` with optional `geodistrictsPctDem` / `geodistrictsPctRep`. GeoDistricts column shows seat counts and, when party % is available, state-level percentages in parentheses (e.g. D: 3 (52.1%)). Swing column shows party-based swing when summary exists.

Result: When "All" is selected, states with district party % calculated show state-level D/R percentages and swing from party data; others unchanged.
