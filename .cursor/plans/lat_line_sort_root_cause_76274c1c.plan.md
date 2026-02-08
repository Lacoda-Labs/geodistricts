---
name: Lat line sort root cause
overview: The visualization slider sorts tracts by centroid for the lat line, while the algorithm sorts by southernmost point (minLat). That mismatch, plus a sliding-window selection, causes the lat line to bounce. This plan confirms the root cause and outlines fixing the sort to use southernmost point.
todos: []
isProject: false
---

# Confirm and fix: Lat division visualization sort (southernmost point)

## Root cause (confirmed)

**Algorithm (backend)** uses **southernmost point** for latitude sort:

- [backend/services/latlong-division.js](backend/services/latlong-division.js): `findDivisionIndex` sorts by **minLat** (south boundary), descending (north first). Bounds come from `getTractBounds(tract)` (prefer `tract.properties.MIN_LAT` / `MAX_LAT`, else geometry). See lines 234–277.

**Visualization (frontend)** uses **centroid** for the slider order:

- [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts): `sortedTractsForSlider` (lines 1511–1533) sorts by `**getTractCentroid(a).lat**` (north first), not by southernmost point. So the order shown in the slider does **not** match the algorithm.

**Why the line bounces:**

1. **Wrong order:** The slider sequence is centroid-based. The blue “sort position” line is drawn at the southernmost latitude of the **highlighted** set (`updateSliderPositionLine`: `bounds.getSouth()` of the bbox of highlighted tracts — lines 1648–1715). Because the highlighted set is built from **centroid** order, the “next” tract in the list can have a southern edge north of the current line, so adding it doesn’t move the line south; or the set can change in a way that removes a southern tract (see below), so the line jumps north.
2. **Sliding window:** `tractIdsAtPosition` (lines 1571–1583) maps slider value `v` to indices `[startIndex, endIndex]` with both `startIndex` and `endIndex` depending on `v`. So the highlighted set is a **moving band**, not “first K tracts”. When `v` increases, `startIndex` can increase and northern tracts drop out of the set. If one of those had the southernmost extent, the line jumps **north** — hence the bounce.

So the root cause is: **the visualization lat line is driven by a tract order that does not use southernmost point** (it uses centroid), and the band selection can shrink the set and make the line jump north.

---

## Intended behavior (from archive)

From [.cursor/archive/2026-02/260205-tractslider.md](.cursor/archive/2026-02/260205-tractslider.md): slider should visualize the sorting algorithm; division line should move in the same direction as the slide; for latitude, line = southernmost lat of highlighted tracts. So sort order for the slider should match the algorithm: **latitude = by southernmost point (minLat), longitude = by easternmost point (maxLng)**.

---

## Fix (concise)

1. **Sort slider tracts by boundary, not centroid**
  - In `MapsPageComponent`, add a way to get **tract bounds** (southernmost lat for lat, easternmost lng for lng): use `tract.properties.MIN_LAT` / `MAX_LAT` / `MIN_LNG` / `MAX_LNG` when present (algorithm enriches these in [geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)), otherwise compute from `tract.geometry` (same logic as backend `getTractBounds`).
  - Change `sortedTractsForSlider` to sort by:
    - **Latitude:** `minLat` descending (north first — tract with northernmost southern edge first).
    - **Longitude:** `maxLng` ascending (west first).
  - Keep secondary tie-break (e.g. lng for lat sort, lat for lng sort) for stability.
2. **Optional but recommended: “first K tracts” instead of sliding window**
  - Change `tractIdsAtPosition` so that at value `v` we highlight **indices 0 through K−1** with `K = floor(v * N / M)` (and `v === 0` → none). So `startIndex = 0`, `endIndex = K - 1`. That way the line is the southernmost extent of “all tracts from north up to this position” and moves monotonically south as the slider increases (with correct minLat sort).
3. **Cache invalidation**
  - `cachedSortedTractIds` / `cachedSortedTractIdsKey` already invalidate when step/DG/count change. No change needed once sort uses bounds; the same cache continues to reflect the new order.

---

## Files to touch


| File                                                                                           | Change                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) | Add `getTractBoundsForSort(tract)` (or use existing pattern) returning `{ minLat, maxLng }` from properties or geometry. Change `sortedTractsForSlider` to sort by minLat (lat) / maxLng (lng). Optionally change `tractIdsAtPosition` to use `startIndex = 0`, `endIndex = floor(v*N/M) - 1`. |


---

## Verification

- Run algorithm for a state (e.g. with several divisions). Open sort-order slider; set direction to latitude.
- Confirm tract order in the slider matches backend: first tract has northernmost southern edge, etc. (e.g. compare with backend logs or a small debug dump of sorted minLat.)
- Move slider from north (0) to south (max): the blue lat line should move monotonically south (no bounce). Same idea for longitude (line moves east monotonically).

