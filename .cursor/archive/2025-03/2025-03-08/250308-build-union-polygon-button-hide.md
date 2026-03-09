# 250308

## 1600 hide Build union polygon when step already has polygons

### Prompt

hide Build union polygon button when union polygons already exist for displayed step, e.g. final step

### Response / actions

Plan: [.cursor/plans/union_polygon_per-step_ui_c6c00108.plan.md](.cursor/plans/union_polygon_per-step_ui_c6c00108.plan.md)

✅ **IMPLEMENTED**: **maps-page.component.ts**: Added `currentStepHasUnionPolygons()` — returns true when the current step’s district groups already have union polygon data (`unionPolygon.geometry` or non-empty `unionPolygons`), so the button is hidden when polygons exist from GET merge or from loaded step (e.g. final step). **maps-page.component.html**: Button now shown only when `!currentStepUnionPolygonsCached && !currentStepHasUnionPolygons() && unionPolygonBuildTriggeredForStep !== currentStepIndex`; the whole `district-status-summary` block is hidden when union polygons exist and not building (no empty area).
