---
name: Union polygon precision All-states payload
overview: Preserve current full-precision union polygon generation and storage unchanged; add a separate reduced-precision polygon artifact used only for the All-states map to improve load performance.
todos: []
isProject: false
---

# Union polygon precision and All-states map payload

## Archive search summary

There is **no archive document** that explicitly discusses reducing union polygon precision for the All-states map based on the **pixel dimensions of the displayed map div** or zoom level. The following are the relevant, adjacent discussions:


| Topic                                  | Archive reference                                                                                                            | Relevance                                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tract precision during union build** | [260218-tract-precision-reduction-large-states.md](.cursor/archive/2026-02/260218-tract-precision-reduction-large-states.md) | Precision reduction **before** dissolve for states with >7000 tracts (e.g. CA): `reduceTractGeometryPrecision` (5 decimals) and `simplifyUnionGeometry` on the final union. Cached union polygons remain at that precision; not about display payload or zoom. |
| **Smaller payloads for visualization** | [260216-two-mode-architecture-evaluation.md](.cursor/archive/2026-02/260216-two-mode-architecture-evaluation.md)             | States that “the visualization mode [should] be very performant, even on mobile, so **smaller payloads (e.g. union polygons) will be important**.” No implementation of display-specific simplification.                                                       |
| **Union polygon properties cleanup**   | [260304-maps-info-body-zoom-padding.md](.cursor/archive/2026-03/2026-03-04/260304-maps-info-body-zoom-padding.md)            | Removes unnecessary **properties** from union features (single-tract metadata); geometry precision not discussed.                                                                                                                                              |
| **All-states polygon line weight**     | [260224-maps-all-states-polygon-weight.md](.cursor/archive/2026-02/260224-maps-all-states-polygon-weight.md)                 | Zoom-based **stroke thickness** (0.25–0.5px when zoomed out), not coordinate precision or vertex count.                                                                                                                                                        |


So the **idea** you described—that at All-states zoom the district polygons are smaller on screen and full precision is unnecessarily granular—is **not** explicitly documented in the archive; the closest is the two-mode note that smaller payloads matter.

---

## Current behavior (relevant to payload)

- **Union cache**: Per-district union polygons are stored in Cloud Storage (`union_polygon_${state}_${step}_${range}`) after algorithm `simplifyUnionGeometry` (default: 5 decimals, dedup, no Douglas–Peucker). So cached geometry is already rounded to ~1.1 m, but vertex count is unchanged.
- **Map-polygons blob**: When build-all-union-polygons finishes, it writes a single blob `map_polygons_${state}` by concatenating the cached union features ([backend/index.js](backend/index.js) ~6513–6543). **No extra simplification** is applied; the blob is full cached precision.
- **GET map-polygons/:state**: Returns that blob as-is ([backend/index.js](backend/index.js) ~4415–4425). So All-states load does 51 requests (for multi-district states) and receives full-precision geometry.
- **Contrast**: The **move-all-isolated** response path (same file ~10346–10365) does apply aggressive simplification (4 decimals + `simplifyTolerance: 0.0001`) for “client timeout avoidance,” but map-polygons does not.

So today, **All-states map payload is not minimized for display**; it is the same as the cached union geometry.

---

## Goal

- **Preserve current behavior**: Full-precision union polygon generation, storage, and serving remain unchanged (union cache, existing `map_polygons_${state}` blob, GET map-polygons/:state without params). Single-state map and any other current consumers keep using full precision.
- **Add All-states performance**: Generate and store **reduced-precision** polygons in addition; use them **only** when loading the All-states map so that view gets smaller payloads and faster load.

---

## Approach: two artifacts per state (full + overview)

1. **Full precision (unchanged)**
  - Union polygons: continue to be generated and stored in `union_polygon_`* as today.  
  - Map-polygons blob: continue to write `map_polygons_${state}` with **full precision** (current cached union features, no extra simplification).  
  - GET `/api/algorithm/map-polygons/:state` with **no** query param (or e.g. `?overview=false`) returns this full-precision blob. Single-state map and all current callers keep using this.
