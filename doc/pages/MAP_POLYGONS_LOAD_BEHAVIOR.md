# Map Polygons Load Behavior – What’s Happening vs What Should Happen

## What the BE logs show (e.g. for CA)

### 1. GET /api/algorithm/map-polygons/CA

- Backend looks up the **single blob** `map_polygons_CA` in Cloud Storage.
- That blob **does not exist** (or isn’t in the expected shape) for CA.
- So it **falls back** to `getOrCreateStateBoundaryInCloudStorage('CA')`, which:
  - Reads only `state_boundary_polygon_CA.json` (0.01 MB).
- Response: **state boundary only** — no `finalDistrictPolygons`, so `hasFinalStep` is effectively false for display purposes.

### 2. GET /api/algorithm/final-step/CA (heavy path)

- The frontend calls this **right after** map-polygons when a state is selected (see `loadVisualizationState()` after `renderMapPolygons()`).
- Backend:
  1. Finds final step **6** for CA from cache.
  2. **Loads state tracts**: `state_tracts_CA` from Cloud Storage → **75.11 MB**.
  3. **Reconstructs** 52 district groups from step cache + tract map (9,129 tracts).
  4. Loads **tract party** data (`tract_party_CA_2024`).
  5. Runs enclosed-tract detection (no S4 adjacency for CA, so skipped).
  6. **Loads 52 union polygon files** from Cloud Storage: `union_polygon_CA_6_1-1` … `union_polygon_CA_6_52-52` (many small reads).
  7. Caches algorithm state (e.g. Firestore + local).
  8. Returns full step payload (district groups, division lines, per-group status, etc.).
- Then the frontend also calls:
  - GET /api/algorithm/district-party/CA/6
  - GET /api/algorithm/step/CA/6/union-polygons → **404**
  - GET /api/algorithm/step/CA/0 … 5 → **404** (expected when state is stored in algorithm state, not per-step docs).

So for CA, **two things** are happening:

1. **map-polygons** only returns the state outline because the prebuilt **map_polygons_CA** blob was never written (or isn’t used).
2. **final-step** is used to show the sidebar (population, district list, party, etc.), which forces the **full reconstruction path** (75 MB tracts + 52 polygon reads) on every load of the dev/maps page for that state.

### 3. GET /api/algorithm/map-polygons/:state for many other states

- After CA, the logs show map-polygons being requested for TX, FL, NY, IL, PA, OH, … (dozens of states). That matches the “All” US map flow: one GET map-polygons per state to draw state list + union polygons (or state outline only). For states without a `map_polygons_*` blob, each returns only the state boundary.

---

## What should happen (intended design)

- **Page load** should only need:
  1. Data to build the **state list** (e.g. final-step-states or equivalent).
  2. For each state, **one REST GET** that returns **only** what’s needed to draw the map:
     - **Completed state:** all union polygons for that state (one blob per state; nationally up to 435 districts total).
     - **Not completed:** a single **state boundary** polygon.
- **Single GET per state:** e.g. **GET /api/algorithm/map-polygons/:state** should be that endpoint:
  - Returns either **all union polygons** for a completed state **or** just the **state polygon**, in one response.
- **No tract load or reconstruction** on the map path: no 75 MB state tracts, no reconstructing district groups from tracts, no 52 separate union-polygon reads for map display.
- **Party coloring** is done on the client using party data that can be loaded separately (e.g. district-party for the final step when needed), or embedded in the map-polygons response if desired.

So the **intended** flow is:

- **GET map-polygons/:state** = one read of `map_polygons_${state}` blob when it exists:
  - Contains `statePolygon` + `finalDistrictPolygons` (array of GeoJSON features) + `hasFinalStep` + `finalStepNumber`.
  - If blob is missing → return only state boundary (current fallback is correct).
- **GET final-step/:state** = only when the UI needs **full step data** (sidebar, step-by-step, dev tools), not for “draw the map only.”

---

## Gaps

1. **`map_polygons_CA` (and likely other states) is missing**  
   The blob is written by `runBuildAllUnionPolygonsForState()` (used by the build-all-union-polygons job). If that job hasn’t been run for CA, or the write failed, GET map-polygons/CA will always fall back to state boundary only.

2. **Frontend always calls final-step when a state is selected**  
   After `getMapPolygons(CA)` returns, the code calls `loadVisualizationState()` → `getFinalStep(CA)` so the sidebar has step data. That triggers the heavy path even when the only goal is to show the map (which could be driven by map-polygons alone if the blob existed).

3. **Result**  
   - Map display for CA could be served by a **single** GET map-polygons/CA returning the prebuilt blob (state + 52 district polygons).  
   - Today, the map path still gets the state outline from map-polygons, but the **expensive** work (75 MB tracts, reconstruction, 52 polygon reads) happens because of the final-step call for sidebar data.

---

## Recommendations

1. **Ensure the map_polygons blob exists for completed states**  
   Run the build-all-union-polygons job for CA (and any other completed state) so that `map_polygons_CA` is written to Cloud Storage. Then GET map-polygons/CA will return state + 52 district polygons in one read, with no tract or per-polygon reads.

2. **Keep a single GET per state for map data**  
   Keep using **GET /api/algorithm/map-polygons/:state** as the single endpoint that returns either all union polygons (completed) or state polygon only (incomplete). No change to the REST contract; just ensure blobs are built and the frontend uses this for the map.

3. **Optional: avoid final-step on “map-only” load**  
   If the goal is “page load only data needed to build state list and union polygons,” then for the initial map view the frontend could:
   - Rely on GET map-polygons/:state for polygons (and state list can come from final-step-states).
   - Call GET final-step/:state only when the user opens the sidebar or step-by-step view for that state, so the heavy path isn’t triggered on every dev/maps page load for CA.

4. **Party coloring**  
   Polygons are colored by party on the client. Party data can continue to come from GET district-party for the final step when the map shows districts, or be added to the map-polygons payload later if you want one fewer request.

---

## Summary

| Item | Current | Desired |
|------|--------|--------|
| GET map-polygons/CA | Returns only state boundary (no blob) | Returns state + 52 district polygons from one blob |
| GET final-step/CA | Called on state select → 75 MB tracts + reconstruction + 52 polygon reads | Only when UI needs full step/sidebar data |
| Page load | State list + map-polygons per state + final-step for selected state | State list + map-polygons per state (one GET per state; polygons or state outline only) |

The backend design (single blob, one GET) is correct; the main fixes are (1) generating and storing the `map_polygons_*` blobs for completed states, and (2) optionally deferring GET final-step until the user needs full step/sidebar data.
