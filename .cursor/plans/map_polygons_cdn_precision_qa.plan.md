---
name: Map polygons CDN vs Run and precision Q&A
overview: CDN vs Run tradeoffs; overview precision (implemented); practical rollout order; optional TopoJSON via query param; phased /maps All-states load (state outlines + party fill first, then district polygons with existing stagger).
todos:
  - id: topojson-api
    content: "Backend: add `format` query param to map-polygons (and optionally maps/landing polygon sections) — `geojson` (default) vs `topojson`; emit Topology + client decode"
    status: completed
  - id: state-only-endpoint
    content: "Backend: fast path `map-polygons/:state?stateOnly=true` (or batch `maps/state-outlines`) — state boundary only, no `map_polygons_*` blob read"
    status: completed
  - id: maps-phase1-ui
    content: "Frontend: phase 1 — load party summaries + state outlines, fill `stateOutlinesLayer` with `getTractColorByParty(pctDem)` (same hue scale as districts); shuffle order; no long stagger"
    status: completed
  - id: maps-phase2-ui
    content: "Frontend: phase 2 — after all state layers drawn, run existing overview map-polygons + district-party fetch and district reveal stagger; avoid duplicate state outline or fade/remove state fill"
    status: completed
  - id: landing-branch
    content: Align `applyLandingData` All-states path with two-phase behavior (or document exception if landing stays instant full render)
    status: completed
  - id: qa-states
    content: "Visual QA: TX/CA/AK + DC/small states; check TopoJSON decode parity vs GeoJSON"
    status: completed
isProject: false
---

# Map polygons: CDN, precision, TopoJSON, and phased /maps load

## Context: WebP off

Static **WebP rasters** trade **lossy compression** for fewer bytes and no client-side GeoJSON parse. If quality was unacceptable, disabling them is reasonable. **Vector polygons** (GeoJSON) avoid that artifact class but cost more bytes and JS work (parse + Leaflet paths). “Faster” depends on which bottleneck dominates: **network**, **main-thread JSON parse**, or **draw**.

---

## CDN (public object) vs current Cloud Run `map-polygons`


| Dimension                   | **Public GCS object + CDN** (same JSON file) | **Today: `GET .../api/algorithm/map-polygons/:state`**       |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| **Data path**               | Browser → CDN edge → (miss) → bucket         | Browser → Cloud Run → `cloudStorageCache.get` → `res.json()` |
| **Payload**                 | Identical if the file is the same blob       | Same JSON body                                               |
| **Latency (repeat visits)** | Edge cache, geographic distribution          | Region-bound Run; client cache-busting (`?_=`) limits reuse  |
| **Cost / scale**            | No Run CPU per cached hit                    | Per-request Run + GCS read                                   |


**Summary:** CDN helps **delivery and cost** for cacheable bytes, not raw “faster than vectors.” See [doc/pages/STATIC_MAPS_CDN.md](doc/pages/STATIC_MAPS_CDN.md).

---

## Coordinate precision (already implemented)

- **Overview blobs:** `map_polygons_{STATE}_overview` — `simplifyUnionGeometry` with **4 decimals**, dedupe, **Douglas–Peucker 0.0001** ([backend/index.js](backend/index.js) ~6961–6983).
- **API:** `?overview=true` / `?for=all` selects overview blob (`[getMapPolygonsForState](backend/index.js)`).
- **Full blob:** `map_polygons_{STATE}` — district geometry as in union cache; **statePolygon** in overview is currently the **same** object as full blob (districts simplified, outline not).

Further tuning (overview-only): 3 decimals or slightly larger tolerance — watch **shared-edge** artifacts when zooming in; consider simplifying **statePolygon** inside overview if outlines dominate size.

---

## Practical recommendations (execution order)

1. **Phased /maps load (below)** — biggest perceived win: map appears immediately with **correct state-level party tint** while districts stream.
2. **Optional `?stateOnly=true` or one bundled `state-outlines` artifact** — avoids reading full `map_polygons_`* per state for phase 1.
3. **Overview geometry tuning + QA** — cheap server-side change; validate on TX/CA/AK.
4. **TopoJSON opt-in (`?format=topojson`)** — measure JSON size and **main-thread** decode cost; wins are largest when many **adjacent** polygons share arcs (districts within a state), less for unrelated state outlines.
5. **CDN/versioned static JSON** — after formats stabilize; pair with **immutable** URLs (no `?_=` on hot path).

Implementation todos are listed in the plan frontmatter (`todos:`) for tracking.

---

## Optional encoding: query parameter for TopoJSON / shared arcs

**Goal:** Same semantic features as GeoJSON, smaller wire size when arcs dedupe well.

**API (proposed):**

- `GET /api/algorithm/map-polygons/:state?overview=true&format=topojson` (default `format=geojson` when omitted).
- Optionally the same flag on **bundled** endpoints that return many states (e.g. maps landing polygon sections), if implemented as a single Topology containing multiple named objects (`states`, `districts`).

**Backend:**

- Build a GeoJSON `FeatureCollection` from the same structures returned today, then convert to TopoJSON Topology (e.g. `topojson-server` / `geo2topo` in Node), with a stable **quantization** parameter (document chosen `q` or use default that matches ~4–5 decimal visual fidelity).
- **Content-Type:** `application/json`; include a discriminator in JSON (`type: "Topology"`) so clients can branch without relying on header alone.

