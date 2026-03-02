---
name: Census tracts endpoint and dev/maps
overview: Add a dedicated backend GET endpoint that returns census tract data for a state (from cache or by fetching), and on /dev/maps use this endpoint to populate the tract list instead of relying on step 0's response.
todos: []
isProject: false
---

# Census Tract Endpoint and /dev/maps Integration

## Current behavior

- Tract list on /dev/maps is driven by [tractsByCountyForList](frontend/src/app/pages/maps-page.component.ts) (getter at ~5819), which reads from `currentStep.districtGroups[].censusTracts` when `currentStepIndex === 0`.
- Step 0 is fetched without `polygonsOnly` in dev specifically to get `censusTracts` for this list ([goToFirstStep](frontend/src/app/pages/maps-page.component.ts) ~2438–2474).
- Backend tract data comes from `loadTractsFromStateTractCache(state)` or, on cache miss, the same external fetch used in POST [step-by-step](backend/index.js) (tract-boundaries, counties, tract-data/bulk, createCanonicalTractMap, enclosed detection); state tract cache is written after building step 0 in that flow.

## Target behavior

- **New backend endpoint** returns census tract data for a state only (no step 0).
- **/dev/maps** calls this endpoint to populate the tract list; step 0 can be requested with `polygonsOnly: true` for the map only, keeping payloads smaller.

---

## 1. Backend: new GET endpoint

**Route:** `GET /api/algorithm/census-tracts/:state`

**Location:** [backend/index.js](backend/index.js) — add alongside other algorithm routes (e.g. near `GET /api/algorithm/step/:state/:stepNumber` around 5807).

**Behavior:**

1. **Cache path:** Call existing `loadTractsFromStateTractCache(state)`. If result is non-null, return `200` with body `{ tracts: fromCache.tracts }`. No `islandTractsData` from cache (only step 0 stores that).
2. **Cache miss path:** Reuse the same fetch pipeline as in [step-by-step](backend/index.js) (lines ~5152–5190):
  - `getTractCount(state)`; then either `fetchTractBoundariesForState(state)` or GET tract-boundaries + GET counties + POST tract-data/bulk.
  - `createCanonicalTractMap(demographicData, boundaries, state)` → `tracts = canonicalResult.geoJsonFeatures`.
  - Run enclosed-tract detection and assign `ENCLOSED_BY` / `TRACT_GROUP_ID` (same block as step-by-step ~5196–5254).
  - Optionally run step-0 island detection (single group of all tracts) so response can include `islandTractsData` for UI icons and step-0 isolated panel. If not included in v1, frontend can omit island icons when using the new endpoint until step 0 is loaded.
  - Write state tract cache using the same logic as step-by-step (around 5583–5700) so subsequent step 0 or census-tracts calls hit cache. Extract a shared helper (e.g. `writeStateTractCache(state, tracts, canonicalResult)`) if needed to avoid duplication.
  - Return `200` with `{ tracts, islandTractsData? }`.

**Response shape:** `{ tracts: GeoJsonFeature[], islandTractsData?: { islandTractsByGroup, excludedTractIds, ... } }`.

**Errors:** `400` invalid state; `404` no tracts found; `500` on internal errors.

---

## 2. Frontend: service method

**File:** [frontend/src/app/services/geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)

- Add `getCensusTracts(state: string): Observable<{ tracts: GeoJsonFeature[]; islandTractsData?: unknown }>`.
- Call `GET ${backendUrl}/api/algorithm/census-tracts/${state}`.
- Map response and handle errors (e.g. same `handleError` pattern as `getStep`).

---

## 3. Frontend: /dev/maps integration in maps-page

**File:** [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)

- **State:** Add properties for the dedicated tract list (e.g. `devTractList: GeoJsonFeature[] | null`, `devIslandTractsData: unknown | null`), and optionally loading/error flags for this fetch. Clear `devTractList` / `devIslandTractsData` when `selectedState` changes so each state gets its own data.
- **When to fetch:** When in dev mode and at step 0 (or when the tract list is visible), if we don’t already have `devTractList` for the current state, call `geodistrictService.getCensusTracts(this.selectedState)` and store the result in `devTractList` and `devIslandTractsData`. Trigger this from the same places that currently ensure step 0 is loaded for the list (e.g. in `goToFirstStep()` when in dev and we need the list, or when initializing/navigating to step 0 in dev).
- **goToFirstStep (dev path):** When step 0 is missing and we’re in dev mode, fetch step 0 with `polygonsOnly: true` for the map (light payload), and in parallel or after call `getCensusTracts(selectedState)` to populate the tract list. Remove the current behavior that fetches step 0 without `polygonsOnly` solely for tracts.
- **tractsByCountyForList getter:** When `isDevMode` and `devTractList` is set (and optionally `currentStepIndex === 0`), build the grouped/chunked list from `devTractList` instead of `currentStep.districtGroups`. Otherwise keep existing behavior (derive from `currentStep.districtGroups`).
- **Island / polygon icons:** When the list is sourced from `devTractList`, use `devIslandTractsData` for `getStep0IslandTractsList()` (and thus `getTractPolygonIcon` island icon) if the backend returns it; otherwise leave island-related UI as-is (e.g. no island highlighting until step 0 is loaded with full data, if we defer adding island detection to the new endpoint).

**File:** [frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)

- No structural change; the tract list already binds to `tractsByCountyForList` and `getTractId` / `getTractPolygonIcon` / `getTractPartyLabel`. Once the getter uses `devTractList` when set, the same template works.

---

## 4. Optional: island detection on the new endpoint

- To make the tract list fully independent of step 0, the census-tracts endpoint can run step-0 island detection (single group = all tracts) and return `islandTractsData`. That requires calling the same island-detection logic used when building step 0 (e.g. algorithm service). Then the frontend can use `devIslandTractsData` for the step-0 isolated panel and polygon icons without ever loading full step 0.

---

## Summary


| Area              | Change                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend           | New `GET /api/algorithm/census-tracts/:state`: cache-first, then fetch + canonical map + enclosed + optional island; write state tract cache on fetch; return `{ tracts, islandTractsData? }`.                                                     |
| Algorithm service | New `getCensusTracts(state)` calling the new endpoint.                                                                                                                                                                                             |
| Maps-page         | Dev-only state for `devTractList` / `devIslandTractsData`; fetch when at step 0 in dev; `tractsByCountyForList` uses `devTractList` when set; `goToFirstStep` (dev) uses `polygonsOnly: true` for step 0 and populates list via `getCensusTracts`. |


This keeps step 0 and tract list concerns separate and allows /dev/maps to show the tract list from the new endpoint while using a lighter step 0 for the map.