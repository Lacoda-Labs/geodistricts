import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, DistrictGroup, GeodistrictOptions, AlgorithmType, DivisionLineInfo } from '../services/geodistrict-algorithm.service';
import { CongressionalDistrictsService } from '../services/congressional-districts.service';
import { GeoJsonFeature } from '../services/census.service';

// Interface for nested group hierarchy
interface GroupNode {
  group: DistrictGroup;
  index: number;
  direction: 'latitude' | 'longitude';
  children: GroupNode[];
  step: number;
}

@Component({
  selector: 'app-geodistrict-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './geodistrict-viewer.component.html',
  styleUrls: ['./geodistrict-viewer.component.scss']
})
export class GeodistrictViewerComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedState: string = 'AZ';
  useDirectAPI: boolean = false; // Use backend proxy
  forceInvalidate: boolean = false; // Force refresh census cache
  selectedAlgorithm: AlgorithmType = 'geo-graph'; // Default to geo-graph algorithm
  isLoading: boolean = false;
  errorMessage: string = '';
  canRunNextStep: boolean = false;
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  private groupMaps: Map<number, L.Map> = new Map();
  private stepOverviewMap: L.Map | null = null;
  private currentTractIndices: Map<number, number> = new Map(); // Track current tract index for each group
  private highlightedTractLayers: Map<number, L.Layer> = new Map(); // Track highlighted tract layers
  private tractLayers: Map<number, Map<number, L.GeoJSON>> = new Map(); // Track tract layers by groupIndex -> tractIndex for click handling
  private divisionLineLayers: L.Polyline[] = []; // Track all division line layers
  private divisionLinesByStep: Map<number, L.Polyline[]> = new Map(); // Track division lines by step number
  private divisionLineMarkers: L.Marker[] = []; // Track all division line markers

  private subscriptions: Subscription[] = [];

  // Algorithm options
  algorithmOptions = [
    { value: 'brown-s4', label: 'Brown S4 (Default)', description: 'Uses pre-computed adjacency data from Brown University S4 project for optimal contiguity' },
    { value: 'geo-graph', label: 'Geo-Graph', description: 'Zig-zag traversal using Brown S4 adjacency data with northwest starting point and clockwise row-by-row movement' },
    { value: 'greedy-traversal', label: 'Greedy Traversal', description: 'Graph-based directional traversal for optimal contiguity' },
    { value: 'geographic', label: 'Geographic Sorting', description: 'Uses TIGER internal points for geographic sorting and contiguity-based division' },
    { value: 'latlong', label: 'Lat/Long Dividing Lines', description: 'Uses straight latitude/longitude lines to divide districts' }
  ];

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
    private congressionalDistrictsService: CongressionalDistrictsService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Load last selected algorithm from localStorage
    const savedAlgorithm = localStorage.getItem('geodistrict-selected-algorithm');
    if (savedAlgorithm && this.algorithmOptions.some(opt => opt.value === savedAlgorithm)) {
      this.selectedAlgorithm = savedAlgorithm as AlgorithmType;
      console.log(`📋 Loaded saved algorithm: ${this.selectedAlgorithm}`);
    }
  }

  ngAfterViewInit(): void {
    // Initialize maps after view is ready
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.cleanupMaps();
  }

  private cleanupMaps(): void {
    this.groupMaps.forEach((map, groupIndex) => {
      if (map) {
        map.remove();
      }
    });
    this.groupMaps.clear();
    
    // Clean up tract layers tracking
    this.tractLayers.clear();
    
    // Clean up all division lines and markers when starting a new algorithm run
    this.divisionLineLayers.forEach(layer => {
      if (this.stepOverviewMap) {
        this.stepOverviewMap.removeLayer(layer);
      }
    });
    this.divisionLineLayers = [];
    
    this.divisionLineMarkers.forEach(marker => {
      if (this.stepOverviewMap) {
        this.stepOverviewMap.removeLayer(marker);
      }
    });
    this.divisionLineMarkers = [];
    
    this.divisionLinesByStep.clear();
    
    if (this.stepOverviewMap) {
      this.stepOverviewMap.remove();
      this.stepOverviewMap = null;
    }
  }

  private createGroupMap(groupIndex: number, group: DistrictGroup, color: string, retryCount: number = 0): void {
    const MAX_RETRIES = 10; // Prevent infinite loops
    const mapId = `groupMap${groupIndex}`;
    
    try {
      const mapElement = document.getElementById(mapId);
      
      if (!mapElement) {
        if (retryCount < MAX_RETRIES) {
          setTimeout(() => this.createGroupMap(groupIndex, group, color, retryCount + 1), 200);
        } else {
          console.error(`❌ Map element with id ${mapId} not found in DOM after ${MAX_RETRIES} attempts`);
        }
        return;
      }

      // Ensure element is visible and has dimensions
      // Retry if element has no dimensions (Angular might not have finished rendering)
      if (mapElement.offsetWidth === 0 || mapElement.offsetHeight === 0) {
        if (retryCount < MAX_RETRIES) {
          setTimeout(() => this.createGroupMap(groupIndex, group, color, retryCount + 1), 200);
        } else {
          console.error(`❌ Map element ${mapId} has no dimensions after ${MAX_RETRIES} attempts - creating map anyway`);
        }
        
        // Only return if we haven't exceeded max retries
        if (retryCount < MAX_RETRIES) {
          return;
        }
      }

      // Check if Leaflet is available
      if (typeof L === 'undefined' || !L.map) {
        console.error('❌ Leaflet library (L) is not loaded');
        return;
      }

      // Clean up existing map if it exists
      if (this.groupMaps.has(groupIndex)) {
        try {
          this.groupMaps.get(groupIndex)?.remove();
        } catch (error) {
          console.warn(`⚠️ Error removing existing map ${groupIndex}:`, error);
        }
      }

      // Create new map
      let map: L.Map;
      try {
        // Don't trigger change detection here - it causes infinite loops
        // Just create the map if element exists, even if dimensions are 0
        // Leaflet will handle it and we can invalidate size later
        
        map = L.map(mapId, {
          zoomControl: true,
          attributionControl: false,
          dragging: true,
          touchZoom: true,
          doubleClickZoom: true,
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: false
        }).setView([group.centroid.lat, group.centroid.lng], 8);
      } catch (error) {
        console.error(`❌ Error creating Leaflet map ${mapId}:`, error);
        return;
      }
      
      // Invalidate size after a delay (to handle any layout changes)
      // Use multiple attempts with increasing delays
      const invalidateSizeDelayed = (attempt: number = 0) => {
        const maxAttempts = 5;
        if (attempt >= maxAttempts) {
          return;
        }
        
        setTimeout(() => {
          try {
            if (map && mapElement) {
              const hasDimensions = mapElement.offsetWidth > 0 && mapElement.offsetHeight > 0;
              
              if (hasDimensions) {
                map.invalidateSize();
              } else {
                // Try again with longer delay
                invalidateSizeDelayed(attempt + 1);
              }
            }
          } catch (error) {
            console.error(`❌ Error in delayed invalidation for map ${mapId}:`, error);
          }
        }, attempt === 0 ? 100 : attempt * 200); // Increasing delays: 100ms, 200ms, 400ms, 600ms, 800ms
      };
      
      // Start invalidation attempts
      invalidateSizeDelayed();

      // Add tile layer with minimal styling
      try {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          className: 'minimal-tiles'
        }).addTo(map);
      } catch (error) {
        console.error(`❌ Error adding tile layer to map ${mapId}:`, error);
      }

      // Add individual tract geometries
      if (group.censusTracts && group.censusTracts.length > 0) {
        let tractCount = 0;
        let errorCount = 0;
        
        try {
          // Track tract layers for this group
          if (!this.tractLayers.has(groupIndex)) {
            this.tractLayers.set(groupIndex, new Map());
          }
          const groupTractLayers = this.tractLayers.get(groupIndex)!;
          
          // Add each tract as a separate feature with click handlers
          group.censusTracts.forEach((tract, tractIndex) => {
            try {
              if (tract.geometry) {
                const tractLayer = L.geoJSON(tract.geometry, {
                  style: {
                    color: 'black',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 1,
                    fillColor: color
                  }
                }).addTo(map);
                
                // Store tract layer for later reference
                groupTractLayers.set(tractIndex, tractLayer);
                
                // Add interactive features (hover and click)
                tractLayer.on('mouseover', () => {
                  // Only apply hover effect if this isn't the currently selected tract
                  const currentIndex = this.getCurrentTractIndex(groupIndex);
                  if (tractIndex !== currentIndex) {
                    tractLayer.setStyle({
                      weight: 2,
                      fillOpacity: 0.8
                    });
                  }
                  map.getContainer().style.cursor = 'pointer';
                });
                
                tractLayer.on('mouseout', () => {
                  // Only reset style if this isn't the currently selected tract
                  const currentIndex = this.getCurrentTractIndex(groupIndex);
                  if (tractIndex !== currentIndex) {
                    tractLayer.setStyle({
                      weight: 1,
                      fillOpacity: 1
                    });
                  }
                  map.getContainer().style.cursor = '';
                });
                
                // Add click handler to select the tract
                tractLayer.on('click', () => {
                  this.selectTract(groupIndex, tractIndex.toString());
                });
                
                tractCount++;
              }
            } catch (error) {
              errorCount++;
              if (tractIndex < 5) { // Only log first 5 errors to avoid spam
                console.error(`❌ Error adding tract ${tractIndex} to map ${mapId}:`, error);
              }
            }
          });
          
          if (tractCount === 0) {
            console.warn(`⚠️ No tracts added to map ${mapId} (all ${group.censusTracts.length} tracts failed)`);
          }
        } catch (error) {
          console.error(`❌ Error processing tracts for map ${mapId}:`, error);
        }

        // Fit map to all tract bounds
        try {
          const allBounds = L.latLngBounds([]);
          group.censusTracts.forEach(tract => {
            if (tract.geometry) {
              try {
                const geoJson = L.geoJSON(tract.geometry);
                const bounds = geoJson.getBounds();
                if (bounds.isValid()) {
                  allBounds.extend(bounds);
                }
              } catch (error) {
                // Silently skip invalid geometries
              }
            }
          });
          
          if (allBounds.isValid()) {
            map.fitBounds(allBounds, { padding: [10, 10] });
          } else {
            console.warn(`⚠️ Invalid bounds for map ${mapId}, using default view`);
          }
        } catch (error) {
          console.error(`❌ Error fitting bounds for map ${mapId}:`, error);
        }
      } else {
        console.warn(`⚠️ No census tracts to add to map ${mapId}`);
      }

      this.groupMaps.set(groupIndex, map);
    } catch (error) {
      console.error(`❌ Fatal error creating map ${mapId}:`, error);
    }
  }

  private combineTractGeometries(tracts: any[]): any {
    if (!tracts || tracts.length === 0) return null;

    // Collect all polygon coordinates
    const allPolygons: number[][][] = [];
    
    tracts.forEach(tract => {
      if (tract.geometry && tract.geometry.coordinates) {
        if (tract.geometry.type === 'Polygon') {
          allPolygons.push(tract.geometry.coordinates);
        } else if (tract.geometry.type === 'MultiPolygon') {
          allPolygons.push(...tract.geometry.coordinates);
        }
      }
    });

    if (allPolygons.length === 0) return null;

    // Create a MultiPolygon from all the tract polygons
    // This will render as a single solid shape without internal boundaries
    return {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: allPolygons
      },
      properties: {}
    };
  }


  onStateChange(): void {
    this.clearResults();
  }

  onSettingsChange(): void {
    this.clearResults();
  }

  onAlgorithmChange(): void {
    // Save selected algorithm to localStorage
    localStorage.setItem('geodistrict-selected-algorithm', this.selectedAlgorithm);
    console.log(`💾 Saved algorithm selection: ${this.selectedAlgorithm}`);
    
    // Algorithm changed - clear results if any
    this.clearResults();
  }

  getSelectedAlgorithmDescription(): string {
    const selectedOption = this.algorithmOptions.find(option => option.value === this.selectedAlgorithm);
    return selectedOption ? selectedOption.description : '';
  }

  /**
   * Calculate the population variance percentage for the current result
   * @returns Population variance as a percentage
   */
  getPopulationVariancePercentage(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    
    const populations = this.algorithmResult.finalDistricts.map(d => d.totalPopulation);
    const mean = this.algorithmResult.averagePopulation;
    const variance = populations.reduce((sum, pop) => sum + Math.pow(pop - mean, 2), 0) / populations.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Return coefficient of variation as percentage
    return (standardDeviation / mean) * 100;
  }

  /**
   * Get the worst population variance between any two districts
   * @returns Maximum variance percentage between any two districts
   */
  getMaxPopulationVariance(): number {
    if (!this.algorithmResult?.finalDistricts || this.algorithmResult.finalDistricts.length < 2) return 0;
    
    const populations = this.algorithmResult.finalDistricts.map(d => d.totalPopulation);
    const minPop = Math.min(...populations);
    const maxPop = Math.max(...populations);
    const meanPop = (minPop + maxPop) / 2;
    
    return ((maxPop - minPop) / meanPop) * 100;
  }

  onStepChange(): void {
    if (this.algorithmResult && this.currentStepIndex >= 0 && this.currentStepIndex < this.algorithmResult.steps.length) {
      this.currentStep = this.algorithmResult.steps[this.currentStepIndex];
      // Create maps for the new step after a short delay to ensure DOM is updated
      setTimeout(() => {
        this.createMapsForCurrentStep();
      }, 100);
    }
  }

  /**
   * Check if current step is the initial state (index 0)
   */
  isInitialState(): boolean {
    return this.currentStepIndex === 0;
  }

  /**
   * Get display step number (0 for initial state, 1+ for actual divisions)
   * Returns 0 for initial state, or the step index for divisions (which aligns with division number)
   */
  getDisplayStepNumber(): number {
    return this.currentStepIndex;
  }

  /**
   * Get total number of steps (excluding initial state from count for display purposes)
   * This represents the number of actual division steps
   */
  getTotalDivisionSteps(): number {
    if (!this.algorithmResult) return 0;
    return Math.max(0, this.algorithmResult.steps.length - 1);
  }

  /**
   * Get display label for step (e.g., "Initial State" or "Step 1", "Step 2", etc.)
   */
  getStepLabel(index: number): string {
    return index === 0 ? 'Initial State' : `Step ${index}`;
  }

  private createMapsForCurrentStep(): void {
    if (!this.currentStep) return;
    
    this.cleanupMaps();
    
    // Create the step overview map first
    this.createStepOverviewMap();
    
    // Wait for DOM to be ready - simple vertical list should render quickly
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.createAllGroupMaps();
      });
    });
  }

  private createAllGroupMaps(): void {
    if (!this.currentStep) {
      console.warn('⚠️ No current step available for map creation');
      return;
    }


    // Create maps for all current step groups - simple vertical list now
    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      this.createGroupMap(index, group, color);
    });
  }

  private createStepOverviewMap(): void {
    if (!this.currentStep) return;

    const mapElement = document.getElementById('stepOverviewMap');
    if (!mapElement) {
      console.warn('Step overview map element not found');
      return;
    }

    // Only recreate the map if it doesn't exist
    // This preserves all previous division lines when changing steps
    if (!this.stepOverviewMap) {
      // Create new map
      this.stepOverviewMap = L.map('stepOverviewMap', {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false
      });

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        className: 'minimal-tiles'
      }).addTo(this.stepOverviewMap);
    }

    // Remove division lines and markers from steps greater than the current step (if any)
    // This handles the case when stepping backwards
    for (let stepNum = this.currentStepIndex + 1; stepNum < (this.algorithmResult?.steps.length || 0); stepNum++) {
      const futureStepLines = this.divisionLinesByStep.get(stepNum);
      if (futureStepLines) {
        futureStepLines.forEach(layer => {
          if (this.stepOverviewMap) {
            this.stepOverviewMap.removeLayer(layer);
          }
          const index = this.divisionLineLayers.indexOf(layer);
          if (index !== -1) {
            this.divisionLineLayers.splice(index, 1);
          }
        });
        this.divisionLinesByStep.delete(stepNum);
      }
      
      // Remove markers associated with future steps
      // Find markers for this step by checking their tooltip content
      const markersToRemove = this.divisionLineMarkers.filter(marker => {
        const tooltip = (marker as any)._tooltip;
        if (tooltip && tooltip._content) {
          return tooltip._content.includes(`Step ${stepNum}`);
        }
        return false;
      });
      
      markersToRemove.forEach(marker => {
        if (this.stepOverviewMap) {
          this.stepOverviewMap.removeLayer(marker);
        }
        const index = this.divisionLineMarkers.indexOf(marker);
        if (index !== -1) {
          this.divisionLineMarkers.splice(index, 1);
        }
      });
    }

    // Add all district groups to the map
    // Clear existing tract layers first to avoid duplicates
    if (this.stepOverviewMap) {
      this.stepOverviewMap.eachLayer((layer) => {
        // Only remove GeoJSON layers (tracts), not division lines or tile layers
        if (layer instanceof L.GeoJSON && !this.divisionLineLayers.includes(layer as any)) {
          this.stepOverviewMap!.removeLayer(layer);
        }
      });
    }

    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      
      // Add individual tract geometries instead of combined geometry
      group.censusTracts.forEach(tract => {
        if (tract.geometry) {
          const geoJson = L.geoJSON(tract.geometry, {
            style: {
              color: 'black',//color,
              weight: 1,
              opacity: 1,//0.8,
              fillOpacity: 1,//0.6,
              fillColor: color
            }
          }).bindPopup(`
            <strong>Tract Information</strong><br>
            <strong>Tract ID:</strong> ${tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || 'Unknown'}<br>
            <strong>Population:</strong> ${(tract.properties?.POPULATION || 0).toLocaleString()}<br>
            <strong>Name:</strong> ${tract.properties?.NAME || 'Unknown'}<br>
            <strong>County:</strong> ${tract.properties?.COUNTY_FIPS || tract.properties?.COUNTY || 'Unknown'}<br>
            <strong>State:</strong> ${tract.properties?.STATE_FIPS || tract.properties?.STATE || 'Unknown'}<br>
            <hr>
            <strong>Group ${index + 1}</strong><br>
            Districts: ${group.startDistrictNumber}-${group.endDistrictNumber}<br>
            Group Population: ${group.totalPopulation.toLocaleString()}<br>
            Group Tracts: ${group.censusTracts.length}
          `);
          
          if (this.stepOverviewMap) {
            geoJson.addTo(this.stepOverviewMap);
          }

          // Extend bounds
          const tractBounds = geoJson.getBounds();
          if (tractBounds.isValid()) {
            bounds.extend(tractBounds);
            hasBounds = true;
          }
        }
      });
    });

    // Fit map to show all groups first
    if (hasBounds && bounds.isValid()) {
      this.stepOverviewMap.fitBounds(bounds, { padding: [20, 20] });
      
      // Add division lines for all steps up to and including the current step
      // This preserves all previous division lines and only adds new ones
      if (this.currentStep && this.algorithmResult) {
        setTimeout(() => {
          if (!this.stepOverviewMap || !this.currentStep || !this.algorithmResult) {
            console.warn('⚠️ Map, step, or algorithm result not available for division lines');
            return;
          }
          
          // Add division lines for all steps from 1 to current step
          // Use the new divisionLines array which contains one entry per group division
          for (let stepIdx = 1; stepIdx <= this.currentStepIndex; stepIdx++) {
            const step = this.algorithmResult.steps[stepIdx];
            if (!step) continue;
            
            // Check if we've already added division lines for this step
            if (this.divisionLinesByStep.has(stepIdx)) {
              continue; // Already added, skip
            }
            
            // Use the new divisionLines array if available, otherwise fall back to old divisionLine
            const stepDivisionLines: L.Polyline[] = [];
            
            if (step.divisionLines && step.divisionLines.length > 0) {
              // Use the new divisionLines array - one entry per group division
              console.log(`📏 Adding ${step.divisionLines.length} division line(s) for step ${stepIdx}`);
              
              for (const divLineInfo of step.divisionLines) {
                try {
                  const divisionLine = divLineInfo.line;
                  const direction = divLineInfo.direction;
                  const parentGroup = divLineInfo.parentGroup;
                  const divisionRatio = divLineInfo.ratio;
                  
                  // Find the parent group in the previous step to get its bounds
                  const prevStep = stepIdx > 0 ? this.algorithmResult.steps[stepIdx - 1] : null;
                  const parentGroupInPrevStep = prevStep?.districtGroups.find(g =>
                    g.startDistrictNumber === parentGroup.startDistrictNumber &&
                    g.endDistrictNumber === parentGroup.endDistrictNumber
                  );
                  
                  // Find the resulting groups in the current step to get their combined bounds
                  const resultingGroups = this.currentStep!.districtGroups.filter(g =>
                    g.startDistrictNumber >= parentGroup.startDistrictNumber &&
                    g.endDistrictNumber <= parentGroup.endDistrictNumber &&
                    (g.startDistrictNumber !== parentGroup.startDistrictNumber || 
                     g.endDistrictNumber !== parentGroup.endDistrictNumber)
                  );
                  
                  // Calculate bounds from resulting groups (or use parent group bounds if available)
                  let groupBounds: L.LatLngBounds | null = null;
                  if (resultingGroups.length > 0) {
                    // Use bounds from resulting groups
                    for (const group of resultingGroups) {
                      let bounds: L.LatLngBounds | null = null;
                      if (group.bounds) {
                        bounds = L.latLngBounds(
                          L.latLng(group.bounds.south, group.bounds.west),
                          L.latLng(group.bounds.north, group.bounds.east)
                        );
                      } else {
                        bounds = this.calculateGroupBounds(group.censusTracts);
                      }
                      
                      if (bounds && bounds.isValid()) {
                        if (!groupBounds) {
                          groupBounds = bounds;
                        } else {
                          groupBounds.extend(bounds);
                        }
                      }
                    }
                  } else if (parentGroupInPrevStep) {
                    // Fallback to parent group bounds
                    if (parentGroupInPrevStep.bounds) {
                      groupBounds = L.latLngBounds(
                        L.latLng(parentGroupInPrevStep.bounds.south, parentGroupInPrevStep.bounds.west),
                        L.latLng(parentGroupInPrevStep.bounds.north, parentGroupInPrevStep.bounds.east)
                      );
                    } else {
                      groupBounds = this.calculateGroupBounds(parentGroupInPrevStep.censusTracts);
                    }
                  }
                  
                  if (!groupBounds || !groupBounds.isValid()) continue;
                  
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
                    console.warn(`Invalid line coordinates for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}, skipping`);
                    continue;
                  }
                  
                  // Create polyline for this division
                  const divisionLineLayer = L.polyline(lineCoordinates, {
                    color: '#ff0000',
                    weight: 3,
                    opacity: 0.8,
                    dashArray: '10, 5'
                  }).bindPopup(`
                    <strong>Division Line</strong><br>
                    Step ${stepIdx}<br>
                    ${direction === 'latitude' ? 'Latitude' : 'Longitude'}: ${divisionLine.toFixed(6)}${direction === 'latitude' ? '°N' : '°W'}<br>
                    Dividing group (Districts ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber})<br>
                    Ratio: ${divisionRatio[0]}% / ${divisionRatio[1]}%
                  `);
                  
                  if (this.stepOverviewMap) {
                    divisionLineLayer.addTo(this.stepOverviewMap);
                    this.divisionLineLayers.push(divisionLineLayer);
                    stepDivisionLines.push(divisionLineLayer);
                    
                    // Add marker
                    let markerPosition: L.LatLng;
                    if (direction === 'latitude') {
                      const leftmostPoint = lineCoordinates.reduce((left, current) => 
                        current.lng < left.lng ? current : left
                      );
                      markerPosition = L.latLng(leftmostPoint.lat, leftmostPoint.lng);
                    } else {
                      const topmostPoint = lineCoordinates.reduce((top, current) => 
                        current.lat > top.lat ? current : top
                      );
                      markerPosition = L.latLng(topmostPoint.lat, topmostPoint.lng);
                    }
                    
                    const markerIcon = L.divIcon({
                      className: 'division-line-marker',
                      html: `<div style="
                        background-color: #ff0000;
                        color: white;
                        border: 2px solid white;
                        border-radius: 50%;
                        width: 24px;
                        height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: bold;
                        font-size: 12px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        cursor: pointer;
                      ">${stepIdx}</div>`,
                      iconSize: [24, 24],
                      iconAnchor: [12, 12]
                    });
                    
                    const coordLabel = direction === 'latitude' ? 'lat' : 'long';
                    const coordValue = divisionLine.toFixed(4);
                    const tooltipText = `${coordLabel}:${coordValue} dividing group (${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}) ratio: ${divisionRatio[0]}%/${divisionRatio[1]}%`;
                    
                    const marker = L.marker(markerPosition, { icon: markerIcon })
                      .bindTooltip(tooltipText, {
                        permanent: false,
                        direction: direction === 'latitude' ? 'right' : 'bottom',
                        offset: direction === 'latitude' ? [8, 0] : [0, 8]
                      });
                    
                    marker.addTo(this.stepOverviewMap);
                    this.divisionLineMarkers.push(marker);
                  }
                  
                  console.log(`✅ Added division line for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber} (${divisionRatio[0]}%/${divisionRatio[1]}%)`);
                } catch (error) {
                  console.error(`Error adding division line for step ${stepIdx}:`, error);
                }
              }
            } else if (step.divisionLine && step.divisionDirection) {
              // Fallback to old format for backward compatibility
              console.log(`📏 Using legacy division line format for step ${stepIdx}`);
              // ... (keep old logic as fallback)
            }
            
            // Store division lines for this step
            if (stepDivisionLines.length > 0) {
              this.divisionLinesByStep.set(stepIdx, stepDivisionLines);
              console.log(`✅ Stored ${stepDivisionLines.length} division line layers for step ${stepIdx}`);
            }
          } // End of for loop over steps
          
          console.log(`✅ Total division line layers: ${this.divisionLineLayers.length} across ${this.divisionLinesByStep.size} steps`);
        }, 200);
      } else {
        if (this.currentStep) {
          console.log(`⚠️ No division line: step=${this.currentStep.step}, divisionLine=${this.currentStep.divisionLine}, direction=${this.currentStep.divisionDirection}`);
        }
      }
    }
  }

  runAlgorithm(): void {
    if (!this.selectedState) {
      this.errorMessage = 'Please select a state first';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.clearResults();

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: this.useDirectAPI,
      forceInvalidate: this.forceInvalidate,
      maxIterations: 100,
      algorithm: this.selectedAlgorithm
    };

    const subscription = this.geodistrictService.runGeodistrictAlgorithmStepByStep(options).subscribe({
      next: (result) => {
        this.algorithmResult = result;
        this.currentStepIndex = 0;
        this.currentStep = result.steps[0];
        this.isLoading = false;
        this.canRunNextStep = this.canExecuteNextStep(result);
        // Create maps after a short delay to ensure DOM is ready
        setTimeout(() => {
          this.createMapsForCurrentStep();
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

  runNextStep(): void {
    if (!this.algorithmResult || !this.canRunNextStep || this.isLoading) {
      return;
    }

    // Disable button immediately
    this.isLoading = true;
    this.canRunNextStep = false;
    this.errorMessage = '';

    const subscription = this.geodistrictService.executeNextStep(this.algorithmResult, this.selectedAlgorithm).subscribe({
      next: (nextResult) => {
        this.algorithmResult = nextResult;
        this.currentStepIndex = nextResult.steps.length - 1;
        this.currentStep = nextResult.steps[this.currentStepIndex];
        this.canRunNextStep = this.canExecuteNextStep(nextResult);
        this.isLoading = false;
        
        // Create maps after a short delay to ensure DOM is ready
        setTimeout(() => {
          this.createMapsForCurrentStep();
        }, 200);
      },
      error: (error) => {
        this.errorMessage = error.message || 'An error occurred while running the next step';
        // Re-enable button if we still have a valid result
        this.canRunNextStep = this.algorithmResult ? this.canExecuteNextStep(this.algorithmResult) : false;
        this.isLoading = false;
        console.error('Next step error:', error);
      }
    });

    this.subscriptions.push(subscription);
  }

  private canExecuteNextStep(result: GeodistrictResult): boolean {
    return result.finalDistricts.some(group => group.totalDistricts > 1);
  }

  previousStep(): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.onStepChange();
    }
  }

  nextStep(): void {
    if (this.algorithmResult && this.currentStepIndex < this.algorithmResult.steps.length - 1) {
      this.currentStepIndex++;
      this.onStepChange();
    }
  }

  getGroupColor(index: number): string {
    const colors = [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#34495e', '#e67e22', '#95a5a6', '#f1c40f'
    ];
    return colors[index % colors.length];// + '20'; // Add transparency
  }

  clearError(): void {
    this.errorMessage = '';
  }

  // Statistics calculation methods
  calculatePopulationVariance(population: number): number {
    if (!this.algorithmResult?.averagePopulation) return 0;
    const targetPopulation = this.algorithmResult.averagePopulation;
    if (targetPopulation === 0) return 0;
    
    const difference = population - targetPopulation;
    const percentageVariance = (difference / targetPopulation) * 100;
    return Math.abs(percentageVariance);
  }

  /**
   * Calculate population variance for a district group against the ratio
   * The target population is calculated as: totalDistricts * averagePopulation
   * @param district The district group
   * @returns Population variance as a percentage (can be negative or positive)
   */
  calculatePopulationVarianceForGroup(district: DistrictGroup): number {
    if (!this.algorithmResult?.averagePopulation || !district.totalDistricts) return 0;
    const targetPopulation = district.totalDistricts * this.algorithmResult.averagePopulation;
    if (targetPopulation === 0) return 0;
    
    const difference = district.totalPopulation - targetPopulation;
    const percentageVariance = (difference / targetPopulation) * 100;
    return percentageVariance; // Return signed value to show over/under
  }

  /**
   * Get the target district population per district
   * This calculates the correct target based on total district seats
   * @returns Target population per district
   */
  getTargetDistrictPopulation(): number {
    if (!this.algorithmResult?.totalPopulation) return 0;
    const totalDistrictSeats = this.getTotalDistrictSeats();
    if (totalDistrictSeats === 0) return 0;
    return this.algorithmResult.totalPopulation / totalDistrictSeats;
  }

  /**
   * Get the target district group population
   * Target = numOfDistrictsInGroup * targetDistrictPopulation
   * @param district The district group
   * @returns Target population for the district group
   */
  getTargetDistrictGroupPopulation(district: DistrictGroup): number {
    if (!district.totalDistricts) return 0;
    const targetDistrictPopulation = this.getTargetDistrictPopulation();
    return Math.round(district.totalDistricts * targetDistrictPopulation);
  }

  /**
   * Calculate population variance as a ratio: district group population / target district group population
   * where target district group population = numOfDistrictsInGroup * targetDistrictPopulation
   * @param district The district group
   * @returns Variance ratio (1.0 = exact match, >1.0 = over target, <1.0 = under target)
   */
  calculatePopulationVarianceRatio(district: DistrictGroup): number {
    const targetPopulation = this.getTargetDistrictGroupPopulation(district);
    if (targetPopulation === 0) return 0;
    return district.totalPopulation / targetPopulation;
  }

  /**
   * Calculate the difference between district group population and target district group population
   * @param district The district group
   * @returns Population difference (positive = over target, negative = under target)
   */
  getPopulationDifference(district: DistrictGroup): number {
    const targetPopulation = this.getTargetDistrictGroupPopulation(district);
    return Math.round(district.totalPopulation - targetPopulation);
  }

  getTotalTracts(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return this.algorithmResult.finalDistricts.reduce((total, district) => 
      total + district.censusTracts.length, 0);
  }

  getAveragePopulationVariance(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    const totalVariance = this.algorithmResult.finalDistricts.reduce((total, district) => 
      total + this.calculatePopulationVariance(district.totalPopulation), 0);
    return totalVariance / this.algorithmResult.finalDistricts.length;
  }

  getPopulationStdDev(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    const populations = this.algorithmResult.finalDistricts.map(d => d.totalPopulation);
    const mean = this.algorithmResult.averagePopulation;
    const variance = populations.reduce((sum, pop) => sum + Math.pow(pop - mean, 2), 0) / populations.length;
    return Math.sqrt(variance);
  }

  getMinPopulation(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return Math.min(...this.algorithmResult.finalDistricts.map(d => d.totalPopulation));
  }

  getMaxPopulation(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return Math.max(...this.algorithmResult.finalDistricts.map(d => d.totalPopulation));
  }

  getAverageTractsPerDistrict(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return this.getTotalTracts() / this.algorithmResult.finalDistricts.length;
  }

  /**
   * Get the total number of district seats
   * This is the sum of totalDistricts in all final district groups
   * @returns Total number of district seats
   */
  getTotalDistrictSeats(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return this.algorithmResult.finalDistricts.reduce((total, district) => 
      total + district.totalDistricts, 0);
  }

  /**
   * Calculate average tract population
   * @returns Average population per tract
   */
  getAverageTractPopulation(): number {
    if (!this.algorithmResult?.totalPopulation) return 0;
    const totalTracts = this.getTotalTracts();
    if (totalTracts === 0) return 0;
    return this.algorithmResult.totalPopulation / totalTracts;
  }

  // Tract debugging methods
  getCurrentTractIndex(groupIndex: number): number {
    return this.currentTractIndices.get(groupIndex) || 0;
  }

  getCurrentTract(groupIndex: number): any {
    if (!this.currentStep?.districtGroups[groupIndex]) return null;
    const group = this.currentStep.districtGroups[groupIndex];
    const tractIndex = this.getCurrentTractIndex(groupIndex);
    return group.censusTracts[tractIndex] || null;
  }

  previousTract(groupIndex: number): void {
    const currentIndex = this.getCurrentTractIndex(groupIndex);
    if (currentIndex > 0) {
      this.currentTractIndices.set(groupIndex, currentIndex - 1);
      this.highlightCurrentTract(groupIndex);
    }
  }

  nextTract(groupIndex: number): void {
    if (!this.currentStep?.districtGroups[groupIndex]) return;
    const group = this.currentStep.districtGroups[groupIndex];
    const currentIndex = this.getCurrentTractIndex(groupIndex);
    if (currentIndex < group.censusTracts.length - 1) {
      this.currentTractIndices.set(groupIndex, currentIndex + 1);
      this.highlightCurrentTract(groupIndex);
    }
  }

  selectTract(groupIndex: number, tractIndex: string): void {
    const index = parseInt(tractIndex, 10);
    this.currentTractIndices.set(groupIndex, index);
    this.highlightCurrentTract(groupIndex);
  }

  getTractId(tract: any): string {
    return tract?.properties?.['GEOID'] || tract?.properties?.TRACT_FIPS || tract?.properties?.NAME || 'Unknown';
  }

  getTractPopulation(tract: any): number {
    return tract?.properties?.POPULATION || 0;
  }

  getTractCentroid(tract: any): { lat: number; lng: number } {
    if (!tract?.geometry) return { lat: 0, lng: 0 };
    
    let totalLat = 0, totalLng = 0, pointCount = 0;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          totalLng += coord[0];
          totalLat += coord[1];
          pointCount++;
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            totalLng += coord[0];
            totalLat += coord[1];
            pointCount++;
          }
        }
      }
    }

    return pointCount > 0 ? { lat: totalLat / pointCount, lng: totalLng / pointCount } : { lat: 0, lng: 0 };
  }

  getTractName(tract: any): string {
    return tract?.properties?.NAME || 'Unknown';
  }

  private highlightCurrentTract(groupIndex: number): void {
    if (!this.currentStep?.districtGroups[groupIndex]) return;
    
    const group = this.currentStep.districtGroups[groupIndex];
    const map = this.groupMaps.get(groupIndex);
    if (!map) return;

    // Remove previous highlight
    const previousHighlight = this.highlightedTractLayers.get(groupIndex);
    if (previousHighlight) {
      map.removeLayer(previousHighlight);
    }

    // Get current tract
    const currentTract = this.getCurrentTract(groupIndex);
    if (!currentTract?.geometry) return;
    
    const currentTractIndex = this.getCurrentTractIndex(groupIndex);
    
    // Reset all tract layer styles first
    const groupTractLayers = this.tractLayers.get(groupIndex);
    if (groupTractLayers) {
      const groupColor = this.getGroupColor(groupIndex);
      groupTractLayers.forEach((layer, tractIdx) => {
        (layer as any).setStyle({
          color: 'black',
          weight: 1,
          opacity: 1,
          fillOpacity: 1,
          fillColor: groupColor
        });
      });
    }

    // Create highlight layer
    const highlightLayer = L.geoJSON(currentTract.geometry, {
      style: {
        color: 'black',
        weight: 3,
        opacity: 1,
        fillOpacity: 1,
        fillColor: 'black'
      }
    });

    // Add popup with tract info
    const centroid = this.getTractCentroid(currentTract);
    const popupContent = `
      <div class="tract-popup">
        <h4>Tract Information</h4>
        <p><strong>Tract ID:</strong> ${this.getTractId(currentTract)}</p>
        <p><strong>Population:</strong> ${this.getTractPopulation(currentTract).toLocaleString()}</p>
        <p><strong>Name:</strong> ${this.getTractName(currentTract)}</p>
        <p><strong>Centroid:</strong> (${centroid.lat.toFixed(4)}, ${centroid.lng.toFixed(4)})</p>
        <p><strong>Position in Sort:</strong> ${this.getCurrentTractIndex(groupIndex) + 1} of ${group.censusTracts.length}</p>
      </div>
    `;

    highlightLayer.bindPopup(popupContent);
    highlightLayer.addTo(map);
    
    // Store highlight layer
    this.highlightedTractLayers.set(groupIndex, highlightLayer);

    // Don't center or zoom the map - keep it stable
  }

  private clearResults(): void {
    this.algorithmResult = null;
    this.currentStep = null;
    this.currentStepIndex = 0;
    this.canRunNextStep = false;
    this.currentTractIndices.clear();
    this.highlightedTractLayers.clear();
  }

  // Build nested hierarchy from algorithm steps
  // Creates complete tree from step 0 (iteration0) to current step
  buildGroupHierarchy(): GroupNode[] {
    if (!this.algorithmResult || !this.currentStep) {
      return [];
    }

    // Start from step 0 (root) and recursively build to current step
    const step0 = this.algorithmResult.steps[0];
    if (!step0 || step0.districtGroups.length === 0) {
      return [];
    }

    // Step 0 (iteration0) should use 'longitude' direction according to requirements
    const rootNode: GroupNode = {
      group: step0.districtGroups[0],
      index: 0,
      direction: 'longitude', // Override: iteration0 should be longitude
      children: [],
      step: 0
    };

    // Recursively build children from step 1 to current step
    this.buildChildrenRecursive(rootNode, 1, this.currentStepIndex);

    return [rootNode];
  }

  /**
   * Calculate bounds for a group of tracts
   * @param tracts Array of tract features
   * @returns Leaflet bounds object
   */
  private calculateGroupBounds(tracts: GeoJsonFeature[]): L.LatLngBounds | null {
    if (tracts.length === 0) {
      return null;
    }

    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

    for (const tract of tracts) {
      if (tract.geometry) {
        try {
          const geoJson = L.geoJSON(tract.geometry);
          const tractBounds = geoJson.getBounds();
          if (tractBounds && tractBounds.isValid()) {
            bounds.extend(tractBounds);
            hasValidBounds = true;
          }
        } catch (error) {
          // Skip invalid geometries
          continue;
        }
      }
    }

    return hasValidBounds && bounds.isValid() ? bounds : null;
  }

  // Recursively build children from a parent node
  private buildChildrenRecursive(parentNode: GroupNode, fromStep: number, toStep: number): void {
    if (fromStep > toStep || !this.algorithmResult) {
      return;
    }

    const currentStep = this.algorithmResult.steps[fromStep];
    if (!currentStep) {
      return;
    }

    // Find groups in current step that belong to this parent
    // Match by district number ranges
    const childGroups = currentStep.districtGroups.filter(group =>
      group.startDistrictNumber >= parentNode.group.startDistrictNumber &&
      group.endDistrictNumber <= parentNode.group.endDistrictNumber
    );

    // Create child nodes
    childGroups.forEach((group, idx) => {
      const childNode: GroupNode = {
        group: group,
        index: currentStep.districtGroups.indexOf(group),
        direction: currentStep.divisionDirection,
        children: [],
        step: fromStep
      };

      parentNode.children.push(childNode);

      // Recursively build children for this node if not at the final step
      if (fromStep < toStep) {
        this.buildChildrenRecursive(childNode, fromStep + 1, toStep);
      }
    });
  }

  // Get the CSS class for a group based on its division direction
  getGroupDirectionClass(direction: 'latitude' | 'longitude'): string {
    return direction === 'latitude' ? 'latitude' : 'longitude';
  }

  // Get the iteration class for a step
  getIterationClass(step: number): string {
    return `iteration${step}`;
  }

  // Get global group index for map IDs - finds the index in currentStep's districtGroups
  getGlobalGroupIndex(node: GroupNode): number {
    if (!this.currentStep) return node.index;
    
    // Find the index of this group in the current step's districtGroups
    const index = this.currentStep.districtGroups.findIndex(g => 
      g.startDistrictNumber === node.group.startDistrictNumber &&
      g.endDistrictNumber === node.group.endDistrictNumber
    );
    
    return index >= 0 ? index : node.index;
  }
}