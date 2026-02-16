# 260215

## 1400 move isolated no balance + Balance districts button

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

[Later:] @terminals/4.txt:771-792 [user pointed to NG8107 template warning]

[Later:] /archive

### Response / actions

✅ **IMPLEMENTED** (plan: move isolated no balance + UI button):

1. **Backend** — Removed `balanceSiblingPairsAfterIsolatedMoves` from both the fast path and cache path of `POST /api/algorithm/move-all-isolated-tracts`. Added `POST /api/algorithm/balance-after-isolated` (body: state, step, districtGroups, divisionLines; builds allTracts from groups, runs balance, returns districtGroups; S4 preload optional).

2. **Frontend service** — Added `balanceAfterIsolated(state, step, districtGroups, divisionLines)` with 2 min timeout and error handling.

3. **Maps page** — Added `isBalancingDistricts`, `balanceDistrictsAfterIsolated()` (guards, service call, update step + render, finalize), "Balance districts" button in isolated-tracts header (disabled when balancing or no divisionLines), `MatTooltipModule` and tooltip.

✅ **FIXED**: NG8107 template warning — changed `!currentStep?.divisionLines?.length` to `!currentStep?.divisionLines.length` in the Balance button `[disabled]` binding (optional chaining only on currentStep).
