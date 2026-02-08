# GDIP-002: Data Model

**Status**: Draft  
**Type**: Required  
**Created**: 2026-01-28  
**Updated**: 2026-01-29

## Summary

Defines the canonical data structures for the GeoDistricts protocol: states, counties, census tracts, district groups, and final geodistricts. All conforming implementations MUST use or map to these structures for interoperability.

## Motivation

Implementers and tooling (including LLM-generated code) need a single, clear data model so that geodistrict boundaries and metadata can be produced, exchanged, and validated consistently. This GDIP establishes the minimal required fields and semantics.

## Specification

### 1. Geographic and administrative identifiers

- **State**: Identified by 2-letter USPS abbreviation (e.g. `"AZ"`) or 2-digit FIPS code (e.g. `"04"`). Protocol uses state abbreviation in APIs; FIPS is acceptable in bulk/census contexts.
- **County**: Identified by 5-digit FIPS code (state FIPS + county FIPS), e.g. `"04013"` (Maricopa County, AZ). No optional county name field in the protocol; implementers may add display names locally.
- **Census tract**: Identified by **GEOID** (11-digit: state FIPS + county FIPS + tract code), e.g. `"04013400100"`. GEOID is the canonical key for tracts in all protocol inputs and outputs.

### 2. Core entities

**Census tract (input)**  
- `geoid` (string, required): 11-digit GEOID.  
- `population` (number, required): Total population for the tract (decennial or ACS source per GDIP-003).  
- `geometry` (optional for protocol spec): Geographic boundary (e.g. GeoJSON). Protocol algorithm uses tract identity and population; geometry is required for boundary output and visualization (see reference implementation).

**County (derived or input)**  
- `fips` (string, required): 5-digit FIPS.  
- `population` (number, required): Sum of tract populations in the county.  
- `tracts` (array of tract identifiers or tract objects, as needed for algorithm).

**District group (algorithm intermediate)**  
- `startDistrictNumber`, `endDistrictNumber` (integers): Range of district indices (1-based) assigned to this group.  
- `counties` / `tracts`: Counties or tracts belonging to this group.  
- `totalPopulation` (number): Sum of population in the group.  
- `bounds` (optional): Geographic bounds; `centroid` (optional): Center point. Used for sorting and visualization.

**Geodistrict (output)**  
- `districtNumber` (integer, 1-based): District index within the state.  
- `tracts` (array): List of GEOIDs or tract objects assigned to this district.  
- `population` (number): Total population.  
- `populationVariance` (number, optional): Percentage deviation from target population.  
- `contiguityScore` (number, optional): Percentage of tracts with at least one adjacent tract in the same district.  
- `counties` (array of FIPS, optional): Counties that overlap this district.

### 3. Algorithm input

- **State** (abbreviation or FIPS).  
- **Total districts** (integer): Number of congressional districts for the state (e.g. from apportionment).  
- **Census tract data**: For each tract, at least `geoid` and `population`; boundaries required for producing district geometries.

### 4. Algorithm output

- **Districts**: Array of geodistrict objects (one per district number).  
- **Steps** (optional): For visualization and auditing, division steps (district groups at each iteration). Format is implementation-defined but should allow replay/visualization of the algorithm.

### Required vs Optional

**Required**: All conforming implementations MUST produce and consume data that maps to the above entities and identifiers (GEOID for tracts, FIPS for counties, state abbreviation or FIPS). Output districts MUST include at least district number, list of tract GEOIDs, and population per district.

### Data model impact

- New implementations must use GEOID as the canonical tract key and 5-digit FIPS for counties.  
- No breaking change to existing reference implementation; this GDIP formalizes existing structures.

### Backward Compatibility

- Fully backward compatible; this GDIP documents the current reference implementation data model.

## Reference Implementation

- [doc/pages/GeodistrictingAlgorithmSpecification.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/GeodistrictingAlgorithmSpecification.md) — Implementation Notes, Data Structures.  
- [doc/pages/ARCHITECTURE_DETAILS.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/ARCHITECTURE_DETAILS.md) — Database schema and core tables.

## References

- [GDIP-003: Required Data Sources](gdip-003-required-data-sources.md)  
- [GDIP-004: Core Algorithm](gdip-004-core-algorithm.md)  
- U.S. Census Bureau: [GEOID](https://www.census.gov/programs-surveys/geography/guidance/geo-identifiers.html), [FIPS codes](https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html)
