import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface VESTDataStatus {
  availableYears: number[];
  lastUpdated: string | Date | null;
  metadata: { [year: number]: any };
  localFiles?: {
    dataverseFiles: string[];
    directFiles: string[];
  };
}

export interface VESTDownloadResult {
  year?: number;
  status: string;
  message: string;
  metadata?: any;
  dataType?: string;
  results?: { [year: number]: { status: string; metadata?: any; message?: string; dataType?: string } };
}

export interface PoliGeoAnalysisResult {
  geodistrict_name: string;
  source_years: number[];
  tract_count: number;
  missing_tract_count?: number;
  missing_tract_coverage?: number;
  estimated_voting_age_population: number | null;
  results: {
    [year: number]: {
      votes_dem_pres: number;
      votes_rep_pres: number;
      total_pres: number;
      pct_dem_pres: number;
      pct_rep_pres: number;
      dem_advantage: string;
      coverage?: number;
    };
    trend_2016_2020?: string;
    trend_2020_2024?: string;
    recommended_proxy_party_lean: string;
  };
  comparison_to_current_representation: {
    state: string;
    currentStateHouseDelegation: string;
    currentStateSenateDelegation: string;
    currentUsHouseDistrictsOverlapping: string[];
    mismatchFlag: boolean;
    note: string;
  };
  data_last_updated: string | null;
  methodology: string;
  warnings?: string[];
  data_quality?: {
    coverage_percent: number;
    missing_tracts?: string[];
    total_missing?: number;
    spatial_method?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PoliGeoService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get VEST data status
   */
  getVESTStatus(): Observable<VESTDataStatus> {
    return this.http.get<VESTDataStatus>(`${this.apiUrl}/poligeo/vest-data/status`);
  }

  /**
   * Download VEST data for a specific year or all years from Dataverse
   */
  downloadVESTData(year?: number, forceRefresh: boolean = false): Observable<VESTDownloadResult> {
    return this.http.post<VESTDownloadResult>(`${this.apiUrl}/poligeo/vest-data/download`, {
      year,
      forceRefresh
    });
  }

  /**
   * Process locally downloaded VEST files
   */
  processLocalVESTData(year?: number, forceRefresh: boolean = false): Observable<VESTDownloadResult> {
    return this.http.post<VESTDownloadResult>(`${this.apiUrl}/poligeo/vest-data/process-local`, {
      year,
      forceRefresh
    });
  }

  /**
   * Analyze a geodistrict
   */
  analyzeGeodistrict(input: {
    input_format: 'geoid' | 'polygon' | 'district';
    input_data: any;
    geodistrict_name?: string;
    state?: string;
  }): Observable<PoliGeoAnalysisResult> {
    return this.http.post<PoliGeoAnalysisResult>(`${this.apiUrl}/poligeo/analyze`, input);
  }

  /**
   * Get state-level party data summary
   */
  getStateSummary(state: string, year: number = 2020): Observable<StateSummary> {
    return this.http.get<StateSummary>(`${this.apiUrl}/poligeo/state-summary`, {
      params: { state, year: year.toString() }
    });
  }
}

export interface StateSummary {
  state: string;
  year: number;
  totalCounties: number;
  totalVotes: number;
  votesDem: number;
  votesRep: number;
  pctDem: number;
  pctRep: number;
  demAdvantage: number;
  partyLean: string;
  partyLeanColor: string;
  counties: Array<{
    countyName: string;
    countyFips: string;
    votesDem: number;
    votesRep: number;
    totalVotes: number;
    pctDem: string;
    pctRep: string;
  }>;
}

