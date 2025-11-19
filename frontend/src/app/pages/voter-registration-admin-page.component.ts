import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

interface StateInfo {
  code: string;
  fips: string;
  configured: boolean;
  dataSource: any;
  loading: boolean;
}

interface VoterRegistrationStatus {
  state: string;
  loading: boolean;
  cached: boolean;
  dataSource: any;
  lastUpdated: string | null;
}

interface VoterRegistrationData {
  state: string;
  stateFips: string;
  dataSource: string;
  dataSourceUrl?: string;
  dataDate: string;
  granularity: string;
  status: string;
  data?: CountyVoterData[];
  metadata?: {
    totalCounties: number;
    totalTracts: number;
    totalVoters: number;
    democraticVoters: number;
    republicanVoters: number;
    otherVoters: number;
    coverage: number;
  };
}

interface CountyVoterData {
  county: string;
  countyName: string;
  countyFips?: string;
  stateFips?: string;
  totalVoters: number;
  democraticVoters: number;
  republicanVoters: number;
  otherVoters: number;
  democraticPercent: number;
  republicanPercent: number;
  otherPercent: number;
  libertarianVoters?: number;
  greenVoters?: number;
}

@Component({
  selector: 'app-voter-registration-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatSelectModule,
    MatFormFieldModule,
    MatChipsModule,
    MatSnackBarModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  templateUrl: './voter-registration-admin-page.component.html',
  styleUrls: ['./voter-registration-admin-page.component.scss'],
})
export class VoterRegistrationAdminPageComponent implements OnInit {
  selectedState: string = '';
  states: StateInfo[] = [];
  loadingStates: boolean = false;
  fetchingState: string | null = null;
  stateStatus: Map<string, VoterRegistrationStatus> = new Map();
  errorMessage: string = '';
  
  // Voter registration data
  voterData: VoterRegistrationData | null = null;
  loadingVoterData: boolean = false;
  displayedColumns: string[] = ['county', 'totalVoters', 'democraticVoters', 'republicanVoters', 'otherVoters', 'democraticPercent', 'republicanPercent'];
  tableDataSource = new MatTableDataSource<CountyVoterData>([]);
  
  // Algorithm execution
  runningAlgorithm: boolean = false;
  algorithmState: string | null = null;

