# 260210

## 1400 hero map performance and WebP asset

### Prompt

Home page US congressional map used as animated hero background was slow (many API requests, heavy on mobile/cellular). User asked for alternate implementations (e.g. static precomputed assets). Chose Option D + A: raster fallback image plus static precomputed path JSON. Later: WebP should have transparent background and district lines white or black by theme; then revised to single WebP with light gray lines regardless of theme, and map lines always the current light-theme (fixed light gray) color.

### Response / actions

✅ **IMPLEMENTED**:

- **Build script** `scripts/build-hero-asset.js`: Fetches 119th Congress CONUS GeoJSON from Lewis repo, projects to CONUS viewBox, writes `frontend/public/assets/hero-conus-119.json`, `hero-conus-119.svg`, and (via Puppeteer) `hero-conus-119.webp` with transparent background and light gray district lines. Run with `npm run build:hero-asset` or `node scripts/build-hero-asset.js`.
- **Hero component**: When variant is hero and congress 119 (CONUS only), skip API; show single raster image immediately, load precomputed JSON in background and run same draw animation when ready. Skip AK/HI step requests when hero without insets.
- **WebP**: Single asset, transparent background, fixed light gray stroke (`rgba(180,180,180,0.6)`). Animated SVG hero paths use fixed light gray in SCSS (`rgba(224,224,224,0.45)`), no theme switching.
- Root `package.json`: added `build:hero-asset` script.
