# 260220

## 2145 variance-priority balance after final-step isolated move

### Prompt

balancing after final step isolated tract move, should prioritize the distrcits with the largest variance. generally there will be an adjacent district that has a similar variance (over/under). take a similar approach with other vairance district sets until all variances are within target variance. note it may be possible for one variance to balance with two other districts (e.g. 40%, adjacent to -18% and -20% variance districts). it may make sense to just pair the 40% with -20%, then iterate on variance pairs until all variances reduced as much as possible or within target variance.

[Later: Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.]

### Response / actions

Plan: [.cursor/plans/variance-priority_balance_after_isolated_66bfc20d.plan.md](.cursor/plans/variance-priority_balance_after_isolated_66bfc20d.plan.md)

✅ **IMPLEMENTED**:

- **Backend (geodistrict-algorithm.js):** Added `balanceDistrictsByVariance(districtGroups, allTracts, targetDistrictPopulation)` for final step: build group adjacency from tract graph; each iteration sort groups by descending |variancePercent|, take worst, pair with adjacent opposite-sign partner (largest |variance|); move best boundary tract (over→under) with contiguity check (95% reachable). Added `_tryOneVarianceBalanceMove` for a single over/under boundary move. Uses `BALANCE_TARGET_VARIANCE` (1%).
- **Backend (index.js):** In `POST /api/algorithm/balance-after-isolated`, when all groups are single-district (final step), call `balanceDistrictsByVariance` with `targetDistrictPopulation` from sum of group populations; `divisionLines` is optional at final step. Non–final step still requires `divisionLines` and uses `balanceSiblingPairsAfterIsolatedMoves`.
- **Docs:** Updated TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md: §6b variance-based balancing subsection, Backend functions list, API note for balance-after-isolated (final step vs sibling-pair).

No frontend changes; existing Balance button at final step now uses variance-prioritized balancing.
