# 260401

## 2327 map polygons topojson phased maps

### Prompt

/archive

### Response / actions

Session (prior turns in same chat, summarized here): HAR analysis for `/maps` load timing; whether map-polygons is served via CDN vs Cloud Run; WebP vs vector tradeoffs; coordinate precision / overview blobs; plan updates for practical rollout, optional `format=topojson`, and two-phase All-states map (party-colored state outlines first, then staggered districts); user asked to execute the plan (“do the plan”).

Plan: [.cursor/plans/map_polygons_cdn_precision_qa.plan.md](.cursor/plans/map_polygons_cdn_precision_qa.plan.md)

✅ **IMPLEMENTED** (codebase):

- **Backend:** [`backend/utils/map-polygons-topojson.js`](backend/utils/map-polygons-topojson.js); `GET /api/algorithm/map-polygons/:state` supports `stateOnly=true` / `parts=state` (state boundary only, no `map_polygons_*` read) and `format=topojson` (Topology with `statePolygon` + `districts` objects); dependency `topojson-server`. JSDoc updated on the route in [`backend/index.js`](backend/index.js).
- **Frontend:** [`geodistrict-algorithm.service.ts`](frontend/src/app/services/geodistrict-algorithm.service.ts) — `getMapPolygons` options `stateOnly`, `format: 'topojson'`, decode via `topojson-client`; [`frontend/src/topojson-client.d.ts`](frontend/src/topojson-client.d.ts). [`maps-page.component.ts`](frontend/src/app/pages/maps-page.component.ts) — phase A parallel `stateOnly` fetches + shuffled party-colored state outlines; phase B existing overview + district-party `forkJoin` and staggered district reveal with `districtsOnly: true`; remove phase-A outline when first district draws; `applyLandingData` aligned to two-phase; `refreshUSMapStateOutlineFills` when summaries arrive; clear `usMapStateOutlineLayerByCode` on relevant resets. Dependency `topojson-client`.
- **`ng build`** verified for the frontend.

To publish archive to GitHub Pages: `./scripts/sync-archive-to-docs.sh` and commit `docs/archive/`.
