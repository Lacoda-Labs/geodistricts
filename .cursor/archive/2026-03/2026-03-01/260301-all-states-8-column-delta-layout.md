# 260301

## 0000 All states 8-column delta layout

### Prompt

Cleanup All states DOM (us-data-section) columns: instead of placing party delta in parenthesis as a suffix to leading party (e.g. CA D: 39 (+26) R:13 under 119th Congress), create new column (under both 119th and geodistricts) for delta so that all columns align. User then asked to "see figma mcp", chose option B (8-column layout with D, R, Δ as separate columns under both 119th and GeoDistricts), then: "Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos."

### Response / actions

Plan: All States Table 8-Column Layout (D, R, Δ) per Section (Figma-aligned).

✅ **IMPLEMENTED**:

- **Maps page HTML:** Replaced single table header with two-row header (`.table-header-rows`): row 1 — Map | 119th Congress (span 3) | GeoDistricts (span 3) | Swing; row 2 — empty | D | R | Δ | D | R | Δ | empty.
- **State row template:** Replaced two combined data columns with six columns: `congress-d`, `congress-r`, `congress-delta`, `geodistricts-d`, `geodistricts-r`, `geodistricts-delta`. D/R show counts only; delta in dedicated Δ columns with party styling. Removed all `.change-indicator` spans.
- **State row SCSS:** Six column classes with widths 40px (D/R), 36px (Δ); centered content; kept swing-column 34px.
- **Maps page SCSS:** `.table-header-rows` and class-based `.table-header-cell-*` widths (96, 116 span, 34, 40, 40, 36 for row 2). `.us-data-section .state-identity` 96px for alignment; `.us-data-section .data-column` overrides for the six new column classes.

Result: 8-column layout Map | 119th D | R | Δ | GeoDistricts D | R | Δ | Swing with aligned columns; no changes to `StateRowData` or data loaders.
