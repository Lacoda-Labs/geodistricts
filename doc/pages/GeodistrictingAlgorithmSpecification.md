# Geodistricting Algorithm Specification v2.0

## Core Principles
1. **Population Equality First**: Districts must be as close to equal population as possible (target: <1% variance).
2. **Contiguity Preferred**: Districts should be contiguous when possible, but discontiguity is acceptable (e.g., for islands, geographic barriers).
3. **Objective & Automated**: No human intervention; algorithm runs deterministically based on census data.
4. **Direct Tract Division**: Work directly with census tracts using latitude/longitude dividing lines for geographic distribution.

## Algorithm Overview
**Input**: State abbreviation, census tract data (population + boundaries).
**Output**: Set of districts, each with assigned census tracts, meeting population targets.

**High-Level Steps**:
1. **Initialize**: Fetch all census tracts for the state; calculate target population per district.
2. **Lat/Long Division**: Progressively divide tract groups using alternating latitude and longitude dividing lines.
3. **Contiguity Management**: Detect and resolve isolated tracts by moving them to adjacent connected groups.
4. **Validation**: Check population variance and contiguity; log any discontiguous districts.

## Detailed Specification

### Step 1: Initialization
```
Given: state (e.g., "AZ"), totalDistricts (from congressional-districts.service.ts)

1.1 Fetch tract data:
   - Get all census tracts for state (via /api/census/tract-data?state=X)
   - Calculate total state population (sum of all tract populations)

1.2 Calculate targets:
   - totalStatePopulation = sum of all tract populations
   - targetDistrictPopulation = totalStatePopulation / totalDistricts
   - maxAllowedVariance = 0.01 * targetDistrictPopulation (1% tolerance)

1.3 Initialize district groups:
   - Start with single group containing all tracts
   - Track: startDistrictNumber, endDistrictNumber, censusTracts[], totalDistricts, totalPopulation
```

**Challenges & Solutions**:
- **Challenge**: Large states (CA: ~8K tracts) slow initial fetch.
- **Solution**: Parallel API calls; cache results; show progress in UI.

### Step 2: Lat/Long Division (Progressive Balancing)
```
Repeat until each group has 1 district:

2.1 Select group to divide:
   - Pick group with most districts (if tied, largest population)
   - Skip if group.totalDistricts == 1

2.2 Calculate division ratio:
   - If group.totalDistricts is even: split 50/50
   - If odd: split (n-1)/2 and (n+1)/2 (e.g., 9 → 4+5)
   - targetFirstGroupPopulation = group.totalPopulation * (firstDistricts / group.totalDistricts)

2.3 Sort tracts geographically:
   - Sort tracts by alternating latitude/longitude boundaries
   - Iteration 1: sort by south boundary (latitude, north to south)
   - Iteration 2: sort by east boundary (longitude, west to east)
   - Continue alternating directions

2.4 Divide tracts by population:
   - Accumulate sorted tract populations until ≥ targetFirstGroupPopulation
   - Split at tract boundary (don't split individual tracts)
   - Keep tract groups together (enclosed tracts stay with enclosing tracts)

2.5 Create new groups:
   - Update startDistrictNumber/endDistrictNumber for each group
   - Recalculate totalPopulation, bounds, centroid
```

**Challenges & Solutions**:
- **Challenge**: Geographic sorting might create non-contiguous tract groups.
- **Solution**: Accept discontiguity; detect and resolve isolated tracts in Step 3.
- **Challenge**: Large tracts might exceed target population.
- **Solution**: Accept variance; log it (e.g., "District 5: +15% population due to large tract").

### Step 3: Contiguity Management
```
For each division result:

3.1 Detect isolated tracts:
   - Build adjacency graph using S4 adjacency data
   - Find tracts with no adjacent neighbors in same district group

3.2 Resolve isolation:
   - Move isolated tracts to adjacent connected groups
   - Prefer groups where tract has neighbors; balance population
   - Handle bridge tracts (connecting isolated to main component)

3.3 Validate contiguity:
   - Calculate contiguity score (% of tracts with adjacent neighbors)
   - Log discontiguous districts for transparency
```

**Challenges & Solutions**:
- **Challenge**: Complex geographic barriers create natural discontiguity.
- **Solution**: Document rationale; show contiguity scores; accept for geographic necessity.

