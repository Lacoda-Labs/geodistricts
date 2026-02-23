# 260222

## 1200 backend local-only data plan implementation

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/backend_local-only_data_2f79fb40.plan.md](.cursor/plans/backend_local-only_data_2f79fb40.plan.md)

✅ **IMPLEMENTED**: Backend now uses local filesystem only when `USE_LOCAL_CACHE` is true (dev/maps on localhost). No Firestore or Cloud Storage required for cache in that mode.

- **index.js**: Added `getCacheDoc`, `setCacheDoc`, `deleteCacheDoc`, `listCacheDocIds`. Firestore is lazy-initialized only when `!USE_LOCAL_CACHE`. `testFirestoreAccess()` is skipped when `USE_LOCAL_CACHE`. All census_cache reads/writes (algorithm steps, state tracts, algorithm state, tract-party, union polygons) go through the helpers or existing `getFromCache`/`setCache`. `cacheAlgorithmResult` has an early local-only path; GET final-step-states, GET final-step/:state, invalidate functions, and delete-algorithm-cache paths branch on `USE_LOCAL_CACHE` and use local list/delete where appropriate.
- **vest-data-loader.js**: When `USE_LOCAL_CACHE`, read and write only via `localCache`; no cloud storage. `getStatus()` uses local cache only in that mode.
- **tract-party-persistence.js**: When `USE_LOCAL_CACHE`, `loadTractPartyForState` and `runTractPartyPersistenceJob` use `localCache` only.
- **vest-bulk-persistence.js**: When `USE_LOCAL_CACHE`, `persistStateData` writes to `localCache` only; added local `getFirestore` and `cloudStorageCache` for the non-local path.
- **LOCAL_CACHE_CONFIG.md**: Added "Local-Only Data (dev/maps on localhost)" section describing behavior, risks (disk space, large payloads, dev/prod divergence), and listing/query semantics.
- Verified backend starts with `USE_LOCAL_CACHE=true` without GCP credentials (logs "Skipping Firestore/Cloud Storage test (local cache mode)" and "Server is running on port 8080").
