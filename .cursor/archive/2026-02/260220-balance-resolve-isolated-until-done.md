# 260220

## 2230 resolve isolated after balance and balance until done

### Prompt

two things:
1. district 3 has isolated tracts after 1st balance. resolve isolated tracts after balance.
2. balance button appears to do one balance, leaving more to balance. instead balance should run until all districts have been reduced to tolerance or best.

### Response / actions

✅ **IMPLEMENTED**:

- **Resolve isolated after balance:** In `POST /api/algorithm/balance-after-isolated` (final step), after the first balance run we now run a resolve-isolated pass (detect isolated → move by adjacency in a loop, up to 10 iterations), then a second balance run, then a second resolve-isolated pass, then a third balance run. Optional `step0IslandTractIds` accepted in the request body. So one Balance click clears isolated tracts (e.g. district 3) that appear after balancing.
- **Balance until tolerance or best:** Increased `balanceDistrictsByVariance` max iterations from 50 to 150 so a single balance run can complete without hitting the cap. The loop already exits only when all districts are within target variance (1%) or no improving move is found; the higher cap avoids early exit on large states.

Files: `backend/index.js` (balance-after-isolated flow), `backend/services/geodistrict-algorithm.js` (maxIterations 50 → 150).
