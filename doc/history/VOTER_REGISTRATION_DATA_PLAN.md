# Voter Registration Party Data Acquisition Plan

## Executive Summary

This document outlines a comprehensive plan to acquire reliable voter registration party affiliation data for all 50 states plus DC at a granularity sufficient to calculate party balance for geodistricts. Since geodistricts are built from census tracts, we need data that can be aggregated to the census tract level. The plan combines multiple data sources, spatial mapping techniques, and fallback strategies to ensure complete coverage across all states.

## Objectives

1. **Acquire voter registration party data** for all 50 states + DC
2. **Achieve census tract-level granularity** (or granular enough to aggregate to tracts)
3. **Ensure data reliability and accuracy** for geodistrict calculations
4. **Minimize costs** while maximizing data quality
5. **Create a unified data pipeline** that standardizes data from multiple sources
6. **Establish update mechanisms** to keep data current

## Requirements

### Geographic Granularity Requirements

**Primary Requirement**: Data must be granular enough to aggregate to census tracts for geodistrict calculations.

**Acceptable Data Levels** (in order of preference):
1. **Census tract level** (ideal) - Direct aggregation to geodistricts
2. **Precinct level** - Can be mapped to census tracts via spatial intersection
3. **Census block level** - Can be aggregated to tracts (but more processing)
4. **County level** - Can be allocated to tracts proportionally (least accurate)

**Minimum Requirement**: Data must allow calculation of party percentages for geodistricts with reasonable accuracy (>90% for most districts).

### Data Fields Required

For each geographic unit (tract, precinct, block, or county):
- Total registered voters
- Democratic registered voters
- Republican registered voters
- Other/Independent registered voters (or breakdown by minor parties)
- Date of data snapshot
- Geographic identifier (FIPS code, GEOID, or spatial boundary)

### Coverage Requirements

- **All 50 states + DC**: Complete coverage required
- **Update frequency**: At least annually (preferably quarterly or monthly)
- **Historical data**: At least 2-3 years for trend analysis
- **Data completeness**: >95% of tracts should have data

---

## Data Source Strategy

### Tier 1: Primary Sources (Precinct/Block Level)

These sources provide the most granular data and are preferred when available.

#### 1.1 MIT Election Data and Science Lab (MEDSL)

**Coverage**: All 50 states (varies by state)
**Geographic Level**: Precinct level (where available)
**Data Type**: Election results, some voter registration
**Cost**: Free (open source)
**Format**: CSV, shapefiles
**Update Frequency**: After each election cycle

**Advantages**:
- High quality, academic-grade data
- Standardized format across states
- Free and open source
- Includes spatial boundaries for precincts

**Limitations**:
- Not all states have precinct-level data
- Primarily election results, not always registration counts
- May need to infer party registration from election results

**Implementation**:
- Download precinct-level datasets from MEDSL
- Map precincts to census tracts using spatial intersection
- Aggregate party data to census tract level
- Use for states with available precinct data

**States with Good Coverage**: CA, TX, FL, NY, IL, PA, OH, MI, GA, NC, NJ, VA, WA, AZ, MA, TN, IN, MD, MN, MO, WI, CO, AL, SC, LA, KY, OR, CT, OK, IA, AR, MS, KS, UT, NV, NM, WV, HI, ID, NH, ME, RI, MT, DE, SD, ND, AK, VT, WY, DC

#### 1.2 State Election Offices (Direct Access)

**Coverage**: All 50 states + DC
**Geographic Level**: Varies (precinct, county, district)
**Data Type**: Official voter registration files
**Cost**: Free to $10,000+ per state (varies widely)
**Format**: CSV, Excel, PDF, APIs (rare)
**Update Frequency**: Monthly to annually

**Advantages**:
- Official, authoritative data
- Most up-to-date information
- Direct from source

**Limitations**:
- Inconsistent formats across states
- Varying costs (some states charge high fees)
- Different geographic granularity
- Some states require formal requests
- Privacy restrictions in some states

**Implementation Strategy**:

