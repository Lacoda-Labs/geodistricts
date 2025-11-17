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
        
        // Refresh status
        this.loadStateStatus(this.selectedState);
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
}

