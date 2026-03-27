# 260326

## 2102 archive

### Prompt

/archive

### Response / actions

Plan: [static_maps_cdn_build_script_8c61b183.plan.md](../../../plans/static_maps_cdn_build_script_8c61b183.plan.md)

Session (prior turns in thread): where per-state GeoDistricts WebPs live (generated under `data/.../states/*.webp`, CDN upload, not in git by default); VS Code `launch.json` fix for `generate-state-map-rasters.js` (repo-root `cwd`, correct args); explanation of `data/maps_landing.json` (pre-aggregated maps landing blob from admin/GCS); implementation of one-shot **static maps CDN** orchestrator.

✅ **IMPLEMENTED**: [`backend/scripts/build-static-maps-cdn-assets.js`](../../../backend/scripts/build-static-maps-cdn-assets.js)—resolve landing (local, `GET_MAPS_LANDING_URL`, `--from-api`, `MAPS_LANDING_GCS_URI` / `--from-gcs`), run four generators into `data/cdn-maps-static`, optional `gcloud storage cp` upload with `Cache-Control`; root `npm run build:static-maps-cdn`; [`doc/pages/STATIC_MAPS_CDN.md`](../../../doc/pages/STATIC_MAPS_CDN.md) one-shot section and GCP prerequisites. Verified `--dry-run` and missing-landing error path.
