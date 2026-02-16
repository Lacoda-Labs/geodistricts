# GeoDistricts Reference Implementation

This repository (**geodistricts**) is the **reference implementation** of the GeoDistricts Protocol. The protocol itself (GDIPs, governance, index) lives in a **separate repository**; see [Protocol Repository Recommendations](PROTOCOL_REPO_RECOMMENDATIONS.md) and the protocol repo when it exists (e.g. `Lacoda-Labs/geodistricts-protocol`).

## Protocol Version and GDIPs Implemented

- **Protocol version**: This implementation follows the protocol as specified by the GDIP index in the protocol repo. Until the protocol repo is created, the canonical GDIPs are maintained in this repo under `doc/protocol/GDIPs/`.
- **Required GDIPs** (implemented):
  - **GDIP-002 (Data Model)**: Canonical structures for states, counties, tracts, district groups, geodistricts. Implemented in backend API and frontend types; see [GeodistrictingAlgorithmSpecification](https://github.com/Lacoda-Labs/gdip/blob/main/GeodistrictingAlgorithmSpecification.md) and [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
  - **GDIP-003 (Required Data Sources)**: Census population, TIGER/Line boundaries, district count per state. Implemented via Census API integration and TIGER/cache; see [CENSUS_POPULATION_DATA](../pages/CENSUS_POPULATION_DATA.md), [TIGER_LINE_SHAPEFILES](../pages/TIGER_LINE_SHAPEFILES.md).
  - **GDIP-004 (Core Algorithm)**: Geodistrict boundary calculation (init, county-level division, tract-level refinement). Implemented in `backend/services/geodistrict-algorithm.js` (or equivalent); step-by-step output for visualization in frontend (maps-page, geodistrict-viewer).
- **Optional GDIPs** (partial or planned):
  - **GDIP-005 (Demographics)**: Aggregating party, race, age per geodistrict. Partial: Census demographics and voter registration loaders exist; **PoliGeo Analyst** implements party-related estimates using **election results** (VEST), not just registration. See [STATE_ELECTION_DATA](../pages/STATE_ELECTION_DATA.md), [POLIGEO_ANALYST](../pages/POLIGEO_ANALYST.md), [representation-comparison.js](../../backend/services/representation-comparison.js).
  - **GDIP-006 (Comparison Metrics)**: Comparing existing districts vs geodistricts. **PoliGeo Analyst** provides comparison to current representation (state delegation, overlapping US House districts). See [CONGRESSIONAL_DISTRICT_COMPARISON_PLAN](../history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md), [POLIGEO_ANALYST](../pages/POLIGEO_ANALYST.md), [representation-comparison.js](../../backend/services/representation-comparison.js).

## Architecture (Summary)

- **Frontend**: Angular 17+, TypeScript, Leaflet. Interactive maps, step-by-step algorithm visualization, division lines, district groups. See [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
- **Backend**: Node.js, Express. REST API for census data, algorithm execution, caching (Cloud Storage / local cache). See [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
- **Data flow**: Census API + TIGER/Line → backend cache → algorithm → geodistricts (tract list, population, optional steps) → frontend visualization.
- **Caching**: Multi-tier (memory, backend cache, Cloud Storage for large state data). Caching design supports client performance when navigating algorithm steps. See [CACHING_DESIGN](../history/CACHING_DESIGN.md).

## Deployment

- **Run locally**: `./scripts/quick-start.sh` or `cd backend && npm run dev` and `cd frontend && ng serve`. See [GITHUB_SETUP](../pages/GITHUB_SETUP.md).
- **Deploy**: Google Cloud Run (backend), static hosting (frontend). See [GCP_SETUP](../pages/GCP_SETUP.md), `deploy/`, `scripts/deploy.sh`.

## Maintaining and Improving

- **Protocol changes**: Algorithm or data-model changes that affect the protocol MUST be proposed in the **protocol repo** as a GDIP (see [CONTRIBUTING.md](../CONTRIBUTING.md) section "Protocol changes"). This repo then implements the accepted GDIP and documents the protocol version or GDIP set it follows.
- **Reference implementation updates**: When a new GDIP is accepted, update this doc (and README if needed) to reflect which GDIPs are implemented and link to the protocol repo tag or release.

### Syncing to the GDIP repo

The **canonical** protocol content (GDIPs and process docs) is maintained in this repo under `doc/protocol/GDIPs/` and `doc/protocol/process/`. A nested clone of [Lacoda-Labs/gdip](https://github.com/Lacoda-Labs/gdip) may live at `gdip/` (ignored by the geodistricts repo). To publish changes to the GDIP repo:

1. Edit or add GDIPs and process docs under `doc/protocol/` in this repo; commit to geodistricts as usual.
2. Run the sync script from the repo root: **`./scripts/sync-gdip.sh`**. It copies `doc/protocol/GDIPs/` and `doc/protocol/process/` into `gdip/GDIPs/` and `gdip/process/`.
3. In the gdip repo: `cd gdip`, then `git add -A`, `git commit -m "Sync protocol docs from geodistricts"`, and `git push origin main`.

If `gdip/` is missing, clone it first: `git clone https://github.com/Lacoda-Labs/gdip.git gdip`.

---

## Generative AI: Reference Implementations and GDIP Context

### Using Gen AI to Create or Extend Reference Implementations

The protocol (GDIPs) can be used as context for an LLM to produce or extend reference implementations, for example:

- **Produce geodistrict boundaries for all 50 states + DC**: Use GDIP-002, GDIP-003, GDIP-004 as context; output must conform to the data model and algorithm.
- **Produce UI that visualizes each algorithm step**: Use GDIP-004 (step structure) and reference implementation docs (step-through behavior, division lines). See `frontend/src/app/pages/maps-page.component.ts`, `frontend/src/app/components/geodistrict-viewer.component.ts`.
- **Produce caching design for step navigation**: Use [CACHING_DESIGN](../history/CACHING_DESIGN.md) and requirement that client performance be supported as the user navigates steps.

Tie generated features to specific GDIPs where applicable (e.g. "implements GDIP-004 step output").

### Prompting: Model, IDE/CLI, Context Bundle

- **Context bundle**: Include the GDIP index and the full text of the GDIPs you need (e.g. 002, 003, 004 for boundary generation; add 005/006 for demographics/comparison). Optionally include this doc, [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md), and relevant code paths (e.g. algorithm service, API shapes).
- **Model / IDE**: Use any LLM-capable IDE or CLI (e.g. Cursor, VS Code with Copilot, or API-based tools). Specify "GeoDistricts Protocol" and the GDIP numbers so the model knows which spec to follow.
- **Prompt archive/history**: This project's `.cursor/archive/` and doc history (e.g. `doc/history/`) can be included as additional context for maintenance and improvement prompts. The archive is also published at [https://lacoda-labs.github.io/geodistricts/archive/](https://lacoda-labs.github.io/geodistricts/archive/) for agents that consume context via URL.

### Context for GDIP Consumption

To consume "this project + GDIPs" as context (e.g. for an LLM):

1. **GDIP index**: Use [doc/protocol/GDIPs/README.md](protocol/GDIPs/README.md) for the list of GDIPs (required vs optional, status).
2. **GDIP text**: Include the markdown files in `doc/protocol/GDIPs/` (e.g. gdip-001 for process; gdip-002 through gdip-006 for protocol specs) for the features you are implementing or verifying.
3. **Reference implementation**: Include this file, [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md), and (optionally) key code paths: `backend/services/geodistrict-algorithm.js`, frontend maps/geodistrict-viewer components, API types.
4. **Version pins**: When the protocol repo exists, link to a specific protocol release tag (e.g. `protocol-v1.0`) so that the reference implementation and protocol stay in sync. Until then, the canonical GDIPs are in `doc/protocol/GDIPs/`.

**Context bundle build (optional)**: A script or CI step could concatenate the GDIP index + selected GDIP markdown files + this doc into a single artifact for copy-paste or API use. Not implemented here; implementers can add it under `scripts/` or `doc/protocol/` if desired.
