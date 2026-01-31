# GDIP-004: Core Algorithm (Geodistrict Boundary Calculation)

**Status**: Draft  
**Type**: Required  
**Created**: 2026-01-28  
**Updated**: 2026-01-30

## Summary

Specifies the core algorithm that computes geodistrict boundaries from census tracts and population: initialization, lat/long division, contiguity management, and output. The algorithm is deterministic, uses only census and geographic inputs (no political data), and produces districts that satisfy population equality (target &lt;1% variance) and prefer contiguity where possible.

## Motivation

Implementers and tooling need a single, unambiguous specification so that geodistrict boundaries are comparable across implementations and reproducible. This GDIP encodes the protocol contract for the boundary-generation algorithm.

## Specification

### Changes

#### 1. Core principles (invariants)

1. **Population equality first**: Districts MUST be as close to equal population as possible; target variance &lt;1% from ideal (total state population / number of districts).
2. **Contiguity preferred**: Districts SHOULD be contiguous where possible; discontiguity is acceptable for geographic barriers (e.g. islands, water).
3. **Objective and automated**: No human intervention; algorithm runs deterministically from census and geographic inputs only.
4. **Direct tract division**: Work directly with census tracts using latitude/longitude dividing lines for geographic distribution.

#### 2. Inputs and outputs

- **Input**: State (abbreviation or FIPS), census tract data (GEOID, population, boundaries per GDIP-002 and GDIP-003), number of congressional districts for the state.
- **Output**: Set of geodistricts (one per district number), each with assigned tract GEOIDs and population; optional population variance and contiguity score per district (GDIP-002).

#### 3. High-level steps

1. **Initialize**: Fetch all census tracts for the state; compute total state population (sum of tract populations); compute target population per district = total state population / number of districts; set max allowed variance (e.g. 1% of target). Initialize one district group containing all tracts.
2. **Lat/long division**: Repeat until each group has 1 district: (a) Select the group with the most districts (tie-break: largest population). (b) If the group has 1 district, skip. (c) Compute split: if even number of districts, split 50/50; if odd, split (n−1)/2 and (n+1)/2. (d) Sort tracts geographically by alternating latitude/longitude boundaries (e.g. iteration 1: south boundary for latitude, iteration 2: east boundary for longitude). (e) Accumulate tract populations until ≥ target for the first sub-group; split at tract boundary (do not split individual tracts). (f) Keep enclosed tracts with their enclosing tracts. (g) Create new district groups with updated start/end district numbers and populations.
3. **Contiguity management**: For each division result: (a) Detect isolated tracts using adjacency data. (b) Move isolated tracts to adjacent connected groups while maintaining population balance. (c) Handle bridge tracts that connect isolated components.
4. **Validation and output**: Compute per-district population variance and (optionally) contiguity score; output list of districts with tract GEOIDs and population; log variances and any discontiguous districts.

#### 4. Geographic sorting

- **Direction**: Alternating by division iteration—e.g. iteration 1: sort by south boundary (latitude, north–south); iteration 2: sort by east boundary (longitude, west–east). Uses tract boundary coordinates for precise geographic ordering.
- **Stability**: Sort MUST be deterministic (e.g. stable sort, then secondary key by GEOID).

#### 5. Odd/even split

- For a group with **n** districts: first sub-group gets **floor(n/2)** districts, second gets **ceil(n/2)**. Population target for first = group total population × (floor(n/2) / n).

#### 6. Variance and contiguity

- **Population variance**: Per district, (population − target) / target; report as percentage. Target: &lt;1%.
- **Contiguity**: Optional. Contiguity score = percentage of tracts in the district that have at least one adjacent tract (shared boundary) in the same district. Log if below a threshold (e.g. 80%).

### Required vs Optional

**Required**: All conforming implementations MUST implement the above flow (initialize → lat/long division → contiguity management → output) with deterministic geographic sorting and odd/even split rules. Optional: contiguity scoring, step-by-step output for visualization.

### Data model / algorithm impact

- Output conforms to GDIP-002 (geodistricts with district number, tract list, population). No new required fields.

### Backward Compatibility

- Fully backward compatible; formalizes the current reference implementation algorithm.

## Reference Implementation

- [doc/pages/GeodistrictingAlgorithmSpecification.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/GeodistrictingAlgorithmSpecification.md) (full spec).  
- [doc/GeoDistrictsProjectOverview.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/GeoDistrictsProjectOverview.md) (overview).  
- Backend: `backend/services/geodistrict-algorithm.js` and `backend/services/latlong-division.js` (or equivalent in reference implementation).

## References

- [GDIP-002: Data Model](gdip-002-data-model.md)  
- [GDIP-003: Required Data Sources](gdip-003-required-data-sources.md)  
- Reference implementation uses lat/long division as described in the algorithm specification.
