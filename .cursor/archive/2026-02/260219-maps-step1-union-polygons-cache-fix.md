# 260219

## 2230 maps step 1 stuck; union-polygons fork and cache logic

### Prompt

@terminals/2.txt:7-1024 @localhost-1771568971845.log why does step 2 complete but maps page keep showing step 1

(Follow-up: @terminals/2.txt and @localhost-1771569663232.log — no change, still showing step 1 after step 2 completes.)

### Response / actions

- **Cause**: (1) `POST /api/algorithm/step/:state/:step/union-polygons` used `child_process.fork()` with `stdio: ['ignore', 'inherit', 'inherit']`, which triggers `ERR_CHILD_PROCESS_IPC_REQUIRED` (fork requires an IPC channel when stdio is overridden). Union polygon jobs never ran, so no step had `unionPolygonsCached`. (2) After move-all-isolated, the fast path wrote the step cache with `isComplete: true`. When next-step returned that step from cache and saw `isComplete`, it deleted algorithm state and reported “algorithm completed after 1 iterations,” so the next request rehydrated from step 0 and returned step 1 again. (3) Existing step 1 cache in Firestore already had `isComplete: true`, so the fast-path fix only affected new writes; the cache-hit path still deleted state based on `isComplete` alone.

- ✅ **FIXED (backend)**:  
  1. **Fork stdio** (`backend/index.js`): set `stdio: ['ignore', 'inherit', 'inherit', 'ipc']` so the union-polygon worker can run.  
  2. **Fast path** (`backend/index.js`): when saving the step after move-all-isolated, set `isComplete: false` (only the final algorithm step is complete).  
  3. **Cache-hit logic** (`backend/index.js`): when returning a cached step, treat as algorithm complete and delete state only when both `cachedEntry.isComplete === true` and `cachedEntry.unionPolygonsCached === true`. Otherwise cache updated state (e.g. iteration 1) and return `isComplete: false` so the frontend can advance to step 2, 3, etc.

Result: Backend no longer deletes state when serving step 1 (or any step) without union polygons; step progression continues until the final step has union polygons built.
