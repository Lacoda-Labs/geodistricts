# GeoDistricts Improvement Proposals (GDIPs) — Index

GeoDistricts is a **protocol** for objectively defining U.S. congressional districts by geographically dividing population into an apportioned number of districts. The protocol specifies the approach so that **implementations** can be built that achieve objective redistricting and a defined anti-gerrymandering outcome—no gerrymandering, comparable and auditable results.

This directory contains numbered **GeoDistricts Improvement Proposals (GDIPs)**. Each GDIP is a single document defining or extending part of the protocol (data model, data sources, algorithm, optional features) or the process that governs the protocol (e.g. how to submit and adopt GDIPs).

## Goals and scope

- **Protocol**: Define the algorithm, data model, and required inputs so that any conforming implementation produces comparable geodistricts. The protocol does not depend on a specific codebase; it is implementation-neutral.
- **Required vs optional**: Conforming implementations MUST implement the required GDIPs (data model, required data sources, core algorithm). Optional GDIPs (demographics, comparison metrics) extend functionality without breaking interoperability.
- **Reference implementation**: This project includes a proof-of-concept implementation that demonstrates the algorithm and supports comparisons (e.g. existing districts vs geodistricts, gerrymandered vs objective). Implementers can use it as a working example; the protocol itself is specified by the GDIPs.

## Index

| Number | Title | Type | Status | Description |
|--------|-------|------|--------|-------------|
| [GDIP-001](gdip-001-purpose-and-guidelines.md) | Purpose and Guidelines | Meta | Living | What a GDIP is, types, workflow, how to submit. Process documentation (like EIP-1). |
| [GDIP-002](gdip-002-data-model.md) | Data Model | Required | Draft | Canonical structures for states, counties, tracts, district groups, geodistricts. |
| [GDIP-003](gdip-003-required-data-sources.md) | Required Data Sources | Required | Draft | Census population, TIGER/Line boundaries, district count per state. |
| [GDIP-004](gdip-004-core-algorithm.md) | Core Algorithm | Required | Draft | Geodistrict boundary calculation: init, lat/long division, contiguity management. |
| [GDIP-005](gdip-005-demographics.md) | Demographics for New Geodistricts | Optional | Draft | Aggregating party, race, age, etc. per geodistrict when optional data is available. |
| [GDIP-006](gdip-006-comparison-metrics.md) | Comparison Metrics | Optional | Draft | Metrics for comparing existing districts vs geodistricts (variance, contiguity, partisan balance). |

## Process

- **How to submit or change the protocol**: See [GDIP-001: Purpose and Guidelines](gdip-001-purpose-and-guidelines.md) (and optionally [process/GDIP-PROCESS.md](../process/GDIP-PROCESS.md)).
- **Template**: [process/GDIP-TEMPLATE.md](../process/GDIP-TEMPLATE.md)
- **Governance**: [process/GOVERNANCE.md](../process/GOVERNANCE.md) — versioning and releases.

## Reference implementation

The [GeoDistricts reference implementation](https://github.com/Lacoda-Labs/geodistricts) implements this protocol. Implementers can use it as a working example and link to it from GDIPs.
