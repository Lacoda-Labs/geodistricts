import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError, switchMap, mergeMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Census API Configuration
const CENSUS_API_BASE = 'https://api.census.gov/data';
const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
// Alternative data source that doesn't have CORS issues
const ALTERNATIVE_TIGERWEB = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0';
const ACS_YEAR = '2022'; // Most recent ACS 5-year estimates
const ACS_DATASET = 'acs/acs5';

// TypeScript interfaces for census data
export interface CensusTractData {
  state: string;
  county: string;
  tract: string;
  name: string;
  population?: number;
  medianHouseholdIncome?: number;
  medianAge?: number;
  povertyRate?: number;
  educationLevel?: number;
  [key: string]: any; // Allow for additional dynamic properties
}

export type CensusApiResponse = string[][];

export interface CensusQueryParams {
  state?: string;
  county?: string;
  tract?: string;
  variables?: string[];
  year?: string;
  dataset?: string;
}

export interface CensusVariable {
  code: string;
  label: string;
  concept: string;
  predicateType: string;
  group: string;
  limit: number;
  attributes: string;
  predicateOnly: boolean;
}

export interface GeoJsonFeature {
  type: 'Feature';
  properties: {
    STATE?: string;
    COUNTY?: string;
    TRACT?: string;
    STATE_FIPS?: string;
    COUNTY_FIPS?: string;
    TRACT_FIPS?: string;
    STATE_ABBR?: string;
    NAME?: string;
    POPULATION?: number;
    SQMI?: number;
    ALAND?: number;
    AWATER?: number;
    [key: string]: any;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
}

export interface GeoJsonResponse {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface TractDivisionOptions {
  ratio?: [number, number]; // Default [50, 50] for 50/50 split
  direction?: 'latitude' | 'longitude' | 'population'; // Default 'latitude'
}

export interface TractDivisionResult {
  northTracts: GeoJsonFeature[];
  southTracts: GeoJsonFeature[];
  eastTracts: GeoJsonFeature[];
  westTracts: GeoJsonFeature[];
  divisionLine: number; // The coordinate value where the division occurs (or population threshold)
  divisionType: 'latitude' | 'longitude' | 'population';
  totalPopulation: number;
  northPopulation: number;
  southPopulation: number;
  eastPopulation: number;
  westPopulation: number;
}

export interface District {
  id: number;
  tracts: GeoJsonFeature[];
  population: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centroid: {
    lat: number;
    lng: number;
  };
}

export interface RecursiveDivisionOptions {
  targetDistricts: number;
  maxIterations?: number;
  populationTolerance?: number; // Percentage tolerance for population balance
}

export interface DivisionStep {
  step: number;
  level: number;
  groups: Array<{
    id: number;
    tracts: GeoJsonFeature[];
    targetDistricts: number;
    direction: 'latitude' | 'longitude';
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
    centroid: {
      lat: number;
      lng: number;
    };
    population: number;
  }>;
  description: string;
  totalGroups: number;
  totalDistricts: number;
}

export interface RecursiveDivisionResult {
  districts: District[];
  totalPopulation: number;
  averagePopulation: number;
  populationVariance: number;
  divisionHistory: string[];
  divisionSteps: DivisionStep[];
}

@Injectable({
  providedIn: 'root'
})
export class CensusService {
  private apiKey: string = '';
  private readonly baseUrl = CENSUS_API_BASE;

  constructor(private http: HttpClient) {
    // In production, you should store this in environment variables
    // For now, we'll use a placeholder that should be configured
    this.apiKey = environment.censusApiKey || '';
  }

  /**
   * Get census tract data for a specific tract
   */
  getTractData(params: CensusQueryParams): Observable<CensusTractData[]> {
    const queryParams = this.buildQueryParams(params);

    return this.http.get<CensusApiResponse>(`${this.baseUrl}/${params.year || ACS_YEAR}/${params.dataset || ACS_DATASET}`, {
      params: queryParams
    }).pipe(
      map(response => this.transformCensusResponse(response, params)),
      catchError(this.handleError)
    );
  }

  /**
   * Get census tract data by state and county
   */
  getTractsByCounty(state: string, county: string, variables?: string[]): Observable<CensusTractData[]> {
    const defaultVariables = [
      'B01003_001E', // Total population
      'B19013_001E', // Median household income
      'B01002_001E', // Median age
      'B17001_002E', // Poverty status (below poverty level)
      'B15003_022E', // Bachelor's degree
      'B15003_023E', // Master's degree
      'B15003_024E', // Professional degree
      'B15003_025E'  // Doctorate degree
    ];

    return this.getTractData({
      state,
      county,
      variables: variables || defaultVariables,
      year: ACS_YEAR,
      dataset: ACS_DATASET
    });
  }

  /**
   * Get census tract data by tract FIPS code
   */
  getTractByFips(state: string, county: string, tract: string, variables?: string[]): Observable<CensusTractData[]> {
    const defaultVariables = [
      'B01003_001E', // Total population
      'B19013_001E', // Median household income
      'B01002_001E', // Median age
      'B17001_002E', // Poverty status
      'B15003_022E', // Bachelor's degree
      'B15003_023E', // Master's degree
      'B15003_024E', // Professional degree
      'B15003_025E'  // Doctorate degree
    ];

    return this.getTractData({
      state,
      county,
      tract,
      variables: variables || defaultVariables,
      year: ACS_YEAR,
      dataset: ACS_DATASET
    });
  }

  /**
   * Get available census variables for a dataset
   */
  getVariables(dataset: string = ACS_DATASET, year: string = ACS_YEAR): Observable<CensusVariable[]> {
    const params = new HttpParams()
      .set('get', 'NAME')
      .set('for', 'us:*')
      .set('key', this.apiKey);

    return this.http.get<CensusApiResponse>(`${this.baseUrl}/${year}/${dataset}/variables.json`, {
      params
    }).pipe(
      map(response => this.transformVariablesResponse(response)),
      catchError(this.handleError)
    );
  }