### Step 4: Validation & Output
```
4.1 Calculate statistics:
   - Population variance per district (vs. targetDistrictPopulation)
   - Contiguity score per district (via adjacency map of tracts)
   - Geographic bounds per district

4.2 Generate output:
   - List of districts with assigned tracts
   - Summary: total variance, discontiguous districts, warnings
   - Visualization data: tract boundaries, district colors, centroids

4.3 Log results:
   - "District 1: 847,392 people (target: 845,123, variance: +0.27%)"
   - "District 3: 78% contiguous (2 isolated tracts in County X)"
```

## Implementation Notes

### Data Structures
```typescript
interface DistrictGroup {
  censusTracts: CensusTractData[];
  startDistrictNumber: number;
  endDistrictNumber: number;
  totalDistricts: number;
  totalPopulation: number;
  bounds: { north: number; south: number; east: number; west: number };
  centroid: { lat: number; lng: number };
}

interface District {
  districtNumber: number;
  tracts: CensusTractData[];
  population: number;
  populationVariance: number; // % from target
  contiguityScore: number; // % of tracts with adjacent neighbors
  isContiguous: boolean;
}
```

### Key Functions
- `sortTractsGeographically(tracts, direction)`: Sort tracts by lat/lng boundaries, alternating directions.
- `divideTractsByPopulation(tracts, targetPop, direction)`: Split sorted tracts to meet population target.
- `findDivisionIndex(tracts, direction, targetPop)`: Find optimal split point in sorted tract array.
- `detectIsolatedTracts(groups, adjacencyGraph)`: Find tracts disconnected from main component.
- `moveIsolatedTracts(isolated, groups, adjacencyGraph)`: Reassign isolated tracts to connected groups.
- `calculateContiguityScore(tracts)`: Check adjacency; return % contiguous.
- `validatePopulationVariance(districts, target)`: Ensure <1% variance.

### Performance Optimizations
- **Parallel Fetching**: Use `forkJoin` for county/tract data (already implemented).
- **Caching**: Store county boundaries; reuse for multiple runs.
- **Early Termination**: If population variance <0.5%, skip further refinement.
- **Spatial Indexing**: For large states, use R-tree for faster adjacency checks.

## Advantages of This Approach

1. **Simplicity**: Direct tract-level operation makes algorithm easy to understand and debug.
2. **Performance**: Fast O(n log n) sorting with O(n) population accumulation per division.
3. **Flexibility**: Handles both contiguous (most states) and discontiguous (HI/AK) scenarios naturally.
4. **Transparency**: Logs all decisions (dividing lines, population variances, contiguity) for auditability.
5. **Scalability**: Works for small states (WY: 1 district) and large ones (CA: 52 districts).

## Potential Issues & Mitigations

- **Issue**: Lat/long dividing lines might create arbitrary district boundaries.
  - **Mitigation**: Lines follow population distribution; geographic necessity takes precedence over straight lines.

- **Issue**: Large tracts might cause population variance.
  - **Mitigation**: Accept variance for indivisible tracts; log clearly for transparency.

- **Issue**: Discontiguous districts might face legal challenges.
  - **Mitigation**: Document rationale (geographic barriers, population equality); show contiguity scores.

- **Issue**: Algorithm might be too complex for some users.
  - **Mitigation**: Provide simple UI (just run algorithm) and detailed logs for experts.

## Testing Strategy

### Test Cases
1. **Arizona** (~1.5K tracts, 9 districts): Balanced tract distribution, good for initial testing.
2. **California** (~8K tracts, 52 districts): Large state with urban/rural tract size variations.
3. **Wyoming** (~130 tracts, 1 district): Edge case - single district state.
4. **Hawaii** (~290 tracts, 2 districts): Island state with natural discontiguity.

### Success Metrics
- Population variance < 1% for all districts
- Contiguity score > 80% for mainland states
- Algorithm completion time < 30 seconds for large states
- Clear logging of all decisions and edge cases

## Implementation Status

1. **Completed**: Lat/long division algorithm implemented in `geodistrict-algorithm.js` and `latlong-division.js`.
2. **Completed**: Contiguity detection and isolated tract resolution implemented.
3. **Completed**: Step-by-step execution with caching and visualization.
4. **Ongoing**: Performance optimization and edge case handling.
5. **Updated**: This specification now accurately reflects the implementation.


## Current Implementation Details

The algorithm uses lat/long dividing lines implemented in `backend/services/latlong-division.js`. Key features:

- **Fast Division**: Sorts tracts by geographic boundaries (latitude/longitude alternating), then accumulates population to find optimal split points.
- **Tract Group Integrity**: Keeps enclosed tracts with their enclosing tracts during division.
- **Contiguity Management**: Post-division detection and resolution of isolated tracts using S4 adjacency data.
- **Performance**: O(n log n) sorting per division with caching for repeated runs.
