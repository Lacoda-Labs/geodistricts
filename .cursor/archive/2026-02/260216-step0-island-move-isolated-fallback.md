# 260216

## 1430 step0 island in next-step + move isolated alternate target

### Prompt

/archive

### Response / actions

Session covered two fixes:

1. **getStep0IslandTractIds not working** — Step 1 isolated list still showed 5 island/water tracts. Frontend sends step0 island/excluded IDs only to detect-isolated and move-all-isolated; next-step runs isolation detection **server-side** inside `executeNextStep` → `createStep`, which was never passed `step0IslandTractIds`. ✅ **FIXED**: In `executeNextStep` (geodistrict-algorithm.js), build `step0IslandTractIds` from `steps[0].islandTractsData` (islandTractsByGroup + excludedTractIds + water/special from uniqueTracts), support Firestore-serialized shape (`group.tractIds`), and pass it as 10th argument to `createStep`. Step 1+ isolation detection now excludes step-0 islands and water/special.

2. **Two tracts never moving / Move returns same isolated** — 06071010436 and 06111003013 in group 14-26; sibling is 1-13; they have no neighbors in 1-13 so move was skipped to prevent infinite loop, so clicking Move always re-detected the same 2. ✅ **FIXED**: In `_moveTractsToGroup`, when the primary target (sibling) has no neighbors for a tract, try any other group that has a neighbor of that tract and move the tract there instead; only skip when the tract has no neighbors in any group. DG properties set to the chosen target (swap when moving to sibling, set when moving to alternate group).
