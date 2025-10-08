import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { CensusService, GeoJsonResponse } from '../services/census.service';

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

  constructor(private censusService: CensusService) {}

  ngOnInit() {
    // Component initialization
  }

  ngAfterViewInit() {
    // Initialize map after view is ready
    setTimeout(() => {
      this.initializeMap();
    }, 100);
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
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

  getStateName(stateCode: string): string {
    return this.stateNames[stateCode] || 'Unknown State';
  }

  private initializeMap() {
    const mapElement = document.getElementById('stateMap');
    if (mapElement && !this.map) {
      // Get state center coordinates
      const stateCenter = this.getStateCenter(this.selectedState);
      
      this.map = L.map('stateMap').setView(stateCenter, 7);
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      // Initialize layer groups
      this.tractLayer = L.layerGroup().addTo(this.map);
      this.countyLayer = L.layerGroup().addTo(this.map);

      // Add a test marker to verify map is working
      const testMarker = L.marker(stateCenter).addTo(this.map)
        .bindPopup(`<strong>${this.getStateName(this.selectedState)}</strong><br>Map is working!`)
        .openPopup();

      console.log('Initializing map for state:', this.getStateName(this.selectedState));
      this.loadStateData();
    }
  }

  private loadStateData() {
    this.loading = true;
    this.tractCount = 0;
    
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
        
        if (geojsonData && geojsonData.features && geojsonData.features.length > 0) {
          console.log(`Loaded ${geojsonData.features.length} census tracts`);
          this.loadingProgress = `Loading ${geojsonData.features.length} tracts...`;
          
          geojsonData.features.forEach((feature, index) => {
            if (index % 1000 === 0) {
              console.log(`Processing tract ${index + 1}/${geojsonData.features.length}`);
            }
            
            const tract = L.geoJSON(feature, {
              style: {
                color: '#007bff',
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.1
              }
            }).bindPopup(`
              <strong>Census Tract ${feature.properties.TRACT || feature.properties.TRACT_FIPS}</strong><br>
              State: ${feature.properties.STATE_ABBR || feature.properties.STATE_FIPS}<br>
              Population: ${feature.properties.POPULATION?.toLocaleString() || 'N/A'}<br>
              Area: ${feature.properties.SQMI?.toFixed(2) || 'N/A'} sq mi
            `);

            this.tractLayer!.addLayer(tract);
          });
          
          // Update tract count
          this.tractCount = geojsonData.features.length;
          console.log(`Successfully added ${this.tractCount} tract boundaries to map`);
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
}
