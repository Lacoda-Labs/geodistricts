# 260312

## 0049 maps party data production diagnosis

### Prompt

see browser tab with https://geodistricts.org/maps loaded. the map is not showing party data for state or geodistricts. is the local server accessing VEST data locally and the GCP environment unable to access VEST data? or is there some other explanation?

### Response / actions

Plan: [.cursor/plans/maps_party_data_diagnosis_4d01ef79.plan.md](.cursor/plans/maps_party_data_diagnosis_4d01ef79.plan.md)

Diagnosis (plan mode, no code changes): Traced two data paths—(1) **State-level party** from `GET /api/maps/state-comparison` (119th fallback via `backend/data/congress-119-party.json`); (2) **Geodistricts party** from tract-party (VEST) → district_party cache → state-party-summaries / district-party API. Concluded: **Geodistricts** on GCP is expected to be missing unless tract-party and district-party are pre-populated in Firestore/GCS (VEST and persistence are run locally). **State (119th)** should work if state-comparison returns 200; if not showing, possible causes are state-comparison 5xx (e.g. congress-119-party.json path in image), timing (map painted before state-comparison arrives), or CORS/API URL. Created plan with verification steps and optional frontend re-render when state-comparison arrives.
