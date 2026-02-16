# 260215

## 0430 restart cache invalid nested entity, normalize step serialization

### Prompt

(Conversation included terminal error and plan implementation.)
- Implement plan: step 0 non-movable tracts as island list; no balancing during isolated moves; persist `dgAdjacentGroupsByGroup` with step metadata and use when moving.
- Terminal showed after RESTART: `Failed to cache algorithm state for CA_100: 3 INVALID_ARGUMENT: Property data contains an invalid nested entity.`

### Response / actions

Plan: [.cursor/plans/step_0_non-movable,_no_balancing,_persist_dgadjacentgroups_285330a6.plan.md](.cursor/plans/step_0_non-movable,_no_balancing,_persist_dgadjacentgroups_285330a6.plan.md)

- **Step 0 non-movable:** In `createStep`, excluded (water/special) tracts added to step-0 island list; totals recomputed.
- **No balancing:** `move-isolated-tracts` passes `skipBalancing: true`; defaults set in move helpers.
- **Persist dgAdjacentGroups:** `detectIsolatedTracts` returns `dgAdjacentGroupsByGroup`; `createStep` attaches it; Firestore serialize/deserialize in index.js; `normalizeStepData` / `deserializeStepDataFromFirestore` handle it; move path uses `deriveIsolatedFromDgAdjacentGroups` when present.
- **Firestore cache error:** In `normalizeAlgorithmState`, the branch that returns “already normalized” steps was returning the raw step, which could still contain `dgAdjacentGroupsByGroup` (and `islandTractsData`) in array-of-arrays form. Firestore rejects nested entities (arrays of arrays).

✅ **FIXED**: In that branch we now copy the step and set `dgAdjacentGroupsByGroup` and `islandTractsData` to their Firestore-safe serialized forms via `serializeDgAdjacentGroupsByGroupForFirestore` and `serializeIslandTractsDataForFirestore` before returning, so algorithm state cache write after RESTART succeeds.
