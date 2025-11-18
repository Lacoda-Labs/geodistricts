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
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, GeodistrictOptions, AlgorithmType, DistrictGroup, DivisionLineInfo } from '../services/geodistrict-algorithm.service';
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
  private divisionLineLayers: L.Polyline[] = []; // Track all division line layers
  private divisionLinesByStep: Map<number, L.Polyline[]> = new Map(); // Track division lines by step number
  private divisionLineMarkers: L.Marker[] = []; // Track all division line markers
  private animatedLineLayers: L.Layer[] = []; // Track animated line layers for cleanup

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
          color: this.showTractBoundaries ? '#000000' : districtColor, // Black borders when checked, match fill when unchecked
          weight: this.showTractBoundaries ? 2 : 1, // Thicker borders when checked
          opacity: this.showTractBoundaries ? 1.0 : 0.3, // Full opacity when checked, subtle when unchecked
          fillOpacity: 0.7,
          fillColor: districtColor
        });
      });
    } else if (this.algorithmResult && this.currentStep) {
      // If no layers exist yet, render current step
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

    const subscription = this.geodistrictService.runGeodistrictAlgorithmStepByStep(options).subscribe({
      next: (result) => {
        console.log('Algorithm result received:', result);
        if (!result) {
          this.errorMessage = 'Algorithm returned no result';
          this.isLoading = false;
          console.error('Algorithm returned null/undefined result');
          return;
        }
        if (!result.steps || result.steps.length === 0) {
          this.errorMessage = 'Algorithm returned no steps';
          this.isLoading = false;
          console.error('Algorithm returned empty steps array');
          return;
        }
        this.algorithmResult = result;
        // Set to first step (step 0 - initial state)
        this.currentStepIndex = 0;
        this.currentStep = result.steps[this.currentStepIndex];
        console.log(`✅ Algorithm completed: ${result.steps.length} steps, current step: ${this.currentStepIndex}`);
        this.isLoading = false;
        this.canRunNextStep = this.canExecuteNextStep(result);
        // Render first step on map
        setTimeout(() => {
          this.updateMapLayers();
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
      this.renderFinalDistricts(); // Re-render map for the new step
    }
  }

  nextStep(): void {
    if (this.algorithmResult && this.currentStepIndex < this.algorithmResult.steps.length - 1) {
      this.currentStepIndex++;
      this.currentStep = this.algorithmResult.steps[this.currentStepIndex];
      this.renderFinalDistricts(); // Re-render map for the new step
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
      // Render the current step's district groups
      districtsToRender = this.currentStep.districtGroups;
      console.log(`✅ Rendering step ${this.currentStepIndex + 1}: ${districtsToRender.length} district groups`);
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
      
      // Add each tract in the district
      district.censusTracts.forEach((tract: GeoJsonFeature) => {
        if (!tract) {
          console.warn('⚠️ Null tract found in district');
          return;
        }
        if (!tract.geometry) {
          console.warn('⚠️ Tract missing geometry:', tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || 'Unknown');
          return;
        }
        
        try {
          const geoJson = L.geoJSON(tract.geometry, {
            style: {
              color: this.showTractBoundaries ? '#000000' : color, // Black borders when checked, match fill when unchecked
              weight: this.showTractBoundaries ? 2 : 1, // Thicker borders when checked
              opacity: this.showTractBoundaries ? 1.0 : 0.3, // Full opacity when checked, subtle when unchecked
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
    if (!this.map || !this.algorithmResult || !this.currentStep) return;

    // Clear existing division lines
    this.clearDivisionLines();

    // Add static lines for all previous steps
    for (let stepIdx = 0; stepIdx < this.currentStepIndex; stepIdx++) {
      const step = this.algorithmResult.steps[stepIdx];
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
      if (this.algorithmResult && stepIdx > 0) {
        const prevStep = this.algorithmResult.steps[stepIdx - 1];
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
      if (this.algorithmResult && stepIdx > 0) {
        const prevStep = this.algorithmResult.steps[stepIdx - 1];
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

