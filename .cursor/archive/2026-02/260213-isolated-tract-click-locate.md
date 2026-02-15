# 260213

## 1415 isolated tract click to locate

### Prompt

@localhost-1771040259073.log step 2 shows isolated tracts but clicking on them does not find them.

### Response / actions

Log showed "Tract layer not found for ID: 04021002105" when clicking an isolated tract row. At step 2 the map renders union polygons only (no per-tract layers), so `tractIdToLayer` is empty and `showTractPopup` had no layer to use.

✅ **FIXED**: In `maps-page.component.ts`, added fallback in `showTractPopup(tractId)`:
- **`findTractFeatureById(tractId)`** — finds the tract feature in `currentStep.districtGroups` by matching `getTractId(tract) === tractId`.
- When no layer exists: find feature, build temporary `L.geoJSON(tractFeature)` for bounds, fit map to tract bounds with padding, open popup at center with group label, tract ID, isolated/bridge, population.
- **`getTractGroupLabel(tract)`** — returns label (e.g. "Districts 6-7") from `tract_DG` or by locating the tract’s group.

Clicking an isolated tract row (e.g. 04021002105, 04021002104) in step 2 now pans/zooms to the tract and shows the popup.
