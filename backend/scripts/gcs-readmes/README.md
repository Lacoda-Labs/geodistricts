# GeoDistricts Census Data Bucket

This Google Cloud Storage bucket holds cached census, boundary, and algorithm data for the [GeoDistricts](https://github.com/Lacoda-Labs/geodistricts) redistricting application.

## Bucket name

- Default: `geodistricts-census-data`
- Override: set `CENSUS_DATA_BUCKET` in the backend environment.

## Folder layout

| Prefix | Description |
|--------|-------------|
| boundaries/ | Census tract boundary GeoJSON by state — see `boundaries/README.md` |
| state-tracts/ | State tract cache (tracts + geometry) for algorithm runs — see `state-tracts/README.md` |
| demographics/ | Census tract/county demographic data cache — see `demographics/README.md` |
| voter-registration/ | State-level voter registration statistics — see `voter-registration/README.md` |
| union-polygons/ | Union polygons per algorithm step (by state and step) — see `union-polygons/README.md` |
| congressional-boundaries/ | Current/precedent congressional district boundaries (Lewis) — see `congressional-boundaries/README.md` |
| tract-party/ | Tract-level party registration / partisan data by state and year — see `tract-party/README.md` |
| data/ | Maps page blobs: `maps_landing.json`, `maps_state_comparison.json` (119th vs GeoDistricts party comparison; synced so public site matches local). The API uses `maps_landing.json` as a fallback for state-comparison and state-party-summaries when Firestore has no data, so the public site can show party data from GCS only. |

## Usage

- The backend uses the **Cloud Storage Cache** service (`backend/services/cloud-storage-cache.js`) to read and write these paths. Files larger than 1 MB are stored here; smaller entries may live in Firestore with metadata pointing to this bucket.
- Cache keys and paths are documented in each folder’s `README.md`.

## Requirements

- Google Cloud project with Storage API enabled.
- Service account with `storage.objects.create`, `storage.objects.get`, `storage.objects.delete`, and (optional) `storage.buckets.get` / `storage.buckets.create`.

See [doc/history/CLOUD_STORAGE_MIGRATION.md](../../../doc/history/CLOUD_STORAGE_MIGRATION.md) for migration and configuration details.

**One-time backfill (local cache → GCP):** Run `node backend/scripts/backfill-local-cache-to-gcp.js` from repo root with `GOOGLE_APPLICATION_CREDENTIALS` set to upload local cache (e.g. `district_party_*`, optional `maps_state_comparison`) to Firestore/GCS. Then run `node backend/scripts/sync-maps-to-gcs.js` so GCS has `data/maps_landing.json`.
