---
name: Static maps + image default
overview: Shift maps-page read-only data and default rendering off Cloud Run onto versioned static assets (small JSON in-app or CDN), serve **all map raster images (WebP) from CDN only**, reuse or generalize the Sharp-based polygon→WebP pipeline, and add an explicit image vs Leaflet mode where polygons load only from the backend when the user chooses interactive maps.
todos:
  - id: extract-webp-lib
    content: Extract shared polygon→raster→WebP helpers; extend all-US + per-state generators; emit stateMapImageUrl as CDN-ready paths; document upload step to CDN/GCS bucket (same origin as cdnBaseUrl)
    status: completed
  - id: static-summaries-fe
    content: "Add build-produced maps-landing-summaries JSON to frontend assets; maps-page ngOnInit + tryLandingForTableOnly: load assets first, API fallback for dev"
    status: completed
  - id: image-leaflet-toggle
    content: Default image mode (signals); UI toggle to Leaflet; on switch init map and reuse BE polygon endpoints (landing full / loadUSMapDistricts / map-polygons)
    status: completed
  - id: prod-env-cdn
    content: "Prod/deploy: set cdnBaseUrl; national WebP URL (staticAllMapImageUrl or derived from cdnBaseUrl); per-state JSON with stateMapImageUrl pointing at CDN paths; long-cache headers on CDN bucket; document regen when congress119Party changes"
    status: completed
  - id: home-note
    content: "Document: current home hero needs no BE move; future non-hero UsCongressionalMap would need congressional-boundaries static or proxy"
    status: completed
isProject: false
---

# Static-first maps architecture (performance / GCP spend)

## Current behavior (baseline)

**Maps page** (`[frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)`):

- **On every visit**, `ngOnInit` always calls the API: `[STATE_COMPARISON_URL](frontend/src/app/pages/maps-page.component.ts)`, `[STATE_PARTY_SUMMARIES_URL](frontend/src/app/pages/maps-page.component.ts)` (same host as `environment.apiUrl`).
- **All states + static raster** (`useStaticAllMap`): shows `[staticAllMapImageUrl](frontend/src/app/pages/maps-page.component.ts)` / CDN WebP; table data from `[tryLandingForTableOnly()](frontend/src/app/pages/maps-page.component.ts)` → `GET /api/maps/landing/summaries` (backend reads GCS and applies `[applyFreshCongress119ToComparisonPayload](backend/index.js)`).
- **All states + Leaflet**: `[loadUSMapDistricts()](frontend/src/app/pages/maps-page.component.ts)` (many per-state calls) and/or `[tryLandingThenLoadUSMapDistricts()](frontend/src/app/pages/maps-page.component.ts)` → full `GET /api/maps/landing` with `polygonsByState`.
- **Single state**: if `cdnBaseUrl` is set, tries `{cdnBaseUrl}/states/{code}.json` (`[StaticStatePayload](frontend/src/app/pages/maps-page.component.ts)`); else `[proceedWithStateViewLoadMap()](frontend/src/app/pages/maps-page.component.ts)` → Leaflet + map-polygons API.

Prod env today (`[frontend/src/environments/environment.prod.ts](frontend/src/environments/environment.prod.ts)`) has **empty** `cdnBaseUrl` and `staticAllMapImageUrl`, so the public site leans on **Cloud Run** for comparison/summaries and polygon loads.

**Home page** (`[frontend/src/app/pages/home-page.component.ts](frontend/src/app/pages/home-page.component.ts)`): no `HttpClient` / API usage. The hero uses `[UsCongressionalMapComponent](frontend/src/app/components/us-congressional-map.component.ts)` with `variant="hero"`, which calls `[loadStaticHero()](frontend/src/app/components/us-congressional-map.component.ts)`: local `**assets/hero-conus-119.webp`** + `**assets/hero-conus-119.json`** only. **Worth moving to FE static assets:** nothing additional for the current home layout; only if you later add a **non-hero** `UsCongressionalMap`, that path uses `[CongressionalBoundariesService](frontend/src/app/services/congressional-boundaries.service.ts)` → `**/api/congressional-boundaries/...`** (then GitHub fallback)—that would be a candidate to static-ize.

## Polygon → WebP (already exists)

`[backend/scripts/generate-geodistricts-all-raster.js](backend/scripts/generate-geodistricts-all-raster.js)` already turns **GeoJSON polygons** from `maps_landing` into `**geodistricts-all-119.webp`** using **Sharp** (project rings to 800×500, fill by party). There is **no** separate tiny “utility function” in the repo today; the logic is embedded in that script.