  /**
   * Search for census tracts by name or partial FIPS code
   */
  searchTracts(query: string, state?: string): Observable<CensusTractData[]> {
    // This is a simplified search - in a real implementation, you might want to
    // use a more sophisticated search or maintain a local index
    const params = new HttpParams()
      .set('get', 'NAME,B01003_001E')
      .set('for', `tract:*${state ? `&in=state:${state}` : ''}`)
      .set('key', this.apiKey);

    return this.http.get<CensusApiResponse>(`${this.baseUrl}/${ACS_YEAR}/${ACS_DATASET}`, {
      params
    }).pipe(
      map(response => this.transformCensusResponse(response, { state })),
      map(tracts => tracts.filter(tract =>
        tract.name.toLowerCase().includes(query.toLowerCase()) ||
        tract.tract.includes(query)
      )),
      catchError(this.handleError)
    );
  }

  /**
   * Get demographic summary for a census tract
   */
  getDemographicSummary(state: string, county: string, tract: string): Observable<any> {
    const demographicVariables = [
      'B01003_001E', // Total population
      'B01001_002E', // Male population
      'B01001_026E', // Female population
      'B02001_002E', // White alone
      'B02001_003E', // Black or African American alone
      'B02001_004E', // American Indian and Alaska Native alone
      'B02001_005E', // Asian alone
      'B02001_006E', // Native Hawaiian and Other Pacific Islander alone
      'B02001_007E', // Some other race alone
      'B02001_008E', // Two or more races
      'B03001_002E', // Not Hispanic or Latino
      'B03001_003E'  // Hispanic or Latino
    ];

    return this.getTractByFips(state, county, tract, demographicVariables).pipe(
      map(tracts => tracts.length > 0 ? this.calculateDemographicSummary(tracts[0]) : null)
    );
  }

  /**
   * Build query parameters for census API
   */
  private buildQueryParams(params: CensusQueryParams): HttpParams {
    let httpParams = new HttpParams();

    // Add API key if available
    if (this.apiKey) {
      httpParams = httpParams.set('key', this.apiKey);
    }

    // Add variables
    if (params.variables && params.variables.length > 0) {
      httpParams = httpParams.set('get', params.variables.join(','));
    } else {
      // Default variables
      httpParams = httpParams.set('get', 'NAME,B01003_001E,B19013_001E,B01002_001E');
    }

    // Add geography
    if (params.tract) {
      // Specific tract
      httpParams = httpParams.set('for', `tract:${params.tract}`);
      httpParams = httpParams.set('in', `state:${params.state} county:${params.county}`);
    } else if (params.county) {
      // All tracts in county
      httpParams = httpParams.set('for', 'tract:*');
      httpParams = httpParams.set('in', `state:${params.state} county:${params.county}`);
    } else if (params.state) {
      // All tracts in state
      httpParams = httpParams.set('for', 'tract:*');
      httpParams = httpParams.set('in', `state:${params.state}`);
    } else {
      // All tracts
      httpParams = httpParams.set('for', 'tract:*');
    }

    return httpParams;
  }

  /**
   * Transform census API response to our data structure
   */
  private transformCensusResponse(response: CensusApiResponse, params: CensusQueryParams): CensusTractData[] {
    console.log('Census API Response:', response);

    if (!response || response.length === 0) {
      console.log('No data in response');
      return [];
    }

    const headers = response[0];
    const dataRows = response.slice(1);

    console.log('Headers:', headers);
    console.log('Data rows count:', dataRows.length);

    return dataRows.map(row => {
      const tractData: CensusTractData = {
        state: '',
        county: '',
        tract: '',
        name: '',
        population: 0,
        medianHouseholdIncome: 0,
        medianAge: 0
      };

      // Map data based on headers
      headers.forEach((header, index) => {
        const value = row[index];

        switch (header) {
          case 'NAME':
            tractData.name = value;
            break;
          case 'B01003_001E': // Total population
            tractData.population = parseInt(value) || 0;
            break;
          case 'B19013_001E': // Median household income
            tractData.medianHouseholdIncome = parseInt(value) || 0;
            break;
          case 'B01002_001E': // Median age
            tractData.medianAge = parseFloat(value) || 0;
            break;
          case 'B17001_002E': // Poverty status
            tractData.povertyRate = parseInt(value) || 0;
            break;
          case 'B15003_022E': // Bachelor's degree
          case 'B15003_023E': // Master's degree
          case 'B15003_024E': // Professional degree
          case 'B15003_025E': // Doctorate degree
            tractData.educationLevel = (tractData.educationLevel || 0) + (parseInt(value) || 0);
            break;
          case 'state':
            tractData.state = value;
            break;
          case 'county':
            tractData.county = value;
            break;
          case 'tract':
            tractData.tract = value;
            break;
          default:
            tractData[header] = value;
        }
      });

      return tractData;
    });
  }

  /**
   * Transform variables response
   */
  private transformVariablesResponse(response: any): CensusVariable[] {
    // This would need to be implemented based on the actual API response structure
    // for variables endpoint
    return [];
  }

  /**
   * Calculate demographic summary
   */
  private calculateDemographicSummary(tractData: CensusTractData): any {
    const totalPop = tractData.population || 0;

    return {
      totalPopulation: totalPop,
      demographics: {
        male: tractData['B01001_002E'] || 0,
        female: tractData['B01001_026E'] || 0,
        white: tractData['B02001_002E'] || 0,
        black: tractData['B02001_003E'] || 0,
        asian: tractData['B02001_005E'] || 0,
        hispanic: tractData['B03001_003E'] || 0,
        other: (tractData['B02001_004E'] || 0) + (tractData['B02001_006E'] || 0) +
          (tractData['B02001_007E'] || 0) + (tractData['B02001_008E'] || 0)
      },
      percentages: {
        malePercent: totalPop > 0 ? ((tractData['B01001_002E'] || 0) / totalPop * 100).toFixed(1) : '0',
        femalePercent: totalPop > 0 ? ((tractData['B01001_026E'] || 0) / totalPop * 100).toFixed(1) : '0',
        whitePercent: totalPop > 0 ? ((tractData['B02001_002E'] || 0) / totalPop * 100).toFixed(1) : '0',
        blackPercent: totalPop > 0 ? ((tractData['B02001_003E'] || 0) / totalPop * 100).toFixed(1) : '0',
        asianPercent: totalPop > 0 ? ((tractData['B02001_005E'] || 0) / totalPop * 100).toFixed(1) : '0',
        hispanicPercent: totalPop > 0 ? ((tractData['B03001_003E'] || 0) / totalPop * 100).toFixed(1) : '0'
      }
    };
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): Observable<never> {
    console.error('Census API Error:', error);
    let errorMessage = 'An error occurred while fetching census data';

    if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return throwError(() => new Error(errorMessage));
  }

