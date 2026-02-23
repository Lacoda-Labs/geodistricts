# union-polygons/

**Union polygons** for algorithm steps: one GeoJSON (or equivalent) per district group per step, used for map display and step-through visualization.

## Path pattern

- `union-polygons/{STATE}/step-{N}/{cacheKey}.json`
  - `{STATE}` = 2-letter state code (e.g. `CA`).
  - `{N}` = step number (0, 1, 2, …).
  - `{cacheKey}` = full cache key, e.g. `union_polygon_CA_0_1-52`.
- Cache key format: `union_polygon_{state}_{step}_{startDistrictNumber}-{endDistrictNumber}`.

## Content

- JSON: polygon(s) for the union of all tracts in that district group at that step (e.g. MultiPolygon or FeatureCollection). Built from tract geometries after each step is completed.

## Usage

- Created when a step is **completed** (e.g. next-step or run-all); see `recreateUnionPolygonsForGroups()` and `cacheUnionPolygons()` in the backend.
- Read by the step API (e.g. `GET /api/algorithm/step/:state/:stepNumber`, optionally `polygonsOnly=true`) for visualization and “step-through” mode.
- Cleared or pruned when a state’s cache is restarted or steps are invalidated (e.g. `deleteUnionPolygonsForState`).
