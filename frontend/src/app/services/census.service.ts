import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
    
    // For now, let's use a simpler approach - just get the first 2000 records
    // This will work for most states and we can optimize later
    const params = new HttpParams()
      .set('where', whereClause)
      .set('outFields', 'STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,STATE_ABBR,POPULATION,SQMI')
      .set('f', 'geojson')
      .set('outSR', '4326')
      .set('resultRecordCount', '2000'); // Max records per request
    
    console.log('Getting tract boundaries for state:', state);
    console.log('Service URL:', serviceUrl);
    console.log('Where clause:', whereClause);
      
    return this.http.get<GeoJsonResponse>(serviceUrl, { params }).pipe(
      catchError(this.handleError)
    );
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
}
