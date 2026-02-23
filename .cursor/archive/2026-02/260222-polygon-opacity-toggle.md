# 260222

## 1200 polygon opacity toggle button

### Prompt

add a button below the "Toggle Division Lines" button overlay on map that toggles opacity of polygons (50% and solid).

### Response / actions

✅ **IMPLEMENTED**: Added a polygon opacity toggle to the maps page.

- **Property:** Replaced constant `POLYGON_FILL_OPACITY` with `POLYGON_OPACITY_SOLID` / `POLYGON_OPACITY_HALF` and a component property `polygonFillOpacity` (default solid). All district/tract fill opacity in the component now uses `this.polygonFillOpacity`.
- **Button:** New control in the map topleft overlay, below "Toggle Division Lines" (with separator), Material icon `opacity`, tooltip "Toggle polygon opacity (50% / solid)". Click toggles between 50% and solid; calls `updateMapLayers()` so polygons refresh. Button is highlighted (blue) when opacity is 50%.
- **File:** `frontend/src/app/pages/maps-page.component.ts` (ToggleControl creation, `updateMapLayers` and render paths using `this.polygonFillOpacity`).
