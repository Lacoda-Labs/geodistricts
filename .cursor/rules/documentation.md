# Documentation Access Strategy

## Primary Entry Point
- **Always start with**: `doc/GeoDistrictsProjectOverview.md` - This file provides a comprehensive overview and links to all project documentation organized by category.

## Context-Aware Documentation References
When working on specific areas, reference relevant documentation from `doc/pages/` as needed:

### Algorithm & Core Logic
- `https://github.com/Lacoda-Labs/gdip/blob/main/GeodistrictingAlgorithmSpecification.md` - Complete algorithm specification
- `doc/pages/GeoDistrictingAlgorithm.md` - Algorithm implementation details
- `doc/pages/algo-abstract-steps.md` - High-level algorithm steps
- `doc/pages/LATLONG_ALGORITHM_DESIGN.md` - Geographic division strategy
- `doc/pages/TRACT_DIVISION_README.md` - Census tract division approach
- `doc/pages/geo-graph-traversal-algorithm-spec.md` - Graph-based approach
- `doc/pages/backend-algorithm-implementation-summary.md` - Implementation details
- `doc/pages/backend-algorithm-execution-proposal.md` - Execution strategy

### Data Sources & Services
- `doc/pages/CENSUS_SERVICE_README.md` - Census data integration
- `doc/pages/CENSUS_API_KEY_SETUP.md` - API configuration
- `doc/pages/CENSUS_PROXY_IMPLEMENTATION.md` - Proxy service details
- `doc/pages/CENSUS_PROXY_INTEGRATION.md` - Integration guide
- `doc/pages/STATE_DATA_SOURCES.md` - State-specific data sources

### Implementation & Verification
- `doc/pages/IMPLEMENTATION_VERIFICATION.md` - Verification procedures
- `doc/pages/251204-island-tract-detection.md` - Handling isolated tracts
- `doc/pages/MOVE_ISOLATED_TRACTS_FUNCTION.md` - Tract relocation logic
- `doc/pages/251204-how-to-create-union-polygons.md` - Polygon operations

### Infrastructure & Setup
- `doc/pages/GCP_SETUP.md` - Google Cloud Platform configuration
- `doc/pages/DOMAIN_SETUP_GUIDE.md` - Domain configuration
- `doc/pages/GITHUB_SETUP.md` - Repository setup
- `doc/pages/SECRET_MANAGER_INTEGRATION.md` - Secrets management
- `doc/pages/CLOUD_STORAGE_MIGRATION.md` - Storage migration guide
- `doc/pages/CACHING_DESIGN.md` - Caching strategy

### UI Components
- `doc/pages/DIVISION_BOXES_COMPONENT.md` - UI component documentation

### Campaign & Outreach
- `doc/pages/CAMPAIGN_SUMMARY.md` - Campaign overview
- `doc/pages/CAMPAIGN_ANALYTICS.md` - Analytics setup
- `doc/pages/CAMPAIGN_CONTENT_TEMPLATES.md` - Content templates
- `doc/pages/CAMPAIGN_DESIGN_ASSETS.md` - Design resources
- `doc/pages/OUTREACH_TEMPLATES.md` - Outreach materials
- `doc/pages/SOCIAL_MEDIA_LAUNCH_GUIDE.md` - Launch strategy
- `doc/pages/MAINTENANCE_TEMPLATES.md` - Maintenance procedures

### Planning & Analysis
- `doc/pages/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md` - Comparison strategy
- `doc/pages/VOTER_REGISTRATION_DATA_PLAN.md` - Voter data integration

## Documentation Usage Guidelines
1. **Do NOT automatically load all documentation files** - This wastes context window and reduces focus
2. **Reference specific docs when relevant** - Use `@` mentions or explicit file paths when specific documentation is needed
3. **Check the overview first** - `doc/GeoDistrictsProjectOverview.md` provides the documentation structure and helps identify which specific docs are relevant
4. **Be selective** - Only include documentation that directly relates to the current task or question
