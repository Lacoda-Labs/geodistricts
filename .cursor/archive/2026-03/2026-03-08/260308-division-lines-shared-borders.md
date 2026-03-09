# 260308

## 1530 division lines along shared borders

### Prompt

is it possible to build/draw a line along the shared borders between sibiling DGs after dividing the parent DG such that it is easy to visualize the divisionLine for the step? this would mean one line after Step 1 division, 3 division lines after Step 2, 7 division lines after Step 3, etc.

[User then asked to implement both phases: "do phase 1 and 2"]

### Response / actions

Plan: [.cursor/plans/division_lines_along_shared_borders_f26b8dfe.plan.md](.cursor/plans/division_lines_along_shared_borders_f26b8dfe.plan.md)

✅ **IMPLEMENTED** (Phase 1 and Phase 2 in [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)):

- **Phase 1:** Added `getBoundsForGroupInStep(step, start, end)` and clip logic in `getDivisionLineCoordinates`: when `siblingGroups` has two DGs, the straight division line is clipped to the perpendicular overlap of the two siblings’ bounds (lng overlap for lat-division, lat overlap for lng-division) so the line runs only where the two DGs meet.
- **Phase 2:** Added `getSharedBoundaryFromUnions(polyA, polyB)` using `@turf/turf`: `polygonToLine` and `lineSegment` on both union polygons, segment matching with tolerance, adjacency walk to build ordered polylines. When the step’s sibling DGs have union polygon geometry, division lines are drawn along this shared boundary instead of a straight line.
- `getDivisionLineCoordinates` tries Phase 2 first (union-based shared boundary), then Phase 1 (clipped straight line), then fallback to full parent bounds. `createStaticDivisionLine` and `createAnimatedDivisionLine` use it and return/accept `L.Polyline[]` (one or more segments per division). Static and animated callers updated to push all returned polylines into step layers.