**Phase 1: Identify State Data Sources**
- Catalog all 50 states + DC election offices
- Document data availability, format, cost, and access method
- Prioritize states with free/cheap precinct-level data

**Phase 2: Automated Data Collection**
- Build state-specific data loaders
- Create parsers for common formats (CSV, Excel, PDF)
- Implement request automation for states requiring formal requests
- Cache downloaded data

**Phase 3: Spatial Mapping**
- For precinct-level data: Map precincts to census tracts
- For county-level data: Allocate proportionally to tracts
- Use population-weighted allocation for accuracy

**State Categories**:

**Category A: Free Precinct-Level Data** (~20-25 states)
- Examples: CA, NY, FL, TX, IL, PA, OH, MI, GA, NC
- Strategy: Direct download and processing

**Category B: Free County-Level Data** (~15-20 states)
- Examples: Many Midwestern and Western states
- Strategy: Proportional allocation to tracts

**Category C: Fee-Based Data** (~5-10 states)
- Examples: Some states charge $100-$10,000+
- Strategy: Evaluate cost vs. value, use alternatives if too expensive

**Category D: Restricted/Limited Data** (~3-5 states)
- Examples: States with privacy restrictions
- Strategy: Use alternative sources (MEDSL, commercial fallback)

### Tier 2: Secondary Sources (County/State Level)

These sources provide broader geographic data and serve as fallbacks or supplements.

#### 2.1 National Neighborhood Data Archive (NaNDA)

**Coverage**: All 50 states
**Geographic Level**: County level
**Data Type**: Voter registration, turnout, partisanship (2004-2022)
**Cost**: Free (ICPSR dataset)
**Format**: CSV datasets
**Update Frequency**: Periodic updates

**Advantages**:
- Comprehensive historical coverage
- Standardized format
- Free access
- Includes partisanship indices

**Limitations**:
- County level only (requires allocation to tracts)
- Historical data (may not be current)
- Less granular than precinct data

**Implementation**:
- Use as fallback for states without precinct data
- Allocate county data to tracts using population weights
- Supplement with more recent state data when available

#### 2.2 USAFacts

**Coverage**: All 50 states
**Geographic Level**: State level only
**Data Type**: Voter registration by party (state totals)
**Cost**: Free
**Format**: Website/static data
**Update Frequency**: Periodic

**Advantages**:
- Easy to access
- State-level summaries
- Free

**Limitations**:
- State level only (too aggregated for tract-level analysis)
- Not suitable for geodistrict calculations

**Implementation**:
- Use only for validation and state-level summaries
- Not suitable for primary data source

### Tier 3: Commercial Fallback (If Needed)

If open sources are insufficient, consider commercial providers for specific states.

#### 3.1 Commercial Providers (Last Resort)

**When to Use**:
- State data is too expensive (>$5,000 per state)
- State data is unavailable or restricted
- Precinct-level data is needed but not available from free sources

**Providers to Consider**:
- L2 Political: Comprehensive coverage, may offer census tract level
- Catalist: Democratic-leaning, may have tract-level data
- TargetSmart: API-based, may support tract queries

**Cost Considerations**:
- Evaluate cost per state vs. value
- Consider annual subscription if multiple states needed
- Negotiate custom pricing for specific states

---

## Spatial Mapping Strategy

### Precinct to Census Tract Mapping

**Method**: Spatial intersection using GIS tools

**Process**:
1. Load precinct boundaries (from MEDSL or state sources)
2. Load census tract boundaries (from TIGER/Line)
3. Calculate spatial intersection for each precinct-tract pair
4. Allocate voter registration data proportionally:
   - **Area-based**: `tract_voters = precinct_voters * (intersection_area / precinct_area)`
   - **Population-based** (preferred): `tract_voters = precinct_voters * (tract_pop_in_precinct / total_precinct_pop)`

**Tools**:
- Turf.js (JavaScript) for client-side processing
- PostGIS (PostgreSQL) for server-side processing
- Python (geopandas, shapely) for batch processing

**Accuracy**:
- Population-based allocation: ~95%+ accuracy
- Area-based allocation: ~85-90% accuracy
- Depends on how well precincts align with tracts

