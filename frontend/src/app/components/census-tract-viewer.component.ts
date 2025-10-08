import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CensusService, CensusTractData } from '../services/census.service';

@Component({
  selector: 'app-census-tract-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="census-tract-viewer">
      <h2>Census Tract Data Viewer</h2>
      
      <!-- Search Form -->
      <div class="search-form">
        <div class="form-group">
          <label for="state">State FIPS Code:</label>
          <input 
            type="text" 
            id="state" 
            [(ngModel)]="searchParams.state" 
            placeholder="e.g., 06 for California"
            maxlength="2"
          />
        </div>
        
        <div class="form-group">
          <label for="county">County FIPS Code:</label>
          <input 
            type="text" 
            id="county" 
            [(ngModel)]="searchParams.county" 
            placeholder="e.g., 037 for Los Angeles County"
            maxlength="3"
          />
        </div>
        
        <div class="form-group">
          <label for="tract">Tract FIPS Code (optional):</label>
          <input 
            type="text" 
            id="tract" 
            [(ngModel)]="searchParams.tract" 
            placeholder="e.g., 123456"
          />
        </div>
        
        <button (click)="searchTracts()" [disabled]="loading">
          {{ loading ? 'Loading...' : 'Search Tracts' }}
        </button>
      </div>

      <!-- Results -->
      <div class="results" *ngIf="tractData.length > 0">
        <h3>Found {{ tractData.length }} tract(s)</h3>
        
        <div class="tract-card" *ngFor="let tract of tractData">
          <h4>{{ tract.name }}</h4>
          <div class="tract-info">
            <div class="info-item">
              <span class="label">FIPS Code:</span>
              <span class="value">{{ tract.state }}{{ tract.county }}{{ tract.tract }}</span>
            </div>
            
            <div class="info-item" *ngIf="tract.population">
              <span class="label">Population:</span>
              <span class="value">{{ tract.population | number }}</span>
            </div>
            
            <div class="info-item" *ngIf="tract.medianAge">
              <span class="label">Median Age:</span>
              <span class="value">{{ tract.medianAge | number:'1.1-1' }} years</span>
            </div>
            
            <div class="info-item" *ngIf="tract.povertyRate">
              <span class="label">Poverty Rate:</span>
              <span class="value">{{ tract.povertyRate | number }}</span>
            </div>
            
            <div class="info-item" *ngIf="tract.educationLevel">
              <span class="label">College Educated:</span>
              <span class="value">{{ tract.educationLevel | number }}</span>
            </div>
          </div>
          
          <button (click)="getDemographicSummary(tract)" [disabled]="loading">
            Get Detailed Demographics
          </button>
        </div>
      </div>

      <!-- Demographic Summary -->
      <div class="demographic-summary" *ngIf="demographicData">
        <h3>Demographic Summary</h3>
        <div class="demographic-grid">
          <div class="demographic-item">
            <h4>Population</h4>
            <p>{{ demographicData.totalPopulation | number }}</p>
          </div>
          
          <div class="demographic-item">
            <h4>Gender Distribution</h4>
            <p>Male: {{ demographicData.percentages.malePercent }}%</p>
            <p>Female: {{ demographicData.percentages.femalePercent }}%</p>
          </div>
          
          <div class="demographic-item">
            <h4>Race/Ethnicity</h4>
            <p>White: {{ demographicData.percentages.whitePercent }}%</p>
            <p>Black: {{ demographicData.percentages.blackPercent }}%</p>
            <p>Asian: {{ demographicData.percentages.asianPercent }}%</p>
            <p>Hispanic: {{ demographicData.percentages.hispanicPercent }}%</p>
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div class="error" *ngIf="errorMessage">
        <p>{{ errorMessage }}</p>
      </div>

      <!-- Loading Indicator -->
      <div class="loading" *ngIf="loading">
        <p>Loading census data...</p>
      </div>
    </div>
  `,
  styles: [`
    .census-tract-viewer {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      font-family: Arial, sans-serif;
    }

    .search-form {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      align-items: end;
    }

    .form-group {
      display: flex;
      flex-direction: column;
    }

    .form-group label {
      margin-bottom: 5px;
      font-weight: bold;
      color: #333;
    }

    .form-group input {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    button {
      background: #007bff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      height: fit-content;
    }

    button:hover:not(:disabled) {
      background: #0056b3;
    }

    button:disabled {
      background: #6c757d;
      cursor: not-allowed;
    }

    .results {
      margin-top: 20px;
    }

    .tract-card {
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .tract-card h4 {
      margin: 0 0 15px 0;
      color: #333;
      border-bottom: 2px solid #007bff;
      padding-bottom: 5px;
    }

    .tract-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 10px;
      margin-bottom: 15px;
    }

    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
    }

    .info-item .label {
      font-weight: bold;
      color: #666;
    }

    .info-item .value {
      color: #333;
    }

    .demographic-summary {
      background: #e8f4fd;
      border: 1px solid #b8daff;
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
    }

    .demographic-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
    }

    .demographic-item h4 {
      margin: 0 0 10px 0;
      color: #004085;
    }

    .demographic-item p {
      margin: 5px 0;
      color: #333;
    }

    .error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
      border-radius: 4px;
      padding: 15px;
      margin-top: 20px;
    }

    .loading {
      text-align: center;
      padding: 20px;
      color: #666;
    }

    h2, h3 {
      color: #333;
    }
  `]
})
export class CensusTractViewerComponent implements OnInit {
  searchParams = {
    state: '',
    county: '',
    tract: ''
  };

  tractData: CensusTractData[] = [];
  demographicData: any = null;
  loading = false;
  errorMessage = '';

  constructor(private censusService: CensusService) {}

  ngOnInit() {
    // Example: Load some default data or show instructions
    this.showInstructions();
  }

  searchTracts() {
    if (!this.searchParams.state || !this.searchParams.county) {
      this.errorMessage = 'Please provide both state and county FIPS codes';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.demographicData = null;

    const searchObservable = this.searchParams.tract 
      ? this.censusService.getTractByFips(
          this.searchParams.state, 
          this.searchParams.county, 
          this.searchParams.tract
        )
      : this.censusService.getTractsByCounty(
          this.searchParams.state, 
          this.searchParams.county
        );

    searchObservable.subscribe({
      next: (data) => {
        this.tractData = data;
        this.loading = false;
        if (data.length === 0) {
          this.errorMessage = 'No census tracts found for the specified criteria';
        }
      },
      error: (error) => {
        this.errorMessage = `Error: ${error.message}`;
        this.loading = false;
        console.error('Census API Error:', error);
      }
    });
  }

  getDemographicSummary(tract: CensusTractData) {
    this.loading = true;
    this.errorMessage = '';

    this.censusService.getDemographicSummary(
      tract.state, 
      tract.county, 
      tract.tract
    ).subscribe({
      next: (data) => {
        this.demographicData = data;
        this.loading = false;
      },
      error: (error) => {
        this.errorMessage = `Error getting demographics: ${error.message}`;
        this.loading = false;
        console.error('Demographics Error:', error);
      }
    });
  }

  private showInstructions() {
    console.log(`
      Census Tract Data Viewer Instructions:
      
      1. Get a free API key from: https://api.census.gov/data/key_signup.html
      2. Add your API key to the environment files
      3. Use FIPS codes to search:
         - State: 2-digit code (e.g., 06 for California)
         - County: 3-digit code (e.g., 037 for Los Angeles County)
         - Tract: 6-digit code (optional, for specific tract)
      
      Example searches:
      - State: 06, County: 037 (All tracts in Los Angeles County, CA)
      - State: 12, County: 086, Tract: 123456 (Specific tract in Miami-Dade County, FL)
    `);
  }
}
