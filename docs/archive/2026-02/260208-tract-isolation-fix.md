# 260208 – Tract isolation detection fix (CO “nearly all isolated”)

## Context

- **Symptom:** CO completed and the last step had nearly all tracts flagged as isolated.
- **Docs/chats:** `doc/history/251204-island-tract-detection.md`, `.cursor/archive/2025-12/251204.md`, `251125.md`, `251128.md`, algorithm spec (contiguity management).

## Root cause (intended fix)

1. **“Nearly all isolated”**  
   Isolation is computed from an adjacency graph (S4). If the graph is empty or tract IDs don’t match S4 keys, each tract has 0 neighbors → reachable count = 1 → main component size = 1 → all other tracts are “isolated.” So the bug is effectively **empty or wrong adjacency** (e.g. S4 not loaded, or ID format mismatch between tracts and S4).

2. **Island tracts in later steps**  
   Doc 251204: “island tracts need to be excluded from isolated tract detect in all steps.” Step 0 correctly treats disconnected components as geographic islands and does not add them to `isolatedTractsByGroup`. Steps 1+ did not exclude those same tracts, so geographic islands could be reported as “isolated” in later steps.

## Changes made

### 1. Adjacency diagnostics (`backend/services/geodistrict-algorithm.js`)

- **`buildGeometryAdjacencyGraph`**
  - After building from S4, compute % of tracts that have at least one neighbor.
  - If &lt; 50% and tract count &gt; 10: log a warning with sample input tract IDs and sample S4 graph keys so ID format mismatch (e.g. CO) can be spotted.
  - In the fallback (no S4): log sample tract IDs and state so “no S4” vs “wrong state” can be distinguished.

### 2. Step-0 island exclusion in all steps (doc 251204)

- **`createStep`**
  - New optional parameter: `step0IslandTractIds` (Set or array of geographic island tract IDs from step 0).
  - Passed through to `detectIsolatedTracts(..., step0IslandTractIds)`.

- **`detectIsolatedTracts`**
  - New optional parameter: `step0IslandTractIds`.
  - When `stepNumber` !== 0 and `step0IslandTractIds` is provided, any tract in that set is removed from the “isolated” set for that group, so geographic islands are not reported as isolated in steps 1+.

- **`executeGeodistrictAlgorithm`**
  - Step 0 is now created with `(this, uniqueTracts)` so island detection runs and `step0.islandTractsData` is set.
  - After step 0, flatten `islandTractsByGroup` into a Set `step0IslandTractIds` and pass it into every subsequent `createStep(..., step0IslandTractIds)`.

## What to do next for CO “nearly all isolated”

1. **Re-run CO** and check backend logs:
   - If you see: “Only X% of tracts have S4 neighbors” and sample input IDs vs S4 keys, that confirms an **ID format mismatch** (e.g. Census `GEOID` vs S4 CSV format). Fix by normalizing tract IDs to the same format as S4 (e.g. 11-digit string, leading zeros) before building the graph or when loading S4.
   - If you see: “S4 adjacency data not available for state ‘…’”, then **S4 is not loaded** for that request (e.g. wrong state in tract `properties.STATE`, or load order). Ensure tracts have `properties.STATE` set to the state abbreviation (e.g. `'CO'`) and that S4 is loaded before the algorithm run.

2. **S4 key format:**  
   In `s4-data-loader.js`, S4 uses `tract.GEOID` from `tract_2020.csv`. Ensure `getTractId(tract)` in the algorithm returns the same string format (e.g. 11-digit GEOID).

## References

- `doc/history/251204-island-tract-detection.md` – Step 0 island tracts, exclude from isolation in all steps.
- `doc/pages/GeodistrictingAlgorithmSpecification.md` – Contiguity management, detect isolated tracts, move to adjacent groups.
- `.cursor/archive/2025-12/251204.md` – Island tracts excluded from isolated list; `.isolated-tracts-container` when none found.
- `.cursor/archive/2025-11/251125.md` – Move isolated logic, cache persistence, bridge tract target group.