  /**
   * Set API key (for configuration)
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Get available datasets
   */
  getAvailableDatasets(): Observable<any> {
    return this.http.get(`${this.baseUrl}.json`).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get census tract boundaries from TIGERweb
   */
  getTractBoundaries(state: string, county?: string): Observable<GeoJsonResponse> {
    // Use alternative data source that doesn't have CORS issues
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;

    let whereClause = `STATE_FIPS='${state}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }

    // First, get the total count
    const countParams = new HttpParams()
      .set('where', whereClause)
      .set('outFields', 'STATE_FIPS')
      .set('f', 'geojson')
      .set('returnCountOnly', 'true');

    console.log('Getting tract count for state:', state);

    return this.http.get<GeoJsonResponse>(serviceUrl, { params: countParams }).pipe(
      switchMap((countResponse: any) => {
        const totalCount = countResponse.properties?.count || 0;
        console.log(`Total tracts for state ${state}: ${totalCount}`);

        if (totalCount === 0) {
          return new Observable<GeoJsonResponse>(observer => {
            observer.next({ type: 'FeatureCollection', features: [] });
            observer.complete();
          });
        }

        // If we have more than 2000 records, we need to use pagination
        if (totalCount > 2000) {
          console.log(`Large dataset detected (${totalCount} tracts). Using pagination...`);
          return this.getAllTractBoundariesPaginated(state, county, totalCount);
        } else {
          // Single request for smaller datasets
          return this.getSingleTractBoundariesRequest(state, county);
        }
      }),
      catchError(this.handleError)
    );
  }

  private getSingleTractBoundariesRequest(state: string, county?: string): Observable<GeoJsonResponse> {
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;

    let whereClause = `STATE_FIPS='${state}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }

    const params = new HttpParams()
      .set('where', whereClause)
      .set('outFields', 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,STATE_ABBR,POPULATION,SQMI')
      .set('f', 'geojson')
      .set('outSR', '4326')
      .set('resultRecordCount', '2000');

    console.log('Single request for tract boundaries:', {
      url: serviceUrl,
      where: whereClause
    });

    return this.http.get<GeoJsonResponse>(serviceUrl, { params }).pipe(
      catchError(this.handleError)
    );
  }

  private getAllTractBoundariesPaginated(state: string, county: string | undefined, totalCount: number): Observable<GeoJsonResponse> {
    const serviceUrl = `${ALTERNATIVE_TIGERWEB}/query`;
    const batchSize = 2000;
    const totalBatches = Math.ceil(totalCount / batchSize);

    console.log(`Fetching ${totalCount} tracts in ${totalBatches} batches of ${batchSize}`);

    let whereClause = `STATE_FIPS='${state}'`;
    if (county) {
      whereClause += ` AND COUNTY_FIPS='${county}'`;
    }

    // Create an array of batch requests
    const batchRequests: Observable<GeoJsonResponse>[] = [];

    for (let i = 0; i < totalBatches; i++) {
      const offset = i * batchSize;
      const params = new HttpParams()
        .set('where', whereClause)
        .set('outFields', 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,STATE_ABBR,POPULATION,SQMI')
        .set('f', 'geojson')
        .set('outSR', '4326')
        .set('resultRecordCount', batchSize.toString())
        .set('resultOffset', offset.toString());

      console.log(`Batch ${i + 1}/${totalBatches}: offset ${offset}, limit ${batchSize}`);

      batchRequests.push(
        this.http.get<GeoJsonResponse>(serviceUrl, { params }).pipe(
          catchError(this.handleError)
        )
      );
    }

    // Use mergeMap to combine all requests and flatten the results
    return new Observable<GeoJsonResponse>(observer => {
      let completedBatches = 0;
      let allFeatures: GeoJsonFeature[] = [];

      batchRequests.forEach((request, index) => {
        request.subscribe({
          next: (response) => {
            if (response.features) {
              allFeatures = allFeatures.concat(response.features);
              console.log(`Batch ${index + 1} completed: ${response.features.length} features`);
            }
            completedBatches++;

            if (completedBatches === totalBatches) {
              console.log(`All batches completed. Total features: ${allFeatures.length}`);
              observer.next({
                type: 'FeatureCollection',
                features: allFeatures
              });
              observer.complete();
            }
          },
          error: (error) => {
            console.error(`Batch ${index + 1} failed:`, error);
            observer.error(error);
          }
        });
      });
    });
  }


  /**
   * Get county boundaries from TIGERweb
   */
  getCountyBoundaries(state: string): Observable<GeoJsonResponse> {
    // For now, return empty response for counties to avoid CORS issues
    // In production, you'd want to implement a server-side proxy
    console.log('County boundaries temporarily disabled due to CORS issues');
    return new Observable(observer => {
      observer.next({
        type: 'FeatureCollection',
        features: []
      });
      observer.complete();
    });
  }

  /**
   * Get state boundaries from TIGERweb
   */
  getStateBoundaries(state?: string): Observable<GeoJsonResponse> {
    const serviceUrl = `${TIGERWEB_BASE}/tigerWMS_Current/MapServer/5/query`;

    let whereClause = '1=1'; // Get all states by default
    if (state) {
      whereClause = `STATE='${state}'`;
    }

    const params = new HttpParams()
      .set('where', whereClause)
      .set('outFields', 'STATE,NAME,ALAND,AWATER')
      .set('f', 'geojson')
      .set('outSR', '4326');

    return this.http.get<GeoJsonResponse>(serviceUrl, { params }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get combined tract data with boundaries
   */
  getTractDataWithBoundaries(state: string, county?: string): Observable<{
    demographic: CensusTractData[];
    boundaries: GeoJsonResponse;
  }> {
    const demographicData$ = county
      ? this.getTractsByCounty(state, county)
      : this.getTractData({ state });

    const boundaryData$ = this.getTractBoundaries(state, county);

    return new Observable(observer => {
      let demographicData: CensusTractData[] = [];
      let boundaryData: GeoJsonResponse | null = null;
      let completed = 0;

      const checkComplete = () => {
        completed++;
        if (completed === 2) {
          observer.next({
            demographic: demographicData,
            boundaries: boundaryData!
          });
          observer.complete();
        }
      };

      demographicData$.subscribe({
        next: (data) => {
          demographicData = data;
          checkComplete();
        },
        error: (error) => {
          console.warn('Failed to load demographic data:', error);
          checkComplete();
        }
      });

      boundaryData$.subscribe({
        next: (data) => {
          boundaryData = data;
          checkComplete();
        },
        error: (error) => {
          console.warn('Failed to load boundary data:', error);
          checkComplete();
        }
      });
    });
  }

  /**
   * Divide census tracts by latitude, longitude, or population according to a given ratio
   * 
   * This function takes a list of census tracts and divides them into two groups
   * based on their geographic coordinates (latitude or longitude) or population
   * according to a specified ratio. For geographic divisions, tracts are sorted by
   * their centroid coordinates. For population divisions, tracts are assigned to
   * groups to achieve the target population ratio as closely as possible.
   * 
   * @param tracts Array of GeoJSON features representing census tracts
   * @param options Division options including ratio and direction
   * @param options.ratio Array of two numbers representing the split ratio (default: [50, 50])
   * @param options.direction Either 'latitude' for north/south, 'longitude' for east/west, or 'population' for population-based division (default: 'latitude')
   * @returns Division result with tracts split into groups, population statistics, and division information
   * 
   * @example
   * // Divide tracts 60/40 by latitude (60% north, 40% south)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [40, 60],
   *   direction: 'latitude'
   * });
   * console.log(`North tracts: ${result.northTracts.length}, South tracts: ${result.southTracts.length}`);
   * 
   * @example
   * // Divide tracts 50/50 by longitude (50% east, 50% west)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [50, 50],
   *   direction: 'longitude'
   * });
   * console.log(`East tracts: ${result.eastTracts.length}, West tracts: ${result.westTracts.length}`);
   * 
   * @example
   * // Divide tracts 50/50 by population (50% of population in each group, maintaining geographic contiguity)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [50, 50],
   *   direction: 'population'
   * });
   * console.log(`North region: ${result.northPopulation.toLocaleString()} people, South region: ${result.southPopulation.toLocaleString()} people`);
   */
  divideTractsByCoordinate(tracts: GeoJsonFeature[], options: TractDivisionOptions = {}): TractDivisionResult {
    const { ratio = [50, 50], direction = 'latitude' } = options;

    if (tracts.length === 0) {
      return {
        northTracts: [],
        southTracts: [],
        eastTracts: [],
        westTracts: [],
        divisionLine: 0,
        divisionType: direction,
        totalPopulation: 0,
        northPopulation: 0,
        southPopulation: 0,
        eastPopulation: 0,
        westPopulation: 0
      };
    }

    if (direction === 'population') {
      return this.divideTractsByPopulation(tracts, ratio);
    }

    // Calculate centroids for all tracts
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract)
    }));

    // Sort tracts by the specified coordinate
    const sortedTracts = tractsWithCentroids.sort((a, b) => {
      const coordA = direction === 'latitude' ? a.centroid.lat : a.centroid.lng;
      const coordB = direction === 'latitude' ? b.centroid.lat : b.centroid.lng;
      return coordA - coordB;
    });

    // Calculate division point based on ratio
    const totalTracts = sortedTracts.length;
    const firstGroupSize = Math.round((totalTracts * ratio[0]) / (ratio[0] + ratio[1]));

    // Find the division line coordinate
    const divisionIndex = Math.max(0, Math.min(firstGroupSize - 1, totalTracts - 1));
    const divisionLine = direction === 'latitude'
      ? sortedTracts[divisionIndex].centroid.lat
      : sortedTracts[divisionIndex].centroid.lng;

    // Split tracts into groups
    const firstGroup = sortedTracts.slice(0, firstGroupSize).map(item => item.tract);
    const secondGroup = sortedTracts.slice(firstGroupSize).map(item => item.tract);

    // Calculate population totals
    const totalPopulation = this.calculateTotalPopulation(tracts);
    const firstGroupPopulation = this.calculateTotalPopulation(firstGroup);
    const secondGroupPopulation = this.calculateTotalPopulation(secondGroup);

    // Return result based on direction
    if (direction === 'latitude') {
      return {
        northTracts: secondGroup, // Higher latitude values
        southTracts: firstGroup,  // Lower latitude values
        eastTracts: [],
        westTracts: [],
        divisionLine,
        divisionType: direction,
        totalPopulation,
        northPopulation: secondGroupPopulation,
        southPopulation: firstGroupPopulation,
        eastPopulation: 0,
        westPopulation: 0
      };
    } else {
      return {
        northTracts: [],
        southTracts: [],
        eastTracts: secondGroup,  // Higher longitude values
        westTracts: firstGroup,   // Lower longitude values
        divisionLine,
        divisionType: direction,
        totalPopulation,
        northPopulation: 0,
        southPopulation: 0,
        eastPopulation: secondGroupPopulation,
        westPopulation: firstGroupPopulation
      };
    }
  }

  /**
   * Divide tracts by population with geographic contiguity
   * 
   * This method creates contiguous geographic regions while balancing population:
   * 1. First divides tracts geographically by latitude (north/south)
   * 2. Then iteratively moves tracts across the boundary to achieve the target population ratio
   * 3. Maintains geographic contiguity by only moving tracts at the boundary between regions
   * 
   * @param tracts Array of GeoJSON features representing census tracts
   * @param ratio Array of two numbers representing the population split ratio
   * @returns Division result with tracts split by population while maintaining geographic contiguity
   */
  private divideTractsByPopulation(tracts: GeoJsonFeature[], ratio: [number, number]): TractDivisionResult {
    // Calculate total population
    const totalPopulation = this.calculateTotalPopulation(tracts);

    // Calculate target population for each group
    const targetFirstGroupPopulation = (totalPopulation * ratio[0]) / (ratio[0] + ratio[1]);
    const targetSecondGroupPopulation = totalPopulation - targetFirstGroupPopulation;

    // First, divide tracts geographically by latitude to create contiguous regions
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract),
      population: this.getTractPopulation(tract)
    }));

