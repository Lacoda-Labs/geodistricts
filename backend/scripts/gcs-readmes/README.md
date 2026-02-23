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

## Usage

- The backend uses the **Cloud Storage Cache** service (`backend/services/cloud-storage-cache.js`) to read and write these paths. Files larger than 1 MB are stored here; smaller entries may live in Firestore with metadata pointing to this bucket.
- Cache keys and paths are documented in each folder’s `README.md`.

## Requirements

- Google Cloud project with Storage API enabled.
- Service account with `storage.objects.create`, `storage.objects.get`, `storage.objects.delete`, and (optional) `storage.buckets.get` / `storage.buckets.create`.

See [doc/history/CLOUD_STORAGE_MIGRATION.md](../../../doc/history/CLOUD_STORAGE_MIGRATION.md) for migration and configuration details.
