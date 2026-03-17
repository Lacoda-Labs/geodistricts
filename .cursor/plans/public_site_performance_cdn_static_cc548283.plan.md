---
name: Public site performance CDN static
overview: "Improve public site performance by moving to CDN-served static assets: per-state JSON with geodistrict metadata and static raster images for the All-states map and state views; convert the All-states map from Leaflet polygons to hero-style raster display; on state view hide the step bar and add a district list with population/variance and leading-party % column with party fill color."
todos: []
isProject: false
---

# Public Site Performance: CDN Static Assets and UI Changes

## Goals

- **Reduce payload and compute**: Serve final-step data and images from CDN (static JSON + images) instead of Firestore/Cloud Storage API reads.
- **All-states map**: Same format as hero US map (static image) instead of Leaflet + polygon GeoJSON.
- **State selected view**: Hide step bar; show district list with population/variance and leading-party % column with party-colored background.

---

## 1. Data model: static site assets

**Per-state static JSON** (e.g. `{cdnBase}/states/{stateCode}.json` or baked into build):

- State metadata: `stateCode`, `stateName`, `districtCount`, `targetPopulation`, `finalStepNumber`.
- `geodistricts`: array of `{ groupKey, startDistrictNumber, endDistrictNumber, population, variance, pctDem, pctRep, leadingParty, leadingPartyPct, imageUrl? }`.
- Optional: `stateMapImageUrl` (single raster of state with all districts colored).

**US-wide static asset for All view**:

- One raster image (e.g. `geodistricts-all-119.webp`) with CONUS (and optionally AK/HI) with geodistricts colored by party, same projection/view as [hero](frontend/src/app/components/us-congressional-map.component.html) (`assets/hero-conus-119.webp`, viewBox 800×500).
- Optional: small JSON for state boundaries or click regions (e.g. state bounding boxes or simplified polygons) for “click state to go to state view.”

