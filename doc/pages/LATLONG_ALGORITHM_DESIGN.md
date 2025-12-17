# LatLong Geodistricting Algorithm Design Document

## Overview

The LatLong algorithm is a recursive division algorithm that creates congressional districts by repeatedly dividing geographic regions using latitude and longitude dividing lines. The algorithm alternates between dividing by latitude and longitude on each iteration, creating a hierarchical tree structure of districts.

## Algorithm Goals

1. **Equal Population**: Create districts with approximately equal population
2. **Geographic Contiguity**: Ensure all tracts within a district are connected
3. **Geographic Compactness**: Use simple lat/long lines to create reasonably compact districts
4. **Completeness**: Every census tract is assigned to exactly one district

## High-Level Algorithm Flow

```
1. Initialize: All tracts in a single group
2. While any group has more than 1 district:
   a. For each group with >1 district:
      - Determine division direction (latitude or longitude)
      - Calculate optimal division ratio (split districts roughly in half)
      - Find optimal dividing line to match target population
      - Divide tracts by the line
   b. Fix isolated tracts (move disconnected tracts to adjacent groups)
   c. Validate: Ensure no duplicate or missing tract assignments
3. Return final districts
```

## Data Structures

### District Group

A district group represents a collection of census tracts that will become one or more congressional districts.

```javascript
{
  startDistrictNumber: number,      // First district number in this group
  endDistrictNumber: number,         // Last district number in this group
  censusTracts: Array<Tract>,       // Census tracts in this group
  totalDistricts: number,           // Number of districts this group represents
  totalPopulation: number,          // Total population of all tracts
  bounds: BoundingBox,              // Geographic bounds of the group
  centroid: { lat: number, lng: number }  // Geographic center
}
```

### Tract

A census tract is a GeoJSON feature with:
- `geometry`: Polygon or MultiPolygon geometry
- `properties.POPULATION`: Population count
- `properties.TRACT_FIPS` or `properties.GEOID`: Unique tract identifier

## Core Algorithm Steps

### 1. Initialization

**Input Validation and Deduplication**
- Remove duplicate tracts from input (each tract ID must appear only once)
- Calculate total state population
- Create initial group containing all tracts

**Code Location**: `executeGeodistrictAlgorithm()` lines 491-522

### 2. Main Division Loop

The algorithm iterates until all groups represent exactly one district each.

**Iteration Logic**:
- **Direction Alternation**: Odd iterations divide by latitude, even iterations divide by longitude
- **Parallel Division**: All groups with `totalDistricts > 1` are divided simultaneously
- **Termination**: Loop stops when all groups have `totalDistricts === 1` or max iterations reached

**Code Location**: `executeGeodistrictAlgorithm()` lines 533-714

### 3. Division Process

For each group that needs division:

#### 3.1 Calculate Division Ratio

Splits districts roughly in half:
- If group has N districts, split into ⌈N/2⌉ and ⌊N/2⌋ districts
- Example: 9 districts → 5 and 4 districts (56%/44% ratio)

**Code Location**: `calculateOptimalDivision()` in `latlong-division.js` lines 11-23

#### 3.2 Find Optimal Dividing Line

Uses an iterative approach to find the lat/long line that best matches the target population:

1. **Determine Coordinate Range**: Find min/max latitude or longitude of all tracts
2. **Start at Center**: Begin with the midpoint coordinate
3. **Iterative Refinement**:
   - Calculate population on each side of the line
   - Compare to target population
   - Adjust line position based on population difference
   - Repeat until within 0.5% of target or max iterations (20)
4. **Binary Search Fallback**: If iterative approach doesn't converge well (>5% error), use binary search

**Key Parameters**:
- Max iterations: 20 (iterative), 50 (binary search)
- Tolerance: 0.0001 degrees (~10 meters)
- Target accuracy: Within 0.5% of target population

**Code Location**: `findOptimalDividingLine()` in `latlong-division.js` lines 103-176

#### 3.3 Divide Tracts by Line

Assigns each tract to one of two groups based on the dividing line:

**Tract Classification**:
1. **Entirely North/West**: Tract's bounding box is completely on one side → assign to that side
2. **Intersects Line**: Tract crosses the dividing line → assign based on tract centroid
   - If centroid is north/west of line → first group
   - Otherwise → second group

