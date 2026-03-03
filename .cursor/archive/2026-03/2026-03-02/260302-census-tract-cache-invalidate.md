# 260302

## 1200 census tract cache location and clear local + cloud

### Prompt

running local, where is the census tract data cached? I renamed some cloudstorage bucket files for NY then reloaded NY in dev/maps. cloudstorage does not appear to be used. invalidate/delete local and cloud cache tract and polygon data and refresh.

### Response / actions

- **Where cache lives (local):** When `USE_LOCAL_CACHE` is true, tract data is cached under **`data/census-cache/`** at the project root. Keys include `state_tracts_NY`, `census_tract_boundaries_<hash>`, and `census_tract_data_<hash>` per county. Cloud Storage is not read in this mode.
- **Earlier in chat:** Explained why NY showed missing tracts (2000-feature cap; fixed by using batched fetch when count ≥ 2000 and looping until short batch in `fetchTractBoundariesForState`). Summarized how Census API (census.gov) and TIGER (tigerweb.geo.census.gov) are fetched and merged via canonical-tract-loader.
- ✅ **IMPLEMENTED**: `POST /api/census/clear-state-cache` with body `{ "state": "NY", "cloud": true }` to invalidate local and optionally cloud tract/polygon cache for one state.
- ✅ **IMPLEMENTED**: `deleteTractAndPolygonCacheForState(state, options)` in backend: deletes local `state_tracts_{state}`, tract_boundaries key, and per-county tract_data; when `deleteCloud: true`, calls cloud storage to delete `state-tracts/{state}.json` and `boundaries/{state}.json`.
- ✅ **IMPLEMENTED**: `cloudStorageCache.deleteStateTractAndBoundariesFiles(state)` to remove those two paths in the bucket.
- **Docs:** Updated `backend/LOCAL_CACHE_CONFIG.md` with cache directory location, note that local cache overrides cloud when `USE_LOCAL_CACHE` is true, and the new endpoint. User can then reload the state in dev/maps to refetch from Census/TIGER.
