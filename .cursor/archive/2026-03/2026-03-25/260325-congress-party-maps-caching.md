# 260325

## 2314 congress party totals, DC seat count, TX fix, API caching

### Prompt

why is US geodistricts total 436 instead of 435

looks like 119th congress party totals for TX is 37 not 38. why

still shows R: 24

/archive

### Response / actions

- **436 vs 435:** Explained that the House has **435 voting seats** (states only); the app includes **DC** as a separate jurisdiction with **1** district in `maps-page.component.ts` `states` and `CONGRESSIONAL_DISTRICTS_BY_STATE` in `geodistrict-algorithm.js`, so roll-ups over that full list sum to **436**. US row parenthetical still hardcodes **435** in `getUSRowData()`.

- **TX 37 vs 38:** `data/congress-119-party.json` had `"TX": { "D": 13, "R": 24 }` (sum 37). ✅ **FIXED**: set **R: 25** to match 38 districts (13+25=38), in both `data/congress-119-party.json` and `backend/data/congress-119-party.json`.

- **Still R: 24:** Caused by **in-memory caches** (`cachedMapsStateComparison` in `backend/index.js`, `getPartySummary()` cache in `congress-119-party.js`) and **GCS landing** blobs embedding old congress counts. ✅ **IMPLEMENTED**: (1) `congress-119-party.js` — reload when source JSON **mtime** changes; (2) `maps-comparison.js` — `applyFreshCongress119ToComparisonPayload()` overlays fresh 119th D/R and recomputes swing; (3) `index.js` — use overlay on `GET /api/maps/state-comparison`, `/api/maps/landing`, and `/api/maps/landing/summaries` when `stateComparison` is present.
