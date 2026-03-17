# 260316

## 2354 maps party totals on /maps and show-tracts-with-selection

### Prompt

.step-info-container on /dev/maps has .dg-header with party totals .dg-header-comparison, but this is not showing on /maps page

### Response / actions

✅ **FIXED**: `isFinalStepActive` in `maps-page.component.ts` was gated on `isDevMode`, so on `/maps` it always returned false and the party-totals block (`.dg-header-comparison`) never rendered. Removed the `isDevMode` requirement so the getter returns true whenever the current step is the final step (all single-district groups), for both `/maps` and `/dev/maps`. Party totals now show on `/maps` when a state is selected and the final step is loaded.

---

### Prompt

when show tracts toggle is on, and a district is selected, only show tracts for selected district; all other districts are grayed same as when show tracts is off.

### Response / actions

✅ **IMPLEMENTED**: In `renderFinalDistricts()` (maps-page.component.ts): (1) Introduced `useUnionPolygonForThisDistrict` — when show tracts is on and a district is selected, non-selected districts are rendered as gray union polygons (same as when tracts are off). Only the selected district is drawn tract-by-tract with boundaries and party colors. (2) DG outline is drawn only for the district that is shown as tracts (selected district when a selection exists, or all when none), so the outline no longer appears on gray union polygons for non-selected districts.
