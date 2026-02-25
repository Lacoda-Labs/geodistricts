# 250224

## 1230 All-states polygon line weight and zoom-based thinning

### Prompt

what is the line weight of polygons when All states showing on maps page. anyway to thin it out, especially when zoomed out to fit US

### Response / actions

- Confirmed current weights: district polygons **1.5px**, state outlines **1px** in All-states view (`addUSMapRevealItem`, `renderUSMapDistricts`).
- **Implemented** thinner borders and zoom-based weight in `frontend/src/app/pages/maps-page.component.ts`:
  - Added `getUSMapPolygonWeight()`: zoom ≤ 4 → 0.25px, zoom ≥ 7 → 0.5px, linear blend between.
  - State outlines: fixed **0.5px** via `US_MAP_STATE_OUTLINE_WEIGHT`.
  - District polygons use `getUSMapPolygonWeight()` in both `addUSMapRevealItem` and `renderUSMapDistricts`.
  - Added `updateUSMapPolygonWeights()` and call it from the existing `zoomend` listener so All-states district strokes update when zooming (thinner when zoomed out).
- ✅ **IMPLEMENTED**: All-states view now uses 0.25–0.5px district borders and 0.5px state outlines; borders thin automatically when zoomed out to fit US.
