# Archive: State union polygons script (2026-02-10)

## Summary
Planned and implemented a script to generate all state boundary (union) polygons and save them to Cloud Storage, overwriting any existing entries.

## Plan (reference)
- **Scope:** State boundary polygon (one GeoJSON feature per state) for all 51 entries in `CONGRESSIONAL_DISTRICTS_BY_STATE` (50 states + DC). Cache key: `state_boundary_polygon_${STATE}`.
- **Source:** TIGER state boundaries from ArcGIS (`USA_States_Generalized_Boundaries`), same as `getOrCreateStateBoundaryInCloudStorage` in backend.
- **Output:** Cloud Storage (via `cloudStorageCache.set`) + Firestore metadata in `census_cache`; always overwrite (no “get or create”).

## Implemented

### 1. `backend/scripts/generate-state-union-polygons.js`
- Uses dotenv, axios, Firestore, cloud-storage-cache, and `CONGRESSIONAL_DISTRICTS_BY_STATE` from geodistrict-algorithm.
- Reuses same `stateFipsMap`, ArcGIS service URL, and request params as backend.
- For each state: fetch TIGER → `cloudStorageCache.set(key, unionData, metadata)` → `firestore.collection('census_cache').doc(key).set(metadataEntry)`.
- CLI: `node scripts/generate-state-union-polygons.js` (all states) or `node scripts/generate-state-union-polygons.js CA` (single state).
- Per-state try/catch; exit 0 if all succeed, 1 if any fail or unknown state.

### 2. `backend/services/geodistrict-algorithm.js`
- Exported `CONGRESSIONAL_DISTRICTS_BY_STATE` so the script can use the canonical state list.

## How to run
```bash
cd backend && node scripts/generate-state-union-polygons.js
# or single state:
node scripts/generate-state-union-polygons.js CA
```
Requires `GOOGLE_CLOUD_PROJECT` and GCP credentials; network access to ArcGIS and GCS/Firestore.
