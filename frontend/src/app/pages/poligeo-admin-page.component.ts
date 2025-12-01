import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PoliGeoService, VESTDataStatus, VESTDownloadResult, PoliGeoAnalysisResult } from '../services/poligeo.service';
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
import { MatExpansionModule } from '@angular/material/expansion';
import { catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';

interface StateInfo {
  code: string;
  name: string;
  districts: number;
}

interface DistrictReport {
  district: string;
  districtType: 'congressional' | 'stateHouse' | 'stateSenate';
  tractCount: number;
  votesDem2020: number;
  votesRep2020: number;
  totalVotes2020: number;
  pctDem2020: number;
  pctRep2020: number;
  demAdvantage: number;
  partyLean: string;
}

@Component({
  selector: 'app-poligeo-admin',
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
    MatExpansionModule,
  ],
  templateUrl: './poligeo-admin-page.component.html',
  styleUrls: ['./poligeo-admin-page.component.scss'],
})
export class PoliGeoAdminPageComponent implements OnInit {
  // VEST Data Management
  vestStatus: VESTDataStatus | null = null;
  loadingVESTStatus: boolean = false;
  downloadingVEST: Set<number> = new Set();
  vestDownloadResults: { [year: number]: VESTDownloadResult } = {};

  // State Selection
  allStates: StateInfo[] = [
    { code: 'AL', name: 'Alabama', districts: 7 },
    { code: 'AK', name: 'Alaska', districts: 1 },
    { code: 'AZ', name: 'Arizona', districts: 9 },
    { code: 'AR', name: 'Arkansas', districts: 4 },
    { code: 'CA', name: 'California', districts: 52 },
    { code: 'CO', name: 'Colorado', districts: 8 },
    { code: 'CT', name: 'Connecticut', districts: 5 },
    { code: 'DE', name: 'Delaware', districts: 1 },
    { code: 'FL', name: 'Florida', districts: 28 },
    { code: 'GA', name: 'Georgia', districts: 14 },
    { code: 'HI', name: 'Hawaii', districts: 2 },
    { code: 'ID', name: 'Idaho', districts: 2 },
    { code: 'IL', name: 'Illinois', districts: 17 },
    { code: 'IN', name: 'Indiana', districts: 9 },
    { code: 'IA', name: 'Iowa', districts: 4 },
    { code: 'KS', name: 'Kansas', districts: 4 },
    { code: 'KY', name: 'Kentucky', districts: 6 },
    { code: 'LA', name: 'Louisiana', districts: 6 },
    { code: 'ME', name: 'Maine', districts: 2 },
    { code: 'MD', name: 'Maryland', districts: 8 },
    { code: 'MA', name: 'Massachusetts', districts: 9 },
    { code: 'MI', name: 'Michigan', districts: 13 },
    { code: 'MN', name: 'Minnesota', districts: 8 },
    { code: 'MS', name: 'Mississippi', districts: 4 },
    { code: 'MO', name: 'Missouri', districts: 8 },
    { code: 'MT', name: 'Montana', districts: 2 },
    { code: 'NE', name: 'Nebraska', districts: 3 },
    { code: 'NV', name: 'Nevada', districts: 4 },
    { code: 'NH', name: 'New Hampshire', districts: 2 },
    { code: 'NJ', name: 'New Jersey', districts: 12 },
    { code: 'NM', name: 'New Mexico', districts: 3 },
    { code: 'NY', name: 'New York', districts: 26 },
    { code: 'NC', name: 'North Carolina', districts: 14 },
    { code: 'ND', name: 'North Dakota', districts: 1 },
    { code: 'OH', name: 'Ohio', districts: 15 },
    { code: 'OK', name: 'Oklahoma', districts: 5 },
    { code: 'OR', name: 'Oregon', districts: 6 },
    { code: 'PA', name: 'Pennsylvania', districts: 17 },
    { code: 'RI', name: 'Rhode Island', districts: 2 },
    { code: 'SC', name: 'South Carolina', districts: 7 },
    { code: 'SD', name: 'South Dakota', districts: 1 },
    { code: 'TN', name: 'Tennessee', districts: 9 },
    { code: 'TX', name: 'Texas', districts: 38 },
    { code: 'UT', name: 'Utah', districts: 4 },
    { code: 'VT', name: 'Vermont', districts: 1 },
    { code: 'VA', name: 'Virginia', districts: 11 },
    { code: 'WA', name: 'Washington', districts: 10 },
    { code: 'WV', name: 'West Virginia', districts: 2 },
    { code: 'WI', name: 'Wisconsin', districts: 8 },
    { code: 'WY', name: 'Wyoming', districts: 1 },
  ];

