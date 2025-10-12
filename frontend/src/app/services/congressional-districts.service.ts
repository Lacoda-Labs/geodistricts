import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Interface for congressional district data
export interface CongressionalDistrictData {
  state: string;
  stateName: string;
  stateFips: string;
  districtNumber: number;
  districtName: string;
  population?: number;
  area?: number;
  representative?: string;
  party?: string;
  [key: string]: any;
}

// Interface for state congressional districts summary
export interface StateCongressionalDistrictsSummary {
  state: string;
  stateName: string;
  stateFips: string;
  totalDistricts: number;
  totalPopulation?: number;
  districts: CongressionalDistrictData[];
}

// Interface for API response
export interface CongressionalDistrictsResponse {
  data: CongressionalDistrictData[];
  total: number;
  state: string;
}

@Injectable({
  providedIn: 'root'
})
export class CongressionalDistrictsService {
  private apiUrl = environment.apiUrl;
  
  // Static data for congressional districts per state (2020 census apportionment)
  private readonly CONGRESSIONAL_DISTRICTS_BY_STATE: { [key: string]: { name: string; districts: number; fips: string } } = {
    'AL': { name: 'Alabama', districts: 7, fips: '01' },
    'AK': { name: 'Alaska', districts: 1, fips: '02' },
    'AZ': { name: 'Arizona', districts: 9, fips: '04' },
    'AR': { name: 'Arkansas', districts: 4, fips: '05' },
    'CA': { name: 'California', districts: 52, fips: '06' },
    'CO': { name: 'Colorado', districts: 8, fips: '08' },
    'CT': { name: 'Connecticut', districts: 5, fips: '09' },
    'DE': { name: 'Delaware', districts: 1, fips: '10' },
    'FL': { name: 'Florida', districts: 28, fips: '12' },
    'GA': { name: 'Georgia', districts: 14, fips: '13' },
    'HI': { name: 'Hawaii', districts: 2, fips: '15' },
    'ID': { name: 'Idaho', districts: 2, fips: '16' },
    'IL': { name: 'Illinois', districts: 17, fips: '17' },
    'IN': { name: 'Indiana', districts: 9, fips: '18' },
    'IA': { name: 'Iowa', districts: 4, fips: '19' },
    'KS': { name: 'Kansas', districts: 4, fips: '20' },
    'KY': { name: 'Kentucky', districts: 6, fips: '21' },
    'LA': { name: 'Louisiana', districts: 6, fips: '22' },
    'ME': { name: 'Maine', districts: 2, fips: '23' },
    'MD': { name: 'Maryland', districts: 8, fips: '24' },
    'MA': { name: 'Massachusetts', districts: 9, fips: '25' },
    'MI': { name: 'Michigan', districts: 13, fips: '26' },
    'MN': { name: 'Minnesota', districts: 8, fips: '27' },
    'MS': { name: 'Mississippi', districts: 4, fips: '28' },
    'MO': { name: 'Missouri', districts: 8, fips: '29' },
    'MT': { name: 'Montana', districts: 2, fips: '30' },
    'NE': { name: 'Nebraska', districts: 3, fips: '31' },
    'NV': { name: 'Nevada', districts: 4, fips: '32' },
    'NH': { name: 'New Hampshire', districts: 2, fips: '33' },
    'NJ': { name: 'New Jersey', districts: 12, fips: '34' },
    'NM': { name: 'New Mexico', districts: 3, fips: '35' },
    'NY': { name: 'New York', districts: 26, fips: '36' },
    'NC': { name: 'North Carolina', districts: 14, fips: '37' },
    'ND': { name: 'North Dakota', districts: 1, fips: '38' },
    'OH': { name: 'Ohio', districts: 15, fips: '39' },
    'OK': { name: 'Oklahoma', districts: 5, fips: '40' },
    'OR': { name: 'Oregon', districts: 6, fips: '41' },
    'PA': { name: 'Pennsylvania', districts: 17, fips: '42' },
    'RI': { name: 'Rhode Island', districts: 2, fips: '44' },
    'SC': { name: 'South Carolina', districts: 7, fips: '45' },
    'SD': { name: 'South Dakota', districts: 1, fips: '46' },
    'TN': { name: 'Tennessee', districts: 9, fips: '47' },
    'TX': { name: 'Texas', districts: 38, fips: '48' },
    'UT': { name: 'Utah', districts: 4, fips: '49' },
    'VT': { name: 'Vermont', districts: 1, fips: '50' },
    'VA': { name: 'Virginia', districts: 11, fips: '51' },
    'WA': { name: 'Washington', districts: 10, fips: '53' },
    'WV': { name: 'West Virginia', districts: 2, fips: '54' },
    'WI': { name: 'Wisconsin', districts: 8, fips: '55' },
    'WY': { name: 'Wyoming', districts: 1, fips: '56' }
  };

