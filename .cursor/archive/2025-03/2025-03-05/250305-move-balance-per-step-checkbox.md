# 250305

## 1200 move/balance per step checkbox

### Prompt

search archives for prior chats discussing different algorithm approaches for when to move isolated tracts and balance districts after move. at the moment the algorithm waits until the last step to move isolated tracts then balance. however, the algorithm should support move/balance after each step also. add a checkbox to move/balance per step that is used when checked and user clicks play.

[Later:] Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/move_balance_per_step_checkbox_6eede3c7.plan.md](.cursor/plans/move_balance_per_step_checkbox_6eede3c7.plan.md)

✅ **IMPLEMENTED**: Move/balance per step checkbox and backend support.

- **Backend** (`backend/index.js`): In `POST /api/algorithm/execute/next-step`, read `options.moveBalanceAfterStep`. On cache miss, after `executeNextStep`, when the option is set and step > 0: build allTracts and step0IslandTractIds; at final step run `resolveIsolationForFinalStep` and variance balance (with resolve-isolated loop and district-party trigger); at non-final steps run `resolveIsolationForStep` and `balanceSiblingPairsAfterIsolatedMoves`; update step and algorithm state, then cache and respond. On resolve/balance errors, log and return step without move/balance. Cache hits are returned as-is (no re-run of move/balance).
- **Frontend service** (`geodistrict-algorithm.service.ts`): Added `moveBalanceAfterStep?: boolean` to `GeodistrictOptions`; `executeNextStep` sends `options: { moveBalanceAfterStep }` in the POST body when set.
- **Maps page**: Added `moveBalancePerStep = signal(false)` and pass `moveBalanceAfterStep: this.moveBalancePerStep()` when calling `executeNextStep`. Added dev-only checkbox "Move/balance per step" below the step button bar, bound with `[checked]` and `(change)`. Adjusted step bar layout and `.move-balance-per-step-option` style.
- **Docs** (`doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md`): §8 Step mode note on "Move/balance per step" and Play behavior; §9 API note for `POST /api/algorithm/execute/next-step` and `options.moveBalanceAfterStep`.

## 1430 balance logging and move balance links

### Prompt

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/6.txt:7-1017 balance is not working

[Later:] in order to support move/balance for each step when manually clicking through each step, show move and balance links after a manual step completes.

### Response / actions

✅ **IMPLEMENTED** (balance visibility): In next-step move/balance flow, added logging before/after sibling-pair balance and a try/catch around the balance call so failures are visible. In `balanceSiblingPairsAfterIsolatedMoves` (geodistrict-algorithm.js): total swap count and console log when swaps > 0 or when 0 swaps (so user can confirm balance ran). Stack trace logged on move/balance failure in index.js.

✅ **IMPLEMENTED** (manual step Move/Balance links): For steps ≥ 1 in dev mode, added a persistent row under the step header: "This step: Move isolated tracts · Balance districts" (buttons, same handlers as existing Move/Balance). Styled as compact link-like row in `.step-move-balance-actions` (maps-page.component.html and .scss). Shown in both step 0 and steps 1+ blocks with `*ngIf="currentStepIndex >= 1 && isDevMode && !isVisualizationOnly"` so it only appears when on step 1 or later.
