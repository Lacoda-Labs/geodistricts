# Step 0 - Algorithm Initialization Summary

### Purpose
Initializes the algorithm and creates the starting state with all census tracts in a single district group.

### Process Flow

1. **Data loading** (step-by-step handler in `backend/index.js`; see POST `/api/algorithm/execute/step-by-step`):
   - **Optional short-circuit:** If not `forceInvalidate`, checks for valid **state tract cache** (`state_tracts_{state}`). If valid (version and geometry coverage), loads tracts from that cache and skips external fetch (no TIGER boundaries or Census bulk call). This keeps EXTERNAL FETCH rare after the first run.
   - **Otherwise:** Fetches tract boundaries from TIGER/Line (streaming for large states like CA), fetches demographic data (population) from Census API via bulk endpoint, loads S4 adjacency data, and creates canonical tract model (Census primary, TIGER polygons, S4 attached).

2. **Tract processing**:
   - Detects enclosed/enclosing tract relationships; assigns `TRACT_GROUP_ID`; stores `ENCLOSED_BY`, `ENCLOSES` properties.

3. **Step 0 cache check**:
   - Checks for cached Step 0 (`algorithm_step_{state}_{maxIterations}_0`).
   - Validates cache version and TTL. If valid, returns cached step (with TIGER state boundary and optional reconstruction from state tract cache).
   - **When returning cached Step 0, the backend always writes algorithm state at iteration 0** (uniqueTractIds, currentGroups from step 0, steps: [step0]) so that the next “Next” runs step 1. This fixes the restart bug where Next would otherwise skip to the last completed step.

4. **Algorithm initialization** (`backend/services/geodistrict-algorithm.js`):
   - Deduplicates tracts; computes total population and target per district.
   - Creates one initial district group (all tracts); assigns `tract_DG`, `parent_DG`, `sibling_DG`.
   - Creates Step 0 (no union from tracts; step 0 uses TIGER state boundary).

5. **State storage**:
   - Caches algorithm state (iteration 0, steps, currentGroups, etc.) and Step 0 (union = TIGER state boundary in Cloud Storage). Optionally writes/updates state tract cache if missing or regenerating.

### Output Structure
```javascript
{
  step: {
    stepNumber: 0,
    iteration: 0,
    districtGroups: [{
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: [...all unique tracts...],
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: {...},
      centroid: {...},
      unionPolygon: {...} // GeoJSON polygon
    }],
    description: "Initial state: All tracts in single group"
  },
  state: {
    uniqueTracts: [...],
    currentGroups: [...],
    iteration: 0,
    steps: [step0],
    algorithmHistory: [],
    totalStatePopulation: ...,
    targetDistrictPopulation: ...,
    maxIterations: 100,
    state: "CA"
  }
}
```

### Notes
- Step 0 represents the pre-division state: all tracts in one group.
- Step 0 uses the **TIGER state boundary** for the union polygon (not tract-based union); this is cached and reused.
- Caching is used to avoid recomputing Step 0. When the backend serves cached Step 0, it **must** set algorithm state to iteration 0 so that the next “Next” runs step 1 (restart semantics).
- Enclosed tract relationships are detected and stored for later use.
- The canonical tract model (or state tract cache) ensures data consistency across sources.
- External data (tract boundaries, census tract data, state tract cache) is never invalidated by trash or restart; only algorithm step cache and algorithm state are cleared.

This initialization sets up the state for iterative division in subsequent steps.