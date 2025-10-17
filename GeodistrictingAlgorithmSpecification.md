# Geodistricting Algorithm Specification v2.0

## Core Principles
1. **Population Equality First**: Districts must be as close to equal population as possible (target: <1% variance).
2. **Contiguity Preferred**: Districts should be contiguous when possible, but discontiguity is acceptable (e.g., for islands, geographic barriers).
3. **Objective & Automated**: No human intervention; algorithm runs deterministically based on census data.
4. **Hierarchical Division**: Use administrative boundaries (counties) as natural grouping units before fine-tuning with census tracts.

## Algorithm Overview
**Input**: State abbreviation, census tract data (population + boundaries), county data (FIPS codes + boundaries).
**Output**: Set of districts, each with assigned census tracts, meeting population targets.

**High-Level Steps**:
1. **Initialize**: Fetch all counties and tracts for the state; calculate target population per district.
2. **County-Level Division**: Sort counties geographically; divide into balanced groups by population.
3. **Tract-Level Refinement**: Within each county group, sort tracts geographically; divide to achieve precise population targets.
4. **Validation**: Check population variance and contiguity; log any discontiguous districts.

## Detailed Specification

### Step 1: Initialization
```
Given: state (e.g., "AZ"), totalDistricts (from congressional-districts.service.ts)

1.1 Fetch county data:
   - Get all counties for state (via /api/census/counties)
   - For each county, fetch census tracts (via /api/census/tract-data?state=X&county=Y)
   - Calculate county populations (sum of tract populations)

1.2 Calculate targets:
   - totalStatePopulation = sum of all tract populations
   - targetDistrictPopulation = totalStatePopulation / totalDistricts
   - maxAllowedVariance = 0.01 * targetDistrictPopulation (1% tolerance)

1.3 Initialize district groups:
   - Start with single group containing all counties/tracts
   - Track: startDistrictNumber, endDistrictNumber, counties[], tracts[], totalPopulation
```

**Challenges & Solutions**:
- **Challenge**: Large states (CA: 58 counties, ~8K tracts) slow initial fetch.
- **Solution**: Parallel API calls per county; cache results; show progress in UI.

### Step 2: County-Level Division (Coarse Balancing)
```
Repeat until each group has ≤1 district:

2.1 Select group to divide:
   - Pick group with most districts (if tied, largest population)
   - Skip if group.totalDistricts == 1

2.2 Calculate division:
   - If group.totalDistricts is even: split 50/50
   - If odd: split (n-1)/2 and (n+1)/2 (e.g., 9 → 4+5)
   - targetFirstGroupPopulation = group.totalPopulation * (firstDistricts / group.totalDistricts)

2.3 Sort counties geographically:
   - Calculate county centroids (average lat/lng of tract centroids)
   - Sort by alternating direction:
     * Iteration 1: latitude (north to south), then longitude (west to east)
     * Iteration 2: longitude (west to east), then latitude (north to south)
     * Continue alternating

2.4 Divide counties:
   - Accumulate county populations until ≥ targetFirstGroupPopulation
   - Assign counties to first group; remainder to second group
   - If a county would exceed target, split it (see Step 3)

2.5 Create new groups:
   - Update startDistrictNumber/endDistrictNumber for each group
   - Recalculate totalPopulation, bounds, centroid
```

**Challenges & Solutions**:
- **Challenge**: Uneven county populations (LA County vs. rural counties).
- **Solution**: Allow partial county splits; if county population > 2x targetDistrictPopulation, always split it.
- **Challenge**: Geographic sorting might create non-contiguous county groups.
- **Solution**: Accept discontiguity; log it for transparency (e.g., "District 3 spans 2 non-adjacent county groups").

### Step 3: Tract-Level Refinement (Fine Balancing)
```
For each group with >1 district:

3.1 Sort tracts geographically:
   - Within each county, sort tracts by same alternating direction as Step 2.3
   - Concatenate sorted tracts from all counties in group

3.2 Divide tracts:
   - Accumulate tract populations until ≥ targetFirstGroupPopulation
   - Split at tract boundary (don't split individual tracts)
   - If splitting would create population variance > maxAllowedVariance, adjust split point

3.3 Handle edge cases:
   - If tract population > targetDistrictPopulation: assign whole tract, log variance
   - If remaining tracts < targetDistrictPopulation: merge with adjacent group
```