### County to Census Tract Allocation

**Method**: Proportional allocation using population weights

**Process**:
1. Get county-level voter registration data
2. Get census tract populations within county
3. Calculate allocation:
   ```
   tract_voters = county_voters * (tract_population / county_population)
   ```
4. Apply to each party separately

**Accuracy**:
- Assumes uniform party distribution within county
- Less accurate than precinct-level (~80-85% accuracy)
- Acceptable as fallback but not ideal

### Census Block to Tract Aggregation

**Method**: Direct aggregation (if block-level data available)

**Process**:
1. Get block-level voter registration data
2. Group blocks by census tract
3. Sum voter counts for each tract
4. Calculate party percentages

**Accuracy**:
- Highest accuracy (~99%+)
- Requires block-level data (rare)

---

## Implementation Plan

### Phase 1: Data Source Inventory and Assessment (Weeks 1-2)

**Goals**:
- Catalog all available data sources for each state
- Assess data quality, granularity, and cost
- Prioritize states by data availability

**Tasks**:
1. **State-by-State Assessment**:
   - Contact all 50 state election offices
   - Document data availability, format, cost, access method
   - Test data downloads/access
   - Create state data source database

2. **MEDSL Data Evaluation**:
   - Download available precinct-level datasets
   - Assess coverage and quality
   - Identify states with good MEDSL coverage

3. **Alternative Source Research**:
   - Evaluate NaNDA county-level data
   - Research other open sources
   - Document commercial options as fallback

4. **Create Data Source Matrix**:
   - Spreadsheet/database with all states
   - Columns: State, Primary Source, Granularity, Cost, Format, Access Method, Quality Score
   - Use to prioritize implementation

**Deliverables**:
- Complete state data source inventory
- Data source matrix/spreadsheet
- Prioritized implementation list

### Phase 2: Data Collection Infrastructure (Weeks 3-4)

**Goals**:
- Build automated data collection system
- Create state-specific data loaders
- Implement data storage and caching

**Tasks**:
1. **Create Data Collection Service**:
   - `backend/services/voter-registration-loader.js`
   - State-specific loader modules
   - Unified data format converter
   - Error handling and retry logic

2. **Build State-Specific Loaders**:
   - Start with Category A states (free precinct data)
   - Create parsers for common formats (CSV, Excel, PDF)
   - Implement API clients for states with APIs
   - Build request automation for formal request states

3. **Implement Data Storage**:
   - Store raw data in Cloud Storage
   - Create normalized database schema
   - Implement caching layer
   - Version control for data updates

4. **Create Data Validation**:
   - Validate data completeness
   - Check for data quality issues
   - Verify geographic identifiers
   - Calculate coverage statistics

**Deliverables**:
- Voter registration data loader service
- State-specific loader modules (10-15 states)
- Data storage and caching infrastructure
- Data validation tools

### Phase 3: Spatial Mapping Implementation (Weeks 5-6)

**Goals**:
- Implement precinct-to-tract mapping
- Create county-to-tract allocation
- Build spatial processing pipeline

**Tasks**:
1. **Precinct Boundary Data**:
   - Download precinct boundaries from MEDSL
   - Download from state sources where available
   - Store in standardized format (GeoJSON)

2. **Spatial Intersection Service**:
   - Create `backend/services/spatial-mapper.js`
   - Implement precinct-to-tract intersection
   - Calculate population-weighted allocation
   - Handle edge cases (split precincts, overlapping boundaries)

3. **County Allocation Service**:
   - Implement county-to-tract proportional allocation
   - Use census tract population data
   - Apply to each party separately

4. **Testing and Validation**:
   - Test spatial mapping accuracy
   - Compare results with known data
   - Validate tract-level aggregations
   - Measure accuracy metrics

**Deliverables**:
- Spatial mapping service
- Precinct-to-tract mapping working
- County-to-tract allocation working
- Validation and accuracy metrics

### Phase 4: Data Processing and Aggregation (Weeks 7-8)

**Goals**:
- Process all state data
- Aggregate to census tract level
- Create unified dataset

