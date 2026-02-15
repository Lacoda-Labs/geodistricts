---
name: ""
overview: ""
todos: []
isProject: false
---

# CA Init Cache, Trash/Restart with Real Deletion

## Constraint: Real deletion from storage

When **restart** or **clear cache (trash)** are triggered, the corresponding cache data must be **actually deleted from storage** (Firestore and Cloud Storage). Do **not** rely on an invalidate flag or “bypass cache on next read” — the data must be removed.

---

## 1. Clear cache (trash) — what to delete

**Intent:** Clear all algorithm-related cache for the state (step 0 through N, algorithm state, union polygons). Do **not** delete or invalidate external data (tract boundaries, census tract data, state tract cache).

**Storage to delete:**

- **Firestore `census_cache` collection:**
  - All step docs: `algorithm_step_{state}_{maxIterations}_*` (e.g. step 0..100)
  - All step docs: `step_{state}_{step}_{version}` (Run All format)
  - Algorithm state doc: `algorithm_state_{state}_{maxIterations}` (e.g. `algorithm_state_CA_100`)
  - All union polygon metadata docs for this state: doc ids starting with `union_polygon_{state}_` (e.g. `union_polygon_CA_0_1-52`, `union_polygon_CA_1_1-26`, …)
- **Cloud Storage (same bucket as existing cache):**
  - Algorithm state blob (if stored there): use same key as Firestore `algorithm_state_{state}_{maxIterations}`; path from [cloud-storage-cache.js](backend/services/cloud-storage-cache.js) (e.g. `data/algorithm_state_CA_100.json` or per existing getFilePath logic).
  - All union polygon files for this state: prefix `union-polygons/{state}/` (e.g. `union-polygons/CA/step-0/`, `union-polygons/CA/step-1/`, …). List files under that prefix and delete each (or add a `deleteByPrefix`/`listAndDelete` helper).

**Implementation approach:**

- Add or use a backend function e.g. `deleteAlgorithmCacheForState(state, maxIterations)` that performs the above deletions (Firestore + Cloud Storage). No `forceInvalidate` or “skip cache” flag: after this runs, the data is gone.
- Trash button: frontend calls a dedicated endpoint (e.g. `POST /api/algorithm/clear-cache` or `DELETE /api/algorithm/cache/:state`) that only runs this deletion. Then frontend can call step-by-step **without** `forceInvalidate`; backend will have no step 0 cache, so it will build step 0 from existing external caches (state tract cache or tract boundaries + census from cache) and write new step 0 + algorithm state.

---

## 2. Restart — what to delete

**Intent:** Clear algorithm cache for **step 1 and above** only; keep step 0. Reset algorithm state to “iteration 0” so the next “Next” runs step 1. No invalidate flag: delete the data.

**Storage to delete:**

- **Firestore:**
  - Step docs for step ≥ 1 only: `algorithm_step_{state}_{maxIterations}_k` for k ≥ 1, and `step_{state}_k_*` for k ≥ 1.
  - Union polygon metadata docs for this state **for step ≥ 1 only**: e.g. doc ids `union_polygon_{state}_{step}_*` where step ≥ 1 (e.g. `union_polygon_CA_1_1-26`, …).
  - Algorithm state doc: `algorithm_state_{state}_{maxIterations}` (so it can be repopulated with iteration 0).
- **Cloud Storage:**
  - Algorithm state blob for this state (same key as above).
  - Union polygon files for this state **for step ≥ 1 only**: e.g. under `union-polygons/{state}/` delete only files under `step-1`, `step-2`, … (not `step-0`). Either list by prefix `union-polygons/{state}/` and delete files whose path contains `step-1`, `step-2`, etc., or list each `union-polygons/{state}/step-{k}/` for k ≥ 1 and delete.

**After deletion:**

