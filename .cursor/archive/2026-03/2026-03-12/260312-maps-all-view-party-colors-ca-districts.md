# 260312

## 0018 maps All view party colors and CA districts

### Prompt

/archive

### Response / actions

Chat archived. Session covered:

- **Plan implemented:** [maps_all-view_party_colors_fix_b2ba36d5.plan.md](.cursor/plans/maps_all-view_party_colors_fix_b2ba36d5.plan.md) — On initial All view load, district union polygons were drawn before district-party data existed and the map was never re-rendered after that data arrived; after returning from a state view the cache path re-rendered with party data so colors appeared. **Fix:** In `loadUSMapDistricts`, inside the `forkJoin` subscribe after populating `allStatesDistrictPartyByState`, call `this.renderUSMapDistricts(this.usMapStepDataByState)` before `finishUSMapLoad()`. Optional: in `renderUSMapDistricts` use party-based border color and store in `tractGeoJsonLayerBorderColors` when `allStatesParty` is present. Both changes implemented in [maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts).

- **Why CA doesn’t show districts on All view:** All view uses only GET map-polygons per state; backend returns `finalDistrictPolygons` from the `map_polygons_<state>` blob (written by build-all-union-polygons). If that blob doesn’t exist for CA, the API returns only the state boundary so CA appears as one polygon. On the CA state page, 52 districts can still appear when the algorithm has been run for CA (map draws from algorithm result / step cache), so the difference is data source (map_polygons blob vs algorithm result). **Resolution:** Ensure the map_polygons_CA blob exists (run algorithm for CA to completion so build-all-union-polygons writes it); then both All and CA state view will get 52 districts from the same API.
