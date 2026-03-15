# 260314

## 2045 maps landing preserve party data

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/maps_party_data_overwrite_fix_60bf128e.plan.md](.cursor/plans/maps_party_data_overwrite_fix_60bf128e.plan.md)

✅ **IMPLEMENTED**: In `applyLandingData()` in `frontend/src/app/pages/maps-page.component.ts`:
- **statePartySummaries**: Only overwrite when the landing payload has non-empty `data.statePartySummaries.summaries`; otherwise leave existing value so the district list keeps data from the initial GET state-party-summaries.
- **allStatesDistrictPartyByState**: Only overwrite when the landing payload has non-empty `data.districtPartyByState`; otherwise preserve existing value for map popups and derived table data.
No backend or GCS changes. Lint clean.
