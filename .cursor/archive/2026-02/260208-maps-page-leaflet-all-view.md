# Archive: Maps page – Leaflet for ALL view, geodistricts on map

**Date:** 2026-02-08

## Summary

Two changes on the maps page: (1) state view shows 119th Congress boundaries as a base layer with geodistrict polygons on top; (2) the “All states” view was switched from the US congressional map component to the same Leaflet map, fit to continental US, with geodistrict polygons for completed states.

---

## 1. State view: congressional base + geodistricts on top

- Injected **CongressionalBoundariesService** in `MapsPageComponent`.
- Added **congressional layer** (`congressionalLayer`) below the tract layer: tiles → congressional → tract (geodistricts/tracts).
- **loadCongressionalBoundariesForState()**: loads 119th Congress GeoJSON for the selected state (API accepts state code), clears `congressionalLayer`, adds boundaries with style (e.g. orange outline, light fill).
- Called when the state-view map is (re)initialized and when reusing the map for a new state.
- Geodistricts (algorithm union polygons) continue to render on `tractLayer`, so they appear on top of the congressional layer.
- When the map is removed (e.g. switching views), `congressionalLayer` is set to `null`.

**Files:** `frontend/src/app/pages/maps-page.component.ts`

---

## 2. ALL view: remove US congressional map, use Leaflet + continental US + geodistricts

- **Template:** Removed `app-us-congressional-map` from the maps page. One **shared map section** now contains the Leaflet div `#usMap` and the loading overlay for both ALL and state view. Below it: US data section (table) when ALL, info section (step controls, etc.) when a state is selected.
- **Component:** Removed `UsCongressionalMapComponent` import and from the component `imports` array.
- **Continental US:** Added `CONTINENTAL_US_BOUNDS` (lower 48) and in `updateMapView()` when `selectedState === 'ALL'` the map uses `fitBounds(CONTINENTAL_US_BOUNDS, { padding: [24, 24], maxZoom: 10 })`.
- **Lifecycle:** `ngAfterViewInit()` always calls `initializeMap()`, then either `updateMapView()` + `loadUSMapDistricts()` (ALL) or `updateMapView()` + `runAlgorithm()` (state).
- **onStateChange:**  
  - **Switch to ALL:** Map is not destroyed. Congressional layer cleared, then `updateMapView()` and `loadUSMapDistricts()` so the view fits continental US and shows geodistrict polygons for completed states.  
  - **Switch to state:** Map is reused; `initializeMap()` (reuse path), then `updateMapView()` and `runAlgorithm()`.

**Files:** `frontend/src/app/pages/maps-page.component.html`, `frontend/src/app/pages/maps-page.component.ts`

---

## Result

- **ALL:** Single Leaflet map, fit to continental US, with geodistrict polygons for completed states (existing `loadUSMapDistricts` / `renderUSMapDistricts`).
- **State:** Same Leaflet map, fit to state, with 119th Congress boundaries as base and geodistricts (and tracts/controls) on top.
- US congressional map component is no longer used on the maps page (still used on home page hero).
