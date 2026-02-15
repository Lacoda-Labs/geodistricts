# 260214

## 0700 ca step 1 state tract cache missing file

### Prompt

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/4.txt:7-1022  same result

### Response / actions

Plan: [.cursor/plans/ca_step_1_fix.plan.md](.cursor/plans/ca_step_1_fix.plan.md)

✅ **FIXED**: Bug 3 — state tract cache was never written after force refresh because when Firestore had a doc for `state_tracts_CA` with `cloudStorage: true` but the Cloud Storage file was missing, we never set `shouldRegenerateCache = true`. Only set it when we successfully fetched and then found geometry coverage &lt; 95%. Implemented in `backend/index.js` (`cacheStep0`): when metadata says Cloud Storage but `cloudStorageCache.get(tractCacheKey)` returns no data (file not found) or throws, set `shouldRegenerateCache = true` and log; then step 0 builds and stores the new tract map so next-step can load tracts.
