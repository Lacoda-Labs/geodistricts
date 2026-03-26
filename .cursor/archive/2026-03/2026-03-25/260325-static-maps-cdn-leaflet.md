# 260325

## 2348 archive

### Prompt

/archive

### Response / actions

Plan: [.cursor/plans/static_maps_+_image_default_14535de3.plan.md](.cursor/plans/static_maps_+_image_default_14535de3.plan.md)

Session (prior turns): static-first maps architecture for public GCP spend/performance—FE static summaries, CDN-hosted WebPs (no large rasters in Angular bundle), polygon→WebP via Sharp, default image mode with Leaflet + BE polygons on demand; home hero uses local assets only (non-hero `UsCongressionalMap` would hit API). User refined plan to require CDN for map images.

✅ **IMPLEMENTED**:

- **Backend:** `backend/lib/polygon-raster-webp.js`; refactored `generate-geodistricts-all-raster.js`; `generate-state-map-rasters.js` (output `{base}/states/{ST}.webp`); `generate-state-static-json.js` with `CDN_PUBLIC_BASE_URL`; `generate-frontend-maps-summaries.js` (applies `applyFreshCongress119ToComparisonPayload`, writes `frontend/public/maps/maps-landing-summaries.json`).
- **Frontend:** Maps page loads `/maps/maps-landing-summaries.json` first, then API fallbacks; `mapDisplayMode` signal, image/Leaflet toolbar when CDN raster exists; dev route forces Leaflet; `onStaticAllMapError` switches to Leaflet.
- **Docs/config:** `doc/pages/STATIC_MAPS_CDN.md`, link in `doc/GeoDistrictsProjectOverview.md`; `environment.prod.ts` CDN comments.
