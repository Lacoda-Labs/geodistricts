# Step 0 - Algorithm Initialization Summary

### Purpose
Initializes the algorithm and creates the starting state with all census tracts in a single district group.

### Process Flow

1. **Data Loading** (`backend/index.js` lines 3266-3340):
   - Fetches tract boundaries from TIGER/Line shapefiles
   - Fetches demographic data (population) from Census API via bulk endpoint
   - Loads S4 adjacency data for the state
   - Creates canonical tract model combining Census API data (primary) with TIGER polygons and S4 data

2. **Tract Processing** (`backend/index.js` lines 3342-3399):
   - Detects enclosed/enclosing tract relationships
   - Assigns `TRACT_GROUP_ID` to link enclosed and enclosing tracts
   - Stores metadata: `ENCLOSED_BY`, `ENCLOSES` properties

3. **Cache Check** (`backend/index.js` lines 3403-3611):
   - Checks for cached Step 0
   - Validates cache version matches current algorithm version
   - If valid cache exists, returns cached step (with union polygon reconstruction)
   - If invalid or missing, proceeds to fresh initialization

4. **Algorithm Initialization** (`backend/services/geodistrict-algorithm.js` lines 1516-1588):
   - **Preloads S4 adjacency data** for the state
   - **Deduplicates tracts**: Merges duplicate tracts (e.g., MultiPolygon parts) using `deduplicateAndMergeTracts()`
   - **Calculates totals**:
     - `totalStatePopulation` = sum of all tract populations
     - `targetDistrictPopulation` = totalStatePopulation / totalDistricts
   - **Creates initial district group**:
     - Contains all unique tracts
     - `startDistrictNumber: 1`, `endDistrictNumber: totalDistricts`
     - Calculates bounds and centroid
   - **Assigns DG properties** to all tracts:
     - `tract_DG`: `DG1-{totalDistricts}` (e.g., "DG1-52" for California)
     - `parent_DG`: null (no parent for initial state)
     - `sibling_DG`: null (no sibling for initial state)
   - **Creates Step 0** with union polygons for visualization

5. **State Storage**:
   - Stores algorithm state in memory (`algorithmStateStore`)
   - Returns Step 0 with complete district group data

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
- Step 0 represents the pre-division state: all tracts in one group
- Union polygons are created for visualization
- Caching is used to avoid recomputing Step 0
- Enclosed tract relationships are detected and stored for later use
- The canonical tract model ensures data consistency across sources

This initialization sets up the state for iterative division in subsequent steps.