2. **Reduced precision (new, All-states only)**
  - When build-all-union-polygons finishes, **in addition** to writing `map_polygons_${state}`, build and write a second blob, e.g. `map_polygons_${state}_overview`, where each district feature’s geometry is run through `simplifyUnionGeometry` with display-oriented options (e.g. `decimals: 4`, `removeDuplicatePoints: true`, `simplifyTolerance: 0.0001`), same pattern as move-all-isolated.  
  - GET `/api/algorithm/map-polygons/:state` with e.g. `?overview=true` or `?for=all` returns the overview blob when present; otherwise fall back to full-precision blob (or 404 if neither exists).  
  - **Frontend**: When loading the **All-states** map (`loadUSMapDistricts`), call the map-polygons endpoint with the overview param (e.g. `getMapPolygons(stateCode, { overview: true })`). When loading a **single state**, call without the param so the client receives full precision.

**Reuse**: [backend/utils/geometry-simplify.js](backend/utils/geometry-simplify.js) already exports `simplifyUnionGeometry`; [backend/index.js](backend/index.js) already uses it in the move-all-isolated response.

**Summary**: Full union polygon generation and storage behave as today. A separate reduced-precision blob is generated and used only for the All-states map.

---

## Zoom- or viewport-based precision (not in archive; possible future step)

- **Idea**: Use the map div’s pixel size and zoom (or viewport bbox) to choose tolerance so that simplification is “just enough” for the current view.
- **Complexity**: Requires either (a) client sending viewport/zoom and server returning geometry simplified for that view, or (b) multiple precomputed tiers (e.g. “overview” vs “detail”) and client choosing by zoom. Not discussed in the archive; would be a separate design.

The two-artifact approach (full + overview) keeps existing behavior and adds a single, fixed display simplification for the overview blob.

---

## Estimated payload reduction for Texas (TX)

- **TX**: 38 districts ([CONGRESSIONAL_DISTRICTS_BY_STATE](backend/services/geodistrict-algorithm.js)).
- **Rough baseline**: Cached unions use 5 decimals + dedup only. Districts in a large state often have on the order of **200–800 vertices** each; assume ~400 vertices per district on average. Then:
  - 38 × 400 × ~~25 bytes (e.g. `"[ -98.12345, 31.6789 ],"`) ≈ **~~380 KB** for district coordinates alone; with state polygon and JSON structure, a **TX map_polygons blob on the order of 400–600 KB** is plausible (exact size depends on real vertex counts).
- **Overview blob** (4 decimals + Douglas–Peucker 0.0001):
  - Fewer vertices (Douglas–Peucker often cuts 50–70% for such tolerances at continental zoom).
  - Shorter numbers (4 decimals vs 5 saves some character count per coordinate).
  - **Estimated overview blob size for TX: ~150–250 KB** (about **50–60% reduction** vs the 400–600 KB full-precision blob). For All-states, the 51 requests would use overview blobs, so total payload drops proportionally.

So for a large state like TX, **expect on the order of half the payload** for the All-states map when using the overview blob; exact numbers should be confirmed by measuring before/after. Full-precision blob for TX remains unchanged for single-state use.

---

## Summary

- **Full precision**: Unchanged. Union polygon generation and storage (union cache + `map_polygons_${state}` full-precision blob) and GET map-polygons/:state with no param behave as today. Single-state map uses full precision.
- **Reduced precision**: Add a second blob `map_polygons_${state}_overview` (simplified geometry), written when build-all-union-polygons runs. GET map-polygons/:state?overview=true (or ?for=all) returns it. Frontend uses overview only when loading the All-states map.
- **TX estimate**: Overview blob ~50–60% smaller than full (e.g. ~400–600 KB → ~150–250 KB); verify with before/after blob size check.

