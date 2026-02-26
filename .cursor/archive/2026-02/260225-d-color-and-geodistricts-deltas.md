# 260225

## 1530 D party color and GeoDistricts column deltas

### Prompt

update the D party color to improve contrast in both dark/light modes.
for GeoDistricts column, add the + deltas to the leading party similar to how 119th column

(Follow-up: Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.)

### Response / actions

Plan: [.cursor/plans/d_color_and_geodistricts_deltas_ff40d9aa.plan.md](.cursor/plans/d_color_and_geodistricts_deltas_ff40d9aa.plan.md)

✅ **IMPLEMENTED**

1. **D party color (light/dark contrast)**  
   - Added `--party-democratic: #1565C0` in `:root` and `--party-democratic: #64B5F6` in `@media (prefers-color-scheme: dark)` in `frontend/src/styles.scss`.  
   - Replaced all `#2F59FF` with `var(--party-democratic, #2F59FF)` in `state-row.component.scss` and `maps-page.component.scss`.

2. **GeoDistricts column + deltas**  
   - In `maps-page.component.ts` `getStateRowData()`: computed `geodistrictsMarginD` / `geodistrictsMarginR` and set `geodistrictsDChange` / `geodistrictsRChange` for the leading party (same logic as 119th).  
   - In `state-row.component.ts`: added getters `showGeodistrictsDDelta` and `showGeodistrictsRDelta`.  
   - In `state-row.component.html`: added change-indicator spans for D and R in the GeoDistricts column so the leading party shows `(+N)` like the 119th Congress column.
