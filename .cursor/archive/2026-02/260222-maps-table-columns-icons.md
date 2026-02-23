# 260222

## 1520 maps district-groups table columns and Next icons

### Prompt

move the polygon and party columns to the far right so that variance and next division are 2 and 3 columns. also, hide next division column when showing final step. also rename next division label to be "Next", replace "lat" with arrow_range icon and "long" with "height" icon.

### Response / actions

✅ **IMPLEMENTED**:

- **Column order** ([frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)): District groups table columns reordered to District → Variance → Next (when not final step) → Polygon (dev) → Party (dev). Variance is column 2, Next is column 3; Polygon and Party are last.
- **Next column visibility**: Next header and cell use `*ngIf="!isFinalStepActive"` so the column is hidden on the final step.
- **Label**: "Next division" renamed to "Next".
- **Icons** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): `getNextDivisionLabel(group)` now returns only the ratio (e.g. `44/56`) or "–"; added `getNextDivisionIcon(group)` returning `'arrow_range'` (lat) or `'height'` (long) or null. Template shows `<mat-icon [fontIcon]="getNextDivisionIcon(group)">` plus the ratio.
- **Styling** ([frontend/src/app/pages/maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss)): `.next-division-cell .next-division-icon` for icon size and spacing.