- When the user already has step 0 in the UI (e.g. after clicking Restart), the backend must have algorithm state at iteration 0 so that the next “Next” runs step 1. Options:
  - **Option A:** Restart endpoint, after deleting step 1+ and algorithm state, loads cached step 0 from Firestore (and state tract cache for tracts), builds minimal algorithm state (iteration 0, currentGroups from step 0, uniqueTracts from state tract cache), and writes it with `cacheAlgorithmState`.
  - **Option B:** Frontend after Restart calls step-by-step with `forceInvalidate: false`. Backend finds cached step 0, returns it, and **whenever it serves cached step 0** it also overwrites algorithm state to iteration 0 (so next next-step is step 1). Deletions above still happen via a dedicated “restart” endpoint so data is actually removed; no reliance on “invalidate” for correctness.

Recommendation: implement **restart** as a dedicated endpoint that (1) deletes step 1+ and union blobs for step 1+ and algorithm state from Firestore and Cloud Storage, then (2) either returns step 0 from cache and sets algorithm state to iteration 0, or instructs frontend to call step-by-step and have step-by-step set algorithm state to iteration 0 when returning cached step 0.

---

## 3. What must not be deleted (external data)

Do **not** delete or clear:

- Tract boundaries cache (Firestore or any future Cloud Storage cache).
- Census tract data cache (`census_tract_data_*`, bulk).
- State tract cache: `state_tracts_{state}` (Firestore metadata + Cloud Storage blob).
- State boundary polygon, S4 adjacency, and other external caches.

Trash and restart must **not** pass `forceInvalidate` to tract-boundaries or tract-data; external data is only refreshed by explicit “invalidate external cache” (if added later) or existing version/coverage logic.

---

## 4. Implementation checklist

- **Backend – Clear cache (trash):**
  - Implement `deleteAlgorithmCacheForState(state, maxIterations)` that deletes from Firestore (step docs, algorithm state doc, union polygon docs for state) and Cloud Storage (algorithm state blob, all union-polygon files under `union-polygons/{state}/`).
  - Expose an endpoint (e.g. `POST /api/algorithm/clear-cache` with body `{ state, maxIterations }`) that only calls this deletion. Do not use a “invalidate” flag; perform real deletes.
- **Backend – Restart:**
  - Implement `deleteAlgorithmCacheFromStep1ForState(state, maxIterations)` that deletes step docs for step ≥ 1, union polygon docs and Cloud Storage files for step ≥ 1 only, and algorithm state (Firestore + Cloud Storage).
  - Expose an endpoint (e.g. `POST /api/algorithm/restart` with body `{ state, maxIterations }`) that (1) runs this deletion and (2) either loads step 0 and sets algorithm state to iteration 0, or documents that step-by-step must set algorithm state to iteration 0 when returning cached step 0.
- **Cloud Storage helper (if needed):**
  - Add a way to delete all union polygon files for a state (and optionally “from step K” for restart), e.g. `listFiles(prefix)` then `delete(key)` for each, or `deleteUnionPolygonsForState(state, fromStep = 0)`.
- **Frontend – Trash:**
  - Call the new “clear cache” endpoint; on success, call step-by-step with `forceInvalidate: false` so step 0 is re-created from existing caches (no refetch of external data unless state tract cache is missing).
- **Frontend – Restart:**
  - Call the new “restart” endpoint; then either use returned step 0 or call step-by-step with `forceInvalidate: false`. Ensure backend has set algorithm state to iteration 0 so Next runs step 1.

---

## 5. Summary

- **Trash:** One backend function + one endpoint that **delete** all algorithm step cache (0..N), algorithm state, and union polygons for the state from Firestore and Cloud Storage. No invalidate flag.
- **Restart:** One backend function + one endpoint that **delete** step 1+ and their union polygons and algorithm state from Firestore and Cloud Storage; keep step 0; then set algorithm state to iteration 0 (so Next runs step 1). No invalidate flag.
- **External data:** Never deleted or invalidated by trash/restart; do not pass `forceInvalidate` to boundaries or tract-data from these flows.

