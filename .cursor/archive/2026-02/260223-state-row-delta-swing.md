# 250223

## 1530 state row district delta and swing

### Prompt

remove the precentages and calculated the difference at the district level, e.g. R:+1 in red. or D:+1 in blue. swing could also be negative for leading party. however, for consistency, always display +swing.

### Response / actions

✅ **IMPLEMENTED**:

- **Percentages removed**: GeoDistricts column no longer shows state-level D/R %; removed `geodistrictsPctDem` / `geodistrictsPctRep` and related getters from state row.
- **District-level delta from Congress**: State row now shows **D:+N** in blue (democratic badge) when GeoDistricts has more D seats than 119th Congress, and **R:+N** in red (republican badge) when more R seats. Added `geodistrictsDDeltaFromCongress` and `geodistrictsRDeltaFromCongress` to `StateRowData`; maps-page `getStateRowData()` computes `deltaD = geodistrictsD - congressD`, `deltaR = geodistrictsR - congressR` and passes them. State row uses `formatDeltaFromCongress('D'|'R', delta)` for consistent +N display.
- **Swing column**: Unchanged; displays +N when swing ≥ 0 and -N when negative (e.g. +2, -1).

Files: [frontend/src/app/components/state-row.component.ts](frontend/src/app/components/state-row.component.ts), [state-row.component.html](frontend/src/app/components/state-row.component.html), [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts).
