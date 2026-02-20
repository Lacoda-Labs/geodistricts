# 260219

## 1200 maps polygon transparency constant

### Prompt

on maps pages, polygons shown on map have some transparency. replace it with a page constant that can be confgiured. preserve current transparency value for turning on transparency, default to no transparency. this allows transparency to be configured using one property

### Response / actions

✅ **IMPLEMENTED**: Added a single page constant `POLYGON_FILL_OPACITY` in `maps-page.component.ts` (default `1` for no transparency; set to `0.7` for the previous transparent look). Replaced all polygon fill-opacity usages—fallback layer style, clearSliderHighlight, updateSliderHighlightOnLayers, final district polygons, step 0/district fill, and per-tract rendering (including border when boundaries hidden)—so one property controls polygon transparency. Left slider-highlight and state-party shading logic unchanged.