    // Sort tracts by latitude (north to south)
    const sortedByLatitude = tractsWithCentroids.sort((a, b) => b.centroid.lat - a.centroid.lat);

    // Find the geographic division point that creates two roughly equal geographic regions
    const totalTracts = sortedByLatitude.length;
    const geographicDivisionPoint = Math.floor(totalTracts / 2);

    // Create initial geographic regions
    const northTracts = sortedByLatitude.slice(0, geographicDivisionPoint);
    const southTracts = sortedByLatitude.slice(geographicDivisionPoint);

    // Calculate current population in each geographic region
    let northPopulation = northTracts.reduce((sum, item) => sum + item.population, 0);
    let southPopulation = southTracts.reduce((sum, item) => sum + item.population, 0);

    // Now balance population between regions by moving tracts across the boundary
    // We'll move tracts from the overpopulated region to the underpopulated region
    const maxIterations = Math.min(50, totalTracts); // Prevent infinite loops
    let iterations = 0;

    while (iterations < maxIterations) {
      const northError = Math.abs(northPopulation - targetSecondGroupPopulation);
      const southError = Math.abs(southPopulation - targetFirstGroupPopulation);

      // If we're close enough to the target, stop
      if (northError < totalPopulation * 0.01 && southError < totalPopulation * 0.01) {
        break;
      }

      // Determine which region needs more population
      const northNeedsMore = northPopulation < targetSecondGroupPopulation;
      const southNeedsMore = southPopulation < targetFirstGroupPopulation;

      if (northNeedsMore && southTracts.length > 0) {
        // Move a tract from south to north
        // Find the northernmost tract in the south region (closest to the boundary)
        const tractToMove = southTracts.shift()!; // Take from the beginning (northernmost in south)
        northTracts.push(tractToMove); // Add to the end (southernmost in north)
        northPopulation += tractToMove.population;
        southPopulation -= tractToMove.population;
      } else if (southNeedsMore && northTracts.length > 0) {
        // Move a tract from north to south
        // Find the southernmost tract in the north region (closest to the boundary)
        const tractToMove = northTracts.pop()!; // Take from the end (southernmost in north)
        southTracts.unshift(tractToMove); // Add to the beginning (northernmost in south)
        southPopulation += tractToMove.population;
        northPopulation -= tractToMove.population;
      } else {
        // No more tracts to move or we're close enough
        break;
      }

      iterations++;
    }

