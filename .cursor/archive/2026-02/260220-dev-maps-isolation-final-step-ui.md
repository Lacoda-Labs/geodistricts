# 260220

## 260220 dev-maps isolation, next button, dg-header, final-step buttons

### Prompt

Multiple prompts in this session:

1. is grid-only (no isolation resolution) the current default isolation strategy
2. for /dev/maps page, next button should be enabled regardless of isolation tracts. but also the page is showing isolated tracts, so it appears isolation detection is called
3. fix next button enable
4. -no need to show .isolated-tracts-container when isolation detection is disabled
   - .dg-header should on have one row shows current step (e.g. 1 of 6) and target DG population for the step.
5. does it makes sense for isolation detection to be run during step 0
6. (terminal paste) what's going on with polygon generation to be done at end of final step
7. at end of final step, add button to move isolated tracts. and button to balance tracts once all isolation has been resolved.
8. /archive

### Response / actions

Plan: [.cursor/plans/defer_isolated_tracts_to_final_step.plan.md](.cursor/plans/defer_isolated_tracts_to_final_step.plan.md)

- **Default isolation strategy:** Confirmed grid-only (`isolationStrategy: 'none'`) is the default in backend and API; doc and plan state Strategy 3 (grid-only) as default.
- **Next button:** Removed the guard in `canGoToNextStep()` that disabled Next when `isolatedTractsData?.isolatedTractIds?.length`; Next is now enabled regardless of isolated tracts on /dev/maps.
- **Isolation UI when disabled:** Added `showIsolationResolutionUI` (default false). Set true only when running "Run All" (`executeAllSteps`); set false on init, next-step, and reset. Isolated-tracts container and "No isolation" message now render only when `showIsolationResolutionUI` is true.
- **dg-header:** Simplified to one row: "Step X of Y" and "Target DG Population: &lt;value&gt;". Removed state population and title row; updated SCSS (removed .dg-header-left/.dg-header-right, added .dg-header-target).
- **Step 0 isolation detection:** Explained that running isolation detection at step 0 is intentional: same connected-component pass yields *island* tracts (output to `islandTractsByGroup`), not "isolated"; that set is used as `step0IslandTractIds` for steps 1+ so geographic islands are excluded from resolution.
- **Polygon generation at final step:** Explained that build-all-union-polygons is only triggered when the final step has *zero* isolated tracts (`stepCompleteForUnions = isComplete && totalIsolated === 0`). With grid-only, the final step often has isolated tracts, so the job is never triggered; union polygons are not built. Suggested triggering build-all regardless of isolated count if polygons are desired for grid-only runs.
- **Final-step actions:** Added at end of final step (when all groups are single-district) on /dev/maps: (1) **Move isolated tracts** button when `hasUnresolvedIsolation`; (2) **Balance tracts** button when isolation is resolved (`!hasUnresolvedIsolation`), disabled while balancing or when no division lines. Implemented getters `isFinalStepActive` and `hasUnresolvedIsolation`; new template block `.final-step-actions` and SCSS.
