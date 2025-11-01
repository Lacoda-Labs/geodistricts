# Geo-Graph Traversal Algorithm Specification

## Overview

The Geo-Graph Traversal Service implements a sophisticated zig-zag traversal algorithm for sorting census tracts geographically. This algorithm creates contiguous district groupings by traversing adjacent tracts in a systematic pattern that alternates direction to maintain geographic coherence.

The algorithm supports two primary traversal modes:
- **Latitude Division**: Zig-zag pattern starting northwest, moving east/west in rows southward
- **Longitude Division**: Zig-zag pattern starting southwest, moving north/south in columns eastward

## Core Components

### Input Parameters
- `tracts`: Array of GeoJsonFeature objects representing census tracts
- `adjacencyGraph`: Map<string, string[]> defining tract adjacencies (from Brown University S4 project)
- `startTract`: Initial tract for traversal (northwest for latitude, southwest for longitude)
- `direction`: Traversal direction ('latitude' | 'longitude')

### Output
- Sorted array of GeoJsonFeature objects in traversal order

## Algorithm Steps

### 1. Initialization and Preprocessing

1. **Tract Mapping**: Create tract ID to tract mapping and validate adjacency graph coverage
2. **Containment Detection**: Identify contained tracts (tracts completely within other tracts) for special handling
3. **Visited Set**: Initialize tracking of processed tracts
4. **Start Position**: Begin traversal from appropriate starting tract based on division direction

### 2. Latitude Division Traversal (Northwest → East/West Zig-Zag Southward)

#### Starting Point
- Find northwest-most tract (highest latitude, lowest longitude)

#### Row-by-Row Zig-Zag Pattern

**Eastward Movement (within row):**
1. From current tract, find all adjacent unvisited tracts
2. Sort adjacent tracts in clockwise order from north
3. Select most northeastern adjacent tract (highest latitude + longitude score)
4. Continue eastward until eastern border reached

**Border Detection and Direction Change:**
1. When no more eastern adjacent tracts found:
   - Find most southeastern adjacent tract as pivot point
   - Switch to westward movement from this southeast position

**Westward Movement (within row):**
1. From southeast pivot tract, find all adjacent unvisited tracts
2. Sort adjacent tracts in clockwise order from north
3. Select most northwestern adjacent tract (highest latitude - longitude score)
4. Continue westward until western border reached

**New Row Initiation:**
1. When no more western adjacent tracts found:
   - Find next southernmost latitude band
   - Within that band, select westernmost unvisited tract
   - Begin new row moving eastward

**Termination:**
- Continue zig-zag pattern southward until all tracts visited
- Add remaining unvisited tracts at end if traversal incomplete

### 3. Longitude Division Traversal (Southwest → North/South Zig-Zag Eastward)

#### Starting Point
- Find southwest-most tract (lowest latitude, lowest longitude)

#### Column-by-Column Zig-Zag Pattern

**Northward Movement (within column):**
1. From current tract, find all adjacent unvisited tracts
2. Sort adjacent tracts in clockwise order from north
3. Select most northeastern adjacent tract (highest latitude + longitude score)
4. Continue northward until northern border reached

**Border Detection and Direction Change:**
1. When no more northern adjacent tracts found:
   - Find most northeastern adjacent tract as pivot point
   - Switch to southward movement from this northeast position

**Southward Movement (within column):**
1. From northeast pivot tract, find all adjacent unvisited tracts
2. Sort adjacent tracts in clockwise order from north
3. Select most southeastern adjacent tract (lowest latitude + longitude score)
4. Continue southward until southern border reached

**New Column Initiation:**
1. When no more southern adjacent tracts found:
   - Find next easternmost longitude band
   - Within that band, select northernmost unvisited tract
   - Begin new column moving northward

**Termination:**
- Continue zig-zag pattern eastward until all tracts visited
- Add remaining unvisited tracts at end if traversal incomplete

### 4. Containment Handling

**Pre-computation:**
- Identify tract pairs where one tract is completely contained within another
- Build container-to-contained relationship mapping

**Traversal Integration:**
- When adding a container tract, immediately add all its contained tracts
- Contained tracts are processed before continuing main traversal
- Prevents orphaned contained tracts in final sorting

### 5. Adjacent Tract Selection Algorithm

**Clockwise Ordering:**
1. Calculate angles from current tract center to all adjacent tract centers
2. Sort adjacent tracts by angle (atan2(lat_diff, lng_diff))
3. Results in clockwise ordering starting from north

**Directional Bias Application:**
- Latitude division: Add north bias to east/west movements
- Longitude division: Add east bias to north/south movements
- Ensures zig-zag pattern maintains geographic progression

**Extreme Tract Selection:**
Based on requested direction, select tract with maximum score:
- East: highest longitude
- West: lowest longitude (-longitude)
- North: highest latitude
- South: lowest latitude (-latitude)
- Northeast: highest latitude + longitude
- Northwest: highest latitude - longitude
- Southeast: lowest latitude + longitude
- Southwest: lowest latitude - longitude

### 6. Border Detection and Recovery

**Primary Border Detection:**
- Adjacent tract search returns no valid unvisited tracts
- Indicates boundary reached in current movement direction

**Recovery Strategies:**
1. **Pivot Search**: Find adjacent tract in diagonal direction (southeast/southwest for latitude, northeast for longitude)
2. **New Starting Point**: If no pivot found, search for next row/column starting tract
3. **Direction Reset**: Return to primary movement direction (east for latitude, north for longitude)

### 7. Completion and Validation

**Progress Tracking:**
- Monitor visited tract count vs total tracts
- Log progress every 100 iterations
- Maximum iteration limit prevents infinite loops

**Incomplete Traversal Handling:**
- If traversal terminates early, add remaining unvisited tracts
- Warn about incomplete coverage with statistics

**Final Validation:**
- Ensure all tracts included in sorted output
- Log completion statistics

## Key Design Principles

### Geographic Coherence
- Maintains spatial relationships through adjacency-based traversal
- Clockwise ordering ensures logical neighbor selection
- Biased directions prevent erratic movement patterns

### Contiguity Preservation
- Only moves to adjacent tracts (per Brown S4 adjacency data)
- Handles contained tracts to maintain geographic nesting
- Zig-zag pattern ensures district groupings remain connected

### Robustness
- Handles incomplete adjacency graphs gracefully
- Recovers from dead-ends through multiple fallback strategies
- Processes remaining tracts even if main algorithm stalls

### Performance Considerations
- Limits containment checks for large datasets (>100 tracts)
- Capped maximum iterations to prevent hangs
- Progress logging for long-running operations

## Integration with Districting Algorithm

This traversal service serves as the geographic sorting foundation for:
1. **Population-based Division**: Creates sorted tract lists for ratio-based splitting
2. **Recursive Subdivision**: Enables hierarchical district group creation
3. **Contiguity Enforcement**: Ensures resulting districts remain geographically connected

The sorted output provides the spatial ordering needed to divide census tracts into district groups according to population ratios while maintaining geographic coherence.
