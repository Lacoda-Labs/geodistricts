# 260308

## 1230 balance button when isolated resolved; TX step 5 fix

### Prompt

once a step has resolved/moved/swapped isolated tracks and any remaining isolated tracts are allowed islands or enclosed, display a balance button.

[Follow-up:] see browser tab. TX step 5 of 6. no balance button shown, but isolated tract (0) is shown, so should see balance button because many district groups exceed target population variance.

### Response / actions

✅ **IMPLEMENTED** (first request): Show Balance when isolation is “resolved” (no isolated tracts, or all remaining are allowed islands/enclosed). Added `getAllowedIsolatedTractIds()` (step-0 islands + excluded + enclosed tracts); `hasUnresolvedIsolation` now true only when there exists an isolated tract not in that set. Balance button appears in isolated-tracts UI and in “No isolated tracts” sections when `!hasUnresolvedIsolation`. Added Balance to top-level “No isolation tracts found” and to accordion “No isolated tracts at this step” (with optional groupStats).

✅ **FIXED** (TX step 5): Balance still missing when “Isolated tracts (0)” was shown. Cause: (1) `syncIsolationFromCurrentStep()` only kept `isolatedTractsData` when `isolatedTractIds.length > 0`, so steps with 0 isolated lost data on step change; (2) “No isolated tracts” block required `isolatedTractsData.groupStats`, so Balance was hidden when groupStats was missing. Changes: sync now keeps isolation data when `isolatedTractIds` is any array (including empty) and copies `groupStats` when present; both “No isolated tracts” blocks now show when `isolatedTractIds.length === 0` only (no groupStats requirement), with group stats list optional via `*ngIf="isolatedTractsData.groupStats?.length"`.

Files: `frontend/src/app/pages/maps-page.component.ts` (getAllowedIsolatedTractIds, hasUnresolvedIsolation, syncIsolationFromCurrentStep), `frontend/src/app/pages/maps-page.component.html` (Balance in no-isolation blocks, optional groupStats).
