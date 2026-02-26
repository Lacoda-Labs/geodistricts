---
name: VEST 2024 and party totals
overview: Confirm that district party data uses VEST 2024 and fix wrong party percentages and inflated vote totals; include making vestYear visible to the client so the UI/API can confirm which year was used.
todos:
  - id: vest-2024-column-mappings
    content: Add 2024 column mappings to vest-data-loader.js (G24PREDBID, G24PRERTRU or actual 2024 VEST column names)
  - id: county-proportional-allocation
    content: Fix county fallback so votes are allocated proportionally per tract (sum over tract in county = county total once)
  - id: get-district-party-return-vestyear
    content: Return vestYear from cached doc in GET /api/algorithm/district-party/:state/:stepNumber response
  - id: optional-cache-key-vestyear
    content: Optionally include vestYear in district_party cache key and GET query param so 2020 and 2024 can coexist
isProject: false
---

# VEST 2024 confirmation and party totals fix

## Current behavior

- **Backend defaults to 2024**: [backend/index.js](backend/index.js) uses `DEFAULT_VEST_YEAR = 2024`; `runDistrictPartyJob` and tract-party load use it; POST `/api/algorithm/district-party/:state` accepts `vestYear` (default 2024).
- **Tract party is keyed by year**: `tract_party_{state}_2024` — so 2024 data is stored by year.
- **District party cache does not include year**: Key is `district_party_{state}_{step}_{maxIterations}`. The stored doc does include `vestYear` (written at [backend/index.js](backend/index.js) ~6428), but the GET endpoint does not take or return it, so you cannot confirm from the API which year was used to build the cached totals.

So "confirm VEST is 2024" requires: (1) tract_party for the state was built from 2024 VEST, and (2) district_party was (re)run with `vestYear=2024` after that.

---

## Why percentages and totals are wrong

### 1. 2024 column mappings are empty

In [backend/services/vest-data-loader.js](backend/services/vest-data-loader.js), `VEST_DATASETS[2024].columnMappings` is `{}` (lines 68–70). When processing a 2024 tract-level CSV, the code falls back to `Object.keys(record).find(...)`, which can pick 2020 columns (e.g. `G20PREDBID`) if the file has multiple years — so party percentages may be 2020, not 2024.

**Fix:** Add explicit 2024 column mappings (e.g. `G24PREDBID`, `G24PRERTRU` or whatever the actual 2024 VEST tract columns are) to `VEST_DATASETS[2024].columnMappings`. Confirm exact names from the 2024 VEST tract-level file or codebook.

### 2. County fallback inflates vote totals

When tract-level 2024 data is missing, county fallback in `allocateCountyVotesToTract` assigns the **full county vote total** to each tract. Every tract in the same county gets the same (county total). District totals then sum (county total × number of tracts from that county) → huge totals (30M, 172M, etc.) and wrong weighting.

**Fix:** When using county fallback, allocate county votes **proportionally** so that the sum over all tracts in a county equals the county total once (e.g. assign `county_total / tract_count_in_county` per tract).

---

## Make 2024 visible to the client (in scope)

- **GET district-party:** Return `vestYear` from the cached doc (if present) in the JSON response so the UI or scripts can confirm which year was used (e.g. "2024"). Implement this in [backend/index.js](backend/index.js) GET `/api/algorithm/district-party/:state/:stepNumber` by reading the full cache doc and including `vestYear` in the response.
- **Optional cache key:** Optionally include `vestYear` in the cache key (e.g. `district_party_{state}_{step}_{maxIterations}_{vestYear}`) so 2020 and 2024 can coexist; then GET would accept a `vestYear` query param and load the matching cache entry. Frontend would pass `vestYear=2024` when calling `getDistrictParty`.

---

## Verification steps (no code change)

1. **Tract party source:** Ensure tract_party for the state was built with 2024 (e.g. run `node backend/scripts/run-tract-party-persistence.js 2024`).
2. **District party job:** Re-run the district-party job with `vestYear=2024` so the cached doc is overwritten with 2024-based aggregates.
3. **Inspect cache:** Check `vestYear` in the `district_party_*` doc; if 2020 or missing, the displayed data was not from 2024.

---

## Summary

| Issue | Cause | Fix |
|-------|--------|-----|
| Wrong year (not 2024) | 2024 `columnMappings` empty; fallback can pick 2020 columns | Add 2024 column mappings in vest-data-loader.js |
| Wrong totals (30M, 172M, etc.) | County fallback gives full county total to every tract | Allocate county votes proportionally per tract in county fallback path |
| Cannot confirm year in UI/API | GET district-party does not return `vestYear` | Return `vestYear` from cached doc in GET response; optionally add vestYear to cache key and GET param |
