# 260215

## 1600 CA init external fetch, cache isolation, trash/restart, step 0

### Prompt

(Initial) Why is CA fetching (EXTERNAL FETCH) as part of initializing algorithm for CA? EXTERNAL FETCH should be extremely rare. Review the cloud storage and firestore design to make sure the data fetched from external sources are isolated in application cache, and never invalidated unless explicitly done so (method tbd). The current state reset "trash" should never touch the external data source cache. When clicking "trash" clear-cache, it should only clear cache related to the algorithm steps, including step 0. When clicking "restart" it should clear cache for step1+, keeping step0. The purpose for "trash" button is to clear step0. There appears to be a bug in "restart" because subsequent clicks on "next" skip to last completed step and execute next step from there. Start and previous step buttons should only load corresponding steps from cache, as they already exist. Find step 0 documentation and report the basic steps for initializing a state. I want to review.

(Follow-up) Make sure that when restart or clear cache are triggered, that the corresponding cache data is actually deleted from storage. Do not rely on an invalidate flag.

(Follow-up) Build the plan.

(Follow-up) Implement the plan as specified (CA Init External Fetch, Cache Isolation, Trash/Restart, and Step 0 Docs). Do NOT edit the plan file itself. Mark todos in progress and complete; don't stop until all to-dos are done.

### Response / actions

Plan: [.cursor/plans/ca_init_cache_and_restart_fix.plan.md](.cursor/plans/ca_init_cache_and_restart_fix.plan.md)

- **Root cause (CA EXTERNAL FETCH):** Tract-boundaries uses streaming for CA (>2000 tracts) and does not cache; step-by-step did not use state tract cache to skip boundaries + bulk fetch.
- **Real deletion (no invalidate flag):** Implemented `deleteAlgorithmCacheForState` and `deleteAlgorithmCacheFromStep1ForState`; **POST /api/algorithm/clear-cache** and **POST /api/algorithm/restart** perform actual Firestore + Cloud Storage deletes (step docs, algorithm state, union polygon docs/files). Trash calls clear-cache then step-by-step with `forceInvalidate: false`; restart calls restart endpoint then step-by-step.
- **Cloud Storage:** Added `listUnionPolygonKeysForState`, `deleteUnionPolygonsForState(state, fromStep)` in `backend/services/cloud-storage-cache.js`.
- **Frontend:** Trash calls POST clear-cache then `resetToStartWithOptions(false)`; restart calls POST restart then `resetToStartWithOptions(false)`.
- **Restart bug:** Restart endpoint deletes step 1+ and algorithm state, then loads cached step 0 and writes algorithm state at iteration 0 so next “Next” runs step 1. Step-by-step already sets algorithm state to iteration 0 when returning cached step 0.
- **EXTERNAL FETCH rare:** Added `loadTractsFromStateTractCache(state)`; step-by-step tries state tract cache first when `!forceInvalidate` and skips boundaries + bulk fetch when valid.
- **Step 0 doc:** Updated [doc/history/Step0-AlgorithmInitializationSummary.md](doc/history/Step0-AlgorithmInitializationSummary.md) (state tract cache short-circuit, algorithm state reset on cache hit, external vs algorithm cache note). Added “External vs algorithm cache (trash/restart)” to [doc/history/CACHING_DESIGN.md](doc/history/CACHING_DESIGN.md).

✅ **IMPLEMENTED**: Clear-cache and restart use real storage deletion; trash/restart do not touch external cache; state tract cache used to avoid TIGERweb when valid; Step 0 docs and caching design updated.
