# 260314

## 2354 backfill local cache to GCP plan

### Prompt

create plan to do optional backfill option but take the current local files as a tempsource and just create scripts to upload to FS or CS

### Response / actions

Plan: [.cursor/plans/backfill_local_cache_to_gcp.plan.md](.cursor/plans/backfill_local_cache_to_gcp.plan.md)

- Confirmed the one-time backfill goal: upload whatever has been available only on localhost to GCP (Firestore or Cloud Storage), using local as source.
- **Created plan** for backfill using **current local files as the only source** (no re-running jobs): add script `backend/scripts/backfill-local-cache-to-gcp.js` that reads from local cache (`data/census-cache/` via localCache.getCacheInfo/getFromCache) and optionally from `data/maps-state-comparison.json`, then writes to Firestore or Cloud Storage (same size/error logic as setCacheDoc). Options: `--prefix` (default `district_party_`), `--maps-comparison`, `--dry-run`. Optional second script to upload a pre-built maps_landing.json to GCS documented as optional; plan recommends running sync-maps-to-gcs after backfill instead. Document usage (GOOGLE_APPLICATION_CREDENTIALS, then sync-maps-to-gcs for maps_landing).