    // Sort the final regions by latitude to maintain geographic order
    northTracts.sort((a, b) => b.centroid.lat - a.centroid.lat);
    southTracts.sort((a, b) => b.centroid.lat - a.centroid.lat);

    // Calculate the actual population ratio achieved
    const actualRatio = southPopulation / (northPopulation + southPopulation);

    // Find the division line (latitude of the boundary between regions)
    const divisionLine = southTracts.length > 0 && northTracts.length > 0
      ? (northTracts[northTracts.length - 1].centroid.lat + southTracts[0].centroid.lat) / 2
      : 0;

    return {
      northTracts: northTracts.map(item => item.tract), // Higher latitude region
      southTracts: southTracts.map(item => item.tract), // Lower latitude region
      eastTracts: [],
      westTracts: [],
      divisionLine,
      divisionType: 'population',
      totalPopulation,
      northPopulation,
      southPopulation,
      eastPopulation: 0,
      westPopulation: 0
    };
  }

  /**
   * Calculate the total population of a list of tracts
   * @param tracts Array of GeoJSON features
   * @returns Total population
   */
  private calculateTotalPopulation(tracts: GeoJsonFeature[]): number {
    return tracts.reduce((total, tract) => total + this.getTractPopulation(tract), 0);
  }

  /**
   * Get the population of a single tract
   * @param tract GeoJSON feature representing a census tract
   * @returns Population count
   */
  private getTractPopulation(tract: GeoJsonFeature): number {
    return tract.properties?.POPULATION || 0;
  }

  /**
   * Calculate the centroid (center point) of a census tract from its GeoJSON geometry
   * @param tract GeoJSON feature representing a census tract
   * @returns Object with lat and lng coordinates
   */
  private calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    const coordinates = this.extractAllCoordinates(tract.geometry);

    if (coordinates.length === 0) {
      return { lat: 0, lng: 0 };
    }

    // Calculate the centroid using the arithmetic mean of all coordinates
    let totalLat = 0;
    let totalLng = 0;

    coordinates.forEach(coord => {
      totalLng += coord[0]; // longitude
      totalLat += coord[1]; // latitude
    });

    return {
      lat: totalLat / coordinates.length,
      lng: totalLng / coordinates.length
    };
  }

  /**
   * Extract all coordinate pairs from a GeoJSON geometry
   * @param geometry GeoJSON geometry object
   * @returns Array of coordinate pairs [lng, lat]
   */
  private extractAllCoordinates(geometry: any): number[][] {
    const coordinates: number[][] = [];

    if (!geometry || !geometry.coordinates) {
      return coordinates;
    }

    const extractFromArray = (coordArray: any): void => {
      if (Array.isArray(coordArray)) {
        if (coordArray.length === 2 && typeof coordArray[0] === 'number' && typeof coordArray[1] === 'number') {
          // This is a coordinate pair [lng, lat]
          coordinates.push([coordArray[0], coordArray[1]]);
        } else {
          // This is an array of coordinates or nested arrays
          coordArray.forEach(extractFromArray);
        }
      }
    };

    if (geometry.type === 'Polygon') {
      // Polygon coordinates are an array of linear rings
      geometry.coordinates.forEach((ring: any) => {
        extractFromArray(ring);
      });
    } else if (geometry.type === 'MultiPolygon') {
      // MultiPolygon coordinates are an array of polygons
      geometry.coordinates.forEach((polygon: any) => {
        polygon.forEach((ring: any) => {
          extractFromArray(ring);
        });
      });
    } else {
      // For other geometry types, try to extract coordinates
      extractFromArray(geometry.coordinates);
    }

    return coordinates;
  }

  /**
   * Convenience method to divide tracts by coordinate with automatic data loading
   * @param state State FIPS code
   * @param county Optional county FIPS code
   * @param options Division options
   * @returns Observable with division result
   */
  divideTractsByCoordinateWithData(state: string, county?: string, options: TractDivisionOptions = {}): Observable<TractDivisionResult> {
    return this.getTractBoundaries(state, county).pipe(
      map(geojsonData => {
        if (!geojsonData || !geojsonData.features) {
          return {
            northTracts: [],
            southTracts: [],
            eastTracts: [],
            westTracts: [],
            divisionLine: 0,
            divisionType: options.direction || 'latitude',
            totalPopulation: 0,
            northPopulation: 0,
            southPopulation: 0,
            eastPopulation: 0,
            westPopulation: 0
          };
        }

        return this.divideTractsByCoordinate(geojsonData.features, options);
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Recursively divide census tracts into a specified number of districts
   * Alternates between latitude and longitude divisions while maintaining population balance
   * @param tracts Array of GeoJSON features representing census tracts
   * @param options Division options including target number of districts
   * @returns Result with array of districts and statistics
   */
  divideTractsIntoDistricts(tracts: GeoJsonFeature[], options: RecursiveDivisionOptions): RecursiveDivisionResult {
    const { targetDistricts, maxIterations = 100, populationTolerance = 0.01 } = options;

    if (tracts.length === 0 || targetDistricts <= 0) {
      return {
        districts: [],
        totalPopulation: 0,
        averagePopulation: 0,
        populationVariance: 0,
        divisionHistory: [],
        divisionSteps: []
      };
    }

    if (targetDistricts === 1) {
      // Single district - return all tracts as one district
      const district = this.createDistrict(1, tracts);
      const initialStep = this.createDivisionStep(0, 0, [{
        id: 1,
        tracts: tracts,
        targetDistricts: 1,
        direction: 'latitude' as 'latitude' | 'longitude',
        bounds: district.bounds,
        centroid: district.centroid,
        population: district.population
      }], 'Single district created');
      
      return {
        districts: [district],
        totalPopulation: district.population,
        averagePopulation: district.population,
        populationVariance: 0,
        divisionHistory: ['Single district created'],
        divisionSteps: [initialStep]
      };
    }

    console.log(`Starting recursive division: ${tracts.length} tracts → ${targetDistricts} districts`);

    // Start with all tracts as a single group
    const initialGroup = {
      tracts: tracts,
      targetDistricts: targetDistricts,
      level: 0,
      direction: 'latitude' as 'latitude' | 'longitude'
    };

    const result = this.recursiveDivideGroupsWithSteps([initialGroup], 0, maxIterations, populationTolerance);
    
    // Post-process to balance populations across all districts
    const balancedDistricts = this.balanceDistrictPopulations(result.districts, populationTolerance);
    
    // Calculate final statistics
    const totalPopulation = balancedDistricts.reduce((sum, district) => sum + district.population, 0);
    const averagePopulation = totalPopulation / balancedDistricts.length;
    const populationVariance = balancedDistricts.reduce((sum, district) =>
      sum + Math.pow(district.population - averagePopulation, 2), 0) / balancedDistricts.length;

    return {
      districts: balancedDistricts,
      totalPopulation,
      averagePopulation,
      populationVariance,
      divisionHistory: [...result.divisionHistory, 'Post-processing: Population balancing applied'],
      divisionSteps: result.divisionSteps
    };
  }

  /**
   * Recursively divide groups of tracts into districts with step tracking
   * @param groups Array of groups to divide
   * @param currentLevel Current recursion level
   * @param maxIterations Maximum iterations to prevent infinite loops
   * @param populationTolerance Population balance tolerance
   * @returns Result with districts, division history, and division steps
   */
  private recursiveDivideGroupsWithSteps(
    groups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }>,
    currentLevel: number,
    maxIterations: number,
    populationTolerance: number
  ): { districts: District[], divisionHistory: string[], divisionSteps: DivisionStep[] } {

    if (currentLevel >= maxIterations) {
      console.warn(`Max iterations reached (${maxIterations}). Stopping recursion.`);
      const districts = groups.map((group, index) => this.createDistrict(index + 1, group.tracts));
      const finalStep = this.createDivisionStepFromGroups(groups, currentLevel, `Max iterations reached at level ${currentLevel}`);
      return {
        districts,
        divisionHistory: [`Max iterations reached at level ${currentLevel}`],
        divisionSteps: [finalStep]
      };
    }

    const newGroups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }> = [];
    const divisionHistory: string[] = [];
    const divisionSteps: DivisionStep[] = [];
    let stepCounter = 0;

    // Create initial step
    const initialStep = this.createDivisionStepFromGroups(groups, currentLevel, `Starting division at level ${currentLevel}`);
    divisionSteps.push(initialStep);
    stepCounter++;

    for (const group of groups) {
      if (group.targetDistricts === 1) {
        // This group becomes a single district
        newGroups.push({
          tracts: group.tracts,
          targetDistricts: 1,
          level: group.level + 1,
          direction: group.direction === 'latitude' ? 'longitude' : 'latitude'
        });
        divisionHistory.push(`Level ${group.level}: Group with ${group.tracts.length} tracts → 1 district`);
        continue;
      }

      // Calculate how to divide this group
      const division = this.calculateOptimalDivision(group.targetDistricts);
      const direction = group.direction;

      // Perform the division
      const divisionResult = this.divideTractsByCoordinate(group.tracts, {
        ratio: division.ratio,
        direction: direction
      });

      // Create new groups for the divided tracts
      const firstGroupTracts = direction === 'latitude' ? divisionResult.southTracts : divisionResult.westTracts;
      const secondGroupTracts = direction === 'latitude' ? divisionResult.northTracts : divisionResult.eastTracts;

      newGroups.push({
        tracts: firstGroupTracts,
        targetDistricts: division.first,
        level: group.level + 1,
        direction: direction === 'latitude' ? 'longitude' : 'latitude'
      });

      newGroups.push({
        tracts: secondGroupTracts,
        targetDistricts: division.second,
        level: group.level + 1,
        direction: direction === 'latitude' ? 'longitude' : 'latitude'
      });

      divisionHistory.push(
        `Level ${group.level}: ${group.tracts.length} tracts → ${division.first} + ${division.second} districts (${direction})`
      );

      // Create step for this division
      const stepDescription = `Level ${group.level}: ${group.tracts.length} tracts → ${division.first} + ${division.second} districts (${direction})`;
      const step = this.createDivisionStepFromGroups(newGroups, currentLevel + 1, stepDescription);
      divisionSteps.push(step);
      stepCounter++;
    }

    // Check if we have reached the target number of districts
    const totalTargetDistricts = newGroups.reduce((sum, group) => sum + group.targetDistricts, 0);

    if (totalTargetDistricts === newGroups.length) {
      // All groups are single districts - we're done
      const districts = newGroups.map((group, index) => this.createDistrict(index + 1, group.tracts));
      const finalStep = this.createDivisionStepFromGroups(newGroups, currentLevel + 1, 'Final districts created');
      divisionSteps.push(finalStep);
      return { districts, divisionHistory, divisionSteps };
    }

    // Continue recursion
    const recursiveResult = this.recursiveDivideGroupsWithSteps(newGroups, currentLevel + 1, maxIterations, populationTolerance);
    return {
      districts: recursiveResult.districts,
      divisionHistory: [...divisionHistory, ...recursiveResult.divisionHistory],
      divisionSteps: [...divisionSteps, ...recursiveResult.divisionSteps]
    };
  }

  /**
   * Create a division step from groups
   */
  private createDivisionStepFromGroups(
    groups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }>,
    level: number,
    description: string
  ): DivisionStep {
    const stepGroups = groups.map((group, index) => {
      const district = this.createDistrict(index + 1, group.tracts);
      return {
        id: index + 1,
        tracts: group.tracts,
        targetDistricts: group.targetDistricts,
        direction: group.direction,
        bounds: district.bounds,
        centroid: district.centroid,
        population: district.population
      };
    });

    return this.createDivisionStep(
      level,
      level,
      stepGroups,
      description
    );
  }

  /**
   * Create a division step
   */
  private createDivisionStep(
    step: number,
    level: number,
    groups: Array<{
      id: number;
      tracts: GeoJsonFeature[];
      targetDistricts: number;
      direction: 'latitude' | 'longitude';
      bounds: { north: number; south: number; east: number; west: number };
      centroid: { lat: number; lng: number };
      population: number;
    }>,
    description: string
  ): DivisionStep {
    const totalDistricts = groups.reduce((sum, group) => sum + group.targetDistricts, 0);
    
    return {
      step,
      level,
      groups,
      description,
      totalGroups: groups.length,
      totalDistricts
    };
  }

  /**
   * Calculate the optimal way to divide a number of districts
   * @param totalDistricts Total number of districts to divide
   * @returns Object with ratio and target counts for each group
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number], first: number, second: number } {
    if (totalDistricts <= 1) {
      return { ratio: [1, 0], first: 1, second: 0 };
    }

    // For even numbers, divide 50/50
    if (totalDistricts % 2 === 0) {
      const half = totalDistricts / 2;
      return { ratio: [50, 50], first: half, second: half };
    }

    // For odd numbers, divide as evenly as possible
    const first = (totalDistricts - 1) / 2;
    const second = ((totalDistricts - 1) / 2) + 1;
    const ratio: [number, number] = [Math.round((first / totalDistricts) * 100), Math.round((second / totalDistricts) * 100)];

    return { ratio, first, second };
  }

  /**
   * Balance populations across all districts by redistributing tracts
   * @param districts Array of districts to balance
   * @param tolerance Population tolerance (percentage)
   * @returns Array of balanced districts
   */
  private balanceDistrictPopulations(districts: District[], tolerance: number): District[] {
    if (districts.length <= 1) return districts;

    console.log('Starting population balancing across districts...');
    
    // Calculate target population per district
    const totalPopulation = districts.reduce((sum, district) => sum + district.population, 0);
    const targetPopulation = totalPopulation / districts.length;
    const toleranceAmount = targetPopulation * tolerance;
    
    console.log(`Target population per district: ${targetPopulation.toLocaleString()}`);
    console.log(`Tolerance: ±${toleranceAmount.toLocaleString()} (${(tolerance * 100).toFixed(1)}%)`);

    // Create a working copy of districts
    let workingDistricts = districts.map(district => ({
      ...district,
      tracts: [...district.tracts] // Create a copy of tracts array
    }));

    const maxIterations = 2000; // Increased iterations for tighter control
    let iterations = 0;
    let improved = true;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      // Sort districts by population (ascending)
      workingDistricts.sort((a, b) => a.population - b.population);

      // Find the most overpopulated and underpopulated districts
      const overpopulatedDistricts = workingDistricts.filter(d => d.population > targetPopulation + toleranceAmount);
      const underpopulatedDistricts = workingDistricts.filter(d => d.population < targetPopulation - toleranceAmount);

      if (overpopulatedDistricts.length === 0 || underpopulatedDistricts.length === 0) {
        break; // All districts are within tolerance
      }

      // Try multiple tract movements for better balancing
      let movementsThisIteration = 0;
      const maxMovementsPerIteration = 5; // Allow multiple movements per iteration

      for (const overDistrict of overpopulatedDistricts) {
        for (const underDistrict of underpopulatedDistricts) {
          if (movementsThisIteration >= maxMovementsPerIteration) break;
          
          if (this.tryMoveTractBetweenDistricts(overDistrict, underDistrict, targetPopulation, toleranceAmount)) {
            improved = true;
            movementsThisIteration++;
          }
        }
        if (movementsThisIteration >= maxMovementsPerIteration) break;
      }

      // If no improvements this iteration, try more aggressive balancing
      if (!improved && iterations < maxIterations * 0.8) {
        improved = this.aggressivePopulationBalancing(workingDistricts, targetPopulation, toleranceAmount);
      }
    }

    console.log(`Population balancing completed after ${iterations} iterations`);
    
    // Recalculate district properties
    const balancedDistricts = workingDistricts.map(district => this.createDistrict(district.id, district.tracts));
    
    // Log final population statistics
    const finalStats = balancedDistricts.map(d => ({
      id: d.id,
      population: d.population,
      deviation: ((d.population - targetPopulation) / targetPopulation * 100).toFixed(1) + '%'
    }));
    
    console.log('Final district populations:', finalStats);
    
    return balancedDistricts;
  }

  /**
   * Try to move a tract from one district to another to improve population balance
   * @param fromDistrict Source district
   * @param toDistrict Target district
   * @param targetPopulation Target population per district
   * @param toleranceAmount Population tolerance amount
   * @returns True if a tract was moved
   */
  private tryMoveTractBetweenDistricts(
    fromDistrict: District, 
    toDistrict: District, 
    targetPopulation: number, 
    toleranceAmount: number
  ): boolean {
    if (fromDistrict.tracts.length <= 1) return false; // Don't leave a district empty

    // Find the best tract to move (closest to the boundary between districts)
    let bestTractIndex = -1;
    let bestScore = Infinity;

    for (let i = 0; i < fromDistrict.tracts.length; i++) {
      const tract = fromDistrict.tracts[i];
      const tractPopulation = this.getTractPopulation(tract);
      
      // Calculate the improvement in population balance
      const fromNewPopulation = fromDistrict.population - tractPopulation;
      const toNewPopulation = toDistrict.population + tractPopulation;
      
      const fromDeviation = Math.abs(fromNewPopulation - targetPopulation);
      const toDeviation = Math.abs(toNewPopulation - targetPopulation);
      const currentFromDeviation = Math.abs(fromDistrict.population - targetPopulation);
      const currentToDeviation = Math.abs(toDistrict.population - targetPopulation);
      
      const improvement = (currentFromDeviation + currentToDeviation) - (fromDeviation + toDeviation);
      
      if (improvement > 0) {
        // Calculate distance score (prefer tracts closer to the other district)
        const tractCentroid = this.calculateTractCentroid(tract);
        const toDistrictCentroid = toDistrict.centroid;
        const distance = Math.sqrt(
          Math.pow(tractCentroid.lat - toDistrictCentroid.lat, 2) + 
          Math.pow(tractCentroid.lng - toDistrictCentroid.lng, 2)
        );
        
        const score = distance / improvement; // Lower score is better
        
        if (score < bestScore) {
          bestScore = score;
          bestTractIndex = i;
        }
      }
    }

    if (bestTractIndex >= 0) {
      // Move the tract
      const tractToMove = fromDistrict.tracts.splice(bestTractIndex, 1)[0];
      toDistrict.tracts.push(tractToMove);
      
      // Update populations
      const tractPopulation = this.getTractPopulation(tractToMove);
      fromDistrict.population -= tractPopulation;
      toDistrict.population += tractPopulation;
      
      // Recalculate centroids and bounds
      const fromNewDistrict = this.createDistrict(fromDistrict.id, fromDistrict.tracts);
      const toNewDistrict = this.createDistrict(toDistrict.id, toDistrict.tracts);
      
      Object.assign(fromDistrict, fromNewDistrict);
      Object.assign(toDistrict, toNewDistrict);
      
      return true;
    }

    return false;
  }

  /**
   * More aggressive population balancing when standard method fails
   */
  private aggressivePopulationBalancing(
    districts: any[], 
    targetPopulation: number, 
    toleranceAmount: number
  ): boolean {
    let improved = false;

    // Find the most imbalanced districts
    const sortedDistricts = districts.sort((a, b) => 
      Math.abs(a.population - targetPopulation) - Math.abs(b.population - targetPopulation)
    );

    // Try to move tracts between the most imbalanced districts
    for (let i = 0; i < Math.min(3, sortedDistricts.length); i++) {
      for (let j = sortedDistricts.length - 1; j > sortedDistricts.length - 4 && j > i; j--) {
        const fromDistrict = sortedDistricts[j];
        const toDistrict = sortedDistricts[i];

        if (fromDistrict.population > targetPopulation && toDistrict.population < targetPopulation) {
          // Try moving multiple tracts at once
          const tractsToMove = this.findBestTractsToMove(fromDistrict, toDistrict, targetPopulation);
          
          if (tractsToMove.length > 0) {
            // Move the tracts
            tractsToMove.forEach(tract => {
              const tractIndex = fromDistrict.tracts.findIndex((t: any) => t === tract);
              if (tractIndex >= 0) {
                const movedTract = fromDistrict.tracts.splice(tractIndex, 1)[0];
                toDistrict.tracts.push(movedTract);
                
                const tractPopulation = this.getTractPopulation(movedTract);
                fromDistrict.population -= tractPopulation;
                toDistrict.population += tractPopulation;
              }
            });

            // Recalculate centroids and bounds
            const fromNewDistrict = this.createDistrict(fromDistrict.id, fromDistrict.tracts);
            const toNewDistrict = this.createDistrict(toDistrict.id, toDistrict.tracts);
            
            Object.assign(fromDistrict, fromNewDistrict);
            Object.assign(toDistrict, toNewDistrict);
            
            improved = true;
            break;
          }
        }
      }
      if (improved) break;
    }

    return improved;
  }

  /**
   * Find the best tracts to move between districts for population balancing
   */
  private findBestTractsToMove(fromDistrict: any, toDistrict: any, targetPopulation: number): any[] {
    const tractsToMove: any[] = [];
    const targetMove = Math.min(
      fromDistrict.population - targetPopulation,
      targetPopulation - toDistrict.population
    );

    if (targetMove <= 0) return tractsToMove;

    // Sort tracts by population (ascending) to find the best combination
    const sortedTracts = [...fromDistrict.tracts].sort((a, b) => 
      this.getTractPopulation(a) - this.getTractPopulation(b)
    );

    let currentMove = 0;
    for (const tract of sortedTracts) {
      const tractPopulation = this.getTractPopulation(tract);
      
      if (currentMove + tractPopulation <= targetMove && tractsToMove.length < 3) {
        tractsToMove.push(tract);
        currentMove += tractPopulation;
      }
    }

    return tractsToMove;
  }

  /**
   * Create a district object from a list of tracts
   * @param id District ID
   * @param tracts Array of tracts in the district
   * @returns District object with calculated properties
   */
  private createDistrict(id: number, tracts: GeoJsonFeature[]): District {
    if (tracts.length === 0) {
      return {
        id,
        tracts: [],
        population: 0,
        bounds: { north: 0, south: 0, east: 0, west: 0 },
        centroid: { lat: 0, lng: 0 }
      };
    }

    const population = this.calculateTotalPopulation(tracts);

    // Calculate bounds and centroid
    let north = -90, south = 90, east = -180, west = 180;
    let totalLat = 0, totalLng = 0;
    let totalPoints = 0;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
      totalPoints++;

      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    });

    return {
      id,
      tracts,
      population,
      bounds: { north, south, east, west },
      centroid: {
        lat: totalLat / totalPoints,
        lng: totalLng / totalPoints
      }
    };
  }

  /**
   * Convenience method to divide tracts into districts with automatic data loading
   * @param state State FIPS code
   * @param county Optional county FIPS code
   * @param options Division options including target number of districts
   * @returns Observable with recursive division result
   */
  divideTractsIntoDistrictsWithData(state: string, county: string | undefined, options: RecursiveDivisionOptions): Observable<RecursiveDivisionResult> {
    return this.getTractBoundaries(state, county).pipe(
      map(geojsonData => {
        if (!geojsonData || !geojsonData.features) {
          return {
            districts: [],
            totalPopulation: 0,
            averagePopulation: 0,
            populationVariance: 0,
            divisionHistory: ['No tract data available'],
            divisionSteps: []
          };
        }

        return this.divideTractsIntoDistricts(geojsonData.features, options);
      }),
      catchError(this.handleError)
    );
  }
}

