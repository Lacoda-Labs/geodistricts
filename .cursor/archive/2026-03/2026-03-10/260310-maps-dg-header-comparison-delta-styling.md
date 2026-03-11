# 260310

## 2235 maps dg-header comparison, delta (+0), empty sections

### Prompt

1. When on maps page for selected state and showing final step, remove the target population from .dg-header and replace with content shown in screenshot. Those table values from All states map page.

2. When delta is 0, show (+0) instead of an empty cell which throws off alignment and visually looks incomplete. Update recent change and the All states delta columns.

3. .final-step-actions and .district-status-summary are empty but take space with padding and margins. Update template so these divs are not generated when empty (i.e. when if condition is false).

4. Delta columns that have (+0) should have text color var(--mat-sys-on-surface-variant).

### Response / actions

✅ **IMPLEMENTED** (maps final-step header and delta styling):

- **dg-header on final step**: When a state is selected and final step is active, replaced “Target DG Population” in `.dg-header` with the same comparison block as the All states table: 119th Congress (D, R, Δ), GeoDistricts (D, R, Δ), Swing. Data comes from `getStateRowData(selectedState)`; added `headerComparisonRowData` getter, `formatDeltaHeader()`, `headerSwingColumnText()` in maps-page.component.ts; added `.dg-header-comparison` grid and styles in maps-page.component.scss.
- **Delta (+0)**: In `getUSRowData()` and `getStateRowData()` use `>= 0` for D margin so tie (0) sets D delta to 0; state-row and header show “(+0)”. State-row `formatDelta()` and maps `formatDeltaHeader()` already format 0 as “(+0)”.
- **Empty sections**: Wrapped `.final-step-actions` in `<ng-container *ngIf="...">` so the div is only rendered when at least one button is shown (`hasUnresolvedIsolation` or balance button). For `.district-status-summary` (Build Polygons / Calc Party %), added `&& (needsBuildPolygons() || needsCalcParty())` to the `@if`. For the union-polygon `.district-status-summary`, extended the `@if` so the block only renders when the button or “building…” span would be shown.
- **(+0) text color**: In state-row and dg-header-comparison, delta cells that display (+0) get class `delta-zero` and use `color: var(--mat-sys-on-surface-variant)` (state-row.component.scss and maps-page.component.scss). Democratic/republican classes apply only when the delta value is not 0.
