---
name: ""
overview: ""
todos: []
isProject: false
---

# Backfill local cache to GCP (Firestore / Cloud Storage)

## Goal

Use **current local files as the source** and upload that data to GCP (Firestore or Cloud Storage) so production has the same data as local. No re-running of jobs; read from existing local cache and optional file, then write to FS or CS via scripts.

## Scope

- **Source (temp):** Local file cache under `data/census-cache/` (keys stored as `{key}.json` + `{key}.meta.json`) and, for state comparison, the file `data/maps-state-comparison.json` (or `backend/data/maps-state-comparison.json`).
- **Target:** Firestore collection `census_cache` for normal-sized docs; Cloud Storage (via existing `cloud-storage-cache` paths) for oversized docs, with Firestore holding metadata. For `maps_state_comparison`, also write to GCS `data/maps_state_comparison.json` so the public API can resolve it.

## Scripts to add

### 1. `backend/scripts/backfill-local-cache-to-gcp.js`

Standalone Node script (no Express). Run from repo root with GCP credentials set.

**Inputs (env or CLI):**

- `--prefix` (optional): Only backfill keys starting with this prefix (e.g. `district_party_`). Default: `district_party_`.
- `--maps-comparison` (optional flag): Also load `data/maps-state-comparison.json` (or backend fallback path) and upload as Firestore doc `maps_state_comparison` and GCS `data/maps_state_comparison.json`.
- `--dry-run`: List keys and sizes only; do not write to GCP.

**Behavior:**

1. **List local cache keys**
  Use `localCache.getCacheInfo()` from [backend/local-cache.js](backend/local-cache.js). Filter by `--prefix` if provided (default `district_party_`). Skip expired entries if desired (or backfill anyway).
2. **Read each key’s data**
  Use `localCache.getFromCache(key)` to load the JSON. If a key fails to load, log and continue.
3. **Write to GCP (Firestore or GCS)**
  Reuse the same logic as [backend/index.js](backend/index.js) `setCacheDoc` (non–USE_LOCAL_CACHE branch):
  - Init Firestore (`@google-cloud/firestore` with `projectId`) and `cloudStorageCache` (require [backend/services/cloud-storage-cache.js](backend/services/cloud-storage-cache.js), call `initialize()`).
  - For each payload: `sizeBytes = JSON.stringify(data).length`. Try `firestore.collection('census_cache').doc(key).set(data)`. On success, done.
  - On Firestore “too many index entries” or invalid-argument (doc too large), call `cloudStorageCache.set(key, data, { source: 'backfill-local-cache-to-gcp', key })`, then `firestore.collection('census_cache').doc(key).set(metadataEntry)` with `cloudStoragePath`, `cloudStorage: true`, `timestamp`, `ttl` (same shape as index.js).
4. **maps_state_comparison (when `--maps-comparison`)**
  - Resolve path: `data/maps-state-comparison.json` if it exists, else `backend/data/maps-state-comparison.json` (match [backend/services/maps-comparison.js](backend/services/maps-comparison.js) `getComparisonDataPath()`).
  - If file exists, read JSON, then:
    - Write to Firestore: `census_cache` doc id `maps_state_comparison`.
    - Write to GCS: `cloudStorageCache.set('maps_state_comparison', payload, { source: 'backfill-local-cache-to-gcp' })` (writes `data/maps_state_comparison.json`).
5. **Logging**
  Log each key uploaded (and whether Firestore vs GCS), and a short summary at the end (counts, any errors).

**Dependencies:** Use existing backend deps: `local-cache`, `services/cloud-storage-cache`, `@google-cloud/firestore`. Run with `node backend/scripts/backfill-local-cache-to-gcp.js` from repo root so `local-cache`’s `CACHE_DIR` (relative to backend) and `data/` paths resolve. Require from `backend/` so paths are `require('../local-cache')`, `require('../services/cloud-storage-cache')` if script lives under `backend/scripts/`.

### 2. Optional: `backend/scripts/backfill-maps-landing-to-gcs.js`

If you want to push a **pre-built** `maps_landing` blob to GCS from local:

- **Input:** Path to a local JSON file that has the shape of maps-landing (e.g. generated elsewhere or from a one-off run of `buildMapsLandingPayload` saved to file).
- **Behavior:** Read JSON, call `cloudStorageCache.initialize()`, then `cloudStorageCache.set('maps_landing', data, { source: 'backfill-maps-landing' })`. No Firestore (maps_landing is GCS-only).
- **When to use:** After backfilling `district_party`_* and `maps_state_comparison`, you can run the existing **maps-landing generate** against the API (so it reads from Firestore and builds the blob), or use this script to upload a pre-built JSON file. Plan can treat this as optional and document it in the main script’s README or comments.

Recommendation: **Omit** a separate maps-landing upload script from the initial plan and document that after backfill, run `node backend/scripts/sync-maps-to-gcs.js` (or call `POST /api/admin/maps-landing/generate`) so the landing blob is built from the now-populated Firestore and written to GCS. If you still want “upload a local maps_landing.json file”, add the small script above.

## Implementation details

- **Firestore init:** `const { Firestore } = require('@google-cloud/firestore'); const firestore = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts' });`
- **Cloud Storage:** Require the existing `cloud-storage-cache` module; call `await cloudStorageCache.initialize()` before first `set`. Use the same `getFilePath` behavior (e.g. `district_party`_* → `district-party/{state}/...`, `maps_state_comparison` → `data/maps_state_comparison.json`).
- **Key naming:** Local cache keys use “safe” filenames (e.g. `district_party_AL_3_100_2024`). Use the same key as the Firestore doc id and for `cloudStorageCache.set(key, data)`.

## Usage

```bash
# From repo root, with GCP credentials set
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

# Backfill only district_party_* from local cache
node backend/scripts/backfill-local-cache-to-gcp.js

# Backfill district_party_* and also upload data/maps-state-comparison.json as maps_state_comparison
node backend/scripts/backfill-local-cache-to-gcp.js --maps-comparison

# Dry run (list keys, no writes)
node backend/scripts/backfill-local-cache-to-gcp.js --dry-run

# Optional: different prefix (e.g. all census_cache keys - use with care)
node backend/scripts/backfill-local-cache-to-gcp.js --prefix ""
```

After backfill, run maps-landing generate so GCS has `data/maps_landing.json`:

```bash
node backend/scripts/sync-maps-to-gcs.js
```

(or call the production API’s `POST /api/admin/maps-landing/generate` so the blob is built from Firestore and written to GCS).

## Checklist

- Add `backend/scripts/backfill-local-cache-to-gcp.js`: list local cache by prefix, read each key, write to Firestore or GCS (same logic as setCacheDoc).
- Support `--maps-comparison`: read `data/maps-state-comparison.json` (or backend path), write to Firestore doc `maps_state_comparison` and GCS `data/maps_state_comparison.json`.
- Support `--dry-run` and `--prefix` (default `district_party_`).
- Document in script header and/or [backend/LOCAL_CACHE_CONFIG.md](backend/LOCAL_CACHE_CONFIG.md) or [backend/scripts/gcs-readmes/README.md](backend/scripts/gcs-readmes/README.md): one-time backfill, run with `GOOGLE_APPLICATION_CREDENTIALS`, then run sync-maps-to-gcs for maps_landing.

