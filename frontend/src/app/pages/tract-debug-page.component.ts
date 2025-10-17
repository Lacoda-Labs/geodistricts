import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CensusService, GeoJsonFeature, GeoJsonResponse } from '../services/census.service';
import { GeodistrictAlgorithmService } from '../services/geodistrict-algorithm.service';
import { VERSION_INFO } from '../../version';

declare var L: any;

@Component({
  selector: 'app-tract-debug-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tract-debug-page">
      <div class="header">
        <h1>Census Tract Adjacency Debugger</h1>
        <p>Debug census tract adjacency and sorting algorithms</p>
      </div>

      <div class="controls">
        <div class="control-group">
          <label for="stateSelect">State:</label>
          <select id="stateSelect" [(ngModel)]="selectedState" (change)="onStateChange()">
            <option value="">Select State</option>
            <option *ngFor="let state of states" [value]="state.code">
              {{ state.name }} ({{ state.districts }} districts)
            </option>
          </select>
        </div>

        <div class="control-group">
          <label for="algorithmSelect">Sorting Algorithm:</label>
          <select id="algorithmSelect" [(ngModel)]="selectedAlgorithm" (change)="onAlgorithmChange()">
            <option *ngFor="let option of algorithmOptions" [value]="option.value">
              {{ option.label }}
            </option>
          </select>
          <div class="algorithm-description">
            {{ getSelectedAlgorithmDescription() }}
          </div>
        </div>

        <div class="control-group">
          <label>
            <input type="checkbox" [(ngModel)]="useDirectAPI" (change)="onSettingsChange()">
            Use Direct Census API (development only)
          </label>
        </div>

        <div class="control-group">
          <button (click)="loadStateData()" [disabled]="isLoading || !selectedState">
            {{ isLoading ? 'Loading...' : 'Load State Data' }}
          </button>
        </div>
      </div>

      <div class="results" *ngIf="stateData">
        <div class="summary">
          <h2>State Data Summary</h2>
          <div class="stats">
            <div class="stat">
              <span class="label">Total Tracts:</span>
              <span class="value">{{ stateData.features.length }}</span>
            </div>
            <div class="stat">
              <span class="label">Total Population:</span>
              <span class="value">{{ getTotalPopulation().toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="label">Average Population per Tract:</span>
              <span class="value">{{ getAveragePopulation().toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <div class="map-section">
          <h3>State Map with Census Tracts</h3>
          <div class="map-container">
            <div id="stateMap" class="state-map"></div>
          </div>
        </div>

        <div class="tract-navigation" *ngIf="sortedTracts.length > 0">
          <h3>Tract Navigation ({{ selectedAlgorithm }} Algorithm)</h3>
          
          <div class="tract-visualization">
            <div class="tract-dots-container">
              <div *ngFor="let tract of sortedTracts; let i = index" 
                   class="tract-dot"
                   [class.selected]="i === currentTractIndex"
                   [class.adjacent]="isAdjacentTract(i)"
                   [title]="'Tract ' + (i + 1) + ': ' + getTractId(tract) + ' (Pop: ' + getTractPopulation(tract).toLocaleString() + ')'"
                   (click)="selectTract(i)">
              </div>
            </div>
          </div>

          <div class="tract-navigation-controls">
            <button (click)="previousTract()" [disabled]="currentTractIndex <= 0">
              ← Previous Tract
            </button>
            <span class="tract-info">
              Tract {{ currentTractIndex + 1 }} of {{ sortedTracts.length }}
            </span>
            <button (click)="nextTract()" [disabled]="currentTractIndex >= sortedTracts.length - 1">
              Next Tract →
            </button>
          </div>

          <div class="current-tract-info" *ngIf="getCurrentTract()">
            <h4>Selected Tract Details</h4>
            <div class="tract-details">
              <div class="tract-detail">
                <span class="label">Tract ID:</span> {{ getCurrentTract() ? getTractId(getCurrentTract()!) : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">Population:</span> {{ getCurrentTract() ? getTractPopulation(getCurrentTract()!).toLocaleString() : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">Centroid:</span>
                {{ getCurrentTract() ? '(' + getTractCentroid(getCurrentTract()!).lat.toFixed(4) + ', ' + getTractCentroid(getCurrentTract()!).lng.toFixed(4) + ')' : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">Name:</span> {{ getCurrentTract() ? getTractName(getCurrentTract()!) : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">North Boundary:</span> {{ getCurrentTract() ? getTractBounds(getCurrentTract()!).north.toFixed(4) : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">South Boundary:</span> {{ getCurrentTract() ? getTractBounds(getCurrentTract()!).south.toFixed(4) : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">East Boundary:</span> {{ getCurrentTract() ? getTractBounds(getCurrentTract()!).east.toFixed(4) : 'N/A' }}
              </div>
              <div class="tract-detail">
                <span class="label">West Boundary:</span> {{ getCurrentTract() ? getTractBounds(getCurrentTract()!).west.toFixed(4) : 'N/A' }}
              </div>
            </div>

            <div class="adjacent-tracts" *ngIf="getAdjacentTracts().length > 0">
              <h5>Adjacent Tracts ({{ getAdjacentTracts().length }})</h5>
              <div class="adjacent-list">
                <div *ngFor="let adjacent of getAdjacentTracts(); let i = index" class="adjacent-item">
                  <span class="adjacent-id">{{ getTractId(adjacent) }}</span>
                  <span class="adjacent-pop">{{ getTractPopulation(adjacent).toLocaleString() }}</span>
                  <span class="adjacent-centroid">
                    ({{ getTractCentroid(adjacent).lat.toFixed(4) }}, {{ getTractCentroid(adjacent).lng.toFixed(4) }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="error" *ngIf="errorMessage">
        <h3>Error</h3>
        <p>{{ errorMessage }}</p>
        <button (click)="clearError()">Dismiss</button>
      </div>

      <div class="loading" *ngIf="isLoading">
        <div class="spinner"></div>
        <p>Loading state data...</p>
      </div>
    </div>
  `,
  styles: [`
    .tract-debug-page {
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      color: white;
    }

    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }

    .header p {
      font-size: 1.2rem;
      opacity: 0.9;
    }

    .controls {
      background: rgba(255, 255, 255, 0.95);
      padding: 20px;
      border-radius: 10px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }

    .control-group {
      margin-bottom: 15px;
    }

    .control-group label {
      display: block;
      margin-bottom: 5px;
      font-weight: 600;
      color: #333;
    }

    .control-group select, .control-group input[type="checkbox"] {
      margin-right: 10px;
    }

    .control-group select {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .control-group button {
      background: #667eea;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      margin-right: 10px;
    }

    .control-group button:hover:not(:disabled) {
      background: #5a6fd8;
    }

    .control-group button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }

    .algorithm-description {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
      font-style: italic;
    }

    .results {
      background: rgba(255, 255, 255, 0.95);
      padding: 20px;
      border-radius: 10px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }

    .summary h2 {
      color: #333;
      margin-bottom: 15px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }

    .stat {
      display: flex;
      justify-content: space-between;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 5px;
    }

    .stat .label {
      font-weight: 600;
      color: #555;
    }

    .stat .value {
      color: #333;
      font-weight: 500;
    }

    .map-section {
      margin: 30px 0;
    }

    .map-section h3 {
      color: #333;
      margin-bottom: 15px;
    }

    .map-container {
      border: 2px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
    }

    .state-map {
      height: 500px;
      width: 100%;
    }

    .tract-navigation {
      margin-top: 30px;
    }

    .tract-navigation h3 {
      color: #333;
      margin-bottom: 20px;
    }

    .tract-visualization {
      margin-bottom: 20px;
    }

    .tract-dots-container {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 5px;
      max-height: 200px;
      overflow-y: auto;
    }

    .tract-dot {
      width: 12px;
      height: 12px;
      background: #6c757d;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid #fff;
    }

    .tract-dot:hover {
      transform: scale(1.2);
      border: 2px solid #333;
    }

    .tract-dot.selected {
      background: #dc3545 !important;
      transform: scale(1.3);
      border: 2px solid #fff;
      box-shadow: 0 0 10px rgba(220, 53, 69, 0.5);
    }

    .tract-dot.adjacent {
      background: #ffc107 !important;
      border: 1px solid #333;
    }

    .tract-navigation-controls {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 20px;
    }

    .tract-navigation-controls button {
      background: #28a745;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
    }

    .tract-navigation-controls button:hover:not(:disabled) {
      background: #218838;
    }

    .tract-navigation-controls button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }

    .tract-info {
      font-weight: 600;
      color: #333;
    }

    .current-tract-info {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .current-tract-info h4 {
      color: #333;
      margin-bottom: 15px;
    }

    .tract-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }

    .tract-detail {
      display: flex;
      justify-content: space-between;
      padding: 8px;
      background: white;
      border-radius: 4px;
      border: 1px solid #e9ecef;
    }

    .tract-detail .label {
      font-weight: 600;
      color: #555;
    }

    .adjacent-tracts {
      margin-top: 20px;
    }

    .adjacent-tracts h5 {
      color: #333;
      margin-bottom: 10px;
    }

    .adjacent-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 8px;
    }

    .adjacent-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      font-size: 12px;
    }

    .adjacent-id {
      font-weight: 600;
      color: #856404;
    }

    .adjacent-pop {
      color: #856404;
    }

    .adjacent-centroid {
      color: #856404;
      font-family: monospace;
    }

    .error {
      background: #f8d7da;
      color: #721c24;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #f5c6cb;
      margin-bottom: 20px;
    }

    .error h3 {
      margin-top: 0;
    }

    .error button {
      background: #dc3545;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 10px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: white;
    }

    .spinner {
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top: 4px solid white;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `]
})
export class TractDebugPageComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedState: string = '';
  selectedAlgorithm: string = 'geographic';
  useDirectAPI: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';

  states = [
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
    { code: 'WY', name: 'Wyoming', districts: 1 }
  ];

  algorithmOptions = [
    { value: 'geographic', label: 'Geographic (North-South, West-East)' },
    { value: 'latlong', label: 'Latitude-Longitude (Centroid-based)' },
    { value: 'greedy-traversal', label: 'Greedy Traversal (Graph-based)' },
    { value: 'brown-s4', label: 'Brown S4 (Pre-computed Adjacency)' },
    { value: 'geo-graph', label: 'Geo-Graph (Zig-zag with Brown S4 Adjacency)' }
  ];

  stateData: GeoJsonResponse | null = null;
  sortedTracts: GeoJsonFeature[] = [];
  currentTractIndex: number = 0;
  map: any = null;
  tractLayers: any[] = [];
  
  // Performance optimization properties
  private previousSelectedIndex: number | undefined;
  private previousAdjacentIndices: number[] = [];
  private adjacencyCache = new Map<string, boolean>();

  constructor(
    private censusService: CensusService,
    private geodistrictAlgorithmService: GeodistrictAlgorithmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    console.log('🚀 Tract Debug Page Loaded');
    console.log(`📦 Build Version: ${VERSION_INFO.buildVersion}`);
    console.log(`📅 Build Date: ${VERSION_INFO.buildDate}`);
    console.log(`🧮 Algorithm Version: ${VERSION_INFO.algorithmVersion}`);
  }

  ngAfterViewInit() {
    // Ensure DOM is ready
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  onStateChange() {
    console.log('State changed to:', this.selectedState);
    // Clear performance caches when state changes
    this.adjacencyCache.clear();
    this.previousSelectedIndex = undefined;
    this.previousAdjacentIndices = [];
  }

  onAlgorithmChange() {
    console.log('Algorithm changed to:', this.selectedAlgorithm);
    // Clear performance caches when algorithm changes
    this.adjacencyCache.clear();
    this.previousSelectedIndex = undefined;
    this.previousAdjacentIndices = [];
    
    if (this.stateData) {
      this.sortTracts();
    }
  }

  onSettingsChange() {
    console.log('Settings changed - useDirectAPI:', this.useDirectAPI);
  }

  loadStateData() {
    if (!this.selectedState) {
      this.errorMessage = 'Please select a state first';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.stateData = null;
    this.sortedTracts = [];
    this.currentTractIndex = 0;

    console.log(`Loading data for state: ${this.selectedState}`);

    this.censusService.getTractDataWithBoundaries(this.selectedState, undefined, false).subscribe({
      next: (data) => {
        console.log(`Loaded ${data.boundaries.features.length} tracts for ${this.selectedState}`);
        this.stateData = data.boundaries;
        this.sortTracts().then(() => {
          // Use setTimeout to ensure DOM is ready
          setTimeout(() => {
            this.initializeMap();
          }, 100);
        });
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading state data:', error);
        this.errorMessage = `Failed to load data for ${this.selectedState}: ${error.message}`;
        this.isLoading = false;
      }
    });
  }

  async sortTracts() {
    if (!this.stateData || !this.stateData.features) {
      return;
    }

    console.log(`Sorting ${this.stateData.features.length} tracts using ${this.selectedAlgorithm} algorithm`);

    // Use the combined tract data from the service (includes demographic data and STATE property)
    const combinedTracts = this.geodistrictAlgorithmService.combineTractData(
      [], // No demographic data needed since we're just sorting boundaries
      this.stateData.features
    );

    // Check for contained tracts
    const contained = this.geodistrictAlgorithmService.findContainedTracts(combinedTracts);
    if (contained.length > 0) {
      console.log('📦 Contained tracts found:', contained);
      // Check specifically for 950102 in 950103
      const specificPair = contained.find(p => p.contained === '04015950102' && p.container === '04015950103');
      if (specificPair) {
        console.log('✅ Confirmed: Tract 950102 is contained within 950103');
      } else {
        console.log('❌ No containment found between 950102 and 950103');
      }
    } else {
      console.log('📦 No contained tracts found in this dataset');
    }

    // Calculate centroids for all tracts
    const tractsWithCentroids = combinedTracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract)
    }));

    if (this.selectedAlgorithm === 'brown-s4') {
      // Brown S4 is async, so we need to handle it differently
      try {
        console.log('🔄 Using Brown S4 algorithm for sorting...');
        
        // Brown S4 data is now available for all states
        console.log(`🔄 Using Brown S4 data for state: ${this.selectedState}`);
        const sortedTracts = await this.geodistrictAlgorithmService.sortTractsByBrownS4(
          combinedTracts,
          'latitude'
        );
        this.sortedTracts = sortedTracts;
        console.log(`✅ Brown S4 sorting complete: ${this.sortedTracts.length} tracts sorted`);
      } catch (error) {
        console.error('❌ Brown S4 sorting failed, falling back to geographic:', error);
        this.sortedTracts = this.geodistrictAlgorithmService.sortTractsByAlgorithm(
          tractsWithCentroids,
          'geographic'
        ).map(item => item.tract);
      }
    } else if (this.selectedAlgorithm === 'geo-graph') {
      // Geo-Graph is async and implements the specification-compliant zig-zag pattern
      try {
        console.log('🔄 Using Geo-Graph zig-zag sorting with Brown S4 adjacency...');
        
        // Geo-Graph data is now available for all states
        console.log(`🔄 Using Geo-Graph data for state: ${this.selectedState}`);
        const sortedTracts = await this.geodistrictAlgorithmService.sortTractsByGeoGraph(
          combinedTracts,
          'latitude'
        );
        this.sortedTracts = sortedTracts;
        console.log(`✅ Geo-Graph sorting complete: ${this.sortedTracts.length} tracts sorted using zig-zag pattern`);
      } catch (error) {
        console.error('❌ Geo-Graph sorting failed, falling back to geographic:', error);
        this.sortedTracts = this.geodistrictAlgorithmService.sortTractsByAlgorithm(
          tractsWithCentroids,
          'geographic'
        ).map(item => item.tract);
      }
    } else {
      this.sortedTracts = this.geodistrictAlgorithmService.sortTractsByAlgorithm(
        tractsWithCentroids,
        this.selectedAlgorithm as 'geographic' | 'latlong' | 'greedy-traversal'
      ).map(item => item.tract);
    }

    console.log(`Sorted ${this.sortedTracts.length} tracts`);
    this.currentTractIndex = 0;
    this.updateMapHighlighting();
  }

  initializeMap() {
    if (!this.stateData || !this.stateData.features.length) {
      return;
    }

    // Check if map container exists
    const mapElement = document.getElementById('stateMap');
    if (!mapElement) {
      console.error('Map container with ID "stateMap" not found. Available elements:', 
        Array.from(document.querySelectorAll('[id]')).map(el => el.id));
      // Retry after a short delay
      setTimeout(() => this.initializeMap(), 100);
      return;
    }

    console.log('Map container found, initializing map...');

    // Remove existing map
    if (this.map) {
      this.map.remove();
    }

    // Calculate bounds
    const bounds = this.calculateStateBounds();
    
    // Initialize map
    this.map = L.map('stateMap').fitBounds(bounds);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Add tract layers
    this.addTractLayers();

    console.log('Map initialized with', this.stateData.features.length, 'tracts');
  }

  addTractLayers() {
    if (!this.map || !this.stateData) {
      return;
    }

    // Clear existing layers
    this.tractLayers.forEach(layer => this.map.removeLayer(layer));
    this.tractLayers = [];

    // Add each tract as a layer (in sorted order for debugging)
    this.sortedTracts.forEach((tract, index) => {
      const layer = L.geoJSON(tract, {
        style: {
          color: 'black',
          weight: 1,
          fillColor: '#6c757d',
          fillOpacity: 1
        }
      }).bindPopup(`Tract: ${tract.properties?.['TRACTCE'] || tract.properties?.['TRACT_FIPS'] || 'unknown'} (${this.getTractId(tract)})`).addTo(this.map);

      // Add click handler
      layer.on('click', () => {
        this.selectTract(index);
      });

      this.tractLayers.push(layer);
    });
  }

  updateMapHighlighting() {
    if (!this.map || !this.stateData) {
      return;
    }

    // Only update the specific tracts that changed state
    const currentTract = this.getCurrentTract();
    if (!currentTract) return;

    // Reset previous selection and adjacent tracts
    if (this.previousSelectedIndex !== undefined) {
      this.updateTractStyle(this.previousSelectedIndex, 'default');
    }
    
    if (this.previousAdjacentIndices) {
      this.previousAdjacentIndices.forEach(index => {
        this.updateTractStyle(index, 'default');
      });
    }

    // Highlight current selection
    this.updateTractStyle(this.currentTractIndex, 'selected');
    
    // Highlight adjacent tracts
    this.previousAdjacentIndices = [];
    for (let i = 0; i < this.sortedTracts.length; i++) {
      if (this.isAdjacentTract(i)) {
        this.updateTractStyle(i, 'adjacent');
        this.previousAdjacentIndices.push(i);
      }
    }
    
    this.previousSelectedIndex = this.currentTractIndex;
  }

  private updateTractStyle(index: number, style: 'default' | 'selected' | 'adjacent') {
    const layer = this.tractLayers[index];
    if (!layer) return;

    let color = '#6c757d';
    let fillOpacity = 0.3;
    let weight = 1;

    switch (style) {
      case 'selected':
        color = '#dc3545';
        fillOpacity = 0.8;
        weight = 3;
        break;
      case 'adjacent':
        color = '#ffc107';
        fillOpacity = 0.6;
        weight = 1;
        break;
    }

    layer.setStyle({
      color: 'black',
      fillColor: color,
      fillOpacity: fillOpacity,
      weight: weight
    });
  }

  selectTract(index: number) {
    if (index >= 0 && index < this.sortedTracts.length) {
      this.currentTractIndex = index;
      this.updateMapHighlighting();
      const currentTract = this.getCurrentTract();
      if (currentTract) {
        console.log(`Selected tract ${index + 1}: ${this.getTractId(currentTract)}`);
      }
    }
  }

  previousTract() {
    if (this.currentTractIndex > 0) {
      this.selectTract(this.currentTractIndex - 1);
    }
  }

  nextTract() {
    if (this.currentTractIndex < this.sortedTracts.length - 1) {
      this.selectTract(this.currentTractIndex + 1);
    }
  }

  getCurrentTract(): GeoJsonFeature | null {
    if (this.sortedTracts.length === 0 || this.currentTractIndex < 0 || this.currentTractIndex >= this.sortedTracts.length) {
      return null;
    }
    return this.sortedTracts[this.currentTractIndex];
  }

  isAdjacentTract(index: number): boolean {
    if (!this.getCurrentTract() || index === this.currentTractIndex) {
      return false;
    }

    const currentTract = this.getCurrentTract()!;
    const otherTract = this.sortedTracts[index];
    
    // Create cache key
    const currentId = this.getTractId(currentTract);
    const otherId = this.getTractId(otherTract);
    const cacheKey = `${currentId}-${otherId}`;
    
    // Check cache first
    if (this.adjacencyCache.has(cacheKey)) {
      return this.adjacencyCache.get(cacheKey)!;
    }
    
    // Calculate adjacency
    const isAdjacent = this.censusService.areTractsAdjacent(currentTract, otherTract);
    
    // Cache the result
    this.adjacencyCache.set(cacheKey, isAdjacent);
    
    return isAdjacent;
  }

  getAdjacentTracts(): GeoJsonFeature[] {
    if (!this.getCurrentTract()) {
      return [];
    }

    return this.sortedTracts.filter((_, index) => this.isAdjacentTract(index));
  }

  getTotalPopulation(): number {
    if (!this.stateData) return 0;
    return this.stateData.features.reduce((total, tract) => total + this.getTractPopulation(tract), 0);
  }

  getAveragePopulation(): number {
    if (!this.stateData || this.stateData.features.length === 0) return 0;
    return this.getTotalPopulation() / this.stateData.features.length;
  }

  getTractId(tract: GeoJsonFeature): string {
    return tract.properties?.TRACT_FIPS || tract.properties?.TRACT || 'Unknown';
  }

  getTractPopulation(tract: GeoJsonFeature): number {
    return tract.properties?.POPULATION || 0;
  }

  getTractName(tract: GeoJsonFeature): string {
    return tract.properties?.NAME || 'Unknown';
  }

  getTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    return this.calculateTractCentroid(tract);
  }

  getTractBounds(tract: GeoJsonFeature): { north: number; south: number; east: number; west: number } {
    return this.calculateTractBounds(tract);
  }

  calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    // Use the census service method
    return this.censusService.calculateTractCentroid(tract);
  }

  calculateTractBounds(tract: GeoJsonFeature): { north: number; south: number; east: number; west: number } {
    const coordinates = this.censusService.extractAllCoordinates(tract.geometry);
    
    if (coordinates.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = -90, south = 90, east = -180, west = 180;

    coordinates.forEach(coord => {
      const lng = coord[0];
      const lat = coord[1];
      
      north = Math.max(north, lat);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      west = Math.min(west, lng);
    });

    return { north, south, east, west };
  }

  calculateStateBounds(): [[number, number], [number, number]] {
    if (!this.stateData || this.stateData.features.length === 0) {
      return [[0, 0], [0, 0]];
    }

    let north = -90, south = 90, east = -180, west = 180;

    this.stateData.features.forEach(tract => {
      const bounds = this.calculateTractBounds(tract);
      north = Math.max(north, bounds.north);
      south = Math.min(south, bounds.south);
      east = Math.max(east, bounds.east);
      west = Math.min(west, bounds.west);
    });

    return [[south, west], [north, east]];
  }

  getSelectedAlgorithmDescription(): string {
    const option = this.algorithmOptions.find(opt => opt.value === this.selectedAlgorithm);
    if (!option) return '';
    
    // Add detailed descriptions for specific algorithms
    switch (this.selectedAlgorithm) {
      case 'geo-graph':
        return 'Geo-Graph (Zig-zag with Brown S4 Adjacency) - Implements the specification-compliant zig-zag traversal pattern starting from northwest-most tract, moving east/west in rows using Brown S4 adjacency data';
      case 'brown-s4':
        return 'Brown S4 (Pre-computed Adjacency) - Uses Brown University S4 adjacency data for graph-based traversal';
      case 'greedy-traversal':
        return 'Greedy Traversal (Graph-based) - Graph-based directional traversal for optimal contiguity';
      case 'geographic':
        return 'Geographic (North-South, West-East) - Simple geographic sorting by centroid coordinates';
      case 'latlong':
        return 'Latitude-Longitude (Centroid-based) - Sorting based on tract centroid coordinates';
      default:
        return option.label;
    }
  }

  clearError() {
    this.errorMessage = '';
  }

  /**
   * Get FIPS code for a state abbreviation
   * @param state State abbreviation or FIPS code
   * @returns FIPS code
   */
  private getStateFipsCode(state: string): string {
    // If it's already a FIPS code (2 digits), return as is
    if (/^\d{2}$/.test(state)) {
      return state;
    }

    // Convert state abbreviation to FIPS code
    const stateFipsMap: { [key: string]: string } = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06', 'CO': '08', 'CT': '09', 'DE': '10',
      'FL': '12', 'GA': '13', 'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19', 'KS': '20',
      'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28',
      'MO': '29', 'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34', 'NM': '35', 'NY': '36',
      'NC': '37', 'ND': '38', 'OH': '39', 'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50', 'VA': '51', 'WA': '53', 'WV': '54',
      'WI': '55', 'WY': '56'
    };

    const fipsCode = stateFipsMap[state.toUpperCase()];
    if (!fipsCode) {
      throw new Error(`Invalid state abbreviation: ${state}`);
    }

    return fipsCode;
  }
}
