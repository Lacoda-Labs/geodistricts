# Census Service Documentation

This document explains how to use the Census Service to query census tract data from the US Census Bureau's public API.

## Setup

### 1. Get a Census API Key

1. Visit the [Census API Key Signup](https://api.census.gov/data/key_signup.html)
2. Fill out the form to get your free API key
3. Add your API key to the environment files:
   - `frontend/src/environments/environment.ts` (development)
   - `frontend/src/environments/environment.prod.ts` (production)

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080/api',
  censusApiKey: 'YOUR_API_KEY_HERE'
};
```

### 2. Import the Service

```typescript
import { CensusService } from './services/census.service';
```

## Usage Examples

### Basic Tract Data Query

```typescript
constructor(private censusService: CensusService) {}

// Get all tracts in a county
getTractsInCounty() {
  this.censusService.getTractsByCounty('06', '037') // California, Los Angeles County
    .subscribe({
      next: (tracts) => {
        console.log('Found tracts:', tracts);
        tracts.forEach(tract => {
          console.log(`${tract.name}: Population ${tract.population}`);
        });
      },
      error: (error) => console.error('Error:', error)
    });
}

// Get specific tract
getSpecificTract() {
  this.censusService.getTractByFips('06', '037', '123456') // Specific tract
    .subscribe({
      next: (tracts) => {
        if (tracts.length > 0) {
          const tract = tracts[0];
          console.log(`Tract ${tract.name}:`);
          console.log(`- Population: ${tract.population}`);
          console.log(`- Median Income: $${tract.medianHouseholdIncome}`);
          console.log(`- Median Age: ${tract.medianAge} years`);
        }
      },
      error: (error) => console.error('Error:', error)
    });
}
```

### Custom Variables Query

```typescript
// Query with custom variables
getCustomData() {
  const customVariables = [
    'B01003_001E', // Total population
    'B19013_001E', // Median household income
    'B25077_001E', // Median home value
    'B08301_010E'  // Public transportation
  ];

  this.censusService.getTractData({
    state: '06',
    county: '037',
    variables: customVariables
  }).subscribe({
    next: (tracts) => {
      tracts.forEach(tract => {
        console.log(`Tract: ${tract.name}`);
        console.log(`- Population: ${tract.population}`);
        console.log(`- Median Income: $${tract.medianHouseholdIncome}`);
        console.log(`- Median Home Value: $${tract['B25077_001E']}`);
        console.log(`- Public Transit Users: ${tract['B08301_010E']}`);
      });
    },
    error: (error) => console.error('Error:', error)
  });
}
```

### Demographic Summary

```typescript
getDemographics() {
  this.censusService.getDemographicSummary('06', '037', '123456')
    .subscribe({
      next: (summary) => {
        console.log('Demographic Summary:');
        console.log(`Total Population: ${summary.totalPopulation}`);
        console.log(`Gender Distribution:`);
        console.log(`- Male: ${summary.percentages.malePercent}%`);
        console.log(`- Female: ${summary.percentages.femalePercent}%`);
        console.log(`Race/Ethnicity:`);
        console.log(`- White: ${summary.percentages.whitePercent}%`);
        console.log(`- Black: ${summary.percentages.blackPercent}%`);
        console.log(`- Asian: ${summary.percentages.asianPercent}%`);
        console.log(`- Hispanic: ${summary.percentages.hispanicPercent}%`);
      },
      error: (error) => console.error('Error:', error)
    });
}
```

### Search Tracts

```typescript
searchTracts() {
  // Search by name or partial FIPS
  this.censusService.searchTracts('downtown', '06') // Search in California
    .subscribe({
      next: (tracts) => {
        console.log('Found tracts:', tracts);
      },
      error: (error) => console.error('Error:', error)
    });
}
```

## Data Structure

### CensusTractData Interface

```typescript
interface CensusTractData {
  state: string;           // 2-digit FIPS state code
  county: string;          // 3-digit FIPS county code
  tract: string;           // 6-digit FIPS tract code
  name: string;            // Tract name (e.g., "Census Tract 1234.56, Los Angeles County, California")
  population?: number;     // Total population
  medianHouseholdIncome?: number; // Median household income
  medianAge?: number;      // Median age
  povertyRate?: number;    // Number of people below poverty level
  educationLevel?: number; // Number of people with college education
  [key: string]: any;      // Additional dynamic properties from API
}
```

## Common Census Variables

### Population and Demographics
- `B01003_001E` - Total population
- `B01001_002E` - Male population
- `B01001_026E` - Female population
- `B01002_001E` - Median age

### Race and Ethnicity
- `B02001_002E` - White alone
- `B02001_003E` - Black or African American alone
- `B02001_005E` - Asian alone
- `B03001_003E` - Hispanic or Latino

### Income and Economics
- `B19013_001E` - Median household income
- `B17001_002E` - Population below poverty level
- `B25077_001E` - Median home value

### Education
- `B15003_022E` - Bachelor's degree
- `B15003_023E` - Master's degree
- `B15003_024E` - Professional degree
- `B15003_025E` - Doctorate degree

### Housing
- `B25003_001E` - Total housing units
- `B25003_002E` - Owner occupied
- `B25003_003E` - Renter occupied

## FIPS Codes Reference

### Common State Codes
- 01: Alabama
- 06: California
- 12: Florida
- 13: Georgia
- 17: Illinois
- 36: New York
- 48: Texas

### Finding County Codes
Visit the [Census FIPS Code Lookup](https://www.census.gov/geographies/reference-files/time-series/geo/county-files.html) to find county FIPS codes.

## Error Handling

The service includes comprehensive error handling:

```typescript
this.censusService.getTractsByCounty('06', '037')
  .subscribe({
    next: (data) => {
      // Handle successful response
    },
    error: (error) => {
      console.error('Census API Error:', error.message);
      // Handle error (e.g., show user-friendly message)
    }
  });
```

## Rate Limits

The Census API has rate limits:
- 500 requests per day (free tier)
- 50 requests per minute

Consider implementing caching for frequently accessed data.

## Example Component

See `census-tract-viewer.component.ts` for a complete example of how to use the service in an Angular component.

## Additional Resources

- [Census Data API Documentation](https://www.census.gov/data/developers/data-sets.html)
- [American Community Survey Variables](https://api.census.gov/data/2022/acs/acs5/variables.html)
- [FIPS Code Lookup](https://www.census.gov/geographies/reference-files/time-series/geo/county-files.html)
- [Census API User Guide](https://www.census.gov/data/developers/guidance/api-user-guide.html)
