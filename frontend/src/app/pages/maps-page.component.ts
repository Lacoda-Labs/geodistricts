import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, GeodistrictOptions, AlgorithmType, DistrictGroup } from '../services/geodistrict-algorithm.service';
import { GeoJsonFeature } from '../services/census.service';

declare global {
  interface Window {
    gtag: (command: string, action: string, parameters: any) => void;
  }
}

@Component({
  selector: 'app-maps-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatTabsModule,
    MatChipsModule,
  ],
  templateUrl: './maps-page.component.html',
  styleUrls: ['./maps-page.component.scss'],
})
export class MapsPageComponent implements OnInit, AfterViewInit, OnDestroy {
  selectedState: string = '';
  showTractBoundaries: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';
  canRunNextStep: boolean = false;
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  showSteps: boolean = false;
  activeTab: string = 'Party';
  
  private map: L.Map | null = null;
  private tractLayer: L.LayerGroup | null = null;
  private tractGeoJsonLayers: Map<L.GeoJSON, string> = new Map(); // Store layer -> color mapping
  private subscriptions: Subscription[] = [];

  // US States with their congressional district counts
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

  constructor(
    private geodistrictService: GeodistrictAlgorithmService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Load showTractBoundaries from localStorage
    const saved = localStorage.getItem('showTractBoundaries');
    if (saved !== null) {
      this.showTractBoundaries = saved === 'true';
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializeMap();
    }, 100);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.map) {
      this.map.remove();
    }
  }

  private initializeMap(): void {
    const mapElement = document.getElementById('usMap');
    if (!mapElement || this.map) return;

    // Default to United States view
    this.map = L.map('usMap', {
      scrollWheelZoom: true
    }).setView([39.8283, -98.5795], 4); // Center of US

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Initialize tract layer
    this.tractLayer = L.layerGroup().addTo(this.map);

    // Update layers based on checkbox state
    this.updateMapLayers();
  }

  onStateChange(): void {
    if (this.selectedState) {
      this.updateMapView();
      this.runAlgorithm();
    }
  }

  onTractBoundariesChange(): void {
    // Persist to localStorage
    localStorage.setItem('showTractBoundaries', this.showTractBoundaries.toString());
    
    // Track with gtag
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'toggle_tract_boundaries', {
        event_category: 'Map',
        event_label: this.showTractBoundaries ? 'Show' : 'Hide',
        value: this.showTractBoundaries ? 1 : 0
      });
    }
    
    this.updateMapLayers();
  }

  private updateMapLayers(): void {
    if (!this.map || !this.tractLayer) return;

    // Update existing layer styles instead of re-rendering
    if (this.tractGeoJsonLayers.size > 0) {
      this.tractGeoJsonLayers.forEach((districtColor, layer) => {
        layer.setStyle({
          color: districtColor,
          weight: this.showTractBoundaries ? 1 : 0,
          opacity: this.showTractBoundaries ? 0.8 : 0,
          fillOpacity: 0.7,
          fillColor: districtColor
        });
      });
    } else if (this.algorithmResult) {
      // If no layers exist yet, render them
      this.renderFinalDistricts();
    } else {
      this.tractLayer.clearLayers();
    }
  }

  private updateMapView(): void {
    if (!this.map || !this.selectedState) return;

    const stateCenter = this.getStateCenter(this.selectedState);
    this.map.setView(stateCenter, 7);
  }

  private getStateCenter(stateCode: string): [number, number] {
    const stateCenters: { [key: string]: [number, number] } = {
      'AL': [32.806671, -86.791130],
      'AK': [61.370716, -152.404419],
      'AZ': [33.729759, -111.431221],
      'AR': [34.969704, -92.373123],
      'CA': [36.116203, -119.681564],
      'CO': [39.059811, -105.311104],
      'CT': [41.597782, -72.755371],
      'DE': [39.318523, -75.507141],
      'FL': [27.766279, -81.686783],
      'GA': [33.040619, -83.643074],
      'HI': [21.094318, -157.498337],
      'ID': [44.240459, -114.478828],
      'IL': [40.349457, -88.986137],
      'IN': [39.849426, -86.258278],
      'IA': [42.011539, -93.210526],
      'KS': [38.526600, -96.726486],
      'KY': [37.668140, -84.670067],
      'LA': [31.169546, -91.867805],
      'ME': [44.323535, -69.765261],
      'MD': [39.063946, -76.802101],
      'MA': [42.230171, -71.530106],
      'MI': [43.326618, -84.536095],
      'MN': [45.694454, -93.900192],
      'MS': [32.741646, -89.678696],
      'MO': [38.456085, -92.288368],
      'MT': [46.921925, -110.454353],
      'NE': [41.125370, -98.268082],
      'NV': [38.313515, -117.055374],
      'NH': [43.452492, -71.563896],
      'NJ': [40.298904, -74.521011],
      'NM': [34.840515, -106.248482],
      'NY': [42.165726, -74.948051],
      'NC': [35.630066, -79.806419],
      'ND': [47.528912, -99.784012],
      'OH': [40.388783, -82.764915],
      'OK': [35.565342, -96.928917],
      'OR': [44.572021, -122.070938],
      'PA': [40.590752, -77.209755],
      'RI': [41.680893, -71.51178],
      'SC': [33.856892, -80.945007],
      'SD': [44.299782, -99.438828],
      'TN': [35.747845, -86.692345],
      'TX': [31.054487, -97.563461],
      'UT': [40.150032, -111.862434],
      'VT': [44.045876, -72.710686],
      'VA': [37.769337, -78.169968],
      'WA': [47.400902, -121.490494],
      'WV': [38.491226, -80.954453],
      'WI': [44.268543, -89.616508],
      'WY': [42.755966, -107.302490]
    };

    return stateCenters[stateCode] || [39.8283, -98.5795];
  }

  runAlgorithm(): void {
    if (!this.selectedState) {
      this.errorMessage = 'Please select a state first';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.algorithmResult = null;

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: false,
      forceInvalidate: false,
      maxIterations: 100,
      algorithm: 'latlong' as AlgorithmType
    };

    const subscription = this.geodistrictService.runGeodistrictAlgorithm(options).subscribe({
      next: (result) => {
        console.log('📊 Algorithm result:', {
          steps: result.steps.length,
          finalDistricts: result.finalDistricts?.length || 0,
          lastStepGroups: result.steps[result.steps.length - 1]?.districtGroups?.length || 0
        });
        this.algorithmResult = result;
        // Set to final step (all steps completed)
        this.currentStepIndex = result.steps.length - 1;
        this.currentStep = result.steps[this.currentStepIndex];
        this.isLoading = false;
        this.canRunNextStep = this.canExecuteNextStep(result);
        // Render final districts on map (all steps calculated)
        setTimeout(() => {
          this.renderFinalDistricts();
        }, 200);
      },
      error: (error) => {
        this.errorMessage = error.message || 'An error occurred while running the algorithm';
        this.isLoading = false;
        console.error('Algorithm error:', error);
      }
    });

    this.subscriptions.push(subscription);
  }

  private canExecuteNextStep(result: GeodistrictResult): boolean {
    return result.steps.length > 1 && this.currentStepIndex < result.steps.length - 1;
  }

  previousStep(): void {
    if (this.currentStepIndex > 0 && this.algorithmResult) {
      this.currentStepIndex--;
      this.currentStep = this.algorithmResult.steps[this.currentStepIndex];
      this.canRunNextStep = this.canExecuteNextStep(this.algorithmResult);
    }
  }

  nextStep(): void {
    if (this.algorithmResult && this.canRunNextStep) {
      this.currentStepIndex++;
      this.currentStep = this.algorithmResult.steps[this.currentStepIndex];
      this.canRunNextStep = this.canExecuteNextStep(this.algorithmResult);
    }
  }

  onTabChange(tab: string): void {
    this.activeTab = tab;
  }

  isMobile(): boolean {
    return window.innerWidth <= 768;
  }

  getTabOffset(): string {
    const tabIndex = ['Party', 'Population', 'Demographics'].indexOf(this.activeTab);
    return `-${tabIndex * 100}%`;
  }

  goHome(): void {
    this.router.navigate(['/home']);
  }

  private renderFinalDistricts(): void {
    if (!this.map || !this.tractLayer || !this.algorithmResult) return;

    // Clear existing layers and reset tracking
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers = [];

    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    // Use finalDistricts if available, otherwise use the last step's district groups
    let districtsToRender: DistrictGroup[] = [];
    
    if (this.algorithmResult.finalDistricts && this.algorithmResult.finalDistricts.length > 0) {
      districtsToRender = this.algorithmResult.finalDistricts;
      console.log(`✅ Rendering ${districtsToRender.length} final districts`);
    } else if (this.algorithmResult.steps && this.algorithmResult.steps.length > 0) {
      // Fallback to last step's district groups
      const lastStep = this.algorithmResult.steps[this.algorithmResult.steps.length - 1];
      if (lastStep && lastStep.districtGroups) {
        districtsToRender = lastStep.districtGroups;
        console.log(`⚠️ Using last step's ${districtsToRender.length} district groups (finalDistricts not available)`);
      }
    }

    if (districtsToRender.length === 0) {
      console.warn('⚠️ No districts to render');
      return;
    }

    // Render final districts (all steps calculated)
    districtsToRender.forEach((district, index) => {
      const color = this.getDistrictColor(index, districtsToRender.length);
      
      // Add each tract in the district
      district.censusTracts.forEach((tract: GeoJsonFeature) => {
        if (tract.geometry) {
          const geoJson = L.geoJSON(tract.geometry, {
            style: {
              color: color, // Border color matches district color
              weight: this.showTractBoundaries ? 1 : 0, // Set weight to 0 when hiding to completely remove border
              opacity: this.showTractBoundaries ? 0.8 : 0, // Set opacity to 0 when hiding
              fillOpacity: 0.7,
              fillColor: color
            }
          }).bindPopup(`
            <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
            <strong>Tract ID:</strong> ${tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || 'Unknown'}<br>
            <strong>Population:</strong> ${(tract.properties?.POPULATION || 0).toLocaleString()}<br>
            <strong>District Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
            <strong>Tracts in District:</strong> ${district.censusTracts.length}
          `);

          this.tractLayer!.addLayer(geoJson);
          this.tractGeoJsonLayers.set(geoJson, color); // Store layer -> color mapping for style updates

          // Extend bounds
          const tractBounds = geoJson.getBounds();
          if (tractBounds.isValid()) {
            bounds.extend(tractBounds);
            hasBounds = true;
          }
        }
      });
    });

    // Fit map to show all districts
    if (hasBounds && bounds.isValid() && this.map) {
      this.map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  private getDistrictColor(districtIndex: number, totalDistricts: number): string {
    // Generate distinct colors for each district
    const hue = (districtIndex * 360) / totalDistricts;
    return `hsl(${hue}, 70%, 50%)`;
  }
}