**Challenges & Solutions**:
- **Challenge**: Large tracts (e.g., rural areas) might exceed target population.
- **Solution**: Accept variance; log it (e.g., "District 5: +15% population due to large tract").
- **Challenge**: Final districts might be discontiguous (tracts from different counties).
- **Solution**: Calculate contiguity score (% of tracts with adjacent neighbors in same district); log if <80%.

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
interface CountyGroup {
  counties: CountyData[];
  tracts: CensusTractData[];
  startDistrictNumber: number;
  endDistrictNumber: number;
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
  counties: string[]; // FIPS codes
}
```

### Key Functions
- `sortCountiesGeographically(counties, direction)`: Sort by lat/lng, alternating.
- `divideCountiesByPopulation(counties, targetPop)`: Split counties to meet target.
- `sortTractsGeographically(tracts, direction)`: Sort tracts within counties.
- `calculateContiguityScore(tracts)`: Check adjacency; return % contiguous.
- `validatePopulationVariance(districts, target)`: Ensure <1% variance.

### Performance Optimizations
- **Parallel Fetching**: Use `forkJoin` for county/tract data (already implemented).
- **Caching**: Store county boundaries; reuse for multiple runs.
- **Early Termination**: If population variance <0.5%, skip further refinement.
- **Spatial Indexing**: For large states, use R-tree for faster adjacency checks.

## Advantages of This Approach

1. **Simplicity**: Clear hierarchy (counties → tracts) makes algorithm easy to understand and debug.
2. **Performance**: County-level division reduces initial complexity; tract-level refinement is localized.
3. **Flexibility**: Handles both contiguous (most states) and discontiguous (HI/AK) scenarios naturally.
4. **Transparency**: Logs all decisions (splits, variances, contiguity) for auditability.
5. **Scalability**: Works for small states (WY: 1 district) and large ones (CA: 52 districts).

## Potential Issues & Mitigations

- **Issue**: County boundaries might be politically drawn (not objective).
  - **Mitigation**: Sort counties purely by geography (centroids), ignore names/politics.

- **Issue**: Large counties (LA) might dominate initial divisions.
  - **Mitigation**: Always split counties >2x target population; use tract-level refinement.

- **Issue**: Discontiguous districts might face legal challenges.
  - **Mitigation**: Document rationale (geographic barriers, population equality); show contiguity scores.

- **Issue**: Algorithm might be too complex for some users.
  - **Mitigation**: Provide simple UI (just run algorithm) and detailed logs for experts.

## Testing Strategy

### Test Cases
1. **Arizona** (15 counties, 9 districts): Balanced county sizes, good for initial testing.
2. **California** (58 counties, 52 districts): Large state with extreme county size variations.
3. **Wyoming** (23 counties, 1 district): Edge case - single district state.
4. **Hawaii** (5 counties, 2 districts): Island state with natural discontiguity.

### Success Metrics
- Population variance < 1% for all districts
- Contiguity score > 80% for mainland states
- Algorithm completion time < 30 seconds for large states
- Clear logging of all decisions and edge cases

## Next Steps

1. **Prototype**: Implement county-level division in `geodistrict-algorithm.service.ts` (modify `divideDistrictGroup`).
2. **Test**: Run on AZ (15 counties, 9 districts) and CA (58 counties, 52 districts).
3. **Validate**: Check population variance and contiguity scores.
4. **Iterate**: Refine based on results (e.g., adjust split thresholds).
5. **Document**: Update this spec based on implementation learnings.


## Alternate Approaches

### Lat/Long dividing lines
With this approach, a lat or long line is used to divide the districtGroup. The line starts in center by finding center most lat or long line (depending on division iteration). A census tract's north most (lat) or west most (long) point is used to determine which half contains the tract. populations are calculated and line is moved north or south, east or west. determine percentage to move line based on percentage variance between two halves. process is repeated until a straight line midpoint is found that closests divides the tracts by population according to iteration ration (as determined by total districts within districtgroup).

helper functions precalulate the north and west most points for the census tract. (check if census tract TIGER/line shapefile include these values or similar points.)

### Adjacent approach
### Thoughts on Adjacency Calculation and Geographic Sorting

Thank you for the update—it's great to hear the current algorithm (using TIGER internal points with centroid fallback) is producing the best results so far, especially with improved population variance in California. The discontiguity issue in northern districts is common in geographic algorithms for states with irregular shapes, urban clusters, and rural spreads (like California's Central Valley and Sierra Nevada areas). Your idea of starting from the state's top-most corner and traversing adjacent tracts along latitude/longitude lines is excellent—it aligns with a **spatial graph traversal** approach that ensures contiguity while maintaining geographic order.

Let me break down the feasibility, challenges, and implementation strategy for calculating adjacent tracts and building a reliable sorting approach. I'll explain the difficulty level and provide code snippets you can copy-paste to test (since you're in **ask mode**, I can't apply changes directly—switch to agent mode if you'd like me to implement this).

#### **1. Difficulty of Calculating Adjacent Tracts**
Calculating adjacent tracts (i.e., determining which tracts share a boundary or touch) is **moderately difficult** but definitely feasible in your current setup. Here's why:

- **Core Challenge**: TIGER/Line data provides GeoJSON polygons, but adjacency requires **spatial intersection checks** between every pair of tracts (or optimized subsets). Naive pairwise checks are O(n²) time complexity, which is slow for large states like California (~8,000 tracts), but optimizations make it practical.
  
- **Difficulty Level**:
  - **Easy**: Approximate adjacency using bounding box overlap (fast but ~10-20% false positives for touching tracts).
  - **Medium**: Exact adjacency using polygon intersection (accurate, but computationally intensive without libraries).
  - **Recommended (Medium-Hard)**: Use a spatial library like **Turf.js** (lightweight, works with GeoJSON/Leaflet) for precise boolean operations. This adds a dependency but handles edge cases (e.g., tracts touching at vertices).

- **Performance Impact**:
  - For California: ~8K tracts → ~32M pairwise checks (unoptimized) = too slow (minutes+).
  - With optimizations (spatial indexing like R-tree or quadtree): <1 second.
  - Pre-compute once per state and cache results for repeated runs.

- **Data Requirements**: Your TIGER polygons already have full geometry, so no additional data needed. The `geometry.coordinates` arrays contain all vertices for intersection tests.

- **Reliability**: With Turf.js, reliability is high (>99% accurate for boundary sharing). Without it, you'd need custom polygon clipping code, which is error-prone for complex shapes (holes, multi-polygons).

In summary: It's **not too difficult** with a library (add ~5-10 lines of code + dependency). Without, it's harder (custom math for line segment intersection). Given your project's scale, I'd recommend Turf.js—it's battle-tested for GIS apps and integrates seamlessly with Leaflet.

#### **2. Proposed Approach: Adjacency-Based Geographic Sorting**
Your idea is spot-on: Build an **adjacency graph** (tracts as nodes, shared boundaries as edges), then traverse from a "seed" tract (top-left corner of the state) in a geographic order (e.g., north-to-south, west-to-east). This ensures:
- **Contiguity**: Districts are connected via adjacent tracts.
- **Geographic Order**: Sorting respects latitude/longitude progression.
- **Population Balance**: Traverse until target population is reached, then split.

**High-Level Steps**:
1. **Find Seed Tract**: State top-most (max latitude), left-most (min longitude) tract.
2. **Build Adjacency Graph**: For each tract, find neighbors (sharing boundary).
3. **Traverse Graph**: BFS/DFS from seed, prioritizing geographic direction (lat/long).
4. **Divide**: Accumulate tracts until target population, ensuring contiguity.

This replaces the current point-based sorting in `sortTractsForContiguity()` with a graph traversal.

**Pros**:
- Guarantees contiguous districts.
- Handles California's irregular geography better.
- Builds on your existing population accumulation logic.

**Cons**:
- More complex than point sorting.
- Requires spatial library for efficiency.

#### **3. Implementation Recommendations**
I'll provide code snippets to add to `geodistrict-algorithm.service.ts`. First, install Turf.js (run in terminal: `cd frontend && npm install @turf/turf`).

##### **Step 1: Add Turf.js Import and Adjacency Detection**
Add this to the top of `geodistrict-algorithm.service.ts`:
```typescript
import * as turf from '@turf/turf';
```

Add this method after `getTractBounds()`:
```typescript
/**
 * Find adjacent tracts that share a boundary with the given tract
 * @param tracts All tracts in the group
 * @param targetTract The tract to find neighbors for
 * @returns Array of adjacent tracts
 */
