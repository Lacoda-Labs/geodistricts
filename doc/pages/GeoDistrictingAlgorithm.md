# GeoDistricts Solution Brief

## Whereas
United States Constitution gives States authority to manage how they elect representatives.
See https://grok.com/share/bGVnYWN5_7b9f1ac1-7d40-47cd-b711-a5bcf62a8feb

## Problem  
State gerrymandering of district boundaries based on registered voter party in order to manipulate election outcomes.

## Constraints
US Constitution and statutes (e.g., Voting Rights Act). however, VRA and any other remedies designed to address gerrymandering and disenfranchising factions (based on race or other protected class) become obsolete with geodistricts; because of geodistricts objective approach which also and more directly cures the ills of gerrymandering.

## Solution
An algorithmic protocol that objectively generates district boundaries based on census data and geographic division of cencus tracks.

## Assumptions
- VRA sections found unconstitutional may no longer need consideration or are inherently met by the design of an algorithm that objectively defines congressional districts based on census tracts and geographically based apportionment.
- Census tracts are trusted to be objectively defined.
- Congressional representative apportionments are trusted to be objectively calculated based on statute that limits total to 435 based on census results.
- VRA code that makes redisticting based on Race is often used as a reason to oppose gerrmandering (in court) when truth is race is a secondary motivation with party being first and primary.

## Benefits
Democracy is preserved as no centralized state authority can be compromised into gerrymandering.

## Algorithm Overview

### Given
- Census tract population data for all US States (from https://api.census.gov/data)
- Geospatial boundaries of census tracts from TIGER/Line shapefiles (from https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb)  
- Number of congressional districts per state

### Core Principles
1. **Population Equality First**: Districts must be as close to equal population as possible (target: <1% variance).
2. **Contiguity Preferred**: Districts should be contiguous when possible, but discontiguity is acceptable for geographic barriers (e.g., islands, water bodies).
3. **Objective & Automated**: No human intervention; algorithm runs deterministically based on census data.
4. **Hierarchical Division**: Use administrative boundaries (counties) as natural grouping units before fine-tuning with census tracts.

### Approach
- Starting with a state's number of allocated congressional representatives (see `congressional-districts.service.ts`), divide total population (of each census tract) to determine target population for each resulting district ("geodistrict").

- **Two-Phase Division Strategy**:
  1. **County-Level Division**: Sort counties geographically and divide into balanced groups by population to create natural administrative boundaries.
  2. **Tract-Level Refinement**: Within each county group, sort tracts geographically and divide to achieve precise population targets.

- Division of district groups is repeated until each district group has only one district.
- Each iteration alternates dividing district groups geographically by latitude and longitude.
- When a district group contains an odd number of districts, subtract 1 from the number of districts in the group and divide by 2, assign the new divided group that even halved number of districts, and the other the same halved number + 1. For example, a district group with 13 districts is divided into two new district groups with 6 in one and 7 in the other and a population ratio of [6/13, 7/13].
    - Population ratios for odd numbers are calculated with the denominator being the total number of districts and even/odd number numerators where one is rounded up and the other rounded down.
- Only divide district groups that have more than one district (i.e., skip dividing district groups with only one district).

### Data Sources
- **Population Data**: Census API (https://api.census.gov/data)
- **Boundary Data**: TIGER/Line shapefiles (https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb)
- **District Counts**: Congressional districts service

### Key Features
- **Step-by-Step Visualization**: Track each division iteration for transparency and debugging.
- **Population Variance Tracking**: Monitor and report deviations from target population.
- **Contiguity Scoring**: Calculate and report contiguity percentages for each district.
- **Geographic Sorting**: Alternating latitude/longitude sorting ensures balanced geographic distribution.
- **Performance Optimized**: County-level division reduces complexity for large states.

### Implementation Status
- ✅ Basic algorithm framework implemented
- ✅ Census data integration (county and tract level)
- ✅ Step-by-step execution and visualization
- ✅ Population variance calculation
- 🔄 County-level division (in progress)
- ⏳ Contiguity scoring and validation

For detailed implementation specifications, see `GeodistrictingAlgorithmSpecification.md`.

