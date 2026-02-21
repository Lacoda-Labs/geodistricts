# 260221

## VEST party % Firestore persistence and dev/maps status UI

### Summary

Implemented the full plan: tract-level party % from VEST persisted in Firestore; district-level party % job at final step; final-step response extended with per-DG polygon/party status; single-DG polygon and party endpoints; dev/maps summary and district table (Polygon/Party columns, variance tooltip, click-to-trigger); optional tract coloring by party %.

### Backend

- **Tract-level party %:** `STATE_FIPS_TO_CODE`, `loadTractPartyForState(state, year)`, `runTractPartyPersistenceJob(year)`. Firestore docs `tract_party_{state}_{year}` (or Cloud Storage when >1MB). `POST /api/algorithm/tract-party-persistence` (body `year`), `GET /api/algorithm/tract-party/:state/:year`.
- **District-level party %:** `loadDistrictPartyForStep()`, `runDistrictPartyJob()`. Doc `district_party_{state}_{step}_{maxIterations}`. `POST /api/algorithm/district-party/:state`, `GET /api/algorithm/district-party/:state/:stepNumber`.
- **Final-step status:** GET final-step now returns `unionPolygonsCached`, `districtPartyPercentagesCalculated`, `perGroupStatus` (polygon/party done|missing per DG), `maxIterations`.
- **Single-DG:** `POST /api/algorithm/district-party-for-group/:state`, `POST /api/algorithm/step/:state/:stepNumber/union-polygon-for-group` (query `groupKey`, `maxIterations`).
- **Cloud Storage:** `tract_party_*` key → `tract-party/{state}/{year}.json` in `cloud-storage-cache.js`.

### Frontend

- **Types:** `PerGroupStatus`, `FinalStepResponse`; `getFinalStep()` returns extended response. New methods: `triggerDistrictPartyJob`, `triggerDistrictPartyForGroup`, `triggerUnionPolygonForGroup`, `getTractParty`.
- **loadVisualizationState:** Stores status fields; when final step complete and party % missing, triggers district party job then refetches after 3s.
- **Dev/maps summary:** Union polygons and Party % status text; "Color by party %" / "District colors" toggle.
- **District table (dev):** Polygon and Party columns with status icons (done/missing/fail/in_progress), tooltips, click on missing/fail to run single-DG endpoint. Population column removed. Variance column has tooltip "DG population / Target DG population".
- **Tract coloring by party %:** `showPartyColor`, `tractPartyByGeoid`, `getTractColorByParty(pctDem)` (red ↔ light gray ↔ blue), `togglePartyColor()` fetches tract party and toggles; in `renderFinalDistricts()` tract fill uses party color when enabled.

### Files

- `backend/index.js` — tract/district party persistence, final-step status, single-DG endpoints.
- `backend/services/cloud-storage-cache.js` — `tract_party_*` path.
- `frontend/src/app/services/geodistrict-algorithm.service.ts` — FinalStepResponse, PerGroupStatus, new API methods.
- `frontend/src/app/pages/maps-page.component.ts` — status state, summary/table helpers, party color toggle and styling.
- `frontend/src/app/pages/maps-page.component.html` — summary section, district table columns, party color button.
- `frontend/src/app/pages/maps-page.component.scss` — district-status-summary, status-icon styles.