  // District Reports
  selectedState: string | null = null;
  generatingReport: boolean = false;
  districtReports: DistrictReport[] = [];
  displayedColumns: string[] = ['district', 'tractCount', 'votesDem2020', 'votesRep2020', 'pctDem2020', 'pctRep2020', 'demAdvantage', 'partyLean'];
  tableDataSource = new MatTableDataSource<DistrictReport>([]);
  
  // State Summary
  stateSummary: any = null;
  loadingStateSummary: boolean = false;
  countyDisplayedColumns: string[] = ['countyName', 'totalVotes', 'votesDem', 'votesRep', 'pctDem', 'pctRep', 'demAdvantage'];
  countyDataSource = new MatTableDataSource<any>([]);

  errorMessage: string = '';

  constructor(
    private poligeoService: PoliGeoService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadVESTStatus();
  }

  /**
   * Load VEST data status
   */
  loadVESTStatus(): void {
    this.loadingVESTStatus = true;
    this.poligeoService.getVESTStatus().pipe(
      tap(status => {
        this.vestStatus = status;
        this.loadingVESTStatus = false;
      }),
      catchError(error => {
        console.error('Error loading VEST status:', error);
        this.errorMessage = `Failed to load VEST status: ${error.message}`;
        this.loadingVESTStatus = false;
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Download VEST data for a specific year
   */
  downloadVESTData(year: number, forceRefresh: boolean = false): void {
    if (this.downloadingVEST.has(year)) {
      return;
    }

    this.downloadingVEST.add(year);
    this.errorMessage = '';

    this.poligeoService.downloadVESTData(year, forceRefresh).pipe(
      tap(result => {
        this.vestDownloadResults[year] = result;
        this.downloadingVEST.delete(year);
        
        let message = '';
        if (result.status === 'success') {
          message = `VEST data for ${year} downloaded successfully`;
        } else if (result.status === 'not_available') {
          message = `VEST data for ${year} is not yet available`;
        } else {
          message = `VEST data for ${year} download failed: ${result.message || 'Unknown error'}`;
        }
        
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // Reload status
        this.loadVESTStatus();
      }),
      catchError(error => {
        console.error(`Error downloading VEST data for ${year}:`, error);
        this.errorMessage = `Failed to download VEST data for ${year}: ${error.message}`;
        this.downloadingVEST.delete(year);
        this.snackBar.open(`Error downloading VEST data: ${error.message}`, 'Close', { duration: 5000 });
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Process local VEST files for a specific year
   */
  processLocalVESTData(year: number, forceRefresh: boolean = false): void {
    if (this.downloadingVEST.has(year)) {
      return;
    }

    this.downloadingVEST.add(year);
    this.errorMessage = '';

    this.poligeoService.processLocalVESTData(year, forceRefresh).pipe(
      tap(result => {
        this.vestDownloadResults[year] = result;
        this.downloadingVEST.delete(year);
        
        let message = '';
        if (result.status === 'success') {
          message = `VEST data for ${year} processed successfully from local files`;
          if (result.dataType) {
            message += ` (${result.dataType})`;
          }
        } else if (result.status === 'not_available') {
          message = `VEST data for ${year} is not yet available`;
        } else {
          message = `VEST data for ${year} processing failed: ${result.message || 'Unknown error'}`;
        }
        
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // Reload status
        this.loadVESTStatus();
      }),
      catchError(error => {
        console.error(`Error processing local VEST data for ${year}:`, error);
        this.errorMessage = `Failed to process local VEST data for ${year}: ${error.message}`;
        this.downloadingVEST.delete(year);
        this.snackBar.open(`Error processing local VEST data: ${error.message}`, 'Close', { duration: 5000 });
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Process all local VEST files
   */
  processAllLocalVESTData(forceRefresh: boolean = false): void {
    // Process all years - the backend will handle 2024 gracefully if not available
    this.poligeoService.processLocalVESTData(undefined, forceRefresh).pipe(
      tap(result => {
        if (result.results) {
          // Show summary of all processing
          const successCount = Object.values(result.results).filter((r: any) => r.status === 'success').length;
          const notAvailableCount = Object.values(result.results).filter((r: any) => r.status === 'not_available').length;
          const errorCount = Object.values(result.results).filter((r: any) => r.status === 'error').length;
          
          let message = `Processed ${successCount} dataset(s) from local files`;
          if (notAvailableCount > 0) {
            message += `, ${notAvailableCount} not available`;
          }
          if (errorCount > 0) {
            message += `, ${errorCount} error(s)`;
          }
          
          this.snackBar.open(message, 'Close', { duration: 5000 });
        }
        // Reload status
        this.loadVESTStatus();
      }),
      catchError(error => {
        console.error('Error processing all local VEST data:', error);
        this.snackBar.open(`Error: ${error.message}`, 'Close', { duration: 5000 });
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Check if local files are available
   */
  hasLocalFiles(): boolean {
    if (!this.vestStatus?.localFiles) return false;
    return (this.vestStatus.localFiles.dataverseFiles?.length || 0) + 
           (this.vestStatus.localFiles.directFiles?.length || 0) > 0;
  }

  /**
   * Get local files list
   */
  getLocalFiles(): string[] {
    if (!this.vestStatus?.localFiles) return [];
    return [
      ...(this.vestStatus.localFiles.dataverseFiles || []),
      ...(this.vestStatus.localFiles.directFiles || [])
    ];
  }

  /**
   * Get local files count
   */
  getLocalFilesCount(): number {
    return this.getLocalFiles().length;
  }

  /**
   * Download all available VEST data
   */
  downloadAllVESTData(forceRefresh: boolean = false): void {
    // Download all years - the backend will handle 2024 gracefully if not available
    this.poligeoService.downloadVESTData(undefined, forceRefresh).pipe(
      tap(result => {
        if (result.results) {
          // Show summary of all downloads
          const successCount = Object.values(result.results).filter((r: any) => r.status === 'success').length;
          const notAvailableCount = Object.values(result.results).filter((r: any) => r.status === 'not_available').length;
          const errorCount = Object.values(result.results).filter((r: any) => r.status === 'error').length;
          
          let message = `Downloaded ${successCount} dataset(s)`;
          if (notAvailableCount > 0) {
            message += `, ${notAvailableCount} not available`;
          }
          if (errorCount > 0) {
            message += `, ${errorCount} error(s)`;
          }
          
          this.snackBar.open(message, 'Close', { duration: 5000 });
        }
        // Reload status
        this.loadVESTStatus();
      }),
      catchError(error => {
        console.error('Error downloading all VEST data:', error);
        this.snackBar.open(`Error: ${error.message}`, 'Close', { duration: 5000 });
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Check if VEST data is available for a year
   */
  isVESTAvailable(year: number): boolean {
    return this.vestStatus?.availableYears.includes(year) || false;
  }

  /**
   * Check if VEST data is downloading
   */
  isVESTDownloading(year: number): boolean {
    return this.downloadingVEST.has(year);
  }

  /**
   * Get state name
   */
  getStateName(code: string | null): string {
    if (!code) {
      return '';
    }
    const state = this.allStates.find(s => s.code === code);
    return state ? state.name : code;
  }

  /**
   * Handle state selection change
   */
  onStateSelected(): void {
    if (this.selectedState) {
      this.loadStateSummary();
    } else {
      this.stateSummary = null;
    }
  }

  /**
   * Load state summary from VEST data
   */
  loadStateSummary(): void {
    if (!this.selectedState) {
      return;
    }

    // Check if VEST data is available
    if (!this.isVESTAvailable(2020)) {
      this.stateSummary = null;
      return;
    }

    this.loadingStateSummary = true;
    this.poligeoService.getStateSummary(this.selectedState, 2020).pipe(
      tap(summary => {
        this.stateSummary = summary;
        // Update county table data source
        if (summary.counties) {
          this.countyDataSource.data = summary.counties.map((c: any) => ({
            ...c,
            demAdvantage: parseFloat(c.pctDem) - parseFloat(c.pctRep)
          }));
        }
        this.loadingStateSummary = false;
      }),
      catchError(error => {
        console.error('Error loading state summary:', error);
        this.loadingStateSummary = false;
        // Don't show error if VEST data isn't processed yet
        if (!error.message.includes('not available')) {
          this.snackBar.open(`Could not load state summary: ${error.message}`, 'Close', { duration: 3000 });
        }
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Generate district report for selected state
   * This is a placeholder - will be implemented to fetch actual district boundaries
   * and analyze them using VEST data
   */
  generateDistrictReport(): void {
    if (!this.selectedState) {
      this.snackBar.open('Please select a state first', 'Close', { duration: 3000 });
      return;
    }

    this.generatingReport = true;
    this.errorMessage = '';
    this.districtReports = [];

    // TODO: Implement actual district boundary fetching and analysis
    // For now, show placeholder message
    setTimeout(() => {
      this.generatingReport = false;
      this.snackBar.open(
        'District report generation not yet implemented. This will analyze existing congressional districts using VEST data.',
        'Close',
        { duration: 5000 }
      );
    }, 1000);
  }

  /**
   * Format number with commas
   */
  formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * Format percentage
   */
  formatPercent(num: number): string {
    return `${num.toFixed(1)}%`;
  }
}

