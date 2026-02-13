# 260212

## 1500 state-row UI, Figma MCP, majority-party delta

### Prompt

User asked to: (1) Plan then implement state-row changes (remove state button, keep content; make whole row clickable with same handler; hover highlight and pointer); (2) fix hover background to use --mat-sys-surface; (3) center .header-row horizontally; (4) explain how Figma MCP URL/selection work and how to enable Figma desktop MCP in Cursor; (5) add Figma desktop MCP to Cursor settings; (6) update state-row to show delta for the party with majority, supporting + and - delta for both D and R; (7) after deltas did not appear, fix by computing deltas from data (119th vs GeoDistricts); (8) fix delta to be the real margin (R-D or D-R) and display all deltas as +.

### Response / actions

- **State-row component**: Replaced `.state-button` with `.state-identity` (removed chevron), kept flag, abbreviation, district count. Row already had `(click)` and `.clickable`; hover set to `var(--mat-sys-surface)`. Removed `showArrow` input and MatIconModule. SCSS: dropped button chrome (shadow, fixed width), kept layout for `.state-identity`.
- **Maps page**: `.header-row` given `justify-content: center`.
- **Figma MCP**: Explained desktop (selection-based) vs remote (link/node-id); documented enable steps in Figma Desktop and Cursor MCP config. Added `figma-desktop` with URL to `~/.cursor/mcp.json`.
- **State-row delta**: Extended `StateRowData` with `congressRChange`, `geodistrictsRChange`. Added `formatDelta()`, getters `showCongressDDelta`, `showCongressRDelta`, `showGeodistrictsDDelta`, `showGeodistrictsRDelta` (show delta only for majority party per column; tie → D). Template shows change indicator for majority party in Congress and GeoDistricts columns.
- **Maps page row data**: `getUSRowData` and `getStateRowData` now compute delta as **majority-party seat margin** (D−R when D has majority, R−D when R has majority), only when margin > 0. Same margin used for both Congress and GeoDistricts columns. `formatDelta()` displays as `(+n)` using `Math.abs(change)`.
- **Congress column**: `.data-column.congress-column` given `justify-content: space-between`.

✅ **IMPLEMENTED** / **RESOLVED**: State-row clickable row and hover; Figma MCP configured; majority-party margin delta shown as positive (+n) in state rows.
