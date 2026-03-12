# 260311

## 2249 party icon tract-party-persistence and state scope

### Prompt

/archive

### Response / actions

Chat archived. Summary of session:

- **Party icon → tract-party-persistence**: Clicking the orange Party warning icon now calls `POST /api/algorithm/tract-party-persistence` (with year 2024), then triggers the district-party job for the state. Added `triggerTractPartyPersistence(year, state?)` in the algorithm service and wired the icon click in maps-page to use it.
- **Why tract-geoids for every state?**: User saw many `GET /api/census/tract-geoids?state=...` requests; clarified these come from the backend job (county→tract allocation in `buildTractDataFromCountyVEST`), not from the frontend.
- **Scope to selected state**: User asked that only the current state (e.g. RI) be run. Implemented optional `state` parameter end-to-end: `buildTractDataFromCountyVEST(year, apiBaseUrl, { stateCode })` in vest-data-loader; `runTractPartyPersistenceJob(year, { apiBaseUrl, state })` in tract-party-persistence; `POST /api/algorithm/tract-party-persistence` accepts body/query `state`; frontend passes `this.selectedState` so only one state is processed and only one tract-geoids call is made (e.g. `GET /api/census/tract-geoids?state=RI`).
