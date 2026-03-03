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

## 1230 NY still 2000 tracts — always use internal batch fetch

### Prompt

NY still has missing tracts. is there a problem fetching from census.gov? also look at the browser console log. ✅ Rendered 2000 tracts across 1 districts. CA did not have this problem.

### Response / actions

- **Cause:** Census.gov was fine (5,411 tracts). TIGER `getTractCount(NY)` returns &lt; 2000 (API cap/quirk), so the code used the tract-boundaries URL path, which does a single request with `resultRecordCount: 2000` and returned only 2000 boundaries. Canonical model had 5411 Census tracts but only 2000 with geometry → “Rendered 2000 tracts.” CA worked because `getTractCount(CA)` was &gt; 2000 so the batch path was used.
- ✅ **FIXED:** For algorithm/state-tract paths (initial state load, step-by-step on cache miss, GET census-tracts on cache miss), **always** use `fetchTractBoundariesForState(state)` and never call the tract-boundaries URL. Removed the `getTractCount` branch in three places in `backend/index.js`. Batch fetch loops until a short batch, so all TIGER features are retrieved regardless of count cap.
- Browser “Rendered 2000 tracts” is just the frontend logging the count from the backend; no frontend change. After clear-state-cache + clear algorithm cache + restart backend and re-run NY, backend should log full batch count and frontend will show full tract count.
