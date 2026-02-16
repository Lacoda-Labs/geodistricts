# 260215

## 1730 step 0 isolation cache, next-step rehydration, Firestore island data

### Prompt

(Summarized from session.)
- On maps page when displaying step 0: add list of isolated tracts found; distinguish island tracts vs enclosed tracts (merged); make it a collapsible section.
- Clicking next from step 0 was returning 404 (algorithm state not found).
- Isolation check after "Built adjacency graph" was taking a long time; user asked what runs after that and why.
- Isolation check should be performed during step 0 initialization and cached so it does not run when step 0 is read from cache; no further init calculations on cache hit.
- Fix Firestore invalid argument: "Property stepData contains an invalid nested entity" by creating compatible data model shapes.

### Response / actions

Plan: [.cursor/plans/step_0_isolation_cache_only_00dceefa.plan.md](.cursor/plans/step_0_isolation_cache_only_00dceefa.plan.md) (implemented: remove island detection on step 0 cache-hit path).

- **Maps page step 0 panel:** Added collapsible section (MatExpansionModule) shown only when step index is 0 and island or enclosed tracts exist. Two subsections: Island tracts (with group labels) and Enclosed tracts (merged, with enclosedBy). Getters `getStep0IslandTractsList()` and `getStep0EnclosedTractsList()` in maps-page.component.ts; styles in maps-page.component.scss.
- **Next from step 0 (404):** Backend now rehydrates algorithm state from step 0 cache when `getCachedAlgorithmState` returns null: `rehydrateAlgorithmStateFromStep0(state, maxIterations)` loads step 0 doc and state tract cache, builds algorithm state (iteration 0), caches it, and next-step continues. So "Next" from step 0 works even if algorithm_state_* was missing.
- **Isolation slowness:** Explained that after adjacency graph build, `calculateMaxReachableCount` runs one BFS per tract (e.g. 9129 for CA) and then finding main component runs another 9129 BFSs (~18k BFS over 9k nodes), causing the delay.
- **Step 0 isolation only at init:** Removed the block in backend index.js (step-by-step cache-hit path) that re-ran `detectIsolatedTracts` when cached step 0 lacked `islandTractsData`. Cache hit now uses stepData as-is; isolation runs only in algorithm service `createStep(0, ...)` and is stored in normalized step.
- **Firestore invalid nested entity:** Firestore does not allow arrays containing arrays. `islandTractsData.islandTractsByGroup` was `{ [k]: string[][] }`. Added Firestore-safe serialization: `serializeIslandTractsDataForFirestore` converts to `{ [k]: Array<{ tractIds: string[] }> }`; `deserializeIslandTractsDataFromFirestore` restores to array-of-arrays. `normalizeStepData` now uses serialized shape when writing step cache. `deserializeStepDataFromFirestore(stepData)` is called wherever stepData is read from cache (step-by-step hit, restart, rehydrate, GET step, next-step cache, final-step reconstruction, move-isolated cache paths).

✅ **IMPLEMENTED**: Step 0 isolated tracts UI; next-step rehydration from step 0 cache; isolation only at init (no re-run on cache hit); Firestore-compatible island data shape with serialize/deserialize on write/read.
