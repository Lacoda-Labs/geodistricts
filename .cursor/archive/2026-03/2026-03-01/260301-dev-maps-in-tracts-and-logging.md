# 260301

## 1930 dev/maps IN tracts and census-tract logging

### Prompt

dev/maps page still not showing tracts for IN. why?

(Later: terminal build error re comma operator in template; then) add frontend console logging for loading census tract data from endpoint.

### Response / actions

- **IN not showing:** Root cause was `loadedSteps` not cleared on state change, so after switching to IN the UI could reuse another state’s step 0 and the tract list flow was wrong. Fixed by clearing `loadedSteps` in `onStateChange()` when switching to a specific state. Added an empty-state block that shows "Loading tract list..." or "No tract data..." and calls `ensureTractListLoadTrigger()` so the census-tracts request is triggered/retried when at step 0 in dev with no data. Made `ensureTractListLoadTrigger()` return `boolean` (true) for use in `*ngIf`.
- **Template error:** Angular template parser does not support the comma operator. Replaced `(ensureTractListLoadTrigger(), true)` with `ensureTractListLoadTrigger()` in the `*ngIf` and had the method return `true`.
- **Console logging:** In `geodistrict-algorithm.service.ts` `getCensusTracts()`: log request start (GET url) and on success (state + tract count). In maps-page: in `ensureDevTractListLoaded()` and in goToFirstStep tract subscription, log when starting load, on success (state + count), and on error (warn).
