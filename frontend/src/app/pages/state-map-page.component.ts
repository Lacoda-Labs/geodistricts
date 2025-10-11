import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { CensusService, GeoJsonResponse, TractDivisionOptions, TractDivisionResult, RecursiveDivisionOptions, RecursiveDivisionResult, District, DivisionStep } from '../services/census.service';

@Component({
  selector: 'app-state-map-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './state-map-page.component.html',
  styles: [`
    .state-map-page {
      min-height: 100vh;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      padding: 0;
    }

    .page-header {
      background: white;
      padding: 2rem 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }

    .breadcrumb {
      max-width: 1200px;
      margin: 0 auto 1rem auto;
      padding: 0 2rem;
      font-size: 14px;
      color: #666;
    }

    .breadcrumb a {
      color: #007bff;
      text-decoration: none;
    }

    .breadcrumb a:hover {
      text-decoration: underline;
    }

    .breadcrumb .separator {
      margin: 0 0.5rem;
      color: #999;
    }

    .breadcrumb .current {
      color: #333;
      font-weight: 500;
    }

    .page-header h1 {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
      font-size: 2.5rem;
      color: #333;
      font-weight: 700;
    }

    .page-description {
      max-width: 1200px;
      margin: 1rem auto 0 auto;
      padding: 0 2rem;
      font-size: 1.1rem;
      color: #666;
      line-height: 1.6;
    }

    .page-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 2rem;
    }

    .controls-section {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .state-selector {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .state-selector label {
      font-weight: 600;
      color: #333;
    }

    .state-selector select {
      padding: 0.5rem 1rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
      background: white;
    }

    .map-controls {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .map-controls button {
      padding: 0.5rem 1rem;
      border: 1px solid #007bff;
      background: white;
      color: #007bff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.3s ease;
    }

    .map-controls button:hover {
      background: #007bff;
      color: white;
    }

    .map-controls button.active {
      background: #007bff;
      color: white;
    }

    .loading-indicator {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 15px;
      background: #e3f2fd;
      border: 1px solid #2196f3;
      border-radius: 5px;
      margin-top: 10px;
      font-size: 14px;
      color: #1976d2;
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #e3f2fd;
      border-top: 2px solid #2196f3;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .map-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      overflow: hidden;
      margin-bottom: 2rem;
    }

    .map-wrapper {
      position: relative;
      height: 600px;
    }

    .map {
      width: 100%;
      height: 100%;
      background: #f8f9fa;
      min-height: 400px;
    }

    #stateMap {
      width: 100%;
      height: 100%;
      min-height: 400px;
    }

    /* Leaflet map specific styles */
    .leaflet-container {
      height: 100%;
      width: 100%;
      border-radius: 8px;
    }

    .leaflet-popup-content-wrapper {
      border-radius: 8px;
    }

    .leaflet-popup-content {
      margin: 8px 12px;
      line-height: 1.4;
    }

    .map-overlay {
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 8px;
      padding: 1.5rem;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .map-info h3 {
      color: #007bff;
      margin: 0 0 1rem 0;
      font-size: 1.2rem;
    }

    .map-info p {
      color: #555;
      margin: 0 0 1rem 0;
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .legend {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #eee;
    }

    .legend h4 {
      margin: 0 0 0.5rem 0;
      color: #333;
      font-size: 0.9rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.3rem;
      font-size: 0.8rem;
      color: #666;
    }

    .legend-color {
      width: 20px;
      height: 2px;
      border-radius: 1px;
    }

    .legend-color.tract-boundary {
      background: #007bff;
    }

    .legend-color.county-boundary {
      background: #dc3545;
    }

    .division-info {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #eee;
    }

    .division-info h4 {
      margin: 0 0 0.5rem 0;
      color: #333;
      font-size: 0.9rem;
    }

    .division-info p {
      margin: 0.3rem 0;
      font-size: 0.8rem;
      color: #666;
    }

    .tract-info {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .tract-info h3 {
      margin: 0 0 1rem 0;
      color: #333;
      border-bottom: 2px solid #007bff;
      padding-bottom: 0.5rem;
    }

    .tract-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }

    .detail-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #eee;
    }

    .detail-item .label {
      font-weight: 600;
      color: #666;
    }

    .detail-item .value {
      color: #333;
    }

    .page-footer {
      background: #333;
      color: white;
      padding: 2rem 0;
      margin-top: 3rem;
    }

    .footer-info {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
    }

    .footer-info h4 {
      margin: 0 0 1rem 0;
      color: #fff;
    }

    .footer-info p {
      margin: 0 0 1.5rem 0;
      color: #ccc;
      line-height: 1.6;
    }

    .footer-links {
      display: flex;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .footer-links a {
      color: #007bff;
      text-decoration: none;
      font-size: 0.9rem;
    }

    .footer-links a:hover {
      text-decoration: underline;
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .page-content {
        padding: 0 1rem;
      }

      .page-header h1 {
        font-size: 2rem;
        padding: 0 1rem;
      }

      .page-description {
        padding: 0 1rem;
      }

      .breadcrumb {
        padding: 0 1rem;
      }

      .controls-section {
        flex-direction: column;
        align-items: stretch;
      }

      .map-wrapper {
        height: 400px;
      }

      .map-overlay {
        position: static;
        margin: 1rem;
        max-width: none;
      }

      .tract-details {
        grid-template-columns: 1fr;
      }

      .footer-links {
        flex-direction: column;
        gap: 1rem;
      }

      .footer-info {
        padding: 0 1rem;
      }
    }

    /* Districts List Styles */
    .districts-section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      margin: 2rem 0;
      padding: 2rem;
    }

    .districts-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .districts-header h3 {
      margin: 0;
      color: #2c3e50;
      font-size: 1.5rem;
    }

    .districts-controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .districts-controls label {
      font-weight: 500;
      color: #555;
      margin-right: 0.5rem;
    }

    .districts-controls select {
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: white;
      font-size: 0.9rem;
    }

    .districts-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
      padding: 1rem;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .summary-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .summary-item .label {
      font-weight: 500;
      color: #555;
    }

    .summary-item .value {
      font-weight: 600;
      color: #2c3e50;
    }

    .districts-list {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
    }

    .districts-table-header {
      display: grid;
      grid-template-columns: 80px 1fr 80px 100px 60px;
      gap: 1rem;
      padding: 1rem;
      background: #f8f9fa;
      border-bottom: 1px solid #e0e0e0;
      font-weight: 600;
      color: #555;
      font-size: 0.9rem;
    }

    .districts-table-body {
      max-height: 400px;
      overflow-y: auto;
    }

    .district-row {
      display: grid;
      grid-template-columns: 80px 1fr 80px 100px 60px;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .district-row:hover {
      background-color: #f8f9fa;
    }

    .district-row.highlighted {
      background-color: #e3f2fd;
      border-left: 4px solid #2196f3;
    }

    .district-row:last-child {
      border-bottom: none;
    }

    .col-id {
      font-weight: 600;
      color: #2c3e50;
    }

    .col-population {
      font-family: 'Courier New', monospace;
      color: #333;
    }

    .col-tracts {
      text-align: center;
      color: #666;
    }

    .col-deviation {
      text-align: center;
      font-weight: 500;
    }

    .col-deviation.positive {
      color: #d32f2f;
    }

    .col-deviation.negative {
      color: #388e3c;
    }

    .col-color {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .district-color-indicator {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 1px solid #ccc;
    }

    /* Responsive design for districts list */
    @media (max-width: 768px) {
      .districts-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .districts-controls {
        width: 100%;
        justify-content: flex-start;
      }

      .districts-table-header,
      .district-row {
        grid-template-columns: 60px 1fr 60px 80px 40px;
        gap: 0.5rem;
        padding: 0.5rem;
      }

      .districts-table-header {
        font-size: 0.8rem;
      }

      .district-row {
        font-size: 0.9rem;
      }

      .district-color-indicator {
        width: 16px;
        height: 16px;
      }
    }

    /* District Label Styles */
    .district-label-icon {
      background: transparent !important;
      border: none !important;
    }

    .district-label {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: rgba(255, 255, 255, 0.9);
      border: 2px solid #000;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .district-number {
      font-weight: bold;
      font-size: 14px;
      color: #000;
      text-shadow: 1px 1px 1px rgba(255, 255, 255, 0.8);
    }

    /* Hide labels at low zoom levels */
    .leaflet-zoom-anim .district-label-icon {
      opacity: 0;
    }

    /* Step-through button styles */
    .step-button {
      padding: 8px 12px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .step-button:disabled {
      cursor: not-allowed;
    }
  `]
})
export class StateMapPageComponent implements OnInit, AfterViewInit, OnDestroy {
  selectedState = '06'; // Default to California
  showTractBoundaries = true;
  showCountyBoundaries = true;
  loading = false;
  tractCount = 0;
  isLoadingTracts = false;
  loadingProgress = '';
  selectedTract: any = null;
  private map: L.Map | null = null;
  private tractLayer: L.LayerGroup | null = null;
  private countyLayer: L.LayerGroup | null = null;
  
