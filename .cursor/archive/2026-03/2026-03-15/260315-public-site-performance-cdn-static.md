# 260315

## 2310 public site performance CDN static implementation

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/public_site_performance_cdn_static_cc548283.plan.md](.cursor/plans/public_site_performance_cdn_static_cc548283.plan.md)

✅ **IMPLEMENTED** (all four plan items):

1. **State view UI** — Hid `.info-header-step-bar` for public with `*ngIf="isDevMode"`. District list: always show Population column; Party column shows leading party % (e.g. "D 54.2%" / "R 61%") with solid background from `getTractColorByParty()`. Added `getLeadingPartyDisplay()`, `getDistrictPartyFillColor()`, and `.party-cell-filled` SCSS.

2. **Static All map (frontend)** — Added `cdnBaseUrl` and `staticAllMapImageUrl` to environment. When All view and static URL set, map section shows single raster image; on error falls back to Leaflet. `tryLandingForTableOnly()` loads table data without polygon render. Switching All ↔ state handles map init/teardown correctly.

3. **Raster generation** — Added `backend/scripts/generate-geodistricts-all-raster.js`: reads maps_landing, builds CONUS 800×500 SVG with party colors, outputs WebP via sharp. Documents CDN upload and env config.

4. **Per-state static JSON and loader** — Added `backend/scripts/generate-state-static-json.js` (writes `states/{stateCode}.json`). Frontend: when `cdnBaseUrl` set and state selected, fetches static JSON; on 200 applies synthetic final step and district list; optional state map image when `stateMapImageUrl` present. Types `StaticStatePayload` / `StaticStateGeodistrict`; `getGroupVariance()` uses static variance when present; `isFinalStepActive` true for static state.
