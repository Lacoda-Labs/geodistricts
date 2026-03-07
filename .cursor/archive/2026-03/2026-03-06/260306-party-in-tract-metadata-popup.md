# 260306

## 1530 party in tract metadata and popup

### Prompt

party data should be included with census tract metadata, not fetch separately. here is the data shown leaflet-popup-content:
District 1-38
Tract ID: 950300
Population: 2,311
District Population: 30,157,100
Tracts in District: 6883
Sibling: –
bbox: S=30.7061 N=31.0887 W=-100.9624 E=-100.1152
this should also show party totals. it should returned with census tract data and not be fetched separately.

### Response / actions

✅ **IMPLEMENTED**: Party is now included with census tract metadata and the popup shows party totals; no separate tract-party fetch for the map.

- **Backend (`backend/index.js`):** In `reconstructStepFromCache`, after building the tract lookup, load tract party via `tractPartyPersistence.loadTractPartyForState(requestedState, 2024)`. When building each group’s `censusTracts`, enrich each tract’s `properties` with `pctDem`, `pctRep`, `votesDem`, `votesRep`, `totalVotes` (without mutating cached tract objects). Final-step and any reconstructed step now return tracts with party on `tract.properties`.
- **Frontend (`frontend/src/app/pages/maps-page.component.ts`):** Added `getPartyFromTract(tract)` that prefers `tract.properties` (backend metadata) when `pctDem` is present, with fallback to `tractPartyByGeoid` for older cached steps. Popup and tract fill color use this helper so "Party: D xx% · R yy% (N votes)" comes from census tract metadata. Removed separate GET tract-party calls: on state change, on "Show tract boundaries" toggle, and in `togglePartyColor()`. Updated `partyDataUnavailableMessage` to consider party available when any tract in `currentStep` has `properties.pctDem`.