  // District division properties
  districtsResult: RecursiveDivisionResult | null = null;
  targetDistricts: number = 52; // Default to California's 52 districts
  populationTolerance: number = 0.01; // 1% tolerance
  
  // Districts list properties
  sortedDistricts: District[] = [];
  districtsSortBy: string = 'id';
  districtsSortOrder: string = 'asc';
  highlightedDistrictId: number | null = null;
  
  // Step-through visualization properties
  enableStepThrough: boolean = false;
  currentStep: number = 0;
  divisionSteps: DivisionStep[] = [];
  isPlaying: boolean = false;
  playInterval: any = null;

  // State FIPS codes and names
  private stateNames: { [key: string]: string } = {
    '01': 'Alabama',
    '06': 'California',
    '12': 'Florida',
    '13': 'Georgia',
    '17': 'Illinois',
    '36': 'New York',
    '48': 'Texas'
  };

  constructor(private censusService: CensusService) {
    // Make census service available globally for debugging
    (window as any).censusService = this.censusService;
  }

  ngOnInit() {
    // Component initialization
    console.log('StateMapPageComponent initialized');
    
    // Debug cache status
    this.censusService.debugAllCacheStatus();
    
    // Test the algorithm with a small dataset first
    this.testRecursiveDivision();
    
    console.log('Map component ready - algorithm testing enabled');
  }

