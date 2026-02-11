# 260210

## 2230 client-side All-states cache

### Prompt

Implement the client-side All-states cache plan: when the user selects "All states", then switches to a single state and back to "All states", restore map and table from an in-memory cache instead of refetching 51 getMapPolygons calls.

### Response / actions

✅ **IMPLEMENTED** in `frontend/src/app/pages/maps-page.component.ts`:

- Added private cache fields: `cachedUSMapStepDataByState`, `cachedUSMapTotalDistricts`, `cachedUSMapCompletedStateCodes`.
- **Save to cache**: When switching to a single state (`selectedState !== 'ALL'`), if `usMapStepDataByState.length > 0`, copy current All-states data into the cache before clearing.
- **Restore from cache**: When switching to ALL, inside the existing `setTimeout`, if cache has data: restore the three state values, clear layers (stateOutlinesLayer, tractLayer, tractGeoJsonLayers, tractIdToLayer), fit CONUS bounds, call `renderUSMapDistricts()` and `markForCheck()`; skip `loadUSMapDistricts()`. Otherwise call `loadUSMapDistricts()` as before.
- **Populate cache**: In `loadUSMapDistricts()` subscribe `complete`, if `usMapStepDataByState.length === 51`, write the same three values to the cache.

No backend or API changes. Cache is in-memory only; no invalidation in first version.
