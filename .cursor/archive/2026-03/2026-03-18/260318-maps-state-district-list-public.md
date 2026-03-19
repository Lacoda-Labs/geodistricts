# 260318

## 2106 maps state district list public

### Prompt

/archive

### Response / actions

Plan: [.cursor/plans/fix_maps_state_district_list_public_6f7792f3.plan.md](.cursor/plans/fix_maps_state_district_list_public_6f7792f3.plan.md)

Session covered:

- **Issue**: District list (sidebar table: District, Population, Variance, Party) does not show on the public /maps page when a state is selected; it works locally. Clarified this is for **state-selected** view, not the All-states table.
- **Root cause**: The list is driven only by GET /api/algorithm/final-step/:state. On production, final-step reads Firestore/local cache; if no step data exists there (e.g. only GCS map-polygons blobs), final-step fails while GET map-polygons succeeds and draws districts, so the map shows but the sidebar list stays empty.
- **Approach**: Use map-polygons response as fallback for the district list when it has final districts; still call loadVisualizationState() so GET final-step can overwrite with full data when available.
- ✅ **IMPLEMENTED** (per plan): In `loadMapPolygons()` success handler, when `response.hasFinalStep && response.finalDistrictPolygons?.length`, build step via `mapPolygonsResponseToStepData(response)` and set `currentStep`, `loadedSteps`, `currentStepIndex`, `totalSteps`, `finalStepNumber`, and minimal `algorithmResult` so the list renders immediately. Removed `!this.algorithmResult` guard so `loadVisualizationState()` is still called to enrich from final-step. In `loadVisualizationState()`, when a map-polygons fallback exists (`this.mapPolygons?.hasFinalStep && this.mapPolygons?.finalDistrictPolygons?.length`), do not clear `currentStep`/`loadedSteps`/etc. at start so the list remains if GET final-step fails.