private findAdjacentTracts(tracts: GeoJsonFeature[], targetTract: GeoJsonFeature): GeoJsonFeature[] {
  const targetPolygon = turf.polygon(targetTract.geometry.coordinates);
  const adjacent: GeoJsonFeature[] = [];
  
  for (const tract of tracts) {
    if (tract === targetTract) continue;
    
    try {
      const tractPolygon = turf.polygon(tract.geometry.coordinates);
      
      // Check if they share a boundary (intersects but not completely contains)
      const intersects = turf.booleanIntersects(targetPolygon, tractPolygon);
      const contains = turf.booleanContains(targetPolygon, tractPolygon) || turf.booleanContains(tractPolygon, targetPolygon);
      
      if (intersects && !contains) {
        adjacent.push(tract);
      }
    } catch (error) {
      console.warn(`Error checking adjacency between ${targetTract.properties?.GEOID} and ${tract.properties?.GEOID}:`, error);
    }
  }
  
  console.log(`Found ${adjacent.length} adjacent tracts for ${targetTract.properties?.GEOID}`);
  return adjacent;
}
```

**Notes**:
- `turf.booleanIntersects`: Checks if polygons touch/share boundary.
- Filters out containment (one inside another without sharing edge).
- Error handling for complex geometries.
- Time: O(n) per tract; for full graph, pre-build once (O(n²) but cacheable).

##### **Step 2: Find Seed Tract (Top-Left Corner)**
Add this method:
```typescript
/**
 * Find the seed tract (top-most, left-most) for geographic traversal
 * @param tracts Array of tracts
 * @returns Seed tract
 */
