# 260218

## 2200 union polygons: fast-path trigger and POST always build

### Prompt

[1] @terminals/2.txt:1005-1022 still no log message on POST to creat polygons

[2] when ever /POST union-polygons is called, always build. ignore/overwrite any existing polygons.

### Response / actions

Plan: [.cursor/plans/step_union_polygons_api_5cdd306e.plan.md](.cursor/plans/step_union_polygons_api_5cdd306e.plan.md)

- **Fast-path trigger**: The union-polygons POST was only triggered on the move-all-isolated **cache path**. When the frontend sends full `districtGroups` and `isolatedTractsData` (fast path), the handler returned JSON without triggering the job. ✅ **FIXED**: In `backend/index.js`, when on the fast path and `totalRemaining === 0 && step > 0`, the handler now logs "📤 Step complete after move-all-isolated: requesting POST .../union-polygons..." and calls `axios.post(unionPolygonsUrl, {})` in `setImmediate`, so "Received: POST .../union-polygons" appears in logs.
- **POST always build**: `recreateUnionPolygonsForGroups` was skipping groups that already had `unionPolygon` or `unionPolygons`. ✅ **IMPLEMENTED**: In `runUnionPolygonGenerationJob`, before calling `recreateUnionPolygonsForGroups`, the job now deletes `unionPolygon`, `unionPolygons`, and `unionPolygonCacheKey` from each district group so every group is rebuilt and `cacheUnionPolygons` overwrites existing Cloud Storage/Firestore entries. Doc comment on the POST route updated to state it always builds and overwrites.
