# 250308

## 1400 tract border party shade darker

### Prompt

change the tract border color to be the leading party color of the tract, one shade group darker that the fill color. see screenshot. the goal is to fix densely populated tracts being mostly current border color (black). In this TX screenshot, state zoomed to fit, large metro areas like Dallas should be shaded more blue.

### Response / actions

✅ **IMPLEMENTED**: Tract borders now use the leading party color one shade darker than the fill (same 100–500 scale, value +100). Added `getTractBorderColorByParty(pctDem)`, `tractGeoJsonLayerBorderColors` map, and `darkenColorHex()` for non-party fills. Border applied in `renderFinalDistricts` (tract-by-tract and union polygon paths), All-states and mapPolygons paths, and all style updates (`updateSliderHighlightOnLayers`, fallback, `updateUSMapPolygonWeights`). Bridge tracts keep white border. Dense metros (e.g. Dallas) now read as party color instead of black grid.
