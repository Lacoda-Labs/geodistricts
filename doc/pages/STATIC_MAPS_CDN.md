# Static-first maps (CDN + hosting)

Reduce Cloud Run traffic on the public maps experience by serving read-only table data from the Angular host (`/maps/maps-landing-summaries.json`) and map rasters from a CDN. Interactive Leaflet still uses the API when users choose it or when static assets are missing.

## Regenerate table JSON (summaries, no polygons)

From repo root, after `data/maps_landing.json` exists (or point at your API):

```bash
node backend/scripts/generate-frontend-maps-summaries.js data/maps_landing.json
# or
GET_MAPS_LANDING_URL=https://YOUR_API/api/maps/landing node backend/scripts/generate-frontend-maps-summaries.js
```

This writes `frontend/public/maps/maps-landing-summaries.json` and applies `applyFreshCongress119ToComparisonPayload` so 119th Congress counts match `backend/data/congress-119-party.json`.

**When to rerun:** after updating `congress-119-party.json`, maps-comparison refresh, or regenerating `maps_landing`.

## CDN: national WebP

```bash
node backend/scripts/generate-geodistricts-all-raster.js data/maps_landing.json ./geodistricts-all-119.webp
```

Upload `geodistricts-all-119.webp` to your CDN. Set in frontend environment:

- `staticAllMapImageUrl`: full URL to the file, **or**
- `cdnBaseUrl`: base URL; the app uses `{cdnBaseUrl}/geodistricts-all-119.webp` when `staticAllMapImageUrl` is empty.

Set long-cache `Cache-Control` on the CDN object (e.g. `public, max-age=86400, immutable` with versioned paths if you change often).

## CDN: per-state JSON + WebP

Use the same output base directory for WebP and JSON so both live under `…/states/`.

1. Generate WebPs:

```bash
node backend/scripts/generate-state-map-rasters.js data/maps_landing.json ./data/static-states
```

2. Generate state JSON with public asset URLs:

```bash
CDN_PUBLIC_BASE_URL=https://YOUR_CDN/maps node backend/scripts/generate-state-static-json.js data/maps_landing.json ./data/static-states
```

Upload `./data/static-states/states/*.json` and `./data/static-states/states/*.webp` so each state has `{CDN_PUBLIC_BASE_URL}/states/{ST}.webp` alongside `{ST}.json` (same path pattern the frontend expects under `cdnBaseUrl`).

3. Set `cdnBaseUrl` in `environment.prod.ts` to the directory that contains the `states/` folder.

## Home page vs API

The current home hero uses only `assets/hero-conus-119.webp` and `assets/hero-conus-119.json`—no GeoDistricts API. If you add a **non-hero** `UsCongressionalMap`, it loads `/api/congressional-boundaries/...`; consider static GeoJSON or a CDN mirror for that path.

## Production checklist

- [ ] `frontend/public/maps/maps-landing-summaries.json` committed or produced in CI from `maps_landing`
- [ ] `staticAllMapImageUrl` or `cdnBaseUrl` + `geodistricts-all-119.webp` on CDN
- [ ] Optional: `cdnBaseUrl` + `states/{code}.json` and `states/{code}.webp` on CDN
- [ ] CDN cache headers for WebP and JSON
