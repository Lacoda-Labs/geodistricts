# 260213

## 1230 maps step label, load step 0 first, stale isolation

### Prompt

User asked to implement the plan for /maps: (1) step label showing "Step " on load, (2) step 0 should load first when a state is selected (without clicking Next), (3) step 1 of 1 showing 1763 isolated tracts (stale cache) — fix by sanity-checking cached isolation and re-detecting when stale.

### Response / actions

✅ **IMPLEMENTED**: (1) **Step label**: In step-btn-bar.component.html, use `(currentStepIndex ?? 0)` in the step indicator so the label always shows a number (Step 0 or Step N of M). (2) **Auto-load step 0**: In loadMapPolygons() success callback, after renderMapPolygons(), when !algorithmResult and state selected and not single-district, call runAlgorithm() so step 0 loads automatically. (3) **Stale isolated tracts**: Added isStaleIsolatedTractsData(step, stepIsolatedData) — true when cached count > 500 or > 10% of step tracts. Applied in all four places that use cached isolatedTractsData (runAlgorithm x2, previousStep newStep, nextStep stepToUse): when stale, clear isolated data and call detectIsolatedTracts(). All todos completed; lints clean.