**Plan for your requirement:** extract a small shared module (e.g. `backend/lib/polygon-raster-webp.js`) with: project bounds, ring→path, render to raster, `sharp().webp()`—used by the existing all-US script and a **new** per-state generator that outputs WebPs + optional manifest for `stateMapImageUrl` fields in `[generate-state-static-json.js](backend/scripts/generate-state-static-json.js)`.

## Static payloads (no polygons in the FE bundle)

- **Table / comparison data:** mirror the shape of `[MapsLandingSummariesResponse](frontend/src/app/pages/maps-page.component.ts)` (and the same `applyFreshCongress119` semantics **at build time** when generating the file, since the runtime API merges fresh 119th counts from `[congress119Party](backend/data/congress-119-party.json)`).
- **Ship as:** `frontend/src/assets/maps/maps-landing-summaries.json` (or versioned filename + env) **and/or** upload the same JSON to CDN; **load via `HttpClient.get('assets/...')` first**, optional fallback to `GET /api/maps/landing/summaries` for local dev or when the asset is missing.
- **Polygons:** do **not** embed `polygonsByState` in the Angular app; keep them **only** behind the existing backend (or a public GCS JSON URL if you want zero Run **without** putting megabytes in the repo—still “static,” not dynamic API).

Per-state `[StaticStatePayload](frontend/src/app/pages/maps-page.component.ts)` is already **geometry-free** (only metadata + `stateMapImageUrl`). **Map images (national + per-state WebP): serve only from CDN**—upload build artifacts to the same bucket/path convention the app already expects (e.g. `{cdnBaseUrl}/geodistricts-all-119.webp`, `{cdnBaseUrl}/states/CA.webp` or whatever the generator emits). Set `**stateMapImageUrl`** in generated `states/{code}.json` to **absolute CDN URLs** (or paths relative to `cdnBaseUrl` if the frontend always prefixes consistently). Do **not** add large WebPs to `frontend/src/assets`; keep the Angular bundle lean.

**Home hero** (`hero-conus-119.webp`) can stay in `assets/` for now or move to the same CDN for one consistent origin and cache policy—optional follow-up, not required for maps savings.

## Leaflet / image toggle (product behavior)

Today, All-states **image vs Leaflet** is mostly **environment-driven** (`staticAllMapImageUrl` + `onStaticAllMapError` fallback), not a user control. The Leaflet toolbar toggles are **tracts / division lines / opacity**, not raster vs vector.

**Target behavior:**

```mermaid
flowchart LR
  subgraph default [Default public UX]
    A[Image mode] --> B[CDN WebP + static summaries JSON]
  end
  subgraph onDemand [User chooses Interactive]
    C[Leaflet mode] --> D[Init Leaflet]
    D --> E[Fetch polygons from BE]
    E --> F[Existing renderUSMapDistricts / map-polygons paths]
  end
```



- **Default:** `mapDisplayMode = 'image'` (signal): show All-state WebP from **CDN** (and per-state WebP URLs from static state JSON, also CDN); **no** Leaflet init until needed.
- **Toggle “Interactive map”:** switch to Leaflet; call existing loaders—**full** `maps/landing` or sequential `map-polygons` + district-party as today—**only in this mode** (satisfies “if leaflet requires polygons, fetch using BE endpoint”).
- **Persistence:** optional `localStorage` for power users; default remains image for cold visitors (max savings).

**Implementation touchpoints:** `[maps-page.component.html](frontend/src/app/pages/maps-page.component.html)` (control next to map), `[maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)` (guard `initializeMap`, branch `ngAfterViewInit` / `onStateChange`), and SCSS for the control when the map container is an `<img>`.

## GCP / cost impact (intent)

- **Eliminate** routine `GET /api/maps/state-comparison`, `state-party-summaries`, and `landing/summaries` for anonymous maps browsing by serving the same bytes from **Firebase Hosting / CDN / GCS static** with long cache headers. **Raster map images** are always **CDN (or GCS behind CDN)**, not Cloud Run.
- **Reserve Cloud Run** for: interactive Leaflet path, `/dev/maps`, algorithm execution, cache invalidation, and any endpoint that must stay dynamic.

## Risks / decisions to lock in implementation

- **119th freshness:** today the API merges `[congress119Party](backend/data/congress-119-party.json)` on read. Static JSON must be **regenerated** when that file or comparison logic changes (document in release checklist).
- **Asset size:** 50 state WebPs + one national WebP are **CDN-hosted** by design; small **summaries JSON** may live in Angular `assets/` or on CDN—either is fine for bytes; images are **not** in the app bundle.
- `**/dev/maps`:** keep current Leaflet-first or full API behavior so debugging is unchanged.