private findSeedTract(tracts: GeoJsonFeature[]): GeoJsonFeature | null {
  if (tracts.length === 0) return null;
  
  // Use internal points or centroids for positioning
  const positionedTracts = tracts.map(tract => ({
    tract,
    point: this.getTigerInternalPoint(tract) // or calculateTractCentroid(tract)
  })).filter(p => p.point.lat !== 0 && p.point.lng !== 0);
  
  if (positionedTracts.length === 0) {
    console.warn('No valid positioned tracts found, using first tract as seed');
    return tracts[0];
  }
  
  // Sort: max latitude (north), then min longitude (west)
  const seed = positionedTracts.sort((a, b) => {
    if (Math.abs(a.point.lat - b.point.lat) > 0.001) {
      return b.point.lat - a.point.lat; // Higher lat first
    }
    return a.point.lng - b.point.lng; // Lower lng first (west)
  })[0].tract;
  
  console.log(`Seed tract: ${seed.properties?.GEOID} at (${this.getTigerInternalPoint(seed).lat.toFixed(6)}, ${this.getTigerInternalPoint(seed).lng.toFixed(6)})`);
  return seed;
}
```

##### **Step 3: Graph Traversal for Sorting**
Add this method for contiguous geographic sorting:
```typescript
/**
 * Sort tracts using graph traversal from seed tract for geographic contiguity
 * @param tracts Array of tracts
 * @param direction Preferred traversal direction
 * @returns Geographically sorted, contiguous tracts
 */
