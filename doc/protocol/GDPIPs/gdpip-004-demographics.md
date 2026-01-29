# GDPIP-004: Demographics for New Geodistricts (Optional)

**Status**: Draft  
**Type**: Optional  
**Created**: 2026-01-28  
**Updated**: 2026-01-28

## Summary

Defines how to compute or aggregate **demographic** attributes for each generated geodistrict (e.g. political party, gender, race, age) when optional data sources are available. Implementations MAY implement this GDPIP to report demographics per district; the core algorithm (GDPIP-003) does not use demographics for boundary drawing.

## Motivation

Stakeholders (e.g. researchers, legislators) often want to understand the demographic composition of algorithmically generated districts. This GDPIP specifies how to aggregate tract-level or county-level demographic and political data to the geodistrict level so that comparisons and reporting are consistent across implementations.

## Specification

### Changes

#### 1. Scope

- **Input**: Geodistricts (list of tract GEOIDs per district) from GDPIP-003; optional tract- or county-level demographic/political data.
- **Output**: Per-district aggregates or breakdowns (e.g. party registration share, race/ethnicity counts, age distribution). Format is implementation-defined but SHOULD be documented (e.g. schema or examples).

#### 2. Data sources (optional)

- **Census demographics**: Race, age, gender (e.g. ACS or decennial). See [CENSUS_POPULATION_DATA](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/CENSUS_POPULATION_DATA.md). Aggregate by summing tract-level counts for tracts in each district.
- **Voter registration / party**: State-level voter registration by party (e.g. by county or precinct). See [STATE_ELECTION_DATA](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/STATE_ELECTION_DATA.md), [STATE_DATA_SOURCES](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/STATE_DATA_SOURCES.md). Where geography aligns (e.g. county), aggregate to district by summing registration in counties/tracts that fall within the district; otherwise document approximation (e.g. county-level apportionment to tracts).

#### 3. Aggregation rules

- **Summable counts**: For each district, sum the tract-level (or county-level, then allocated) values for each demographic variable. Example: total population by race = sum over tracts in district of tract race counts.
- **Ratios/percentages**: Compute from aggregated counts (e.g. party share = party registration / total registration in district).
- **Missing data**: If a tract or county has no demographic data, implementations MAY omit that geography from the aggregate or document the gap; document how missing data is handled.

#### 4. No impact on boundaries

- This GDPIP does NOT change the core algorithm. Demographics are computed **after** boundaries are fixed. The protocol does not use party, race, or other demographics to draw boundaries.

### Required vs Optional

**Optional**: Implementations MAY implement this GDPIP. Conforming implementations that do not implement it simply do not report demographics; interoperability of boundary output is unchanged (GDPIP-001, GDPIP-003).

### Data model impact

- Optional extension to geodistrict output (GDPIP-001): e.g. `demographics: { party: {...}, race: {...}, age: {...} }`. Schema can be specified in a future GDPIP or in the reference implementation docs.

### Backward Compatibility

- Fully backward compatible; additive only.

## Reference Implementation

- [doc/pages/STATE_ELECTION_DATA.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/STATE_ELECTION_DATA.md)  
- [doc/pages/CENSUS_POPULATION_DATA.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/CENSUS_POPULATION_DATA.md)  
- [backend/services/representation-comparison.js](https://github.com/Lacoda-Labs/geodistricts/blob/main/backend/services/representation-comparison.js) (placeholder; future extension for demographics).

## References

- [GDPIP-001: Data Model](gdpip-001-data-model.md)  
- [GDPIP-003: Core Algorithm](gdpip-003-core-algorithm.md)  
- [GDPIP-005: Comparison Metrics](gdpip-005-comparison-metrics.md) (optional; existing vs geodistricts comparison)
