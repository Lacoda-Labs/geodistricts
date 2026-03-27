# Static-first maps (CDN + hosting)

Reduce Cloud Run traffic on the public maps experience by serving read-only table data from the Angular host (`/maps/maps-landing-summaries.json`) and map rasters from a CDN. Interactive Leaflet still uses the API when users choose it or when static assets are missing.

## One-shot: build all static assets (and optional GCS upload)

From **repo root**, with a **`maps_landing`** source (local file, API, or GCS) and the **public HTTPS base** where objects will be served:

```bash
export STATIC_MAPS_CDN_BASE='https://storage.googleapis.com/YOUR_BUCKET/public-maps'
npm run build:static-maps-cdn
```

This runs, in order: `generate-frontend-maps-summaries.js`, `generate-geodistricts-all-raster.js`, `generate-state-map-rasters.js`, `generate-state-static-json.js`. Outputs:

- `frontend/public/maps/maps-landing-summaries.json`
- `data/cdn-maps-static/geodistricts-all-119.webp`
- `data/cdn-maps-static/states/{ST}.webp` and `states/{ST}.json` (with `stateMapImageUrl` under `STATIC_MAPS_CDN_BASE`)

**Resolve `data/maps_landing.json` if missing:**

- `GET_MAPS_LANDING_URL=https://YOUR_API/api/maps/landing npm run build:static-maps-cdn`
- `npm run build:static-maps-cdn -- --from-api https://YOUR_API_HOST` (no `/api` suffix)
- `MAPS_LANDING_GCS_URI=gs://geodistricts-census-data/data/maps_landing.json npm run build:static-maps-cdn -- --from-gcs`

**Upload to GCS** (separate prefix from `data/maps_landing.json` used by the API—e.g. `public-maps/`):

```bash
export STATIC_MAPS_GCS_PREFIX='gs://YOUR_BUCKET/public-maps'
npm run build:static-maps-cdn -- --upload
```

Uses `gcloud storage cp -r` with `Cache-Control: public, max-age=86400`. Requires `gcloud` CLI and credentials with storage access.

**Flags:** `--out DIR`, `--landing PATH`, `--dry-run`, `--help`. See `backend/scripts/build-static-maps-cdn-assets.js` header.

### Prerequisites (GCP)

- Install [Google Cloud SDK](https://cloud.google.com/sdk) and authenticate (`gcloud auth application-default login` or a service account).
- **Public reads:** browsers must load `STATIC_MAPS_CDN_BASE` without private cookies. Typical approaches: make the **static maps bucket or prefix** world-readable for `objectViewer`, use a **dedicated public bucket**, or front GCS with **Cloud CDN** + HTTPS and set `STATIC_MAPS_CDN_BASE` to the CDN URL.
- Ensure **`maps_landing` exists** before building: e.g. `POST /api/admin/maps-landing/generate` on the API, or [sync-maps-to-gcs.js](../../backend/scripts/sync-maps-to-gcs.js) (admin). If `GET /api/maps/landing` returns 404, the orchestrator cannot fetch input.

### Cloud CDN (provisioned load balancer)

To serve assets from **Cloud CDN** on a custom hostname instead of `storage.googleapis.com`, use the repo script that provisions a **global HTTPS load balancer**, **backend bucket**, and **managed TLS certificate**:

- **[deploy/static-maps-cdn/README.md](../../deploy/static-maps-cdn/README.md)** — prerequisites, env vars, DNS before cert becomes `ACTIVE`, troubleshooting.
- **[deploy/static-maps-cdn/provision.sh](../../deploy/static-maps-cdn/provision.sh)** — idempotent `gcloud` setup (Cloud CDN on the backend bucket, URL map, static IP, SSL cert, HTTPS proxy, forwarding rule on `443`).

**Order of operations:** create a dedicated public GCS bucket (uniform access) if needed → optional: `npm run build:static-maps-cdn -- --upload` to `gs://BUCKET/public-maps` → run `provision.sh` with `PROJECT_ID`, `STATIC_MAPS_BUCKET`, `CDN_HOSTNAME` → point DNS **A record** for `CDN_HOSTNAME` at the printed global IP → wait for managed cert → set **`STATIC_MAPS_CDN_BASE=https://<CDN_HOSTNAME>/public-maps`** (no trailing slash), rebuild static maps, upload again, and set **`cdnBaseUrl`** in `frontend/src/environments/environment.prod.ts` to the same value.

**Two URLs:** keep **`STATIC_MAPS_GCS_PREFIX`** as `gs://.../public-maps` for uploads; set **`STATIC_MAPS_CDN_BASE`** to the **HTTPS** origin users and generated `stateMapImageUrl` values use (custom host or `storage.googleapis.com`).

**Cache invalidation** after replacing objects under stable paths: see README (`gcloud compute url-maps invalidate-cdn-cache` on the URL map the script creates).

### Frontend after upload

Set `cdnBaseUrl` in `frontend/src/environments/environment.prod.ts` to **`STATIC_MAPS_CDN_BASE`** (no trailing slash). Leave `staticAllMapImageUrl` empty to use `{cdnBaseUrl}/geodistricts-all-119.webp`. The build script prints the same hints when it finishes.

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

From repo root you can also run `npm run generate:state-map-rasters`. In VS Code, use **Run and Debug** → `Debug generate-state-map-rasters` (same paths; workspace folder must be the repo root). For landing JSON from a running API instead of a file, use `Debug generate-state-map-rasters (GET_MAPS_LANDING_URL)` and set the URL in `.vscode/launch.json` if needed.

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
