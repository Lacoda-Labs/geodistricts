# 260216

## 1545 popup bbox, swap removal, censusTractIds fix, island tract exclusion

### Prompt

[First:] this seems wrong [terminal: division direction DG1-26]. in the leaflet-popup-content, add the bbox coordinates and remove the swap button and associated endpoint and cleanup

[Then, terminal TS error:] Property 'censusTractIds' does not exist on type 'DistrictGroup'. Did you mean 'censusTracts'?

[Then:] why are island tracts [terminal: DETECT ISOLATED … POST-DIVISION ISOLATED (step 4): sample IDs: 06083980100, 06111980000]

### Response / actions

- **Popup bbox**: Added `getTractBboxString(tract)` (uses `getTractBoundsForSort`) and showed bbox (S, N, W, E) in both Leaflet popups: tract-layer bindPopup and locate-tract popup.
- **Swap removal**: Removed “Swap to sibling” button from both popups; removed `window.gdSwapTract` in `ngOnInit`; removed `swapTractToSibling()`; removed `.leaflet-popup-swap-btn` styles from `app.scss`. Backend `move-all-isolated-tracts` left in place (used by bulk Move isolated tracts).
- ✅ **FIXED** `censusTractIds`: In `maps-page.component.ts` `isStaleIsolatedTractsData`, use only `g.censusTracts?.length ?? 0` (DistrictGroup has no `censusTractIds`).
- ✅ **FIXED** island tracts in POST-DIVISION ISOLATED: 06083980100 and 06111980000 are known CA Pacific island tracts and should be excluded from isolation at steps 1+. In `backend/services/geodistrict-algorithm.js`: (1) Second algorithm path (async generator): handle Firestore-style `group.tractIds` when building step-0 island set and add known CA island list when state is CA. (2) First path: infer state from `updatedGroups[0].censusTracts[0]` when `uniqueTracts` doesn’t yield state so CA islands are always added for CA runs.
