# 260324

## 2138 maps party color caps and All-states fallback

### Prompt

look in chat archive and docs for discussion on color shading by percentage of party advantage for given state and geodistrict. see screenshot, dakotas andothe single district states are too red or blue. where was it documented/discussed and what were the color shading percentages

max red should be #e57373. max blue should be #64b5f6 for 100% districts

also update maps page with all states selected with same max red and blue shades just provided

/archive

### Response / actions

✅ **DOCUMENTED** (first question): Pointed to `docs/archive/2026-02/260212-maps-step0-party-shading.md`, `.cursor/plans/maps_party_color_and_tooltip_e8e423d4.plan.md`, and Cursor agent transcript `73185f74-c82b-43ca-90d6-0d53d2aaa5c7` (maps landing / US map fill fallback). Explained `getTractColorByParty` scale (100–500 ↔ 51–100% majority on leading side; Material hex stops) vs `getStatePartyColor` HSL from 119th **seat** share (single-seat states → max strength).

✅ **IMPLEMENTED**: Capped party stops at max R `#E57373` and max D `#64B5F6` (stops 300–500) in `frontend/src/app/pages/maps-page.component.ts` and `backend/scripts/generate-geodistricts-all-raster.js`.

✅ **IMPLEMENTED**: `getStatePartyColor` now returns `getTractColorByParty(congressD/(D+R))` so All-states fallback matches district/summary fills; extended `colorToGrayscale` for `#RRGGBB` so step-0 selection dimming works with hex fills.
