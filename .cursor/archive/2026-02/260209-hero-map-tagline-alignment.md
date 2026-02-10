# 260209

## 2300 hero map tagline alignment

### Prompt

User requested: hero map max width 600px and always vertically centered; then reported map alignment issues (SVG viewport and map inside not aligning with top of viewport); then hero-map-bg should align with bottom of hero-tagline always.

### Response / actions

✅ **IMPLEMENTED**: Hero map constrained to max-width 600px with aspect-ratio 800/500, centered horizontally; initially vertically centered (top: 50%, translate -50% -50%).

✅ **FIXED**: Alignment issues — hero SVG set to `preserveAspectRatio="xMidYMin meet"` so map graphic aligns to top of SVG viewport; `.hero-map-bg` given `min-height: 0` on nested map/SVG elements and `vertical-align: top` on `.boundaries-svg`; us-congressional-map hero-variant given `min-height: 0` on root, `.map-container`, and `.boundaries-svg` so 320px min-height does not conflict with aspect-ratio box.

✅ **IMPLEMENTED**: Hero map positioned to align with bottom of hero-tagline always: `.hero-map-bg` now uses `top: 2.25rem` and `transform: translateX(-50%)` (no vertical centering) so the map’s top sits just below the tagline on all viewports.
