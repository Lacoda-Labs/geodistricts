---
name: Union polygon MultiPolygon fix
overview: "Confirm that union polygon generation is wrong when tract merges fail (only one tract shown for large districts) and plan the fix: treat failed-to-merge tracts as separate parts and output a MultiPolygon (or equivalent array of features)."
todos: []
isProject: false
---

# Union polygon MultiPolygon fix plan

## Problem confirmation

Your hypothesis is correct. The Texas District 1 and District 11 union polygon files show a **single** tract (one `Polygon` feature) while `TOTAL_POPULATION` and `TRACT_COUNT` indicate 179 and 203 tracts respectively. That happens because the code that builds union polygons **skips** tracts when merge fails instead of keeping them as separate parts.

## Root cause

Union polygons are built in [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js):

1. **S4-ordered path** (`createUnionPolygonsS4Ordered`) — **already correct**: when a tract fails to merge, it starts a new subset; it returns an array of polygon features (main + subsets). The caller can wrap that in a single MultiPolygon via `buildMultiPolygonFromFeatures`. So multiple disconnected parts are already represented when this path is used.
2. **Dissolve / sequential-union path** (`createUnionPolygon`) — **bug**: used when the group is treated as a single connected component (e.g. no adjacency graph or one component).
  - It tries `turf.dissolve` first; if that fails or is not used, it falls back to **sequential union** (lines ~1510–1570).  
  - In that loop, for each tract it does `turf.union(turf.featureCollection([union, tractFeature]))`.  
  - **If `turf.union` returns null or throws**, the code only does `skippedCount++; continue;` — it **skips** that tract and keeps the current `union` unchanged (lines 1542–1548 and 1562–1568).  
  - So if every merge after the first tract fails (e.g. Turf/topology with TX data), the final result is the **first tract only**. That matches the observed single-tract Polygon with correct district-level properties.

So: **when a tract fails to merge, it must be treated as a separate polygon and the final geometry must be a MultiPolygon (or an array of features that the caller turns into one).**

## Intended behavior (from spec)

[doc/history/251204-how-to-create-union-polygons.md](doc/history/251204-how-to-create-union-polygons.md) states: if merge fails, start a new subset; the final result is one or more union polygons per DG; multiple union polygons per DG are required for islands and geographically isolated tract groups. So the implementation should never drop failed-to-merge tracts; they should become additional parts (MultiPolygon or array of features).

## Proposed fix

**1. Sequential union fallback in `createUnionPolygon`** ([backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js))

- **Current behavior**: On `turf.union` failure or null, skip the tract and continue with the same `union`.
- **New behavior**: On failure, treat the current `union` as a completed part: push it to an array `parts`, then start a new `union` with the failed tract (so that tract is not dropped). Continue merging into the new `union` until the next failure, and repeat.
- **After the loop**: If `parts.length === 0`, return the single `union` as today (one Feature). If `parts.length > 0`, push the final `union` to `parts`; then return an **array of Features** (one per part). The existing caller in `recreateUnionPolygonsForGroups` already handles an array: it calls `buildMultiPolygonFromFeatures(unionResult)` and sets `group.unionPolygon` and `group.unionPolygons`, so the cached file will contain multiple features (or the caller can store one MultiPolygon feature built from that array; either way the map gets all parts).

**2. Optional: dissolve path**

- If `turf.dissolve` returns a result that fails the existing point-count validation, the code already falls through to sequential union. No change required for the “wrong” dissolve result that passes validation (e.g. one tract with many points) unless we add stricter checks (e.g. require dissolved area or vertex count to be proportional to tract count); that can be a follow-up.

**3. Caching**

- Cache already supports an array of features: `unionData = group.unionPolygons || (group.unionPolygon ? [group.unionPolygon] : null)` ([backend/index.js](backend/index.js) ~7517). So when we return an array from `createUnionPolygon`, the caller will set `group.unionPolygons` and the existing cache path will write that array. Frontend/consumers that expect one geometry per district can use `group.unionPolygon` (single MultiPolygon built via `buildMultiPolygonFromFeatures`), which the caller already sets when `unionResult` is an array.

**4. Documentation**

- Update [doc/history/251204-how-to-create-union-polygons.md](doc/history/251204-how-to-create-union-polygons.md) (or algorithm comments) to state explicitly: when merge fails in the sequential-union path, the tract is not dropped; it starts a new part and the result is MultiPolygon (or multiple features).

## Summary


| Location                                   | Change                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUnionPolygon` sequential-union loop | On merge failure: push current union to `parts`, start new union with the failed tract; at end if any parts, return array of Features (one per part). |
| Caller `recreateUnionPolygonsForGroups`    | No change (already handles array and builds MultiPolygon).                                                                                            |
| Cache write/read                           | No change (already supports array of features).                                                                                                       |
| Doc                                        | Clarify that failed merges yield multiple parts / MultiPolygon.                                                                                       |


After the fix, districts like TX 1 and TX 11 will have union polygons that are either one MultiPolygon or an array of Polygon features covering all tracts (or all mergeable groups), not a single tract.