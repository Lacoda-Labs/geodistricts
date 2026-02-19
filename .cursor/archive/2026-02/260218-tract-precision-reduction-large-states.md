# 260218

## 1400 tract precision reduction for large states

### Prompt

for generating union polygons, is the precision reduction done on tracts prior to joining tracts to make a union polygon? explain current batching process

[Later:] would reducing precision on the tract improve performance

[Later:] can the tolerance for dissolve by configured to account for precision reduction

[Later:] what happens if all precision reductions used ceiling to round

[Later:] but what happens during dissolve when tracts slightly overlap (from ceiling)

[Later:] implement precision reduction on tracts for states with total tracts over 7000, e.g. CA

[Later:] Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/tract_precision_reduction_for_large_states_8a57060e.plan.md](.cursor/plans/tract_precision_reduction_for_large_states_8a57060e.plan.md)

- **Q&A**: Clarified that precision reduction was only on the final union (not tracts before join); explained dissolve/sequential-union batching (chunk sizes 2000/500, progress logging); noted pre-join tract precision reduction can help performance with shared-boundary caveats; confirmed Turf `dissolve` has no tolerance option; explained ceiling would cause systematic northeast bias and distortion; explained dissolve does not handle overlapping polygons (use union instead).
- **backend/utils/geometry-simplify.js**: Added `reduceTractGeometryPrecision(geometry, options)` (round to decimals only, no dedup/simplify); exported it.
- **backend/services/geodistrict-algorithm.js**: Added `TRACT_PRECISION_REDUCTION_STATE_THRESHOLD = 7000` and `reduceTractGeometryPrecision`; in `createUnionPolygon(group, stateTotalTractCount)` and `createUnionPolygonsS4Ordered(..., stateTotalTractCount)` apply reduced-precision working copies when state total > 7000; in `createUnionPolygonsForGroup` added 5th param `stateTotalTractCount` and pass it to all union paths.
- **backend/index.js**: In `recreateUnionPolygonsForGroups`, compute `totalStateTracts` from district groups and pass to `createUnionPolygonsForGroup` and fallback `createUnionPolygon`.

✅ **IMPLEMENTED**: For states with >7000 tracts (e.g. CA), tract geometries are rounded to 5 decimals only for the union/dissolve step; final union still simplified with `simplifyUnionGeometry`. Cached data remains full precision.
