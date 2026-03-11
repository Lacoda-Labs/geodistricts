# 260310

## 2305 clear-cache preserve census data and Cloud Storage fallback

### Prompt

clear cache button deletes the census data from original sources, but it is not supposed to. also see log for WA trying to refetch from external.

### Response / actions

- **Clear-cache must not delete census data:** Updated `deleteAlgorithmCacheForState` in `backend/index.js`: when deleting union-polygon keys in USE_LOCAL_CACHE mode, skip any key starting with `state_tracts_` so census/original-source tract cache is never removed. Added explicit comment that we do not delete `state_tracts_{state}` and updated POST /api/algorithm/clear-cache doc comment and log message ("state_tracts preserved").
- **Avoid TIGER refetch after clear-cache:** In `loadTractsFromStateTractCache`, when local cache has no state tract doc, added fallback to Cloud Storage for `state_tracts_{state}`. If data is found (array, FeatureCollection, or [id,tract] format), use it with the same geometry-coverage check and return so step-by-step does not call `fetchTractBoundariesForState` (TIGER). Wrapped in try/catch so missing GCP credentials do not break the flow.
- ✅ **FIXED:** Clear-cache no longer touches state tract cache; after clear, step-by-step uses state tract cache from local or Cloud Storage when available, avoiding external TIGER refetch (e.g. for WA when state_tracts exist in Cloud Storage).
