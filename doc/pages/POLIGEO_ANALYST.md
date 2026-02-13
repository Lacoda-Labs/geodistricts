# PoliGeo Analyst

## Purpose

Stakeholders want to understand the **estimated impact on political party** when redistricting uses geodistricts instead of current congressional boundaries. PoliGeo Analyst answers that by using **existing election results** (Harvard VEST precinct-to-census-tract data) to **extrapolate likely party outcomes** when overlaid onto geodistricts, and **compares those totals to current US congressional district representative party**. This provides reproducible, tract-based estimates of Democratic vs. Republican vote share and implied party lean for any geodistrict, and shows how that compares to the current state and US House delegation.

## Abstract

PoliGeo Analyst accepts geodistricts as a list of census tract GEOIDs or as a GeoJSON polygon. It aggregates Harvard VEST presidential vote data by tract (with areal weighting for polygon input), returns Democratic/Republican vote totals and percentages by election year, trend summaries (e.g. 2016–2020, 2020–2024), and a recommended proxy party lean (toss-up, lean, likely, safe, very safe D/R). It uses the `representation-comparison` service to compare the geodistrict’s result to current state house/senate delegation and overlapping US House districts, including a mismatch flag. The frontend `PoliGeoService` calls backend API routes under `/api/poligeo/*`; the backend core is `poligeo-analyst.js`, which depends on `vest-data-loader`, `spatial-analyzer`, and `representation-comparison`.

## Data and methodology

- **Data source**: [Harvard Election Data Hub](https://electiondatahub.org/) VEST (precinct-to-census-tract allocation) datasets for presidential elections (e.g. 2016, 2020, 2024).
- **Methodology**: Precinct-level results are allocated to census tracts via precinct-to-tract allocation (areal weighting and dasymetric refinement). For polygon input, tracts intersecting the polygon are weighted by intersection ratio (areal weighting).
- **Available years**: Determined by VEST data that has been downloaded or processed (see VEST data lifecycle below).

## Input formats

| Format   | Description | Notes |
|----------|-------------|--------|
| `geoid`  | List of 11-digit census tract GEOIDs | String, array, or CSV. Duplicates are removed. |
| `polygon`| GeoJSON Polygon or MultiPolygon | `state` parameter is required for tract lookup. |
| `district` | District name (e.g. "PA-07") | **Not implemented**; use `geoid` or `polygon` instead. |

The main entry is `POST /api/poligeo/analyze` with body: `{ input_format, input_data, geodistrict_name?, state? }`.

## Output

The analysis returns a structure matching the frontend type `PoliGeoAnalysisResult` in [frontend/src/app/services/poligeo.service.ts](../../frontend/src/app/services/poligeo.service.ts):

- **geodistrict_name**, **source_years**, **tract_count**, **missing_tract_count**, **missing_tract_coverage**, **estimated_voting_age_population**
- **results**: Per-year fields `votes_dem_pres`, `votes_rep_pres`, `total_pres`, `pct_dem_pres`, `pct_rep_pres`, `dem_advantage`, and optional `coverage`; plus **trend_2016_2020**, **trend_2020_2024**, and **recommended_proxy_party_lean**
- **comparison_to_current_representation**: `state`, `currentStateHouseDelegation`, `currentStateSenateDelegation`, `currentUsHouseDistrictsOverlapping`, `mismatchFlag`, `note`
- **data_last_updated**, **methodology**, **warnings**, **data_quality** (e.g. `coverage_percent`, `missing_tracts`, `total_missing`, `spatial_method`)

## Components

### Frontend

- **PoliGeoService** ([frontend/src/app/services/poligeo.service.ts](../../frontend/src/app/services/poligeo.service.ts)): `getVESTStatus()`, `downloadVESTData(year?, forceRefresh?)`, `processLocalVESTData(year?, forceRefresh?)`, `analyzeGeodistrict(input)`, `getStateSummary(state, year?)`.
- **Admin UI**: [frontend/src/app/pages/poligeo-admin-page.component.ts](../../frontend/src/app/pages/poligeo-admin-page.component.ts) at route `/admin/poligeo` for VEST download/process and for running analyses and state summaries.

### Backend

- **poligeo-analyst.js** ([backend/services/poligeo-analyst.js](../../backend/services/poligeo-analyst.js)): `analyze()`, `analyzeFromGeoids()`, `analyzeFromPolygon()`; uses `vest-data-loader`, `spatial-analyzer`, and `representation-comparison`.
- **API routes** in [backend/index.js](../../backend/index.js) under `/api/poligeo/*`: `GET /api/poligeo/state-summary`, `POST /api/poligeo/analyze`, `GET /api/poligeo/vest-data/status`, `POST /api/poligeo/vest-data/download`, `POST /api/poligeo/vest-data/process-local`.

## Maps page state list

The **maps page** state list (columns: 119th Congress, GeoDistricts, Swing) is powered by the **state-comparison** pipeline. The backend builds a payload from 119th Congress party data and, for each state with a completed final step, runs PoliGeo per geodistrict (tract list from the algorithm), assigns D/R by VEST vote share, and aggregates to state and US totals. The result is persisted to `data/maps-state-comparison.json` via `POST /api/admin/maps-comparison/refresh` and served at `GET /api/maps/state-comparison`.

## VEST data lifecycle

- VEST data must be **downloaded** (from Dataverse) or **processed** from locally placed files before analysis returns data.
- **Status**: `GET /api/poligeo/vest-data/status` returns available years and last-updated metadata.
- **Download**: `POST /api/poligeo/vest-data/download` (optional `year`, `forceRefresh`) fetches from Dataverse.
- **Process local**: `POST /api/poligeo/vest-data/process-local` (optional `year`, `forceRefresh`) processes VEST files already on disk.

## Party lean bands

`recommendPartyLean(pctDem)` in the backend maps Democratic share to a label:

| Margin (vs. 50%) | Label |
|-------------------|--------|
| &lt; 2%  | Toss-up (0–2%) |
| 2–5%   | Lean Democratic / Lean Republican (+2–5) |
| 5–10%  | Likely Democratic / Likely Republican (+5–10) |
| 10–15% | Safe Democratic / Safe Republican (+10–15) |
| 15%+   | Very Safe Democratic / Very Safe Republican (+15+) |

Margin is `|pctDem - 0.5|`; the label reflects whether `pctDem > 0.5` (Democratic) or not (Republican).
