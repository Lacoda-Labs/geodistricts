---
name: All states delta column cleanup
overview: Add dedicated Delta columns under "119th Congress" and "GeoDistricts" in the All states table so party counts (D/R) are shown without inline (+N) suffixes and deltas align in their own columns.
todos: []
isProject: false
---

# All States Table: Dedicated Delta Columns

## Current behavior

- In [state-row.component.html](frontend/src/app/components/state-row.component.html), the 119th Congress and GeoDistricts columns show party counts with the delta in parentheses next to the leading party, e.g. `D: 39 (+26) R: 13`. The `.change-indicator` span is inside each `.data-badge`.
- Table header in [maps-page.component.html](frontend/src/app/pages/maps-page.component.html) has 4 cells: Map | 119th Congress | GeoDistricts | Swing.
- Column widths are defined in [maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss) (`.table-header-cell` nth-child) and [state-row.component.scss](frontend/src/app/components/state-row.component.scss) (`.data-column.congress-column` / `.geodistricts-column` at 132px each).

## Target layout

- **Header:** Map | 119th Congress | **Δ** | GeoDistricts | **Δ** | Swing (6 columns).
- **Rows:** 119th and GeoDistricts columns show only `D: n` and `R: n` (no parenthesis). Two new columns show the delta for the leading party only (e.g. `(+26)` or `(+11)`), styled by party (blue for D, red for R), so all deltas align vertically.

## Implementation

### 1. Maps page template

- **File:** [frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)
- In `.table-header-row`, add two new header cells after "119th Congress" and after "GeoDistricts":
  - After the "119th Congress" cell: `<div class="table-header-cell">Δ</div>`
  - After the "GeoDistricts" cell: `<div class="table-header-cell">Δ</div>`
- Resulting order: Map, 119th Congress, Δ, GeoDistricts, Δ, Swing.

### 2. State row template

- **File:** [frontend/src/app/components/state-row.component.html](frontend/src/app/components/state-row.component.html)
- **Congress column:** Remove the `<span class="change-indicator" *ngIf="showCongressDDelta">` and the R delta span from the two `.data-badge` divs so only `D: {{ data.congressD }}` and `R: {{ data.congressR }}` remain.
- **GeoDistricts column:** Similarly remove the two `.change-indicator` spans so only D/R counts remain.
- **New congress delta column:** After `.congress-column`, add a column that shows the 119th delta when present, e.g.:
  - One cell that displays `formatDelta(data.congressDChange)` when `showCongressDDelta` (styled democratic) or `formatDelta(data.congressRChange)` when `showCongressRDelta` (styled republican). Use a single element with `[class.democratic]` / `[class.republican]` and the existing `formatDelta` so only one delta is ever shown.
- **New geodistricts delta column:** After `.geodistricts-column`, add the same pattern for GeoDistricts deltas (`showGeodistrictsDDelta` / `showGeodistrictsRDelta`, `geodistrictsDChange` / `geodistrictsRChange`).

### 3. State row styles

- **File:** [frontend/src/app/components/state-row.component.scss](frontend/src/app/components/state-row.component.scss)
- Add `.congress-delta-column` and `.geodistricts-delta-column` with a fixed width (e.g. 36px), centered content, and font size consistent with badges. Apply party color via `.democratic` / `.republican` (reuse existing color variables so delta text is blue or red when present).
- Optionally reduce `.congress-column` and `.geodistricts-column` width slightly (e.g. to ~100–110px) so the row total width stays within the existing section max-width (440px). Same widths must be applied in maps-page for `.us-data-section .data-column` overrides.

### 4. Maps page styles

- **File:** [frontend/src/app/pages/maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss)
- Update `.table-header-cell` so the six columns have explicit widths that match the state row:
  - 1st: 96px (Map), 2nd: e.g. 100px (119th Congress), 3rd: 36px (Δ), 4th: 100px (GeoDistricts), 5th: 36px (Δ), last: 34px (Swing).
- Update `.us-data-section .data-column` for `.congress-column` and `.geodistricts-column` to the same reduced width, and add `.congress-delta-column` and `.geodistricts-delta-column` at 36px so header and rows align.

### 5. State row component logic

- **File:** [frontend/src/app/components/state-row.component.ts](frontend/src/app/components/state-row.component.ts)
- No API changes required. Existing `formatDelta`, `showCongressDDelta`, `showCongressRDelta`, `showGeodistrictsDDelta`, and `showGeodistrictsRDelta` already encode “show only leading party’s delta”; the template will call them from the new delta column divs. Optional: add getters like `congressDeltaText` and `congressDeltaParty` (and GeoDistricts equivalents) to keep the template minimal; otherwise inline the same conditions in the template.

## Summary

- **Template:** 2 new header cells, 2 new data columns; remove 4 `.change-indicator` spans.
- **SCSS:** Two new delta column classes (36px), optionally shrink 119th/Geo districts columns; align header cell widths with row columns.
- **TS:** Optional small getters for delta text/party; existing logic suffices.

## Visual result

- 119th column: `D: 39` and `R: 13` (no suffix). Next column: `(+26)` in blue.
- GeoDistricts column: `D: 37` and `R: 15`. Next column: `(+22)` in blue.
- Swing unchanged. All numeric and delta columns align vertically.

