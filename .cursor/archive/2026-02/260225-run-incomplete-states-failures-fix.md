# 260225

## 2230 run-incomplete-states script and failure fixes

### Prompt

Multiple prompts across the session:

1. Create a script to run the algorithm for each state that does not have final step completed: clear cache, run all steps, move and balance, start polygon and party jobs; catch errors, log and continue.
2. Implement the plan (run-incomplete-states script). Then fixes for terminal errors: AK "finalStepNumber >= 1", CT/AL "State tract cache not found"; then single-district skip polygon/party, poll for step loadable, prime state tract cache and wait for step 0.
3. Implement the "Fix run-incomplete-states-algorithm failures" plan: Script A (longer polls and minimum waits), Backend D/E (divisionLines audit and sibling fallbacks for FL 8-14 and MN 5-5).
4. /push (git add, commit, push for geodistricts).
5. /archive

### Response / actions

Plan: [.cursor/plans/fix_run-incomplete-states_failures_1e3deece.plan.md](.cursor/plans/fix_run-incomplete-states_failures_1e3deece.plan.md) (and earlier [.cursor/plans/run_algorithm_incomplete_states_script_1e70eed5.plan.md](.cursor/plans/run_algorithm_incomplete_states_script_1e70eed5.plan.md))

- **Script added:** [backend/scripts/run-incomplete-states-algorithm.js](backend/scripts/run-incomplete-states-algorithm.js) — GET final-step-states, for each state not complete: prime with step-by-step, poll step 0, clear cache, execute, poll final step (or delay for single-district), move-isolated loop, GET step, balance loop, trigger build-all-union-polygons and district-party (skip for finalStepNumber 0). Errors caught per state, summary at end.
- **Fixes applied:** (1) Skip polygon/party when finalStepNumber === 0 (APIs require >= 1). (2) Prime state tract cache with step-by-step and wait for step 0 loadable before clear; after execute, poll GET step until 200. (3) Single-district: skip move/balance, step-by-step to cache step 0.
- **Script A (plan):** 15s delay after step-by-step before polling step 0; step 0 poll 120s; 15s delay after execute; final-step poll 300s.
- **Backend D/E:** In [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js): in `moveIsolatedTractsToOppositeGroup` and `moveBridgeTractsAndRecheck`, added last-resort single-district fallback (use any other single-district group) and range-group fallback (sibling = group with endDistrictNumber === low - 1 or startDistrictNumber === high + 1) so FL 8-14 and MN 5-5 do not throw when divisionLines don’t match.
- **Push:** Committed and pushed geodistricts (run-incomplete-states script and failure-fix changes). gdip had nothing to commit.
