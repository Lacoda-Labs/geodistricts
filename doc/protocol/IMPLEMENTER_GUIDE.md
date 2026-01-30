# GeoDistricts Protocol: Implementer Guide

This guide is for **implementers** of the GeoDistricts Protocol: state governments, redistricting consultants, developers, and researchers who want to adopt or build on the protocol.

## Who the Protocol Is For

- **State governments**: Legislatures, redistricting commissions, or election offices considering algorithmic redistricting or comparison with current maps.
- **Redistricting consultants**: Organizations that provide redistricting software or analysis and want to support or compare with GeoDistricts.
- **Developers**: Teams building tools, APIs, or visualizations that consume or produce geodistrict boundaries.
- **Researchers**: Academics or advocates analyzing fairness, demographics, or partisan impact of algorithmic vs. enacted districts.

## How to Run or Integrate

### Option 1: Use the Reference Implementation

- **Run locally**: Clone [GeoDistricts](https://github.com/Lacoda-Labs/geodistricts) and follow [GITHUB_SETUP](../pages/GITHUB_SETUP.md). Use `./scripts/quick-start.sh` to start backend and frontend.
- **API**: The backend exposes REST endpoints for census data, algorithm execution, and cached results. See [ARCHITECTURE_DETAILS](../pages/ARCHITECTURE_DETAILS.md) for API structure.
- **Data**: You need Census API access (optional but recommended; see [CENSUS_API_KEY_SETUP](../history/CENSUS_API_KEY_SETUP.md)) and TIGER/Line or cached tract boundaries. District counts per state are built-in or configurable.

### Option 2: Build Your Own Implementation

- **Protocol**: Implement the required GDIPs (data model, required data sources, core algorithm). See [GDIPs index](GDIPs/README.md) and the individual GDIP files in `doc/protocol/GDIPs/`.
- **Required inputs**: Census tract population, TIGER/Line (or equivalent) boundaries, congressional district count per state. See [GDIP-003](GDIPs/gdip-003-required-data-sources.md).
- **Algorithm**: Implement init → county-level division → tract-level refinement as in [GDIP-004](GDIPs/gdip-004-core-algorithm.md). Output must conform to [GDIP-002](GDIPs/gdip-002-data-model.md) (geodistricts with tract GEOIDs and population).
- **Optional**: Demographics (GDIP-005) and comparison metrics (GDIP-006) if you need per-district demographics or existing-district comparison.

### Option 3: Integrate via API

- Call the reference implementation’s API (when deployed) to run the algorithm for a state and receive geodistrict boundaries. Ensure your client uses the same protocol version the server implements.

## How to Verify Compliance

- **Population equality**: Per-district population variance from target (total state population / number of districts) should be &lt;1%. See GDIP-004.
- **Contiguity**: Optional. Contiguity score = percentage of tracts in a district with at least one adjacent tract in the same district. Document if below a threshold (e.g. 80%).
- **Comparison metrics**: If you implement GDIP-006, document how you match existing districts to geography (e.g. tract centroid containment) and how you aggregate voter or demographic data.

## Links

- **Protocol (GDIPs)**: [doc/protocol/GDIPs/](GDIPs/README.md) — index and required/optional specs.
- **Reference implementation**: [doc/protocol/REFERENCE_IMPLEMENTATION.md](REFERENCE_IMPLEMENTATION.md) — what this repo implements and how to use it.
- **Data sources**: [STATE_DATA_SOURCES](../pages/STATE_DATA_SOURCES.md), [CENSUS_POPULATION_DATA](../pages/CENSUS_POPULATION_DATA.md), [TIGER_LINE_SHAPEFILES](../pages/TIGER_LINE_SHAPEFILES.md).
- **Comparison plan**: [CONGRESSIONAL_DISTRICT_COMPARISON_PLAN](../history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md) — data and methods for comparing existing vs. geodistricts.

## Government and Adoption

For considerations specific to government research, exploratory use, and adoption/codification (e.g. state legislation), see [GOVERNMENT_AND_ADOPTION.md](GOVERNMENT_AND_ADOPTION.md).
