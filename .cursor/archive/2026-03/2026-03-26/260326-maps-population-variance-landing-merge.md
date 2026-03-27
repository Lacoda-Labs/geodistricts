# 260326

## 2357 maps population variance public vs local and fix

### Prompt

1. why is district population for each district 0 (on public maps page) when local shows population and variance?

2. how to fix so selected state on maps page shows district population and variance

3. /archive

### Response / actions

Plan (related): [.cursor/plans/map-polygons_vs_final-step_data_1eaec037.plan.md](../../../plans/map-polygons_vs_final-step_data_1eaec037.plan.md)

**Explained**: Public `/maps` loads `map-polygons` then `final-step`. Population in the table comes from `districtGroups[].totalPopulation` after `final-step` replaces the fallback, or from `districtSummaries` on the map-polygons payload when lengths match. Zeros on public with good local numbers usually means production `final-step` fails or returns empty counts while blobs lack `districtSummaries`, or algorithm/cache version mismatch; variance uses the same `totalPopulation` vs `statePopulation` target.

✅ **IMPLEMENTED**: **Backend** `buildMapsLandingPayload` in `backend/index.js` now includes `districtSummaries` in each `polygonsByState` entry when the cached map-polygons blob has them (landing had been dropping summaries).

✅ **IMPLEMENTED**: **Frontend** `maps-page.component.ts` adds `mergeDistrictPopulationFromMapPolygonsSummaries(step)` and runs it after successful `getFinalStep` before building `algorithmResult`; for each group with missing/zero population, fills from `this.mapPolygons.districtSummaries` when array lengths match.

**Ops checklist** (for production): ensure GCS `map_polygons_{STATE}` blobs include `districtSummaries` (re-run union/map-polygons job); verify `GET /api/algorithm/final-step/:state` returns 200 with populations or rely on summaries fallback; redeploy API + frontend; regenerate maps landing via `POST /api/admin/maps-landing/generate` after blobs update.
