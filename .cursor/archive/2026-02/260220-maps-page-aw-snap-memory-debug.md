# 260220

## 1200 maps page Aw Snap memory debug and cleanup

### Prompt

maps page often blows up, "aw snap". is there a memory leak or some other reason.

(Later): The issue has been fixed. Please clean up the instrumentation.

### Response / actions

- Added debug instrumentation to test five hypotheses: (A) subscription leak (route.data / state-comparison not in `this.subscriptions`), (B) Leaflet layer maps (`tractGeoJsonLayers` / `tractIdToLayer`) not cleared on map reinit, (C) large in-memory data (`loadedSteps`, `allTracts`, `cachedUSMapStepDataByState`), (D) pending `setTimeout`s (e.g. `initializeMap` retry), (E) map event listeners. Logged subscription counts, layer map sizes on reinit, and array lengths at key points.
- User confirmed the issue was fixed (root cause addressed separately).
- ✅ **DONE**: Removed all instrumentation from `maps-page.component.ts` (ngOnInit route.data log, ngOnDestroy log, initializeMap retry/reinit logs, loadUSMapDistricts log, loadAllPreviousSteps subscription-push log). No remaining debug endpoint or agent-log regions; linter clean.

## 1205

### Prompt

/archive

### Response / actions

Chat archived to `.cursor/archive/2026-02/260220-maps-page-aw-snap-memory-debug.md`. Noted optional sync to GitHub Pages via `./scripts/sync-archive-to-docs.sh` and commit of `docs/archive/`.
