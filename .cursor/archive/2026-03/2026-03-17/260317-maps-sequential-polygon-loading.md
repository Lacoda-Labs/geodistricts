# 260317

## 0112 maps sequential polygon loading (public + local)

### Prompt

/maps page on public site should fetch geodistricts polygons for a state sequentially in separate requests

[Follow-up:] local should load same way too

### Response / actions

Plan: [.cursor/plans/public_site_performance_cdn_static_cc548283.plan.md](.cursor/plans/public_site_performance_cdn_static_cc548283.plan.md)

✅ **IMPLEMENTED**: All-states view on both public (/maps) and local (/dev/maps) now loads geodistricts polygons per state sequentially via separate requests instead of the maps-landing blob.

- **Flow:** In `ngAfterViewInit` and `onStaticAllMapError`, when `selectedState === 'ALL'`, the component now always calls `loadUSMapDistricts()` (which uses `concatMap` + `getMapPolygons(stateCode, { overview: true })` for one request per state in order) and `tryLandingForTableOnly()` for state comparison and party summaries from GET `/api/maps/landing`.
- **Removed:** The previous branch that used `tryLandingThenLoadUSMapDistricts()` (landing blob with `polygonsByState`) for the map; both environments now use the same sequential per-state polygon loading.
- **File:** `frontend/src/app/pages/maps-page.component.ts`.
