import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, DistrictGroup, GeodistrictOptions, DivisionLineInfo } from '../services/geodistrict-algorithm.service';
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
  private intersectingTractIds: Map<number, Set<string>> = new Map(); // Track intersecting tract IDs by groupIndex
  private selectedIntersectingTract: { groupIndex: number; tractIndex: number } | null = null; // Track selected intersecting tract
  private highlightedAdjacentTracts: Map<number, Set<number>> = new Map(); // Track highlighted adjacent tract indices by groupIndex
  private isolatedAdjacentTracts: Map<number, Map<number, Set<number>>> = new Map(); // Track isolated adjacent tracts by groupIndex -> (oppositeGroupIndex -> Set of tractIndices)
  private stepOverviewTractLayers: Map<string, L.GeoJSON> = new Map(); // Track step overview map tract layers by tractId
  private selectedStepOverviewIntersectingTract: string | null = null; // Track selected intersecting tract in step overview map
  private highlightedStepOverviewAdjacentTracts: Set<string> = new Set(); // Track highlighted adjacent tract IDs in step overview map
  private isolatedStepOverviewAdjacentTracts: Set<string> = new Set(); // Track isolated adjacent tract IDs in step overview map

  // Animation properties
  private animatedLineLayers: L.Layer[] = []; // Track animated line layers for cleanup

  // SVG rendering properties
  private svgRenderers: Map<string, SVGElement> = new Map(); // Track SVG renderers by container ID

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
    private congressionalDistrictsService: CongressionalDistrictsService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Only latlong algorithm is available
    console.log(`📋 Using latlong algorithm with caching`);
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

    // Clean up animated layers
    this.animatedLineLayers.forEach(layer => {
      if (this.stepOverviewMap) {
        this.stepOverviewMap.removeLayer(layer);
      }
    });
    this.animatedLineLayers = [];

    // Clean up SVG renderers
    this.svgRenderers.forEach((svg, containerId) => {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '';
      }
    });
    this.svgRenderers.clear();

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
          
          // Check if this group has intersecting tracts
          const intersectingIds = this.intersectingTractIds.get(groupIndex);
          const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
          
          // Add each tract as a separate feature with click handlers
          group.censusTracts.forEach((tract, tractIndex) => {
            try {
              if (tract.geometry) {
                const tractId = this.getTractId(tract);
                const isIntersecting = isIntersectingTract(tractId);
                
                // Use darker color for intersecting tracts
                const tractColor = isIntersecting ? this.darkenColor(color, 30) : color;
                
                const tractLayer = L.geoJSON(tract.geometry, {
                  style: {
                    color: 'black',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 1,
                    fillColor: tractColor
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
                    const highlightedAdjacent = this.highlightedAdjacentTracts.get(groupIndex);
                    const isHighlighted = highlightedAdjacent ? highlightedAdjacent.has(tractIndex) : false;
                    const finalColor = isHighlighted ? this.lightenColor(color, 20) : (isIntersecting ? this.darkenColor(color, 30) : color);
                    tractLayer.setStyle({
                      weight: 1,
                      fillOpacity: 1,
                      fillColor: finalColor
                    });
                  }
                  map.getContainer().style.cursor = '';
                });
                
                // Add click handler - special handling for intersecting tracts
                tractLayer.on('click', () => {
                  if (isIntersecting) {
                    this.handleIntersectingTractClick(groupIndex, tractIndex);
                  } else {
                    this.selectTract(groupIndex, tractIndex.toString());
                  }
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
    
    // Identify intersecting tracts for all groups
    this.identifyIntersectingTracts();
    
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
    
    // Clear step overview tract layers tracking
    this.stepOverviewTractLayers.clear();
    this.selectedStepOverviewIntersectingTract = null;
    this.highlightedStepOverviewAdjacentTracts.clear();
    this.isolatedStepOverviewAdjacentTracts.clear();

    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      const intersectingIds = this.intersectingTractIds.get(index);
      const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
      
      // Add individual tract geometries instead of combined geometry
      group.censusTracts.forEach(tract => {
        if (tract.geometry) {
          const tractId = this.getTractId(tract);
          const isIntersecting = isIntersectingTract(tractId);
          
          // Use darker color for intersecting tracts
          const tractColor = isIntersecting ? this.darkenColor(color, 30) : color;
          
          const geoJson = L.geoJSON(tract.geometry, {
            style: {
              color: 'black',//color,
              weight: 1,
              opacity: 1,//0.8,
              fillOpacity: 1,//0.6,
              fillColor: tractColor
            }
          }).bindPopup(`
            <strong>Tract Information</strong><br>
            <strong>Tract ID:</strong> ${tract.properties?.TRACT_FIPS || tract.properties?.['GEOID'] || 'Unknown'}<br>
            <strong>Population:</strong> ${(tract.properties?.POPULATION || 0).toLocaleString()}<br>
            <strong>Name:</strong> ${tract.properties?.NAME || 'Unknown'}<br>
            <strong>County:</strong> ${tract.properties?.COUNTY_FIPS || tract.properties?.COUNTY || 'Unknown'}<br>
            <strong>State:</strong> ${tract.properties?.STATE_FIPS || tract.properties?.STATE || 'Unknown'}<br>
            ${isIntersecting ? '<strong>Intersecting Tract</strong><br>' : ''}
            <hr>
            <strong>Group ${index + 1}</strong><br>
            Districts: ${group.startDistrictNumber}-${group.endDistrictNumber}<br>
            Group Population: ${group.totalPopulation.toLocaleString()}<br>
            Group Tracts: ${group.censusTracts.length}
          `);
          
          // Store tract layer for click handling
          this.stepOverviewTractLayers.set(tractId, geoJson);
          
          // Add click handler and cursor styling for intersecting tracts
          if (isIntersecting) {
            geoJson.on('click', () => {
              this.handleStepOverviewIntersectingTractClick(tractId);
            });
            
            // Add cursor pointer on hover for intersecting tracts
            geoJson.on('mouseover', () => {
              if (this.stepOverviewMap) {
                this.stepOverviewMap.getContainer().style.cursor = 'pointer';
              }
            });
            
            geoJson.on('mouseout', () => {
              if (this.stepOverviewMap) {
                this.stepOverviewMap.getContainer().style.cursor = '';
              }
            });
          }
          
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
      
      // Add division lines for all previous steps (static) and animate current step
      if (this.currentStep && this.algorithmResult) {
        setTimeout(() => {
          if (!this.stepOverviewMap || !this.currentStep || !this.algorithmResult) {
            console.warn('⚠️ Map, step, or algorithm result not available for division lines');
            return;
          }

          // Add static lines for all previous steps (1 to currentStepIndex - 1)
          for (let stepIdx = 1; stepIdx < this.currentStepIndex; stepIdx++) {
            const step = this.algorithmResult.steps[stepIdx];
            if (!step) continue;

            // Check if we've already added division lines for this step
            if (this.divisionLinesByStep.has(stepIdx)) {
              continue; // Already added, skip
            }

            this.addStaticDivisionLinesForStep(step, stepIdx);
          }

          // Animate only the current step's division lines
          if (this.currentStepIndex >= 1) {
            const currentStep = this.algorithmResult.steps[this.currentStepIndex];
            if (currentStep && !this.divisionLinesByStep.has(this.currentStepIndex)) {
              this.animateCurrentStepDivisionLines(currentStep, this.currentStepIndex);
            }
          }
        }, 200);
      }
    }
  }

  /**
   * Add static division lines for a previous step (no animation)
   */
  private addStaticDivisionLinesForStep(step: any, stepIdx: number): void {
    const stepDivisionLines: L.Polyline[] = [];

    if (step.divisionLines && step.divisionLines.length > 0) {
      console.log(`📏 Adding static lines for previous step ${stepIdx} (${step.divisionLines.length} line(s))`);

      for (const divLineInfo of step.divisionLines) {
        const staticLine = this.createStaticDivisionLine(divLineInfo, stepIdx);
        if (staticLine) {
          stepDivisionLines.push(staticLine);
        }
      }

    } else if (step.divisionLine && step.divisionDirection) {
      // Fallback to old format for backward compatibility
      console.log(`📏 Using legacy division line format for step ${stepIdx}`);
    }

    // Store division lines for this step
    if (stepDivisionLines.length > 0) {
      this.divisionLinesByStep.set(stepIdx, stepDivisionLines);
      console.log(`✅ Added static lines for step ${stepIdx} (${stepDivisionLines.length} line(s))`);
    }
  }

  /**
   * Animate division lines for the current step only
   */
  private async animateCurrentStepDivisionLines(step: any, stepIdx: number): Promise<void> {
    if (!step.divisionLines || step.divisionLines.length === 0) {
      return;
    }

    console.log(`🎬 Animating current step ${stepIdx} with ${step.divisionLines.length} division line(s)`);

    const stepDivisionLines: L.Polyline[] = [];
    const animationPromises: Promise<L.Polyline>[] = [];

    // Start all animations for this step simultaneously
    for (const divLineInfo of step.divisionLines) {
      const animationPromise = this.createAnimatedDivisionLine(divLineInfo, stepIdx);
      if (animationPromise) {
        // Filter out null results after promise resolves
        const filteredPromise = animationPromise.then(line => {
          if (line === null) {
            throw new Error('Animation line is null');
          }
          return line;
        });
        animationPromises.push(filteredPromise);
      }
    }

    // Wait for all animations to complete
    if (animationPromises.length > 0) {
      try {
        const completedLines = await Promise.all(animationPromises);
        stepDivisionLines.push(...completedLines.filter(line => line !== null));
        console.log(`✅ Completed animations for step ${stepIdx} (${completedLines.length} line(s))`);
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
  private createStaticDivisionLine(divLineInfo: any, stepIdx: number): L.Polyline | null {
    try {
      const { line: divisionLine, direction, parentGroup, ratio: divisionRatio } = divLineInfo;

      // Find the parent group in the previous step to get its bounds
      const prevStep = stepIdx > 0 ? this.algorithmResult!.steps[stepIdx - 1] : null;
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

      if (!groupBounds || !groupBounds.isValid()) {
        console.warn(`Invalid bounds for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}`);
        return null;
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
        console.warn(`Invalid line coordinates for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}, skipping`);
        return null;
      }

      // Create static line (no animation)
      if (this.stepOverviewMap) {
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

        divisionLineLayer.addTo(this.stepOverviewMap);
        this.divisionLineLayers.push(divisionLineLayer);

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

        if (this.stepOverviewMap) {
          marker.addTo(this.stepOverviewMap);
          this.divisionLineMarkers.push(marker);
        }

        return divisionLineLayer;
      }

      return null;
    } catch (error) {
      console.error(`Error creating static division line for step ${stepIdx}:`, error);
      return null;
    }
  }

  /**
   * Create and animate a single division line
   */
  private async createAnimatedDivisionLine(divLineInfo: any, stepIdx: number): Promise<L.Polyline | null> {
    try {
      const { line: divisionLine, direction, parentGroup, ratio: divisionRatio } = divLineInfo;

      // Find the parent group in the previous step to get its bounds
      const prevStep = stepIdx > 0 ? this.algorithmResult!.steps[stepIdx - 1] : null;
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

      if (!groupBounds || !groupBounds.isValid()) {
        console.warn(`Invalid bounds for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}`);
        return null;
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
        console.warn(`Invalid line coordinates for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber}, skipping`);
        return null;
      }

      // Animate the drawing of the division line
      if (this.stepOverviewMap) {
        const divisionLineLayer = await this.animateLineDrawing(lineCoordinates, this.stepOverviewMap, {
          duration: 1500, // 1.5 seconds animation
          color: '#ff0000',
          weight: 3,
          dashArray: '10, 5',
          dotSize: 10
        });

        // Bind popup to the animated line after animation completes
        divisionLineLayer.bindPopup(`
          <strong>Division Line</strong><br>
          Step ${stepIdx}<br>
          ${direction === 'latitude' ? 'Latitude' : 'Longitude'}: ${divisionLine.toFixed(6)}${direction === 'latitude' ? '°N' : '°W'}<br>
          Dividing group (Districts ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber})<br>
          Ratio: ${divisionRatio[0]}% / ${divisionRatio[1]}%
        `);

        // Track the final line
        this.divisionLineLayers.push(divisionLineLayer);

        // Add marker after animation completes
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

        if (this.stepOverviewMap) {
          marker.addTo(this.stepOverviewMap);
          this.divisionLineMarkers.push(marker);
        }

        console.log(`✅ Animated division line for step ${stepIdx}, parent group ${parentGroup.startDistrictNumber}-${parentGroup.endDistrictNumber} (${divisionRatio[0]}%/${divisionRatio[1]}%)`);
        return divisionLineLayer;
      }

      return null;
    } catch (error) {
      console.error(`Error creating animated division line for step ${stepIdx}:`, error);
      return null;
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
      maxIterations: 100
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

    const subscription = this.geodistrictService.executeNextStepLocally(this.algorithmResult).subscribe({
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
   * Calculate population variance as a percentage (with two decimal places)
   * @param district The district group
   * @returns Variance percentage (0 = exact match, >0 = over target, <0 = under target)
   */
  calculatePopulationVariancePercentage(district: DistrictGroup): number {
    const ratio = this.calculatePopulationVarianceRatio(district);
    return (ratio - 1) * 100;
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
    
    // Reset all tract layer styles first, preserving intersecting tract colors and adjacent tract highlighting
    const groupTractLayers = this.tractLayers.get(groupIndex);
    if (groupTractLayers) {
      const groupColor = this.getGroupColor(groupIndex);
      const intersectingIds = this.intersectingTractIds.get(groupIndex);
      const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
      const highlightedAdjacent = this.highlightedAdjacentTracts.get(groupIndex);
      const isolatedAdjacent = this.isolatedAdjacentTracts.get(groupIndex);
      
      groupTractLayers.forEach((layer, tractIdx) => {
        const tract = group.censusTracts[tractIdx];
        const tractId = this.getTractId(tract);
        const isIntersecting = isIntersectingTract(tractId);
        const isHighlighted = highlightedAdjacent ? highlightedAdjacent.has(tractIdx) : false;
        
        // Check if this tract is isolated in any opposite group
        let isIsolated = false;
        if (isolatedAdjacent) {
          isolatedAdjacent.forEach((tractIndices, oppositeGroupIndex) => {
            if (tractIndices.has(tractIdx)) {
              isIsolated = true;
            }
          });
        }
        
        // Determine the correct color based on intersecting, highlighted, and isolated state
        let fillColor: string;
        if (isIsolated) {
          fillColor = '#ffff00'; // Yellow for isolated adjacent tracts
        } else if (isHighlighted) {
          fillColor = this.lightenColor(groupColor, 20);
        } else if (isIntersecting) {
          fillColor = this.darkenColor(groupColor, 30);
        } else {
          fillColor = groupColor;
        }
        
        (layer as any).setStyle({
          color: 'black',
          weight: 1,
          opacity: 1,
          fillOpacity: 1,
          fillColor: fillColor
        });
      });
    }
    
    // Also update isolated adjacent tracts in opposite groups
    const isolatedAdjacentForGroup = this.isolatedAdjacentTracts.get(groupIndex);
    if (isolatedAdjacentForGroup) {
      isolatedAdjacentForGroup.forEach((tractIndices: Set<number>, oppositeGroupIndex: number) => {
        const otherGroupTractLayers = this.tractLayers.get(oppositeGroupIndex);
        if (!otherGroupTractLayers) return;
        
        tractIndices.forEach(tractIndex => {
          const tractLayer = otherGroupTractLayers.get(tractIndex);
          if (tractLayer) {
            // Use yellow color for isolated adjacent tracts
            (tractLayer as any).setStyle({
              fillColor: '#ffff00' // Yellow
            });
          }
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
    this.intersectingTractIds.clear();
    this.selectedIntersectingTract = null;
    this.highlightedAdjacentTracts.clear();
    this.isolatedAdjacentTracts.clear();
    this.stepOverviewTractLayers.clear();
    this.selectedStepOverviewIntersectingTract = null;
    this.highlightedStepOverviewAdjacentTracts.clear();
    this.isolatedStepOverviewAdjacentTracts.clear();
  }

  /**
   * Identify intersecting tracts for all groups in the current step
   * Uses the intersecting tract IDs stored in division lines from previous steps
   */
  private identifyIntersectingTracts(): void {
    if (!this.currentStep || !this.algorithmResult) return;
    
    this.intersectingTractIds.clear();
    
    // For each group in the current step, collect intersecting tract IDs from division lines
    this.currentStep.districtGroups.forEach((group, groupIndex) => {
      const intersectingIds = new Set<string>();
      
      // Check all previous steps to find division lines that might intersect this group's tracts
      for (let stepIdx = 1; stepIdx <= this.currentStepIndex; stepIdx++) {
        const step = this.algorithmResult!.steps[stepIdx];
        if (!step || !step.divisionLines) continue;
        
        // Check each division line in this step
        for (const divLineInfo of step.divisionLines) {
          const { parentGroup, intersectingTractIds } = divLineInfo;
          
          // Check if this group is a descendant of the parent group that was divided
          const isDescendant = group.startDistrictNumber >= parentGroup.startDistrictNumber &&
                               group.endDistrictNumber <= parentGroup.endDistrictNumber;
          
          if (isDescendant && intersectingTractIds) {
            // Add intersecting tract IDs that belong to this group
            intersectingTractIds.forEach(tractId => {
              // Check if this tract ID belongs to this group
              const tractInGroup = group.censusTracts.some(tract => this.getTractId(tract) === tractId);
              if (tractInGroup) {
                intersectingIds.add(tractId);
              }
            });
          }
        }
      }
      
      if (intersectingIds.size > 0) {
        this.intersectingTractIds.set(groupIndex, intersectingIds);
        console.log(`🔍 Group ${groupIndex}: Found ${intersectingIds.size} intersecting tract(s) from division lines`);
      }
    });
  }


  /**
   * Darken a color by a certain percentage
   */
  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) - amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) - amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) - amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  /**
   * Lighten a color by a certain percentage
   */
  private lightenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  /**
   * Calculate the total number of reachable adjacent tracts recursively for a tract
   * Returns the size of the set of all reachable tracts (including the tract itself)
   */
  private calculateReachableTracts(tractId: string, groupTracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>): number {
    const groupTractIds = new Set<string>(groupTracts.map(t => this.getTractId(t)));
    
    // BFS traversal to find all reachable tracts
    const reachableTracts = new Set<string>();
    const queue: string[] = [tractId];
    reachableTracts.add(tractId);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const neighbors = adjacencyGraph.get(currentId) || [];
      
      for (const neighborId of neighbors) {
        // Only include neighbors that are in this group
        if (groupTractIds.has(neighborId) && !reachableTracts.has(neighborId)) {
          reachableTracts.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    
    return reachableTracts.size;
  }

  /**
   * Calculate the maximum reachable count for all tracts in a group
   * This represents the size of the main component
   */
  private calculateMaxReachableCount(groupTracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>): number {
    let maxReachableCount = 0;
    for (const tract of groupTracts) {
      const tractId = this.getTractId(tract);
      const reachableCount = this.calculateReachableTracts(tractId, groupTracts, adjacencyGraph);
      if (reachableCount > maxReachableCount) {
        maxReachableCount = reachableCount;
      }
    }
    return maxReachableCount;
  }

  /**
   * Check if a tract is isolated
   * A tract is isolated if its reachable count is less than the maximum reachable count in the group
   * (i.e., it's in a smaller component than the main component)
   */
  private isTractIsolated(tractId: string, groupTracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>): boolean {
    const reachableTractsCount = this.calculateReachableTracts(tractId, groupTracts, adjacencyGraph);
    const maxReachableCount = this.calculateMaxReachableCount(groupTracts, adjacencyGraph);
    return reachableTractsCount < maxReachableCount;
  }

  /**
   * Handle click on an intersecting tract
   * Toggles highlighting of adjacent tracts
   */
  private handleIntersectingTractClick(groupIndex: number, tractIndex: number): void {
    if (!this.currentStep?.districtGroups[groupIndex]) {
      console.log(`⚠️ Group map: No current step or group ${groupIndex} not found`);
      return;
    }
    
    const group = this.currentStep.districtGroups[groupIndex];
    const tract = group.censusTracts[tractIndex];
    const tractId = this.getTractId(tract);
    
    console.log(`🖱️ Group map: Intersecting tract ${tractId} clicked in group ${groupIndex} (handler called)`);
    
    // Check if this is the same intersecting tract that's already selected
    const isCurrentlySelected = this.selectedIntersectingTract?.groupIndex === groupIndex &&
                                 this.selectedIntersectingTract?.tractIndex === tractIndex;
    
    if (isCurrentlySelected) {
      // Deselect: remove highlighting from adjacent tracts
      console.log(`🔄 Group map: Deselecting intersecting tract ${tractId}`);
      this.removeAdjacentTractHighlighting(groupIndex);
      this.selectedIntersectingTract = null;
    } else {
      // Select: highlight adjacent tracts
      console.log(`🔄 Group map: Selecting intersecting tract ${tractId}`);
      
      // First, clear any previous highlighting
      if (this.selectedIntersectingTract) {
        this.removeAdjacentTractHighlighting(this.selectedIntersectingTract.groupIndex);
      }
      
      // Build adjacency graph for all groups to find adjacent tracts in opposite groups
      const allTracts: GeoJsonFeature[] = [];
      this.currentStep.districtGroups.forEach(g => {
        allTracts.push(...g.censusTracts);
      });
      
      console.log(`🔍 Group map: Building adjacency graph for ${allTracts.length} total tracts`);
      
      const allAdjacencyGraph = this.geodistrictService.buildGeometryAdjacencyGraph(allTracts);
      const neighbors = allAdjacencyGraph.get(tractId) || [];
      
      console.log(`🔍 Group map: Found ${neighbors.length} adjacent tract(s) for ${tractId}`);
      
      // Find adjacent tracts in opposite groups and check for isolation
      const adjacentTractIndices = new Set<number>();
      const isolatedAdjacentTractsByGroup = new Map<number, Set<number>>(); // Map of oppositeGroupIndex -> Set of tractIndices
      
      neighbors.forEach((neighborId, index) => {
        console.log(`🔍 Group map: Processing neighbor ${index + 1}/${neighbors.length}: ${neighborId}`);
        // Find which group this neighbor belongs to
        let neighborGroupIndex = -1;
        let neighborTractIndex = -1;
        
        if (!this.currentStep) return;
        
        for (let i = 0; i < this.currentStep.districtGroups.length; i++) {
          const g = this.currentStep.districtGroups[i];
          const index = g.censusTracts.findIndex(t => this.getTractId(t) === neighborId);
          if (index !== -1) {
            neighborGroupIndex = i;
            neighborTractIndex = index;
            break;
          }
        }
        
        if (neighborGroupIndex === -1) return; // Neighbor not found
        
        if (neighborGroupIndex === groupIndex) {
          // Same group neighbor
          adjacentTractIndices.add(neighborTractIndex);
        } else {
          // Neighbor is in opposite group - check for isolation
          if (!this.currentStep) return;
          const neighborGroup = this.currentStep.districtGroups[neighborGroupIndex];
          
          // Build adjacency graph for neighbor's group
          const neighborGroupAdjacencyGraph = this.geodistrictService.buildGeometryAdjacencyGraph(neighborGroup.censusTracts);
          
          // Check if neighbor is isolated using the new definition:
          // A tract is isolated if its reachable count is less than the maximum reachable count in the group
          const totalTractsInGroup = neighborGroup.censusTracts.length;
          const reachableTractsCount = this.calculateReachableTracts(neighborId, neighborGroup.censusTracts, neighborGroupAdjacencyGraph);
          const maxReachableCount = this.calculateMaxReachableCount(neighborGroup.censusTracts, neighborGroupAdjacencyGraph);
          const isIsolated = reachableTractsCount < maxReachableCount;
          
          // Log isolation check result
          console.log(`🔍 Isolation check for adjacent tract ${neighborId} in opposite group ${neighborGroupIndex}:`);
          console.log(`   - Total tracts in group: ${totalTractsInGroup}`);
          console.log(`   - Reachable tracts count: ${reachableTractsCount}`);
          console.log(`   - Max reachable count (main component): ${maxReachableCount}`);
          console.log(`   - Is isolated: ${isIsolated} (${reachableTractsCount} < ${maxReachableCount})`);
          
          if (isIsolated) {
            if (!isolatedAdjacentTractsByGroup.has(neighborGroupIndex)) {
              isolatedAdjacentTractsByGroup.set(neighborGroupIndex, new Set<number>());
            }
            isolatedAdjacentTractsByGroup.get(neighborGroupIndex)!.add(neighborTractIndex);
            console.log(`   ✅ Marked as isolated - will be highlighted in yellow`);
          } else {
            console.log(`   ℹ️ Not isolated - will be highlighted in lighter color`);
          }
        }
      });
      
      // Store highlighted adjacent tracts
      this.highlightedAdjacentTracts.set(groupIndex, adjacentTractIndices);
      this.isolatedAdjacentTracts.set(groupIndex, isolatedAdjacentTractsByGroup);
      this.selectedIntersectingTract = { groupIndex, tractIndex };
      
      // Apply lighter color to adjacent tracts and yellow to isolated ones
      this.applyAdjacentTractHighlighting(groupIndex, adjacentTractIndices, isolatedAdjacentTractsByGroup);
      
      const totalIsolated = Array.from(isolatedAdjacentTractsByGroup.values()).reduce((sum, set) => sum + set.size, 0);
      console.log(`📊 Summary for intersecting tract ${tractId} clicked:`);
      console.log(`   - Same group adjacent tracts: ${adjacentTractIndices.size} (highlighted in lighter color)`);
      console.log(`   - Opposite group isolated adjacent tracts: ${totalIsolated} (highlighted in yellow)`);
      console.log(`   - Opposite group non-isolated adjacent tracts: ${neighbors.length - adjacentTractIndices.size - totalIsolated}`);
    }
  }

  /**
   * Apply lighter color to adjacent tracts and yellow to isolated adjacent tracts in opposite groups
   */
  private applyAdjacentTractHighlighting(groupIndex: number, adjacentTractIndices: Set<number>, isolatedAdjacentTractsByGroup: Map<number, Set<number>> = new Map()): void {
    const groupTractLayers = this.tractLayers.get(groupIndex);
    if (!groupTractLayers) return;
    
    const group = this.currentStep?.districtGroups[groupIndex];
    if (!group) return;
    
    const groupColor = this.getGroupColor(groupIndex);
    const intersectingIds = this.intersectingTractIds.get(groupIndex);
    const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
    
    // Apply lighter color to adjacent tracts in same group
    adjacentTractIndices.forEach(tractIndex => {
      const tractLayer = groupTractLayers.get(tractIndex);
      if (tractLayer) {
        const tract = group.censusTracts[tractIndex];
        const tractId = this.getTractId(tract);
        const isIntersecting = isIntersectingTract(tractId);
        // Use lighter color for adjacent tracts (even if they're intersecting)
        const lighterColor = this.lightenColor(groupColor, 20);
        (tractLayer as any).setStyle({
          fillColor: lighterColor
        });
      }
    });
    
    // Apply yellow color to isolated adjacent tracts in opposite groups
    isolatedAdjacentTractsByGroup.forEach((tractIndices, oppositeGroupIndex) => {
      const otherGroupTractLayers = this.tractLayers.get(oppositeGroupIndex);
      if (!otherGroupTractLayers) return;
      
      tractIndices.forEach(tractIndex => {
        const tractLayer = otherGroupTractLayers.get(tractIndex);
        if (tractLayer) {
          // Use yellow color for isolated adjacent tracts
          (tractLayer as any).setStyle({
            fillColor: '#ffff00' // Yellow
          });
        }
      });
    });
  }

  /**
   * Handle click on an intersecting tract in the step overview map
   * Highlights adjacent tracts across all district groups
   */
  private handleStepOverviewIntersectingTractClick(tractId: string): void {
    console.log(`🖱️ Step overview: Intersecting tract ${tractId} clicked (handler called)`);
    
    if (!this.currentStep) {
      console.log(`⚠️ Step overview: No current step available`);
      return;
    }
    
    // Check if this is the same intersecting tract that's already selected
    const isCurrentlySelected = this.selectedStepOverviewIntersectingTract === tractId;
    
    if (isCurrentlySelected) {
      // Deselect: remove highlighting from adjacent tracts
      console.log(`🔄 Step overview: Deselecting intersecting tract ${tractId}`);
      this.removeStepOverviewAdjacentTractHighlighting();
      this.selectedStepOverviewIntersectingTract = null;
    } else {
      // Select: highlight adjacent tracts across all groups
      console.log(`🔄 Step overview: Selecting intersecting tract ${tractId}`);
      
      // First, clear any previous highlighting
      if (this.selectedStepOverviewIntersectingTract) {
        this.removeStepOverviewAdjacentTractHighlighting();
      }
      
      // Find which group the clicked intersecting tract belongs to
      let clickedGroupIndex = -1;
      for (let i = 0; i < this.currentStep.districtGroups.length; i++) {
        const g = this.currentStep.districtGroups[i];
        if (g.censusTracts.some(t => this.getTractId(t) === tractId)) {
          clickedGroupIndex = i;
          break;
        }
      }
      
      console.log(`📍 Step overview: Clicked tract ${tractId} belongs to group ${clickedGroupIndex}`);
      
      // Collect all tracts from all groups in the current step
      const allTracts: GeoJsonFeature[] = [];
      this.currentStep.districtGroups.forEach(group => {
        allTracts.push(...group.censusTracts);
      });
      
      console.log(`🔍 Step overview: Building adjacency graph for ${allTracts.length} total tracts`);
      
      // Build adjacency graph for all tracts across all groups
      const adjacencyGraph = this.geodistrictService.buildGeometryAdjacencyGraph(allTracts);
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      console.log(`🔍 Step overview: Found ${neighbors.length} adjacent tract(s) for ${tractId}`);
      
      // Store highlighted adjacent tract IDs and check for isolation
      this.highlightedStepOverviewAdjacentTracts.clear();
      this.isolatedStepOverviewAdjacentTracts.clear();
      
      let sameGroupAdjacentCount = 0;
      let oppositeGroupIsolatedCount = 0;
      let oppositeGroupNonIsolatedCount = 0;
      
      neighbors.forEach((neighborId, index) => {
        console.log(`🔍 Step overview: Processing neighbor ${index + 1}/${neighbors.length}: ${neighborId}`);
        // Find which group this neighbor belongs to
        let neighborGroupIndex = -1;
        
        if (!this.currentStep) return;
        
        for (let i = 0; i < this.currentStep.districtGroups.length; i++) {
          const g = this.currentStep.districtGroups[i];
          if (g.censusTracts.some(t => this.getTractId(t) === neighborId)) {
            neighborGroupIndex = i;
            break;
          }
        }
        
        if (neighborGroupIndex === -1) return; // Neighbor not found
        
        if (neighborGroupIndex === clickedGroupIndex) {
          // Same group neighbor
          this.highlightedStepOverviewAdjacentTracts.add(neighborId);
          sameGroupAdjacentCount++;
        } else {
          // Neighbor is in opposite group - check for isolation
          if (!this.currentStep) return;
          const neighborGroup = this.currentStep.districtGroups[neighborGroupIndex];
          
          // Build adjacency graph for neighbor's group
          const neighborGroupAdjacencyGraph = this.geodistrictService.buildGeometryAdjacencyGraph(neighborGroup.censusTracts);
          
          // Check if neighbor is isolated using the new definition:
          // A tract is isolated if its reachable count is less than the maximum reachable count in the group
          const totalTractsInGroup = neighborGroup.censusTracts.length;
          const reachableTractsCount = this.calculateReachableTracts(neighborId, neighborGroup.censusTracts, neighborGroupAdjacencyGraph);
          const maxReachableCount = this.calculateMaxReachableCount(neighborGroup.censusTracts, neighborGroupAdjacencyGraph);
          const isIsolated = reachableTractsCount < maxReachableCount;
          
          // Log isolation check result
          console.log(`🔍 Step overview: Isolation check for adjacent tract ${neighborId} in opposite group ${neighborGroupIndex}:`);
          console.log(`   - Total tracts in group: ${totalTractsInGroup}`);
          console.log(`   - Reachable tracts count: ${reachableTractsCount}`);
          console.log(`   - Max reachable count (main component): ${maxReachableCount}`);
          console.log(`   - Is isolated: ${isIsolated} (${reachableTractsCount} < ${maxReachableCount})`);
          
          if (isIsolated) {
            this.isolatedStepOverviewAdjacentTracts.add(neighborId);
            oppositeGroupIsolatedCount++;
            console.log(`   ✅ Marked as isolated - will be highlighted in yellow`);
          } else {
            this.highlightedStepOverviewAdjacentTracts.add(neighborId);
            oppositeGroupNonIsolatedCount++;
            console.log(`   ℹ️ Not isolated - will be highlighted in lighter color`);
          }
        }
      });
      
      this.selectedStepOverviewIntersectingTract = tractId;
      
      // Apply lighter color to adjacent tracts and yellow to isolated ones
      this.applyStepOverviewAdjacentTractHighlighting();
      
      console.log(`📊 Step overview summary for intersecting tract ${tractId} clicked:`);
      console.log(`   - Same group adjacent tracts: ${sameGroupAdjacentCount} (highlighted in lighter color)`);
      console.log(`   - Opposite group isolated adjacent tracts: ${oppositeGroupIsolatedCount} (highlighted in yellow)`);
      console.log(`   - Opposite group non-isolated adjacent tracts: ${oppositeGroupNonIsolatedCount} (highlighted in lighter color)`);
      console.log(`   - Total adjacent tracts: ${neighbors.length}`);
    }
  }

  /**
   * Apply lighter color to adjacent tracts and yellow to isolated adjacent tracts in step overview map
   */
  private applyStepOverviewAdjacentTractHighlighting(): void {
    if (!this.currentStep) return;
    
    // Get all groups to determine colors
    this.currentStep.districtGroups.forEach((group, groupIndex) => {
      const groupColor = this.getGroupColor(groupIndex);
      const intersectingIds = this.intersectingTractIds.get(groupIndex);
      const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
      
      group.censusTracts.forEach(tract => {
        const tractId = this.getTractId(tract);
        const isHighlighted = this.highlightedStepOverviewAdjacentTracts.has(tractId);
        const isIsolated = this.isolatedStepOverviewAdjacentTracts.has(tractId);
        
        if (isIsolated) {
          const tractLayer = this.stepOverviewTractLayers.get(tractId);
          if (tractLayer) {
            // Use yellow color for isolated adjacent tracts
            (tractLayer as any).setStyle({
              fillColor: '#ffff00' // Yellow
            });
          }
        } else if (isHighlighted) {
          const tractLayer = this.stepOverviewTractLayers.get(tractId);
          if (tractLayer) {
            // Use lighter color for adjacent tracts (even if they're intersecting)
            const lighterColor = this.lightenColor(groupColor, 20);
            (tractLayer as any).setStyle({
              fillColor: lighterColor
            });
          }
        }
      });
    });
  }

  /**
   * Remove highlighting from adjacent tracts in step overview map
   */
  private removeStepOverviewAdjacentTractHighlighting(): void {
    if (!this.currentStep) return;
    
    // Get all groups to determine colors
    this.currentStep.districtGroups.forEach((group, groupIndex) => {
      const groupColor = this.getGroupColor(groupIndex);
      const intersectingIds = this.intersectingTractIds.get(groupIndex);
      const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
      
      group.censusTracts.forEach(tract => {
        const tractId = this.getTractId(tract);
        const wasHighlighted = this.highlightedStepOverviewAdjacentTracts.has(tractId);
        const wasIsolated = this.isolatedStepOverviewAdjacentTracts.has(tractId);
        
        if (wasHighlighted || wasIsolated) {
          const tractLayer = this.stepOverviewTractLayers.get(tractId);
          if (tractLayer) {
            const isIntersecting = isIntersectingTract(tractId);
            // Restore original color (darker if intersecting, normal otherwise)
            const originalColor = isIntersecting ? this.darkenColor(groupColor, 30) : groupColor;
            (tractLayer as any).setStyle({
              fillColor: originalColor
            });
          }
        }
      });
    });
    
    this.highlightedStepOverviewAdjacentTracts.clear();
    this.isolatedStepOverviewAdjacentTracts.clear();
  }

  /**
   * Remove highlighting from adjacent tracts
   */
  private removeAdjacentTractHighlighting(groupIndex: number): void {
    const highlightedAdjacent = this.highlightedAdjacentTracts.get(groupIndex);
    const isolatedAdjacent = this.isolatedAdjacentTracts.get(groupIndex);
    
    if (!highlightedAdjacent && !isolatedAdjacent) return;
    
    const groupTractLayers = this.tractLayers.get(groupIndex);
    if (!groupTractLayers) return;
    
    const group = this.currentStep?.districtGroups[groupIndex];
    if (!group) return;
    
    const groupColor = this.getGroupColor(groupIndex);
    const intersectingIds = this.intersectingTractIds.get(groupIndex);
    const isIntersectingTract = (tractId: string) => intersectingIds ? intersectingIds.has(tractId) : false;
    
    // Restore colors for highlighted adjacent tracts in same group
    if (highlightedAdjacent) {
      highlightedAdjacent.forEach(tractIndex => {
        const tractLayer = groupTractLayers.get(tractIndex);
        if (tractLayer) {
          const tract = group.censusTracts[tractIndex];
          const tractId = this.getTractId(tract);
          const isIntersecting = isIntersectingTract(tractId);
          // Restore original color (darker if intersecting, normal otherwise)
          const originalColor = isIntersecting ? this.darkenColor(groupColor, 30) : groupColor;
          (tractLayer as any).setStyle({
            fillColor: originalColor
          });
        }
      });
    }
    
    // Restore colors for isolated adjacent tracts in opposite groups
    if (isolatedAdjacent) {
      isolatedAdjacent.forEach((tractIndices, oppositeGroupIndex) => {
        const otherGroupTractLayers = this.tractLayers.get(oppositeGroupIndex);
        if (!otherGroupTractLayers) return;
        
        const otherGroupColor = this.getGroupColor(oppositeGroupIndex);
        const otherIntersectingIds = this.intersectingTractIds.get(oppositeGroupIndex);
        const isOtherIntersectingTract = (tractId: string) => otherIntersectingIds ? otherIntersectingIds.has(tractId) : false;
        
        if (!this.currentStep) return;
        
        tractIndices.forEach(tractIndex => {
          const tractLayer = otherGroupTractLayers.get(tractIndex);
          if (tractLayer && this.currentStep) {
            const otherGroup = this.currentStep.districtGroups[oppositeGroupIndex];
            const tract = otherGroup.censusTracts[tractIndex];
            const tractId = this.getTractId(tract);
            const isIntersecting = isOtherIntersectingTract(tractId);
            // Restore original color (darker if intersecting, normal otherwise)
            const originalColor = isIntersecting ? this.darkenColor(otherGroupColor, 30) : otherGroupColor;
            (tractLayer as any).setStyle({
              fillColor: originalColor
            });
          }
        });
      });
    }
    
    this.highlightedAdjacentTracts.delete(groupIndex);
    this.isolatedAdjacentTracts.delete(groupIndex);
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

  /**
   * Animate the drawing of a line with a moving dot effect
   * @param coordinates Array of LatLng coordinates for the line
   * @param map The Leaflet map to add the animation to
   * @param options Animation options
   * @returns Promise that resolves when animation is complete
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

      let currentIndex = 0;
      let progress = 0;
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
   * Render tracts as SVG in a div container instead of using Leaflet
   * @param containerId The ID of the container div
   * @param tracts Array of tract features to render
   * @param options Rendering options
   */
  private renderTractsAsSVG(
    containerId: string,
    tracts: any[],
    options: {
      width?: number;
      height?: number;
      padding?: number;
      colors?: Map<string, string>;
      defaultColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      intersectingTracts?: Set<string>;
      highlightedTracts?: Set<number>;
      isolatedTracts?: Set<number>;
    } = {}
  ): void {
    const {
      width = 800,
      height = 600,
      padding = 20,
      colors = new Map(),
      defaultColor = '#3498db',
      strokeColor = '#000000',
      strokeWidth = 1,
      intersectingTracts = new Set(),
      highlightedTracts = new Set(),
      isolatedTracts = new Set()
    } = options;

    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`SVG container with id ${containerId} not found`);
      return;
    }

    // Calculate bounds of all tracts
    const bounds = this.calculateTractsBounds(tracts);
    if (!bounds) {
      console.warn('No valid bounds found for tracts');
      return;
    }

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.border = '1px solid #ddd';
    svg.style.backgroundColor = '#f8f9fa';

    // Calculate scale and offset for projection
    const boundsWidth = bounds.maxLng - bounds.minLng;
    const boundsHeight = bounds.maxLat - bounds.minLat;
    const scaleX = (width - 2 * padding) / boundsWidth;
    const scaleY = (height - 2 * padding) / boundsHeight;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding + (width - 2 * padding - boundsWidth * scale) / 2;
    const offsetY = padding + (height - 2 * padding - boundsHeight * scale) / 2;

    // Function to project lat/lng to screen coordinates
    const project = (lng: number, lat: number): [number, number] => {
      const x = offsetX + (lng - bounds.minLng) * scale;
      const y = offsetY + (bounds.maxLat - lat) * scale; // Flip Y axis
      return [x, y];
    };

    // Convert GeoJSON to SVG path
    const geoJsonToPath = (geometry: any): string => {
      if (!geometry || !geometry.coordinates) return '';

      const convertRing = (ring: number[][]): string => {
        if (ring.length === 0) return '';

        const points = ring.map(coord => {
          const [x, y] = project(coord[0], coord[1]);
          return `${x},${y}`;
        });

        return `M ${points.join(' L ')} Z`;
      };

      if (geometry.type === 'Polygon') {
        return geometry.coordinates.map((ring: number[][], index: number) => {
          return convertRing(ring);
        }).join(' ');
      } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.map((polygon: number[][][]) => {
          return polygon.map((ring: number[][]) => convertRing(ring)).join(' ');
        }).join(' ');
      }

      return '';
    };

    // Create SVG groups for organization
    const tractsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tractsGroup.setAttribute('class', 'tracts-group');
    svg.appendChild(tractsGroup);

    // Render each tract
    tracts.forEach((tract, index) => {
      if (!tract.geometry) return;

      const tractId = this.getTractId(tract);
      const pathData = geoJsonToPath(tract.geometry);

      if (!pathData) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', strokeWidth.toString());
      path.setAttribute('fill-opacity', '1');
      path.setAttribute('stroke-opacity', '1');

      // Determine fill color based on tract state
      let fillColor = defaultColor;

      if (isolatedTracts.has(index)) {
        fillColor = '#ffff00'; // Yellow for isolated tracts
      } else if (highlightedTracts.has(index)) {
        // Use the appropriate color from the colors map or lighten default
        fillColor = this.lightenColor(defaultColor, 20);
      } else if (intersectingTracts.has(tractId)) {
        // Darken color for intersecting tracts
        fillColor = this.darkenColor(defaultColor, 30);
      } else {
        // Use assigned color or default
        fillColor = colors.get(tractId) || defaultColor;
      }

      path.setAttribute('fill', fillColor);

      // Add interactivity
      path.style.cursor = 'pointer';
      path.addEventListener('mouseover', () => {
        path.setAttribute('stroke-width', (strokeWidth + 1).toString());
        path.setAttribute('fill-opacity', '0.8');
      });

      path.addEventListener('mouseout', () => {
        path.setAttribute('stroke-width', strokeWidth.toString());
        path.setAttribute('fill-opacity', '1');
      });

      path.addEventListener('click', () => {
        console.log(`Clicked tract: ${tractId}`, tract);
        // Could emit event or call callback here
      });

      // Add title for tooltip
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Tract ${tractId} - Population: ${tract.properties?.POPULATION || 'Unknown'}`;
      path.appendChild(title);

      tractsGroup.appendChild(path);
    });

    // Clear existing content and add new SVG
    container.innerHTML = '';
    container.appendChild(svg);

    // Store reference for cleanup
    this.svgRenderers.set(containerId, svg);
  }

  /**
   * Calculate bounds of all tracts
   */
  private calculateTractsBounds(tracts: any[]): { minLng: number; maxLng: number; minLat: number; maxLat: number } | null {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    let hasValidBounds = false;

    tracts.forEach(tract => {
      if (!tract.geometry || !tract.geometry.coordinates) return;

      const processCoords = (coords: any) => {
        if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          const [lng, lat] = coords;
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          hasValidBounds = true;
        } else if (Array.isArray(coords)) {
          coords.forEach(processCoords);
        }
      };

      processCoords(tract.geometry.coordinates);
    });

    if (!hasValidBounds) return null;

    return { minLng, maxLng, minLat, maxLat };
  }

  /**
   * Public method to render tracts as SVG in a div container
   * This can be called from the template or external components
   * @param containerId The ID of the container div
   * @param tracts Array of tract features (optional - uses current step if not provided)
   * @param options Rendering options
   */
  renderTractsToDiv(
    containerId: string,
    tracts?: any[],
    options: {
      width?: number;
      height?: number;
      groupIndex?: number;
      showIntersecting?: boolean;
      showHighlighted?: boolean;
      showIsolated?: boolean;
    } = {}
  ): void {
    // Use provided tracts or get from current step
    let tractsToRender = tracts;
    if (!tractsToRender && this.currentStep) {
      if (options.groupIndex !== undefined && this.currentStep.districtGroups[options.groupIndex]) {
        tractsToRender = this.currentStep.districtGroups[options.groupIndex].censusTracts;
      } else {
        // Render all tracts from all groups
        tractsToRender = this.currentStep.districtGroups.flatMap(group => group.censusTracts);
      }
    }

    if (!tractsToRender || tractsToRender.length === 0) {
      console.warn('No tracts available to render');
      return;
    }

    // Build rendering options
    const renderOptions: any = {
      width: options.width || 800,
      height: options.height || 600,
      defaultColor: options.groupIndex !== undefined ? this.getGroupColor(options.groupIndex) : '#3498db'
    };

    // Add tract state information if requested
    if (options.showIntersecting && options.groupIndex !== undefined) {
      renderOptions.intersectingTracts = this.intersectingTractIds.get(options.groupIndex) || new Set();
    }

    if (options.showHighlighted && options.groupIndex !== undefined) {
      renderOptions.highlightedTracts = this.highlightedAdjacentTracts.get(options.groupIndex) || new Set();
    }

    if (options.showIsolated && options.groupIndex !== undefined) {
      const isolated = this.isolatedAdjacentTracts.get(options.groupIndex);
      if (isolated) {
        renderOptions.isolatedTracts = new Set(Array.from(isolated.values()).flatMap(set => Array.from(set)));
      }
    }

    // Render the tracts
    this.renderTractsAsSVG(containerId, tractsToRender, renderOptions);
  }

  /**
   * Demo method to show SVG rendering capabilities
   * Creates sample containers and renders tracts
   */
  demoSVGrendering(): void {
    if (!this.currentStep) {
      console.warn('No current step available for SVG demo');
      return;
    }

    // Create demo containers if they don't exist
    const demoContainer = document.createElement('div');
    demoContainer.id = 'svg-demo-container';
    demoContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      height: 300px;
      background: white;
      border: 2px solid #333;
      border-radius: 8px;
      z-index: 10000;
      padding: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    const title = document.createElement('h4');
    title.textContent = 'SVG Tract Rendering Demo';
    title.style.cssText = 'margin: 0 0 10px 0; color: #333; font-size: 14px;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      position: absolute;
      top: 5px;
      right: 10px;
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #666;
    `;
    closeBtn.onclick = () => document.body.removeChild(demoContainer);

    const svgContainer = document.createElement('div');
    svgContainer.id = 'demo-svg-canvas';
    svgContainer.style.cssText = 'width: 100%; height: calc(100% - 40px); border: 1px solid #ddd;';

    demoContainer.appendChild(title);
    demoContainer.appendChild(closeBtn);
    demoContainer.appendChild(svgContainer);
    document.body.appendChild(demoContainer);

    // Render the first group's tracts as SVG
    this.renderTractsToDiv('demo-svg-canvas', undefined, {
      width: 380,
      height: 240,
      groupIndex: 0,
      showIntersecting: true,
      showHighlighted: true,
      showIsolated: true
    });
  }
}