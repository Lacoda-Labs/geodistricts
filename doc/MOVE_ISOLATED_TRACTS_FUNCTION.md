# Move Isolated Tracts Function Documentation

## Overview

The `moveIsolatedTracts()` function is responsible for moving isolated tracts from their current district group to their sibling district group (the opposite group from the same parent division). This function processes all isolated tracts across all district groups in a single operation, automatically handling new isolation that may be created after each move.

## Source of Isolated Tracts List

### Frontend Component State

The list of isolated tracts is **NOT stored in the step cache**. Instead, it is stored in the frontend component's state (`this.isolatedTractsData`) after `detectIsolatedTracts()` is called.

**Data Flow:**
1. User clicks "Detect Isolated Tracts" button
2. `detectIsolatedTracts()` is called (frontend method in `maps-page.component.ts`)
3. Frontend calls backend API: `POST /api/algorithm/detect-isolated-tracts`
4. Backend `detectIsolatedTracts()` method analyzes all district groups and returns:
   - `isolatedTractsByGroup`: Map of group index → array of isolated tract IDs
   - `isolatedTractIds`: Array of all isolated tract IDs across all groups
   - `totalIsolated`: Total count of isolated tracts
   - `groupsWithIsolation`: Number of groups with isolated tracts
5. Frontend stores this data in `this.isolatedTractsData`:
   ```typescript
   this.isolatedTractsData = {
     isolatedTractsByGroup: result.isolatedTractsByGroup,
     isolatedTractIds: result.isolatedTractIds
   };
   ```

**Important:** The isolated tracts data is ephemeral - it exists only in component state and is cleared when:
- A new step is loaded
- Bridge tracts are moved (requires re-detection)
- The component is destroyed

## How Moving Works

### DG Property Swap

Yes, moving an isolated tract is essentially **swapping its `tract_DG` with its `sibling_DG`**. Here's how it works:

1. **Find Sibling Group**: The function finds the sibling district group by reading the `sibling_DG` property from the isolated tract:
   ```javascript
   // From isolated tract properties
   siblingDG = tract.properties.sibling_DG; // e.g., "DG8-9"
   ```

2. **Locate Target Group**: The function finds the district group that matches the `sibling_DG`:
   ```javascript
   // Parse sibling_DG to find matching group
   // Format: "DG6-7" -> startDistrictNumber=6, endDistrictNumber=7
   for (let i = 0; i < districtGroups.length; i++) {
     if (districtGroups[i].startDistrictNumber === siblingStart &&
         districtGroups[i].endDistrictNumber === siblingEnd) {
       siblingGroupIndex = i;
       break;
     }
   }
   ```

3. **Move Tract**: The tract is physically moved from the source group to the target group:
   ```javascript
   // Remove from source group
   sourceGroup.censusTracts.splice(tractIndex, 1);
   
   // Add to target group
   targetGroup.censusTracts.push(tract);
   ```

4. **Swap DG Properties**: The tract's `tract_DG` and `sibling_DG` are swapped:
   ```javascript
   const oldTractDG = tract.properties.tract_DG;      // e.g., "DG6-7"
   const oldSiblingDG = tract.properties.sibling_DG;  // e.g., "DG8-9"
   
   // Swap: tract_DG becomes old sibling_DG, sibling_DG becomes old tract_DG
   tract.properties.tract_DG = oldSiblingDG;          // Now "DG8-9"
   tract.properties.sibling_DG = oldTractDG;         // Now "DG6-7"
   ```

**Example:**
- Before move: Tract `04021002105` in group `6-7` (DG6-7)
  - `tract_DG = "DG6-7"`
  - `sibling_DG = "DG8-9"`
- After move: Tract `04021002105` in group `8-9` (DG8-9)
  - `tract_DG = "DG8-9"` (swapped from sibling_DG)
  - `sibling_DG = "DG6-7"` (swapped from tract_DG)

## Function Flow

### Frontend: `moveIsolatedTracts()`

**Location:** `frontend/src/app/pages/maps-page.component.ts`

**Process:**
1. **Initialization**: Gets isolated tracts from `this.isolatedTractsData.isolatedTractsByGroup`
2. **Group Processing**: Creates sorted list of group indices with isolated tracts
3. **Recursive Processing**: Uses `processNextGroup()` function to:
   - Process groups one at a time sequentially
   - After each move, update `this.isolatedTractsData` with latest isolation result
   - After all initial groups processed, re-detect isolation
   - If new isolation found, recursively process those groups
   - Continue until no more isolated tracts remain

