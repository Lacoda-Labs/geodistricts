# GeoDistricts Reference Implementation

This repository (**geodistricts**) is the **reference implementation** of the GeoDistricts Protocol. The protocol itself (GDPIPs, governance, index) lives in a **separate repository**; see [Protocol Repository Recommendations](PROTOCOL_REPO_RECOMMENDATIONS.md) and the protocol repo when it exists (e.g. `Lacoda-Labs/geodistricts-protocol`).

## Protocol Version and GDPIPs Implemented

- **Protocol version**: This implementation follows the protocol as specified by the GDPIP index in the protocol repo. Until the protocol repo is created, the canonical GDPIPs are maintained in this repo under `doc/protocol/GDPIPs/`.
- **Required GDPIPs** (implemented):
  - **GDPIP-001 (Data Model)**: Canonical structures for states, counties, tracts, district groups, geodistricts. Implemented in backend API and frontend types; see [GeodistrictingAlgorithmSpecification](../pages/GeodistrictingAlgorithmSpecification.md) and [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
  - **GDPIP-002 (Required Data Sources)**: Census population, TIGER/Line boundaries, district count per state. Implemented via Census API integration and TIGER/cache; see [CENSUS_POPULATION_DATA](../pages/CENSUS_POPULATION_DATA.md), [TIGER_LINE_SHAPEFILES](../pages/TIGER_LINE_SHAPEFILES.md).
  - **GDPIP-003 (Core Algorithm)**: Geodistrict boundary calculation (init, county-level division, tract-level refinement). Implemented in `backend/services/geodistrict-algorithm.js` (or equivalent); step-by-step output for visualization in frontend (maps-page, geodistrict-viewer).
- **Optional GDPIPs** (partial or planned):
  - **GDPIP-004 (Demographics)**: Aggregating party, race, age per geodistrict. Partial: Census demographics and voter registration loaders exist; full per-district aggregation is planned. See [STATE_ELECTION_DATA](../pages/STATE_ELECTION_DATA.md), [representation-comparison.js](../../backend/services/representation-comparison.js).
  - **GDPIP-005 (Comparison Metrics)**: Comparing existing districts vs geodistricts. Planned; see [CONGRESSIONAL_DISTRICT_COMPARISON_PLAN](../history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md), [representation-comparison.js](../../backend/services/representation-comparison.js).

## Architecture (Summary)

- **Frontend**: Angular 17+, TypeScript, Leaflet. Interactive maps, step-by-step algorithm visualization, division lines, district groups. See [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
- **Backend**: Node.js, Express. REST API for census data, algorithm execution, caching (Cloud Storage / local cache). See [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md).
- **Data flow**: Census API + TIGER/Line → backend cache → algorithm → geodistricts (tract list, population, optional steps) → frontend visualization.
- **Caching**: Multi-tier (memory, backend cache, Cloud Storage for large state data). Caching design supports client performance when navigating algorithm steps. See [CACHING_DESIGN](../history/CACHING_DESIGN.md).

## Deployment

- **Run locally**: `./scripts/quick-start.sh` or `cd backend && npm run dev` and `cd frontend && ng serve`. See [GITHUB_SETUP](../pages/GITHUB_SETUP.md).
- **Deploy**: Google Cloud Run (backend), static hosting (frontend). See [GCP_SETUP](../pages/GCP_SETUP.md), `deploy/`, `scripts/deploy.sh`.

## Maintaining and Improving

- **Protocol changes**: Algorithm or data-model changes that affect the protocol MUST be proposed in the **protocol repo** as a GDPIP (see [CONTRIBUTING.md](../CONTRIBUTING.md) section "Protocol changes"). This repo then implements the accepted GDPIP and documents the protocol version or GDPIP set it follows.
- **Reference implementation updates**: When a new GDPIP is accepted, update this doc (and README if needed) to reflect which GDPIPs are implemented and link to the protocol repo tag or release.

---

## Generative AI: Reference Implementations and GDPIP Context

### Using Gen AI to Create or Extend Reference Implementations

The protocol (GDPIPs) can be used as context for an LLM to produce or extend reference implementations, for example:

- **Produce geodistrict boundaries for all 50 states + DC**: Use GDPIP-001, GDPIP-002, GDPIP-003 as context; output must conform to the data model and algorithm.
- **Produce UI that visualizes each algorithm step**: Use GDPIP-003 (step structure) and reference implementation docs (step-through behavior, division lines). See `frontend/src/app/pages/maps-page.component.ts`, `frontend/src/app/components/geodistrict-viewer.component.ts`.
- **Produce caching design for step navigation**: Use [CACHING_DESIGN](../history/CACHING_DESIGN.md) and requirement that client performance be supported as the user navigates steps.

Tie generated features to specific GDPIPs where applicable (e.g. "implements GDPIP-003 step output").

### Prompting: Model, IDE/CLI, Context Bundle

- **Context bundle**: Include the GDPIP index and the full text of the GDPIPs you need (e.g. 001, 002, 003 for boundary generation; add 004/005 for demographics/comparison). Optionally include this doc, [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md), and relevant code paths (e.g. algorithm service, API shapes).
- **Model / IDE**: Use any LLM-capable IDE or CLI (e.g. Cursor, VS Code with Copilot, or API-based tools). Specify "GeoDistricts Protocol" and the GDPIP numbers so the model knows which spec to follow.
- **Prompt archive/history**: This project's `.cursor/archive/` and doc history (e.g. `doc/history/`) can be included as additional context for maintenance and improvement prompts.

### Context for GDPIP Consumption

To consume "this project + GDPIPs" as context (e.g. for an LLM):

1. **GDPIP index**: Use [doc/protocol/GDPIPs/README.md](protocol/GDPIPs/README.md) for the list of GDPIPs (required vs optional, status).
2. **GDPIP text**: Include the markdown files in `doc/protocol/GDPIPs/` (e.g. gdpip-001 through gdpip-005) for the features you are implementing or verifying.
3. **Reference implementation**: Include this file, [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md), and (optionally) key code paths: `backend/services/geodistrict-algorithm.js`, frontend maps/geodistrict-viewer components, API types.
4. **Version pins**: When the protocol repo exists, link to a specific protocol release tag (e.g. `protocol-v1.0`) so that the reference implementation and protocol stay in sync. Until then, the canonical GDPIPs are in `doc/protocol/GDPIPs/`.

**Context bundle build (optional)**: A script or CI step could concatenate the GDPIP index + selected GDPIP markdown files + this doc into a single artifact for copy-paste or API use. Not implemented here; implementers can add it under `scripts/` or `doc/protocol/` if desired.
