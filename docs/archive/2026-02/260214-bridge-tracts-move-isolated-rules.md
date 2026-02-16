# 260214

## 1200 bridge tracts and move-isolated rules

### Prompt

AZ tracts 002104 and 002105 are correctly identified as isolated after step 2. After division they land in DG 6-7. moving them to sibling DG 8-9 fixes isolation but leaves population unbalanced.
tracts 002106 and 001900 are both adjacent to the isolated are in DG 8-9. Both could be considered bridge tracts such that swapping either would also fix isolation of 002104, 002105.
bridge tracts are not always the best way to fix isolation, but in this case, because both isolated tracts could be considered an isolation group. confirm that bridge tract detection has a minimum number of tracts to qualify an isolation group. if an isolation group could be as small as two isolated tracts, then bridge tract detection may be a better move.
also, for every tract isolation that get moved, an adjacent tract must also be moved such that it doesn't create any new isolated tracts.

### Response / actions

Plan: [.cursor/plans/bridge_tracts_and_move_isolated_rules.plan.md](.cursor/plans/bridge_tracts_and_move_isolated_rules.plan.md)

- Confirmed: no minimum size for isolation group; bridge detection runs for any DG with ≥1 isolated tract. The ≥10 threshold only relaxes the bridge filter (large vs small isolation).
- User constraints added to plan: bridge tract detection only from original parent DG; balancing when swapping using sorted list of tracts that border sibling_DG, select tract(s) whose population closely matches swapped tract(s).
- User asked to "build plan and option 4": implemented full plan plus option 4 (relax bridge filter for very small isolation ≤2; prefer bridge for small isolations).
- **Spec** ([doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md)): §5 scope = parent DG only, very small isolation (≤2) include if adjacentIsolatedCount ≥ 1, strategy note; §6 compensating move (boundary tracts, population match); §7 optional balance for bridge moves; §9 GDIP-004 note updated.
- **Backend** ([backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js)): `_findBalancingTract()` (boundary tracts in target, sort by |pop − targetPop|, pick tract whose removal doesn’t create isolation); `_moveTractsToGroup(..., skipBalancing)` with compensating move after moving isolated tracts; parent-DG comment in `detectBridgeTracts`; option 4: `isVerySmallIsolation = isolatedCount <= 2`, `willInclude = adjacentIsolatedCount >= 1` for very small.

✅ **IMPLEMENTED**: Tract isolation spec updates, compensating move (balance by boundary-tract population match), bridge scope (parent DG only), and option 4 (very small isolation bridge filter relaxed).

## 1230 undo option 4

### Prompt

undo option 4 changes

### Response / actions

- **Spec**: Removed "Very small isolation (≤2 isolated)" bullet and "Strategy" paragraph; restored "Small isolation" (include only if willHelpConnect).
- **Backend**: Removed `isVerySmallIsolation` and the `if (isVerySmallIsolation)` branch in `detectBridgeTracts`; bridge filter again requires willHelpConnect for all non-large isolations.
- **Plan**: §4 marked reverted.

✅ **RESOLVED**: Option 4 reverted; compensating move and parent-DG scope unchanged.

## 1245 balance by sibling DG variance

### Prompt

tract moving balances based on moved tract population. however, the DG populations may already be unbalanced. therefore, change findBalancingTracts to use the sibling_DGs population variance to determine balancing tracts that closely match result in sibling_DG populations within target variance, closest to balanced as possible.

### Response / actions

- **Backend** ([backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js)): `_findBalancingTract` now uses current sibling DG populations only (no `targetPopulation`). Computes S, T, ideal = (S+T)/2, scores each boundary tract by resulting variance `max(|S+P−ideal|,|T−P−ideal|)/ideal` and sorts to minimize it; picks first tract that doesn’t create new isolation. Added `BALANCE_TARGET_VARIANCE` (0.01). Call site no longer passes or uses `totalMovedPopulation`.
- **Spec** ([doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md)): §6 compensating move updated to describe balance by current sibling populations and resulting variance (target variance e.g. 1%).

✅ **IMPLEMENTED**: Balancing now uses sibling DG population variance; tract chosen to bring sibling DGs within target variance and closest to balanced.
