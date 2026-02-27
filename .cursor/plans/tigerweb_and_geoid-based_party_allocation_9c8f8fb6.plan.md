---
name: TIGERweb and GEOID-based party allocation
overview: Switch all boundary fetches from ArcGIS to Census TIGERweb, and use GEOID-based county assignment for county-to-tract party allocation so tract/county polygons are not required for that path.
todos: []
isProject: false
---

# Use TIGERweb Instead of ArcGIS and GEOID-Based Party Allocation

## Current state

**Boundary sources (all ArcGIS/Esri today):**

- **Tract boundaries:** [backend/index.js](backend/index.js) and [backend/services/spatial-analyzer.js](backend/services/spatial-analyzer.js) use `ALTERNATIVE_TIGERWEB` (Esri USA_Census_Tracts). [backend/index.js](backend/index.js) defines `TIGERWEB_BASE` (Census) but tract requests use Esri.
- **County boundaries (VEST):** [backend/services/vest-data-loader.js](backend/services/vest-data-loader.js) `loadCountyBoundaries()` uses Esri USA_Counties (line ~955).
- **State boundaries:** [backend/index.js](backend/index.js) and [backend/scripts/generate-state-union-polygons.js](backend/scripts/generate-state-union-polygons.js) use Esri USA_States_Generalized_Boundaries.

**Party-by-tract allocation (county-level VEST):**

In [backend/services/vest-data-loader.js](backend/services/vest-data-loader.js), `allocateCountyVotesToTract` already derives the county from the tract GEOID at the start (lines 1020–1023):

- `normalizedGeoid.substring(0, 2)` = state FIPS  
- `normalizedGeoid.substring(2, 5)` = county FIPS  
- `countyFips5 = stateFips + countyFips` (5-digit county FIPS)

Census tract GEOIDs are 11 digits (SS + CCC + TTTTTT), so the county is encoded in the GEOID. The code then:

1. Optionally loads **tract** boundaries (to get geometry for intersection).
2. Loads **county** boundaries (ArcGIS USA_Counties).
3. Uses **turf** to intersect tract polygon with county polygons and allocates by area (or falls back to GEOID-based lookup when geometry/boundaries fail).

So today: **metadata/GEOID is already used for the fallback path**; the **polygon path** is used when both tract and county boundaries are available. For standard Census tracts (one tract per county assignment), GEOID alone is sufficient; polygons are only needed for the rare case of a tract spanning counties.

---

## Part 1: Switch boundary services to Census TIGERweb

Replace Esri URLs with Census TIGERweb REST endpoints. Use the same query pattern (`where`, `outFields`, `f=geojson`, `outSR=4326`) and adapt field names to TIGERweb’s schema.

### 1.1 County boundaries (VEST)

**File:** [backend/services/vest-data-loader.js](backend/services/vest-data-loader.js) – `loadCountyBoundaries(state)`.

- **Current:** `https://services.arcgis.com/.../USA_Counties/FeatureServer/0/query` with `STATE_FIPS`, `CNTY_FIPS`, `NAME`, `FIPS`.
- **Change:** Use Census TIGERweb county layer, e.g.  
`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query`  
(or the correct layer ID from [TIGERweb State_County](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer)).  
- **Schema:** Map TIGERweb fields (e.g. `STATE`, `COUNTY`, `GEOID`, `NAME`) to the shape expected by callers (e.g. `STATE_FIPS`, `COUNTY_FIPS`, `GEOID` 5-digit, `COUNTY_NAME`). Keep the same cache key and failure-caching behavior.

### 1.2 Tract boundaries

**Files:**  

- [backend/services/spatial-analyzer.js](backend/services/spatial-analyzer.js) – `loadTractBoundaries(state)` (direct call when `apiBaseUrl` is null).  
- [backend/index.js](backend/index.js) – tract-boundaries route and any streaming/large-dataset logic that uses `ALTERNATIVE_TIGERWEB`.
- **Current:** Esri `USA_Census_Tracts` FeatureServer/0.  
- **Change:** Use Census TIGERweb tract layer, e.g.  
`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query`  
(or `tigerWMS_Current` tract layer; confirm layer ID and field names from TIGERweb docs).  
- **Schema:** TIGERweb uses `STATE`, `COUNTY`, `TRACT`, `GEOID` (11-char). Ensure `outFields` and any mapping in `spatial-analyzer.js` (e.g. `getTractGeoid`) match. Preserve pagination (e.g. `resultOffset`/`resultRecordCount`) for states with many tracts.  
- **Constant:** In [backend/index.js](backend/index.js), replace or repurpose `ALTERNATIVE_TIGERWEB` so the tract-boundaries route and streaming use the Census TIGERweb tract URL; keep or introduce a single constant for the tract service URL.

### 1.3 State boundaries

**Files:**  

