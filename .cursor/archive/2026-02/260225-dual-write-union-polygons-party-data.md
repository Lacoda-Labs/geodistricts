# 260225

## 1430 dual-write union polygons and party data

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

(Later in the chat the user reiterated: union polygons once calculated should be stored locally and in cloud storage, same for party data — with terminal output showing LOCAL CACHE storing only ~397 bytes metadata for union polygons.)

### Response / actions

Plan: [.cursor/plans/dual-write_union_polygons_and_party_data_aed7af5f.plan.md](.cursor/plans/dual-write_union_polygons_and_party_data_aed7af5f.plan.md)

✅ **IMPLEMENTED** (all plan todos completed):

1. **Union polygons** — Write: when `USE_LOCAL_CACHE`, store full document `{ ...metadataEntry, data: unionData }` via `localCache.setCache` so the blob is local; cloud still gets blob via `cloudStorageCache.set`. Read: in `loadUnionPolygonsFromCache`, if `getCacheDoc` returns a doc with `.data`, use it and skip Cloud Storage; otherwise load from cloud. Logs show "LOCAL CACHE" or "CLOUD STORAGE" by source.

2. **Cloud path for district_party** — In `backend/services/cloud-storage-cache.js` `getFilePath`, added branch for `district_party_*` → `district-party/{state}/{step}_{maxIterations}_{vestYear}.json`.

3. **Tract party dual-write** — In `tract-party-persistence.js` and `vest-bulk-persistence.js`, when `USE_LOCAL_CACHE`, after writing to local cache also call `cloudStorageCache.set(key, payload, metadata)` in try/catch; on failure log warning and continue.

4. **District party dual-write** — In `index.js`, after `setCacheDoc` in `runDistrictPartyJob` and in POST district-party-for-group handler, call `cloudStorageCache.set(key, districtPartyDoc, metadata)` in try/catch.

5. **Docs** — Updated `backend/LOCAL_CACHE_CONFIG.md` (dual-write behavior, cloud skip when no creds) and `doc/pages/CACHING_DESIGN.md` (dual-write note and Cloud Storage list).

Linting passed on modified backend files.