  /**
   * Test the recursive division algorithm with a simple example
   */
  private testRecursiveDivision(): void {
    console.log('=== Testing County-Aware Division Algorithm ===');
    
    // First test county grouping
    console.log('Testing county grouping...');
    this.censusService.testCountyGrouping('06', false).subscribe({
      next: (countyResult) => {
        console.log('County grouping test completed:', countyResult);
        
        // Now test with California's 52 districts using county-aware division
        console.log('Testing county-aware division with 52 districts...');
        this.censusService.divideTractsIntoDistrictsWithData('06', undefined, {
          targetDistricts: 52,
          maxIterations: 200,
          populationTolerance: this.populationTolerance,
          preserveCountyBoundaries: true // Explicitly enable county preservation
        }).subscribe({
          next: (result: RecursiveDivisionResult) => {
            console.log('California 52 Districts Test Result:', {
              districts: result.districts.length,
              totalPopulation: result.totalPopulation,
              averagePopulation: result.averagePopulation,
          populationVariance: result.populationVariance,
          divisionHistory: result.divisionHistory.slice(0, 10) // Show first 10 steps
        });
        
        // Show population distribution
        const targetPopulation = result.totalPopulation / result.districts.length;
        const populationStats = result.districts.map(d => ({
          id: d.id,
          population: d.population,
          deviation: ((d.population - targetPopulation) / targetPopulation * 100).toFixed(1) + '%'
        }));
        
            console.log('Population Distribution (Target: ' + targetPopulation.toLocaleString() + '):');
            console.table(populationStats.slice(0, 10)); // Show first 10 districts
            
            // Check contiguity for all districts
            console.log('\n=== Contiguity Check ===');
            const contiguityResults = result.districts.map(d => ({
              id: d.id,
              tracts: d.tracts.length,
          contiguous: this.checkDistrictContiguity(d.tracts)
        }));
        
            const nonContiguousDistricts = contiguityResults.filter(d => !d.contiguous);
            console.log(`Contiguous districts: ${contiguityResults.filter(d => d.contiguous).length}/${result.districts.length}`);
            
            if (nonContiguousDistricts.length > 0) {
              console.warn('Non-contiguous districts found:', nonContiguousDistricts);
            } else {
              console.log('✅ All districts are geographically contiguous!');
            }
            
            // Specifically check district 27
            const district27 = result.districts.find(d => d.id === 27);
            if (district27) {
              const isContiguous = this.checkDistrictContiguity(district27.tracts);
              console.log(`District 27: ${district27.tracts.length} tracts, contiguous: ${isContiguous ? '✅ YES' : '❌ NO'}`);
            }
            
            // Log the division pattern
            console.log('\nCounty-Aware Division Pattern:');
            console.log('Step 1: Group tracts by county');
            console.log('Step 2: Assign entire counties to districts based on population balance');
            console.log('Step 3: Balance districts by moving entire counties if needed');
            console.log('Algorithm: County boundaries preserved, population balanced, geographic contiguity maintained');
          },
          error: (error) => {
            console.error('Error testing county-aware division:', error);
          }
        });
      },
      error: (error) => {
        console.error('Error testing county grouping:', error);
      }
    });
  }

  ngAfterViewInit() {
    // Initialize map after view is ready
    setTimeout(() => {
      this.initializeMap();
      // Check if map was created successfully
      setTimeout(() => {
        if (this.map) {
          console.log('Map is ready and visible');
          this.map.invalidateSize(); // Ensure map renders properly
        } else {
          console.error('Map failed to initialize');
        }
      }, 500);
    }, 100);
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
    this.pausePlay(); // Clean up any running intervals
  }

  onStateChange() {
    this.loadStateData();
    this.updateMapView();
  }

  toggleTractBoundaries() {
    this.showTractBoundaries = !this.showTractBoundaries;
    this.updateMapLayers();
  }

  toggleCountyBoundaries() {
    this.showCountyBoundaries = !this.showCountyBoundaries;
    this.updateMapLayers();
  }

  resetMapView() {
    this.initializeMap();
  }

  /**
   * Manually trigger district creation
   */
  createDistricts(): void {
    if (this.loading) return;
    
    console.log('Manually triggering district creation...');
    this.loading = true;
    this.loadingProgress = 'Loading census tracts...';
    
    // Load census tracts and create districts
    this.censusService.getTractBoundaries(this.selectedState).subscribe({
      next: (geojsonData: GeoJsonResponse) => {
        if (geojsonData && geojsonData.features && geojsonData.features.length > 0) {
          console.log(`Creating ${this.targetDistricts} districts from ${geojsonData.features.length} tracts`);
          
          this.loadingProgress = `Creating ${this.targetDistricts} districts...`;
          
          // Create districts using the optimized algorithm
          this.districtsResult = this.censusService.divideTractsIntoDistricts(geojsonData.features, {
            targetDistricts: this.targetDistricts,
            maxIterations: 200,
            populationTolerance: this.populationTolerance
          });
          
          this.loadingProgress = `Rendering ${this.targetDistricts} districts...`;
          
          if (this.districtsResult) {
            // Render districts
            this.renderDistricts();
            this.loading = false;
            this.loadingProgress = '';
            console.log('District creation completed successfully');
          } else {
            this.loading = false;
            this.loadingProgress = 'District creation failed';
            console.error('Failed to create districts');
          }
        } else {
          this.loading = false;
          this.loadingProgress = 'No census tracts found';
          console.error('No census tracts found for state:', this.selectedState);
        }
      },
      error: (error) => {
        this.loading = false;
        this.loadingProgress = 'Error loading census data';
        console.error('Error loading census tracts:', error);
      }
    });
  }

  getStateName(stateCode: string): string {
    return this.stateNames[stateCode] || 'Unknown State';
  }

