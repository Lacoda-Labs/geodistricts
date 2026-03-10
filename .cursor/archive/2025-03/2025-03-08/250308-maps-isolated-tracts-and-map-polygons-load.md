# 250308

## 1400 maps page: hide isolated tracts when 0; BE load analysis (CA / map-polygons)

### Prompt

changes to maps page:
- when isolated tracts is 0 hide the section.

---

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/4.txt:7-1013 see BE logs for loading dev/maps page. what is going with CA? provide description of what is happening. what should be happening is the page load only data needed to build the state list and union polygons for completed Geodistricts (max of 435). if state has not completed final geodistricting, then just display the union polygon for the state. REST GET endpoint for each state should be to get union polygons for state which returns all union polygons for a completed state or just one state union polygon. the polygons are color according to the party color.

### Response / actions

✅ **IMPLEMENTED**: Hid the “Isolated tracts” accordion on the maps page when the count is 0. In `frontend/src/app/pages/maps-page.component.html`, the step-isolated accordion (steps 1+, dev mode) now has `*ngIf` so the panel is shown only when `isolatedTractsData == null` (detection not run yet) or `(isolatedTractsData.isolatedTractIds?.length ?? 0) > 0`. When detection has run and the count is 0, the section is not rendered.

✅ **DOCUMENTED**: Analyzed BE logs for CA and map-polygons load and added `doc/pages/MAP_POLYGONS_LOAD_BEHAVIOR.md`. Summary:
- **Current:** GET map-polygons/CA returns only state boundary because the `map_polygons_CA` blob is missing; frontend then calls GET final-step/CA, which triggers 75 MB state tracts load, full reconstruction, and 52 union-polygon reads.
- **Desired:** One GET per state (map-polygons/:state) returning either all union polygons for a completed state (single blob) or state boundary only; no tract load or reconstruction on the map path; party coloring on the client.
- Doc includes gaps (missing blob, frontend always calling final-step on state select) and recommendations (run build-all-union-polygons for CA, optionally defer final-step until sidebar/step view is opened).
