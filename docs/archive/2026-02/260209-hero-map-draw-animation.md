# 260209

## 2230 hero map draw animation

### Prompt

User asked to improve the congressional map as hero background: remove the loading spinner and gray shadow box; instead animate the map by drawing district shapefiles state by state. Draw each district in order loaded; 435 districts over 5 seconds with delay between each; draw states in random order; while drawing a state use a fill color, when state is done remove fill so only borders show.

### Response / actions

✅ **IMPLEMENTED**: Hero variant no longer shows loading overlay or gray box (overlay only when `variant !== 'hero'`). Map container stays transparent.

✅ **IMPLEMENTED**: Hero draw animation in `us-congressional-map.component.ts`: `buildSvgPathsByState()` returns districts per state (one path array per feature) using new `featureCollectionToPathDsByFeature` and `featureCollectionToPathDsByFeatureWithUniformScale` in `geo-svg.ts`. `startHeroDrawAnimation()` shuffles state order, flattens to one entry per district, and schedules timeouts so districts are drawn over 5s (delay = 5000 / district count). Each district adds its path(s) with `filled: true`; when the last district of a state is drawn, that state’s paths are set `filled: false` so only strokes remain. Template shows hero SVG with `heroAnimatedPaths` and class `hero-path-filled` for fill; SCSS adds fill color for `.hero-path-filled`. Timeouts cleared in `ngOnDestroy`.
