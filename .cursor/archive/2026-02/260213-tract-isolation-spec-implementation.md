# 260213

## 1400 tract isolation spec and implementation

### Prompt

review archive, documentation and code for tract isolation logic. look for discrepencies, issues with logic, etc. note the purpose of bridge tract detection and how it works. look for DG balancing rules/logic, etc.
the goal of this tasks is to create a plan to document a tract isolation spec and implementation.

[Later in session:] Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.
To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/tract_isolation_spec_and_implementation_doc_dc92a275.plan.md](.cursor/plans/tract_isolation_spec_and_implementation_doc_dc92a275.plan.md)

**Plan phase:** Reviewed archive, `doc/history/` island and move-isolated docs, GDIP-004, and backend/frontend code; documented bridge tract purpose and behavior, DG balancing gap, and discrepancies (standalone detect API missing step0 island exclusion, doc paths). Created plan for a single tract isolation spec doc and optional API/frontend fixes.

**Implementation (all to-dos completed):**

1. **Created** `doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md` — Purpose/scope, definitions (isolated, island, bridge), data dependencies, detection algorithm, bridge detection, moving isolated/bridge tracts, implementation notes, known gaps, diagram, references.

2. **Updated project rules/overview** — `.cursorrules` and `doc/GeoDistrictsProjectOverview.md`: fixed doc paths to `doc/history/` for island and move-isolated docs; added link to new tract isolation doc.

3. **Backend** — `POST /api/algorithm/detect-isolated-tracts` accepts optional `stepNumber` and `step0IslandTractIds` and passes them to `detectIsolatedTracts`. `POST /api/algorithm/move-all-isolated-tracts`: fast path accepts `step0IslandTractIds` and passes step + set to re-detection; cache path uses `buildStep0IslandSet(algorithmState, step, bodyStep0IslandTractIds)` and passes step + set to all `detectIsolatedTracts` calls.

4. **Frontend** — Service: `detectIsolatedTracts(..., stepNumber?, step0IslandTractIds?)` and `moveAllIsolatedTractsFromStep(..., step0IslandTractIds?)` send optional params. Maps page: `getStep0IslandTractIds()` from `algorithmResult.steps[0].islandTractsData`; pass step and step0 island IDs when calling detect and move-all-isolated.

✅ **IMPLEMENTED**: Full tract isolation spec doc, corrected doc references, and step-0 island exclusion in detect and move-all-isolated (backend + frontend).