**Tasks**:
1. **Process All States**:
   - Run data collection for all 50 states + DC
   - Apply spatial mapping where needed
   - Aggregate to census tract level
   - Validate completeness

2. **Create Unified Dataset**:
   - Standardize data format across all states
   - Create census tract-level database
   - Include metadata (source, date, quality score)
   - Generate coverage reports

3. **Data Quality Assurance**:
   - Validate tract-level data
   - Check for missing tracts
   - Verify party totals match state totals
   - Identify and fix data issues

4. **Create API Endpoints**:
   - `GET /api/voter-registration/:state` - State-level data
   - `GET /api/voter-registration/:state/tracts` - Tract-level data
   - `GET /api/voter-registration/:state/tract/:tractId` - Specific tract
   - `GET /api/voter-registration/national` - National summary

**Deliverables**:
- Complete tract-level dataset for all states
- Unified data format
- API endpoints for data access
- Data quality reports

### Phase 5: Geodistrict Integration (Weeks 9-10)

**Goals**:
- Integrate voter registration data with geodistrict algorithm
- Calculate party balance for geodistricts
- Test accuracy and completeness

**Tasks**:
1. **Geodistrict Aggregation**:
   - Aggregate tract-level party data to geodistricts
   - Calculate party percentages for each geodistrict
   - Handle edge cases (split tracts, missing data)

2. **Comparison Calculations**:
   - Calculate party balance for existing districts
   - Calculate party balance for geodistricts
   - Compare and generate metrics

3. **Testing and Validation**:
   - Test with multiple states
   - Validate party calculations
   - Compare with known district data
   - Measure accuracy

4. **UI Integration**:
   - Display party data in comparison views
   - Show party balance changes
   - Visualize party percentages

**Deliverables**:
- Geodistrict party balance calculations working
- Comparison metrics calculated
- UI displaying party data
- Validation complete

### Phase 6: Optimization and Scaling (Weeks 11-12)

**Goals**:
- Optimize data collection and processing
- Improve accuracy where possible
- Scale to handle all states efficiently

**Tasks**:
1. **Performance Optimization**:
   - Optimize spatial calculations
   - Improve data caching
   - Parallelize state processing
   - Reduce processing time

2. **Accuracy Improvements**:
   - Identify low-accuracy states
   - Improve spatial mapping for those states
   - Consider commercial data for critical states
   - Validate improvements

3. **Update Mechanisms**:
   - Create automated update pipeline
   - Schedule regular data refreshes
   - Monitor data source changes
   - Alert on data quality issues

4. **Documentation**:
   - Document data sources for each state
   - Create data quality reports
   - Write API documentation
   - Create user guides

**Deliverables**:
- Optimized data pipeline
- Improved accuracy metrics
- Automated update system
- Complete documentation

---

## Data Quality and Validation

### Quality Metrics

**Coverage**:
- Percentage of census tracts with data
- Target: >95% coverage for all states
- Identify and document missing tracts

**Accuracy**:
- Compare tract-level aggregations with known totals
- Validate against state-level summaries
- Measure spatial mapping accuracy
- Target: >90% accuracy for most districts

**Timeliness**:
- Data snapshot date
- Update frequency
- Age of data (prefer <6 months old)

**Completeness**:
- All required fields present
- No missing party categories
- Geographic identifiers valid

### Validation Methods

1. **State-Level Validation**:
   - Sum tract-level data to state totals
   - Compare with official state summaries
   - Identify discrepancies

2. **District-Level Validation**:
   - Aggregate tract data to known districts
   - Compare with official district data
   - Measure accuracy

3. **Spatial Validation**:
   - Verify precinct-to-tract mappings
   - Check for boundary alignment issues
   - Validate population-weighted allocations

4. **Cross-Reference Validation**:
   - Compare with multiple sources
   - Use election results as validation
   - Check against demographic data

### Data Quality Scoring

**Quality Score Calculation**:
```
Quality Score = (Coverage * 0.3) + (Accuracy * 0.4) + (Timeliness * 0.2) + (Completeness * 0.1)
```

