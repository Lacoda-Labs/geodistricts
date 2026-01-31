# GDIP-003: Required Data Sources

**Status**: Draft  
**Type**: Required  
**Created**: 2026-01-28  
**Updated**: 2026-01-30

## Summary

Defines the **required** data sources for the GeoDistricts protocol: census tract population data, census tract (and county) geographic boundaries, and the number of congressional districts per state. Conforming implementations MUST obtain these inputs from the specified or equivalent authoritative sources.

## Motivation

The algorithm is deterministic and objective only if all implementations use the same class of inputs: census-based population, census geography (TIGER/Line or equivalent), and statutory district counts. This GDIP locks required sources so that geodistrict outputs are comparable and auditable.

## Specification

### Changes

#### 1. Required inputs

| Input | Description | Authoritative source | Format / access |
|-------|-------------|----------------------|------------------|
| **Tract population** | Total population per census tract | U.S. Census Bureau (decennial census or ACS) | Census API: `https://api.census.gov/data`; variables e.g. B01003_001E (total population). Geographic identifiers: STATE, COUNTY, TRACT → GEOID (11-digit). |
| **Tract boundaries** | Geographic boundaries of census tracts | U.S. Census Bureau TIGER/Line Shapefiles | TIGER/Line or TIGERweb: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb`; GeoJSON or shapefile. |
| **County-tract relationship** | County FIPS codes for tract GEOIDs | TIGER/Line or Census API | Extract state/county FIPS from 11-digit tract GEOID; used for data organization and optional county-level reporting. |
| **District count** | Number of congressional districts for the state | Statutory apportionment (e.g. Census apportionment, 435 total) | Integer per state; source may be internal (e.g. congressional-districts service) or Census/legislative reference. |

#### 2. Tract population

- **Source**: U.S. Census Bureau decennial census or American Community Survey (ACS) 5-year estimates.
- **Granularity**: Census tract.
- **Required field**: Total population per tract (GEOID). Implementations MUST map source data to GEOID and population (see GDIP-002).
- **Reference**: [Census API](https://www.census.gov/data/developers/data-sets.html), [CENSUS_POPULATION_DATA](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/CENSUS_POPULATION_DATA.md).

#### 3. Tract and county geography

- **Source**: U.S. Census Bureau TIGER/Line Shapefiles or TIGERweb services.
- **Required**: Tract boundaries (or representative point for geographic sorting); county-tract relationship for data organization and optional county-level reporting.
- **Reference**: [TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), [TIGER_LINE_SHAPEFILES](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/TIGER_LINE_SHAPEFILES.md).

#### 4. District count

- **Source**: Official apportionment (e.g. 435-seat House apportionment by state). Implementation may use a static table or external API.
- **Required**: One integer per state (50 states + DC). Single-district states (e.g. WY, VT) have count 1.

### Required vs Optional

**Required**: All conforming implementations MUST use census tract population from Census Bureau (or equivalent official census), TIGER/Line (or equivalent) geography for tracts and counties, and the correct congressional district count per state. Optional data sources (e.g. voter registration) are defined in separate GDIPs.

### Data model impact

- Inputs must map to GDIP-002 data model (GEOID, FIPS, population). No new entities.

### Backward Compatibility

- Fully backward compatible; formalizes current reference implementation inputs.

## Reference Implementation

- [doc/pages/CENSUS_POPULATION_DATA.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/CENSUS_POPULATION_DATA.md)  
- [doc/pages/TIGER_LINE_SHAPEFILES.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/TIGER_LINE_SHAPEFILES.md)  
- [doc/pages/STATE_DATA_SOURCES.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/STATE_DATA_SOURCES.md) (includes optional voter data; required sources are Census + TIGER).

## References

- [GDIP-002: Data Model](gdip-002-data-model.md)  
- [GDIP-004: Core Algorithm](gdip-004-core-algorithm.md)  
- [GDIP-005: Demographics for New Geodistricts](gdip-005-demographics.md) (optional)
