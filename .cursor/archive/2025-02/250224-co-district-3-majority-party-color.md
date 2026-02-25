# 250224

## 1200 CO District 3 party color — majority = lowest scale

### Prompt

confirm the polygon and color for CO District 3	0.35%	D 50.4% · R 46.9% 
note the map shows color of district three as gray. 
note the party percentages. because marjority may not have 50%, default to lowest scale color for majority party.

### Response / actions

Plan: [.cursor/plans/maps_party_color_and_tooltip_e8e423d4.plan.md](.cursor/plans/maps_party_color_and_tooltip_e8e423d4.plan.md)

- Confirmed CO District 3 polygon (western/south-central district, groupKey `3-3`) and that D 50.4% / R 46.9% was correctly showing as gray due to the old “tie” band (0.49 ≤ pctDem ≤ 0.51).
- **Updated** `getTractColorByParty()` in `frontend/src/app/pages/maps-page.component.ts`: removed the 0.49–0.51 tie band; now D ≥ 0.5 uses Democratic scale (value 100–500), D < 0.5 uses Republican scale, with slim majorities (e.g. 50.4% D) mapping to the lowest stop (100) → light blue `#BBDEFB` for D, light red `#FFCDD2` for R.
- ✅ **FIXED**: CO District 3 now displays as light blue (Democratic lowest scale) instead of gray when “Color by party %” is on.
