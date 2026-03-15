# 260314

## 2102 us table header pinned scroll

### Prompt

only the states below the column header (.table-header-rows) should scroll, keeping header pinned.

### Response / actions

✅ **IMPLEMENTED**: Only the state rows below the column header scroll; US summary row and `.table-header-rows` stay pinned.

- **HTML**: Wrapped the state list in `<div class="state-rows-scroll">` around the `*ngFor` state rows.
- **SCSS**: `.us-data-section` set to `overflow: hidden` (no section-level scroll). New `.state-rows-scroll` with `flex: 1`, `min-height: 0`, `overflow-y: auto` so it fills remaining space and scrolls. `.table-header-rows` and `.us-summary-row` given `flex-shrink: 0` so they stay fixed.

Files: `frontend/src/app/pages/maps-page.component.html`, `frontend/src/app/pages/maps-page.component.scss`.