  constructor(private http: HttpClient) {}

  /**
   * Get the total number of congressional districts for a specific state
   * @param state State abbreviation (e.g., 'CA', 'TX') or FIPS code
   * @returns Observable with the number of congressional districts
   */
  getTotalDistrictsForState(state: string): Observable<number> {
    const stateData = this.getStateData(state);
    if (!stateData) {
      return throwError(() => new Error(`State not found: ${state}`));
    }
    
    return of(stateData.districts);
  }

  /**
   * Get congressional districts summary for a specific state
   * @param state State abbreviation (e.g., 'CA', 'TX') or FIPS code
   * @returns Observable with state congressional districts summary
   */
  getStateCongressionalDistrictsSummary(state: string): Observable<StateCongressionalDistrictsSummary> {
    const stateData = this.getStateData(state);
    if (!stateData) {
      return throwError(() => new Error(`State not found: ${state}`));
    }

    // Generate district data
    const districts: CongressionalDistrictData[] = [];
    for (let i = 1; i <= stateData.districts; i++) {
      districts.push({
        state: state,
        stateName: stateData.name,
        stateFips: stateData.fips,
        districtNumber: i,
        districtName: `${stateData.name} District ${i}`
      });
    }

    const summary: StateCongressionalDistrictsSummary = {
      state: state,
      stateName: stateData.name,
      stateFips: stateData.fips,
      totalDistricts: stateData.districts,
      districts: districts
    };

    return of(summary);
  }

  /**
   * Get all states with their congressional district counts
   * @returns Observable with array of state congressional districts summaries
   */
  getAllStatesCongressionalDistricts(): Observable<StateCongressionalDistrictsSummary[]> {
    const summaries: StateCongressionalDistrictsSummary[] = [];
    
    for (const [stateAbbr, stateData] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      const districts: CongressionalDistrictData[] = [];
      for (let i = 1; i <= stateData.districts; i++) {
        districts.push({
          state: stateAbbr,
          stateName: stateData.name,
          stateFips: stateData.fips,
          districtNumber: i,
          districtName: `${stateData.name} District ${i}`
        });
      }

      summaries.push({
        state: stateAbbr,
        stateName: stateData.name,
        stateFips: stateData.fips,
        totalDistricts: stateData.districts,
        districts: districts
      });
    }

    return of(summaries);
  }

  /**
   * Get congressional districts data for a specific state (with optional population data)
   * @param state State abbreviation (e.g., 'CA', 'TX') or FIPS code
   * @param includePopulation Whether to include population data (requires API call)
   * @returns Observable with congressional districts data
   */
  getCongressionalDistrictsForState(state: string, includePopulation: boolean = false): Observable<CongressionalDistrictData[]> {
    const stateData = this.getStateData(state);
    if (!stateData) {
      return throwError(() => new Error(`State not found: ${state}`));
    }

    const districts: CongressionalDistrictData[] = [];
    for (let i = 1; i <= stateData.districts; i++) {
      districts.push({
        state: state,
        stateName: stateData.name,
        stateFips: stateData.fips,
        districtNumber: i,
        districtName: `${stateData.name} District ${i}`
      });
    }

    if (includePopulation) {
      // If population data is requested, we would need to make API calls
      // For now, return the basic data
      console.warn('Population data not yet implemented - returning basic district data');
    }

    return of(districts);
  }

  /**
   * Search for states by name or abbreviation
   * @param query Search query
   * @returns Observable with matching states
   */
  searchStates(query: string): Observable<StateCongressionalDistrictsSummary[]> {
    const searchTerm = query.toLowerCase();
    const matches: StateCongressionalDistrictsSummary[] = [];

    for (const [stateAbbr, stateData] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      if (stateAbbr.toLowerCase().includes(searchTerm) || 
          stateData.name.toLowerCase().includes(searchTerm)) {
        
        const districts: CongressionalDistrictData[] = [];
        for (let i = 1; i <= stateData.districts; i++) {
          districts.push({
            state: stateAbbr,
            stateName: stateData.name,
            stateFips: stateData.fips,
            districtNumber: i,
            districtName: `${stateData.name} District ${i}`
          });
        }

        matches.push({
          state: stateAbbr,
          stateName: stateData.name,
          stateFips: stateData.fips,
          totalDistricts: stateData.districts,
          districts: districts
        });
      }
    }

    return of(matches);
  }

