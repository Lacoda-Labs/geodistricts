# 260306

## 1200 step 2 map, party totals, GDIP-007 implementation

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/step_2_map_and_party_gdip_007.plan.md](.cursor/plans/step_2_map_and_party_gdip_007.plan.md)

✅ **IMPLEMENTED** (all five plan items):

1. **Map coloring rules** — In `frontend/src/app/pages/maps-page.component.ts`, set `useTractPartyColor = this.showTractBoundaries && partyData && !useDistrictPartyColor` so tract-level party shading is used only when "Show tracts" is ON. When OFF: union polygon uses DG party totals; when no union, tract polygons use DG color only.

2. **Tract party persistence** — Documented in `backend/services/tract-party-persistence.js` that tract party is computed once per (state, year) and persisted per tract; district group party is derived by summing those tract totals.

3. **District group party at any step** — Backend: added `computeDistrictPartyForStep()` and GET `district-party/:state/:stepNumber` now computes on the fly when no cached doc (for intermediate steps). Frontend: `fetchDistrictPartyForCurrentStep()` now requests party for the current step (`currentStepIndex`); called whenever the displayed step changes (previous/next, step 0 load, executeNextStep, goToFirstStep).

4. **Party totals** — Confirmed two-party denominator in aggregation and vest-data-loader; added comment in state-party-summaries handler; doc selection already prefers complete (expected district count) doc.

5. **GDIP-007** — Added `gdip/GDIPs/gdip-007-party-comparison.md`: tract/county party rules, district group = sum of tract totals at any step, data-source options (election results, voter registration, KIN), protocol advocacy for tract-level reporting.
