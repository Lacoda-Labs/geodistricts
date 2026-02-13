# GeoDistricts Solution Brief

## Whereas
United States Constitution gives States authority to manage how they elect representatives.
See https://grok.com/share/bGVnYWN5_7b9f1ac1-7d40-47cd-b711-a5bcf62a8feb

## Problem  
States gerrymandering district boundaries based on registered voters in order to manipulate election outcomes.

## Constraints
US Constitution and statutes (e.g., Voting Rights Act)

## Solution
Define an algorithm that objectively generates district boundaries based on census data and geographic principles.

## Assumptions
- VRA sections found unconstitutional may no longer need consideration or are inherently met by the design of an algorithm that objectively defines congressional districts based on census tracts and geographically based apportionment.
- Census tracts are trusted to be objectively defined.
- Congressional representative apportionments are trusted to be objectively calculated based on statute that limits total to 435 based on census results.

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

## Related Documentation

For detailed implementation specifications and related documentation, see:

### Algorithm Design
- [Geodistricting Algorithm Specification](https://github.com/Lacoda-Labs/gdip/blob/main/GeodistrictingAlgorithmSpecification.md) - Complete algorithm specification
- [GeoDistricting Algorithm](pages/GeoDistrictingAlgorithm.md) - Algorithm implementation details
- [Algorithm Abstract Steps](pages/algo-abstract-steps.md) - High-level algorithm steps
- [Latitude/Longitude Division Design](pages/LATLONG_ALGORITHM_DESIGN.md) - Geographic division strategy
- [Tract Division](pages/TRACT_DIVISION_README.md) - Census tract division approach
- [Geo Graph Traversal Algorithm](pages/geo-graph-traversal-algorithm-spec.md) - Graph-based approach
- [Backend Algorithm Implementation Summary](pages/backend-algorithm-implementation-summary.md) - Implementation details
- [Backend Algorithm Execution Proposal](pages/backend-algorithm-execution-proposal.md) - Execution strategy

### Data Sources & Services
- [Census Population Data](pages/CENSUS_POPULATION_DATA.md) - Demographic statistics integration
- [TIGER/Line Shapefiles](pages/TIGER_LINE_SHAPEFILES.md) - Geographic boundaries and spatial data
- [State Election Data](pages/STATE_ELECTION_DATA.md) - Voter registration and party affiliation
- [Census Service README](pages/CENSUS_SERVICE_README.md) - Census data integration
- [Census API Key Setup](pages/CENSUS_API_KEY_SETUP.md) - API configuration
- [Census Proxy Implementation](pages/CENSUS_PROXY_IMPLEMENTATION.md) - Proxy service details
- [Census Proxy Integration](pages/CENSUS_PROXY_INTEGRATION.md) - Integration guide
- [State Data Sources](pages/STATE_DATA_SOURCES.md) - State-specific data sources
- [PoliGeo Analyst](pages/POLIGEO_ANALYST.md) - Estimated party impact from VEST election data and comparison to current representation

### Implementation & Verification
- [Implementation Verification](pages/IMPLEMENTATION_VERIFICATION.md) - Verification procedures
- [Island Tract Detection](pages/251204-island-tract-detection.md) - Handling isolated tracts
- [Move Isolated Tracts Function](pages/MOVE_ISOLATED_TRACTS_FUNCTION.md) - Tract relocation logic
- [How to Create Union Polygons](pages/251204-how-to-create-union-polygons.md) - Polygon operations

### Infrastructure & Setup
- [Architecture Details](pages/ARCHITECTURE_DETAILS.md) - System design and components
- [GCP Setup](pages/GCP_SETUP.md) - Google Cloud Platform configuration
- [Domain Setup Guide](pages/DOMAIN_SETUP_GUIDE.md) - Domain configuration
- [GitHub Setup](pages/GITHUB_SETUP.md) - Repository setup
- [Secret Manager Integration](pages/SECRET_MANAGER_INTEGRATION.md) - Secrets management
- [Cloud Storage Migration](pages/CLOUD_STORAGE_MIGRATION.md) - Storage migration guide
- [Caching Design](pages/CACHING_DESIGN.md) - Caching strategy

### UI Components
- [Division Boxes Component](pages/DIVISION_BOXES_COMPONENT.md) - UI component documentation

### Campaign & Outreach
- [Campaign Summary](pages/CAMPAIGN_SUMMARY.md) - Campaign overview
- [Campaign Analytics](pages/CAMPAIGN_ANALYTICS.md) - Analytics setup
- [Campaign Content Templates](pages/CAMPAIGN_CONTENT_TEMPLATES.md) - Content templates
- [Campaign Design Assets](pages/CAMPAIGN_DESIGN_ASSETS.md) - Design resources
- [Outreach Templates](pages/OUTREACH_TEMPLATES.md) - Outreach materials
- [Social Media Launch Guide](pages/SOCIAL_MEDIA_LAUNCH_GUIDE.md) - Launch strategy
- [Maintenance Templates](pages/MAINTENANCE_TEMPLATES.md) - Maintenance procedures

### Planning & Analysis
- [Congressional District Comparison Plan](history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md) - Comparison strategy (existing vs geodistricts)
- [Voter Registration Data Plan](history/VOTER_REGISTRATION_DATA_PLAN.md) - Voter data integration

### Protocol & Implementers
- [Protocol (GDIPs) Index](protocol/GDIPs/README.md) - GeoDistricts Improvement Proposals (required/optional specs)
- [Reference Implementation](protocol/REFERENCE_IMPLEMENTATION.md) - This repo as the protocol reference implementation
- [Implementer Guide](protocol/IMPLEMENTER_GUIDE.md) - For state governments, consultants, developers
- [Government and Adoption](protocol/GOVERNMENT_AND_ADOPTION.md) - Research, exploratory use, adoption/codification
- [Protocol Repo Recommendations](protocol/PROTOCOL_REPO_RECOMMENDATIONS.md) - Separate protocol repository setup

### Historical Notes
- [Centroids Graph Approach](pages/251013-2238-centroids-graph-approach.md) - Early algorithm exploration
- [Algorithm Chat with Grok](pages/251013-algo-chat-with-grok.md) - Design discussion
- [Brown S4 Adjacent Tracts Algorithm](pages/251014-brown-s4-adjacent-tracts-algorithm) - Algorithm variant