**Key Features:**
- **Dynamic Group List**: After each move, checks updated isolation result to get current list of groups with isolated tracts
- **Automatic Continuation**: Automatically processes new isolation created after moves
- **Single Click Processing**: Processes all isolated tracts across all DGs in one click

### Backend: `moveIsolatedTractsToOppositeGroup()`

**Location:** `backend/services/geodistrict-algorithm.js`

**Process:**
1. **Find Sibling Group**: 
   - Reads `sibling_DG` from isolated tract properties
   - Falls back to `divisionLines` metadata if `sibling_DG` is missing
   - Finds district group matching the `sibling_DG`
2. **Move Tracts**: Calls `_moveTractsToGroup()` helper method
3. **Re-detect Isolation**: After moving, re-runs isolation detection
4. **Return Result**: Returns updated district groups and new isolation result

### Backend: `_moveTractsToGroup()`

**Location:** `backend/services/geodistrict-algorithm.js`

**Process:**
1. **Remove from Source**: Removes tract from all groups (handles duplicates)
2. **Validate Move**: Checks if tract will still be isolated in target group (prevents infinite loops)
3. **Add to Target**: Adds tract to target group
4. **Swap DG Properties**: Swaps `tract_DG` ↔ `sibling_DG`
5. **Update Group Stats**: Recalculates population, bounds, and centroid for both groups
6. **Re-detect Isolation**: Runs isolation detection on updated groups

## Data Persistence

### Algorithm State Update

When isolated tracts are moved, the backend:
1. Updates `algorithmState.currentGroups` with the moved groups
2. Updates the step in `algorithmState.steps` array if it exists
3. Invalidates the cached step for the current step number
4. Invalidates all subsequent step caches (since they depend on the current step)

This ensures that when a subsequent step is requested, it uses the updated step (with the moves), not the original cached step.

### Cache Invalidation

**Backend Endpoint:** `POST /api/algorithm/move-isolated-tracts`

**Cache Operations:**
```javascript
// Invalidate cached step
await firestore.collection('census_cache').doc(stepCacheKey).delete();

// Invalidate all subsequent step caches
for (let nextStep = step + 1; nextStep <= 10; nextStep++) {
  await firestore.collection('census_cache').doc(nextStepCacheKey).delete();
}
```

## Recursive Processing Logic

The function uses a recursive approach to handle new isolation that may be created after each move:

```typescript
const processNextGroup = (remainingGroups: number[]): any => {
  if (remainingGroups.length === 0) {
    // All groups processed, re-detect isolation
    return detectIsolatedTracts().pipe(
      concatMap((isolationResult) => {
        if (isolationResult.totalIsolated === 0) {
          // Done!
          return of({ isolationResult });
        } else {
          // New isolation found, process recursively
          const newGroupIndices = Object.keys(isolationResult.isolatedTractsByGroup)
            .map(idx => parseInt(idx))
            .sort((a, b) => a - b);
          return processNextGroup(newGroupIndices);
        }
      })
    );
  }
  
  // Process next group
  const groupIndex = remainingGroups[0];
  // ... move isolated tracts for this group ...
  // ... then process remaining groups ...
  return processNextGroup(remainingGroups.slice(1));
};
```

## Key Points

1. **Isolated tracts data is NOT in step cache** - it's only in component state after detection
2. **Moving is a DG swap** - `tract_DG` ↔ `sibling_DG` are swapped when moving
3. **Sibling group is determined by `sibling_DG` property** - set during division, stored on each tract
4. **Recursive processing** - automatically handles new isolation created after moves
5. **Cache invalidation** - ensures subsequent steps use updated data
6. **Single click processing** - processes all isolated tracts across all DGs in one operation

## Example Flow

1. User clicks "Detect Isolated Tracts"
   - Backend analyzes all groups
   - Returns: `{isolatedTractsByGroup: {1: ['04012020505'], 3: ['04017940302', '04001970502']}}`
   - Frontend stores in `this.isolatedTractsData`

2. User clicks "Move Isolated Tracts"
   - Frontend processes groups [1, 3]
   - For group 1: Moves `04012020505` from DG3-3 to DG1-2 (swaps DG properties)
   - For group 3: Moves `04017940302` and `04001970502` from DG5-5 to DG4-4
   - After all moves, re-detects isolation
   - If new isolation found, recursively processes those groups
   - Continues until no more isolated tracts remain

3. Backend updates algorithm state and invalidates cache
   - Updates `algorithmState.currentGroups`
   - Updates `algorithmState.steps[stepNumber]`
   - Invalidates cached step and all subsequent steps

