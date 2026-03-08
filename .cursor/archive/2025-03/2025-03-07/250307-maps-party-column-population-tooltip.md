# 250307

## 1200 maps party column, population column, tooltip

### Prompt

fix hover over party. should be a material component tooltip (matTooltip)

[Later:] well the matTooltip background is transparent and the text is blending with background. see screenshot above

[Later:] https://material.angular.dev/components/tooltip/styling

[Later:] * well that didn't work. anyway on to something else.
- party columns should only be shown when at final step when geodistricts have been drawn. for prior steps, add a population column after district.
- as for party tooltip, the vote total is way off. see screenshot

### Response / actions

✅ **IMPLEMENTED** (party hover): Moved `matTooltip` from `<td>` to an inner `<span>` wrapping the Party cell content so the Material tooltip positions correctly and does not overlap the cell.

✅ **ATTEMPTED** (tooltip styling): Added global styles for `.mat-mdc-tooltip-panel` (opaque background, readable text); then switched to official `mat.tooltip-overrides()` in `styles.scss` with `container-color` and `supporting-text-color` using theme variables. User reported it didn’t work.

✅ **IMPLEMENTED** (columns): Party column is shown only when `isFinalStepActive` (final step with geodistricts drawn). For prior steps, table shows **District | Population | Variance** (Population column after District using `group.totalPopulation`). Applied in both district-groups tables (step 0 and steps 1+).

✅ **FIXED** (party tooltip vote total): Tooltip was using backend `totalVotes`, which could be inflated (e.g. tract-level totals from county allocation). Tooltip and map popup now use **two-party total** `(votesDem ?? 0) + (votesRep ?? 0)` for the vote count in `getGroupPartyTooltip` and `getPopupPartyLine`, so the number matches D/R percentages and is plausible.

Files: `frontend/src/app/pages/maps-page.component.html`, `frontend/src/app/pages/maps-page.component.ts`, `frontend/src/styles.scss`.
