# Archive: Hero redesign with map as background

**Date:** 2026-02-08

## Summary

Home page hero was redesigned to use the US congressional map as a translucent background, with new copy and layout aligned to a reference design (dark navy hero, 70% width / 1000px max, tagline, headline with gold “Geography,” description, and two CTAs).

## Implemented

### US congressional map component
- **`showInsetStates`** input (default `true`): when `false`, only CONUS is drawn (hero shows lower 48 only).
- **`variant`** input (`'default' | 'hero'`): when `'hero'`, paths use translucent outline style (transparent fill, light stroke) via `.hero-variant` in component SCSS.
- Paths rebuild when `showInsetStates` or `variant` change; last step0 results cached so no refetch when only these inputs change.

### Home page hero
- **Background:** Dark navy `#17233b`; map as background layer (CONUS only, hero variant).
- **Layout:** Content centered, 70% width, max-width 1000px (`.hero-container`).
- **Copy:**
  - Tagline: “END GERRYMANDERING. RESTORE FAIR REPRESENTATION.”
  - Headline: “Districts Drawn by Geography, Not Politicians” with “Geography,” in gold (`#ffc107`).
  - Description: “GeoDistricts uses a simple, transparent algorithm — recursive latitude-longitude splits — to create fair congressional districts based purely on geography and population equality.”
- **CTAs:** “See How It Works” (primary, gold), “Learn More” (outlined); both scroll to `#what` via `navigateToItem({ id: 'what', ... })`.

### Files touched
- `frontend/src/app/components/us-congressional-map.component.ts` — inputs and rebuild logic
- `frontend/src/app/components/us-congressional-map.component.html` — hero variant class
- `frontend/src/app/components/us-congressional-map.component.scss` — `.hero-variant` styles
- `frontend/src/app/pages/home-page.component.html` — hero section markup
- `frontend/src/app/pages/home-page.component.scss` — hero section styles (`.hero-section`, `.hero-container`, `.hero-map-bg`, `.hero-copy`, typography, buttons)

## Not done (optional follow-ups)
- “See How It Works” could navigate to `/maps` instead of scrolling to `#what`.
- Scroll indicator (mouse icon) at bottom of hero, if desired.
