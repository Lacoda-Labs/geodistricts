# 260226

## 2130 TIGERweb and GEOID-based party allocation

### Prompt

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/tigerweb_and_geoid-based_party_allocation_9c8f8fb6.plan.md](.cursor/plans/tigerweb_and_geoid-based_party_allocation_9c8f8fb6.plan.md)

✅ **IMPLEMENTED** (all plan to-dos completed):

- **Part 1 – TIGERweb boundaries:** County boundaries (VEST) in `vest-data-loader.js` use Census TIGERweb State_County layer 1; tract boundaries in `spatial-analyzer.js` and `index.js` use TIGERweb Tracts_Blocks layer 10 with field normalization and pagination; state boundaries in `index.js` and `generate-state-union-polygons.js` use TIGERweb State_County layer 0. Single TIGERweb constants and comment that boundaries come from Census TIGERweb.
- **Part 2 – [HI] GEOID-only party allocation:** `allocateCountyVotesToTract` uses only GEOID (countyFips5 = geoid.substring(0, 5)) and county VEST data with proportional split via `countyTractCounts`; no tract or county polygon loads. `getTractData` county branch no longer calls `loadTractBoundaries`. `buildTractDataFromCountyVEST` uses `loadTractGeoids(state, apiBaseUrl)` (TIGERweb with returnGeometry=false) and new `GET /api/census/tract-geoids` for the tract list, then GEOID-only allocation.

No frontend changes; cache keys and API contracts preserved.
