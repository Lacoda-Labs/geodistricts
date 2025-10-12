# GeoDistricts Solution Brief

## Whereas
United States Constitution gives States authority to manage how they elect representatives.
See https://grok.com/share/bGVnYWN5_7b9f1ac1-7d40-47cd-b711-a5bcf62a8feb

## Problem  
States gerrymandering district boundries based on registered voters in order to manipulate election outcomes. 

## Constraints
US constitution and statues e.g. voting rights act (VRA)

## Solution
define an algorithm that objectively generates district boundries 

## Assumptions
- VRA having sections been found unconstitional, may no longer need be considered or are inheritly met by tbe design of an algorithm that objectively defines congressional districts based on census tracts and geographically based apportionment of census tracts.
- Census tracts are trusted to be objectively defined.
- Congressional representative apportionments are trusted to objectively calculated based on statute that limits total to be 435 based on census results.

## Benefit
democracy is preserved as no centralized state authority can be compromised into gerrymandering.

## Algorithm
### Given
- census track population data for all US States (from https://api.census.gov/data)
- geospacial boundries of census tracts from TIGER/Line shapefiles (from https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb)  
- number of congressional districts 

### Approach
The algorithm now supports two modes of operation:

#### County-Aware Division (Default)
- **Smart County Assignment**: 
  - If county population ≥ target district size: Creates a district entirely from that county's tracts
  - If county population < target district size: Assigns county to district with smallest current population to preserve county boundaries
- **County Assignment**: Sorts counties by population (largest first) and processes each county based on its size relative to target district size
- **Population Balancing**: If districts become significantly imbalanced, moves entire counties between districts to achieve better population balance
- **Fallback to Geographic Division**: Only splits counties when absolutely necessary for population balance

#### Standard Geographic Division (Legacy)
- starting with a states number of allocation congressional representatives, divide total population (of each census tract) to determine target population for each resulting district ("geodistrict").
- repeatedly divide the total state census tracts geopgraphically by latitude and logitude, beginning with latitude, and a given ration (e.g. 50%/50%) to distribute census tracts into either north and south (latitude) or east and west (longitude) according to the ratio. resulting division is two groups of districts, geographically distributed according to population ratio.
- division of district groups is repeated on each distict group has only one district.
- each iteration alternates dividing district group geographically by latitude and longitude.
- when a district group contains an odd number of districts, subtract 1 from number of disticts in group and divide by 2, assign new divided group that even halved number of districts, and the other the same halved number + 1. e.g. a district group with 13 districts is divided into two new district groups with 6 in one and 7 in the other and a population ratio of [6/13,7/13].
    - population ratios for odd numbered are calculated with denominator being total number of districts an odd and even number numerator where one is rounded up and the other rounded down.
- only divide district groups that have move that one district, i.e. skip dividing districts groups with only one district. 
- geographical distribution is determined by boundary-based adjacency sorting to ensure true contiguity:
  - Build adjacency map by checking which census tracts share actual boundaries (not just proximity)
  - Start at top-north-west tract and follow a contiguous path through adjacent tracts
  - For latitude division (north/south): Prefer east-west movement, then southward progression
  - For longitude division (east/west): Prefer north-south movement, then eastward progression
  - Handle geographic barriers (water bodies, mountains) by detecting true boundary adjacency
  - Divide the contiguous sorted list by accumulating population until the target population ratio is achieved
