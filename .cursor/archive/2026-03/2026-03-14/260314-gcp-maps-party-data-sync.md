# 260314

## 0004 GCP maps party data sync

### Prompt

public site does not have access to same data as localhost as far as party data is concerned. make changes to keep GCP data stores in sync with local stores as far as /maps page is concerned.

### Response / actions

✅ **IMPLEMENTED**: Kept GCP in sync with local for /maps party data.

- **State comparison** (119th vs GeoDistricts): Previously only in `data/maps-state-comparison.json` (local file). Public site had no access and showed GeoDistricts 0/0.
  - **cloud-storage-cache.js**: Added `maps_state_comparison` → `data/maps_state_comparison.json` in GCS.
  - **GET /api/maps/state-comparison**: Now resolves in order: in-memory → file → Firestore (`maps_state_comparison`) → GCS → 119th-only fallback. Introduced `resolveStateComparison()` and use it in this handler and in `buildMapsLandingPayload()`.
  - **POST /api/admin/maps-comparison/refresh**: After saving to file, writes to GCP—Firestore when not using local cache, GCS when using local cache (so a local refresh pushes to GCS for the public site).
- **GCS README**: Documented `data/` prefix (maps_landing, maps_state_comparison).
- **District/tract party**: No code change; `district_party_*` already dual-writes to Firestore/GCS when the district-party job runs.

One-time step: run maps-comparison refresh from local (with GCP credentials) or from production so GCP has the comparison blob; then the public /maps page will show the same D/R and swing as local.