  // US States list
  allStates = [
    { code: 'AL', name: 'Alabama' },
    { code: 'AK', name: 'Alaska' },
    { code: 'AZ', name: 'Arizona' },
    { code: 'AR', name: 'Arkansas' },
    { code: 'CA', name: 'California' },
    { code: 'CO', name: 'Colorado' },
    { code: 'CT', name: 'Connecticut' },
    { code: 'DE', name: 'Delaware' },
    { code: 'FL', name: 'Florida' },
    { code: 'GA', name: 'Georgia' },
    { code: 'HI', name: 'Hawaii' },
    { code: 'ID', name: 'Idaho' },
    { code: 'IL', name: 'Illinois' },
    { code: 'IN', name: 'Indiana' },
    { code: 'IA', name: 'Iowa' },
    { code: 'KS', name: 'Kansas' },
    { code: 'KY', name: 'Kentucky' },
    { code: 'LA', name: 'Louisiana' },
    { code: 'ME', name: 'Maine' },
    { code: 'MD', name: 'Maryland' },
    { code: 'MA', name: 'Massachusetts' },
    { code: 'MI', name: 'Michigan' },
    { code: 'MN', name: 'Minnesota' },
    { code: 'MS', name: 'Mississippi' },
    { code: 'MO', name: 'Missouri' },
    { code: 'MT', name: 'Montana' },
    { code: 'NE', name: 'Nebraska' },
    { code: 'NV', name: 'Nevada' },
    { code: 'NH', name: 'New Hampshire' },
    { code: 'NJ', name: 'New Jersey' },
    { code: 'NM', name: 'New Mexico' },
    { code: 'NY', name: 'New York' },
    { code: 'NC', name: 'North Carolina' },
    { code: 'ND', name: 'North Dakota' },
    { code: 'OH', name: 'Ohio' },
    { code: 'OK', name: 'Oklahoma' },
    { code: 'OR', name: 'Oregon' },
    { code: 'PA', name: 'Pennsylvania' },
    { code: 'RI', name: 'Rhode Island' },
    { code: 'SC', name: 'South Carolina' },
    { code: 'SD', name: 'South Dakota' },
    { code: 'TN', name: 'Tennessee' },
    { code: 'TX', name: 'Texas' },
    { code: 'UT', name: 'Utah' },
    { code: 'VT', name: 'Vermont' },
    { code: 'VA', name: 'Virginia' },
    { code: 'WA', name: 'Washington' },
    { code: 'WV', name: 'West Virginia' },
    { code: 'WI', name: 'Wisconsin' },
    { code: 'WY', name: 'Wyoming' },
    { code: 'DC', name: 'District of Columbia' }
  ];

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadStates();
  }

  /**
   * Load list of states and their status
   */
  loadStates(): void {
    this.loadingStates = true;
    this.errorMessage = '';

    this.http.get<{ states: StateInfo[]; total: number; configured: number; unconfigured: number }>(
      `${environment.apiUrl}/voter-registration/states`
    ).pipe(
      catchError(error => {
        console.error('Error loading states:', error);
        this.errorMessage = error.message || 'Failed to load states';
        this.snackBar.open('Failed to load states list', 'Close', { duration: 3000 });
        return of({ states: [], total: 0, configured: 0, unconfigured: 0 });
      })
    ).subscribe(response => {
      this.states = response.states;
      this.loadingStates = false;
      
      // Load status for all states
      this.states.forEach(state => {
        this.loadStateStatus(state.code);
      });
    });
  }

  /**
   * Load status for a specific state
   */
  loadStateStatus(stateCode: string): void {
    this.http.get<VoterRegistrationStatus>(
      `${environment.apiUrl}/voter-registration/${stateCode}/status`
    ).pipe(
      catchError(error => {
        console.error(`Error loading status for ${stateCode}:`, error);
        return of({
          state: stateCode,
          loading: false,
          cached: false,
          dataSource: null,
          lastUpdated: null
        });
      })
    ).subscribe(status => {
      this.stateStatus.set(stateCode, status);
    });
  }

  /**
   * Get state name from code
   */
  getStateName(code: string): string {
    const state = this.allStates.find(s => s.code === code);
    return state ? state.name : code;
  }

  /**
   * Get status for a state
   */
  getStateStatus(code: string): VoterRegistrationStatus | null {
    return this.stateStatus.get(code) || null;
  }

  /**
   * Check if state is loading
   */
  isStateLoading(code: string): boolean {
    const status = this.getStateStatus(code);
    return status ? status.loading : false;
  }

  /**
   * Check if state has cached data
   */
  hasCachedData(code: string): boolean {
    const status = this.getStateStatus(code);
    return status ? status.cached : false;
  }

  /**
   * Fetch voter registration data for selected state
   */
  fetchData(forceRefresh: boolean = false): void {
    if (!this.selectedState) {
      this.snackBar.open('Please select a state first', 'Close', { duration: 3000 });
      return;
    }

    this.fetchingState = this.selectedState;
    this.errorMessage = '';
    
    // Update status to show loading
    const currentStatus = this.getStateStatus(this.selectedState);
    if (currentStatus) {
      currentStatus.loading = true;
    }

    this.http.post<any>(
      `${environment.apiUrl}/voter-registration/${this.selectedState}/fetch`,
      { forceRefresh }
    ).pipe(
      tap(() => {
        // Refresh status after fetch
        setTimeout(() => {
          this.loadStateStatus(this.selectedState);
        }, 1000);
      }),
      catchError(error => {
        console.error(`Error fetching data for ${this.selectedState}:`, error);
        this.errorMessage = error.error?.message || error.message || 'Failed to fetch voter registration data';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
        
        // Update status to show not loading
        const currentStatus = this.getStateStatus(this.selectedState);
        if (currentStatus) {
          currentStatus.loading = false;
        }
        
        return of(null);
      })
    ).subscribe(response => {
      this.fetchingState = null;
      
      if (response) {
        const message = response.cached 
          ? `Data retrieved from cache for ${this.getStateName(this.selectedState)}`
          : `Successfully fetched voter registration data for ${this.getStateName(this.selectedState)}`;
        
        this.snackBar.open(message, 'Close', { duration: 3000 });
        
        // Refresh status and load data for visualization
        this.loadStateStatus(this.selectedState);
        
        // Load the data for visualization after a short delay to ensure cache is updated
        setTimeout(() => {
          this.loadVoterRegistrationData(this.selectedState);
        }, 500);
      }
    });
  }

  /**
   * Delete cached data for selected state
   */
  deleteCachedData(): void {
    if (!this.selectedState) {
      this.snackBar.open('Please select a state first', 'Close', { duration: 3000 });
      return;
    }

    if (!confirm(`Are you sure you want to delete cached data for ${this.getStateName(this.selectedState)}?`)) {
      return;
    }

    this.http.delete(`${environment.apiUrl}/voter-registration/${this.selectedState}`)
      .pipe(
        catchError(error => {
          console.error(`Error deleting data for ${this.selectedState}:`, error);
          this.snackBar.open('Failed to delete cached data', 'Close', { duration: 3000 });
          return of(null);
        })
      )
      .subscribe(response => {
        if (response) {
          this.snackBar.open(`Deleted cached data for ${this.getStateName(this.selectedState)}`, 'Close', { duration: 3000 });
          // Refresh status
          this.loadStateStatus(this.selectedState);
        }
      });
  }

  /**
   * Get configured states count
   */
  getConfiguredCount(): number {
    return this.states.filter(s => s.configured).length;
  }

  /**
   * Get states with cached data
   */
  getCachedStatesCount(): number {
    return Array.from(this.stateStatus.values()).filter(s => s.cached).length;
  }

  /**
   * Handle state selection from dropdown
   */
  onStateSelected(): void {
    if (!this.selectedState) {
      this.voterData = null;
      return;
    }

    const status = this.getStateStatus(this.selectedState);
    const stateInfo = this.states.find(s => s.code === this.selectedState);
    
    // Load data if state is configured and has cached data
    if (stateInfo?.configured && status?.cached) {
      this.loadVoterRegistrationData(this.selectedState);
    } else {
      // Clear data if state doesn't have cached data
      this.voterData = null;
    }
  }

  /**
   * Handle state item click - load data if configured and cached
   */
  onStateItemClick(stateCode: string): void {
    this.selectedState = stateCode;
    this.onStateSelected();
  }

  /**
   * Load voter registration data for a state
   */
  loadVoterRegistrationData(stateCode: string): void {
    if (!stateCode) return;

    this.loadingVoterData = true;
    this.voterData = null;

    console.log(`📥 Loading voter registration data for ${stateCode}...`);

    this.http.get<VoterRegistrationData>(
      `${environment.apiUrl}/voter-registration/${stateCode}`
    ).pipe(
      catchError(error => {
        console.error(`❌ Error loading voter data for ${stateCode}:`, error);
        this.loadingVoterData = false;
        this.snackBar.open(`Failed to load data for ${this.getStateName(stateCode)}: ${error.message}`, 'Close', { duration: 5000 });
        return of(null);
      })
    ).subscribe(response => {
      this.loadingVoterData = false;
      if (response) {
        console.log(`✅ Loaded voter data for ${stateCode}:`, response);
        
        // Handle case where backend returns array directly (the actual response format)
        if (Array.isArray(response)) {
          console.log(`📦 Response is array (${response.length} items), wrapping in VoterRegistrationData structure`);
          this.voterData = {
            state: stateCode,
            stateFips: this.getStateFipsCode(stateCode),
            dataSource: 'Arizona Secretary of State',
            dataDate: new Date().toISOString(),
            granularity: 'county',
            status: 'success',
            data: response
          };
        } else if (response.data && Array.isArray(response.data)) {
          // Standard format with data property
          console.log(`📦 Response has data property with ${response.data.length} items`);
          this.voterData = response;
        } else {
          // Try to use response as-is (might already be in correct format)
          console.log(`📦 Using response as-is, checking for data property`);
          this.voterData = response;
        }
        
        // Sort counties by name and update table
        if (this.voterData && this.voterData.data && Array.isArray(this.voterData.data)) {
          this.voterData.data.sort((a, b) => a.countyName.localeCompare(b.countyName));
          // Update table data source
          this.tableDataSource.data = this.voterData.data;
          console.log(`📊 Loaded ${this.voterData.data.length} counties`);
        } else {
          console.warn(`⚠️ No county data array found in response for ${stateCode}. Response structure:`, Object.keys(response || {}));
        }
      } else {
        console.warn(`⚠️ No data returned for ${stateCode}`);
      }
    });
  }

  /**
   * Get total voters across all counties
   */
  getTotalVoters(): number {
    if (!this.voterData || !this.voterData.data) return 0;
    return this.voterData.data.reduce((sum, county) => sum + county.totalVoters, 0);
  }

  /**
   * Get total democratic voters
   */
  getTotalDemocratic(): number {
    if (!this.voterData || !this.voterData.data) return 0;
    return this.voterData.data.reduce((sum, county) => sum + county.democraticVoters, 0);
  }

  /**
   * Get total republican voters
   */
  getTotalRepublican(): number {
    if (!this.voterData || !this.voterData.data) return 0;
    return this.voterData.data.reduce((sum, county) => sum + county.republicanVoters, 0);
  }

  /**
   * Get total other voters
   */
  getTotalOther(): number {
    if (!this.voterData || !this.voterData.data) return 0;
    return this.voterData.data.reduce((sum, county) => sum + county.otherVoters, 0);
  }

  /**
   * Get democratic percentage
   */
  getDemocraticPercent(): number {
    const total = this.getTotalVoters();
    if (total === 0) return 0;
    return (this.getTotalDemocratic() / total) * 100;
  }

  /**
   * Get republican percentage
   */
  getRepublicanPercent(): number {
    const total = this.getTotalVoters();
    if (total === 0) return 0;
    return (this.getTotalRepublican() / total) * 100;
  }

  /**
   * Get other percentage
   */
  getOtherPercent(): number {
    const total = this.getTotalVoters();
    if (total === 0) return 0;
    return (this.getTotalOther() / total) * 100;
  }

  /**
   * Format number with commas
   */
  formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  /**
   * Get state FIPS code helper
   */
  private getStateFipsCode(state: string): string {
    const fipsMap: { [key: string]: string } = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
      'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
      'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
      'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
      'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
      'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
      'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
      'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
      'DC': '11'
    };
    return fipsMap[state.toUpperCase()] || '';
  }

  /**
   * Run the geodistrict algorithm for the selected state
   */
  runAlgorithm(): void {
    if (!this.selectedState) {
      this.snackBar.open('Please select a state first', 'Close', { duration: 3000 });
      return;
    }

    if (this.runningAlgorithm) {
      this.snackBar.open('Algorithm is already running', 'Close', { duration: 3000 });
      return;
    }

    this.runningAlgorithm = true;
    this.algorithmState = this.selectedState;
    this.errorMessage = '';

    const algorithm = 'latlong'; // Default algorithm
    const maxIterations = 100;

    console.log(`🚀 Running ${algorithm} algorithm for ${this.selectedState}...`);

    this.http.post<{
      result: any;
      executionTime: number;
      cacheKey: string;
      state: string;
      totalDistricts: number;
      tractCount: number;
      cached: boolean;
    }>(
      `${environment.apiUrl}/algorithm/${algorithm}/execute`,
      {
        state: this.selectedState,
        maxIterations: maxIterations,
        options: {}
      }
    ).pipe(
      catchError(error => {
        console.error(`Error running algorithm for ${this.selectedState}:`, error);
        this.errorMessage = error.error?.message || error.message || 'Failed to run algorithm';
        this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
        this.runningAlgorithm = false;
        this.algorithmState = null;
        return of(null);
      })
    ).subscribe(response => {
      this.runningAlgorithm = false;
      this.algorithmState = null;

      if (response) {
        const executionTimeSeconds = (response.executionTime / 1000).toFixed(1);
        const message = `Algorithm completed successfully for ${this.getStateName(this.selectedState)} in ${executionTimeSeconds}s (${response.tractCount} tracts, ${response.totalDistricts} districts)`;
        this.snackBar.open(message, 'Close', { duration: 5000 });
        console.log(`✅ Algorithm completed:`, response);
      }
    });
  }
}

