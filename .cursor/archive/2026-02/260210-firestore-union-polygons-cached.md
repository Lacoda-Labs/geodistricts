# 260210

## 2230 Firestore step-level completion for union polygons

### Prompt

Firestore should track whether a state's steps have union polygons cached so the backend does not call Cloud Storage unless the file is known to exist (avoid "File not found" for keys like union_polygon_CA_6_1-1 when step was never fully cached). Prefer step-level tracking (e.g. last step completed, union polygons cached for step) over per-union-cache-key Firestore checks.

### Response / actions

✅ **IMPLEMENTED** (per plan firestore_before_cloud_storage_union):

1. **Set `unionPolygonsCached` on step cache when union polygons are cached**  
   When writing step cache docs after `cacheUnionPolygons` succeeds: added `unionPolygonsCached: Object.keys(unionPolygonCacheKeys).length > 0` in (a) onStepComplete (execute full run), (b) step 0 cache write in initialize algorithm, (c) isolated-tract move flow step save.

2. **Query only steps with `unionPolygonsCached` when loading union polygons**  
   In GET map-polygons and GET final-step: when resolving the "final" step, only consider entries where `entry.unionPolygonsCached === true` (in-memory filter in all three selection loops). Only then iterate groups and call Cloud Storage; otherwise return state polygon only / 404.

3. **Optional guard in `loadUnionPolygonsFromCache`**  
   Added optional 4th parameter `options = { unionPolygonsCached }`. When `options.unionPolygonsCached === false`, return district groups without calling Firestore or Cloud Storage.

No per-union-cache-key Firestore reads; Cloud Storage is only used for steps that are known to have cached union polygons.
