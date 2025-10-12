import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CongressionalDistrictsService, StateCongressionalDistrictsSummary, CongressionalDistrictData } from '../services/congressional-districts.service';

@Component({
  selector: 'app-congressional-districts-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="congressional-districts-viewer">
      <h2>Congressional Districts by State</h2>
      
      <!-- Search Section -->
      <div class="search-section">
        <div class="search-controls">
          <input 
            type="text" 
            [(ngModel)]="searchQuery" 
            placeholder="Search states (e.g., California, CA, 06)"
            (input)="onSearchChange()"
            class="search-input">
          <button (click)="clearSearch()" class="clear-button">Clear</button>
        </div>
      </div>

      <!-- State Selection -->
      <div class="state-selection">
        <label for="stateSelect">Select State:</label>
        <select id="stateSelect" [(ngModel)]="selectedState" (change)="onStateChange()" class="state-select">
          <option value="">Choose a state...</option>
          <option *ngFor="let state of allStates" [value]="state.state">
            {{ state.stateName }} ({{ state.state }}) - {{ state.totalDistricts }} districts
          </option>
        </select>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="loading">
        <p>Loading congressional districts data...</p>
      </div>

      <!-- Error State -->
      <div *ngIf="error" class="error">
        <p>{{ error }}</p>
      </div>

      <!-- State Summary -->
      <div *ngIf="selectedStateSummary && !loading && !error" class="state-summary">
        <h3>{{ selectedStateSummary.stateName }} Congressional Districts</h3>
        <div class="summary-stats">
          <div class="stat">
            <span class="stat-label">Total Districts:</span>
            <span class="stat-value">{{ selectedStateSummary.totalDistricts }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">State Code:</span>
            <span class="stat-value">{{ selectedStateSummary.state }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">FIPS Code:</span>
            <span class="stat-value">{{ selectedStateSummary.stateFips }}</span>
          </div>
        </div>
      </div>

      <!-- Districts List -->
      <div *ngIf="selectedStateSummary && !loading && !error" class="districts-list">
        <h4>Districts:</h4>
        <div class="districts-grid">
          <div *ngFor="let district of selectedStateSummary.districts" class="district-card">
            <div class="district-number">{{ district.districtNumber }}</div>
            <div class="district-name">{{ district.districtName }}</div>
          </div>
        </div>
      </div>

      <!-- Search Results -->
      <div *ngIf="searchResults.length > 0 && !loading && !error" class="search-results">
        <h3>Search Results ({{ searchResults.length }} states found)</h3>
        <div class="results-grid">
          <div *ngFor="let result of searchResults" class="result-card" (click)="selectStateFromSearch(result)">
            <h4>{{ result.stateName }} ({{ result.state }})</h4>
            <p>{{ result.totalDistricts }} congressional district{{ result.totalDistricts !== 1 ? 's' : '' }}</p>
            <p class="fips-code">FIPS: {{ result.stateFips }}</p>
          </div>
        </div>
      </div>

      <!-- Statistics Section -->
      <div *ngIf="!loading && !error" class="statistics-section">
        <h3>Statistics</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <h4>Total Congressional Districts</h4>
            <p class="stat-number">{{ totalDistricts }}</p>
          </div>
          <div class="stat-card">
            <h4>States with Most Districts</h4>
            <div class="top-states">
              <div *ngFor="let state of topStates" class="top-state">
                {{ state.stateName }}: {{ state.totalDistricts }}
              </div>
            </div>
          </div>
          <div class="stat-card">
            <h4>States with Fewest Districts</h4>
            <div class="bottom-states">
              <div *ngFor="let state of bottomStates" class="bottom-state">
                {{ state.stateName }}: {{ state.totalDistricts }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .congressional-districts-viewer {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      font-family: Arial, sans-serif;
    }

    h2 {
      color: #2c3e50;
      text-align: center;
      margin-bottom: 30px;
    }

    .search-section {
      margin-bottom: 20px;
    }

    .search-controls {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 16px;
    }

    .clear-button {
      padding: 10px 20px;
      background-color: #e74c3c;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .clear-button:hover {
      background-color: #c0392b;
    }

    .state-selection {
      margin-bottom: 20px;
    }

    .state-selection label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }

    .state-select {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 16px;
    }

    .loading, .error {
      text-align: center;
      padding: 20px;
      margin: 20px 0;
    }

    .error {
      background-color: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
      border-radius: 4px;
    }

    .state-summary {
      background-color: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .state-summary h3 {
      color: #2c3e50;
      margin-bottom: 15px;
    }

    .summary-stats {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .stat-label {
      font-weight: bold;
      color: #666;
    }

    .stat-value {
      font-size: 18px;
      color: #2c3e50;
    }

    .districts-list h4 {
      color: #2c3e50;
      margin-bottom: 15px;
    }

    .districts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 15px;
    }

    .district-card {
      background-color: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: transform 0.2s;
    }

    .district-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }

    .district-number {
      font-size: 24px;
      font-weight: bold;
      color: #3498db;
      margin-bottom: 5px;
    }

    .district-name {
      color: #666;
      font-size: 14px;
    }

    .search-results {
      margin-top: 20px;
    }

    .search-results h3 {
      color: #2c3e50;
      margin-bottom: 15px;
    }

    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
    }

    .result-card {
      background-color: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .result-card:hover {
      background-color: #f8f9fa;
      border-color: #3498db;
    }

    .result-card h4 {
      color: #2c3e50;
      margin-bottom: 5px;
    }

    .result-card p {
      margin: 5px 0;
      color: #666;
    }

    .fips-code {
      font-size: 12px;
      color: #999;
    }

    .statistics-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #eee;
    }

    .statistics-section h3 {
      color: #2c3e50;
      text-align: center;
      margin-bottom: 20px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .stat-card {
      background-color: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .stat-card h4 {
      color: #2c3e50;
      margin-bottom: 10px;
    }

    .stat-number {
      font-size: 32px;
      font-weight: bold;
      color: #3498db;
      margin: 0;
    }

    .top-states, .bottom-states {
      text-align: left;
    }

    .top-state, .bottom-state {
      padding: 5px 0;
      border-bottom: 1px solid #eee;
    }

    .top-state:last-child, .bottom-state:last-child {
      border-bottom: none;
    }

    @media (max-width: 768px) {
      .congressional-districts-viewer {
        padding: 10px;
      }

      .summary-stats {
        flex-direction: column;
        gap: 10px;
      }

      .districts-grid {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      }

      .results-grid {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class CongressionalDistrictsViewerComponent implements OnInit {
  allStates: StateCongressionalDistrictsSummary[] = [];
  selectedState: string = '';
  selectedStateSummary: StateCongressionalDistrictsSummary | null = null;
  searchQuery: string = '';
  searchResults: StateCongressionalDistrictsSummary[] = [];
  loading: boolean = false;
  error: string = '';
  totalDistricts: number = 0;
  topStates: StateCongressionalDistrictsSummary[] = [];
  bottomStates: StateCongressionalDistrictsSummary[] = [];

  constructor(private congressionalDistrictsService: CongressionalDistrictsService) {}

  ngOnInit(): void {
    this.loadAllStates();
    this.loadStatistics();
  }

  loadAllStates(): void {
    this.loading = true;
    this.error = '';

    this.congressionalDistrictsService.getAllStatesCongressionalDistricts().subscribe({
      next: (states) => {
        this.allStates = states;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load states data: ' + error.message;
        this.loading = false;
      }
    });
  }

  loadStatistics(): void {
    // Load total districts
    this.congressionalDistrictsService.getTotalCongressionalDistricts().subscribe({
      next: (total) => {
        this.totalDistricts = total;
      },
      error: (error) => {
        console.error('Failed to load total districts:', error);
      }
    });

    // Load top states
    this.congressionalDistrictsService.getStatesWithMostDistricts(5).subscribe({
      next: (states) => {
        this.topStates = states;
      },
      error: (error) => {
        console.error('Failed to load top states:', error);
      }
    });

    // Load bottom states
    this.congressionalDistrictsService.getStatesWithFewestDistricts(5).subscribe({
      next: (states) => {
        this.bottomStates = states;
      },
      error: (error) => {
        console.error('Failed to load bottom states:', error);
      }
    });
  }

  onStateChange(): void {
    if (!this.selectedState) {
      this.selectedStateSummary = null;
      return;
    }

    this.loading = true;
    this.error = '';

    this.congressionalDistrictsService.getStateCongressionalDistrictsSummary(this.selectedState).subscribe({
      next: (summary) => {
        this.selectedStateSummary = summary;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load state data: ' + error.message;
        this.loading = false;
      }
    });
  }

  onSearchChange(): void {
    if (!this.searchQuery.trim()) {
      this.searchResults = [];
      return;
    }

    this.congressionalDistrictsService.searchStates(this.searchQuery).subscribe({
      next: (results) => {
        this.searchResults = results;
      },
      error: (error) => {
        console.error('Search error:', error);
        this.searchResults = [];
      }
    });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
  }

  selectStateFromSearch(state: StateCongressionalDistrictsSummary): void {
    this.selectedState = state.state;
    this.selectedStateSummary = state;
    this.searchQuery = '';
    this.searchResults = [];
  }
}
