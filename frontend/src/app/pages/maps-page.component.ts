import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, GeodistrictOptions, DistrictGroup, DivisionLineInfo } from '../services/geodistrict-algorithm.service';
import { GeoJsonFeature } from '../services/census.service';
import { PageHeaderComponent } from '../components/page-header.component';

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
    MatChipsModule,
    PageHeaderComponent,
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
  
  private map: L.Map | null = null;
  private tractLayer: L.LayerGroup | null = null;
  private tractGeoJsonLayers: Map<L.GeoJSON, string> = new Map(); // Store layer -> color mapping
  private subscriptions: Subscription[] = [];
  private divisionLineLayers: L.Polyline[] = []; // Track all division line layers
  private divisionLinesByStep: Map<number, L.Polyline[]> = new Map(); // Track division lines by step number
  private divisionLineMarkers: L.Marker[] = []; // Track all division line markers
  private animatedLineLayers: L.Layer[] = []; // Track animated line layers for cleanup
  private loadedSteps: GeodistrictStep[] = []; // Store steps as they arrive
  private totalSteps: number = 0; // Total number of steps (known when complete)
  private isLoadingSteps: boolean = false; // Track if we're currently loading steps

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

    // Load selected state from localStorage
    const savedState = localStorage.getItem('selectedState');
    if (savedState) {
      this.selectedState = savedState;
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializeMap();
      // If a state was saved, automatically run the algorithm after map is initialized
      if (this.selectedState) {
        // Wait a bit longer to ensure map is fully initialized
        setTimeout(() => {
          this.updateMapView();
          this.runAlgorithm();
        }, 300);
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.clearDivisionLines();
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

  onStateChangeFromHeader(state: string): void {
    this.selectedState = state;
    if (this.selectedState) {
      // Persist selected state to localStorage
      localStorage.setItem('selectedState', this.selectedState);
      this.updateMapView();
      this.runAlgorithm();
    } else {
      // Clear saved state if no state is selected
      localStorage.removeItem('selectedState');
    }
  }

  onStateChange(): void {
    if (this.selectedState) {
      // Persist selected state to localStorage
      localStorage.setItem('selectedState', this.selectedState);
      this.updateMapView();
      this.runAlgorithm();
    } else {
      // Clear saved state if no state is selected
      localStorage.removeItem('selectedState');
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

    // When toggling between tracts and union polygons, we need to re-render
    // because we're switching between different geometries
    if (this.algorithmResult && this.currentStep) {
      // Re-render to show either individual tracts or union polygons
      this.renderFinalDistricts();
    } else if (this.tractGeoJsonLayers.size > 0) {
      // Fallback: update existing layer styles if no algorithm result
      this.tractGeoJsonLayers.forEach((districtColor, layer) => {
        layer.setStyle({
          color: this.showTractBoundaries ? '#000000' : districtColor, // Black borders when checked, match fill when unchecked
          weight: this.showTractBoundaries ? 0.5 : 0.3, // Thin borders
          opacity: this.showTractBoundaries ? 0.8 : 0.2, // Full opacity when checked, subtle when unchecked
          fillOpacity: 0.7,
          fillColor: districtColor
        });
      });
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

    // Reset state
    this.isLoading = true;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
    this.currentStep = null;
    this.totalSteps = 0;

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: false,
      forceInvalidate: false,
      maxIterations: 100
    };

    console.log(`🚀 Initializing algorithm for ${this.selectedState}`);

    // Initialize algorithm and load step 0
    const subscription = this.geodistrictService.initializeAlgorithm(options).subscribe({
      next: (stepData) => {
        const { step, stepIndex, isComplete } = stepData;
        console.log(`📥 Received step ${stepIndex}:`, step.description);

        // Store the step
        this.loadedSteps[stepIndex] = step;

        // Display step 0 immediately
        this.currentStepIndex = 0;
        this.currentStep = step;
        this.isLoading = false; // Stop showing loading spinner after step 0
        
        // Create a minimal algorithmResult for rendering
        this.algorithmResult = {
          finalDistricts: step.districtGroups,
          steps: [step],
          totalPopulation: step.districtGroups.reduce((sum, g) => sum + g.totalPopulation, 0),
          averagePopulation: 0,
          populationVariance: 0,
          algorithmHistory: []
        };

        console.log(`✅ Step 0 loaded: ${step.districtGroups[0]?.censusTracts.length || 0} tracts`);
        console.log(`🔍 Step 0 districtGroups:`, step.districtGroups);
        console.log(`🔍 First district group tracts:`, step.districtGroups[0]?.censusTracts?.slice(0, 3));
        
        // Render step 0 on map - wait a bit longer to ensure map is ready
        setTimeout(() => {
          console.log(`🖼️ About to render step 0, map initialized: ${!!this.map}, tractLayer initialized: ${!!this.tractLayer}`);
          console.log(`🖼️ currentStep:`, this.currentStep);
          console.log(`🖼️ algorithmResult:`, this.algorithmResult);
          if (!this.map || !this.tractLayer) {
            console.error('⚠️ Map or tractLayer not initialized, retrying in 500ms...');
            setTimeout(() => {
              this.renderFinalDistricts();
            }, 500);
          } else {
            this.renderFinalDistricts();
          }
        }, 500);
      },
      error: (error) => {
        this.errorMessage = error.message || 'An error occurred while initializing the algorithm';
        this.isLoading = false;
        this.isLoadingSteps = false;
        console.error('Algorithm initialization error:', error);
      }
    });

    this.subscriptions.push(subscription);
  }

  private canExecuteNextStep(result: GeodistrictResult): boolean {
    if (!result) return false;
    return result.steps.length > 1 && this.currentStepIndex < result.steps.length - 1;
  }

  getTotalSteps(): number {
    return this.totalSteps || this.loadedSteps.filter(s => s !== undefined).length || 0;
  }

  canGoToNextStep(): boolean {
    // Can go to next step if:
    // 1. Next step is already loaded, OR
    // 2. Algorithm is not complete (we can request next step)
    const nextIndex = this.currentStepIndex + 1;
    if (this.loadedSteps[nextIndex] !== undefined) {
      return true;
    }
    // Check if algorithm is complete by looking at current step
    if (this.currentStep) {
      // If current step shows all groups have totalDistricts === 1, algorithm is complete
      const allComplete = this.currentStep.districtGroups.every(g => g.totalDistricts === 1);
      return !allComplete && !this.isLoading;
    }
    return false;
  }

  previousStep(): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      const step = this.loadedSteps[this.currentStepIndex];
      if (step) {
        this.currentStep = step;
        this.renderFinalDistricts(); // Re-render map for the new step
      } else {
        console.warn(`⚠️ Step ${this.currentStepIndex} not yet loaded`);
        // Revert the index change
        this.currentStepIndex++;
      }
    }
  }

  nextStep(): void {
    const nextIndex = this.currentStepIndex + 1;
    const step = this.loadedSteps[nextIndex];
    
    if (step) {
      // Step already loaded, just display it
      this.currentStepIndex = nextIndex;
      this.currentStep = step;
      this.renderFinalDistricts();
    } else {
      // Step not loaded yet, request it from backend
      console.log(`🚀 Requesting step ${nextIndex} from backend...`);
      this.isLoading = true;
      
      const options: GeodistrictOptions = {
        state: this.selectedState,
        useDirectAPI: false,
        forceInvalidate: false,
        maxIterations: 100,
      };

      const subscription = this.geodistrictService.executeNextStep(options).subscribe({
        next: (stepData) => {
          const { step: newStep, stepIndex, isComplete } = stepData;
          console.log(`📥 Received step ${stepIndex}:`, newStep.description);

          // Store the step
          this.loadedSteps[stepIndex] = newStep;
          
          // Display the step
          this.currentStepIndex = stepIndex;
          this.currentStep = newStep;
          this.isLoading = false;

          // Update algorithmResult
          if (this.algorithmResult) {
            this.algorithmResult.steps = this.loadedSteps.filter(s => s !== undefined);
            this.algorithmResult.finalDistricts = newStep.districtGroups;
          }

          // Render the step on map
          setTimeout(() => {
            this.renderFinalDistricts();
          }, 100);

          // If complete, update total steps
          if (isComplete) {
            this.isLoadingSteps = false;
            this.totalSteps = this.loadedSteps.filter(s => s !== undefined).length;
            console.log(`✅ Algorithm completed: ${this.totalSteps} total steps`);
          }
        },
        error: (error) => {
          this.errorMessage = error.message || 'An error occurred while executing the next step';
          this.isLoading = false;
          console.error('Next step execution error:', error);
        }
      });

      this.subscriptions.push(subscription);
    }
  }

  goHome(): void {
    this.router.navigate(['/home']);
  }

  private renderFinalDistricts(): void {
    if (!this.map) {
      console.error('⚠️ Map not initialized');
      return;
    }
    if (!this.tractLayer) {
      console.error('⚠️ Tract layer not initialized');
      return;
    }
    if (!this.algorithmResult) {
      console.error('⚠️ Algorithm result not available');
      return;
    }

    console.log('🖼️ Rendering districts on map...');

    // Clear existing layers and reset tracking
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.clearDivisionLines();

    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    // Use current step's district groups if available, otherwise use finalDistricts
    let districtsToRender: DistrictGroup[] = [];
    
    if (this.currentStep && this.currentStep.districtGroups && this.currentStep.districtGroups.length > 0) {
      // Union polygons are created on the backend
      // Render the current step's district groups
      districtsToRender = this.currentStep.districtGroups;
      console.log(`✅ Rendering step ${this.currentStepIndex}: ${districtsToRender.length} district groups`);
      console.log(`🔍 First district group has ${districtsToRender[0]?.censusTracts?.length || 0} tracts`);
      console.log(`🔍 First district group has union polygon: ${!!districtsToRender[0]?.unionPolygon}`);
      if (districtsToRender[0]?.unionPolygon) {
        console.log(`🔍 Union polygon geometry type: ${districtsToRender[0].unionPolygon.geometry?.type}`);
      }
      console.log(`🔍 showTractBoundaries: ${this.showTractBoundaries}`);
      if (districtsToRender[0]?.censusTracts?.length > 0) {
        console.log(`🔍 First tract sample:`, districtsToRender[0].censusTracts[0]);
        console.log(`🔍 First tract has geometry:`, !!districtsToRender[0].censusTracts[0]?.geometry);
      }
    } else if (this.algorithmResult.finalDistricts && this.algorithmResult.finalDistricts.length > 0) {
      // Fallback to finalDistricts if no current step
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

    let totalTracts = 0;

    // Render final districts (all steps calculated)
    districtsToRender.forEach((district, index) => {
      const color = this.getDistrictColor(index, districtsToRender.length);
      
      if (!district.censusTracts || district.censusTracts.length === 0) {
        console.warn(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber} has no tracts`);
        return;
      }
      
      // If showTractBoundaries is false and union polygon exists, render the union polygon
      if (!this.showTractBoundaries && district.unionPolygon && district.unionPolygon.geometry) {
        console.log(`✅ Rendering union polygon for district ${district.startDistrictNumber}-${district.endDistrictNumber}`);
        try {
          const unionProperties = district.unionPolygon.properties || {};
          
          const geoJson = L.geoJSON(district.unionPolygon, {
            style: {
              color: color, // Match fill color for seamless appearance
              weight: 2, // Slightly thicker border for district outline
              opacity: 1.0, // Full opacity for district boundaries
              fillOpacity: 0.7,
              fillColor: color
            }
          }).bindPopup(`
            <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
            <strong>Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
            <strong>Tracts in District:</strong> ${district.censusTracts.length}
          `);

          this.tractLayer!.addLayer(geoJson);
          this.tractGeoJsonLayers.set(geoJson, color); // Store layer -> color mapping for style updates
          totalTracts++;

          // Extend bounds
          const unionBounds = geoJson.getBounds();
          if (unionBounds && unionBounds.isValid()) {
            bounds.extend(unionBounds);
            hasBounds = true;
          }
        } catch (error) {
          console.error('⚠️ Error rendering union polygon:', error, district.unionPolygon);
          // Fall through to render individual tracts if union fails
        }
      } else {
        // Render individual tracts (when showTractBoundaries is true or union polygon not available)
        if (!this.showTractBoundaries) {
          console.log(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber}: showTractBoundaries=false but union polygon not available (has union: ${!!district.unionPolygon}, has geometry: ${!!district.unionPolygon?.geometry})`);
        }
        district.censusTracts.forEach((tract: GeoJsonFeature) => {
          if (!tract) {
            console.warn('⚠️ Null tract found in district');
            return;
          }
          // Check if tract has geometry (either as property or is itself a geometry)
          const hasGeometry = !!(tract.geometry || (tract.type && (tract.type === 'Feature' || tract.type === 'Polygon' || tract.type === 'MultiPolygon')));
          if (!hasGeometry) {
            const tractId = tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || 'Unknown';
            console.warn('⚠️ Tract missing geometry:', tractId, tract);
            return;
          }
          
          try {
            // Get tract properties for popup
            const tractProperties = tract.properties || {};
            
            // Tracts should be GeoJSON Features - pass directly to L.geoJSON
            const geoJson = L.geoJSON(tract, {
              style: {
                color: this.showTractBoundaries ? '#000000' : color, // Black borders when checked, match fill when unchecked
                weight: this.showTractBoundaries ? 0.5 : 0.3, // Thin borders
                opacity: this.showTractBoundaries ? 0.8 : 0.2, // Full opacity when checked, subtle when unchecked
                fillOpacity: 0.7,
                fillColor: color
              }
            }).bindPopup(`
              <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
              <strong>Tract ID:</strong> ${tractProperties.TRACT_FIPS || tractProperties['GEOID'] || 'Unknown'}<br>
              <strong>Population:</strong> ${(tractProperties.POPULATION || 0).toLocaleString()}<br>
              <strong>District Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
              <strong>Tracts in District:</strong> ${district.censusTracts.length}
            `);

            this.tractLayer!.addLayer(geoJson);
            this.tractGeoJsonLayers.set(geoJson, color); // Store layer -> color mapping for style updates
            totalTracts++;

            // Extend bounds
            const tractBounds = geoJson.getBounds();
            if (tractBounds && tractBounds.isValid()) {
              bounds.extend(tractBounds);
              hasBounds = true;
            }
          } catch (error) {
            console.error('⚠️ Error rendering tract:', error, tract);
          }
        });
      }
    });

    console.log(`✅ Rendered ${totalTracts} tracts across ${districtsToRender.length} districts`);

    // Fit map to show all districts
    if (hasBounds && bounds.isValid() && this.map) {
      this.map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Render division lines for current step and all previous steps
    this.renderDivisionLines();
  }

  /**
   * Clear all division lines from the map
   */
  private clearDivisionLines(): void {
    // Remove all division line layers
    this.divisionLineLayers.forEach(layer => {
      if (this.map) {
        this.map.removeLayer(layer);
      }
    });
    this.divisionLineLayers = [];

    // Remove all division line markers
    this.divisionLineMarkers.forEach(marker => {
      if (this.map) {
        this.map.removeLayer(marker);
      }
    });
    this.divisionLineMarkers = [];

    // Clear animated layers
    this.animatedLineLayers.forEach(layer => {
      if (this.map) {
        this.map.removeLayer(layer);
      }
    });
    this.animatedLineLayers = [];

    this.divisionLinesByStep.clear();
  }

  /**
   * Render division lines for current step and all previous steps
   */
  private renderDivisionLines(): void {
    if (!this.map || !this.currentStep) return;

    // Clear existing division lines
    this.clearDivisionLines();

    // Add static lines for all previous steps
    for (let stepIdx = 0; stepIdx < this.currentStepIndex; stepIdx++) {
      const step = this.loadedSteps[stepIdx];
      if (step && step.divisionLines && step.divisionLines.length > 0) {
        this.addStaticDivisionLinesForStep(step, stepIdx);
      }
    }

    // Animate division lines for current step
    if (this.currentStep.divisionLines && this.currentStep.divisionLines.length > 0) {
      this.animateCurrentStepDivisionLines(this.currentStep, this.currentStepIndex);
    }
  }

  /**
   * Add static division lines for a previous step
   */
  private addStaticDivisionLinesForStep(step: GeodistrictStep, stepIdx: number): void {
    if (!this.map || !step.divisionLines || step.divisionLines.length === 0) return;

    const stepDivisionLines: L.Polyline[] = [];

    for (const divLineInfo of step.divisionLines) {
      const staticLine = this.createStaticDivisionLine(divLineInfo, stepIdx);
      if (staticLine) {
        stepDivisionLines.push(staticLine);
      }
    }

    if (stepDivisionLines.length > 0) {
      this.divisionLinesByStep.set(stepIdx, stepDivisionLines);
    }
  }

  /**
   * Animate division lines for the current step
   */
  private async animateCurrentStepDivisionLines(step: GeodistrictStep, stepIdx: number): Promise<void> {
    if (!this.map || !step.divisionLines || step.divisionLines.length === 0) {
      return;
    }

    const stepDivisionLines: L.Polyline[] = [];
    const animationPromises: Promise<L.Polyline | null>[] = [];

    // Start all animations for this step simultaneously
    for (const divLineInfo of step.divisionLines) {
      const animationPromise = this.createAnimatedDivisionLine(divLineInfo, stepIdx);
      if (animationPromise) {
        animationPromises.push(animationPromise);
      }
    }

    // Wait for all animations to complete
    if (animationPromises.length > 0) {
      try {
        const completedLines = await Promise.all(animationPromises);
        stepDivisionLines.push(...completedLines.filter(line => line !== null) as L.Polyline[]);
      } catch (error) {
        console.error(`Error animating division lines for step ${stepIdx}:`, error);
      }
    }

    // Store division lines for this step
    if (stepDivisionLines.length > 0) {
      this.divisionLinesByStep.set(stepIdx, stepDivisionLines);
    }
  }

  /**
   * Create a static division line (no animation)
   */
  private createStaticDivisionLine(divLineInfo: DivisionLineInfo, stepIdx: number): L.Polyline | null {
    try {
      const { line: divisionLine, direction, parentGroup, ratio: divisionRatio } = divLineInfo;

      // Get bounds from the previous step (where the parent group existed)
      let groupBounds: L.LatLngBounds | null = null;
      if (stepIdx > 0) {
        const prevStep = this.loadedSteps[stepIdx - 1];
        if (prevStep) {
          const parentGroupInPrevStep = prevStep.districtGroups.find(g =>
            g.startDistrictNumber === parentGroup.startDistrictNumber &&
            g.endDistrictNumber === parentGroup.endDistrictNumber
          );

          if (parentGroupInPrevStep && parentGroupInPrevStep.bounds) {
            groupBounds = L.latLngBounds(
              L.latLng(parentGroupInPrevStep.bounds.south, parentGroupInPrevStep.bounds.west),
              L.latLng(parentGroupInPrevStep.bounds.north, parentGroupInPrevStep.bounds.east)
            );
          } else if (parentGroupInPrevStep) {
            // Calculate bounds from tracts
            groupBounds = this.calculateGroupBounds(parentGroupInPrevStep.censusTracts);
          }
        }
      }

      if (!groupBounds || !groupBounds.isValid()) {
        // Fallback: use map bounds
        if (this.map) {
          groupBounds = this.map.getBounds();
        } else {
          return null;
        }
      }

      let lineCoordinates: L.LatLng[] | null = null;

      if (direction === 'latitude') {
        const minLng = groupBounds.getWest();
        const maxLng = groupBounds.getEast();
        const lineLat = divisionLine;
        const south = groupBounds.getSouth();
        const north = groupBounds.getNorth();

        if (lineLat < south) {
          lineCoordinates = [L.latLng(south, minLng), L.latLng(south, maxLng)];
        } else if (lineLat > north) {
          lineCoordinates = [L.latLng(north, minLng), L.latLng(north, maxLng)];
        } else {
          lineCoordinates = [L.latLng(lineLat, minLng), L.latLng(lineLat, maxLng)];
        }
      } else {
        const minLat = groupBounds.getSouth();
        const maxLat = groupBounds.getNorth();
        const lineLng = divisionLine;
        const west = groupBounds.getWest();
        const east = groupBounds.getEast();

        if (lineLng < west) {
          lineCoordinates = [L.latLng(minLat, west), L.latLng(maxLat, west)];
        } else if (lineLng > east) {
          lineCoordinates = [L.latLng(minLat, east), L.latLng(maxLat, east)];
        } else {
          lineCoordinates = [L.latLng(minLat, lineLng), L.latLng(maxLat, lineLng)];
        }
      }

      if (!lineCoordinates || lineCoordinates.some(coord => !coord || isNaN(coord.lat) || isNaN(coord.lng))) {
        return null;
      }

      const divisionLineLayer = L.polyline(lineCoordinates, {
        color: '#ff0000',
        weight: 2,
        opacity: 0.6,
        dashArray: '10, 5'
      });

      divisionLineLayer.bindPopup(`
        <strong>Division Line</strong><br>
        Step ${stepIdx + 1}<br>
        ${direction === 'latitude' ? 'Latitude' : 'Longitude'}: ${divisionLine.toFixed(6)}${direction === 'latitude' ? '°N' : '°W'}<br>
        Dividing group (Districts ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber})<br>
        Ratio: ${divisionRatio[0]}% / ${divisionRatio[1]}%
      `);

      divisionLineLayer.addTo(this.map!);
      this.divisionLineLayers.push(divisionLineLayer);

      return divisionLineLayer;
    } catch (error) {
      console.error(`Error creating static division line for step ${stepIdx}:`, error);
      return null;
    }
  }

  /**
   * Create and animate a single division line
   */
  private async createAnimatedDivisionLine(divLineInfo: DivisionLineInfo, stepIdx: number): Promise<L.Polyline | null> {
    try {
      const { line: divisionLine, direction, parentGroup, ratio: divisionRatio } = divLineInfo;

      // Get bounds from the previous step (where the parent group existed before division)
      let groupBounds: L.LatLngBounds | null = null;
      if (stepIdx > 0) {
        const prevStep = this.loadedSteps[stepIdx - 1];
        if (prevStep) {
          const parentGroupInPrevStep = prevStep.districtGroups.find(g =>
            g.startDistrictNumber === parentGroup.startDistrictNumber &&
            g.endDistrictNumber === parentGroup.endDistrictNumber
          );

          if (parentGroupInPrevStep && parentGroupInPrevStep.bounds) {
            groupBounds = L.latLngBounds(
              L.latLng(parentGroupInPrevStep.bounds.south, parentGroupInPrevStep.bounds.west),
              L.latLng(parentGroupInPrevStep.bounds.north, parentGroupInPrevStep.bounds.east)
            );
          } else if (parentGroupInPrevStep) {
            // Calculate bounds from tracts
            groupBounds = this.calculateGroupBounds(parentGroupInPrevStep.censusTracts);
          }
        }
      }

      if (!groupBounds || !groupBounds.isValid()) {
        // Fallback: use map bounds
        if (this.map) {
          groupBounds = this.map.getBounds();
        } else {
          return null;
        }
      }

      let lineCoordinates: L.LatLng[] | null = null;

      if (direction === 'latitude') {
        const minLng = groupBounds.getWest();
        const maxLng = groupBounds.getEast();
        const lineLat = divisionLine;
        const south = groupBounds.getSouth();
        const north = groupBounds.getNorth();

        if (lineLat < south) {
          lineCoordinates = [L.latLng(south, minLng), L.latLng(south, maxLng)];
        } else if (lineLat > north) {
          lineCoordinates = [L.latLng(north, minLng), L.latLng(north, maxLng)];
        } else {
          lineCoordinates = [L.latLng(lineLat, minLng), L.latLng(lineLat, maxLng)];
        }
      } else {
        const minLat = groupBounds.getSouth();
        const maxLat = groupBounds.getNorth();
        const lineLng = divisionLine;
        const west = groupBounds.getWest();
        const east = groupBounds.getEast();

        if (lineLng < west) {
          lineCoordinates = [L.latLng(minLat, west), L.latLng(maxLat, west)];
        } else if (lineLng > east) {
          lineCoordinates = [L.latLng(minLat, east), L.latLng(maxLat, east)];
        } else {
          lineCoordinates = [L.latLng(minLat, lineLng), L.latLng(maxLat, lineLng)];
        }
      }

      if (!lineCoordinates || lineCoordinates.some(coord => !coord || isNaN(coord.lat) || isNaN(coord.lng))) {
        return null;
      }

      // Animate the drawing of the division line
      if (this.map) {
        const divisionLineLayer = await this.animateLineDrawing(lineCoordinates, this.map, {
          duration: 1500, // 1.5 seconds animation
          color: '#ff0000',
          weight: 3,
          dashArray: '10, 5',
          dotSize: 10
        });

        // Bind popup to the animated line after animation completes
        divisionLineLayer.bindPopup(`
          <strong>Division Line</strong><br>
          Step ${stepIdx + 1}<br>
          ${direction === 'latitude' ? 'Latitude' : 'Longitude'}: ${divisionLine.toFixed(6)}${direction === 'latitude' ? '°N' : '°W'}<br>
          Dividing group (Districts ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber})<br>
          Ratio: ${divisionRatio[0]}% / ${divisionRatio[1]}%
        `);

        // Track the final line
        this.divisionLineLayers.push(divisionLineLayer);

        return divisionLineLayer;
      }

      return null;
    } catch (error) {
      console.error(`Error creating animated division line for step ${stepIdx}:`, error);
      return null;
    }
  }

  /**
   * Animate the drawing of a line with a moving dot effect
   */
  private animateLineDrawing(
    coordinates: L.LatLng[],
    map: L.Map,
    options: {
      duration?: number;
      color?: string;
      weight?: number;
      dashArray?: string;
      dotSize?: number;
      onComplete?: () => void;
    } = {}
  ): Promise<L.Polyline> {
    const {
      duration = 2000,
      color = '#ff0000',
      weight = 3,
      dashArray = '10, 5',
      dotSize = 8,
      onComplete
    } = options;

    return new Promise((resolve) => {
      if (coordinates.length < 2) {
        // Create final line immediately if not enough points
        const finalLine = L.polyline(coordinates, { color, weight, opacity: 0.8, dashArray });
        finalLine.addTo(map);
        resolve(finalLine);
        return;
      }

      // Calculate total distance for smooth animation
      let totalDistance = 0;
      const distances: number[] = [0];

      for (let i = 1; i < coordinates.length; i++) {
        const segmentDistance = coordinates[i - 1].distanceTo(coordinates[i]);
        totalDistance += segmentDistance;
        distances.push(totalDistance);
      }

      // Create animated dot (laser pointer)
      const dotIcon = L.divIcon({
        className: 'animated-line-dot',
        html: `<div style="
          width: ${dotSize}px;
          height: ${dotSize}px;
          background-color: ${color};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 10px ${color}, 0 0 20px ${color};
          animation: pulse 0.5s infinite;
        "></div>`,
        iconSize: [dotSize, dotSize],
        iconAnchor: [dotSize / 2, dotSize / 2]
      });

      const dotMarker = L.marker(coordinates[0], { icon: dotIcon });
      dotMarker.addTo(map);
      this.animatedLineLayers.push(dotMarker);

      // Create the line that will be drawn progressively
      const animatedLine = L.polyline([], {
        color,
        weight,
        opacity: 0.9,
        dashArray: undefined // No dash array during animation
      });
      animatedLine.addTo(map);
      this.animatedLineLayers.push(animatedLine);

      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Find which segment we're currently on
        const targetDistance = progress * totalDistance;
        let segmentIndex = 0;

        for (let i = 1; i < distances.length; i++) {
          if (targetDistance <= distances[i]) {
            segmentIndex = i - 1;
            break;
          }
        }

        // Calculate position within current segment
        const segmentStartDistance = distances[segmentIndex];
        const segmentEndDistance = distances[segmentIndex + 1];
        const segmentProgress = (targetDistance - segmentStartDistance) / (segmentEndDistance - segmentStartDistance);

        // Interpolate position
        const startCoord = coordinates[segmentIndex];
        const endCoord = coordinates[segmentIndex + 1];
        const currentLat = startCoord.lat + (endCoord.lat - startCoord.lat) * segmentProgress;
        const currentLng = startCoord.lng + (endCoord.lng - startCoord.lng) * segmentProgress;

        const currentPos = L.latLng(currentLat, currentLng);

        // Update dot position
        dotMarker.setLatLng(currentPos);

        // Update line geometry (include all points up to current position)
        const lineCoords = coordinates.slice(0, segmentIndex + 1);
        if (segmentIndex < coordinates.length - 1) {
          lineCoords.push(currentPos);
        }
        animatedLine.setLatLngs(lineCoords);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation complete - replace with final line
          map.removeLayer(dotMarker);
          map.removeLayer(animatedLine);

          // Create final static line
          const finalLine = L.polyline(coordinates, { color, weight, opacity: 0.8, dashArray });
          finalLine.addTo(map);

          // Clean up animated layers
          this.animatedLineLayers = this.animatedLineLayers.filter(layer =>
            layer !== dotMarker && layer !== animatedLine
          );

          if (onComplete) onComplete();
          resolve(finalLine);
        }
      };

      // Start animation
      requestAnimationFrame(animate);
    });
  }

  /**
   * Calculate bounds for a group of tracts
   */
  private calculateGroupBounds(tracts: GeoJsonFeature[]): L.LatLngBounds {
    const bounds = L.latLngBounds([]);
    for (const tract of tracts) {
      if (tract.geometry) {
        const geoJson = L.geoJSON(tract.geometry);
        const tractBounds = geoJson.getBounds();
        if (tractBounds.isValid()) {
          bounds.extend(tractBounds);
        }
      }
    }
    return bounds;
  }

  private getDistrictColor(districtIndex: number, totalDistricts: number): string {
    // Generate distinct colors for each district
    const hue = (districtIndex * 360) / totalDistricts;
    return `hsl(${hue}, 70%, 50%)`;
  }
}