**Quality Tiers**:
- **High Quality** (Score >0.9): Use directly for geodistrict calculations
- **Medium Quality** (Score 0.7-0.9): Use with caution, flag in UI
- **Low Quality** (Score <0.7): Consider alternative sources, clearly mark limitations

---

## Cost Analysis

### Open Source Approach (Recommended)

**Data Collection Costs**:
- State data requests: $0-$10,000+ (varies by state)
- Estimated average: ~$500 per state for fee-based states
- Total estimated: $5,000-$25,000 one-time setup
- Ongoing: Minimal (mostly free sources)

**Infrastructure Costs**:
- Cloud Storage: ~$50-100/month
- Compute for processing: ~$100-200/month
- Database storage: ~$50-100/month
- Total: ~$200-400/month

**Development Costs**:
- Data collection system: 2-3 weeks
- Spatial mapping: 2 weeks
- Integration: 2 weeks
- Total: ~6-7 weeks development time

**Total Estimated Cost**: $5,000-$30,000 one-time + $200-400/month

### Commercial Approach (Fallback)

**Subscription Costs**:
- L2 Political: $10,000-$50,000+/year (varies by features)
- Catalist: Similar pricing
- TargetSmart: API-based, usage pricing

**Advantages**:
- Single source for all states
- Census tract level may be available
- Less development time
- Regular updates

**Disadvantages**:
- High ongoing costs
- Vendor lock-in
- May not be more accurate than open sources

**Recommendation**: Use commercial providers only for states where open sources are insufficient or too expensive.

---

## Risk Assessment and Mitigation

### Risk 1: Incomplete Data Coverage

**Risk**: Some states may not have accessible data at required granularity.

**Mitigation**:
- Use multiple data sources (MEDSL, state offices, NaNDA)
- Implement fallback strategies (county-level allocation)
- Consider commercial data for critical states
- Clearly document data limitations

### Risk 2: Data Quality Issues

**Risk**: Data may be inaccurate, outdated, or incomplete.

**Mitigation**:
- Implement comprehensive validation
- Cross-reference multiple sources
- Use quality scoring system
- Flag low-quality data in UI
- Regular data updates

### Risk 3: Spatial Mapping Accuracy

**Risk**: Precinct-to-tract mapping may introduce errors.

**Mitigation**:
- Use population-weighted allocation (more accurate)
- Validate against known district data
- Test mapping accuracy
- Document accuracy metrics
- Consider block-level data where available

### Risk 4: State Data Access Changes

**Risk**: States may change data availability, format, or access requirements.

**Mitigation**:
- Monitor state election office websites
- Implement flexible data loaders
- Maintain relationships with state offices
- Have fallback sources ready
- Regular data source audits

### Risk 5: High Costs for Some States

**Risk**: Some states charge high fees for voter registration data.

**Mitigation**:
- Prioritize free/cheap sources
- Use alternative sources (MEDSL, NaNDA) where possible
- Negotiate bulk pricing
- Consider commercial subscription if multiple states expensive
- Document cost-benefit analysis

---

## Success Criteria

### Functional Requirements

1. ✅ Voter registration party data available for all 50 states + DC
2. ✅ Data granular enough to calculate geodistrict party balance (>90% accuracy)
3. ✅ Census tract-level data for >95% of tracts
4. ✅ Unified data format across all states
5. ✅ API endpoints for accessing data
6. ✅ Integration with geodistrict algorithm
7. ✅ Party balance calculations working for geodistricts

### Quality Requirements

1. Data accuracy >90% for most districts
2. Coverage >95% of census tracts
3. Data age <6 months for most states
4. Quality score >0.7 for all states

### Performance Requirements

1. Data collection completes in <24 hours for all states
2. Spatial mapping processes in <2 hours per state
3. API responses in <1 second
4. Geodistrict aggregation in <30 seconds per state

---

## Maintenance and Updates

### Update Schedule

**Recommended Frequency**:
- **Quarterly**: Update all state data
- **Monthly**: Update high-priority states (large states, competitive states)
- **As needed**: Update when redistricting occurs or major changes happen

### Update Process