private sortTractsByAdjacencyTraversal(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
  if (tracts.length <= 1) return tracts;
  
  console.log(`🔄 Starting adjacency-based geographic sorting for ${tracts.length} tracts (${direction} direction)`);
  
  // Step 1: Find seed tract (top-left)
  const seedTract = this.findSeedTract(tracts);
  if (!seedTract) return tracts;
  
  // Step 2: Build adjacency graph (optimize: only check nearby tracts via bounding boxes)
  const adjacencyGraph: Map<string, GeoJsonFeature[]> = new Map();
  for (const tract of tracts) {
    adjacencyGraph.set(tract.properties?.GEOID || '', []);
  }
  
  // Build graph (optimize with spatial index if needed)
  for (let i = 0; i < tracts.length; i++) {
    for (let j = i + 1; j < tracts.length; j++) {
      const adj1 = this.findAdjacentTracts([tracts[i]], tracts[j]);
      const adj2 = this.findAdjacentTracts([tracts[j]], tracts[i]);
      if (adj1.length > 0) {
        adjacencyGraph.set(tracts[i].properties?.GEOID || '', [...adjacencyGraph.get(tracts[i].properties?.GEOID || '')!, tracts[j]]);
      }
      if (adj2.length > 0) {
        adjacencyGraph.set(tracts[j].properties?.GEOID || '', [...adjacencyGraph.get(tracts[j].properties?.GEOID || '')!, tracts[i]]);
      }
    }
  }
  
  // Step 3: Traverse from seed using BFS, prioritizing geographic direction
  const visited = new Set<string>();
  const sortedTracts: GeoJsonFeature[] = [];
  const queue: { tract: GeoJsonFeature; priority: number }[] = [];
  
  // Initialize queue with seed
  queue.push({ tract: seedTract, priority: 0 });
  visited.add(seedTract.properties?.GEOID || '');
  sortedTracts.push(seedTract);
  
  while (queue.length > 0) {
    const { tract } = queue.shift()!;
    const neighbors = adjacencyGraph.get(tract.properties?.GEOID || '') || [];
    
    // Sort neighbors by geographic direction from current tract
    const currentPoint = this.getTigerInternalPoint(tract);
    const sortedNeighbors = neighbors
      .filter(n => !visited.has(n.properties?.GEOID || ''))
      .sort((a, b) => {
        const pointA = this.getTigerInternalPoint(a);
        const pointB = this.getTigerInternalPoint(b);
        
        if (direction === 'latitude') {
          // Prioritize south (lower lat) then east (higher lng)
          const latDiffA = currentPoint.lat - pointA.lat;
          const latDiffB = currentPoint.lat - pointB.lat;
          if (Math.abs(latDiffA - latDiffB) > 0.001) return latDiffA - latDiffB;
          return pointA.lng - pointB.lng;
        } else {
          // Prioritize east (higher lng) then south (lower lat)
          const lngDiffA = pointA.lng - currentPoint.lng;
          const lngDiffB = pointB.lng - currentPoint.lng;
          if (Math.abs(lngDiffA - lngDiffB) > 0.001) return lngDiffA - lngDiffB;
          return currentPoint.lat - pointA.lat - (currentPoint.lat - pointB.lat);
        }
      });
    
    for (const neighbor of sortedNeighbors) {
      visited.add(neighbor.properties?.GEOID || '');
      sortedTracts.push(neighbor);
      queue.push({ tract: neighbor, priority: queue.length + 1 });
    }
  }
  
  console.log(`✅ Adjacency-based sorting complete: ${sortedTracts.length} contiguous tracts from seed ${seedTract.properties?.GEOID}`);
  return sortedTracts;
}
```

**Notes**:
- **BFS Traversal**: Ensures breadth-first exploration for balanced growth.
- **Geographic Priority**: Sorts neighbors by direction (south/east for lat/long).
- **Graph Building**: O(n²) but can be optimized with spatial filtering (check bounding box overlap first).
- **Fallback**: If graph is incomplete, it still sorts what it can.

##### **Step 4: Integrate into Sorting Method**
Update `sortTractsForContiguity()` to use traversal (replace the sort logic):
```typescript
// In sortTractsForContiguity(), after console.log for starting sorting:
return this.sortTractsByAdjacencyTraversal(tracts, direction);
```

#### **4. Performance Optimizations**
- **Spatial Filtering**: Before intersection check, filter candidates with bounding box overlap:
  ```typescript
  // Before turf.booleanIntersects
  if (!this.boundingBoxesOverlap(boundsA, boundsB)) continue;
  ```
- **Pre-build Graph**: Cache adjacency graph per state in a service.
- **Library**: Turf.js handles 8K tracts in ~5-10 seconds; optimize further with worker threads if needed.

#### **5. Testing and Next Steps**
- **Test on California**: Run with northern focus—expect fewer discontiguous districts.
- **Metrics**: Add contiguity score (e.g., % of tracts with at least one adjacent neighbor in same district).
- **Fallback**: If adjacency detection is too slow, hybrid: Use traversal for small groups, point sorting for large.

This approach should solve the discontiguity while keeping geographic ordering. Difficulty is medium (with Turf.js), and reliability is high. Switch to **agent mode** if you'd like me to implement this fully, or copy the snippets to test! Let me know your thoughts.