  /**
   * Get total number of congressional districts across all states
   * @returns Observable with total count
   */
  getTotalCongressionalDistricts(): Observable<number> {
    const total = Object.values(this.CONGRESSIONAL_DISTRICTS_BY_STATE)
      .reduce((sum, stateData) => sum + stateData.districts, 0);
    
    return of(total);
  }

  /**
   * Get states with the most congressional districts
   * @param limit Number of states to return (default: 10)
   * @returns Observable with array of state summaries sorted by district count
   */
  getStatesWithMostDistricts(limit: number = 10): Observable<StateCongressionalDistrictsSummary[]> {
    const summaries: StateCongressionalDistrictsSummary[] = [];
    
    for (const [stateAbbr, stateData] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      const districts: CongressionalDistrictData[] = [];
      for (let i = 1; i <= stateData.districts; i++) {
        districts.push({
          state: stateAbbr,
          stateName: stateData.name,
          stateFips: stateData.fips,
          districtNumber: i,
          districtName: `${stateData.name} District ${i}`
        });
      }

      summaries.push({
        state: stateAbbr,
        stateName: stateData.name,
        stateFips: stateData.fips,
        totalDistricts: stateData.districts,
        districts: districts
      });
    }

    // Sort by district count (descending) and limit results
    summaries.sort((a, b) => b.totalDistricts - a.totalDistricts);
    return of(summaries.slice(0, limit));
  }

  /**
   * Get states with the fewest congressional districts
   * @param limit Number of states to return (default: 10)
   * @returns Observable with array of state summaries sorted by district count
   */
  getStatesWithFewestDistricts(limit: number = 10): Observable<StateCongressionalDistrictsSummary[]> {
    const summaries: StateCongressionalDistrictsSummary[] = [];
    
    for (const [stateAbbr, stateData] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      const districts: CongressionalDistrictData[] = [];
      for (let i = 1; i <= stateData.districts; i++) {
        districts.push({
          state: stateAbbr,
          stateName: stateData.name,
          stateFips: stateData.fips,
          districtNumber: i,
          districtName: `${stateData.name} District ${i}`
        });
      }

      summaries.push({
        state: stateAbbr,
        stateName: stateData.name,
        stateFips: stateData.fips,
        totalDistricts: stateData.districts,
        districts: districts
      });
    }

    // Sort by district count (ascending) and limit results
    summaries.sort((a, b) => a.totalDistricts - b.totalDistricts);
    return of(summaries.slice(0, limit));
  }

  /**
   * Helper method to get state data by abbreviation or FIPS code
   * @param state State abbreviation or FIPS code
   * @returns State data object or null if not found
   */
  private getStateData(state: string): { name: string; districts: number; fips: string } | null {
    const stateUpper = state.toUpperCase();
    
    // First try to find by state abbreviation
    if (this.CONGRESSIONAL_DISTRICTS_BY_STATE[stateUpper]) {
      return this.CONGRESSIONAL_DISTRICTS_BY_STATE[stateUpper];
    }
    
    // Then try to find by FIPS code
    for (const [abbr, data] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      if (data.fips === stateUpper) {
        return data;
      }
    }
    
    return null;
  }

  /**
   * Get state abbreviation from FIPS code
   * @param fipsCode FIPS code
   * @returns State abbreviation or null if not found
   */
  getStateAbbreviationFromFips(fipsCode: string): string | null {
    for (const [abbr, data] of Object.entries(this.CONGRESSIONAL_DISTRICTS_BY_STATE)) {
      if (data.fips === fipsCode) {
        return abbr;
      }
    }
    return null;
  }

  /**
   * Get FIPS code from state abbreviation
   * @param stateAbbr State abbreviation
   * @returns FIPS code or null if not found
   */
  getFipsFromStateAbbreviation(stateAbbr: string): string | null {
    const stateData = this.CONGRESSIONAL_DISTRICTS_BY_STATE[stateAbbr.toUpperCase()];
    return stateData ? stateData.fips : null;
  }

  /**
   * Validate if a state exists
   * @param state State abbreviation or FIPS code
   * @returns True if state exists, false otherwise
   */
  isValidState(state: string): boolean {
    return this.getStateData(state) !== null;
  }

  /**
   * Get all state abbreviations
   * @returns Array of state abbreviations
   */
  getAllStateAbbreviations(): string[] {
    return Object.keys(this.CONGRESSIONAL_DISTRICTS_BY_STATE);
  }

  /**
   * Get all FIPS codes
   * @returns Array of FIPS codes
   */
  getAllFipsCodes(): string[] {
    return Object.values(this.CONGRESSIONAL_DISTRICTS_BY_STATE).map(data => data.fips);
  }
}