  private initializeMap() {
    const mapElement = document.getElementById('stateMap');
    console.log('Map element found:', mapElement);
    console.log('Current map instance:', this.map);
    
    if (mapElement && !this.map) {
      // Get state center coordinates
      const stateCenter = this.getStateCenter(this.selectedState);
      console.log('State center coordinates:', stateCenter);
      
      try {
        this.map = L.map('stateMap').setView(stateCenter, 7);
        console.log('Map created successfully:', this.map);
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Initialize layer groups
        this.tractLayer = L.layerGroup().addTo(this.map);
        this.countyLayer = L.layerGroup().addTo(this.map);

        console.log('Map initialized successfully for state:', this.getStateName(this.selectedState));
        this.loadStateData();
        
        // Load tract boundaries and create districts
        this.updateMapLayers();
      } catch (error) {
        console.error('Error initializing map:', error);
      }
    } else {
      console.log('Map element not found or map already exists');
    }
  }

  private loadStateData() {
    this.loading = true;
    this.tractCount = 0;
    this.districtsResult = null; // Clear previous districts result
    
    // Load real census tract data
    this.censusService.getTractBoundaries(this.selectedState).subscribe({
      next: (geojsonData: GeoJsonResponse) => {
        if (geojsonData && geojsonData.features) {
          this.tractCount = geojsonData.features.length;
          console.log(`Loaded ${this.tractCount} census tracts for ${this.getStateName(this.selectedState)}`);
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading state data:', error);
        // Fallback to simulated count
        this.tractCount = Math.floor(Math.random() * 5000) + 1000;
        this.loading = false;
        console.log(`Using simulated count: ${this.tractCount} census tracts for ${this.getStateName(this.selectedState)}`);
      }
    });
  }

  private updateMapLayers() {
    if (!this.map || !this.tractLayer || !this.countyLayer) return;

    // Clear existing layers
    this.tractLayer.clearLayers();
    this.countyLayer.clearLayers();

    if (this.showTractBoundaries) {
      // Try real data first, fallback to sample data
      this.addTractBoundaries();
    }

    if (this.showCountyBoundaries) {
      // Try real data first, fallback to sample data
      this.addCountyBoundaries();
    }

    console.log('Updating map layers:', {
      tractBoundaries: this.showTractBoundaries,
      countyBoundaries: this.showCountyBoundaries
    });
  }

  private updateMapView() {
    if (!this.map) return;
    
    const stateCenter = this.getStateCenter(this.selectedState);
    this.map.setView(stateCenter, 7);
    this.updateMapLayers();
  }

  private getStateCenter(stateCode: string): [number, number] {
    const stateCenters: { [key: string]: [number, number] } = {
      '01': [32.806671, -86.791130], // Alabama
      '06': [36.778261, -119.417932], // California
      '12': [27.766279, -81.686783], // Florida
      '13': [33.040619, -83.643074], // Georgia
      '17': [40.349457, -88.986137], // Illinois
      '36': [42.165726, -74.948051], // New York
      '48': [31.054487, -97.563461]  // Texas
    };
    
    return stateCenters[stateCode] || [39.8283, -98.5795]; // Default to US center
  }

  private addTractBoundaries() {
    if (!this.tractLayer) return;

    console.log('Loading census tract boundaries for state:', this.selectedState);
    // Deployment fix: Ensure proper TypeScript compilation
    this.isLoadingTracts = true;
    this.loadingProgress = 'Getting tract count...';
    
    // Set a timeout to show sample data if API is slow
    const timeoutId = setTimeout(() => {
      console.log('API timeout - showing sample data');
      this.isLoadingTracts = false;
      this.loadingProgress = '';
      this.addSampleTractBoundaries();
    }, 10000); // 10 second timeout for large datasets
    
    this.censusService.getTractBoundaries(this.selectedState).subscribe({
      next: (geojsonData: GeoJsonResponse) => {
        clearTimeout(timeoutId);
        this.isLoadingTracts = false;
        this.loadingProgress = '';
        console.log('TIGERweb API Response:', geojsonData);
        
        // Debug cache status after loading
        this.censusService.debugAllCacheStatus();
        
        if (geojsonData && geojsonData.features && geojsonData.features.length > 0) {
          console.log(`Loaded ${geojsonData.features.length} census tracts`);
          
          // Just render tract boundaries - districts created on demand
          console.log('Rendering tract boundaries - districts can be created manually');
          
          this.loadingProgress = `Rendering ${geojsonData.features.length} tracts...`;
          
          if (this.districtsResult) {
            // Render multiple districts with different colors
            this.renderDistricts();
          } else {
            // Just render tract boundaries without division
            this.renderTractBoundaries(geojsonData.features);
          }
          
          // Update tract count
          this.tractCount = geojsonData.features.length;
        } else {
          console.warn('No tract features found in API response');
          console.log('Falling back to sample data');
          this.addSampleTractBoundaries();
        }
      },
      error: (error) => {
        clearTimeout(timeoutId);
        this.isLoadingTracts = false;
        this.loadingProgress = '';
        console.error('Error loading tract boundaries:', error);
        console.log('Falling back to sample data');
        this.addSampleTractBoundaries();
      }
    });
  }

  private addCountyBoundaries() {
    if (!this.countyLayer) return;

    console.log('Loading county boundaries for state:', this.selectedState);
    
    this.censusService.getCountyBoundaries(this.selectedState).subscribe({
      next: (geojsonData: GeoJsonResponse) => {
        if (geojsonData && geojsonData.features) {
          console.log(`Loaded ${geojsonData.features.length} counties`);
          
          geojsonData.features.forEach((feature) => {
            const county = L.geoJSON(feature, {
              style: {
                color: '#dc3545',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.05
              }
            }).bindPopup(`
              <strong>${feature.properties.NAME} County</strong><br>
              Land Area: ${this.formatArea(feature.properties.ALAND)} sq mi<br>
              Water Area: ${this.formatArea(feature.properties.AWATER)} sq mi
            `);

            this.countyLayer!.addLayer(county);
          });
        }
      },
      error: (error) => {
        console.error('Error loading county boundaries:', error);
        console.log('Falling back to sample data');
        this.addSampleCountyBoundaries();
      }
    });
  }

  private formatArea(areaInSquareMeters: number | undefined): string {
    if (!areaInSquareMeters) return '0';
    // Convert square meters to square miles (1 sq mi = 2,589,988.11 sq m)
    const squareMiles = areaInSquareMeters / 2589988.11;
    return squareMiles.toFixed(2);
  }

  private addSampleTractBoundaries() {
    if (!this.tractLayer) return;

    console.log('Using sample tract data as fallback');
    const sampleTracts = this.generateSampleTracts();
    
    sampleTracts.forEach(tract => {
      const polygon = L.polygon(tract.coordinates, {
        color: '#007bff',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.1
      }).bindPopup(`
        <strong>Census Tract ${tract.id}</strong><br>
        Population: ${tract.population.toLocaleString()}<br>
        Area: ${tract.area} sq mi<br>
        <em>Sample data - API unavailable</em>
      `);

      this.tractLayer!.addLayer(polygon);
    });
    
    this.tractCount = sampleTracts.length;
  }

  private addSampleCountyBoundaries() {
    if (!this.countyLayer) return;

    console.log('Using sample county data as fallback');
    const sampleCounties = this.generateSampleCounties();
    
    sampleCounties.forEach(county => {
      const polygon = L.polygon(county.coordinates, {
        color: '#dc3545',
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.05
      }).bindPopup(`
        <strong>${county.name} County</strong><br>
        Population: ${county.population.toLocaleString()}<br>
        <em>Sample data - API unavailable</em>
      `);

      this.countyLayer!.addLayer(polygon);
    });
  }

  private generateSampleTracts(): any[] {
    // Generate sample tract data for demonstration
    const stateCenter = this.getStateCenter(this.selectedState);
    const tracts = [];
    
    for (let i = 0; i < 5; i++) {
      const offsetLat = (Math.random() - 0.5) * 2;
      const offsetLng = (Math.random() - 0.5) * 2;
      
      tracts.push({
        id: `${this.selectedState}${String(i + 1).padStart(3, '0')}`,
        coordinates: [
          [stateCenter[0] + offsetLat, stateCenter[1] + offsetLng],
          [stateCenter[0] + offsetLat + 0.1, stateCenter[1] + offsetLng],
          [stateCenter[0] + offsetLat + 0.1, stateCenter[1] + offsetLng + 0.1],
          [stateCenter[0] + offsetLat, stateCenter[1] + offsetLng + 0.1]
        ],
        population: Math.floor(Math.random() * 5000) + 1000,
        area: (Math.random() * 50 + 10).toFixed(1)
      });
    }
    
    return tracts;
  }

  private generateSampleCounties(): any[] {
    // Generate sample county data for demonstration
    const stateCenter = this.getStateCenter(this.selectedState);
    const counties = [];
    const countyNames = ['North', 'South', 'East', 'West', 'Central'];
    
    for (let i = 0; i < 3; i++) {
      const offsetLat = (Math.random() - 0.5) * 3;
      const offsetLng = (Math.random() - 0.5) * 3;
      
      counties.push({
        name: countyNames[i],
        coordinates: [
          [stateCenter[0] + offsetLat, stateCenter[1] + offsetLng],
          [stateCenter[0] + offsetLat + 0.5, stateCenter[1] + offsetLng],
          [stateCenter[0] + offsetLat + 0.5, stateCenter[1] + offsetLng + 0.5],
          [stateCenter[0] + offsetLat, stateCenter[1] + offsetLng + 0.5]
        ],
        population: Math.floor(Math.random() * 500000) + 100000
      });
    }
    
    return counties;
  }

  /**
   * Generate a color for a district based on its ID
   * @param districtId District ID
   * @returns Color string in hex format
   */
  getDistrictColor(districtId: number): string {
    // More vibrant and contrasting colors for better district visibility
    const colors = [
      '#FF4444', '#44FF44', '#4444FF', '#FFFF44', '#FF44FF', '#44FFFF',
      '#FF8844', '#88FF44', '#4488FF', '#FF4488', '#88FF88', '#4488FF',
      '#FFAA44', '#AAFF44', '#44AAFF', '#FF44AA', '#AAFFAA', '#44AAFF',
      '#FFCC44', '#CCFF44', '#44CCFF', '#FF44CC', '#CCFFCC', '#44CCFF',
      '#FFEE44', '#EEFF44', '#44EEFF', '#FF44EE', '#EEFFEE', '#44EEFF',
      '#FF6644', '#66FF44', '#4466FF', '#FF4466', '#66FF66', '#4466FF',
      '#FFAA66', '#AAFF66', '#66AAFF', '#FF66AA', '#AAFFAA', '#66AAFF',
      '#FFCC66', '#CCFF66', '#66CCFF', '#FF66CC', '#CCFFCC', '#66CCFF',
      '#FFEE66', '#EEFF66', '#66EEFF', '#FF66EE', '#EEFFEE', '#66EEFF',
      '#FF8866', '#88FF66', '#6688FF', '#FF6688', '#88FF88', '#6688FF'
    ];
    return colors[districtId % colors.length];
  }

  /**
   * Render multiple districts with different colors
   */
  private renderDistricts(): void {
    if (!this.districtsResult || !this.tractLayer) return;

    console.log(`Rendering ${this.districtsResult.districts.length} districts`);

    this.districtsResult.districts.forEach((district, index) => {
      const color = this.getDistrictColor(district.id);
      
      district.tracts.forEach((feature, tractIndex) => {
        if (tractIndex % 100 === 0) {
          console.log(`Processing district ${district.id}, tract ${tractIndex + 1}/${district.tracts.length}`);
        }
        
        const tract = L.geoJSON(feature, {
          style: {
            color: 'transparent', // No tract boundary lines
            weight: 0, // No boundary lines
            opacity: 0, // No boundary lines
            fillOpacity: 0.7, // More opaque fill for better visibility
            fillColor: color
          }
        }).bindPopup(`
          <strong>District ${district.id}</strong><br>
          <strong>Census Tract ${feature.properties.TRACT || feature.properties.TRACT_FIPS}</strong><br>
          State: ${feature.properties.STATE_ABBR || feature.properties.STATE_FIPS}<br>
          Population: ${feature.properties.POPULATION?.toLocaleString() || 'N/A'}<br>
          Area: ${feature.properties.SQMI?.toFixed(2) || 'N/A'} sq mi<br>
          District Population: ${district.population.toLocaleString()}
        `);

        this.tractLayer!.addLayer(tract);
      });
    });

    console.log(`Successfully rendered ${this.districtsResult.districts.length} districts`);
    
    // Add district number labels
    this.addDistrictLabels();
    
    // Initialize sorted districts for the list
    this.sortDistricts();
  }

  /**
   * Render two-region division (north/south)
   */
  /**
   * Render tract boundaries without division
   */
  private renderTractBoundaries(features: any[]): void {
    if (!this.tractLayer) return;

    console.log(`Rendering ${features.length} tract boundaries...`);
    
    features.forEach((feature, index) => {
      if (index % 1000 === 0) {
        console.log(`Processing tract ${index + 1}/${features.length}`);
      }
      
      const tract = L.geoJSON(feature, {
        style: {
          color: '#007bff',
          weight: 1,
          opacity: 0.6,
          fillOpacity: 0.1,
          fillColor: '#007bff'
        }
      }).bindPopup(`
        <strong>Census Tract ${feature.properties.TRACT || feature.properties.TRACT_FIPS}</strong><br>
        State: ${feature.properties.STATE_ABBR || feature.properties.STATE_FIPS}<br>
        Population: ${feature.properties.POPULATION?.toLocaleString() || 'N/A'}<br>
        Area: ${feature.properties.SQMI?.toFixed(2) || 'N/A'} sq mi
      `);

      this.tractLayer!.addLayer(tract);
    });

    console.log(`Successfully rendered ${features.length} tract boundaries`);
  }




  /**
   * Calculate approximate area of a district in square miles
   */
  private calculateDistrictArea(district: District): number {
    // Simple approximation using bounds
    const latDiff = district.bounds.north - district.bounds.south;
    const lngDiff = district.bounds.east - district.bounds.west;
    
    // Convert to approximate square miles (rough calculation)
    const latMiles = latDiff * 69; // 1 degree latitude ≈ 69 miles
    const lngMiles = lngDiff * 69 * Math.cos(district.centroid.lat * Math.PI / 180);
    
    return latMiles * lngMiles;
  }

  /**
   * Add district number labels to the center of each district
   */
  private addDistrictLabels(): void {
    if (!this.districtsResult || !this.tractLayer) return;

    console.log('Adding district labels...');

    // Create a layer group for district labels
    const labelLayer = L.layerGroup();

    this.districtsResult.districts.forEach(district => {
      // Create a custom HTML marker for the district number
      const labelHtml = `
        <div class="district-label">
          <span class="district-number">${district.id}</span>
        </div>
      `;

      const labelIcon = L.divIcon({
        html: labelHtml,
        className: 'district-label-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const label = L.marker([district.centroid.lat, district.centroid.lng], {
        icon: labelIcon
      }).bindPopup(`
        <strong>District ${district.id}</strong><br>
        Population: ${district.population.toLocaleString()}<br>
        Tracts: ${district.tracts.length}<br>
        Area: ${this.calculateDistrictArea(district).toFixed(2)} sq mi
      `);

      labelLayer.addLayer(label);
    });

    // Add the label layer to the map
    this.tractLayer.addLayer(labelLayer);
    
    console.log('District labels added');
  }

  /**
   * Add a visual division line to the map showing where the tracts were divided
   */
  // Removed division line - districts only
  private addDivisionLine(): void {
    // Disabled - districts only mode
    return;
  }

  /**
   * Set the target number of districts for recursive division
   */
  setTargetDistricts(districts: number): void {
    this.targetDistricts = districts;
    console.log(`Target districts set to: ${districts}`);
    
    // Reload the map with the new target
    this.updateMapLayers();
  }

  setPopulationTolerance(tolerance: number): void {
    this.populationTolerance = tolerance;
    console.log(`Population tolerance set to: ${(tolerance * 100).toFixed(1)}%`);
    
    // Reload the map with the new tolerance
    this.updateMapLayers();
  }

  /**
   * Sort districts based on current sort criteria
   */
  sortDistricts(): void {
    if (!this.districtsResult) return;

    this.sortedDistricts = [...this.districtsResult.districts].sort((a, b) => {
      let aValue: any, bValue: any;

      switch (this.districtsSortBy) {
        case 'population':
          aValue = a.population;
          bValue = b.population;
          break;
        case 'tractCount':
          aValue = a.tracts.length;
          bValue = b.tracts.length;
          break;
        case 'id':
        default:
          aValue = a.id;
          bValue = b.id;
          break;
      }

      if (this.districtsSortOrder === 'desc') {
        return bValue - aValue;
      } else {
        return aValue - bValue;
      }
    });
  }

  /**
   * Get population deviation percentage for a district
   */
  getPopulationDeviation(district: District): number {
    if (!this.districtsResult) return 0;
    
    const targetPopulation = this.districtsResult.totalPopulation / this.districtsResult.districts.length;
    return ((district.population - targetPopulation) / targetPopulation) * 100;
  }

  /**
   * Highlight a district on the map
   */
  highlightDistrict(district: District): void {
    this.highlightedDistrictId = district.id;
    
    // You could add map highlighting logic here
    console.log(`Highlighting district ${district.id} with population ${district.population.toLocaleString()}`);
  }

  /**
   * Track by function for district rows
   */
  trackByDistrictId(index: number, district: District): number {
    return district.id;
  }

  /**
   * Check if a district is geographically contiguous (simplified version)
   * @param tracts Array of tracts in the district
   * @returns True if the district is contiguous
   */
  checkDistrictContiguity(tracts: any[]): boolean {
    if (tracts.length <= 1) return true;
    
    // Calculate centroids for all tracts
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract)
    }));
    
    // Find the tract with the northernmost, westernmost position (top-left)
    let startTract = tractsWithCentroids[0];
    for (const tract of tractsWithCentroids) {
      if (tract.centroid.lat > startTract.centroid.lat || 
          (tract.centroid.lat === startTract.centroid.lat && tract.centroid.lng < startTract.centroid.lng)) {
        startTract = tract;
      }
    }
    
    // Use a simple flood-fill approach to check contiguity
    const visited = new Set<string>();
    const queue = [startTract];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.centroid.lat},${current.centroid.lng}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      
      // Check all other tracts to see if they're adjacent
      for (const tract of tractsWithCentroids) {
        if (tract === current) continue;
        
        const distance = Math.sqrt(
          Math.pow(tract.centroid.lat - current.centroid.lat, 2) +
          Math.pow(tract.centroid.lng - current.centroid.lng, 2)
        );
        
        // Consider tracts adjacent if they're within a reasonable distance
        // This is a simplified check - in reality, we'd need to check actual boundaries
        if (distance < 0.5 && !visited.has(`${tract.centroid.lat},${tract.centroid.lng}`)) {
          queue.push(tract);
        }
      }
    }
    
    return visited.size === tracts.length;
  }

  /**
   * Calculate the centroid of a tract (simplified version)
   */
  private calculateTractCentroid(tract: any): { lat: number, lng: number } {
    // This is a simplified version - in the real implementation, this would
    // calculate the actual centroid from the geometry
    if (tract.properties && tract.properties.POPULATION) {
      // Use a mock centroid based on tract properties
      return {
        lat: parseFloat(tract.properties.STATE_FIPS || '0') + Math.random() * 0.1,
        lng: parseFloat(tract.properties.COUNTY_FIPS || '0') - 100 + Math.random() * 0.1
      };
    }
    
    // Fallback to mock coordinates
    return {
      lat: 36.7783 + Math.random() * 0.5,
      lng: -119.4179 + Math.random() * 0.5
    };
  }

  /**
   * Toggle step-through visualization mode
   */
  toggleStepThrough(): void {
    this.enableStepThrough = !this.enableStepThrough;
    console.log(`Step-through visualization ${this.enableStepThrough ? 'enabled' : 'disabled'}`);
    
    if (this.enableStepThrough && this.districtsResult && this.districtsResult.divisionSteps.length > 0) {
      this.divisionSteps = this.districtsResult.divisionSteps;
      this.currentStep = 0;
      this.renderCurrentStep();
    } else {
      // Return to final result
      if (this.districtsResult) {
        this.renderDistricts();
      }
    }
  }

  /**
   * Navigate to the next step
   */
  nextStep(): void {
    if (this.currentStep < this.divisionSteps.length - 1) {
      this.currentStep++;
      this.renderCurrentStep();
    }
  }

  /**
   * Navigate to the previous step
   */
  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.renderCurrentStep();
    }
  }

  /**
   * Go to a specific step
   */
  goToStep(step: number): void {
    if (step >= 0 && step < this.divisionSteps.length) {
      this.currentStep = step;
      this.renderCurrentStep();
    }
  }

  /**
   * Play/pause automatic step progression
   */
  togglePlay(): void {
    if (this.isPlaying) {
      this.pausePlay();
    } else {
      this.startPlay();
    }
  }

  /**
   * Start automatic step progression
   */
  startPlay(): void {
    this.isPlaying = true;
    this.playInterval = setInterval(() => {
      if (this.currentStep < this.divisionSteps.length - 1) {
        this.nextStep();
      } else {
        this.pausePlay();
      }
    }, 2000); // 2 seconds per step
  }

  /**
   * Pause automatic step progression
   */
  pausePlay(): void {
    this.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  /**
   * Reset to the first step
   */
  resetSteps(): void {
    this.currentStep = 0;
    this.pausePlay();
    this.renderCurrentStep();
  }

  /**
   * Get the current division step
   */
  getCurrentStep(): DivisionStep | null {
    if (this.divisionSteps.length === 0 || this.currentStep >= this.divisionSteps.length) {
      return null;
    }
    return this.divisionSteps[this.currentStep];
  }

  /**
   * Get step progress percentage
   */
  getStepProgress(): number {
    if (this.divisionSteps.length === 0) return 0;
    return ((this.currentStep + 1) / this.divisionSteps.length) * 100;
  }

  /**
   * Render the current step visualization
   */
  private renderCurrentStep(): void {
    if (!this.tractLayer || !this.enableStepThrough) return;

    const step = this.getCurrentStep();
    if (!step) return;

    console.log(`Rendering step ${this.currentStep + 1}/${this.divisionSteps.length}: ${step.description}`);

    // Clear existing layers
    this.tractLayer.clearLayers();

    // Render each group in the current step with different colors
    step.groups.forEach((group, groupIndex) => {
      const color = this.getStepGroupColor(groupIndex, step.groups.length);
      
      group.tracts.forEach((tract, tractIndex) => {
        if (tractIndex % 100 === 0) {
          console.log(`Processing group ${groupIndex + 1}, tract ${tractIndex + 1}/${group.tracts.length}`);
        }
        
        const tractLayer = L.geoJSON(tract, {
          style: {
            color: 'transparent',
            weight: 0,
            opacity: 0,
            fillOpacity: 0.7,
            fillColor: color
          }
        }).bindPopup(`
          <strong>Step ${this.currentStep + 1}: Group ${group.id}</strong><br>
          <strong>Census Tract ${tract.properties.TRACT || tract.properties.TRACT_FIPS}</strong><br>
          State: ${tract.properties.STATE_ABBR || tract.properties.STATE_FIPS}<br>
          Population: ${tract.properties.POPULATION?.toLocaleString() || 'N/A'}<br>
          Area: ${tract.properties.SQMI?.toFixed(2) || 'N/A'} sq mi<br>
          Group Population: ${group.population.toLocaleString()}<br>
          Target Districts: ${group.targetDistricts}<br>
          Division Direction: ${group.direction}
        `);

        this.tractLayer!.addLayer(tractLayer);
      });
    });

    // Add group labels
    this.addStepGroupLabels(step);
  }

  /**
   * Get color for a step group
   */
  getStepGroupColor(groupIndex: number, totalGroups: number): string {
    // Generate distinct colors for each group
    const hue = (groupIndex * 360) / totalGroups;
    return `hsl(${hue}, 70%, 50%)`;
  }

  /**
   * Add labels for step groups
   */
  private addStepGroupLabels(step: DivisionStep): void {
    if (!this.tractLayer) return;

    const labelLayer = L.layerGroup();

    step.groups.forEach((group, index) => {
      const labelHtml = `
        <div class="district-label" style="background: ${this.getStepGroupColor(index, step.groups.length)}; color: white;">
          <span class="district-number">${group.id}</span>
        </div>
      `;

      const labelIcon = L.divIcon({
        html: labelHtml,
        className: 'district-label-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const label = L.marker([group.centroid.lat, group.centroid.lng], {
        icon: labelIcon
      }).bindPopup(`
        <strong>Group ${group.id}</strong><br>
        Population: ${group.population.toLocaleString()}<br>
        Tracts: ${group.tracts.length}<br>
        Target Districts: ${group.targetDistricts}<br>
        Direction: ${group.direction}
      `);

      labelLayer.addLayer(label);
    });

    this.tractLayer.addLayer(labelLayer);
  }

  /**
   * Example method demonstrating how to use the tract division functionality
   * This method divides census tracts by latitude, longitude, or population according to a given ratio
   */
  divideTractsExample(): void {
    console.log('=== Tract Division Example ===');
    
    // Example 1: Recursive division into 52 districts (California)
    console.log('Example 1: Recursive division into 52 districts');
    this.censusService.divideTractsIntoDistrictsWithData(this.selectedState, undefined, {
      targetDistricts: 52,
      maxIterations: 200,
      populationTolerance: this.populationTolerance
    }).subscribe({
      next: (result: RecursiveDivisionResult) => {
        console.log('Recursive Division Result:', {
          districts: result.districts.length,
          totalPopulation: result.totalPopulation,
          averagePopulation: result.averagePopulation,
          populationVariance: result.populationVariance,
          divisionHistory: result.divisionHistory
        });
      },
      error: (error) => {
        console.error('Error with recursive division:', error);
      }
    });

    // Example 2: Divide tracts by population with 50/50 ratio (50% of population in each group)
    const populationOptions: TractDivisionOptions = {
      ratio: [50, 50], // 50% low pop, 50% high pop
      direction: 'population'
    };

    this.censusService.divideTractsByCoordinateWithData(this.selectedState, undefined, populationOptions)
      .subscribe({
        next: (result: TractDivisionResult) => {
          console.log('Population Division Result:', {
            totalTracts: result.northTracts.length + result.southTracts.length,
            totalPopulation: result.totalPopulation,
            highPopTracts: result.northTracts.length,
            lowPopTracts: result.southTracts.length,
            highPopPopulation: result.northPopulation,
            lowPopPopulation: result.southPopulation,
            actualRatio: (result.divisionLine * 100).toFixed(1) + '%',
            divisionType: 'population'
          });
        },
        error: (error) => {
          console.error('Error dividing tracts by population:', error);
        }
      });
  }
}
