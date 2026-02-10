import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { Subscription, concat, lastValueFrom, of, forkJoin } from 'rxjs';
import { concatMap, tap, last, map, catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, GeodistrictOptions, DistrictGroup, DivisionLineInfo } from '../services/geodistrict-algorithm.service';
import { CongressionalBoundariesService } from '../services/congressional-boundaries.service';
import { GeoJsonFeature } from '../services/census.service';
import { PageHeaderComponent } from '../components/page-header.component';
import { StateRowComponent, StateRowData } from '../components/state-row.component';
import { StepBtnBarComponent } from '../components/step-btn-bar.component';
import { environment } from '../../environments/environment';

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
    StateRowComponent,
    StepBtnBarComponent,
  ],
  templateUrl: './maps-page.component.html',
  styleUrls: ['./maps-page.component.scss'],
})
export class MapsPageComponent implements OnInit, AfterViewInit, OnDestroy {
  selectedState: string = '';
  showTractBoundaries: boolean = false;
  showDivisionLines: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';
  canRunNextStep: boolean = false;
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  showSteps: boolean = false;
  isDetectingIsolation: boolean = false;
  isolatedTractIds: Set<string> = new Set(); // Track isolated tract IDs
  isolatedTractsData: { isolatedTractsByGroup: { [groupIndex: string]: string[] }, isolatedTractIds: string[], groupStats?: Array<{ groupIndex: number; maxReachable: number; totalTracts: number; groupLabel: string }> } | null = null;
  bridgeTractIds: Set<string> = new Set(); // Track bridge tract IDs
  isMovingBridgeTracts: boolean = false;
  isMovingIsolatedTracts: boolean = false;
  isRunningAllSteps: boolean = false;
  bridgeTractsData: { bridgeTractsByIsolatedGroup: { [groupIndex: string]: Array<{tractId: string, fromGroupIndex: number, adjacentIsolatedCount: number}> } } | null = null;
  isDetectingBridge: boolean = false;
  selectedDistrictGroupIndex: number | null = null; // Track selected district group for highlighting
  isAdminMode: boolean = false; // Track if admin mode is enabled via #admin hash
  hasShownSorting: boolean = false; // Track if sorting visualization has been shown for current step 0
  isSortingVisualization: boolean = false; // Track if we're currently showing sorting visualization
  /** Raw slider position 0..sliderMax. Mapped to tract range: when positions < tracts each step = range of tracts; when positions > tracts multiple steps = same tract. */
  sortSliderValue: number = 0;
  readonly sliderMax: number = 1000;
  private hashChangeHandler?: () => void; // Store reference to hash change handler
  
