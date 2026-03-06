---
name: All states 8-column delta layout
overview: "Implement the Figma 8-column layout for the All states table: two-row header (119th Congress / GeoDistricts spanning D, R, Δ sub-headers) and separate D, R, and Δ columns under each so all columns align."
todos: []
isProject: false
---

# All States Table: 8-Column Layout (D, R, Δ) per Section

## Target structure (Figma)

- **Header row 1:** Map | 119th Congress (spans 3) | GeoDistricts (spans 3) | Swing  
- **Header row 2:** (empty under Map) | D | R | Δ | D | R | Δ | (empty under Swing)  
- **Data row:** state-identity | congress D | congress R | congress Δ | geodistricts D | geodistricts R | geodistricts Δ | swing

So **8 columns** total; D/R/Δ are separate columns under both 119th and GeoDistricts. No parentheses; delta in its own column.

## Implementation

### 1. Maps page: two-row table header

**File:** [frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)

- Replace the single `.table-header-row` with a **two-row header** that aligns with the 8-column grid.
- **Row 1:** One cell for "Map", one cell that spans 3 for "119th Congress", one cell that spans 3 for "GeoDistricts", one cell for "Swing". Use a wrapper (e.g. a div or a table-like structure) so the second row’s cells align with the state row’s 8 columns.
- **Row 2:** Empty cell (Map), D, R, Δ, D, R, Δ, empty cell (Swing). Same total width as row 1 so columns line up.

Use flex (or a small grid) with fixed widths so the state row and both header rows share the same column widths. Ensure `.table-header-row` (or new class) uses the same width scheme as `.state-row` (e.g. 96px Map, then 3 × ~40px for 119th D/R/Δ, 3 × ~40px for GeoDistricts D/R/Δ, 34px Swing).

### 2. State row template: 8 columns

**File:** [frontend/src/app/components/state-row.component.html](frontend/src/app/components/state-row.component.html)

- Keep **state-identity** (Map column) and **swing-column** as-is.
- Replace the two combined data columns with **6 single-purpose columns:**
  - **Congress:** one column for D only (`D: {{ data.congressD }}`, democratic styling), one for R only (`R: {{ data.congressR }}`, republican), one for delta only (show `formatDelta(data.congressDChange)` or `formatDelta(data.congressRChange)` when `showCongressDDelta` / `showCongressRDelta`, with matching party class).
  - **GeoDistricts:** same pattern: D-only column, R-only column, Δ-only column (use `showGeodistrictsDDelta` / `showGeodistrictsRDelta` and format deltas with party class).
- Remove all `.change-indicator` spans; deltas live only in the new Δ columns.
- Use classes such as `congress-d`, `congress-r`, `congress-delta`, `geodistricts-d`, `geodistricts-r`, `geodistricts-delta` for styling and alignment.

### 3. State row styles

**File:** [frontend/src/app/components/state-row.component.scss](frontend/src/app/components/state-row.component.scss)

- Replace the current `.congress-column` and `.geodistricts-column` (each 132px with two badges) with **six** column classes, e.g. `congress-d`, `congress-r`, `congress-delta`, `geodistricts-d`, `geodistricts-r`, `geodistricts-delta`.
- Set widths so the row matches the header (e.g. ~40px for D and R columns, ~36px for each Δ; adjust so total matches existing section max-width ~440px). Keep `.state-identity` and `.swing-column` widths consistent with maps-page (96px Map, 34px Swing).
- Reuse existing `.data-badge` and party classes (`.democratic`, `.republican`) for color; ensure Δ columns are centered and use the same party color when showing a delta.

### 4. Maps page styles

**File:** [frontend/src/app/pages/maps-page.component.scss](frontend/src/app/pages/maps-page.component.scss)

- Update `.table-header-row` (and any second header row) to use an **8-column** layout with the same widths as the state row: 96px, then 3 × congress (e.g. 40, 40, 36), then 3 × geodistricts (40, 40, 36), then 34px.
- Add/update `.table-header-cell` rules so the first row uses colspan-like spanning (via flex or grid) and the second row has 8 cells with the same widths.
- In `.us-data-section .data-column`, add overrides for the six new column classes so header and state row align. Remove or repurpose the old `.congress-column` / `.geodistricts-column` overrides.

### 5. State row component logic

**File:** [frontend/src/app/components/state-row.component.ts](frontend/src/app/components/state-row.component.ts)

- **No change** to `StateRowData` or to `getUSRowData` / `getStateRowData` in maps-page; existing `congressD`, `congressR`, `congressDChange`, `congressRChange`, and the same for geodistricts and swing are sufficient.
- Keep `formatDelta`, `showCongressDDelta`, `showCongressRDelta`, `showGeodistrictsDDelta`, `showGeodistrictsRDelta`; the template will use them in the Δ columns only.

## Summary


| Area           | Change                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| maps-page HTML | Two-row header: row 1 Map / 119th (×3) / GeoDistricts (×3) / Swing; row 2 empty / D / R / Δ / D / R / Δ / empty |
| state-row HTML | 6 data columns: congress D, R, Δ; geodistricts D, R, Δ. No inline change-indicator.                             |
| state-row SCSS | Six column classes with fixed widths; reuse party badge styling                                                 |
| maps-page SCSS | 8-column header and state row alignment; same width scheme                                                      |


Result: D, R, and Δ each have their own column under 119th Congress and GeoDistricts, matching the Figma layout and keeping all columns aligned.