**Frontend:**

- Add `topojson-client` (or lightweight fork) to **decode** Topology → GeoJSON before `L.geoJSON(...)`.
- Extend `[geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)` `getMapPolygons` to pass `format` and parse response accordingly.

**Note:** “Shared-arc encoding” **is** TopoJSON’s arc list; no separate flag required unless you later add **MVT** or **protobuf** — out of scope unless requested.

---

## /maps All-states load: two-phase UX

**Terminology:** “State union polygon” here means the **single state boundary** (`statePolygon` from map-polygons / TIGER), shown as **one filled region per state** — not per-district union polygons.

### Current behavior (reference)

- `[loadUSMapDistricts](frontend/src/app/pages/maps-page.component.ts)`: `forkJoin` over **per-state** `getMapPolygons(overview)` **and** district-party when applicable; **only after all complete**, `[revealUSMapStatesInShuffledOrder](frontend/src/app/pages/maps-page.component.ts)` runs: for each state in shuffled order, adds **state outline** on `stateOutlinesLayer` (fixed gray fill `[addUSMapRevealItem](frontend/src/app/pages/maps-page.component.ts)` ~971–981), then **staggered** districts on `tractLayer`.
- State outlines use `**fillColor: '#888'`**, not party shading. Districts use `[getUSMapDistrictFillColor](frontend/src/app/pages/maps-page.component.ts)` → `getTractColorByParty(pctDem)` from district data, falling back to `[statePartySummaries](frontend/src/app/pages/maps-page.component.ts)` state `pctDem`.

### Target behavior

1. **Phase A — state layer immediately (no long wait for districts)**
  - Ensure **state-level party** is available: reuse `[statePartySummaries](frontend/src/app/pages/maps-page.component.ts)` (static `[maps-landing-summaries.json](frontend/public/maps/maps-landing-summaries.json)` path and/or `[MAPS_LANDING_SUMMARIES_URL](frontend/src/app/pages/maps-page.component.ts)`) — already loaded for the table.  
  - Fetch **only state boundaries** quickly: prefer **one bundled JSON** (e.g. admin-generated `us_state_outlines.geojson` on CDN or `GET /api/maps/state-outlines`) *or* parallel `**map-polygons/:state?stateOnly=true`** so the server reads **state boundary cache** only and skips the large `map_polygons_`* document.  
  - **Clear** `stateOutlinesLayer`, then add each state’s `statePolygon` with fill from `**getTractColorByParty(summary.pctDem)`** (same scale as districts) and opacity consistent with district fill (reuse `[polygonFillOpacity](frontend/src/app/pages/maps-page.component.ts)` and/or `[getStatePartyOpacity](frontend/src/app/pages/maps-page.component.ts)` — pick one rule and document).  
  - **Random order:** shuffle state codes (same `[shuffleArray](frontend/src/app/pages/maps-page.component.ts)` as today). **No** multi-second stagger between states: add outlines **as soon as** phase-A data is ready (single bundle = one paint; parallel fetches = paint on completion in arbitrary order, or micro-order by shuffled index with `requestAnimationFrame` if a brief visual sequence is desired).
2. **Phase B — district polygons (current semantics)**
  - After **all** state outlines from phase A are on the map, start the **existing** `forkJoin` of `getMapPolygons(state, { overview: true })` + `getDistrictParty` per state.  
  - Reuse `[revealUSMapStatesInShuffledOrder](frontend/src/app/pages/maps-page.component.ts)` for **districts only** with the **same** `US_MAP_REVEAL_DELAY_MS` stagger as today (~30s total across ~435 districts).  
  - **Visual transition:** when a state’s first district appears, either **remove** that state’s phase-A fill on `stateOutlinesLayer` or **fade** it so districts sit on top without muddy double-fill. `[renderUSMapDistricts](frontend/src/app/pages/maps-page.component.ts)` currently clears `**tractLayer`** only — keep state outline layer behavior explicit in implementation.
3. **Landing path**
  - `[applyLandingData](frontend/src/app/pages/maps-page.component.ts)` today applies **all** outlines + districts in one pass. Either:  
    - **Adopt** the same two-phase reveal for parity, or  
    - **Document** that landing remains “instant full render” for performance when the monolithic payload already exists.

### Backend touchpoints for phase A

- New `**stateOnly`** (or `**parts=state`**) on `[GET /api/algorithm/map-polygons/:state](backend/index.js)`: return `{ statePolygon, hasFinalStep: false, finalDistrictPolygons: [], ... }` using `[getOrCreateStateBoundaryInCloudStorage](backend/index.js)` / existing boundary keys — **avoid** `map_polygons_${state}` read.  
- **Optional:** single `**maps/us-state-outlines.json`** blob in GCS + optional CDN for **one HTTP** round trip.

---

## Earlier optional follow-ups

1. Versioned CDN URLs for overview JSON + `immutable` cache; wire `[cdnBaseUrl](frontend/src/environments/environment.prod.ts)` if product wants direct browser fetch.
2. Measure p95 TTFB + JSON parse: Run vs CDN, GeoJSON vs TopoJSON.
3. Simplify `**statePolygon`** inside `map_polygons_*_overview` write path if profiling shows outline-heavy payloads.