  private map: L.Map | null = null;
  /** Congressional district boundaries (119th) for selected state; drawn below tract layer. */
  private congressionalLayer: L.LayerGroup | null = null;
  private tractLayer: L.LayerGroup | null = null;
  /** Guard to prevent re-entrant render (stops render loop) */
  private isRenderingDistricts = false;
  private tractGeoJsonLayers: Map<L.GeoJSON, string> = new Map(); // Store layer -> color mapping
  private tractIdToLayer: Map<string, L.GeoJSON> = new Map(); // Store tract ID -> layer mapping for popup access
  /** Tract IDs currently highlighted by slider (for setStyle updates only; no full re-render) */
  private lastSliderHighlightedTractIds: Set<string> = new Set();
  /** Cached sorted tract IDs for current step/DG so slider position → IDs needs no per-event sort. */
  private cachedSortedTractIds: string[] = [];
  private cachedSortedTractIdsKey = '';
  /** Cached sorted tract entries with bounds + population and prefix sum for division-line split and population (O(log N) / O(1)). */
  private cachedSortedTractEntries: Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }> = [];
  private cachedNorthPrefixSum: number[] = []; // northPrefixSum[i] = sum of population for tracts 0..i-1
  private cachedTotalPopulation = 0;
  private divisionLineDragHandle: L.Marker | null = null;
  private divisionLineLabelNorth: L.Marker | null = null;
  private divisionLineLabelSouth: L.Marker | null = null;
  private divisionLineDragging = false;
  /** When step has multiple DGs, one division line per DG. */
  private divisionLineControlsByDg: Array<{ line: L.Polyline; handle: L.Marker; labelNorth: L.Marker; labelSouth: L.Marker; dgIndex: number }> = [];
  /** Per-DG split value (0..sliderMax) when showing multiple DGs. */
  private sortSliderValueByDgIndex: Record<number, number> = {};
  /** Cached sorted entries per DG for multi-DG division lines (key = dgIndex). */
  private cachedSortedTractEntriesByDg: Map<number, { entries: Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }>; prefixSum: number[]; total: number }> = new Map();
  /** Throttle slider updates to reduce work while dragging. */
  private static readonly SLIDER_THROTTLE_MS = 100;
  private lastSliderUpdateTime = 0;
  private pendingSliderUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Line on map showing sort-position boundary (southernmost lat or easternmost lng of highlighted tracts). */
  private sliderPositionLineLayer: L.Polyline | null = null;
  /** State bounds used for slider track length and min zoom (set when fitting map to state). */
  private stateBoundsForSlider: L.LatLngBounds | null = null;
  /** Slider track length in px to align with state extent on map (set from projected bounds). */
  sliderTrackLengthPx: number | null = null;
  private subscriptions: Subscription[] = [];
  private divisionLineLayers: L.Polyline[] = []; // Track all division line layers
  private divisionLinesByStep: Map<number, L.Polyline[]> = new Map(); // Track division lines by step number
  private divisionLineMarkers: L.Marker[] = []; // Track all division line markers
  private animatedLineLayers: L.Layer[] = []; // Track animated line layers for cleanup
  private loadedSteps: GeodistrictStep[] = []; // Store steps as they arrive
  private totalSteps: number = 0; // Total number of steps (known when complete)
  private isLoadingSteps: boolean = false; // Track if we're currently loading steps
  private allTracts: GeoJsonFeature[] = []; // Store all tracts for isolation detection
  private mapToggleControl: L.Control | null = null; // Custom toggle control
  isPlaying: boolean = false; // Track if auto-playing steps
  private playInterval: any = null; // Interval for auto-playing steps

  /** US map view: states with completed final step and their step data */
  usMapStepDataByState: Array<{ stateCode: string; stepData: GeodistrictStep }> = [];
  /** Total district count across completed states (435 when all done) */
  usMapTotalDistricts: number = 0;
  /** State codes that have a completed final step (for table completion indicator) */
  completedStateCodes: Set<string> = new Set();

  // US States with their congressional district counts
  states = [
    { code: 'CA', name: 'California', districts: 52 },
    { code: 'TX', name: 'Texas', districts: 38 },
    { code: 'FL', name: 'Florida', districts: 28 },
    { code: 'NY', name: 'New York', districts: 26 },
    { code: 'IL', name: 'Illinois', districts: 17 },
    { code: 'PA', name: 'Pennsylvania', districts: 17 },
    { code: 'NC', name: 'North Carolina', districts: 14 },
    { code: 'GA', name: 'Georgia', districts: 14 },
    { code: 'MI', name: 'Michigan', districts: 13 },
    { code: 'NJ', name: 'New Jersey', districts: 12 },
    { code: 'VA', name: 'Virginia', districts: 11 },
    { code: 'WA', name: 'Washington', districts: 10 },
    { code: 'AZ', name: 'Arizona', districts: 9 },
    { code: 'IN', name: 'Indiana', districts: 9 },
    { code: 'MA', name: 'Massachusetts', districts: 9 },
    { code: 'TN', name: 'Tennessee', districts: 9 },
    { code: 'CO', name: 'Colorado', districts: 8 },
    { code: 'MD', name: 'Maryland', districts: 8 },
    { code: 'MN', name: 'Minnesota', districts: 8 },
    { code: 'MO', name: 'Missouri', districts: 8 },
    { code: 'WI', name: 'Wisconsin', districts: 8 },
    { code: 'AL', name: 'Alabama', districts: 7 },
    { code: 'SC', name: 'South Carolina', districts: 7 },
    { code: 'KY', name: 'Kentucky', districts: 6 },
    { code: 'LA', name: 'Louisiana', districts: 6 },
    { code: 'OR', name: 'Oregon', districts: 6 },
    { code: 'CT', name: 'Connecticut', districts: 5 },
    { code: 'OK', name: 'Oklahoma', districts: 5 },
    { code: 'AR', name: 'Arkansas', districts: 4 },
    { code: 'IA', name: 'Iowa', districts: 4 },
    { code: 'KS', name: 'Kansas', districts: 4 },
    { code: 'NV', name: 'Nevada', districts: 4 },
    { code: 'UT', name: 'Utah', districts: 4 },
    { code: 'NE', name: 'Nebraska', districts: 3 },
    { code: 'NM', name: 'New Mexico', districts: 3 },
    { code: 'HI', name: 'Hawaii', districts: 2 },
    { code: 'ID', name: 'Idaho', districts: 2 },
    { code: 'ME', name: 'Maine', districts: 2 },
    { code: 'MT', name: 'Montana', districts: 2 },
    { code: 'NH', name: 'New Hampshire', districts: 2 },
    { code: 'RI', name: 'Rhode Island', districts: 2 },
    { code: 'WV', name: 'West Virginia', districts: 2 },
    { code: 'AK', name: 'Alaska', districts: 1 },
    { code: 'DE', name: 'Delaware', districts: 1 },
    { code: 'ND', name: 'North Dakota', districts: 1 },
    { code: 'SD', name: 'South Dakota', districts: 1 },
    { code: 'VT', name: 'Vermont', districts: 1 },
    { code: 'WY', name: 'Wyoming', districts: 1 }
  ];

  constructor(
    private geodistrictService: GeodistrictAlgorithmService,
    private boundariesService: CongressionalBoundariesService,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Check if admin mode is enabled via URL hash
    if (typeof window !== 'undefined') {
      this.isAdminMode = window.location.hash === '#admin';
      
      // Listen for hash changes
      this.hashChangeHandler = () => {
        this.isAdminMode = window.location.hash === '#admin';
      };
      window.addEventListener('hashchange', this.hashChangeHandler);
    }
    
    // Check if we're on production (geodistricts.org)
    const isProduction = typeof window !== 'undefined' && 
      (window.location.hostname === 'geodistricts.org' || 
       window.location.hostname.includes('geodistricts.org'));
    
    // Load showTractBoundaries from localStorage
    // On production (geodistricts.org), default to false (unchecked)
    if (isProduction) {
      this.showTractBoundaries = false;
      // Clear any cached value on production to ensure default
      localStorage.removeItem('showTractBoundaries');
    } else {
      const saved = localStorage.getItem('showTractBoundaries');
      if (saved !== null) {
        this.showTractBoundaries = saved === 'true';
      }
    }

    // Load selected state from localStorage, default to 'ALL' for US view
    const savedState = localStorage.getItem('selectedState');
    if (savedState) {
      this.selectedState = savedState;
    } else {
      this.selectedState = 'ALL';
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializeMap();
      if (this.selectedState === 'ALL') {
        this.updateMapView();
        this.loadUSMapDistricts();
      } else {
        setTimeout(() => {
          this.updateMapView();
          this.runAlgorithm();
        }, 300);
      }
    }, 100);
  }

  ngOnDestroy(): void {
    // Stop auto-playing if active
    this.pauseSteps();

    if (this.pendingSliderUpdateTimer !== null) {
      clearTimeout(this.pendingSliderUpdateTimer);
      this.pendingSliderUpdateTimer = null;
    }

    // Remove hash change listener
    if (typeof window !== 'undefined' && this.hashChangeHandler) {
      window.removeEventListener('hashchange', this.hashChangeHandler);
    }

    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.clearDivisionLines();
    if (this.map) {
      this.map.remove();
    }
  }

  private initializeMap(): void {
    const mapElement = document.getElementById('usMap');
    if (!mapElement) {
      // If map element doesn't exist yet (e.g., view hasn't rendered), retry after a short delay
      setTimeout(() => this.initializeMap(), 100);
      return;
    }

    // If map already exists, check if it's attached to the correct DOM element
    if (this.map) {
      try {
        const container = this.map.getContainer();
        // Check if the map container is the same as the current mapElement
        // If not, or if container was removed from DOM, we need to reinitialize
        if (container && container.parentNode && container === mapElement) {
          // Map is still valid and attached to the correct element, just update the view
          console.log('🗺️ Map already initialized, updating view...');
          // Force map to invalidate size in case container dimensions changed
          setTimeout(() => {
            if (this.map) {
              this.map.invalidateSize();
            }
          }, 100);
          this.updateMapView();
          this.loadCongressionalBoundariesForState();
          return;
        } else {
          // Map container is different or was removed, need to reinitialize
          console.log('🗺️ Map container changed or removed, reinitializing...');
          this.map.remove();
          this.map = null;
          this.congressionalLayer = null;
        }
      } catch (e) {
        // Map container was removed, need to reinitialize
        console.log('🗺️ Map container error, reinitializing...', e);
        if (this.map) {
          try {
            this.map.remove();
          } catch (removeError) {
            // Ignore errors during removal
          }
        }
        this.map = null;
        this.congressionalLayer = null;
      }
    }

    // Initialize new map
    console.log('🗺️ Initializing new map...');
    this.map = L.map('usMap', {
      scrollWheelZoom: true
    }).setView([39.8283, -98.5795], 4); // Center of US

    // Log initial zoom level
    console.log(`🗺️ Map initialized - Current zoom level: ${this.map.getZoom()}`);

    // Listen for zoom and move so we can update slider track length and enforce min zoom
    this.map.on('zoomend', () => {
      if (this.map) {
        console.log(`🔍 Map zoom changed - New zoom level: ${this.map.getZoom()}`);
        this.updateSliderTrackLength();
      }
    });
    this.map.on('moveend', () => {
      this.updateSliderTrackLength();
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Congressional boundaries for selected state (below geodistricts)
    this.congressionalLayer = L.layerGroup().addTo(this.map);
    // Geodistricts and tracts draw on top
    this.tractLayer = L.layerGroup().addTo(this.map);

    // Add custom toggle control
    this.addMapToggleControl();

    // Update layers based on checkbox state
    this.updateMapLayers();
    
    // Update map view based on selected state
    this.updateMapView();
    // Load 119th Congress boundaries for selected state (base layer under geodistricts)
    this.loadCongressionalBoundariesForState();
    
    // Force map to invalidate size after a short delay to ensure container is properly sized
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
      }
    }, 200);
  }

  /**
   * Add custom toggle control to the map
   */
  private addMapToggleControl(): void {
    if (!this.map) return;

    // Store reference to component for callbacks
    const component = this;

    // Create custom control class
    const ToggleControl = L.Control.extend({
      onAdd: (map: L.Map) => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        container.style.backgroundColor = 'white';
        container.style.border = '2px solid rgba(0,0,0,0.2)';
        container.style.borderRadius = '4px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '0';

        // Tracts toggle button
        const tractsButton = L.DomUtil.create('a', 'leaflet-control-custom-button', container);
        tractsButton.href = '#';
        tractsButton.title = 'Toggle Tract Boundaries';
        tractsButton.style.width = '30px';
        tractsButton.style.height = '30px';
        tractsButton.style.display = 'flex';
        tractsButton.style.alignItems = 'center';
        tractsButton.style.justifyContent = 'center';
        tractsButton.style.textDecoration = 'none';
        tractsButton.style.color = '#333';
        tractsButton.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
        
        const tractsIcon = L.DomUtil.create('span', 'material-icons', tractsButton);
        tractsIcon.innerHTML = 'grid_on';
        tractsIcon.style.fontSize = '18px';
        tractsIcon.style.lineHeight = '1';

        // Division lines toggle button
        const divisionButton = L.DomUtil.create('a', 'leaflet-control-custom-button', container);
        divisionButton.href = '#';
        divisionButton.title = 'Toggle Division Lines';
        divisionButton.style.width = '30px';
        divisionButton.style.height = '30px';
        divisionButton.style.display = 'flex';
        divisionButton.style.alignItems = 'center';
        divisionButton.style.justifyContent = 'center';
        divisionButton.style.textDecoration = 'none';
        divisionButton.style.color = '#333';

        const divisionIcon = L.DomUtil.create('span', 'material-icons', divisionButton);
        divisionIcon.innerHTML = 'show_chart';
        divisionIcon.style.fontSize = '18px';
        divisionIcon.style.lineHeight = '1';

        // Update button states
        const updateButtonStates = () => {
          if (component.showTractBoundaries) {
            tractsButton.style.backgroundColor = '#1976d2';
            tractsButton.style.color = 'white';
          } else {
            tractsButton.style.backgroundColor = 'transparent';
            tractsButton.style.color = '#333';
          }

          if (component.showDivisionLines) {
            divisionButton.style.backgroundColor = '#1976d2';
            divisionButton.style.color = 'white';
          } else {
            divisionButton.style.backgroundColor = 'transparent';
            divisionButton.style.color = '#333';
          }
        };

        // Initial state
        updateButtonStates();

        // Prevent map click/drag when clicking buttons
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousewheel', L.DomEvent.stopPropagation);

        // Tracts button click handler
        L.DomEvent.on(tractsButton, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          component.showTractBoundaries = !component.showTractBoundaries;
          localStorage.setItem('showTractBoundaries', component.showTractBoundaries.toString());
          component.updateMapLayers();
          updateButtonStates();
        });

        // Division lines button click handler (toggles both historical division lines and sort slider lines)
        L.DomEvent.on(divisionButton, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          component.showDivisionLines = !component.showDivisionLines;
          component.renderDivisionLines();
          component.updateDivisionLineAndLabels();
          updateButtonStates();
        });

        return container;
      },

      onRemove: (map: L.Map) => {
        // Cleanup if needed
      }
    });

    // Create and add control
    this.mapToggleControl = new ToggleControl({
      position: 'topleft'
    });

    this.mapToggleControl.addTo(this.map);

    // Position the control below the zoom control
    // Wait for map to be fully initialized
    setTimeout(() => {
      const customControl = document.querySelector('.leaflet-control-custom');
      const zoomControl = document.querySelector('.leaflet-control-zoom');
      if (customControl && zoomControl) {
        const zoomControlRect = zoomControl.getBoundingClientRect();
        (customControl as HTMLElement).style.marginTop = `${zoomControlRect.height + 10}px`;
      }
    }, 100);
  }


  onStateChange(): void {
    if (this.selectedState) {
      // Persist selected state to localStorage
      localStorage.setItem('selectedState', this.selectedState);
      
      // Clear existing layers when switching states
      if (this.tractLayer) {
        this.tractLayer.clearLayers();
      }
      this.tractGeoJsonLayers.clear();
      this.tractIdToLayer.clear();
      this.clearDivisionLines();
      
      if (this.selectedState !== 'ALL') {
        // State view: reuse Leaflet map, run algorithm for selected state
        this.usMapStepDataByState = [];
        this.usMapTotalDistricts = 0;
        this.completedStateCodes = new Set();
        setTimeout(() => {
          this.initializeMap();
          setTimeout(() => {
            this.updateMapView();
            this.runAlgorithm();
          }, 300);
        }, 100);
      } else {
        // US/ALL view: reuse Leaflet map, fit continental US, show geodistrict polygons
        if (this.congressionalLayer) {
          this.congressionalLayer.clearLayers();
        }
        this.algorithmResult = null;
        this.currentStep = null;
        this.currentStepIndex = 0;
        setTimeout(() => {
          this.updateMapView();
          this.loadUSMapDistricts();
        }, 100);
      }
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

  toggleTractBoundaries(): void {
    this.showTractBoundaries = !this.showTractBoundaries;
    this.onTractBoundariesChange();
  }

  private updateMapLayers(): void {
    if (!this.map || !this.tractLayer) return;

    if (this.selectedState === 'ALL' && this.usMapStepDataByState.length > 0) {
      this.renderUSMapDistricts(this.usMapStepDataByState);
      return;
    }

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

  /** Continental US bounds (lower 48) for fitBounds when ALL is selected. */
  private static readonly CONTINENTAL_US_BOUNDS = L.latLngBounds(
    [24.5, -125] as [number, number],
    [49.5, -66] as [number, number]
  );

  private updateMapView(): void {
    if (!this.map || !this.selectedState) return;

    if (this.selectedState === 'ALL') {
      this.map.fitBounds(MapsPageComponent.CONTINENTAL_US_BOUNDS, { padding: [24, 24], maxZoom: 10 });
      return;
    }

    const stateCenter = this.getStateCenter(this.selectedState);
    this.map.setView(stateCenter, 7);
  }

  /**
   * Load 119th Congress boundaries for the selected state and add to congressional layer (below geodistricts).
   */
  private loadCongressionalBoundariesForState(): void {
    if (!this.congressionalLayer || !this.selectedState || this.selectedState === 'ALL') return;
    this.congressionalLayer.clearLayers();
    const sub = this.boundariesService.getBoundariesForState(119, this.selectedState).subscribe(geo => {
      if (!geo || !this.congressionalLayer) return;
      L.geoJSON(geo as any, {
        style: {
          color: '#e67e22',
          weight: 1.5,
          opacity: 0.9,
          fillColor: '#f5f5f5',
          fillOpacity: 0.15
        }
      }).addTo(this.congressionalLayer!);
    });
    this.subscriptions.push(sub);
  }

  /**
   * Load district data for US map view: fetch completed states and their final steps, then render.
   */
  loadUSMapDistricts(): void {
    if (this.selectedState !== 'ALL' || !this.map || !this.tractLayer) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.usMapStepDataByState = [];
    this.usMapTotalDistricts = 0;
    this.completedStateCodes = new Set();
    this.cdr.markForCheck();

    const sub = this.geodistrictService.getFinalStepStates().pipe(
      catchError(() => of({ stateCodes: [] as string[] })),
      concatMap(({ stateCodes }) => {
        this.completedStateCodes = new Set(stateCodes);
        if (stateCodes.length === 0) {
          this.isLoading = false;
          this.cdr.markForCheck();
          return of([]);
        }
        return forkJoin(
          stateCodes.map(code =>
            this.geodistrictService.getFinalStep(code).pipe(
              map(res => ({ stateCode: code, stepData: res.data } as { stateCode: string; stepData: GeodistrictStep })),
              catchError(() => of(null))
            )
          )
        ).pipe(
          map(results => results.filter((r): r is { stateCode: string; stepData: GeodistrictStep } => r !== null))
        );
      })
    ).subscribe({
      next: (data) => {
        this.usMapStepDataByState = data;
        this.usMapTotalDistricts = data.reduce((sum, { stepData }) => sum + (stepData.districtGroups?.length ?? 0), 0);
        this.renderUSMapDistricts(data);
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err?.message || 'Failed to load US map districts';
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.push(sub);
  }

  /**
   * Render district polygons for US map view (completed states only). Clicking a district switches to that state.
   */
  private renderUSMapDistricts(completedStatesData: Array<{ stateCode: string; stepData: GeodistrictStep }>): void {
    if (!this.map || !this.tractLayer) return;
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();

    let globalDistrictIndex = 0;
    const totalDistricts = 435;

    for (const { stateCode, stepData } of completedStatesData) {
      const groups = stepData.districtGroups || [];
      const stateName = this.states.find(s => s.code === stateCode)?.name || stateCode;

      for (const district of groups) {
        const unionPolygons = (district as any).unionPolygons;
        const hasUnionPolygonsArray = Array.isArray(unionPolygons) && unionPolygons.length > 0;
        const hasSingleUnionPolygon = !hasUnionPolygonsArray && district.unionPolygon?.geometry;
        const polygonsToRender = hasUnionPolygonsArray ? unionPolygons : (hasSingleUnionPolygon ? [district.unionPolygon] : []);

        if (polygonsToRender.length === 0) continue;

        const color = this.getDistrictColor(globalDistrictIndex, totalDistricts);
        const districtLabel = district.startDistrictNumber === district.endDistrictNumber
          ? `District ${district.startDistrictNumber}` : `Districts ${district.startDistrictNumber}-${district.endDistrictNumber}`;
        const popupContent = `<strong>${stateName} ${districtLabel}</strong><br>
          <strong>Population:</strong> ${(district.totalPopulation ?? 0).toLocaleString()}<br>
          <strong>Tracts:</strong> ${district.censusTracts?.length ?? 0}<br>
          <em>Click to view ${stateName}</em>`;

        for (const unionPolygon of polygonsToRender) {
          if (!unionPolygon?.geometry) continue;
          try {
            const geoJson = L.geoJSON(unionPolygon, {
              style: {
                color,
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.7,
                fillColor: color
              },
              onEachFeature: (feature, layer) => {
                layer.on('click', () => this.selectStateFromDistrict(stateCode));
              }
            }).bindPopup(popupContent);
            (geoJson as any).stateCode = stateCode;
            this.tractLayer!.addLayer(geoJson);
            this.tractGeoJsonLayers.set(geoJson, color);
          } catch (e) {
            console.warn('Error rendering US map district polygon:', e);
          }
        }
        globalDistrictIndex++;
      }
    }
  }

  /**
   * Switch to single-state view when user clicks a district on the US map.
   */
  selectStateFromDistrict(stateCode: string): void {
    this.selectedState = stateCode;
    this.onStateChange();
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

  runAllSteps(): void {
    if (!this.selectedState || this.selectedState === 'ALL') {
      if (this.selectedState === 'ALL') {
        this.errorMessage = 'Please select a specific state to run the algorithm';
      } else {
        this.errorMessage = 'Please select a state first';
      }
      return;
    }

    // Reset state
    this.isRunningAllSteps = true;
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

    console.log(`🚀 Running all steps with isolation resolution for ${this.selectedState}`);

    // Execute all steps with isolation resolution
    const subscription = this.geodistrictService.executeAllSteps(options).subscribe({
      next: (result) => {
        console.log(`✅ All steps completed: ${result.steps.length} steps`);
        
        // Store the result
        this.algorithmResult = result;
        // Store all steps - preserve array structure to maintain step index mapping
        // Steps should be indexed by step number (step 0 at index 0, step 1 at index 1, etc.)
        this.loadedSteps = result.steps;
        this.totalSteps = result.steps.length;
        
        // Display the final step
        if (result.steps.length > 0) {
          // Find the last valid step (in case array has undefined entries)
          let finalStepIndex = result.steps.length - 1;
          while (finalStepIndex >= 0 && (!result.steps[finalStepIndex] || result.steps[finalStepIndex] === undefined || result.steps[finalStepIndex] === null)) {
            finalStepIndex--;
          }
          
          if (finalStepIndex >= 0) {
            const finalStep = result.steps[finalStepIndex];
            this.currentStepIndex = finalStepIndex;
            this.currentStep = finalStep;
            this.selectedDistrictGroupIndex = null; // Clear selection when loading new step
          
          // Populate isolated tracts data from final step if available
          if (finalStep.isolatedTractsData) {
            const stepIsolatedData = finalStep.isolatedTractsData;
            this.isolatedTractIds = new Set(stepIsolatedData.isolatedTractIds || []);
            this.isolatedTractsData = {
              isolatedTractsByGroup: stepIsolatedData.isolatedTractsByGroup || {},
              isolatedTractIds: stepIsolatedData.isolatedTractIds || []
            };
          } else {
            this.isolatedTractIds.clear();
            this.isolatedTractsData = null;
          }
          
            // Render the final step
            this.renderFinalDistricts();
          } else {
            console.warn('⚠️ No valid steps found in result');
            this.errorMessage = 'No valid steps found in result';
          }
        }
        
        this.isLoading = false;
        this.isLoadingSteps = false;
        this.isRunningAllSteps = false;
      },
      error: (error) => {
        console.error('❌ Error running all steps:', error);
        this.errorMessage = error.message || 'Failed to run all steps';
        this.isLoading = false;
        this.isLoadingSteps = false;
        this.isRunningAllSteps = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  runAlgorithm(): void {
    if (!this.selectedState || this.selectedState === 'ALL') {
      if (this.selectedState === 'ALL') {
        this.errorMessage = 'Please select a specific state to run the algorithm';
      } else {
        this.errorMessage = 'Please select a state first';
      }
      return;
    }

    // Clear map layers FIRST to prevent showing wrong state's data
    if (this.tractLayer) {
      this.tractLayer.clearLayers();
    }
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.clearDivisionLines();

    // Reset state
    this.isLoading = true;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
    this.currentStep = null;
    this.totalSteps = 0;
    this.isolatedTractIds.clear();
    this.isolatedTractsData = null;
    this.bridgeTractIds.clear();
    this.bridgeTractsData = null;

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: false,
      forceInvalidate: false,
      maxIterations: 100
    };

    console.log(`🚀 Initializing algorithm for ${this.selectedState}`);

    // Initialize algorithm and load step 0 (or final step if available)
    const subscription = this.geodistrictService.initializeAlgorithm(options).subscribe({
      next: (stepData) => {
        const { step, stepIndex, isComplete } = stepData;
        
        // Validate that we're still on the same state (prevent race conditions)
        if (this.selectedState !== options.state) {
          console.warn(`⚠️ State changed during load: was loading ${options.state}, now selected ${this.selectedState}. Ignoring loaded data.`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          return;
        }
        
        // Handle null or invalid step data
        if (!step) {
          console.warn(`⚠️ Received null step data at step ${stepIndex}`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          this.errorMessage = `Failed to load step ${stepIndex}: step data is null or incomplete`;
          return;
        }
        
        console.log(`📥 Received step ${stepIndex} for ${this.selectedState}:`, step.description || 'No description');

        // Store the step
        this.loadedSteps[stepIndex] = step;

        // Display the loaded step (could be step 0 or final step)
        this.currentStepIndex = stepIndex;
        this.currentStep = step;
        this.selectedDistrictGroupIndex = null; // Clear selection when loading new step
        
        // If this is the final step, load all previous steps to show all division lines
        if (isComplete) {
          this.totalSteps = stepIndex + 1;
          this.isLoadingSteps = false;
          console.log(`✅ Loaded final step ${stepIndex} for ${this.selectedState}`);
          
          // Load all previous steps to get their division lines
          this.loadAllPreviousSteps(stepIndex);
        }
        
        // Populate isolated tracts data from step cache if available
        if (step.isolatedTractsData) {
          const stepIsolatedData = step.isolatedTractsData;
          this.isolatedTractIds = new Set(stepIsolatedData.isolatedTractIds || []);
          this.isolatedTractsData = {
            isolatedTractsByGroup: stepIsolatedData.isolatedTractsByGroup || {},
            isolatedTractIds: stepIsolatedData.isolatedTractIds || []
          };
          console.log(`📥 Loaded isolated tracts data from step 0 cache: ${stepIsolatedData.totalIsolated || 0} isolated tracts`);
        } else {
          this.isolatedTractIds.clear();
          this.isolatedTractsData = null;
        }
        
        // Validate step has districtGroups
        if (!step.districtGroups || !Array.isArray(step.districtGroups) || step.districtGroups.length === 0) {
          console.warn(`⚠️ Step ${stepIndex} has no districtGroups, cannot render`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          this.errorMessage = `Step ${stepIndex} data is incomplete: missing district groups`;
          return;
        }
        
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

        const stepLabel = isComplete ? `final step ${stepIndex}` : `step ${stepIndex}`;
        console.log(`✅ ${stepLabel} loaded: ${step.districtGroups[0]?.censusTracts?.length || 0} tracts`);
        console.log(`🔍 ${stepLabel} districtGroups:`, step.districtGroups);
        console.log(`🔍 First district group tracts:`, step.districtGroups[0]?.censusTracts?.slice(0, 3));
        
        // Render the step on map - wait a bit longer to ensure map is ready
        setTimeout(() => {
          console.log(`🖼️ About to render ${stepLabel}, map initialized: ${!!this.map}, tractLayer initialized: ${!!this.tractLayer}`);
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
    return this.totalSteps || this.loadedSteps.filter(s => s !== undefined && s !== null).length || 0;
  }

  /**
   * Reset to step 0 by clearing cache and reloading the map
   */
  resetToStart(): void {
    if (!this.selectedState || this.selectedState === 'ALL') {
      this.errorMessage = 'Please select a state first';
      return;
    }

    console.log(`🔄 Resetting to step 0 for ${this.selectedState} (clearing cache)...`);

    // Clear map layers
    if (this.tractLayer) {
      this.tractLayer.clearLayers();
    }
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.clearDivisionLines();

    // Reset state
    this.isLoading = true;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
    this.currentStep = null;
    this.totalSteps = 0;
    this.isolatedTractIds.clear();
    this.isolatedTractsData = null;
    this.bridgeTractIds.clear();
    this.bridgeTractsData = null;
    this.selectedDistrictGroupIndex = null; // Clear selection
    this.hasShownSorting = false; // Reset sorting visualization state
    this.isSortingVisualization = false; // Reset sorting visualization state
    this.sortSliderValue = 0;
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();

    // Directly call the step-by-step endpoint to get step 0, bypassing final step check
    // This ensures we always get step 0, not the final step
    const backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';
    const executeUrl = `${backendUrl}/api/algorithm/execute/step-by-step`;

    console.log(`🚀 Reloading algorithm from step 0 with cache cleared for ${this.selectedState}`);

    // Call step-by-step endpoint directly with forceInvalidate to get step 0
    const subscription = this.http.post<{
      step: number;
      data: GeodistrictStep;
      isComplete: boolean;
    }>(executeUrl, {
      state: this.selectedState,
      maxIterations: 100,
      options: {
        forceInvalidate: true // Clear cache
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (response) => {
        // Backend returns { step: number, data: GeodistrictStep, isComplete: boolean }
        const stepIndex = response.step;
        const step = response.data;
        const isComplete = response.isComplete || false;
        
        // Handle null or invalid step data
        if (!step) {
          console.warn(`⚠️ Received null step data at step ${stepIndex}`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          this.errorMessage = `Failed to load step ${stepIndex}: step data is null or incomplete`;
          return;
        }
        
        // Ensure we got step 0 (not final step)
        if (stepIndex !== 0) {
          console.warn(`⚠️ Expected step 0 but got step ${stepIndex}. This should not happen when resetting to start.`);
        }
        
        console.log(`📥 Received step ${stepIndex} for ${this.selectedState}:`, step.description || 'No description');

        // Store the step
        this.loadedSteps[stepIndex] = step;

        // Display the loaded step (should be step 0)
        this.currentStepIndex = stepIndex;
        this.currentStep = step;
        
        // If this is the final step, load all previous steps to show all division lines
        if (isComplete) {
          this.totalSteps = stepIndex + 1;
          this.isLoadingSteps = false;
          console.log(`✅ Loaded final step ${stepIndex} for ${this.selectedState}`);
          
          // Load all previous steps to get their division lines
          this.loadAllPreviousSteps(stepIndex);
        } else {
          // For step 0, we're not complete yet
          this.isLoadingSteps = false;
        }
        
        // Populate isolated tracts data from step cache if available
        if (step.isolatedTractsData) {
          const stepIsolatedData = step.isolatedTractsData;
          this.isolatedTractIds = new Set(stepIsolatedData.isolatedTractIds || []);
          this.isolatedTractsData = {
            isolatedTractsByGroup: stepIsolatedData.isolatedTractsByGroup || {},
            isolatedTractIds: stepIsolatedData.isolatedTractIds || []
          };
          console.log(`📥 Loaded isolated tracts data from step 0 cache: ${stepIsolatedData.totalIsolated || 0} isolated tracts`);
        } else {
          this.isolatedTractIds.clear();
          this.isolatedTractsData = null;
        }
        
        // Validate step has districtGroups
        if (!step.districtGroups || !Array.isArray(step.districtGroups) || step.districtGroups.length === 0) {
          console.warn(`⚠️ Step ${stepIndex} has no districtGroups, cannot render`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          this.errorMessage = `Step ${stepIndex} data is incomplete: missing district groups`;
          return;
        }
        
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

        const stepLabel = isComplete ? `final step ${stepIndex}` : `step ${stepIndex}`;
        console.log(`✅ ${stepLabel} loaded: ${step.districtGroups[0]?.censusTracts?.length || 0} tracts`);
        
        // Render the step on map - wait a bit longer to ensure map is ready
        setTimeout(() => {
          console.log(`🖼️ About to render ${stepLabel}, map initialized: ${!!this.map}, tractLayer initialized: ${!!this.tractLayer}`);
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
        this.errorMessage = error.message || 'An error occurred while resetting to step 0';
        this.isLoading = false;
        this.isLoadingSteps = false;
        console.error('Reset to start error:', error);
      }
    });

    this.subscriptions.push(subscription);
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
      const prevIndex = this.currentStepIndex - 1;
      // Ensure we check the array properly - handle both dense and sparse arrays
      const step = this.loadedSteps[prevIndex];
      
      if (step && step !== undefined && step !== null) {
        // Step already loaded, just display it
        this.currentStepIndex = prevIndex;
        this.currentStep = step;
        this.isolatedTractIds.clear(); // Clear isolation highlights when changing steps
        this.isolatedTractsData = null;
        this.bridgeTractIds.clear();
        this.bridgeTractsData = null;
        this.selectedDistrictGroupIndex = null; // Clear selection when changing steps
        this.sortSliderValue = 0;
        this.sortSliderValueByDgIndex = {};
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();
        this.renderFinalDistricts(); // Re-render map for the new step
      } else {
        // Step not loaded yet, request it from backend
        console.log(`🚀 Requesting step ${prevIndex} from backend...`);
        this.isLoading = true;
        
        const options: GeodistrictOptions = {
          state: this.selectedState,
          useDirectAPI: false,
          forceInvalidate: false,
          maxIterations: 100,
        };

        const subscription = this.geodistrictService.getStep(this.selectedState, prevIndex, 100).subscribe({
          next: (stepData) => {
            const { step: newStep, stepIndex, isComplete } = stepData;
            
            if (!newStep) {
              console.warn(`⚠️ Received null step data at step ${stepIndex}`);
              this.isLoading = false;
              return;
            }
            
            console.log(`📥 Received step ${stepIndex}:`, (newStep as any).description);
            
            // Store the step
            this.loadedSteps[stepIndex] = newStep as any;
            
            // Display the step
            this.currentStepIndex = stepIndex;
            this.currentStep = newStep as any;
            this.selectedDistrictGroupIndex = null; // Clear selection when loading new step
            
            // Populate isolated tracts data from step cache if available
            if ((newStep as any).isolatedTractsData) {
              const stepIsolatedData = (newStep as any).isolatedTractsData;
              this.isolatedTractIds = new Set(stepIsolatedData.isolatedTractIds || []);
              this.isolatedTractsData = {
                isolatedTractsByGroup: stepIsolatedData.isolatedTractsByGroup || {},
                isolatedTractIds: stepIsolatedData.isolatedTractIds || []
              };
              console.log(`📥 Loaded isolated tracts data from step cache: ${stepIsolatedData.totalIsolated || 0} isolated tracts in ${stepIsolatedData.groupsWithIsolation || 0} groups`);
            } else {
              this.isolatedTractIds.clear();
              this.isolatedTractsData = null;
            }
            
            this.bridgeTractIds.clear();
            this.bridgeTractsData = null;
            this.isLoading = false;

            // Update algorithmResult
            if (this.algorithmResult) {
              this.algorithmResult.steps = this.loadedSteps.filter(s => s !== undefined);
              this.algorithmResult.finalDistricts = (newStep as any).districtGroups;
            }

            // Render the step on map
            setTimeout(() => {
              this.renderFinalDistricts();
            }, 100);
          },
          error: (error) => {
            this.errorMessage = error.message || `Failed to load step ${prevIndex}`;
            this.isLoading = false;
            console.error(`Previous step ${prevIndex} load error:`, error);
          }
        });

        this.subscriptions.push(subscription);
      }
    }
  }

  /**
   * Load all previous steps to get their division lines
   * Used when final step is loaded to show all division lines
   */
  private loadAllPreviousSteps(finalStepIndex: number): void {
    if (finalStepIndex <= 0) {
      // No previous steps to load
      return;
    }

    console.log(`📥 Loading all previous steps (0 to ${finalStepIndex - 1}) to show all division lines...`);
    
    // Load all steps from 0 to finalStepIndex - 1
    const loadPromises: Promise<void>[] = [];
    
    for (let stepIdx = 0; stepIdx < finalStepIndex; stepIdx++) {
      // Skip if step is already loaded
      if (this.loadedSteps[stepIdx]) {
        continue;
      }

      const loadPromise = new Promise<void>((resolve, reject) => {
        const subscription = this.geodistrictService.getStep(this.selectedState, stepIdx, 100).subscribe({
          next: (stepData) => {
            const { step: newStep, stepIndex } = stepData;
            
            if (!newStep) {
              console.warn(`⚠️ Received null step data for step ${stepIndex}`);
              resolve(); // Continue loading other steps even if one fails
              return;
            }
            
            console.log(`📥 Loaded step ${stepIndex} for division lines: ${(newStep as any).description || 'No description'}`);
            
            // Store the step (but don't change currentStep or currentStepIndex)
            this.loadedSteps[stepIndex] = newStep as any;
            
            resolve();
          },
          error: (error) => {
            console.warn(`⚠️ Failed to load step ${stepIdx} for division lines: ${error.message}`);
            resolve(); // Continue loading other steps even if one fails
          }
        });
        
        this.subscriptions.push(subscription);
      });
      
      loadPromises.push(loadPromise);
    }

    // After all steps are loaded, re-render division lines
    Promise.all(loadPromises).then(() => {
      console.log(`✅ Finished loading all previous steps. Re-rendering division lines...`);
      // Re-render division lines to show all steps
      setTimeout(() => {
        this.renderDivisionLines();
      }, 100);
    }).catch((error) => {
      console.error(`❌ Error loading previous steps:`, error);
    });
  }

  nextStep(): void {
    // Special handling for step 0 -> check if we need to show sorting first
    if (this.currentStepIndex === 0 && this.isAdminMode && !this.hasShownSorting) {
      this.showSortingVisualization();
      return;
    }

    const nextIndex = this.currentStepIndex + 1;
    const step = this.loadedSteps[nextIndex];
    
    if (step) {
      // Step already loaded, just display it
      this.currentStepIndex = nextIndex;
      this.currentStep = step;
      this.selectedDistrictGroupIndex = null; // Clear selection when changing steps
      this.sortSliderValue = 0;
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();
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
          
          // Handle case where algorithm completes and newStep is null
          if (isComplete && !newStep) {
            console.log(`✅ Algorithm completed at step ${stepIndex}, no new step data`);
            // Use the last step if available, or show completion message
            if (this.currentStep) {
              console.log(`📥 Using current step as final step`);
              this.isLoading = false; // Stop loading spinner
              this.isLoadingSteps = false;
              this.totalSteps = this.loadedSteps.filter(s => s !== undefined).length;
              return; // Keep current step displayed
            } else {
              console.warn(`⚠️ Algorithm completed but no step data available`);
              this.isLoading = false; // Stop loading spinner
              this.isLoadingSteps = false;
              return;
            }
          }
          
          // When algorithm is complete, newStep is a result object with finalDistricts, not a step object
          // Convert it to a step-like object for consistency
          let stepToUse = newStep;
          if (isComplete && newStep && (newStep as any).finalDistricts) {
            const result = newStep as any;
            stepToUse = {
              step: stepIndex,
              level: stepIndex,
              description: `Final step: ${result.finalDistricts.length} districts`,
              totalGroups: result.finalDistricts.length,
              totalDistricts: result.finalDistricts.length,
              divisionDirection: undefined,
              divisionLine: undefined,
              divisionLines: [],
              districtGroups: result.finalDistricts // Use finalDistricts as districtGroups for consistency
            } as any;
            console.log(`📥 Received final step ${stepIndex}: ${result.finalDistricts.length} districts`);
          } else if (newStep) {
            console.log(`📥 Received step ${stepIndex}:`, (newStep as any).description);
          } else {
            console.warn(`⚠️ Received null step data at step ${stepIndex}`);
            this.isLoading = false; // Stop loading spinner even if step data is null
            this.isLoadingSteps = false;
            return;
          }

          // Store the step
          this.loadedSteps[stepIndex] = stepToUse as any;
          
          // Display the step
          this.currentStepIndex = stepIndex;
          this.currentStep = stepToUse as any;
          this.selectedDistrictGroupIndex = null; // Clear selection when loading new step
          
          // Populate isolated tracts data from step cache if available
          if ((stepToUse as any).isolatedTractsData) {
            const stepIsolatedData = (stepToUse as any).isolatedTractsData;
            this.isolatedTractIds = new Set(stepIsolatedData.isolatedTractIds || []);
            this.isolatedTractsData = {
              isolatedTractsByGroup: stepIsolatedData.isolatedTractsByGroup || {},
              isolatedTractIds: stepIsolatedData.isolatedTractIds || []
            };
            console.log(`📥 Loaded isolated tracts data from step cache: ${stepIsolatedData.totalIsolated || 0} isolated tracts in ${stepIsolatedData.groupsWithIsolation || 0} groups`);
          } else {
            this.isolatedTractIds.clear(); // Clear isolation highlights when changing steps
            this.isolatedTractsData = null;
          }
          
          this.bridgeTractIds.clear();
          this.bridgeTractsData = null;
          this.isLoading = false;

          // Update algorithmResult
          if (this.algorithmResult) {
            this.algorithmResult.steps = this.loadedSteps.filter(s => s !== undefined);
            this.algorithmResult.finalDistricts = (stepToUse as any).districtGroups;
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

  goToFirstStep(): void {
    if (this.currentStepIndex === 0) {
      return; // Already at first step
    }
    // Go to step 0
    const step = this.loadedSteps[0];
    if (step) {
      this.currentStepIndex = 0;
      this.currentStep = step;
      this.selectedDistrictGroupIndex = null;
      this.isolatedTractIds.clear();
      this.isolatedTractsData = null;
      this.bridgeTractIds.clear();
      this.bridgeTractsData = null;
      this.renderFinalDistricts();
    } else {
      // Step 0 not loaded, reset to start
      this.resetToStart();
    }
  }

  goToLastStep(): void {
    const lastIndex = this.getTotalSteps() - 1;
    if (lastIndex <= 0 || this.currentStepIndex === lastIndex) {
      return; // Already at last step or no steps available
    }
    
    const step = this.loadedSteps[lastIndex];
    if (step) {
      this.currentStepIndex = lastIndex;
      this.currentStep = step;
      this.selectedDistrictGroupIndex = null;
      this.isolatedTractIds.clear();
      this.isolatedTractsData = null;
      this.bridgeTractIds.clear();
      this.bridgeTractsData = null;
      this.renderFinalDistricts();
    } else {
      // Last step not loaded, need to load it
      // This would require loading all steps up to the last one
      console.log('Last step not loaded yet. Loading steps...');
      // For now, just go to the highest loaded step
      let highestIndex = 0;
      for (let i = this.loadedSteps.length - 1; i >= 0; i--) {
        if (this.loadedSteps[i]) {
          highestIndex = i;
          break;
        }
      }
      if (highestIndex > this.currentStepIndex) {
        const step = this.loadedSteps[highestIndex];
        if (step) {
          this.currentStepIndex = highestIndex;
          this.currentStep = step;
          this.selectedDistrictGroupIndex = null;
          this.renderFinalDistricts();
        }
      }
    }
  }

  playSteps(): void {
    if (this.isPlaying) {
      this.pauseSteps();
      return;
    }

    this.isPlaying = true;
    const playDelay = 2000; // 2 seconds between steps

    this.playInterval = setInterval(() => {
      if (!this.canGoToNextStep()) {
        this.pauseSteps();
        return;
      }
      this.nextStep();
    }, playDelay);
  }

  pauseSteps(): void {
    this.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  canGoToFirstStep(): boolean {
    return this.currentStepIndex > 0;
  }

  canGoToPreviousStep(): boolean {
    return this.currentStepIndex > 0;
  }

  canGoToLastStep(): boolean {
    const total = this.getTotalSteps();
    return total > 0 && this.currentStepIndex < total - 1;
  }

  private showSortingVisualization(): void {
    if (!this.currentStep || !this.currentStep.districtGroups || this.currentStep.districtGroups.length === 0) {
      return;
    }

    console.log(`🔄 Showing sorting visualization for step 0`);
    this.isSortingVisualization = true;
    this.hasShownSorting = true;

    const districtGroup = this.currentStep.districtGroups[0];
    const originalTracts = districtGroup.censusTracts || [];

    if (originalTracts.length === 0) {
      return;
    }

    // Sort tracts by latitude (north to south) then longitude (west to east)
    const sortedTracts = [...originalTracts].sort((a, b) => {
      // Get centroids for comparison
      const centroidA = this.getTractCentroid(a);
      const centroidB = this.getTractCentroid(b);

      if (!centroidA || !centroidB) return 0;

      // Sort by latitude (north to south), then by longitude (west to east)
      if (Math.abs(centroidA.lat - centroidB.lat) > 0.0001) {
        return centroidB.lat - centroidA.lat; // North first
      } else {
        return centroidA.lng - centroidB.lng; // West first
      }
    });

    console.log(`📊 Sorted ${sortedTracts.length} tracts by lat/lng for visualization`);

    // Update the district group with sorted tracts for visualization
    districtGroup.censusTracts = sortedTracts;

    // Re-render to show sorted tracts; slider will control highlight
    this.sortSliderValue = 0;
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();
    this.renderFinalDistricts();
  }

  private getTractCentroid(tract: any): {lat: number, lng: number} | null {
    if (!tract || !tract.geometry) return null;

    // Calculate centroid of the tract geometry
    let totalLat = 0;
    let totalLng = 0;
    let pointCount = 0;

    const processCoordinates = (coords: any) => {
      if (Array.isArray(coords)) {
        if (typeof coords[0] === 'number') {
          // [lng, lat] point
          totalLng += coords[0];
          totalLat += coords[1];
          pointCount++;
        } else {
          // Array of coordinates
          coords.forEach(processCoordinates);
        }
      }
    };

    processCoordinates(tract.geometry.coordinates);

    if (pointCount === 0) return null;

    return {
      lat: totalLat / pointCount,
      lng: totalLng / pointCount
    };
  }

  /** Bounds for sort order (matches backend: southernmost lat, easternmost lng). Uses properties when set, else geometry. */
  private getTractBoundsForSort(tract: any): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
    if (!tract) return null;
    const p = tract.properties;
    if (typeof p?.MIN_LAT === 'number' && typeof p?.MAX_LAT === 'number' && typeof p?.MIN_LNG === 'number' && typeof p?.MAX_LNG === 'number') {
      return { minLat: p.MIN_LAT, maxLat: p.MAX_LAT, minLng: p.MIN_LNG, maxLng: p.MAX_LNG };
    }
    if (!tract.geometry) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const processCoords = (coords: any) => {
      if (Array.isArray(coords)) {
        if (typeof coords[0] === 'number') {
          const lng = coords[0], lat = coords[1];
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        } else {
          coords.forEach(processCoords);
        }
      }
    };
    processCoords(tract.geometry.coordinates);
    if (minLat > maxLat || minLng > maxLng) return null;
    return { minLat, maxLat, minLng, maxLng };
  }

  /** Division direction for current step (used for slider orientation and sort order). Step 0–1 = latitude (horizontal line); step 2+ alternates so E/W splits draw vertical (N-S) lines. */
  get sortDirection(): 'latitude' | 'longitude' {
    if (!this.currentStep) return 'latitude';
    if (this.currentStep.divisionDirection) return this.currentStep.divisionDirection;
    // Fallback: step 0 and 1 = latitude (algorithm first division is lat), step 2 = longitude, then alternate
    return this.currentStepIndex <= 1 ? 'latitude' : (this.currentStepIndex % 2 === 0 ? 'longitude' : 'latitude');
  }

  /** Bounds of a district group from its tracts (min/max lat/lng). */
  private getDistrictGroupBounds(dgIndex: number): L.LatLngBounds | null {
    if (!this.currentStep?.districtGroups?.[dgIndex]?.censusTracts?.length) return null;
    const tracts = this.currentStep.districtGroups[dgIndex].censusTracts;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const tract of tracts) {
      const b = this.getTractBoundsForSort(tract);
      if (!b) continue;
      minLat = Math.min(minLat, b.minLat);
      maxLat = Math.max(maxLat, b.maxLat);
      minLng = Math.min(minLng, b.minLng);
      maxLng = Math.max(maxLng, b.maxLng);
    }
    if (minLat > maxLat || minLng > maxLng) return null;
    return L.latLngBounds(L.latLng(minLat, minLng), L.latLng(maxLat, maxLng));
  }

  /** Sorted tracts for the active DG (step 0 single group, or selected DG). Uses same coordinates as algorithm: latitude = southernmost point (minLat) north-first; longitude = easternmost point (maxLng) west-first. */
  get sortedTractsForSlider(): GeoJsonFeature[] {
    if (!this.currentStep?.districtGroups?.length) return [];
    const dgIndex = this.currentStepIndex === 0
      ? 0
      : this.selectedDistrictGroupIndex ?? -1;
    if (dgIndex < 0 || dgIndex >= this.currentStep.districtGroups.length) return [];
    const group = this.currentStep.districtGroups[dgIndex];
    const tracts = group?.censusTracts || [];
    if (tracts.length === 0) return [];
    const dir = this.sortDirection;
    return [...tracts].sort((a, b) => {
      const ba = this.getTractBoundsForSort(a);
      const bb = this.getTractBoundsForSort(b);
      if (!ba || !bb) return 0;
      if (dir === 'latitude') {
        // North first by southernmost point (minLat descending), tie-break west first (minLng)
        if (Math.abs(ba.minLat - bb.minLat) > 0.0001) return bb.minLat - ba.minLat;
        return ba.minLng - bb.minLng;
      } else {
        // West first by easternmost point (maxLng ascending), tie-break north first (maxLat)
        if (Math.abs(ba.maxLng - bb.maxLng) > 0.0001) return ba.maxLng - bb.maxLng;
        return bb.maxLat - ba.maxLat;
      }
    });
  }

  /** Whether the sort-order division line(s) should be shown. When tract boundaries on: step 0, or a DG selected, or step has multiple DGs (one line per DG). */
  get showSortSlider(): boolean {
    if (!this.showTractBoundaries || !this.currentStep?.districtGroups?.length) return false;
    if (this.currentStepIndex === 0) {
      return (this.currentStep.districtGroups[0]?.censusTracts?.length ?? 0) > 0;
    }
    if (this.currentStep.districtGroups.length > 1) {
      return this.currentStep.districtGroups.some(g => (g?.censusTracts?.length ?? 0) > 0);
    }
    const dgIndex = this.selectedDistrictGroupIndex ?? -1;
    if (dgIndex < 0 || dgIndex >= this.currentStep.districtGroups.length) return false;
    return (this.currentStep.districtGroups[dgIndex]?.censusTracts?.length ?? 0) > 0;
  }

  /** Cache key for sorted tract IDs (invalidates when step or DG changes). */
  private getSortedTractIdsCacheKey(): string {
    const dgIndex = this.currentStepIndex === 0 ? 0 : this.selectedDistrictGroupIndex ?? -1;
    const len = this.currentStep?.districtGroups?.[dgIndex]?.censusTracts?.length ?? 0;
    return `${this.currentStepIndex}-${dgIndex}-${len}`;
  }

  /** Build or return cached sorted tract ID array (sort done once per step/DG; no per-event sort). */
  private getOrBuildSortedTractIds(): string[] {
    const key = this.getSortedTractIdsCacheKey();
    if (this.cachedSortedTractIds.length > 0 && this.cachedSortedTractIdsKey === key) {
      return this.cachedSortedTractIds;
    }
    const sorted = this.sortedTractsForSlider;
    const ids: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const id = this.getTractId(sorted[i]);
      if (id) ids.push(id);
    }
    this.cachedSortedTractIds = ids;
    this.cachedSortedTractIdsKey = key;
    return ids;
  }

  /** Build cached sorted tract entries with bounds + population and north prefix sum (same key as sorted IDs). */
  private getOrBuildSortedTractEntries(): Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }> {
    const key = this.getSortedTractIdsCacheKey();
    if (this.cachedSortedTractEntries.length > 0 && this.cachedSortedTractIdsKey === key) {
      return this.cachedSortedTractEntries;
    }
    const sorted = this.sortedTractsForSlider;
    const entries: Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }> = [];
    let sum = 0;
    this.cachedNorthPrefixSum = [0];
    for (let i = 0; i < sorted.length; i++) {
      const tract = sorted[i];
      const b = this.getTractBoundsForSort(tract);
      const tractId = this.getTractId(tract) ?? '';
      const population = tract.properties?.POPULATION ?? 0;
      if (!b) continue;
      entries.push({
        tractId,
        minLat: b.minLat,
        maxLat: b.maxLat,
        minLng: b.minLng,
        maxLng: b.maxLng,
        population
      });
      sum += population;
      this.cachedNorthPrefixSum.push(sum);
    }
    this.cachedSortedTractEntries = entries;
    this.cachedTotalPopulation = sum;
    return entries;
  }

  /** Split index (0..N) from current slider value. */
  private getSplitIndexFromSliderValue(): number {
    const ids = this.getOrBuildSortedTractIds();
    const N = ids.length;
    if (N === 0) return 0;
    const v = this.sortSliderValue;
    const M = this.sliderMax;
    return Math.min(N, Math.max(0, Math.floor(v * N / M)));
  }

  /** Split index that gives ~50% population on each side (midpoint for initial division line). */
  private getMidpointSplitIndex(): number {
    const entries = this.getOrBuildSortedTractEntries();
    const N = entries.length;
    if (N === 0) return 0;
    const half = this.cachedTotalPopulation / 2;
    for (let i = 0; i <= N; i++) {
      if ((this.cachedNorthPrefixSum[i] ?? 0) >= half) return i;
    }
    return N;
  }

  /** Line position (lat for latitude split, lng for longitude) from split index. */
  private getDivisionLinePositionFromSplitIndex(splitIndex: number): number | null {
    const entries = this.getOrBuildSortedTractEntries();
    const N = entries.length;
    if (N === 0) return null;
    const isLat = this.sortDirection === 'latitude';
    if (splitIndex <= 0) {
      return isLat ? entries[0].maxLat + 0.001 : entries[0].minLng - 0.001;
    }
    if (splitIndex >= N) {
      return isLat ? entries[N - 1].minLat - 0.001 : entries[N - 1].maxLng + 0.001;
    }
    if (isLat) {
      return (entries[splitIndex - 1].minLat + entries[splitIndex].maxLat) / 2;
    }
    return (entries[splitIndex - 1].maxLng + entries[splitIndex].minLng) / 2;
  }

  /** Split index from line position (binary search). North = tracts with minLat > lineLat; West = tracts with maxLng < lineLng. */
  private getSplitIndexFromDivisionLinePosition(lineValue: number): number {
    const entries = this.getOrBuildSortedTractEntries();
    const N = entries.length;
    if (N === 0) return 0;
    const isLat = this.sortDirection === 'latitude';
    if (isLat) {
      let lo = 0;
      let hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (entries[mid].minLat > lineValue) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    } else {
      let lo = 0;
      let hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (entries[mid].maxLng < lineValue) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
  }

  /** Population on north/west side (indices 0..splitIndex-1) and south/east side. */
  private getPopulationsForSplitIndex(splitIndex: number): { first: number; second: number } {
    const first = this.cachedNorthPrefixSum[splitIndex] ?? 0;
    const second = this.cachedTotalPopulation - first;
    return { first, second };
  }

  /** Build and cache sorted tract entries for a given DG (for multi-DG division lines). */
  private getOrBuildSortedTractEntriesForDg(dgIndex: number): { entries: Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }>; prefixSum: number[]; total: number } | null {
    if (!this.currentStep?.districtGroups?.[dgIndex]?.censusTracts?.length) return null;
    const cached = this.cachedSortedTractEntriesByDg.get(dgIndex);
    if (cached) return cached;
    const tracts = this.currentStep.districtGroups[dgIndex].censusTracts;
    const dir = this.sortDirection;
    const sorted = [...tracts].sort((a, b) => {
      const ba = this.getTractBoundsForSort(a);
      const bb = this.getTractBoundsForSort(b);
      if (!ba || !bb) return 0;
      if (dir === 'latitude') {
        if (Math.abs(ba.minLat - bb.minLat) > 0.0001) return bb.minLat - ba.minLat;
        return ba.minLng - bb.minLng;
      } else {
        if (Math.abs(ba.maxLng - bb.maxLng) > 0.0001) return ba.maxLng - bb.maxLng;
        return bb.maxLat - ba.maxLat;
      }
    });
    const entries: Array<{ tractId: string; minLat: number; maxLat: number; minLng: number; maxLng: number; population: number }> = [];
    let sum = 0;
    const prefixSum = [0];
    for (let i = 0; i < sorted.length; i++) {
      const tract = sorted[i];
      const b = this.getTractBoundsForSort(tract);
      const tractId = this.getTractId(tract) ?? '';
      const population = tract.properties?.POPULATION ?? 0;
      if (!b) continue;
      entries.push({ tractId, minLat: b.minLat, maxLat: b.maxLat, minLng: b.minLng, maxLng: b.maxLng, population });
      sum += population;
      prefixSum.push(sum);
    }
    const result = { entries, prefixSum, total: sum };
    this.cachedSortedTractEntriesByDg.set(dgIndex, result);
    return result;
  }

  private getSplitIndexFromLineValueForEntries(entries: Array<{ minLat: number; maxLng: number }>, lineValue: number, isLat: boolean): number {
    const N = entries.length;
    if (N === 0) return 0;
    if (isLat) {
      let lo = 0, hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (entries[mid].minLat > lineValue) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    } else {
      let lo = 0, hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (entries[mid].maxLng < lineValue) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
  }

  /**
   * Map slider position to tract ID set: only the tract(s) at the current position (per 260205-tractslider: highlight only tract(s) at slider position, not range from start).
   * v=0 → none; v>0 → single tract at index floor(v*N/M) so at most one tract is highlighted for fast setStyle.
   */
  private tractIdsAtPosition(sortedIds: string[], v: number): Set<string> {
    const set = new Set<string>();
    const N = sortedIds.length;
    if (N === 0 || v <= 0) return set;
    const M = this.sliderMax;
    const index = Math.min(N - 1, Math.floor(v * N / M));
    set.add(sortedIds[index]);
    return set;
  }

  /** Tract IDs at current slider position (uses cache; no sort in hot path). */
  getTractIdsAtSliderPosition(): Set<string> {
    const ids = this.getOrBuildSortedTractIds();
    return this.tractIdsAtPosition(ids, this.sortSliderValue);
  }

  /** Value to bind to the range input: for latitude (vertical) invert so 0 = north/top; for longitude 0 = west/left. */
  getSliderDisplayValue(): number {
    if (this.sortDirection === 'latitude') return this.sliderMax - this.sortSliderValue;
    return this.sortSliderValue;
  }

  /** Count of tracts at current slider position (for display). Always 0 or 1 when highlighting only at position. */
  getSliderHighlightCount(): number {
    const ids = this.getOrBuildSortedTractIds();
    return this.tractIdsAtPosition(ids, this.sortSliderValue).size;
  }

  /** Cached tract count for slider (avoids sortedTractsForSlider getter on every change detection). */
  get sortedTractCountForSlider(): number {
    return this.getOrBuildSortedTractIds().length;
  }

  /**
   * Update slider track length in pixels to match state bounds extent on the map (so slider aligns with state regardless of zoom).
   * Vertical (latitude): track length = state height in px. Horizontal (longitude): track length = state width in px.
   */
  private updateSliderTrackLength(): void {
    if (!this.map || !this.stateBoundsForSlider?.isValid()) {
      this.sliderTrackLengthPx = null;
      this.cdr.markForCheck();
      return;
    }
    const ne = this.map.latLngToContainerPoint(this.stateBoundsForSlider.getNorthEast());
    const sw = this.map.latLngToContainerPoint(this.stateBoundsForSlider.getSouthWest());
    const isLat = this.sortDirection === 'latitude';
    const lengthPx = isLat ? Math.round(sw.y - ne.y) : Math.round(ne.x - sw.x);
    const minLength = 80;
    this.sliderTrackLengthPx = Math.max(minLength, lengthPx);
    this.cdr.markForCheck();
  }

  /**
   * Clear all slider highlights and the position line. Called at start of slide handler so previous highlight is removed before applying new one.
   */
  private clearSliderHighlight(): void {
    const normalWeight = this.showTractBoundaries ? 0.5 : 0.3;
    const normalColor = this.showTractBoundaries ? '#000000' : undefined;
    this.lastSliderHighlightedTractIds.forEach(tractId => {
      const layer = this.tractIdToLayer.get(tractId) as L.GeoJSON | undefined;
      if (!layer) return;
      const tractColor = this.tractGeoJsonLayers.get(layer) ?? '#888';
      (layer as any).setStyle({
        weight: normalWeight,
        color: normalColor ?? tractColor,
        opacity: this.showTractBoundaries ? 0.8 : 0.2,
        fillOpacity: 0.7,
        fillColor: tractColor
      });
    });
    this.lastSliderHighlightedTractIds = new Set();
    this.removeDivisionLineControls();
  }

  /**
   * Update only the border style (class-like) on tract layers for the current slider position.
   * Uses cached sorted tract IDs (position → IDs only; no tract calculation).
   */
  private updateSliderHighlightOnLayers(): void {
    if (!this.showTractBoundaries || this.tractIdToLayer.size === 0) return;
    const sortedIds = this.getOrBuildSortedTractIds();
    const newIds = this.tractIdsAtPosition(sortedIds, this.sortSliderValue);
    const toUnhighlight = new Set(this.lastSliderHighlightedTractIds);
    newIds.forEach(id => toUnhighlight.delete(id));
    const toHighlight = new Set(newIds);
    this.lastSliderHighlightedTractIds.forEach(id => toHighlight.delete(id));

    const normalWeight = this.showTractBoundaries ? 0.5 : 0.3;
    const normalColor = this.showTractBoundaries ? '#000000' : undefined;
    toUnhighlight.forEach(tractId => {
      const layer = this.tractIdToLayer.get(tractId) as L.GeoJSON | undefined;
      if (!layer) return;
      const tractColor = this.tractGeoJsonLayers.get(layer) ?? '#888';
      (layer as any).setStyle({
        weight: normalWeight,
        color: normalColor ?? tractColor,
        opacity: this.showTractBoundaries ? 0.8 : 0.2,
        fillOpacity: 0.7,
        fillColor: tractColor
      });
    });

    toHighlight.forEach(tractId => {
      const layer = this.tractIdToLayer.get(tractId) as L.GeoJSON | undefined;
      if (!layer) return;
      (layer as any).setStyle({
        weight: 4,
        color: '#1976d2',
        opacity: 0.9,
        fillOpacity: 0.9,
        fillColor: (this.tractGeoJsonLayers.get(layer) as string) ?? '#888'
      });
    });

    this.lastSliderHighlightedTractIds = new Set(newIds);

    this.updateDivisionLineAndLabels();
  }

  /**
   * Draw or update the division line (at split position), draggable handle, and population labels. Replaces slider input: line is the control.
   */
  private updateDivisionLineAndLabels(): void {
    if (!this.map || !this.currentStep?.districtGroups?.length) return;
    this.removeDivisionLineControls();
    if (!this.showDivisionLines) return;
    const multiDg = this.currentStep.districtGroups.length > 1 && this.selectedDistrictGroupIndex === null;
    if (multiDg) {
      this.updateDivisionLinesForMultipleDgs();
      return;
    }
    const dgIndex = this.currentStepIndex === 0 ? 0 : this.selectedDistrictGroupIndex ?? -1;
    if (dgIndex < 0 || !this.currentStep?.districtGroups?.[dgIndex]) return;
    const entries = this.getOrBuildSortedTractEntries();
    if (entries.length === 0) return;
    if (this.sortSliderValue === 0) {
      const mid = this.getMidpointSplitIndex();
      const M = this.sliderMax;
      this.sortSliderValue = Math.round(mid * M / entries.length);
    }
    const splitIndex = this.getSplitIndexFromSliderValue();
    let lineValue = this.getDivisionLinePositionFromSplitIndex(splitIndex);
    if (lineValue == null) return;
    const dgBounds = this.getDistrictGroupBounds(dgIndex);
    const mapBounds = this.map.getBounds();
    const isLat = this.sortDirection === 'latitude';
    const west = dgBounds ? dgBounds.getWest() : mapBounds.getWest();
    const east = dgBounds ? dgBounds.getEast() : mapBounds.getEast();
    const south = dgBounds ? dgBounds.getSouth() : mapBounds.getSouth();
    const north = dgBounds ? dgBounds.getNorth() : mapBounds.getNorth();
    if (dgBounds) {
      lineValue = isLat
        ? Math.max(south, Math.min(north, lineValue))
        : Math.max(west, Math.min(east, lineValue));
    }
    let latLngs: L.LatLng[];
    if (isLat) {
      latLngs = [L.latLng(lineValue, west), L.latLng(lineValue, east)];
    } else {
      latLngs = [L.latLng(south, lineValue), L.latLng(north, lineValue)];
    }
    const line = L.polyline(latLngs, {
      color: '#1976d2',
      weight: 3,
      opacity: 0.95,
      className: 'division-line-interactive ' + (isLat ? 'division-line-lat' : 'division-line-lng')
    });
    line.on('mouseover', () => {
      if (!this.divisionLineDragging) this.map!.getContainer().style.cursor = isLat ? 'ns-resize' : 'ew-resize';
    });
    line.on('mouseout', () => {
      if (!this.divisionLineDragging) this.map!.getContainer().style.cursor = '';
    });
    line.on('mousedown', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
      this.divisionLineDragging = true;
      this.map!.dragging.disable();
      this.map!.getContainer().style.cursor = isLat ? 'ns-resize' : 'ew-resize';
      const onMove = (ev: L.LeafletMouseEvent) => {
        if (ev.originalEvent) L.DomEvent.preventDefault(ev.originalEvent);
        const newVal = isLat ? ev.latlng.lat : ev.latlng.lng;
        this.updateDivisionLinePositionOnly(newVal);
      };
      const onUp = () => {
        this.divisionLineDragging = false;
        this.map!.dragging.enable();
        this.map!.getContainer().style.cursor = '';
        this.map!.off('mousemove', onMove);
        this.map!.off('mouseup', onUp);
        const latlngs = (this.sliderPositionLineLayer as L.Polyline)?.getLatLngs() as L.LatLng[] | undefined;
        if (latlngs?.length) {
          const lineVal = isLat ? latlngs[0].lat : latlngs[0].lng;
          this.applyDivisionLinePosition(lineVal);
        }
      };
      this.map!.on('mousemove', onMove);
      this.map!.on('mouseup', onUp);
    });
    line.addTo(this.map);
    this.sliderPositionLineLayer = line;

    const handlePos = isLat ? L.latLng(lineValue, east) : L.latLng(north, lineValue);
    const handleIcon = L.divIcon({
      className: 'division-line-handle',
      html: '<div style="width:12px;height:12px;border-radius:50%;background:#1976d2;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:' + (isLat ? 'ns-resize' : 'ew-resize') + '"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    const handle = L.marker(handlePos, { draggable: true, icon: handleIcon });
    handle.on('dragend', () => {
      const pos = handle.getLatLng();
      const newVal = isLat ? pos.lat : pos.lng;
      this.applyDivisionLinePosition(newVal);
    });
    handle.addTo(this.map);
    this.divisionLineDragHandle = handle;

    const { first, second } = this.getPopulationsForSplitIndex(splitIndex);
    const fmt = (n: number) => n.toLocaleString();
    const labelOffset = 0.06;
    const labelNorth = L.marker(
      isLat ? L.latLng(lineValue + labelOffset, east) : L.latLng(north, lineValue + labelOffset),
      {
        icon: L.divIcon({
          className: 'division-line-label',
          html: '<div class="division-label division-label-first">' + (isLat ? 'N' : 'W') + ': ' + fmt(first) + '</div>',
          iconSize: [120, 24],
          iconAnchor: [0, 12]
        })
      }
    );
    const labelSouth = L.marker(
      isLat ? L.latLng(lineValue - labelOffset, east) : L.latLng(south, lineValue - labelOffset),
      {
        icon: L.divIcon({
          className: 'division-line-label',
          html: '<div class="division-label division-label-second">' + (isLat ? 'S' : 'E') + ': ' + fmt(second) + '</div>',
          iconSize: [120, 24],
          iconAnchor: [0, 12]
        })
      }
    );
    labelNorth.addTo(this.map);
    labelSouth.addTo(this.map);
    this.divisionLineLabelNorth = labelNorth;
    this.divisionLineLabelSouth = labelSouth;
  }

  private removeDivisionLineControls(): void {
    this.divisionLineControlsByDg.forEach(({ line, handle, labelNorth, labelSouth }) => {
      if (this.map) {
        this.map.removeLayer(line);
        this.map.removeLayer(handle);
        this.map.removeLayer(labelNorth);
        this.map.removeLayer(labelSouth);
      }
    });
    this.divisionLineControlsByDg = [];
    if (this.divisionLineDragHandle && this.map) {
      this.map.removeLayer(this.divisionLineDragHandle);
      this.divisionLineDragHandle = null;
    }
    if (this.divisionLineLabelNorth && this.map) {
      this.map.removeLayer(this.divisionLineLabelNorth);
      this.divisionLineLabelNorth = null;
    }
    if (this.divisionLineLabelSouth && this.map) {
      this.map.removeLayer(this.divisionLineLabelSouth);
      this.divisionLineLabelSouth = null;
    }
    if (this.sliderPositionLineLayer && this.map) {
      this.map.removeLayer(this.sliderPositionLineLayer);
      this.sliderPositionLineLayer = null;
    }
  }

  /** Update line, handle, and label positions and label text in place (during drag) without removing layers. */
  private updateDivisionLinePositionOnly(lineValue: number): void {
    if (!this.map || !this.sliderPositionLineLayer || !this.divisionLineDragHandle) return;
    const dgIndex = this.currentStepIndex === 0 ? 0 : this.selectedDistrictGroupIndex ?? -1;
    const dgBounds = dgIndex >= 0 ? this.getDistrictGroupBounds(dgIndex) : null;
    const mapBounds = this.map.getBounds();
    const west = dgBounds ? dgBounds.getWest() : mapBounds.getWest();
    const east = dgBounds ? dgBounds.getEast() : mapBounds.getEast();
    const south = dgBounds ? dgBounds.getSouth() : mapBounds.getSouth();
    const north = dgBounds ? dgBounds.getNorth() : mapBounds.getNorth();
    const isLat = this.sortDirection === 'latitude';
    const clamped = isLat
      ? Math.max(south, Math.min(north, lineValue))
      : Math.max(west, Math.min(east, lineValue));
    if (isLat) {
      (this.sliderPositionLineLayer as L.Polyline).setLatLngs([L.latLng(clamped, west), L.latLng(clamped, east)]);
      this.divisionLineDragHandle.setLatLng(L.latLng(clamped, east));
    } else {
      (this.sliderPositionLineLayer as L.Polyline).setLatLngs([L.latLng(south, clamped), L.latLng(north, clamped)]);
      this.divisionLineDragHandle.setLatLng(L.latLng(north, clamped));
    }
    const splitIndex = this.getSplitIndexFromDivisionLinePosition(clamped);
    const M = this.sliderMax;
    const N = this.cachedSortedTractEntries.length;
    this.sortSliderValue = Math.max(0, Math.min(M, Math.round(splitIndex * M / N)));
    const { first, second } = this.getPopulationsForSplitIndex(splitIndex);
    const fmt = (n: number) => n.toLocaleString();
    const labelOffset = 0.06;
    if (this.divisionLineLabelNorth) {
      this.divisionLineLabelNorth.setLatLng(isLat ? L.latLng(clamped + labelOffset, east) : L.latLng(north, clamped + labelOffset));
      this.divisionLineLabelNorth.setIcon(L.divIcon({
        className: 'division-line-label',
        html: '<div class="division-label division-label-first">' + (isLat ? 'N' : 'W') + ': ' + fmt(first) + '</div>',
        iconSize: [120, 24],
        iconAnchor: [0, 12]
      }));
    }
    if (this.divisionLineLabelSouth) {
      this.divisionLineLabelSouth.setLatLng(isLat ? L.latLng(clamped - labelOffset, east) : L.latLng(south, clamped - labelOffset));
      this.divisionLineLabelSouth.setIcon(L.divIcon({
        className: 'division-line-label',
        html: '<div class="division-label division-label-second">' + (isLat ? 'S' : 'E') + ': ' + fmt(second) + '</div>',
        iconSize: [120, 24],
        iconAnchor: [0, 12]
      }));
    }
    this.updateSliderHighlightOnLayers();
    this.cdr.markForCheck();
  }

  /** Draw one division line per DG when step has multiple DGs and none selected. */
  private updateDivisionLinesForMultipleDgs(): void {
    const isLat = this.sortDirection === 'latitude';
    const M = this.sliderMax;
    for (let dgIndex = 0; dgIndex < this.currentStep!.districtGroups.length; dgIndex++) {
      const dgBounds = this.getDistrictGroupBounds(dgIndex);
      const data = this.getOrBuildSortedTractEntriesForDg(dgIndex);
      if (!dgBounds || !data || data.entries.length === 0) continue;
      let v = this.sortSliderValueByDgIndex[dgIndex] ?? 0;
      const N = data.entries.length;
      if (v === 0) {
        const half = data.total / 2;
        let mid = 0;
        for (let i = 0; i <= N; i++) {
          if ((data.prefixSum[i] ?? 0) >= half) { mid = i; break; }
        }
        v = Math.round(mid * M / N);
        this.sortSliderValueByDgIndex[dgIndex] = v;
      }
      const splitIndex = Math.min(N, Math.max(0, Math.floor(v * N / M)));
      let lineValue: number;
      if (splitIndex <= 0) {
        lineValue = isLat ? data.entries[0].maxLat + 0.001 : data.entries[0].minLng - 0.001;
      } else if (splitIndex >= N) {
        lineValue = isLat ? data.entries[N - 1].minLat - 0.001 : data.entries[N - 1].maxLng + 0.001;
      } else {
        lineValue = isLat
          ? (data.entries[splitIndex - 1].minLat + data.entries[splitIndex].maxLat) / 2
          : (data.entries[splitIndex - 1].maxLng + data.entries[splitIndex].minLng) / 2;
      }
      const west = dgBounds.getWest();
      const east = dgBounds.getEast();
      const south = dgBounds.getSouth();
      const north = dgBounds.getNorth();
      lineValue = isLat ? Math.max(south, Math.min(north, lineValue)) : Math.max(west, Math.min(east, lineValue));
      const latLngs = isLat
        ? [L.latLng(lineValue, west), L.latLng(lineValue, east)]
        : [L.latLng(south, lineValue), L.latLng(north, lineValue)];
      const line = L.polyline(latLngs, {
        color: '#1976d2',
        weight: 3,
        opacity: 0.95,
        className: 'division-line-interactive ' + (isLat ? 'division-line-lat' : 'division-line-lng')
      });
      const idx = dgIndex;
      line.on('mouseover', () => {
        if (!this.divisionLineDragging) this.map!.getContainer().style.cursor = isLat ? 'ns-resize' : 'ew-resize';
      });
      line.on('mouseout', () => {
        if (!this.divisionLineDragging) this.map!.getContainer().style.cursor = '';
      });
      line.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
        this.divisionLineDragging = true;
        this.map!.dragging.disable();
        this.map!.getContainer().style.cursor = isLat ? 'ns-resize' : 'ew-resize';
        const onMove = (ev: L.LeafletMouseEvent) => {
          if (ev.originalEvent) L.DomEvent.preventDefault(ev.originalEvent);
          const newVal = isLat ? ev.latlng.lat : ev.latlng.lng;
          this.applyDivisionLinePositionForDg(newVal, idx);
        };
        const onUp = () => {
          this.divisionLineDragging = false;
          this.map!.dragging.enable();
          this.map!.getContainer().style.cursor = '';
          this.map!.off('mousemove', onMove);
          this.map!.off('mouseup', onUp);
          const latlngs = (line.getLatLngs() as L.LatLng[]);
          if (latlngs.length) {
            const lineVal = isLat ? latlngs[0].lat : latlngs[0].lng;
            this.applyDivisionLinePositionForDg(lineVal, idx);
          }
        };
        this.map!.on('mousemove', onMove);
        this.map!.on('mouseup', onUp);
      });
      line.addTo(this.map!);
      const handlePos = isLat ? L.latLng(lineValue, east) : L.latLng(north, lineValue);
      const handleIcon = L.divIcon({
        className: 'division-line-handle',
        html: '<div style="width:12px;height:12px;border-radius:50%;background:#1976d2;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:' + (isLat ? 'ns-resize' : 'ew-resize') + '"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });
      const handle = L.marker(handlePos, { draggable: true, icon: handleIcon });
      handle.on('dragend', () => {
        const pos = handle.getLatLng();
        this.applyDivisionLinePositionForDg(isLat ? pos.lat : pos.lng, idx);
      });
      handle.addTo(this.map!);
      const { first, second } = { first: data.prefixSum[splitIndex] ?? 0, second: data.total - (data.prefixSum[splitIndex] ?? 0) };
      const fmt = (n: number) => n.toLocaleString();
      const labelOffset = 0.06;
      const labelNorth = L.marker(
        isLat ? L.latLng(lineValue + labelOffset, east) : L.latLng(north, lineValue + labelOffset),
        { icon: L.divIcon({ className: 'division-line-label', html: '<div class="division-label division-label-first">' + (isLat ? 'N' : 'W') + ': ' + fmt(first) + '</div>', iconSize: [120, 24], iconAnchor: [0, 12] }) }
      );
      const labelSouth = L.marker(
        isLat ? L.latLng(lineValue - labelOffset, east) : L.latLng(south, lineValue - labelOffset),
        { icon: L.divIcon({ className: 'division-line-label', html: '<div class="division-label division-label-second">' + (isLat ? 'S' : 'E') + ': ' + fmt(second) + '</div>', iconSize: [120, 24], iconAnchor: [0, 12] }) }
      );
      labelNorth.addTo(this.map!);
      labelSouth.addTo(this.map!);
      this.divisionLineControlsByDg.push({ line, handle, labelNorth, labelSouth, dgIndex: idx });
    }
    this.cdr.markForCheck();
  }

  /** Apply division line position for a specific DG (multi-DG mode). */
  private applyDivisionLinePositionForDg(lineValue: number, dgIndex: number): void {
    const data = this.getOrBuildSortedTractEntriesForDg(dgIndex);
    const dgBounds = this.getDistrictGroupBounds(dgIndex);
    if (!data || !dgBounds) return;
    const isLat = this.sortDirection === 'latitude';
    const west = dgBounds.getWest();
    const east = dgBounds.getEast();
    const south = dgBounds.getSouth();
    const north = dgBounds.getNorth();
    const clamped = isLat ? Math.max(south, Math.min(north, lineValue)) : Math.max(west, Math.min(east, lineValue));
    const splitIndex = this.getSplitIndexFromLineValueForEntries(data.entries, clamped, isLat);
    const M = this.sliderMax;
    const N = data.entries.length;
    this.sortSliderValueByDgIndex[dgIndex] = Math.max(0, Math.min(M, Math.round(splitIndex * M / N)));
    this.updateDivisionLineAndLabels();
    this.cdr.markForCheck();
  }

  /** Apply new division line position (lat or lng): update split, slider value, highlight, and redraw line/labels. */
  private applyDivisionLinePosition(lineValue: number): void {
    const entries = this.getOrBuildSortedTractEntries();
    const N = entries.length;
    if (N === 0) return;
    const splitIndex = this.getSplitIndexFromDivisionLinePosition(lineValue);
    const M = this.sliderMax;
    this.sortSliderValue = Math.max(0, Math.min(M, Math.round(splitIndex * M / N)));
    this.clearSliderHighlight();
    this.updateSliderHighlightOnLayers();
    this.updateDivisionLineAndLabels();
    this.cdr.markForCheck();
  }

  onSortSliderInput(value: number): void {
    const n = Number(value);
    if (isNaN(n)) return;
    const raw = Math.max(0, Math.min(Math.round(n), this.sliderMax));
    this.sortSliderValue = this.sortDirection === 'latitude' ? this.sliderMax - raw : raw;

    this.clearSliderHighlight();

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - this.lastSliderUpdateTime;

    if (this.pendingSliderUpdateTimer !== null) {
      clearTimeout(this.pendingSliderUpdateTimer);
      this.pendingSliderUpdateTimer = null;
    }

    if (elapsed >= MapsPageComponent.SLIDER_THROTTLE_MS || this.lastSliderUpdateTime === 0) {
      this.lastSliderUpdateTime = now;
      this.updateSliderHighlightOnLayers();
    } else {
      this.pendingSliderUpdateTimer = setTimeout(() => {
        this.pendingSliderUpdateTimer = null;
        this.lastSliderUpdateTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.updateSliderHighlightOnLayers();
      }, MapsPageComponent.SLIDER_THROTTLE_MS - elapsed);
    }
  }

  private renderFinalDistricts(): void {
    if (this.isRenderingDistricts) {
      return; // Prevent re-entrant render (stops render loop)
    }
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

    this.isRenderingDistricts = true;
    try {
    console.log('🖼️ Rendering districts on map...');

    // Clear existing layers and reset tracking
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.lastSliderHighlightedTractIds.clear();
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

    // Slider highlight is applied via setStyle in updateSliderHighlightOnLayers (not during render)
    let totalTracts = 0;

    // Render final districts (all steps calculated)
    districtsToRender.forEach((district, index) => {
      // Determine color based on selection state
      const baseColor = this.getDistrictColor(index, districtsToRender.length);
      const isSelected = this.selectedDistrictGroupIndex === index;
      // Only apply grayscale if a district is selected AND this one is not selected
      const color = (this.selectedDistrictGroupIndex !== null && !isSelected) 
        ? this.colorToGrayscale(baseColor) 
        : baseColor;
      
      if (!district.censusTracts || district.censusTracts.length === 0) {
        console.warn(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber} has no tracts`);
        return;
      }
      
      // If showTractBoundaries is false and union polygon(s) exist, render them
      // At Step 0: Prefer unionPolygons array (main + islands) over single unionPolygon
      // At other steps: Prefer single unionPolygon for visualization (one dissolved polygon for entire district)
      // Fall back to unionPolygons array if single polygon not available (for backward compatibility)
      const unionPolygons = (district as any).unionPolygons;
      const hasUnionPolygonsArray = !this.showTractBoundaries && Array.isArray(unionPolygons) && unionPolygons.length > 0;
      const hasSingleUnionPolygon = !this.showTractBoundaries && !hasUnionPolygonsArray && district.unionPolygon && district.unionPolygon.geometry;
      
      // Debug logging for Step 0
      if (this.currentStepIndex === 0) {
        console.log(`🔍 RENDERING STEP 0: District ${district.startDistrictNumber}-${district.endDistrictNumber} - has unionPolygons array: ${Array.isArray(unionPolygons)}, length: ${unionPolygons?.length || 0}, has unionPolygon: ${!!district.unionPolygon}, showTractBoundaries: ${this.showTractBoundaries}`);
      }
      
      // Use union polygons only when checkbox is unchecked (showTractBoundaries = false)
      if (hasUnionPolygonsArray || hasSingleUnionPolygon) {
        // Prefer unionPolygons array when available (especially at Step 0 for main + islands)
        // Otherwise use single unionPolygon
        const polygonsToRender = hasUnionPolygonsArray ? unionPolygons : [district.unionPolygon];
        
        // Validate polygons before rendering
        if (hasUnionPolygonsArray) {
          const validPolygons = polygonsToRender.filter((p: any, idx: number) => {
            const isValid = p && p.geometry;
            if (!isValid) {
              console.warn(`⚠️ Polygon ${idx} in unionPolygons array is invalid (missing or no geometry) for district ${district.startDistrictNumber}-${district.endDistrictNumber}`);
            }
            return isValid;
          });
          
          if (validPolygons.length !== polygonsToRender.length) {
            console.warn(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber}: ${polygonsToRender.length - validPolygons.length} invalid polygon(s) filtered out`);
          }
          
          // Check if main polygon (first) is present
          if (validPolygons.length > 0 && validPolygons[0]) {
            console.log(`✅ Main polygon present: ${validPolygons[0].geometry?.type || 'unknown type'}`);
          } else {
            console.error(`❌ CRITICAL: Main polygon missing from unionPolygons array for district ${district.startDistrictNumber}-${district.endDistrictNumber}`);
          }
          
          // Use only valid polygons
          const finalPolygons = validPolygons.length > 0 ? validPolygons : polygonsToRender;
          console.log(`✅ Rendering ${finalPolygons.length} union polygon(s) for district ${district.startDistrictNumber}-${district.endDistrictNumber} (main + ${finalPolygons.length - 1} island(s))`);
          
          // Render valid polygons
          finalPolygons.forEach((unionPolygon: any, polygonIndex: number) => {
            if (!unionPolygon || !unionPolygon.geometry) {
              console.warn(`⚠️ Union polygon ${polygonIndex} is invalid for district ${district.startDistrictNumber}-${district.endDistrictNumber}`);
              return;
            }
            
            // Log each polygon being rendered (especially for Step 0)
            if (this.currentStepIndex === 0) {
              const isMain = polygonIndex === 0;
              const geomType = unionPolygon.geometry?.type || 'unknown';
              const coords = unionPolygon.geometry?.coordinates;
              let coordInfo = 'unknown';
              if (coords) {
                if (geomType === 'Polygon') {
                  coordInfo = `ring count: ${coords.length}, first ring points: ${coords[0]?.length || 0}`;
                } else if (geomType === 'MultiPolygon') {
                  coordInfo = `polygon count: ${coords.length}`;
                } else {
                  coordInfo = `length: ${coords.length}`;
                }
              }
              console.log(`🎨 Rendering ${isMain ? 'MAIN' : `ISLAND ${polygonIndex}`} polygon ${polygonIndex + 1}/${finalPolygons.length} - type: ${geomType}, ${coordInfo}`);
              
              // For main polygon, also log sample coordinates to verify they're valid
              if (isMain && geomType === 'Polygon' && coords && coords[0] && coords[0].length > 0) {
                const firstPoint = coords[0][0];
                const lastPoint = coords[0][coords[0].length - 1];
                console.log(`📍 MAIN polygon sample: first point: [${firstPoint[1]}, ${firstPoint[0]}], last point: [${lastPoint[1]}, ${lastPoint[0]}]`);
              }
            }
            
            try {
              const unionProperties = unionPolygon.properties || {};
              
              const geoJson = L.geoJSON(unionPolygon, {
                style: {
                  color: color, // Match fill color for seamless appearance
                  weight: 2, // Slightly thicker border for district outline
                  opacity: 1.0, // Full opacity for district boundaries
                  fillOpacity: 0.7,
                  fillColor: color
                }
              }).bindPopup(`
                <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
                ${finalPolygons.length > 1 ? `<strong>Component:</strong> ${polygonIndex === 0 ? 'Main' : `Island ${polygonIndex}`} (${polygonIndex + 1} of ${finalPolygons.length})<br>` : ''}
                <strong>Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
                <strong>Tracts in District:</strong> ${district.censusTracts.length}
              `);

              this.tractLayer!.addLayer(geoJson);
              this.tractGeoJsonLayers.set(geoJson, color); // Store layer -> color mapping for style updates
              totalTracts++;

              // Extend bounds
              const unionBounds = geoJson.getBounds();
              if (unionBounds && unionBounds.isValid()) {
                const isMain = polygonIndex === 0;
                // Log bounds for final step (step 4) or step 0
                if ((this.currentStepIndex === 0 || this.currentStepIndex >= 4) && isMain) {
                  console.log(`🗺️ ${isMain ? 'MAIN' : `ISLAND ${polygonIndex}`} polygon bounds for district ${district.startDistrictNumber}: ${unionBounds.getSouth()} to ${unionBounds.getNorth()} (lat), ${unionBounds.getWest()} to ${unionBounds.getEast()} (lng)`);
                  console.log(`🗺️ ${isMain ? 'MAIN' : `ISLAND ${polygonIndex}`} polygon center: ${unionBounds.getCenter()}, size: ${unionBounds.getNorth() - unionBounds.getSouth()} x ${unionBounds.getEast() - unionBounds.getWest()}`);
                }
                bounds.extend(unionBounds);
                hasBounds = true;
              } else {
                const isMain = polygonIndex === 0;
                console.error(`❌ ${isMain ? 'MAIN' : `ISLAND ${polygonIndex}`} polygon bounds invalid for district ${district.startDistrictNumber}! unionBounds:`, unionBounds);
              }
            } catch (error) {
              console.error(`⚠️ Error rendering union polygon ${polygonIndex} for district ${district.startDistrictNumber}-${district.endDistrictNumber}:`, error, unionPolygon);
            }
          });
        } else if (hasSingleUnionPolygon) {
          // Single polygon case - render it
          const singlePolygon = district.unionPolygon;
          if (singlePolygon && singlePolygon.geometry) {
            console.log(`✅ Rendering single union polygon for district ${district.startDistrictNumber}-${district.endDistrictNumber}`);
            
            try {
              const geoJson = L.geoJSON(singlePolygon, {
                style: {
                  color: color,
                  weight: 2,
                  opacity: 1.0,
                  fillOpacity: 0.7,
                  fillColor: color
                }
              }).bindPopup(`
                <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
                <strong>Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
                <strong>Tracts in District:</strong> ${district.censusTracts.length}
              `);

              this.tractLayer!.addLayer(geoJson);
              this.tractGeoJsonLayers.set(geoJson, color);
              totalTracts++;

              const unionBounds = geoJson.getBounds();
              if (unionBounds && unionBounds.isValid()) {
                // Log bounds for final step
                if (this.currentStepIndex >= 4) {
                  console.log(`🗺️ Single union polygon bounds for district ${district.startDistrictNumber}: ${unionBounds.getSouth()} to ${unionBounds.getNorth()} (lat), ${unionBounds.getWest()} to ${unionBounds.getEast()} (lng)`);
                }
                bounds.extend(unionBounds);
                hasBounds = true;
              } else {
                console.error(`❌ Single union polygon bounds invalid for district ${district.startDistrictNumber}! unionBounds:`, unionBounds);
              }
            } catch (error) {
              console.error(`⚠️ Error rendering single union polygon for district ${district.startDistrictNumber}-${district.endDistrictNumber}:`, error);
            }
          }
        }
      } else {
        // Render individual tracts ONLY when showTractBoundaries is true
        // If showTractBoundaries is false, we should have rendered union polygons above
        // If we reach here with showTractBoundaries=false, it means union polygons aren't available
        if (!this.showTractBoundaries) {
          const hasUnionPolygons = Array.isArray((district as any).unionPolygons) && (district as any).unionPolygons.length > 0;
          console.warn(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber}: showTractBoundaries=false but union polygon(s) not available (has unionPolygons array: ${hasUnionPolygons}, has single union: ${!!district.unionPolygon}, has geometry: ${!!district.unionPolygon?.geometry}). Skipping individual tract rendering.`);
          return; // Skip rendering individual tracts when checkbox is unchecked
        }
        // Only render individual tracts when showTractBoundaries is true
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
            
            // Check if tract is isolated or a bridge tract
            const tractId = this.getTractId(tract);
            const isIsolated = this.isolatedTractIds.has(tractId);
            const isBridge = this.bridgeTractIds.has(tractId);

            // Debug: Log first few isolated tracts being rendered
            if (isIsolated && this.isolatedTractIds.size > 0) {
              const isolatedArray = Array.from(this.isolatedTractIds);
              const firstIsolated = isolatedArray[0];
              if (tractId === firstIsolated || tractId === isolatedArray[1] || tractId === isolatedArray[2]) {
                console.log(`🎨 Rendering isolated tract: ${tractId}, isIsolated: ${isIsolated}, in Set: ${this.isolatedTractIds.has(tractId)}`);
              }
            }

            let tractColor = isIsolated ? this.darkenColor(color, 0.1) : color;

            // Determine border weight and color: bridge tracts get white 3px border. Slider highlight applied later via setStyle.
            let borderWeight = this.showTractBoundaries ? 0.5 : 0.3;
            let borderColor = this.showTractBoundaries ? '#000000' : tractColor;
            if (isBridge) {
              borderWeight = 3;
              borderColor = '#ffffff';
            }

            // Tracts should be GeoJSON Features - pass directly to L.geoJSON
            const geoJson = L.geoJSON(tract, {
              style: {
                color: borderColor,
                weight: borderWeight,
                opacity: this.showTractBoundaries ? 0.8 : (isBridge ? 1.0 : 0.2),
                fillOpacity: isIsolated ? 0.9 : 0.7,
                fillColor: tractColor
              }
            }).bindPopup(`
              <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
              <strong>Tract ID:</strong> ${tractProperties.TRACT_FIPS || tractProperties['GEOID'] || 'Unknown'}<br>
              ${isIsolated ? '<strong style="color: #d32f2f;">⚠️ ISOLATED TRACT</strong><br>' : ''}
              ${isBridge ? '<strong style="color: #1976d2;">🌉 BRIDGE TRACT</strong><br>' : ''}
              <strong>Population:</strong> ${(tractProperties.POPULATION || 0).toLocaleString()}<br>
              <strong>District Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
              <strong>Tracts in District:</strong> ${district.censusTracts.length}
            `);
            
            // Store tract ID to layer mapping for popup access
            this.tractIdToLayer.set(tractId, geoJson);

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

    if (this.showTractBoundaries && totalTracts > 0) {
      this.updateSliderHighlightOnLayers();
    }

    // Fit map to show all districts
    if (hasBounds && bounds.isValid() && this.map) {
      console.log(`🗺️ Fitting map to bounds:`, {
        south: bounds.getSouth(),
        north: bounds.getNorth(),
        west: bounds.getWest(),
        east: bounds.getEast(),
        center: bounds.getCenter(),
        isValid: bounds.isValid()
      });
      this.stateBoundsForSlider = bounds;
      const padding = L.point(20, 20);
      this.map.fitBounds(bounds, { padding: [20, 20] });
      // Furthest zoom out = zoom level that fits bounds (use getBoundsZoom so we don't rely on getZoom() which can lag)
      const fitZoom = this.map.getBoundsZoom(bounds, false, padding);
      this.map.setMinZoom(fitZoom);
      this.updateSliderTrackLength();
      // Force invalidate size after fitting bounds to ensure map renders correctly
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
          this.updateSliderTrackLength();
        }
      }, 100);
    } else {
      this.stateBoundsForSlider = null;
      this.sliderTrackLengthPx = null;
      this.cdr.markForCheck();
      console.warn('⚠️ Cannot fit map to bounds:', {
        hasBounds,
        isValid: bounds.isValid(),
        mapExists: !!this.map,
        bounds: hasBounds ? {
          south: bounds.getSouth(),
          north: bounds.getNorth(),
          west: bounds.getWest(),
          east: bounds.getEast()
        } : 'no bounds'
      });
    }

    // Render division lines for current step and all previous steps
    // Hide division lines when a district is selected
    if (this.selectedDistrictGroupIndex === null) {
      this.renderDivisionLines();
    }
    } finally {
      this.isRenderingDistricts = false;
    }
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

    // Do not remove interactive division line (sliderPositionLineLayer, handle, labels) here; that is the sort control, cleared only in clearSliderHighlight.

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
    
    // Only render if division lines are enabled
    if (!this.showDivisionLines) {
      return;
    }

    // Check if this is the final step (all steps complete)
    const isFinalStep = this.totalSteps > 0 && this.currentStepIndex === this.totalSteps - 1;

    // Add static lines for all previous steps
    for (let stepIdx = 0; stepIdx < this.currentStepIndex; stepIdx++) {
      const step = this.loadedSteps[stepIdx];
      if (step && step.divisionLines && step.divisionLines.length > 0) {
        this.addStaticDivisionLinesForStep(step, stepIdx);
      }
    }

    // For final step, render all division lines as static (no animation)
    // For intermediate steps, animate the current step's division lines
    if (this.currentStep.divisionLines && this.currentStep.divisionLines.length > 0) {
      if (isFinalStep) {
        // Final step: render all division lines as static
        this.addStaticDivisionLinesForStep(this.currentStep, this.currentStepIndex);
      } else {
        // Intermediate step: animate current step's division lines
        this.animateCurrentStepDivisionLines(this.currentStep, this.currentStepIndex);
      }
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

  /**
   * Convert a color to grayscale
   */
  private colorToGrayscale(color: string): string {
    // Handle HSL colors
    if (color.startsWith('hsl(')) {
      const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const lightness = parseInt(match[3]);
        // Convert to grayscale by removing saturation and adjusting lightness
        // Keep the lightness similar but reduce saturation to 0
        return `hsl(0, 0%, ${lightness}%)`;
      }
    }
    // Fallback: return a medium gray
    return 'hsl(0, 0%, 50%)';
  }

  /**
   * Select a district group to highlight on the map
   */
  selectDistrictGroup(index: number): void {
    if (this.selectedDistrictGroupIndex === index) {
      // Deselect if clicking the same district
      this.selectedDistrictGroupIndex = null;
    } else {
      // Select the new district
      this.selectedDistrictGroupIndex = index;
    }
    this.sortSliderValue = 0; // Reset sort-order slider when DG changes
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();
    // Re-render the map with the new highlighting
    this.renderFinalDistricts();
  }

  /**
   * Detect isolated tracts in the current step's district groups
   */
  detectIsolatedTracts(): void {
    if (!this.currentStep || !this.algorithmResult) {
      console.warn('No current step or algorithm result available');
      return;
    }

    // Collect all tracts from all district groups
    const allTracts: GeoJsonFeature[] = [];
    for (const group of this.currentStep.districtGroups) {
      allTracts.push(...group.censusTracts);
    }

    if (allTracts.length === 0) {
      console.warn('No tracts available for isolation detection');
      return;
    }

    this.isDetectingIsolation = true;
    this.isolatedTractIds.clear();

    const subscription = this.geodistrictService.detectIsolatedTracts(
      this.currentStep.districtGroups,
      allTracts
    ).subscribe({
      next: (result) => {
        console.log(`🔍 Detection complete: ${result.totalIsolated} isolated tracts found in ${result.groupsWithIsolation} groups`);
        console.log(`🔍 Isolated tract IDs (first 10):`, result.isolatedTractIds.slice(0, 10));
        
        // Store isolated tract IDs and full data
        this.isolatedTractIds = new Set(result.isolatedTractIds);
        this.isolatedTractsData = {
          isolatedTractsByGroup: result.isolatedTractsByGroup,
          isolatedTractIds: result.isolatedTractIds,
          groupStats: result.groupStats || []
        };
        // Clear bridge tracts when new isolation is detected
        this.bridgeTractIds.clear();
        this.bridgeTractsData = null;
        
        // Debug: Check if we can match any tract IDs
        if (this.currentStep && this.currentStep.districtGroups.length > 0) {
          const sampleTract = this.currentStep.districtGroups[0].censusTracts[0];
          if (sampleTract) {
            const sampleId = this.getTractId(sampleTract);
            console.log(`🔍 Sample tract ID format:`, sampleId);
            console.log(`🔍 Sample tract properties:`, Object.keys(sampleTract.properties || {}));
            console.log(`🔍 Is sample tract isolated?`, this.isolatedTractIds.has(sampleId));
          }
        }
        
        // Re-render to highlight isolated tracts
        this.renderFinalDistricts();
        
        this.isDetectingIsolation = false;
      },
      error: (error) => {
        console.error('Error detecting isolated tracts:', error);
        this.errorMessage = error.message || 'Failed to detect isolated tracts';
        this.isDetectingIsolation = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  /**
   * Get tract ID from a GeoJSON feature
   * IMPORTANT: Must match backend getTractId logic for proper ID matching
   */
  private getTractId(tract: GeoJsonFeature): string {
    // Prefer GEOID as it's the full unique identifier (state+county+tract)
    if (tract.properties?.['GEOID']) {
      return tract.properties['GEOID'];
    }
    
    // If GEOID not available, try GEO_ID (may have "US" prefix)
    if (tract.properties?.['GEO_ID']) {
      const geoId = tract.properties['GEO_ID'];
      if (typeof geoId === 'string' && geoId.startsWith('US')) {
        return geoId.substring(2);
      }
      return geoId;
    }
    
    // Fallback: construct from STATE_FIPS + COUNTY_FIPS + TRACT_FIPS
    if (tract.properties?.['STATE_FIPS'] && tract.properties?.['COUNTY_FIPS'] && tract.properties?.['TRACT_FIPS']) {
      return `${tract.properties['STATE_FIPS']}${tract.properties['COUNTY_FIPS']}${tract.properties['TRACT_FIPS']}`;
    }
    
    // Last resort: use TRACT_FIPS alone
    if (tract.properties?.['TRACT_FIPS']) {
      return tract.properties['TRACT_FIPS'];
    }
    
    return '';
  }

  /**
   * Check if a tract is isolated
   */
  private isTractIsolated(tract: GeoJsonFeature): boolean {
    const tractId = this.getTractId(tract);
    return this.isolatedTractIds.has(tractId);
  }

  /**
   * Darken a color by reducing lightness
   */
  private darkenColor(color: string, amount: number = 0.3): string {
    // Handle HSL colors
    if (color.startsWith('hsl(')) {
      const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const hue = parseInt(match[1]);
        const saturation = parseInt(match[2]);
        const lightness = Math.max(10, parseInt(match[3]) - (amount * 100));
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
      }
    }
    // Fallback: return a darker shade
    return color;
  }

  /**
   * Detect bridge tracts that could connect isolated tracts
   */
  detectBridgeTracts(): void {
    if (!this.currentStep || !this.algorithmResult || !this.isolatedTractsData) {
      console.warn('No current step, algorithm result, or isolated tracts data available');
      return;
    }

    // Collect all tracts from all district groups
    const allTracts: GeoJsonFeature[] = [];
    for (const group of this.currentStep.districtGroups) {
      allTracts.push(...group.censusTracts);
    }

    if (allTracts.length === 0) {
      console.warn('No tracts available for bridge tract detection');
      return;
    }

    this.isDetectingBridge = true;
    this.bridgeTractIds.clear();

    const backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';
    const detectUrl = `${backendUrl}/api/algorithm/detect-bridge-tracts`;

    console.log(`🌉 Detecting bridge tracts for ${Object.keys(this.isolatedTractsData.isolatedTractsByGroup).length} groups with isolated tracts`);

    this.http.post<{
      bridgeTractsByIsolatedGroup: { [groupIndex: string]: Array<{tractId: string, fromGroupIndex: number, adjacentIsolatedCount: number}> };
      totalBridgeTracts: number;
    }>(detectUrl, {
      districtGroups: this.currentStep.districtGroups,
      allTracts,
      isolatedTractsByGroup: this.isolatedTractsData.isolatedTractsByGroup
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (result) => {
        console.log(`🌉 Bridge detection complete: ${result.totalBridgeTracts} bridge tracts found`);
        
        // Store bridge tract IDs
        const allBridgeTractIds = new Set<string>();
        for (const bridges of Object.values(result.bridgeTractsByIsolatedGroup)) {
          for (const bridge of bridges) {
            allBridgeTractIds.add(bridge.tractId);
          }
        }
        this.bridgeTractIds = allBridgeTractIds;
        this.bridgeTractsData = result;
        
        // Re-render to highlight bridge tracts
        this.renderFinalDistricts();
        
        this.isDetectingBridge = false;
      },
      error: (error) => {
        console.error('Error detecting bridge tracts:', error);
        this.errorMessage = error.error?.message || error.message || 'Failed to detect bridge tracts';
        this.isDetectingBridge = false;
      }
    });
  }

  /**
   * Move isolated tracts to opposite groups and re-run isolation detection
   */
  moveIsolatedTracts(): void {
    if (!this.currentStep) {
      console.warn('Cannot move isolated tracts: missing current step');
      return;
    }

    // Check if step has isolated tracts data (from step cache) or component has manually detected data
    const hasStepData = this.currentStep.isolatedTractsData && 
                        this.currentStep.isolatedTractsData.isolatedTractsByGroup &&
                        Object.keys(this.currentStep.isolatedTractsData.isolatedTractsByGroup).length > 0;
    
    const hasComponentData = this.isolatedTractsData && 
                             this.isolatedTractsData.isolatedTractsByGroup &&
                             Object.keys(this.isolatedTractsData.isolatedTractsByGroup).length > 0;

    if (!hasStepData && !hasComponentData) {
      console.warn('No isolated tracts to move - please detect isolated tracts first');
      return;
    }

    this.isMovingIsolatedTracts = true;

    console.log(`🔄 Moving all isolated tracts for step ${this.currentStep.step}${hasStepData ? ' (from step cache)' : ' (from manual detection)'}`);

    // Call new backend endpoint that processes all isolated tracts in one operation
    // Backend will use step cache data if available, otherwise it will detect from current state
    this.geodistrictService.moveAllIsolatedTractsFromStep(
      this.selectedState,
      this.currentStep.step,
      100 // maxIterations
    ).subscribe({
      next: (result) => {
        // Update current step with new district groups
        if (this.currentStep) {
          this.currentStep.districtGroups = result.districtGroups;
          // Update isolated tracts data from result
          this.currentStep.isolatedTractsData = {
            isolatedTractsByGroup: result.isolationResult.isolatedTractsByGroup,
            isolatedTractIds: result.isolationResult.isolatedTractIds,
            totalIsolated: result.isolationResult.totalIsolated,
            groupsWithIsolation: result.isolationResult.groupsWithIsolation
          };
        }

        // Update component state
        this.isolatedTractIds = new Set(result.isolationResult.isolatedTractIds);
        this.isolatedTractsData = {
          isolatedTractsByGroup: result.isolationResult.isolatedTractsByGroup,
          isolatedTractIds: result.isolationResult.isolatedTractIds
        };

        if (result.isolationResult.totalIsolated === 0) {
          console.log(`✅ All isolated tracts moved. Final isolation: 0 isolated tracts in 0 groups`);
        } else {
          console.log(`⚠️ Completed processing. Remaining isolation: ${result.isolationResult.totalIsolated} isolated tracts in ${result.isolationResult.groupsWithIsolation} groups`);
        }

        // Clear bridge tracts (will need to re-detect)
        this.bridgeTractIds.clear();
        this.bridgeTractsData = null;

        // Re-render map with updated groups
        this.renderFinalDistricts();

        this.isMovingIsolatedTracts = false;
      },
      error: (error) => {
        console.error('Error moving isolated tracts:', error);
        this.errorMessage = error.error?.message || error.message || 'Failed to move isolated tracts';
        this.isMovingIsolatedTracts = false;
      }
    });
  }

  /**
   * Move bridge tracts to isolated groups and re-run isolation detection
   */
  moveBridgeTracts(): void {
    if (!this.bridgeTractsData || !this.currentStep || !this.isolatedTractsData) {
      console.warn('Cannot move bridge tracts: missing data');
      return;
    }

    // Process each isolated group separately - move its bridge tracts to its own sibling group
    const isolatedGroupEntries = Object.entries(this.bridgeTractsData.bridgeTractsByIsolatedGroup);
    
    if (isolatedGroupEntries.length === 0) {
      console.warn('No bridge tracts to move');
      return;
    }

    this.isMovingBridgeTracts = true;

    // Get all tracts for the request
    const allTracts: any[] = [];
    for (const group of this.currentStep.districtGroups) {
      allTracts.push(...group.censusTracts);
    }

    if (!this.currentStep) {
      this.isMovingBridgeTracts = false;
      return;
    }

    // Process each isolated group's bridge tracts sequentially
    // Each isolated group's bridge tracts should be moved to that group's sibling
    let processedCount = 0;
    let currentDistrictGroups = this.currentStep.districtGroups;
    
    const processNextGroup = () => {
      if (processedCount >= isolatedGroupEntries.length) {
        // All groups processed - re-detect isolation and update UI
        console.log(`✅ All bridge tracts moved for ${processedCount} isolated group(s)`);
        
        // Re-detect isolation to get updated results
        this.geodistrictService.detectIsolatedTracts(currentDistrictGroups, allTracts).subscribe({
          next: (isolationResult) => {
            this.isolatedTractIds = new Set(isolationResult.isolatedTractIds);
            this.isolatedTractsData = {
              isolatedTractsByGroup: isolationResult.isolatedTractsByGroup,
              isolatedTractIds: isolationResult.isolatedTractIds
            };
            
            // Clear bridge tracts (will need to re-detect)
            this.bridgeTractIds.clear();
            this.bridgeTractsData = null;
            
            // Re-render map with updated groups
            this.renderFinalDistricts();
            
            this.isMovingBridgeTracts = false;
          },
          error: (error) => {
            console.error('Error re-detecting isolation:', error);
            this.isMovingBridgeTracts = false;
          }
        });
        return;
      }

      const [isolatedGroupIndexStr, bridges] = isolatedGroupEntries[processedCount];
      const isolatedGroupIndex = parseInt(isolatedGroupIndexStr);
      const bridgeTractIds = bridges.map((bridge: any) => bridge.tractId);

      console.log(`🔄 Moving ${bridgeTractIds.length} bridge tract(s) for isolated group ${isolatedGroupIndex} to its sibling group`);

      const subscription = this.geodistrictService.moveBridgeTractsAndRecheck(
        currentDistrictGroups,
        allTracts,
        isolatedGroupIndex,
        bridgeTractIds,
        this.currentStep?.divisionLines,
        this.selectedState,
        this.currentStep?.step,
        100 // maxIterations - default value
      ).subscribe({
        next: (result) => {
          console.log(`✅ Bridge tracts moved for group ${isolatedGroupIndex}. New isolation: ${result.isolationResult.totalIsolated} isolated tracts`);
          
          // Update district groups for next iteration
          currentDistrictGroups = result.districtGroups;
          if (this.currentStep) {
            this.currentStep.districtGroups = result.districtGroups;
          }
          
          processedCount++;
          // Process next group
          processNextGroup();
        },
        error: (error) => {
          console.error(`Error moving bridge tracts for group ${isolatedGroupIndex}:`, error);
          this.errorMessage = error.error?.message || error.message || `Failed to move bridge tracts for group ${isolatedGroupIndex}`;
          this.isMovingBridgeTracts = false;
        }
      });
    };

    // Start processing
    processNextGroup();
  }

  /**
   * Get isolated tracts list for display
   */
  getIsolatedTractsList(): Array<{tractId: string, groupIndex: number, groupLabel: string, isEnclosed: boolean}> {
    if (!this.isolatedTractsData || !this.currentStep) {
      return [];
    }

    const list: Array<{tractId: string, groupIndex: number, groupLabel: string, isEnclosed: boolean}> = [];
    
    // If isolatedTractsByGroup is empty but isolatedTractIds has items, try to find which groups they belong to
    if (Object.keys(this.isolatedTractsData.isolatedTractsByGroup).length === 0 && 
        this.isolatedTractsData.isolatedTractIds.length > 0) {
      // Fallback: search through all groups to find which group each isolated tract belongs to
      for (let groupIndex = 0; groupIndex < this.currentStep.districtGroups.length; groupIndex++) {
        const group = this.currentStep.districtGroups[groupIndex];
        const groupLabel = group ? `Districts ${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}` : `Group ${groupIndex}`;
        
        for (const tractId of this.isolatedTractsData.isolatedTractIds) {
          const tract = group.censusTracts.find(t => this.getTractId(t) === tractId);
          if (tract) {
            const isEnclosed = !!(tract.properties?.['TRACT_GROUP_ID'] || tract.properties?.['ENCLOSED_BY']);
            list.push({ tractId, groupIndex, groupLabel, isEnclosed });
          }
        }
      }
    } else {
      // Normal case: use isolatedTractsByGroup
      for (const [groupIndexStr, tractIds] of Object.entries(this.isolatedTractsData.isolatedTractsByGroup)) {
        const groupIndex = parseInt(groupIndexStr);
        const group = this.currentStep.districtGroups[groupIndex];
        const groupLabel = group ? `Districts ${group.startDistrictNumber}${group.endDistrictNumber !== group.startDistrictNumber ? `-${group.endDistrictNumber}` : ''}` : `Group ${groupIndex}`;
        
        for (const tractId of tractIds) {
          // Check if tract is enclosed by looking for it in the district groups
          let isEnclosed = false;
          if (group) {
            const tract = group.censusTracts.find(t => this.getTractId(t) === tractId);
            if (tract) {
              // Check for TRACT_GROUP_ID (enclosed tracts have this property)
              // or ENCLOSED_BY property
              isEnclosed = !!(tract.properties?.['TRACT_GROUP_ID'] || tract.properties?.['ENCLOSED_BY']);
            }
          }
          list.push({ tractId, groupIndex, groupLabel, isEnclosed });
        }
      }
    }
    
    return list;
  }

  /**
   * Get bridge tracts list for display (grouped by isolated tract they bridge)
   */
  getBridgeTractsList(): Array<{bridgeTractId: string, fromGroupIndex: number, fromGroupLabel: string, isolatedGroupIndex: number, isolatedGroupLabel: string, adjacentIsolatedCount: number}> {
    if (!this.bridgeTractsData || !this.currentStep) {
      return [];
    }

    const list: Array<{bridgeTractId: string, fromGroupIndex: number, fromGroupLabel: string, isolatedGroupIndex: number, isolatedGroupLabel: string, adjacentIsolatedCount: number}> = [];
    
    for (const [isolatedGroupIndexStr, bridges] of Object.entries(this.bridgeTractsData.bridgeTractsByIsolatedGroup)) {
      const isolatedGroupIndex = parseInt(isolatedGroupIndexStr);
      const isolatedGroup = this.currentStep.districtGroups[isolatedGroupIndex];
      const isolatedGroupLabel = isolatedGroup ? `Districts ${isolatedGroup.startDistrictNumber}${isolatedGroup.endDistrictNumber !== isolatedGroup.startDistrictNumber ? `-${isolatedGroup.endDistrictNumber}` : ''}` : `Group ${isolatedGroupIndex}`;
      
      for (const bridge of bridges) {
        const fromGroup = this.currentStep.districtGroups[bridge.fromGroupIndex];
        const fromGroupLabel = fromGroup ? `Districts ${fromGroup.startDistrictNumber}${fromGroup.endDistrictNumber !== fromGroup.startDistrictNumber ? `-${fromGroup.endDistrictNumber}` : ''}` : `Group ${bridge.fromGroupIndex}`;
        
        list.push({
          bridgeTractId: bridge.tractId,
          fromGroupIndex: bridge.fromGroupIndex,
          fromGroupLabel,
          isolatedGroupIndex,
          isolatedGroupLabel,
          adjacentIsolatedCount: bridge.adjacentIsolatedCount
        });
      }
    }
    
    return list;
  }

  /**
   * Get bridge tracts for a specific isolated group
   */
  getBridgeTractsForGroup(isolatedGroupIndex: number): Array<{bridgeTractId: string, fromGroupIndex: number, fromGroupLabel: string, isolatedGroupIndex: number, isolatedGroupLabel: string, adjacentIsolatedCount: number}> {
    return this.getBridgeTractsList().filter(bridge => bridge.isolatedGroupIndex === isolatedGroupIndex);
  }

  /**
   * Show popup for a tract when clicking on table row
   */
  showTractPopup(tractId: string): void {
    const layer = this.tractIdToLayer.get(tractId);
    if (layer && this.map) {
      // Get the bounds of the tract and open popup
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        // Open popup at the center of the tract
        const center = bounds.getCenter();
        layer.openPopup(center);
        // Pan map to show the tract if it's not visible
        if (!this.map.getBounds().contains(center)) {
          this.map.setView(center, Math.max(this.map.getZoom(), 10));
        }
      } else {
        // Fallback: try to open popup at map center
        layer.openPopup();
      }
    } else {
      console.warn(`Tract layer not found for ID: ${tractId}`);
    }
  }

  /**
   * Get total state population (sum of all district groups)
   */
  get statePopulation(): number {
    if (!this.currentStep || !this.currentStep.districtGroups || this.currentStep.districtGroups.length === 0) {
      return 0;
    }
    return this.currentStep.districtGroups.reduce((sum, g) => sum + g.totalPopulation, 0);
  }

  /**
   * Get target population per district group
   * Target = (total state population / total state districts) * average districts per group
   */
  get targetDGPopulation(): number {
    if (!this.currentStep || !this.currentStep.districtGroups || this.currentStep.districtGroups.length === 0) {
      return 0;
    }

    const totalStatePopulation = this.statePopulation;
    const stateInfo = this.states.find(s => s.code === this.selectedState);
    if (!stateInfo) {
      return 0;
    }
    
    const totalStateDistricts = stateInfo.districts;
    const targetPopulationPerDistrict = totalStatePopulation / totalStateDistricts;
    
    // Average districts per group
    const avgDistrictsPerGroup = this.currentStep.districtGroups.reduce((sum, g) => sum + g.totalDistricts, 0) / this.currentStep.districtGroups.length;
    
    return targetPopulationPerDistrict * avgDistrictsPerGroup;
  }

  get targetDGPopulationRounded(): number {
    return Math.round(this.targetDGPopulation);
  }

  /**
   * Calculate variance percentage for a district group
   * Variance = ((actual - target) / target) * 100
   * where target = (total state population / total state districts) * group.totalDistricts
   */
  getGroupVariance(group: DistrictGroup): number {
    if (!this.currentStep || !this.currentStep.districtGroups || this.currentStep.districtGroups.length === 0) {
      return 0;
    }

    // Get total state population (sum of all groups)
    const totalStatePopulation = this.statePopulation;
    
    // Get total state districts from states array
    const stateInfo = this.states.find(s => s.code === this.selectedState);
    if (!stateInfo) {
      return 0;
    }
    
    const totalStateDistricts = stateInfo.districts;
    
    // Calculate target population for this group
    const targetPopulationPerDistrict = totalStatePopulation / totalStateDistricts;
    const targetPopulationForGroup = targetPopulationPerDistrict * group.totalDistricts;
    
    // Calculate variance percentage
    const variance = ((group.totalPopulation - targetPopulationForGroup) / targetPopulationForGroup) * 100;
    
    return variance;
  }

  // US View Methods
  private expandedStates: Set<string> = new Set();

  /**
   * Get US data for display in the summary row
   * TODO: Replace with actual data from API/backend
   */
  getUSData(source: '119th' | 'geodistricts' | 'swing', type: 'D' | 'R' | 'value'): string {
    // Placeholder data - replace with actual data
    if (source === 'swing') {
      return '22';
    }
    if (source === '119th') {
      return type === 'D' ? '43' : '22';
    }
    if (source === 'geodistricts') {
      return type === 'D' ? '34' : '22';
    }
    return '0';
  }

  /**
   * Get US data change indicator
   * TODO: Replace with actual data from API/backend
   */
  getUSDataChange(source: '119th' | 'geodistricts', type: 'D' | 'R'): string | null {
    // Placeholder data - replace with actual data
    if (source === '119th' && type === 'D') {
      return '+34';
    }
    if (source === 'geodistricts' && type === 'D') {
      return '+16';
    }
    return null;
  }

  /**
   * Get state data for display in state rows
   * TODO: Replace with actual data from API/backend
   */
  getStateData(stateCode: string, source: '119th' | 'geodistricts' | 'swing', type: 'D' | 'R' | 'value'): string {
    // Placeholder data - replace with actual data
    // For now, return same values as US summary
    if (source === 'swing') {
      return '22';
    }
    if (source === '119th') {
      return type === 'D' ? '43' : '22';
    }
    if (source === 'geodistricts') {
      return type === 'D' ? '34' : '22';
    }
    return '0';
  }

  /**
   * Get state data change indicator
   * TODO: Replace with actual data from API/backend
   */
  getStateDataChange(stateCode: string, source: '119th' | 'geodistricts', type: 'D' | 'R'): string | null {
    // Placeholder data - replace with actual data
    if (source === '119th' && type === 'D') {
      return '+34';
    }
    if (source === 'geodistricts' && type === 'D') {
      return '+16';
    }
    return null;
  }

  /**
   * Get district count for a state
   */
  getStateDistrictCount(stateCode: string): number {
    const state = this.states.find(s => s.code === stateCode);
    return state ? state.districts : 0;
  }

  /**
   * Get state name for a state code
   */
  stateName(stateCode: string): string {
    const state = this.states.find(s => s.code === stateCode);
    return state ? state.name : stateCode;
  }

  /**
   * Check if a flag image exists (for error handling)
   */
  flagExists(flagCode: string): boolean {
    // We'll rely on the onerror handler in the template
    return true;
  }

  /**
   * Toggle state expansion in the US view table
   */
  toggleStateExpansion(stateCode: string): void {
    if (this.expandedStates.has(stateCode)) {
      this.expandedStates.delete(stateCode);
    } else {
      this.expandedStates.add(stateCode);
    }
  }

  /**
   * Check if a state is expanded
   */
  isStateExpanded(stateCode: string): boolean {
    return this.expandedStates.has(stateCode);
  }

  /**
   * Select a state from the US view table
   */
  selectStateFromTable(stateCode: string): void {
    this.selectedState = stateCode;
    this.onStateChange();
  }

  /**
   * Get US row data for StateRowComponent
   */
  getUSRowData(): StateRowData {
    const congressDChangeStr = this.getUSDataChange('119th', 'D');
    const geodistrictsDChangeStr = this.getUSDataChange('geodistricts', 'D');
    const districtCount = this.selectedState === 'ALL' ? this.usMapTotalDistricts : 435;
    return {
      stateCode: 'US',
      stateName: 'United States',
      districts: districtCount,
      congressD: parseInt(this.getUSData('119th', 'D'), 10) || 0,
      congressR: parseInt(this.getUSData('119th', 'R'), 10) || 0,
      congressDChange: congressDChangeStr ? parseInt(congressDChangeStr.replace(/[+-]/g, ''), 10) : undefined,
      geodistrictsD: parseInt(this.getUSData('geodistricts', 'D'), 10) || 0,
      geodistrictsR: parseInt(this.getUSData('geodistricts', 'R'), 10) || 0,
      geodistrictsDChange: geodistrictsDChangeStr ? parseInt(geodistrictsDChangeStr.replace(/[+-]/g, ''), 10) : undefined,
      swing: parseInt(this.getUSData('swing', 'value'), 10) || 0
    };
  }

  /**
   * Get state row data for StateRowComponent
   */
  getStateRowData(stateCode: string) {
    const state = this.states.find((s: { code: string }) => s.code === stateCode);
    const congressDChangeStr = this.getStateDataChange(stateCode, '119th', 'D');
    const geodistrictsDChangeStr = this.getStateDataChange(stateCode, 'geodistricts', 'D');
    return {
      stateCode: stateCode,
      stateName: state?.name,
      districts: state?.districts ?? 0,
      congressD: parseInt(this.getStateData(stateCode, '119th', 'D'), 10) || 0,
      congressR: parseInt(this.getStateData(stateCode, '119th', 'R'), 10) || 0,
      congressDChange: congressDChangeStr ? parseInt(congressDChangeStr.replace(/[+-]/g, ''), 10) : undefined,
      geodistrictsD: parseInt(this.getStateData(stateCode, 'geodistricts', 'D'), 10) || 0,
      geodistrictsR: parseInt(this.getStateData(stateCode, 'geodistricts', 'R'), 10) || 0,
      geodistrictsDChange: geodistrictsDChangeStr ? parseInt(geodistrictsDChangeStr.replace(/[+-]/g, ''), 10) : undefined,
      swing: parseInt(this.getStateData(stateCode, 'swing', 'value'), 10) || 0
    };
  }
}