**Duplicate Prevention**:
- Tracks assigned tract IDs to prevent duplicates
- Skips any tract that appears multiple times in input

**Code Location**: `divideTractsByLine()` in `latlong-division.js` lines 216-275

#### 3.4 Create New Groups

Creates two new district groups from the divided tracts:
- First group: Districts `startDistrictNumber` to `startDistrictNumber + first - 1`
- Second group: Districts `startDistrictNumber + first` to `endDistrictNumber`
- Recalculates population, bounds, and centroid for each group

**Code Location**: `divideDistrictGroup()` in `latlong-division.js` lines 357-376

### 4. Isolation Detection and Fixing

After each division step, the algorithm identifies and fixes isolated tracts.

#### 4.1 Isolation Detection

A tract is considered "isolated" if it's not part of the main connected component of its group.

**Method**: Reachable Count Algorithm
1. Build adjacency graph from S4 adjacency data (or geometry-based if S4 unavailable)
2. For each group, calculate the maximum reachable count (size of largest connected component)
3. For each tract, calculate how many tracts it can reach within its group
4. If `tractReachableCount < groupMaxReachableCount`, the tract is isolated

**Code Location**: `fixIsolatedTractsAcrossAllGroups()` in `geodistrict-algorithm.js` lines 294-468

#### 4.2 Isolation Fixing

For each isolated tract:
1. **Find Neighbor Groups**: Identify which groups contain neighbors of the isolated tract
2. **Evaluate Candidates**: For each neighbor group, calculate what the tract's reachable count would be if moved there
3. **Select Best Group**: Choose the group where the tract would connect to the main component (reachable count = max reachable count)
4. **Move Tract**: Remove from source group, add to target group, update group statistics

**Processing Strategy**:
- Collect all unique tracts upfront to ensure each tract is processed exactly once
- Track current group assignments dynamically as tracts move
- Verify tract is still in expected group before processing (may have been moved already)

**Code Location**: `fixIsolatedTractsAcrossAllGroups()` in `geodistrict-algorithm.js` lines 315-459

### 5. Validation and Error Correction

After each division and isolation fixing step, the algorithm validates the state:

#### 5.1 Duplicate Detection

Checks if any tract is assigned to multiple groups:
- Builds a map of tract ID → list of group indices
- Identifies tracts appearing in multiple groups
- **Fix**: Keep tract in first group, remove from all others

**Code Location**: `executeGeodistrictAlgorithm()` lines 612-658

#### 5.2 Missing Tract Detection

Checks if any tract is not assigned to any group:
- Compares all input tract IDs to assigned tract IDs
- **Fix**: Assign missing tract to nearest group (by centroid distance)

**Code Location**: `executeGeodistrictAlgorithm()` lines 660-710

## Key Algorithms

### Optimal Division Calculation

```javascript
function calculateOptimalDivision(totalDistricts) {
  if (totalDistricts === 1) return { ratio: [100, 0], first: 1, second: 0 };
  
  const firstGroupDistricts = Math.ceil(totalDistricts / 2);
  const secondGroupDistricts = totalDistricts - firstGroupDistricts;
  
  return {
    ratio: [firstRatio, secondRatio],
    first: firstGroupDistricts,
    second: secondGroupDistricts
  };
}
```

**Example Progressions**:
- 9 districts → 5 + 4 → 3+2, 2+2 → 2+1, 1+1, 1+1, 1+1 → all single districts
- Creates a binary tree structure

### Dividing Line Finding

**Iterative Approach**:
1. Start at coordinate midpoint
2. Calculate population difference from target
3. Adjust line: `newLine = currentLine + (populationDiff / target) * range * 0.1`
4. Clamp to valid range
5. Repeat until convergence

**Binary Search Fallback**:
- If iterative approach doesn't converge (<5% error)
- Binary search between min and max coordinates
- Choose midpoint, compare population, narrow search range

### Tract Assignment Logic

```javascript
if (tract intersects dividing line) {
  if (tract.centroid.lat/lng <= dividingLine) {
    assign to firstGroup;
  } else {
    assign to secondGroup;
  }
} else if (tract entirely north/west of line) {
  assign to firstGroup;
} else {
  assign to secondGroup;
}
```

## Edge Cases and Error Handling

### Duplicate Tracts in Input

**Problem**: Input tract array may contain duplicate tract IDs