**Party colors** (must match map): Reuse existing scale in [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (`getTractColorByParty`, `DEMOCRATIC_STOPS`, `REPUBLICAN_STOPS`) so table column background and map fills stay in sync.

---

## 2. All states map: Leaflet → hero-style raster

**Current behavior** ([maps-page](frontend/src/app/pages/maps-page.component.html)): When `selectedState === 'ALL'`, the page uses a single Leaflet map (`#usMap`) and [renderUSMapDistricts](frontend/src/app/pages/maps-page.component.ts) to draw GeoJSON polygons from landing/polygons API, with party fill and popups; click switches to state.

**Target behavior**:

- When “static All map” is available (e.g. CDN or asset): **Do not** create or use Leaflet for the All view. Render a **single image** in the same section (e.g. same container as current `#usMap`), same aspect/layout as the [hero map](frontend/src/app/pages/home-page.component.html) (raster only, no SVG overlay required for All).
- **Click-to-state**: Implement via one of:
  - **Image map** (`<map>`/`<area>`): backend or build step emits an HTML image map from state boundaries (or simplified boxes) so each state is a clickable region.
  - **Overlay**: Transparent overlay (e.g. SVG or divs) with state hit areas keyed by state code; on click set `selectedState` and run existing `onStateChange()`.
- **Tooltip/popup**: State name and summary (e.g. D/R breakdown) from the same static JSON used for the table (state rows); no polygon-based popup.

**Implementation notes**:

- Add a “static All map” mode: e.g. load `geodistricts-all-119.webp` (and optional JSON for state list/click regions) from CDN or `assets/`. Prefer CDN URL from environment.
- In maps-page, when `selectedState === 'ALL'` and static asset is enabled: render `<img>` (and optional `<map>` or overlay) instead of initializing Leaflet; keep existing state table and state-row behavior.
- If static asset is missing or fails, keep current fallback: call existing `tryLandingThenLoadUSMapDistricts()` and use Leaflet + polygons as today.

**Raster generation (build pipeline)**:

- New script or extension of [buildMapsLandingPayload](backend/index.js) / [generate-maps-landing](backend/scripts/generate-maps-landing.js): from `polygonsByState` (or maps_landing) + party colors, render one raster (e.g. Node with `node-canvas` or similar, or headless map library) in the same coordinate system as hero (CONUS 800×500), output WebP/PNG. Optionally generate state bounding boxes or image map for clicks. Upload to GCS/CDN and reference from frontend config.

---

## 3. State selected map: step bar and district list

**Hide step bar**  

- In [maps-page.component.html](frontend/src/app/pages/maps-page.component.html), the `[.info-header-step-bar](frontend/src/app/pages/maps-page.component.html)` (lines 85–95) is inside the state view block (`selectedState !== 'ALL'`). Hide it for the **public** experience (e.g. when `!isDevMode` or when using static state data). For example: `*ngIf="isDevMode"` on the step bar wrapper so only `/dev/maps` shows it; public `/maps` state view does not.

**District list with population/variance and leading-party %**  

- The state view already has a [district-groups-table](frontend/src/app/pages/maps-page.component.html) (District, Population when not final step, Variance, Party). Keep **Population** (when final step: keep showing it for clarity) and **Variance**.
- **Party column**: Show the **leading party percentage** (e.g. “D 54.2%” or “R 61%”) with a **solid background fill** equal to the same party color used on the map for that district. Use existing `getTractColorByParty(districtPartyByGroupKey[groupKey].pctDem)` so the cell’s background matches the geodistrict fill. Text color should remain readable (e.g. dark text or white on strong colors).
- Ensure the table is visible when on final step and data is from API or static JSON (no dependency on step bar).

---

## 4. Static images per geodistrict / state

- **State view**: “Each geodistrict has … static image file that is displayed in same way hero us map displays districts.” Hero displays one CONUS raster. For state view, the minimal approach is **one static image per state** (state map with all districts colored), shown in the map area when static mode is on, instead of Leaflet polygons. Optional: per-district thumbnails if needed later.
- **Build**: Extend pipeline to generate, per state with final step, one raster (e.g. state bbox, districts colored by party), and optionally per-district images. Store under CDN path; reference in per-state JSON (`stateMapImageUrl`, and optionally `geodistricts[].imageUrl`).

---

## 5. Frontend data source: static vs API

- **All view**: Prefer static US image + static state list/click data (CDN). If absent, keep current `GET /api/maps/landing` and Leaflet rendering.
- **State view**: When opening a state, prefer loading per-state static JSON from CDN (if configured). If present, use it for district list (population, variance, party %) and optionally show state static image instead of Leaflet. If absent, keep current flow (map-polygons, steps, district-party API).
- **Environment**: Add a CDN base URL (e.g. `GEODISTRICTS_CDN_URL` or in `environment`) for static JSON and images; frontend uses it when building asset URLs.

---

## 6. File and component touch points


| Area                                   | Files / locations                                                                                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All map: use raster instead of Leaflet | [maps-page.component.html](frontend/src/app/pages/maps-page.component.html) (map section), [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (init Leaflet only when not All or not static; load static image + click overlay/image map) |
| Step bar visibility                    | [maps-page.component.html](frontend/src/app/pages/maps-page.component.html) (`.info-header-step-bar` → add `*ngIf="isDevMode"` or equivalent)                                                                                                                  |
| District table: party column style     | [maps-page.component.html](frontend/src/app/pages/maps-page.component.html) (district-groups-table Party cell), [maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss) (cell background from `getTractColorByParty`)                      |
| Party color helper (leading %)         | [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (e.g. `getLeadingPartyPct(group)` and reuse `getTractColorByParty`)                                                                                                                    |
| Static US image + click                | New or existing asset URL config; optional image map or overlay component                                                                                                                                                                                      |
| State static JSON / state image        | New data loader when CDN base is set; optional state-map image in state view                                                                                                                                                                                   |
| Raster generation                      | New script under `backend/scripts/` (e.g. generate all-states raster from polygons + party; optional per-state rasters)                                                                                                                                        |
| CDN / env                              | [environment](frontend/src/environments/) and backend config for CDN base URL                                                                                                                                                                                  |


---

## 7. Order of work (suggested)

1. **State view UI (no new data pipeline)**
  - Hide step bar for public (`*ngIf="isDevMode"`).  
  - Add leading-party % column with solid party background in district table (using `getTractColorByParty`).
2. **Static All map (frontend)**
  - Add CDN/base URL and “static All map” flag.  
  - When All and static enabled: show raster image in map section; implement click (image map or overlay) to set state and keep table; keep Leaflet as fallback when static fails or is disabled.
3. **Raster generation (build)**
  - Implement script to produce `geodistricts-all-119.webp` (and optional state rasters) from polygons + party data; upload to GCS/CDN.
4. **Per-state static JSON and state image**
  - Define schema; generate from existing maps_landing / map_polygons / district_party.  
  - Frontend: when CDN state JSON exists, use it for district list and optionally show state raster instead of Leaflet in state view.