1. **Monitor Data Sources**:
   - Check state election office websites
   - Monitor MEDSL for updates
   - Track data source changes

2. **Automated Updates**:
   - Schedule automated data collection
   - Validate new data
   - Compare with previous versions
   - Flag significant changes

3. **Manual Review**:
   - Review data quality reports
   - Investigate anomalies
   - Update data source documentation
   - Adjust processing as needed

### Data Versioning

- Version all datasets with timestamps
- Maintain historical data for trend analysis
- Document changes between versions
- Allow access to historical versions via API

---

## Appendix A: State Data Source Priority List

### Priority 1: Free Precinct-Level Data (Implement First)

1. California - Statewide Database (precinct level)
2. New York - Board of Elections (precinct/district level)
3. Florida - Division of Elections (precinct level)
4. Texas - Secretary of State (precinct level)
5. Illinois - State Board of Elections (precinct level)
6. Pennsylvania - Department of State (precinct level)
7. Ohio - Secretary of State (precinct level)
8. Michigan - Secretary of State (precinct level)
9. Georgia - Secretary of State (precinct level)
10. North Carolina - State Board of Elections (precinct level)

### Priority 2: Free County-Level Data (Implement Second)

11. Iowa - Secretary of State
12. Kansas - Secretary of State
13. Nebraska - Secretary of State
14. North Dakota - Secretary of State
15. South Dakota - Secretary of State
16. Wyoming - Secretary of State
17. Montana - Secretary of State
18. Idaho - Secretary of State
19. Utah - Lieutenant Governor
20. And others with county-level data...

### Priority 3: Fee-Based or Restricted (Evaluate Case-by-Case)

- States with fees >$1,000: Evaluate cost vs. value
- States with restrictions: Use alternative sources
- States with limited data: Use county-level allocation

---

## Appendix B: Data Format Specification

### Standardized Tract-Level Format

```json
{
  "geoid": "06037100100",
  "state": "CA",
  "stateFips": "06",
  "countyFips": "037",
  "tractFips": "100100",
  "totalVoters": 2500,
  "democraticVoters": 1200,
  "republicanVoters": 1000,
  "otherVoters": 300,
  "democraticPercent": 48.0,
  "republicanPercent": 40.0,
  "otherPercent": 12.0,
  "dataSource": "CA_Statewide_Database",
  "dataDate": "2024-10-01",
  "qualityScore": 0.95,
  "spatialMapping": {
    "method": "precinct_intersection",
    "accuracy": 0.92
  }
}
```

### API Response Format

```json
{
  "state": "CA",
  "totalTracts": 8057,
  "tractsWithData": 8020,
  "coverage": 0.995,
  "dataDate": "2024-10-01",
  "tracts": [
    {
      "geoid": "06037100100",
      "totalVoters": 2500,
      "democraticVoters": 1200,
      "republicanVoters": 1000,
      "otherVoters": 300
    }
  ]
}
```

---

## References and Resources

### Data Sources

- **MIT Election Data and Science Lab**: https://electionlab.mit.edu/data
- **National Neighborhood Data Archive**: https://www.icpsr.umich.edu/web/ICPSR/studies/38506
- **USAFacts**: https://usafacts.org/articles/how-many-voters-have-a-party-affiliation/
- **Data.gov**: https://catalog.data.gov/dataset/?q=voter+registration
- **State Election Offices**: See state-specific URLs in data source matrix

### Tools and Libraries

- **Turf.js**: Spatial analysis for JavaScript (https://turfjs.org/)
- **PostGIS**: Spatial database extension (https://postgis.net/)
- **GeoPandas**: Python geospatial data analysis (https://geopandas.org/)
- **Shapely**: Python geometric operations (https://shapely.readthedocs.io/)

### Related Documentation

- `CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md`: Comparison plan requiring this data
- [CACHING_DESIGN.md](../pages/CACHING_DESIGN.md): Caching architecture for data storage
- [GeodistrictingAlgorithmSpecification.md](https://github.com/Lacoda-Labs/gdip/blob/main/GeodistrictingAlgorithmSpecification.md): Algorithm using this data

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Author**: GeoDistricts Development Team