**Solution**:
- Deduplicate at algorithm start (keep first occurrence)
- Log warning with count and examples
- Use deduplicated array throughout algorithm

**Code Location**: `executeGeodistrictAlgorithm()` lines 491-507

### Duplicate Tracts After Division

**Problem**: Division may accidentally assign same tract to multiple groups

**Solution**:
- Validate immediately after division
- If duplicates found, keep in first group, remove from others
- Log error with tract ID and group count

**Code Location**: `executeGeodistrictAlgorithm()` lines 581-607

### Missing Tracts

**Problem**: Tract not assigned to any group after division

**Solution**:
- Detect missing tracts by comparing input to assigned
- Assign to nearest group by centroid distance
- Log fix with tract ID and target group

**Code Location**: `executeGeodistrictAlgorithm()` lines 669-710

### Isolated Tracts

**Problem**: Tract is disconnected from main component of its group

**Solution**:
- Detect using reachable count algorithm
- Move to adjacent group where it connects to main component
- If no suitable group found, leave isolated (logged as warning)

**Code Location**: `fixIsolatedTractsAcrossAllGroups()` in `geodistrict-algorithm.js`

### Non-Contiguous Groups

**Problem**: Division may create non-contiguous groups

**Current Status**: 
- Contiguity validation is stubbed (always returns true)
- TODO: Implement full contiguity checking using S4 adjacency data
- Warning logged if non-contiguous groups detected

**Code Location**: `validateContiguity()` in `latlong-division.js` lines 281-285

## Performance Characteristics

### Time Complexity

- **Division**: O(N) per iteration where N = number of tracts
- **Isolation Fixing**: O(N × M) where M = average neighbors per tract
- **Total**: O(I × N × M) where I = number of iterations

Typical iterations: log₂(totalDistricts), so ~5-7 iterations for 9-52 districts

### Space Complexity

- **Tract Storage**: O(N) - one copy per tract
- **Adjacency Graph**: O(N × M) - neighbors per tract
- **Group Storage**: O(N) - tracts distributed across groups

## Algorithm Versioning

The algorithm uses version strings to track changes and invalidate cached results:

- **Format**: `YYYYMMDD-HHMM` (e.g., `20251117-2010`)
- **Increment**: When algorithm logic changes
- **Cache Invalidation**: Backend compares cached version to current version
- **Location**: `ALGORITHM_VERSION` constant in `geodistrict-algorithm.js`

## Limitations and Future Improvements

### Current Limitations

1. **Contiguity Validation**: Not fully implemented (stubbed)
2. **Geographic Compactness**: Simple lat/long lines may not create optimally compact districts
3. **Population Balancing**: Only considers total population, not demographic balance
4. **No Political Considerations**: Doesn't account for existing district boundaries, communities of interest, etc.

### Potential Improvements

1. **Full Contiguity Checking**: Implement using S4 adjacency data
2. **Alternative Division Methods**: 
   - Use shortest split line algorithm
   - Consider geographic features (rivers, mountains)
   - Weight by population density
3. **Multi-Objective Optimization**: Balance population, compactness, and other criteria
4. **Incremental Refinement**: After initial division, optimize boundaries to improve compactness
5. **Demographic Balance**: Consider racial/ethnic demographics in addition to total population

## Example Execution

For Arizona (9 districts, ~1765 tracts):

1. **Iteration 1 (Latitude)**: 
   - Divide single group into 5 + 4 districts
   - Dividing line: ~33.5°N
   - Fix ~50-100 isolated tracts

2. **Iteration 2 (Longitude)**:
   - Divide 5-district group into 3 + 2
   - Divide 4-district group into 2 + 2
   - Fix isolated tracts

3. **Iteration 3 (Latitude)**:
   - Continue dividing groups with >1 district
   - Fix isolated tracts

4. **Iteration 4-5**: Continue until all groups are single districts

5. **Result**: 9 districts, each with ~795,000 people (target: 794,000)

## References

- **Code Files**:
  - `backend/services/latlong-division.js` - Division logic
  - `backend/services/geodistrict-algorithm.js` - Main algorithm orchestration
  - `backend/services/s4-data-loader.js` - Adjacency data loading

- **Related Documentation**:
  - See `doc/STATE_DATA_SOURCES.md` for data source information
  - See `doc/IMPLEMENTATION_VERIFICATION.md` for testing approach

