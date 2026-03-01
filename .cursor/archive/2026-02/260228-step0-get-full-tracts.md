# 260228

## 1430 step 0 GET full tracts from state cache

### Prompt

why does step 0 after clear cache running local show NY with what appears to be missing census tract TIGER shape files (when showing tracts is enabled) on maps page.

(Then /archive)

### Response / actions

- **Cause:** GET `/api/algorithm/step/:state/:stepNumber` serves step 0 from cache by reconstructing `censusTracts` from cached `censusTractIds` using the state tract cache. Step 0 had been cached earlier with only ~334 tract IDs (e.g. before TIGER fix or mainland-only). After state tract cache was rebuilt (2000 tracts with geometry), the cached step 0 document still had 334 IDs, so reconstruction returned 334 tracts and the map showed white gaps. POST step-by-step already replaces step 0’s tracts with the full list; GET step did not.
- ✅ **FIXED:** In `backend/index.js`, GET step handler: for step 0, after reconstruction, if the state tract cache was loaded and the reconstructed step has fewer tracts than the full state list, replace `districtGroups[0].censusTracts` with the full list from the state cache and update that group’s `totalPopulation`. GET step/0 now returns all state tracts (e.g. 2000 for NY) when the state tract cache is current.
