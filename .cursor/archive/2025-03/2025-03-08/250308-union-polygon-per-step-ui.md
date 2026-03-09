# 250308

## 1530 union polygon per-step status and build button

### Prompt

after each step, once all isolated tracts have been resolved and balanced so new district groups are within target population variance, union polygons should be calculated and drawn. UI should check after each Next, Move, Balance action if the step has been completed AND if create union polygon process has been started or completed. in not started, show a build union polygon button that does POST to backend to create polygons for the completed step. UI should always show union polygon status in UI (not started shows a button to build union polygons, started or in progress shoulds "building DG polygons..." and completed just shows union polygon on the map. if show tracts is off, show the DG polygon by party, if on, just show DG polygon border and tracts colored by their tract party.

### Response / actions

Plan: [.cursor/plans/union_polygon_per-step_ui_c6c00108.plan.md](.cursor/plans/union_polygon_per-step_ui_c6c00108.plan.md)

✅ **IMPLEMENTED**: Per-step union polygon status and build flow per plan. **maps-page.component.ts**: Added `unionPolygonBuildTriggeredForStep`, `unionPolygonPollSub`, `unionPolygonPollIntervalId`, `currentStepUnionPolygonsCached`; `isCurrentStepCompleteForUnionPolygons()` (step 0 → false, non-final → true when step present, final → true when `!hasUnresolvedIsolation && finalStepBalancingComplete`); `checkAndUpdateUnionPolygonStatusForCurrentStep()` (GET union-polygons, merge on 200, set status on 404); `startUnionPolygonPolling()` / `stopUnionPolygonPolling()`; `buildUnionPolygonForCurrentStep()` (POST then poll). Check invoked after Next, Move, Balance, previous step, final-step load, goToStep, and initial step load; polling cleared on destroy and state/step change. **Map**: When show tracts is ON and DG has union polygon, draw DG outline only (fillOpacity 0, weight 1.5) after tracts so boundary is visible with tract party colors. **maps-page.component.html**: In Steps 1+ panel, when `currentStepIndex >= 1 && isCurrentStepCompleteForUnionPolygons()` show "Build union polygon" button (if not started), or "building DG polygons..." (if in progress); completed shows polygon on map only. **maps-page.component.scss**: `.union-polygon-status` for message styling.
