# GeoDistricts Protocol Improvement Proposals (GDPIPs) — Index

This directory contains numbered **GeoDistricts Protocol Improvement Proposals (GDPIPs)**. Each GDPIP is a single document (or small set) defining or extending part of the GeoDistricts protocol.

- **Required**: All conforming implementations MUST implement these GDPIPs.
- **Optional**: Implementations MAY implement these; interoperability is preserved without them.

## Index

| Number | Title | Status | Type | Description |
|--------|-------|--------|------|-------------|
| [GDPIP-001](gdpip-001-data-model.md) | Data Model | Draft | Required | Canonical structures for states, counties, tracts, district groups, geodistricts. |
| [GDPIP-002](gdpip-002-required-data-sources.md) | Required Data Sources | Draft | Required | Census population, TIGER/Line boundaries, district count per state. |
| [GDPIP-003](gdpip-003-core-algorithm.md) | Core Algorithm | Draft | Required | Geodistrict boundary calculation: init, county-level division, tract-level refinement. |
| [GDPIP-004](gdpip-004-demographics.md) | Demographics for New Geodistricts | Draft | Optional | Aggregating party, race, age, etc. per geodistrict when optional data is available. |
| [GDPIP-005](gdpip-005-comparison-metrics.md) | Comparison Metrics | Draft | Optional | Metrics for comparing existing districts vs geodistricts (variance, contiguity, partisan balance). |

## Process

- **Submit**: See [process/GDPIP-PROCESS.md](../process/GDPIP-PROCESS.md) for how to submit a GDPIP.
- **Template**: Use [process/GDPIP-TEMPLATE.md](../process/GDPIP-TEMPLATE.md) when authoring a new GDPIP.
- **Governance**: See [process/GOVERNANCE.md](../process/GOVERNANCE.md) for versioning and releases.

## Reference Implementation

The [GeoDistricts reference implementation](https://github.com/Lacoda-Labs/geodistricts) implements this protocol. Implementers can use it as a working example and link to it from GDPIPs.
