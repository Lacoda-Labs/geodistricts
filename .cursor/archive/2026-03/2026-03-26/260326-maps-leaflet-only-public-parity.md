# 260326

## 2241 maps Leaflet-only public parity

### Prompt

/archive

### Response / actions

Archiving session work on `/maps` public vs local parity and related follow-ups:

- **Prompt (earlier):** Revert maps page to polygons as before with delay removed; make public `/maps` behave like local; remove toggle between static and interactive.

  **✅ IMPLEMENTED** (`frontend/src/app/pages/maps-page.component.ts`, `.html`, `.scss`):

  - Always use Leaflet (`#usMap`); removed static national WebP, per-state static map images, and image↔interactive toggle (`mapDisplayMode`, `toggleMapDisplayMode`, `localStorage` `mapsPageDisplayMode`, toolbar in template).
  - State view: always `proceedWithStateViewLoadMap()` / API `map-polygons` (dropped CDN `states/{ST}.json` shortcut and `StaticStatePayload` / `applyStaticStateData`).
  - All-states load: **`concatMap`** again (sequential per state); **`US_MAP_REVEAL_DELAY_MS = 0`** (immediate district draws; branch kept for `delayMs > 0`).
  - Removed unused map-mode and static image styles from SCSS.

- **Prompt (earlier):** `/push` — geodistricts commit and push completed in session; nested `gdip` had nothing to commit (push up-to-date).