- [backend/index.js](backend/index.js) – state-boundaries route and any logic that fetches state polygons (e.g. for Step 0 / All-states map).  
- [backend/scripts/generate-state-union-polygons.js](backend/scripts/generate-state-union-polygons.js).
- **Current:** Esri USA_States_Generalized_Boundaries.  
- **Change:** Use Census TIGERweb state layer, e.g.  
`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query`  
(state layer; confirm layer index). Map response fields to the shape expected by callers (e.g. state FIPS, name).  
- **Cache:** Preserve existing cache keys and behavior so Step 0 and map code keep working.

### 1.4 Verification and fallback

- Add a short comment or constant documenting that boundaries now come from Census TIGERweb.  
- If TIGERweb is unavailable (e.g. 5xx or timeout), keep existing error handling; optional: add a fallback to Esri only for that request (document as temporary fallback).

---

## Part 2: GEOID-based party allocation (no polygons for county-to-tract)

Use Census tract GEOID to determine county and avoid loading tract or county polygons for the county-level VEST allocation path.

### 2.1 How it works today vs improvement

- **Today:** For each tract, the code can use GEOID-derived `countyFips5` in fallback (no geometry or when county load fails). When geometry and county boundaries exist, it does spatial intersection.  
- **Census fact:** Tracts nest in a single county; the first 5 digits of the 11-digit tract GEOID are state (2) + county (3). So **GEOID alone identifies the containing county**; polygon intersection is not required for correct assignment.  
- **Improvement:** When allocating county-level VEST data to tracts, **always** use GEOID-based assignment: `countyFips5 = geoid.substring(0, 5)`, look up `vestData.countyData[countyFips5]`, allocate proportionally using existing `countyTractCounts` (so sum over tracts in a county equals county total). Do **not** load tract boundaries or county boundaries for this path.

### 2.2 Implementation

**File:** [backend/services/vest-data-loader.js](backend/services/vest-data-loader.js).

- `**allocateCountyVotesToTract`:**  
When `vestData.countyData` is present, treat GEOID as authoritative for county.  
  - At the top, compute `countyFips5` from GEOID (already done).  
  - If `countyTractCounts` is provided (as in `getTractData`), use it for `divisor`; otherwise use 1.  
  - Look up `vestData.countyData[countyFips5]`. If found, compute votes per tract (proportional: `countyTotal / divisor`) and return the same result shape as the current fallback (e.g. `allocationMethod: 'geoid_county_proportional'`).  
  - **Remove or bypass** the block that loads tract geometry and county boundaries and runs turf intersection for this county-level VEST path. No calls to `loadTractBoundaries` or `loadCountyBoundaries` from this function when only county allocation is needed.
- `**getTractData` (county-level branch):**  
When only `vestData.countyData` exists (no tract-level data):  
  - Build `countyTractCounts` from the requested `geoids` (already done).  
  - **Do not** call `spatialAnalyzer.loadTractBoundaries` in this branch.  
  - For each geoid, call a GEOID-only allocation (e.g. inline logic or a small helper that only does GEOID → countyFips5 → county vote lookup and proportional split). So no tract polygon fetch for this path.
- `**buildTractDataFromCountyVEST`:**  
This function needs the **list of tract GEOIDs per state**. Today it gets them from `spatialAnalyzer.loadTractBoundaries(stateCode)` and then `geoids = boundaries.features.map(getTractGeoid)`.  
  - **Option A (minimal):** Keep one TIGERweb tract request per state with **returnGeometry=false** (or equivalent) so the response is small and only returns GEOIDs (and maybe state/county). Use that to get the geoid list, then run GEOID-only allocation for each.  
  - **Option B:** Keep loading tract boundaries once per state from TIGERweb (after Part 1) to get the geoid list, but still use GEOID-only allocation (no county boundaries, no per-tract geometry) so only one tract-boundary request per state and no county-boundary requests.

Recommend **Option A** (tract list with returnGeometry=false) to avoid large geometry payloads when only building tract-party from county VEST data.

### 2.3 Result

- County-to-tract party allocation uses **only GEOID and county VEST data**; no ArcGIS or TIGERweb county/tract polygon calls in that path (except one optional TIGERweb tract-list query per state with returnGeometry=false if you choose Option A).  
- Fewer external calls, no dependency on county boundaries for allocation, and behavior matches Census (tract contained in one county by definition).

---

## Summary


| Item                                        | Action                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| County boundaries (VEST)                    | Use Census TIGERweb State_County (or equivalent) in `loadCountyBoundaries`; map field names; keep failure caching.                                        |
| Tract boundaries                            | Use Census TIGERweb Tracts_Blocks (or equivalent) in spatial-analyzer and index.js; unify on one TIGERweb tract URL constant.                             |
| State boundaries                            | Use Census TIGERweb state layer in index.js and generate-state-union-polygons.js.                                                                         |
| Party by tract (county VEST)                | Use GEOID-only county assignment in `allocateCountyVotesToTract` and county branch of `getTractData`; do not load tract or county polygons for this path. |
| Tract list for buildTractDataFromCountyVEST | Prefer TIGERweb tract query with returnGeometry=false to get GEOIDs only; then run GEOID-only allocation.                                                 |


No frontend changes required. Existing cache keys and API contracts for boundaries can stay; only the backend URLs and allocation logic change.