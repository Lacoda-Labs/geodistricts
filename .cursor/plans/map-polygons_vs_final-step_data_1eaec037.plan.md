---
name: Map-polygons vs final-step data
overview: Confirm that local and public both use GET /api/algorithm/map-polygons/:state for the selected-state view; compare what that endpoint returns vs what the maps page needs; and optionally extend map-polygons to include per-district population so the page can be built from that endpoint alone when final-step is unavailable.
todos: []
isProject: false
---

# Map-polygons endpoint: local vs public and data completeness

## Confirmation: both use the same endpoint

**Local and public use the same flow** when a state is selected (no CDN static JSON):

1. [loadMapPolygons()](frontend/src/app/pages/maps-page.component.ts) calls **GET /api/algorithm/map-polygons/:state** (no `overview` for single-state view; overview is used only for All-states map).
2. On success, the frontend:
  - Sets `mapPolygons`, `mapPolygonsState`, `isVisualizationOnly`, and if `hasFinalStep && finalDistrictPolygons?.length`, builds a **fallback** step via [mapPolygonsResponseToStepData()](frontend/src/app/pages/maps-page.component.ts) and sets `currentStep` (step index 0), `loadedSteps`, `algorithmResult`, so the **district list** and map render.
  - Calls **loadVisualizationState()**, which calls **GET /api/algorithm/final-step/:state**. If that succeeds, it overwrites `currentStep` (and related state) with full step data (districtGroups with population, variance, etc.).
  - If `hasFinalStep && finalStepNumber != null`, also calls **GET district-party** for map colors.

So the **same** map-polygons endpoint is used on local and public. The difference is:

- **Local**: final-step (and often district-party) usually succeed (local cache or Firestore has step docs), so the list and header get full population/variance/party.
- **Public**: final-step often fails (no step docs in production Firestore/GCS), so the UI relies on the map-polygons fallback only: district list shows (from polygons), but **population stays 0** because map-polygons does not return population.

## What map-polygons returns today

Backend [GET /api/algorithm/map-polygons/:state](backend/index.js) reads a single GCS blob `map_polygons_${state}` (or `_overview` when `overview=true`). The blob is written in [build-all-union-polygons](backend/index.js) and currently contains only:

- `statePolygon` (GeoJSON)
- `finalDistrictPolygons` (array of GeoJSON features — geometry only, no population)
- `hasFinalStep`
- `finalStepNumber`

So the endpoint does **not** currently have all data needed for the selected-state maps page: it has no per-district **totalPopulation** (or variance). The frontend therefore sets `totalPopulation: 0` in [mapPolygonsResponseToStepData()](frontend/src/app/pages/maps-page.component.ts) for each group, which yields zero state population and target in the header.

## What’s needed for “full” selected-state view without final-step

To build the maps page for a selected state from **map-polygons only** (no final-step), the client needs at least:

- State outline + final district polygons (already provided).
- **Per-district totalPopulation** (and ideally variance) so the header and district list show correct totals and variance.

Party data can continue to come from **GET district-party** (already called when `hasFinalStep && finalStepNumber != null`).

## Option: extend map-polygons blob and API with district summaries

When writing the `map_polygons_${state}` blob, the backend already has `groups` (districtGroups from the step cache) with `startDistrictNumber`, `endDistrictNumber`, and `totalPopulation`. Today it only pushes polygon geometry into `finalDistrictPolygons` and does not persist population.

**Backend:**

- In the blob write (same place that sets `finalDistrictPolygons`), add a **districtSummaries** array: one entry per group, in the same order as `finalDistrictPolygons`, e.g. `{ startDistrictNumber, endDistrictNumber, totalPopulation }` (and optionally variance if easily available).
- In **GET /api/algorithm/map-polygons/:state**, include `districtSummaries` in the JSON response when present.

**Frontend:**

- Extend [MapPolygonsResponse](frontend/src/app/services/geodistrict-algorithm.service.ts) with an optional `districtSummaries?: Array<{ startDistrictNumber: number; endDistrictNumber: number; totalPopulation: number }>`.
- In [mapPolygonsResponseToStepData()](frontend/src/app/pages/maps-page.component.ts), when building districtGroups from `response.finalDistrictPolygons`, if `response.districtSummaries` exists and length matches, set each group’s `totalPopulation` (and variance if provided) from the corresponding summary instead of 0.

Result: when the map-polygons blob includes district summaries (after a one-time rebuild of blobs or for new states), the selected-state maps page can show the correct district list and population totals from **map-polygons + district-party** alone, without requiring GET final-step to succeed on the public site.

## Summary


| Item                                  | Local                                                              | Public                                         | Notes                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint used for selected state      | GET map-polygons/:state                                            | Same                                           | Same code path.                                                                                                                 |
| District list source                  | map-polygons fallback or final-step                                | map-polygons fallback (final-step often fails) | List shows in both; population only when final-step succeeds.                                                                   |
| Map-polygons payload today            | statePolygon, finalDistrictPolygons, hasFinalStep, finalStepNumber | Same                                           | No population in response.                                                                                                      |
| Enabling “all data from map-polygons” | Optional                                                           | Optional                                       | Add districtSummaries to blob + API and use it in mapPolygonsResponseToStepData so population/variance show without final-step. |


