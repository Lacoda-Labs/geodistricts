import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, concat, lastValueFrom, of, forkJoin, from, timer } from 'rxjs';
import { concatMap, tap, last, map, catchError, take, finalize, switchMap, filter, timeout } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, GeodistrictOptions, DistrictGroup, DivisionLineInfo, MapPolygonsResponse, MapPolygonsAllResponse, PerGroupStatus, FinalStepResponse } from '../services/geodistrict-algorithm.service';

/** One frame of the US map reveal: state outline or one district. */
type USMapRevealItem =
  | { type: 'state'; stateCode: string; stateOutline: GeoJsonFeature }
  | { type: 'district'; stateCode: string; district: DistrictGroup; districtIndex: number; totalDistricts: number };
import { GeodistrictCacheService } from '../services/geodistrict-cache.service';
import { GeoJsonFeature } from '../services/census.service';
import { CongressionalDistrictsService } from '../services/congressional-districts.service';
import { PageHeaderComponent } from '../components/page-header.component';
import { StateRowComponent, StateRowData } from '../components/state-row.component';
import { StepBtnBarComponent } from '../components/step-btn-bar.component';
import { environment } from '../../environments/environment';

const STATE_COMPARISON_URL = `${environment.apiUrl}/maps/state-comparison`;
const STATE_PARTY_SUMMARIES_URL = `${environment.apiUrl}/maps/state-party-summaries`;

/** Fill opacity for district/tract polygons: 1 = solid when toggle on, 0.8 when toggle off. Toggled by map overlay button. */
const POLYGON_OPACITY_SOLID = 1;
const POLYGON_OPACITY_HALF = 0.8;

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
    MatExpansionModule,
    MatTooltipModule,
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
  /** Polygon fill opacity: 1 when toggle on, 0.8 when toggle off. Toggled by map overlay button. */
  polygonFillOpacity: number = POLYGON_OPACITY_SOLID;
  isLoading: boolean = false;
  errorMessage: string = '';
  canRunNextStep: boolean = false;
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  showSteps: boolean = false;
  isDetectingIsolation: boolean = false;
  isolatedTractIds: Set<string> = new Set(); // Track isolated tract IDs
  isolatedTractsData: { isolatedTractsByGroup: { [groupIndex: string]: string[] }; isolatedTractIds: string[]; groupStats?: Array<{ groupIndex: number; maxReachable: number; totalTracts: number; groupLabel: string }> } | null = null;
  bridgeTractIds: Set<string> = new Set(); // Track bridge tract IDs
  isMovingBridgeTracts: boolean = false;
  isMovingIsolatedTracts: boolean = false;
  isBalancingDistricts: boolean = false;
  /** Shown when Move Isolated Tracts leaves tracts unmoved (no neighbor in target group). */
  moveIsolatedHint: string = '';
  /** Message shown in the map loading overlay (e.g. "Processing Step 2 - dividing by longitude..."). */
  loadingMessage: string = 'Loading district data...';
  isRunningAllSteps: boolean = false;
  bridgeTractsData: { bridgeTractsByIsolatedGroup: { [groupIndex: string]: Array<{tractId: string, fromGroupIndex: number, adjacentIsolatedCount: number}> } } | null = null;
  isDetectingBridge: boolean = false;
  selectedDistrictGroupIndex: number | null = null; // Track selected district group for highlighting
  /** True when this state has precomputed data: step-through uses GET only, no run/execute. */
  isVisualizationOnly: boolean = false;
  /** True when route is /dev/maps: show admin step bar, allow run/execute and isolation/bridge actions. */
  isDevMode: boolean = false;
  /** True when current run uses isolation resolution (perStep/finalStepOnly); hide isolated-tracts UI when false (grid-only). */
  showIsolationResolutionUI: boolean = false;
  /** Collapsible "Step 0 isolated tracts" panel: false = collapsed to preserve real estate */
  step0IsolatedSectionExpanded: boolean = false;
  /** Collapsible "Final step isolated tracts" panel: true = expanded when showing Move isolated tracts */
  finalStepIsolatedSectionExpanded: boolean = true;
  hasShownSorting: boolean = false; // Track if sorting visualization has been shown for current step 0
  isSortingVisualization: boolean = false; // Track if we're currently showing sorting visualization
  /** Census tract list from GET /api/algorithm/census-tracts (dev/maps only). Populated separately from step 0. */
  devTractList: GeoJsonFeature[] | null = null;
  devIslandTractsData: unknown | null = null;
  /** State code for which devTractList is loaded; cleared when selectedState changes. */
  devTractListState: string | null = null;
  isLoadingDevTracts: boolean = false;
  /** Raw slider position 0..sliderMax. Mapped to tract range: when positions < tracts each step = range of tracts; when positions > tracts multiple steps = same tract. */
  sortSliderValue: number = 0;
  readonly sliderMax: number = 1000;
  private map: L.Map | null = null;
  /** State outline polygons for ALL view (below tractLayer). */
  private stateOutlinesLayer: L.LayerGroup | null = null;
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
  isLoadingSteps: boolean = false; // Track if we're currently loading steps (used in template)
  private allTracts: GeoJsonFeature[] = []; // Store all tracts for isolation detection
  private mapToggleControl: L.Control | null = null; // Custom toggle control
  isPlaying: boolean = false; // Track if auto-playing steps
  /** Guard to avoid re-entering runFinalStepToCompletion while move/balance is in flight (prevents play bouncing). */
  private _runningFinalStepCompletion = false;

  /** US map view: states with completed final step and their step data (finalStepNumber for fetching district party). */
  usMapStepDataByState: Array<{ stateCode: string; stepData: GeodistrictStep; finalStepNumber?: number }> = [];
  /** Total district count across completed states (435 when all done) */
  usMapTotalDistricts: number = 0;
  /** State codes that have a completed final step (for table completion indicator) */
  completedStateCodes: Set<string> = new Set();

  /** Per-state, per-district party data for All view (stateCode -> groupKey -> party). Populated after map-polygons-all + district-party fetches. */
  allStatesDistrictPartyByState: Record<string, Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }>> = {};

  /** In-memory cache for All-states map data so returning to ALL view does not refetch 51 states */
  private cachedUSMapStepDataByState: Array<{ stateCode: string; stepData: GeodistrictStep; finalStepNumber?: number }> | null = null;
  private cachedUSMapTotalDistricts: number = 0;
  private cachedUSMapCompletedStateCodes: Set<string> = new Set();

  /** State comparison (119th vs GeoDistricts) for state list; loaded from GET /api/maps/state-comparison */
  stateComparison: { us: { congressD: number; congressR: number; geodistrictsD: number; geodistrictsR: number; swing: number }; states: Record<string, { congressD: number; congressR: number; geodistrictsD: number; geodistrictsR: number; swing: number }> } | null = null;
  /** Per-state party summaries (D/R % and swing) when district party % is calculated; from GET /api/maps/state-party-summaries. Used when All selected. */
  statePartySummaries: Record<string, { pctDem: number; pctRep: number; geodistrictsD: number; geodistrictsR: number; swing: number }> | null = null;

  /** Map-only view: polygons from GET map-polygons (no algorithm run). Null when in step mode or ALL view. */
  mapPolygons: MapPolygonsResponse | null = null;
  /** State code that mapPolygons belong to (prevents rendering wrong state after switch). */
  private mapPolygonsState: string | null = null;

  /** Timestamp when Restart was clicked; used to ignore stale GET final-step responses that arrive after restart. */
  private lastRestartAt = 0;
  private static readonly RESTART_IGNORE_MS = 10000;

  /** Final-step status from GET final-step (for dev/maps summary and table icons). */
  unionPolygonsCached: boolean = false;
  districtPartyPercentagesCalculated: boolean = false;
  perGroupStatus: PerGroupStatus[] = [];
  finalStepMaxIterations: number = 100;
  /** Final step number from API (e.g. 4 for VA); used for district-party-for-group so backend finds correct step. */
  finalStepNumber: number | null = null;
  /** When true, we have triggered district party job and may refetch after delay. */
  districtPartyJobTriggered: boolean = false;
  /** Loading state for single-DG polygon or party trigger (groupKey or null). */
  triggeringForGroupKey: string | null = null;

  /** When true, color tracts by VEST party % (red = R, blue = D, light = 50%). Default on for final step. */
  showPartyColor: boolean = true;
  /** Tract GEOID -> { pctDem } from GET tract-party (for party coloring). */
  tractPartyByGeoid: Record<string, { pctDem: number }> | null = null;
  /** District groupKey -> party data from GET district-party (for map coloring and tooltips). */
  districtPartyByGroupKey: Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }> | null = null;

  // US States with their congressional district counts
  states = [
    { code: 'CA', name: 'California', districts: 52 },
    { code: 'TX', name: 'Texas', districts: 38 },
    { code: 'FL', name: 'Florida', districts: 28 },
    { code: 'NY', name: 'New York', districts: 26 },
    { code: 'IL', name: 'Illinois', districts: 17 },
    { code: 'PA', name: 'Pennsylvania', districts: 17 },
    { code: 'OH', name: 'Ohio', districts: 15 },
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
    { code: 'MS', name: 'Mississippi', districts: 4 },
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
    { code: 'DC', name: 'District of Columbia', districts: 1 },
    { code: 'DE', name: 'Delaware', districts: 1 },
    { code: 'ND', name: 'North Dakota', districts: 1 },
    { code: 'SD', name: 'South Dakota', districts: 1 },
    { code: 'VT', name: 'Vermont', districts: 1 },
    { code: 'WY', name: 'Wyoming', districts: 1 }
  ];

  /** Census 2-digit state FIPS: state code -> FIPS (e.g. CA -> 06). Used for tract list header at step 0. */
  private static readonly stateCodeToFips: Record<string, string> = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11',
    FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21',
    LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30',
    NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
    OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
    VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56'
  };

  constructor(
    private geodistrictService: GeodistrictAlgorithmService,
    private geodistrictCacheService: GeodistrictCacheService,
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private congressionalDistrictsService: CongressionalDistrictsService
  ) {}

  ngOnInit(): void {
    this.isDevMode = this.route.snapshot.data['mode'] === 'development';
    this.route.data.subscribe((data) => {
      this.isDevMode = data['mode'] === 'development';
      if (this.isDevMode) this.isVisualizationOnly = false;
      this.cdr.markForCheck();
    });
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

    // Load state comparison (119th vs GeoDistricts) for state list
    this.http.get<{ us: any; states: Record<string, any> }>(STATE_COMPARISON_URL).pipe(
      catchError(err => {
        console.warn('Maps: state-comparison not available, using placeholders', err?.status || err);
        return of(null);
      })
    ).subscribe(payload => {
      this.stateComparison = payload || null;
      this.rerenderUSMapIfAllView();
      this.cdr.markForCheck();
    });

    // Load state party summaries (for All view: show D/R % and swing when district party % is calculated)
    this.http.get<{ summaries: Record<string, { pctDem: number; pctRep: number; geodistrictsD: number; geodistrictsR: number; swing: number }> }>(STATE_PARTY_SUMMARIES_URL).pipe(
      catchError(() => of({ summaries: {} }))
    ).subscribe(res => {
      this.statePartySummaries = res.summaries && Object.keys(res.summaries).length > 0 ? res.summaries : null;
      this.rerenderUSMapIfAllView();
      this.cdr.markForCheck();
    });
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
          this.loadMapPolygons();
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
          return;
        } else {
          // Map container is different or was removed, need to reinitialize
          console.log('🗺️ Map container changed or removed, reinitializing...');
          this.map.remove();
          this.map = null;
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
        this.updateUSMapPolygonWeights();
      }
    });
    this.map.on('moveend', () => {
      this.updateSliderTrackLength();
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // State outlines (ALL view only, drawn first so below districts)
    this.stateOutlinesLayer = L.layerGroup().addTo(this.map);
    // Geodistricts and tracts
    this.tractLayer = L.layerGroup().addTo(this.map);

    // Add custom toggle control
    this.addMapToggleControl();

    // Update layers based on checkbox state
    this.updateMapLayers();
    
    // Update map view based on selected state
    this.updateMapView();

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
        divisionButton.style.borderBottom = '1px solid rgba(0,0,0,0.1)';

        const divisionIcon = L.DomUtil.create('span', 'material-icons', divisionButton);
        divisionIcon.innerHTML = 'show_chart';
        divisionIcon.style.fontSize = '18px';
        divisionIcon.style.lineHeight = '1';

        // Polygon opacity toggle button (80% vs solid)
        const opacityButton = L.DomUtil.create('a', 'leaflet-control-custom-button', container);
        opacityButton.href = '#';
        opacityButton.title = 'Toggle polygon opacity (80% / solid)';
        opacityButton.style.width = '30px';
        opacityButton.style.height = '30px';
        opacityButton.style.display = 'flex';
        opacityButton.style.alignItems = 'center';
        opacityButton.style.justifyContent = 'center';
        opacityButton.style.textDecoration = 'none';
        opacityButton.style.color = '#333';

        const opacityIcon = L.DomUtil.create('span', 'material-icons', opacityButton);
        opacityIcon.innerHTML = 'opacity';
        opacityIcon.style.fontSize = '18px';
        opacityIcon.style.lineHeight = '1';

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

          if (component.polygonFillOpacity < 1) {
            opacityButton.style.backgroundColor = '#1976d2';
            opacityButton.style.color = 'white';
          } else {
            opacityButton.style.backgroundColor = 'transparent';
            opacityButton.style.color = '#333';
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
          // When turning tracts on, load tract party data so party colors can be used
          if (component.showTractBoundaries && component.selectedState && component.selectedState !== 'ALL' && !component.tractPartyByGeoid) {
            component.geodistrictService.getTractParty(component.selectedState, 2024).subscribe({
              next: (res) => {
                component.tractPartyByGeoid = res.geoids || {};
                component.updateMapLayers();
                component.cdr.markForCheck();
              },
              error: () => { component.tractPartyByGeoid = null; }
            });
          }
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

        // Polygon opacity button click handler (80% vs solid)
        L.DomEvent.on(opacityButton, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          component.polygonFillOpacity = component.polygonFillOpacity === POLYGON_OPACITY_SOLID ? POLYGON_OPACITY_HALF : POLYGON_OPACITY_SOLID;
          component.updateMapLayers();
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
      // Single-district states are not selectable; if we're on one (e.g. from URL/localStorage), show ALL view
      if (this.selectedState !== 'ALL' && this.isSingleDistrictState(this.selectedState)) {
        this.selectedState = 'ALL';
      }
      // Persist selected state to localStorage
      localStorage.setItem('selectedState', this.selectedState);

      // Clear existing layers when switching states
      if (this.tractLayer) {
        this.tractLayer.clearLayers();
      }
      this.tractGeoJsonLayers.clear();
      this.tractIdToLayer.clear();
      this.clearDivisionLines();
      // Clear dev tract list so it is refetched for the new state
      this.devTractList = null;
      this.devIslandTractsData = null;
      this.devTractListState = null;

      if (this.selectedState !== 'ALL') {
        // Save All-states data to cache before clearing so we can restore when switching back
        if (this.usMapStepDataByState.length > 0) {
          this.cachedUSMapStepDataByState = [...this.usMapStepDataByState];
          this.cachedUSMapTotalDistricts = this.usMapTotalDistricts;
          this.cachedUSMapCompletedStateCodes = new Set(this.completedStateCodes);
        }
        // State view: reuse Leaflet map, load map polygons only (no algorithm until user clicks step button)
        this.usMapStepDataByState = [];
        this.usMapTotalDistricts = 0;
        this.completedStateCodes = new Set();
        this.algorithmResult = null;
        this.currentStep = null;
        this.currentStepIndex = 0;
        this.loadedSteps = [];
        this.mapPolygons = null;
        this.mapPolygonsState = null;
        this.isVisualizationOnly = false;
        // Cancel any in-flight requests
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        this.isLoading = false;
        this.isLoadingSteps = false;
        setTimeout(() => {
          this.initializeMap();
          setTimeout(() => {
            this.updateMapView();
            this.loadMapPolygons();
          }, 300);
        }, 100);
      } else {
        // US/ALL view: reuse Leaflet map, fit continental US, show geodistrict polygons
        this.algorithmResult = null;
        this.currentStep = null;
        this.currentStepIndex = 0;
        setTimeout(() => {
          this.updateMapView();
          if (this.cachedUSMapStepDataByState && this.cachedUSMapStepDataByState.length > 0) {
            // Restore from cache so we don't refetch 51 states
            this.usMapStepDataByState = [...this.cachedUSMapStepDataByState];
            this.usMapTotalDistricts = this.cachedUSMapTotalDistricts;
            this.completedStateCodes = new Set(this.cachedUSMapCompletedStateCodes);
            if (this.stateOutlinesLayer) this.stateOutlinesLayer.clearLayers();
            if (this.tractLayer) this.tractLayer.clearLayers();
            this.tractGeoJsonLayers.clear();
            this.tractIdToLayer.clear();
            this.map?.fitBounds(MapsPageComponent.CONTINENTAL_US_BOUNDS, { padding: [24, 24], maxZoom: 10 });
            this.renderUSMapDistricts(this.usMapStepDataByState);
            const statesWithFinalStep = this.usMapStepDataByState.filter((s): s is typeof s & { finalStepNumber: number } =>
              s.finalStepNumber != null && s.finalStepNumber >= 0
            );
            if (statesWithFinalStep.length > 0) {
              const vestYear = 2024;
              forkJoin(
                statesWithFinalStep.map((s) =>
                  this.geodistrictService.getDistrictParty(s.stateCode, s.finalStepNumber, this.finalStepMaxIterations ?? 100, vestYear).pipe(
                    catchError(() => of({ state: s.stateCode, districts: {} as Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }> }))
                  )
                )
              ).subscribe((results) => {
                this.allStatesDistrictPartyByState = {};
                results.forEach((r) => {
                  this.allStatesDistrictPartyByState[r.state] = r.districts ?? {};
                });
                this.renderUSMapDistricts(this.usMapStepDataByState);
                this.cdr.markForCheck();
              });
            }
            this.cdr.markForCheck();
          } else {
            this.loadUSMapDistricts();
          }
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

    if (this.mapPolygons && !this.algorithmResult) {
      this.renderMapPolygons();
      return;
    }

    // When toggling between tracts and union polygons, we need to re-render
    // because we're switching between different geometries
    if (this.algorithmResult && this.currentStep) {
      // Re-render to show either individual tracts or union polygons
      this.renderFinalDistricts();
    } else if (this.tractGeoJsonLayers.size > 0) {
      // Fallback: update existing layer styles if no algorithm result. Border always black.
      this.tractGeoJsonLayers.forEach((districtColor, layer) => {
        layer.setStyle({
          color: '#000000',
          weight: this.showTractBoundaries ? 0.5 : 0.3,
          opacity: 0.8,
          fillOpacity: this.polygonFillOpacity,
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

  /** Line weight for All-states district polygons: thinner when zoomed out, slightly thicker when zoomed in. */
  private getUSMapPolygonWeight(): number {
    if (!this.map || this.selectedState !== 'ALL') return 0.4;
    const z = this.map.getZoom();
    if (z <= 4) return 0.25;
    if (z >= 7) return 0.5;
    return 0.25 + ((z - 4) / 3) * 0.25;
  }

  /** Line weight for All-states state outlines (fixed, thin so they don’t dominate when zoomed out). */
  private static readonly US_MAP_STATE_OUTLINE_WEIGHT = 0.5;

  private updateMapView(): void {
    if (!this.map || !this.selectedState) return;

    if (this.selectedState === 'ALL') {
      this.map.fitBounds(MapsPageComponent.CONTINENTAL_US_BOUNDS, { padding: [24, 24], maxZoom: 10 });
      return;
    }

    const stateCenter = this.getStateCenter(this.selectedState);
    this.map.setView(stateCenter, 5);
  }

  /** Total duration in ms for the US map reveal (state outlines + geodistricts). */
  private static readonly US_MAP_REVEAL_MS = 8000;

  /**
   * Add a single reveal item to the map (state outline on stateOutlinesLayer or district on tractLayer).
   */
  private addUSMapRevealItem(item: USMapRevealItem): void {
    if (!this.map || !this.tractLayer) return;
    const stateName = this.states.find(s => s.code === item.stateCode)?.name || item.stateCode;

    if (item.type === 'state') {
      if (!this.stateOutlinesLayer || !item.stateOutline?.geometry) return;
      try {
        const geoJson = L.geoJSON(item.stateOutline, {
          style: {
            color: '#333',
            weight: MapsPageComponent.US_MAP_STATE_OUTLINE_WEIGHT,
            opacity: 0.9,
            fillOpacity: 0.08,
            fillColor: '#888'
          }
        });
        this.stateOutlinesLayer.addLayer(geoJson);
      } catch (e) {
        console.warn('Error rendering US map state outline:', e);
      }
      return;
    }

    const district = item.district;
    const unionPolygons = (district as any).unionPolygons;
    const hasUnionPolygonsArray = Array.isArray(unionPolygons) && unionPolygons.length > 0;
    const hasSingleUnionPolygon = !hasUnionPolygonsArray && district.unionPolygon?.geometry;
    const polygonsToRender = hasUnionPolygonsArray ? unionPolygons : (hasSingleUnionPolygon ? [district.unionPolygon] : []);
    if (polygonsToRender.length === 0) return;

    const groupKey = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
    const fillColor = this.getUSMapDistrictFillColor(item.stateCode, groupKey);
    const fillOpacity = this.polygonFillOpacity;
    const districtLabel = district.startDistrictNumber === district.endDistrictNumber
      ? `District ${district.startDistrictNumber}` : `Districts ${district.startDistrictNumber}-${district.endDistrictNumber}`;
    const allStatesParty = this.allStatesDistrictPartyByState[item.stateCode]?.[groupKey];
    const popupContent = `<strong>${stateName} ${districtLabel}</strong><br>
      <strong>Population:</strong> ${(district.totalPopulation ?? 0).toLocaleString()}<br>
      <strong>Tracts:</strong> ${district.censusTracts?.length ?? 0}<br>
      ${this.getPopupPartyLine(allStatesParty ?? null)}
      <em>Click to view ${stateName}</em>`;

    const strokeWeight = this.getUSMapPolygonWeight();
    for (const unionPolygon of polygonsToRender) {
      if (!unionPolygon?.geometry) continue;
      try {
        const geoJson = L.geoJSON(unionPolygon, {
          style: {
            color: '#000000',
            weight: strokeWeight,
            opacity: 1,
            fillOpacity,
            fillColor: fillColor
          },
          onEachFeature: (feature, layer) => {
            layer.on('click', () => this.selectStateFromDistrict(item.stateCode));
          }
        }).bindPopup(popupContent);
        (geoJson as any).stateCode = item.stateCode;
        this.tractLayer.addLayer(geoJson);
        this.tractGeoJsonLayers.set(geoJson, fillColor);
      } catch (e) {
        console.warn('Error rendering US map district polygon:', e);
      }
    }
  }

  /**
   * Load district data for US map view.
   * Fetches step0 (state boundary) and final-step geodistrict polygons per state, then animates: state outline first, then each geodistrict per state.
   */
  loadUSMapDistricts(): void {
    if (this.selectedState !== 'ALL' || !this.map || !this.tractLayer) return;
    this.errorMessage = '';
    this.usMapStepDataByState = [];
    this.usMapTotalDistricts = 0;
    this.completedStateCodes = new Set();
    if (this.stateOutlinesLayer) this.stateOutlinesLayer.clearLayers();
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.cdr.markForCheck();

    this.map.fitBounds(MapsPageComponent.CONTINENTAL_US_BOUNDS, { padding: [24, 24], maxZoom: 10 });

    const orderedStateCodes = this.states.map((s) => s.code);
    const sub = this.geodistrictService.getMapPolygonsAll(orderedStateCodes).subscribe({
      next: (response: MapPolygonsAllResponse) => {
        const allStatesData = response.statePolygons.map((entry) => {
          const stepData = this.mapPolygonsResponseToStepData({
            statePolygon: entry.statePolygon,
            finalDistrictPolygons: entry.finalDistrictPolygons,
            hasFinalStep: entry.hasFinalStep ?? false
          });
          return { stateCode: entry.stateCode, stepData, finalStepNumber: entry.finalStepNumber };
        });
        this.usMapStepDataByState = allStatesData;
        this.usMapTotalDistricts = allStatesData.reduce(
          (sum, { stepData: s }) => sum + (s.districtGroups?.length ?? 0),
          0
        );
        this.completedStateCodes = new Set(orderedStateCodes);
        this.allStatesDistrictPartyByState = {};

        const revealItems: USMapRevealItem[] = [];
        for (let i = 0; i < response.statePolygons.length; i++) {
          const { stateCode, statePolygon } = response.statePolygons[i];
          const { stepData } = allStatesData[i];
          if (statePolygon?.geometry) {
            revealItems.push({ type: 'state', stateCode, stateOutline: statePolygon });
          }
          const groups = stepData.districtGroups || [];
          groups.forEach((district, idx) => {
            revealItems.push({ type: 'district', stateCode, district, districtIndex: idx, totalDistricts: groups.length });
          });
        }

        if (revealItems.length === 0) {
          this.cachedUSMapStepDataByState = [...this.usMapStepDataByState];
          this.cachedUSMapTotalDistricts = this.usMapTotalDistricts;
          this.cachedUSMapCompletedStateCodes = new Set(this.completedStateCodes);
          this.cdr.markForCheck();
          return;
        }

        const startReveal = () => {
          const totalMs = MapsPageComponent.US_MAP_REVEAL_MS;
          const revealIntervalMs = Math.max(20, Math.floor(totalMs / revealItems.length));
          const totalTicks = revealItems.length;
          const revealSub = timer(0, revealIntervalMs).pipe(take(totalTicks)).subscribe((index) => {
            this.addUSMapRevealItem(revealItems[index]);
            this.cdr.markForCheck();
            if (index === totalTicks - 1) {
              this.cachedUSMapStepDataByState = [...this.usMapStepDataByState];
              this.cachedUSMapTotalDistricts = this.usMapTotalDistricts;
              this.cachedUSMapCompletedStateCodes = new Set(this.completedStateCodes);
            }
          });
          this.subscriptions.push(revealSub);
        };

        const statesWithFinalStep = allStatesData.filter((s): s is typeof s & { finalStepNumber: number } =>
          s.finalStepNumber != null && s.finalStepNumber >= 0
        );
        if (statesWithFinalStep.length > 0) {
          const vestYear = 2024;
          forkJoin(
            statesWithFinalStep.map((s) =>
              this.geodistrictService.getDistrictParty(s.stateCode, s.finalStepNumber, this.finalStepMaxIterations ?? 100, vestYear).pipe(
                catchError(() => of({ state: s.stateCode, districts: {} as Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }> }))
              )
            )
          ).subscribe((results) => {
            results.forEach((r) => {
              this.allStatesDistrictPartyByState[r.state] = r.districts ?? {};
            });
            this.cdr.markForCheck();
            startReveal();
          });
        } else {
          startReveal();
        }
      },
      error: (err) => {
        this.errorMessage = err?.message || 'Failed to load US map districts';
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.push(sub);
  }

  /**
   * True if the state has only one congressional district. Such states are not selectable and never call algorithm endpoints.
   */
  isSingleDistrictState(stateCode: string): boolean {
    return this.getStateDistrictCount(stateCode) <= 1;
  }

  /**
   * Placeholder step data for a single-district state (no polygons, no API call).
   */
  private placeholderStepDataForSingleDistrictState(): GeodistrictStep {
    return {
      step: 0,
      level: 0,
      districtGroups: [
        {
          startDistrictNumber: 1,
          endDistrictNumber: 1,
          unionPolygon: undefined,
          totalPopulation: 0,
          censusTracts: [],
          totalDistricts: 1,
          bounds: { north: 0, south: 0, east: 0, west: 0 },
          centroid: { lat: 0, lng: 0 }
        }
      ],
      description: '',
      totalGroups: 1,
      totalDistricts: 1,
      divisionDirection: 'latitude'
    };
  }

  /**
   * Convert map-polygons API response to stepData shape for renderUSMapDistricts.
   * Uses final district polygons when available; otherwise uses state outline (step 0) so each state draws something.
   */
  private mapPolygonsResponseToStepData(response: MapPolygonsResponse | null): GeodistrictStep {
    if (response?.finalDistrictPolygons?.length) {
      const districtGroups = response.finalDistrictPolygons.map((polygon, i) => ({
      startDistrictNumber: i + 1,
      endDistrictNumber: i + 1,
      unionPolygon: polygon,
      unionPolygons: [polygon],
      totalPopulation: 0,
      censusTracts: [] as GeoJsonFeature[],
      totalDistricts: 1,
      bounds: { north: 0, south: 0, east: 0, west: 0 },
      centroid: { lat: 0, lng: 0 }
    }));
      return {
        step: 0,
        level: 0,
        districtGroups,
        description: '',
        totalGroups: districtGroups.length,
        totalDistricts: districtGroups.length,
        divisionDirection: 'latitude'
      };
    }
    // No final step: use state outline (step 0) so the state still draws
    const statePolygon = response?.statePolygon;
    if (statePolygon?.geometry) {
      const oneGroup = {
        startDistrictNumber: 1,
        endDistrictNumber: 1,
        unionPolygon: statePolygon,
        unionPolygons: [statePolygon],
        totalPopulation: 0,
        censusTracts: [] as GeoJsonFeature[],
        totalDistricts: 1,
        bounds: { north: 0, south: 0, east: 0, west: 0 },
        centroid: { lat: 0, lng: 0 }
      };
      return {
        step: 0,
        level: 0,
        districtGroups: [oneGroup],
        description: '',
        totalGroups: 1,
        totalDistricts: 1,
        divisionDirection: 'latitude'
      };
    }
    return {
      step: 0,
      level: 0,
      districtGroups: [],
      description: '',
      totalGroups: 0,
      totalDistricts: 0,
      divisionDirection: 'latitude'
    };
  }

  /**
   * Re-render the US map when in ALL view if we have district data (cached or current).
   * Called when stateComparison or statePartySummaries loads so district colors update after async data arrives.
   */
  private rerenderUSMapIfAllView(): void {
    if (this.selectedState !== 'ALL' || !this.map || !this.tractLayer) return;
    const data = this.cachedUSMapStepDataByState?.length
      ? this.cachedUSMapStepDataByState
      : this.usMapStepDataByState;
    if (data?.length) {
      this.renderUSMapDistricts(data);
    }
  }

  /**
   * Render district polygons for US map view (completed states only). Clicking a district switches to that state.
   */
  private renderUSMapDistricts(completedStatesData: Array<{ stateCode: string; stepData: GeodistrictStep }>): void {
    if (!this.map || !this.tractLayer) return;
    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();

    for (const { stateCode, stepData } of completedStatesData) {
      const groups = stepData.districtGroups || [];
      const stateName = this.states.find(s => s.code === stateCode)?.name || stateCode;

      groups.forEach((district, districtIndex) => {
        const unionPolygons = (district as any).unionPolygons;
        const hasUnionPolygonsArray = Array.isArray(unionPolygons) && unionPolygons.length > 0;
        const hasSingleUnionPolygon = !hasUnionPolygonsArray && district.unionPolygon?.geometry;
        const polygonsToRender = hasUnionPolygonsArray ? unionPolygons : (hasSingleUnionPolygon ? [district.unionPolygon] : []);

        if (polygonsToRender.length === 0) return;
        const groupKey = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
        const fillColor = this.getUSMapDistrictFillColor(stateCode, groupKey);
        const fillOpacity = this.polygonFillOpacity;
        const districtLabel = district.startDistrictNumber === district.endDistrictNumber
          ? `District ${district.startDistrictNumber}` : `Districts ${district.startDistrictNumber}-${district.endDistrictNumber}`;
        const allStatesParty = this.allStatesDistrictPartyByState[stateCode]?.[groupKey];
        const popupContent = `<strong>${stateName} ${districtLabel}</strong><br>
          <strong>Population:</strong> ${(district.totalPopulation ?? 0).toLocaleString()}<br>
          <strong>Tracts:</strong> ${district.censusTracts?.length ?? 0}<br>
          ${this.getPopupPartyLine(allStatesParty ?? null)}
          <em>Click to view ${stateName}</em>`;

        const strokeWeight = this.getUSMapPolygonWeight();
        for (const unionPolygon of polygonsToRender) {
          if (!unionPolygon?.geometry) continue;
          try {
            const geoJson = L.geoJSON(unionPolygon, {
              style: {
                color: '#000000',
                weight: strokeWeight,
                opacity: 1,
                fillOpacity,
                fillColor
              },
              onEachFeature: (feature, layer) => {
                layer.on('click', () => this.selectStateFromDistrict(stateCode));
              }
            }).bindPopup(popupContent);
            (geoJson as any).stateCode = stateCode;
            this.tractLayer!.addLayer(geoJson);
            this.tractGeoJsonLayers.set(geoJson, fillColor);
          } catch (e) {
            console.warn('Error rendering US map district polygon:', e);
          }
        }
      });
    }
  }

  /** Update stroke weight on all All-states district layers (call on zoomend so borders thin when zoomed out). */
  private updateUSMapPolygonWeights(): void {
    if (this.selectedState !== 'ALL' || !this.map || this.tractGeoJsonLayers.size === 0) return;
    const w = this.getUSMapPolygonWeight();
    const style: { color: string; weight: number; opacity: number; fillOpacity: number; fillColor: string } = {
      color: '#000000',
      weight: w,
      opacity: 1,
      fillOpacity: this.polygonFillOpacity,
      fillColor: '#888'
    };
    this.tractGeoJsonLayers.forEach((fillColor, layer) => {
      style.fillColor = fillColor;
      (layer as L.LayerGroup).eachLayer((child: L.Layer) => {
        if ('setStyle' in child) (child as L.Path).setStyle(style);
      });
    });
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
    this.loadingMessage = 'Loading district data...';
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
    this.currentStep = null;
    this.totalSteps = 0;
    this.finalStepNumber = null;
    this.districtPartyByGroupKey = null;

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: false,
      forceInvalidate: false,
      maxIterations: 100
    };

    console.log(`🚀 Running all steps with isolation resolution for ${this.selectedState}`);
    this.showIsolationResolutionUI = true;

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
        this.finalStepNumber = result.steps.length > 0 ? result.steps.length - 1 : null;
        
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

  /**
   * Load map polygons only (state outline + optional final districts). No algorithm run.
   * Used for initial state load; algorithm runs only when user clicks a step button.
   */
  loadMapPolygons(): void {
    if (!this.selectedState || this.selectedState === 'ALL' || !this.tractLayer) return;
    if (this.isSingleDistrictState(this.selectedState)) return;

    if (this.stateOutlinesLayer) this.stateOutlinesLayer.clearLayers();
    this.mapPolygons = null;
    this.mapPolygonsState = null;
    this.isLoading = true;
    this.loadingMessage = `Loading ${this.stateName(this.selectedState)} census data`;
    this.errorMessage = '';
    this.cdr.markForCheck();

    const stateRequested = this.selectedState;
    const sub = this.geodistrictService.getMapPolygons(stateRequested).subscribe({
      next: (response) => {
        if (this.selectedState !== stateRequested) return;
        this.mapPolygons = response;
        this.mapPolygonsState = stateRequested;
        this.isVisualizationOnly = !!(response.hasFinalStep) && !this.isDevMode;
        this.isLoading = false;
        this.cdr.markForCheck();
        setTimeout(() => {
          this.renderMapPolygons();
          // When precomputed data exists, load final step so population and district list show. /maps: GET-only (visualization). /dev/maps: same load so sidebar shows data; user can still run/restart.
          if (!this.algorithmResult && this.selectedState && this.selectedState !== 'ALL' && !this.isSingleDistrictState(this.selectedState)) {
            if (this.isVisualizationOnly || this.isDevMode) {
              this.loadVisualizationState();
            }
          }
        }, 100);
      },
      error: (err) => {
        this.errorMessage = err.message || 'Failed to load map polygons';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.push(sub);
  }

  /**
   * Load final step and step list via GET only (visualization mode). Used when map-polygons hasFinalStep is true.
   */
  loadVisualizationState(): void {
    if (!this.selectedState || this.selectedState === 'ALL' || !this.tractLayer) return;
    const stateRequested = this.selectedState;
    this.districtPartyJobTriggered = false;
    this.isLoading = true;
    this.loadingMessage = `Loading step data for ${this.stateName(stateRequested)}`;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.loadedSteps = [];
    this.algorithmResult = null;
    this.currentStep = null;
    this.currentStepIndex = 0;
    this.totalSteps = 0;
    this.finalStepNumber = null;
    this.districtPartyByGroupKey = null;
    const sub = this.geodistrictService.getFinalStep(stateRequested).subscribe({
      next: (resp: FinalStepResponse) => {
        const { step: stepIndex, data, isComplete } = resp;
        if (this.selectedState !== stateRequested) return;
        if (!data?.districtGroups?.length) {
          this.isLoading = false;
          this.isLoadingSteps = false;
          this.errorMessage = 'Final step data is incomplete';
          this.cdr.markForCheck();
          return;
        }
        this.loadedSteps[stepIndex] = data;
        this.currentStepIndex = stepIndex;
        this.currentStep = data;
        this.totalSteps = stepIndex + 1;
        this.finalStepNumber = resp.step;
        this.algorithmResult = {
          finalDistricts: data.districtGroups,
          steps: [data],
          totalPopulation: data.districtGroups.reduce((sum, g) => sum + g.totalPopulation, 0),
          averagePopulation: 0,
          populationVariance: 0,
          algorithmHistory: [],
          maxIterations: resp.maxIterations ?? 100
        };
        this.unionPolygonsCached = resp.unionPolygonsCached === true;
        this.districtPartyPercentagesCalculated = resp.districtPartyPercentagesCalculated === true;
        this.perGroupStatus = resp.perGroupStatus ?? [];
        this.finalStepMaxIterations = resp.maxIterations ?? 100;
        if (resp.districtPartyPercentagesCalculated === true && this.selectedState === stateRequested && this.finalStepNumber != null) {
          this.fetchDistrictPartyForCurrentStep();
        } else {
          this.districtPartyByGroupKey = null;
        }
        this.isLoading = false;
        this.isLoadingSteps = false;
        if (data.isolatedTractsData) {
          this.isolatedTractIds = new Set(data.isolatedTractsData.isolatedTractIds || []);
          this.isolatedTractsData = {
            isolatedTractsByGroup: data.isolatedTractsData.isolatedTractsByGroup || {},
            isolatedTractIds: data.isolatedTractsData.isolatedTractIds || []
          };
          if ((data.isolatedTractsData.isolatedTractIds?.length ?? 0) > 0) {
            this.finalStepBalancingComplete = false;
          }
        } else {
          this.isolatedTractIds.clear();
          this.isolatedTractsData = null;
        }
        if (isComplete && !(this.isolatedTractsData?.isolatedTractIds?.length)) {
          this.finalStepBalancingComplete = true;
        }
        if (isComplete && !this.districtPartyPercentagesCalculated && !this.districtPartyJobTriggered) {
          this.districtPartyJobTriggered = true;
          this.geodistrictService.triggerDistrictPartyJob(stateRequested, stepIndex, this.finalStepMaxIterations).subscribe({
            next: () => {},
            error: () => {},
            complete: () => {
              setTimeout(() => this.refetchFinalStepForStatus(stateRequested), 3000);
            }
          });
        }
        this.cdr.markForCheck();
        setTimeout(() => {
          this.renderFinalDistricts();
          this.loadAllPreviousSteps(stepIndex);
        }, 100);
      },
      error: (err) => {
        if (this.selectedState !== stateRequested) return;
        this.errorMessage = err?.message || 'Failed to load step data';
        this.isLoading = false;
        this.isLoadingSteps = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.push(sub);
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
    if (this.isSingleDistrictState(this.selectedState)) {
      this.errorMessage = 'This state has only one district; the algorithm is not run for single-district states';
      return;
    }

    // Clear map layers FIRST to prevent showing wrong state's data
    if (this.tractLayer) {
      this.tractLayer.clearLayers();
    }
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.clearDivisionLines();

    // Reset state (leave map-only view, enter step mode)
    this.mapPolygons = null;
    this.mapPolygonsState = null;
    this.isLoading = true;
    this.loadingMessage = `Loading ${this.stateName(this.selectedState)} census data`;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
        this.currentStep = null;
        this.totalSteps = 0;
        this.finalStepNumber = null;
        this.districtPartyByGroupKey = null;
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
    this.showIsolationResolutionUI = false;

    // Initialize algorithm and load step 0 (or final step if available)
    const subscription = this.geodistrictService.initializeAlgorithm(options).subscribe({
      next: (stepData) => {
        const { step, stepIndex, isComplete } = stepData;
        
        // Ignore stale final-step response that arrives after Restart (e.g. GET final-step returned late)
        if (this.lastRestartAt && (Date.now() - this.lastRestartAt) < MapsPageComponent.RESTART_IGNORE_MS &&
            stepIndex > 0 && isComplete) {
          console.log(`⚠️ Ignoring stale final-step ${stepIndex} (restart was ${Date.now() - this.lastRestartAt}ms ago)`);
          this.isLoading = false;
          this.isLoadingSteps = false;
          return;
        }
        
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
          this.finalStepNumber = stepIndex;
          this.isLoadingSteps = false;
          console.log(`✅ Loaded final step ${stepIndex} for ${this.selectedState}`);
          
          // Load all previous steps to get their division lines
          this.loadAllPreviousSteps(stepIndex);
        }
        
        // Always run isolation detection at each step (step > 0); do not use cached isolation data
        this.isolatedTractIds.clear();
        this.isolatedTractsData = null;
        if (stepIndex > 0 && step.districtGroups?.length) {
          this.detectIsolatedTracts();
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

        // Dev/maps at step 0: populate tract list from dedicated census-tracts endpoint
        if (this.isDevMode && stepIndex === 0) {
          this.ensureDevTractListLoaded();
        }
        
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

  /** Expected total steps for the selected state (N districts => N steps, indices 0..N-1). */
  getExpectedTotalSteps(): number {
    if (!this.selectedState || this.selectedState === 'ALL') return 0;
    return this.congressionalDistrictsService.getDistrictsForState(this.selectedState) ?? 0;
  }

  getTotalSteps(): number {
    const loaded = this.loadedSteps.filter(s => s !== undefined && s !== null).length;
    const expected = this.getExpectedTotalSteps() || 0;
    return Math.max(this.totalSteps, loaded, expected);
  }

  /** Display total = number of division levels (tree depth), ceil(log2(N)) for N districts. */
  getDisplayTotalSteps(): number {
    const N = this.getExpectedTotalSteps() || 0;
    if (N <= 1) return 0;
    return Math.max(0, Math.ceil(Math.log2(N)));
  }

  /** Display current step = level for current backend step (by number of district groups). */
  getDisplayStepIndex(): number {
    const numGroups = this.currentStep?.districtGroups?.length ?? (this.currentStepIndex + 1);
    const total = this.getDisplayTotalSteps();
    if (numGroups <= 0) return 0;
    const level = Math.ceil(Math.log2(numGroups));
    return Math.min(total, Math.max(0, level));
  }

  /**
   * Clear all algorithm cache for the selected state (trash) and reload step 0 from cache.
   * Calls backend to delete algorithm step cache and algorithm state from storage; does not touch external data.
   * Then loads step 0 via step-by-step without forceInvalidate (uses existing external caches).
   */
  forceRefreshAndReset(): void {
    if (!this.selectedState || this.selectedState === 'ALL') {
      this.errorMessage = 'Please select a state first';
      return;
    }
    const state = this.selectedState;
    const maxIterations = 100;
    const backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';
    const clearCacheUrl = `${backendUrl}/api/algorithm/clear-cache`;
    this.isLoadingSteps = true;
    this.isLoading = true;
    this.loadingMessage = 'Clearing cache...';
    console.log(`🗑️ Clear cache (trash): deleting algorithm cache for ${state}, then reloading step 0...`);
    this.http.post<{ ok: boolean; message?: string }>(clearCacheUrl, { state, maxIterations }, { headers: { 'Content-Type': 'application/json' } }).subscribe({
      next: () => {
        console.log(`✅ Algorithm cache cleared for ${state}, reloading step 0 (no external refetch)...`);
        this.resetToStartWithOptions(false);
      },
      error: (err) => {
        this.errorMessage = err?.message || 'Failed to clear algorithm cache';
        this.isLoadingSteps = false;
        this.isLoading = false;
        console.error('Clear cache failed:', err);
      }
    });
  }

  /**
   * Restart algorithm: delete step 1+ and algorithm state from backend, keep step 0, set state to iteration 0.
   * Then reload step 0 in the UI (from cache; no external refetch).
   */
  resetToStart(): void {
    if (!this.selectedState || this.selectedState === 'ALL') {
      this.errorMessage = 'Please select a state first';
      return;
    }
    // Cancel any in-flight algorithm requests (e.g. GET final-step from initial load) so a late
    // response cannot overwrite step 0 after we load it from step-by-step.
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    this.lastRestartAt = Date.now();

    const state = this.selectedState;
    const maxIterations = 100;
    const backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';
    const restartUrl = `${backendUrl}/api/algorithm/restart`;
    this.isLoadingSteps = true;
    this.isLoading = true;
    this.loadingMessage = 'Restarting...';
    console.log(`🔄 Restart: clearing step 1+ and algorithm state for ${state}, then loading step 0...`);
    this.http.post<{ ok: boolean; message?: string }>(restartUrl, { state, maxIterations }, { headers: { 'Content-Type': 'application/json' } }).subscribe({
      next: () => {
        console.log(`✅ Restart complete for ${state}, loading step 0...`);
        this.resetToStartWithOptions(false);
      },
      error: (err) => {
        this.errorMessage = err?.message || 'Failed to restart';
        this.isLoadingSteps = false;
        this.isLoading = false;
        console.error('Restart failed:', err);
      }
    });
  }

  private resetToStartWithOptions(forceInvalidate: boolean): void {
    if (!this.selectedState || this.selectedState === 'ALL') return;

    console.log(`🔄 Resetting to step 0 for ${this.selectedState}${forceInvalidate ? ' (force invalidate)' : ''}...`);

    // Clear map layers
    if (this.tractLayer) {
      this.tractLayer.clearLayers();
    }
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.clearDivisionLines();

    // Reset state (step mode)
    this.mapPolygons = null;
    this.mapPolygonsState = null;
    this.isLoading = true;
    this.loadingMessage = `Loading ${this.stateName(this.selectedState)} census data`;
    this.isLoadingSteps = true;
    this.errorMessage = '';
    this.algorithmResult = null;
    this.loadedSteps = [];
    this.currentStepIndex = 0;
        this.currentStep = null;
        this.totalSteps = 0;
        this.finalStepNumber = null;
        this.districtPartyByGroupKey = null;
        this.isolatedTractIds.clear();
    this.isolatedTractsData = null;
    this.bridgeTractIds.clear();
    this.bridgeTractsData = null;
    this.showIsolationResolutionUI = false;
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

    console.log(`🚀 Reloading step 0 for ${this.selectedState}${forceInvalidate ? ' (force invalidate)' : ' (using cache when available)'}`);

    // Call step-by-step endpoint to get step 0
    const subscription = this.http.post<{
      step: number;
      data: GeodistrictStep;
      isComplete: boolean;
    }>(executeUrl, {
      state: this.selectedState,
      maxIterations: 100,
      options: {
        forceInvalidate
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
          this.finalStepNumber = stepIndex;
          this.isLoadingSteps = false;
          console.log(`✅ Loaded final step ${stepIndex} for ${this.selectedState}`);
          
          // Load all previous steps to get their division lines
          this.loadAllPreviousSteps(stepIndex);
        } else {
          // For step 0, we're not complete yet
          this.isLoadingSteps = false;
        }
        
        // Always run isolation detection at each step (step > 0); do not use cached isolation data
        this.isolatedTractIds.clear();
        this.isolatedTractsData = null;
        if (stepIndex > 0 && step.districtGroups?.length) {
          this.detectIsolatedTracts();
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
    // Visualization-only (/maps): enable Next only when we have precomputed steps and more steps exist
    if (this.isVisualizationOnly) {
      const nextIndex = this.currentStepIndex + 1;
      return nextIndex < this.totalSteps && !this.isLoading;
    }
    // Map-only view: on /dev/maps enable Next to run algorithm; on /maps disable
    if (this.mapPolygons && !this.algorithmResult && this.selectedState && this.selectedState !== 'ALL') {
      return this.isDevMode && !this.isLoading;
    }
    // Next is enabled regardless of isolated tracts (grid-only default; isolation is informational)
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

  /** True when current step is the final step (all single-district groups). Used to show final-step actions. */
  get isFinalStepActive(): boolean {
    if (!this.isDevMode || !this.currentStep?.districtGroups?.length) return false;
    return this.currentStep.districtGroups.every(g => g.totalDistricts === 1);
  }

  /** True when we're at the final step structure (all single-district groups). Used for play-to-completion flow regardless of dev mode. */
  private get atFinalStepForPlay(): boolean {
    return !!(this.currentStep?.districtGroups?.length && this.currentStep.districtGroups.every((g: any) => g.totalDistricts === 1));
  }

  /** True when there are isolated tracts to resolve (for Move button at final step). */
  get hasUnresolvedIsolation(): boolean {
    return !!(this.isolatedTractsData?.isolatedTractIds?.length);
  }

  /** True when balance can no longer improve variances (or final step was loaded as complete). Hides Balance button. */
  finalStepBalancingComplete: boolean = false;
  /** Label for play-at-final-step phase: Move isolated tracts, Balance tracts, or State geodistricting complete. */
  finalStepPhaseLabel: string = '';

  /** Sync component isolation state from currentStep so final-step Move/Balance buttons reflect this step. */
  private syncIsolationFromCurrentStep(): void {
    const data = this.currentStep?.isolatedTractsData;
    const ids = data?.isolatedTractIds;
    if (ids && Array.isArray(ids) && ids.length > 0) {
      this.isolatedTractIds = new Set(ids);
      this.isolatedTractsData = {
        isolatedTractsByGroup: data.isolatedTractsByGroup || {},
        isolatedTractIds: ids
      };
    } else {
      this.isolatedTractIds.clear();
      this.isolatedTractsData = null;
    }
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
        this.syncIsolationFromCurrentStep();
        this.moveIsolatedHint = '';
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
        this.isLoadingSteps = true;
        this.isLoading = true;
        this.loadingMessage = 'Loading district data...';
        
        const options: GeodistrictOptions = {
          state: this.selectedState,
          useDirectAPI: false,
          forceInvalidate: false,
          maxIterations: 100,
        };

        const subscription = this.geodistrictService.getStep(this.selectedState, prevIndex, 100, this.isVisualizationOnly ? { polygonsOnly: true } : undefined).subscribe({
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
            
            // Always run isolation detection at each step (step > 0); do not use cached isolation data
            this.isolatedTractIds.clear();
            this.isolatedTractsData = null;
            if ((newStep as any).step > 0 && (newStep as any).districtGroups?.length) {
              this.detectIsolatedTracts();
            }
            
            this.bridgeTractIds.clear();
            this.bridgeTractsData = null;
            this.isLoadingSteps = false;
            this.isLoading = false;

            // Update algorithmResult
            if (this.algorithmResult) {
              this.algorithmResult.steps = this.loadedSteps.filter(s => s !== undefined);
              this.algorithmResult.finalDistricts = (newStep as any).districtGroups;
            }

            // Render the step on map (default: tracts with blended borders if no unions)
            setTimeout(() => {
              this.renderFinalDistricts();
            }, 100);

            // Optionally fetch step union polygons; if available, merge and re-render
            const unionSub = this.geodistrictService.getStepUnionPolygons(this.selectedState, stepIndex, 100).subscribe({
              next: (body) => {
                if (body && this.currentStep && (this.currentStep as any).step === stepIndex) {
                  this.mergeUnionPolygonsIntoStep(this.currentStep as any, body);
                  this.renderFinalDistricts();
                }
              }
            });
            this.subscriptions.push(unionSub);
          },
          error: (error) => {
            this.errorMessage = error.message || `Failed to load step ${prevIndex}`;
            this.isLoadingSteps = false;
            this.isLoading = false;
            console.error(`Previous step ${prevIndex} load error:`, error);
          }
        });

        this.subscriptions.push(subscription);
      }
    }
  }

  /**
   * Merge union polygon data from GET union-polygons into current step district groups (match by start/end district number).
   */
  private mergeUnionPolygonsIntoStep(
    step: GeodistrictStep,
    payload: { districtGroups: Array<{ startDistrictNumber: number; endDistrictNumber: number; unionPolygon?: GeoJsonFeature; unionPolygons?: GeoJsonFeature[] }> }
  ): void {
    if (!step.districtGroups || !payload.districtGroups?.length) return;
    const key = (g: { startDistrictNumber: number; endDistrictNumber: number }) =>
      `${g.startDistrictNumber}-${g.endDistrictNumber}`;
    const unionMap = new Map(payload.districtGroups.map(g => [key(g), g]));
    for (const group of step.districtGroups) {
      const u = unionMap.get(key(group));
      if (u) {
        (group as any).unionPolygon = u.unionPolygon;
        (group as any).unionPolygons = u.unionPolygons;
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
        const subscription = this.geodistrictService.getStep(this.selectedState, stepIdx, 100, this.isVisualizationOnly ? { polygonsOnly: true } : undefined).subscribe({
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
    // Map-only view: on /dev/maps run algorithm; on /maps never run.
    if (this.mapPolygons && !this.algorithmResult && this.selectedState && this.selectedState !== 'ALL') {
      if (this.isDevMode) {
        this.runAlgorithm();
      }
      return;
    }

    const nextIndex = this.currentStepIndex + 1;
    const step = this.loadedSteps[nextIndex];
    
    if (step) {
      // Step already loaded, just display it
      this.currentStepIndex = nextIndex;
      this.currentStep = step;
      this.syncIsolationFromCurrentStep();
      this.selectedDistrictGroupIndex = null; // Clear selection when changing steps
      this.sortSliderValue = 0;
    this.cachedSortedTractIds = [];
    this.cachedSortedTractIdsKey = '';
    this.cachedSortedTractEntries = [];
    this.cachedNorthPrefixSum = [];
    this.cachedSortedTractEntriesByDg.clear();
      this.isLoading = false;
      this.isLoadingSteps = false;
      this.renderFinalDistricts();
      setTimeout(() => this.onStepDisplayComplete(), 0);
    } else if (this.isVisualizationOnly) {
      // Visualization mode: fetch step via GET only
      console.log(`📥 Loading step ${nextIndex} (GET)...`);
      this.isLoadingSteps = true;
      this.isLoading = true;
      this.loadingMessage = `Loading step ${nextIndex}...`;
      const stateRequested = this.selectedState;
      const sub = this.geodistrictService.getStep(stateRequested, nextIndex, 100, { polygonsOnly: true }).subscribe({
        next: (stepData) => {
          if (this.selectedState !== stateRequested) {
            this.isLoadingSteps = false;
            this.isLoading = false;
            return;
          }
          const { step: newStep, isComplete } = stepData;
          if (!newStep?.districtGroups?.length) {
            this.isLoadingSteps = false;
            this.isLoading = false;
            return;
          }
          // Store at requested index so play doesn't overwrite wrong slot if API returns different stepIndex
          this.loadedSteps[nextIndex] = newStep;
          this.currentStepIndex = nextIndex;
          this.currentStep = newStep;
          this.selectedDistrictGroupIndex = null;
          this.sortSliderValue = 0;
          this.cachedSortedTractIds = [];
          this.cachedSortedTractIdsKey = '';
          this.cachedSortedTractEntries = [];
          this.cachedNorthPrefixSum = [];
          this.cachedSortedTractEntriesByDg.clear();
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.renderFinalDistricts();
          this.cdr.markForCheck();
          this.onStepDisplayComplete();
        },
        error: () => {
          if (this.selectedState === stateRequested) {
            this.isLoadingSteps = false;
            this.isLoading = false;
          }
          this.cdr.markForCheck();
        }
      });
      this.subscriptions.push(sub);
    } else {
      // Dev mode (or legacy): request step from backend via POST execute next step
      console.log(`🚀 Requesting step ${nextIndex} from backend...`);
      this.isLoadingSteps = true;
      this.isLoading = true;
      this.loadingMessage = nextIndex === 0
        ? 'Loading initial state...'
        : `Processing Step ${nextIndex} - dividing by ${nextIndex % 2 === 1 ? 'latitude' : 'longitude'}...`;
      
      const options: GeodistrictOptions = {
        state: this.selectedState,
        useDirectAPI: false,
        forceInvalidate: false,
        maxIterations: 100,
      };
      this.showIsolationResolutionUI = false;

      const subscription = this.geodistrictService.executeNextStep(options).subscribe({
        next: (stepData) => {
          const { step: newStep, stepIndex, isComplete } = stepData;
          
          // Ignore response if user switched state during the long-running request (e.g. CA next-step
          // took a long time and they selected AZ); prevents showing wrong state's districts.
          if (this.selectedState !== options.state) {
            console.warn(`⚠️ State changed during next-step load: was loading ${options.state}, now selected ${this.selectedState}. Ignoring response.`);
            this.isLoading = false;
            this.loadingMessage = 'Loading district data...';
            this.isLoadingSteps = false;
            return;
          }
          
          // Handle case where algorithm completes and newStep is null
          if (isComplete && !newStep) {
            console.log(`✅ Algorithm completed at step ${stepIndex}, no new step data`);
            // Use the last step if available, or show completion message
            if (this.currentStep) {
              console.log(`📥 Using current step as final step`);
              this.isLoading = false; // Stop loading spinner
              this.loadingMessage = 'Loading district data...';
              this.isLoadingSteps = false;
              this.totalSteps = this.loadedSteps.filter(s => s !== undefined).length;
              this.onStepDisplayComplete(); // Stop play at final step
              return; // Keep current step displayed
            } else {
              console.warn(`⚠️ Algorithm completed but no step data available`);
              this.isLoading = false; // Stop loading spinner
              this.loadingMessage = 'Loading district data...';
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
            this.loadingMessage = 'Loading district data...';
            this.isLoadingSteps = false;
            return;
          }

          // Store the step
          this.loadedSteps[stepIndex] = stepToUse as any;
          
          // Display the step
          this.currentStepIndex = stepIndex;
          this.currentStep = stepToUse as any;
          this.selectedDistrictGroupIndex = null; // Clear selection when loading new step
          
          // Always run isolation detection at each step (step > 0); do not use cached isolation data
          this.isolatedTractIds.clear();
          this.isolatedTractsData = null;
          this.bridgeTractIds.clear();
          this.bridgeTractsData = null;
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.loadingMessage = 'Loading district data...';

          // Update algorithmResult
          if (this.algorithmResult) {
            this.algorithmResult.steps = this.loadedSteps.filter(s => s !== undefined);
            this.algorithmResult.finalDistricts = (stepToUse as any).districtGroups;
          }

          const isFinalStep = isComplete && (stepToUse as any).districtGroups?.every((g: any) => g.totalDistricts === 1);
          if (isFinalStep && (stepToUse as any).districtGroups?.length) {
            this.finalStepNumber = stepIndex;
            this.detectIsolatedTracts(() => {
              this.renderFinalDistricts();
              this.onStepDisplayComplete();
            });
          } else {
            if ((stepToUse as any).step > 0 && (stepToUse as any).districtGroups?.length) {
              this.detectIsolatedTracts();
            }
            setTimeout(() => {
              this.renderFinalDistricts();
              this.onStepDisplayComplete();
            }, 100);
          }

          // If complete, update total steps
          if (isComplete) {
            this.totalSteps = this.loadedSteps.filter(s => s !== undefined).length;
            console.log(`✅ Algorithm completed: ${this.totalSteps} total steps`);
          }
        },
        error: (error) => {
          this.errorMessage = error.message || 'An error occurred while executing the next step';
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.loadingMessage = 'Loading district data...';
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
    // Visualization-only: load step 0 via GET if not loaded
    if (this.isVisualizationOnly) {
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
        const stateRequested = this.selectedState;
        this.isLoadingSteps = true;
        this.isLoading = true;
        // In dev mode request full step (no polygonsOnly) so tract list has censusTracts
        const stepOptions = this.isDevMode ? undefined : { polygonsOnly: true };
        const sub = this.geodistrictService.getStep(stateRequested, 0, 100, stepOptions).subscribe({
          next: (stepData) => {
            if (this.selectedState !== stateRequested) { this.isLoadingSteps = false; this.isLoading = false; return; }
            const { step: newStep, stepIndex } = stepData;
            if (newStep) {
              this.loadedSteps[stepIndex] = newStep;
              this.currentStepIndex = 0;
              this.currentStep = newStep;
              this.selectedDistrictGroupIndex = null;
              this.isolatedTractIds.clear();
              this.isolatedTractsData = null;
              this.bridgeTractIds.clear();
              this.bridgeTractsData = null;
              this.renderFinalDistricts();
            }
            this.isLoadingSteps = false;
            this.isLoading = false;
            this.cdr.markForCheck();
          },
          error: () => { if (this.selectedState === stateRequested) { this.isLoadingSteps = false; this.isLoading = false; } this.cdr.markForCheck(); }
        });
        this.subscriptions.push(sub);
      }
      return;
    }
    // Map-only view: on /dev/maps run algorithm to load step 0; on /maps do nothing
    if (this.mapPolygons && !this.algorithmResult) {
      if (this.isDevMode) {
        this.runAlgorithm();
      }
      return;
    }
    // Go to step 0
    let step = this.loadedSteps[0];
    if (step) {
      this.currentStepIndex = 0;
      this.currentStep = step;
      this.syncIsolationFromCurrentStep();
      this.selectedDistrictGroupIndex = null;
      this.bridgeTractIds.clear();
      this.bridgeTractsData = null;
      this.renderFinalDistricts();
      // Dev: ensure tract list is populated from census-tracts endpoint if not yet loaded for this state
      if (this.isDevMode && this.selectedState && this.selectedState !== 'ALL' && (this.devTractListState !== this.selectedState || this.devTractList === null)) {
        this.ensureDevTractListLoaded();
      }
    } else if (this.isDevMode) {
      // Step 0 not in cache: ensure we request tract list so it appears when census-tracts returns
      // Dev mode: fetch step 0 with polygonsOnly (light) for map; tract list from GET census-tracts
      const stateRequested = this.selectedState;
      this.isLoadingSteps = true;
      this.isLoading = true;
      this.loadingMessage = 'Loading step 0...';
      const stepOptions = { polygonsOnly: true };
      const sub = this.geodistrictService.getStep(stateRequested, 0, 100, stepOptions).subscribe({
        next: (stepData) => {
          if (this.selectedState !== stateRequested) { this.isLoadingSteps = false; this.isLoading = false; return; }
          const { step: newStep, stepIndex } = stepData;
          if (newStep?.districtGroups?.length) {
            this.loadedSteps[stepIndex] = newStep;
            this.currentStepIndex = 0;
            this.currentStep = newStep;
            this.syncIsolationFromCurrentStep();
            this.selectedDistrictGroupIndex = null;
            this.bridgeTractIds.clear();
            this.bridgeTractsData = null;
            this.renderFinalDistricts();
          } else {
            this.resetToStart();
          }
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.loadingMessage = '';
          this.cdr.markForCheck();
        },
        error: () => {
          if (this.selectedState === stateRequested) {
            this.resetToStart();
            this.isLoadingSteps = false;
            this.isLoading = false;
            this.loadingMessage = '';
          }
          this.cdr.markForCheck();
        }
      });
      this.subscriptions.push(sub);
      // Populate tract list from dedicated census-tracts endpoint (separate from step 0)
      console.log(`📋 Dev/maps: loading census tract list for ${stateRequested} (goToFirstStep)`);
      this.isLoadingDevTracts = true;
      const tractSub = this.geodistrictService.getCensusTracts(stateRequested).subscribe({
        next: (data) => {
          if (this.selectedState !== stateRequested) { this.isLoadingDevTracts = false; return; }
          this.devTractList = data.tracts ?? [];
          this.devIslandTractsData = data.islandTractsData ?? null;
          this.devTractListState = stateRequested;
          this.isLoadingDevTracts = false;
          console.log(`📋 Dev/maps: census tract list loaded for ${stateRequested}: ${this.devTractList.length} tracts`);
          this.cdr.markForCheck();
        },
        error: () => {
          if (this.selectedState === stateRequested) {
            console.warn(`📋 Dev/maps: failed to load census tract list for ${stateRequested}`);
            this.devTractList = null;
            this.devIslandTractsData = null;
            this.devTractListState = null;
            this.isLoadingDevTracts = false;
            this.cdr.markForCheck();
          }
        }
      });
      this.subscriptions.push(tractSub);
    } else {
      // Step 0 not loaded, reset to start
      this.resetToStart();
    }
  }

  /**
   * Call from template when step 0 tract list block is visible but empty; triggers load so IN (and others) get tracts.
   * No-op if not dev, already loaded, or already loading. Idempotent. Returns true so *ngIf can show the block.
   */
  ensureTractListLoadTrigger(): boolean {
    this.ensureDevTractListLoaded();
    return true;
  }

  /**
   * Fetch census tract list from GET /api/algorithm/census-tracts for current state (dev/maps only).
   * No-op if not dev, no state, or already loaded for this state.
   */
  private ensureDevTractListLoaded(): void {
    if (!this.isDevMode || !this.selectedState || this.selectedState === 'ALL' || this.isLoadingDevTracts) return;
    if (this.devTractListState === this.selectedState && this.devTractList != null) return;
    const stateRequested = this.selectedState;
    console.log(`📋 Dev/maps: loading census tract list for state ${stateRequested} from census-tracts endpoint`);
    this.isLoadingDevTracts = true;
    const sub = this.geodistrictService.getCensusTracts(stateRequested).subscribe({
      next: (data) => {
        if (this.selectedState !== stateRequested) { this.isLoadingDevTracts = false; return; }
        this.devTractList = data.tracts ?? [];
        this.devIslandTractsData = data.islandTractsData ?? null;
        this.devTractListState = stateRequested;
        this.isLoadingDevTracts = false;
        console.log(`📋 Dev/maps: census tract list loaded for ${stateRequested}: ${this.devTractList.length} tracts`);
        this.cdr.markForCheck();
      },
      error: () => {
        if (this.selectedState === stateRequested) {
          console.warn(`📋 Dev/maps: failed to load census tract list for ${stateRequested}`);
          this.devTractList = null;
          this.devIslandTractsData = null;
          this.devTractListState = null;
          this.isLoadingDevTracts = false;
          this.cdr.markForCheck();
        }
      }
    });
    this.subscriptions.push(sub);
  }

  goToLastStep(): void {
    // Prefer final step index from backend when known; otherwise derive from total steps
    const lastIndex = this.finalStepNumber ?? (this.getTotalSteps() - 1);
    if (lastIndex < 0 || this.currentStepIndex === lastIndex) {
      return; // Already at last step or no steps available
    }

    const step = this.loadedSteps[lastIndex];
    if (step) {
      this.currentStepIndex = lastIndex;
      this.currentStep = step;
      this.syncIsolationFromCurrentStep();
      this.selectedDistrictGroupIndex = null;
      this.bridgeTractIds.clear();
      this.bridgeTractsData = null;
      this.renderFinalDistricts();
    } else {
      // Last step not loaded: fetch it from the backend
      if (!this.selectedState || this.selectedState === 'ALL') {
        return;
      }
      console.log('Last step not loaded yet. Loading final step from backend...');
      this.isLoadingSteps = true;
      this.isLoading = true;
      this.loadingMessage = 'Loading final step...';
      this.cdr.markForCheck();
      const sub = this.geodistrictService.getFinalStep(this.selectedState).subscribe({
        next: ({ step: stepIndex, data, isComplete }) => {
          if (this.selectedState === 'ALL' || !data?.districtGroups?.length) {
            this.isLoadingSteps = false;
            this.isLoading = false;
            this.loadingMessage = '';
            if (!data?.districtGroups?.length) {
              this.errorMessage = 'Final step data is incomplete';
            }
            this.cdr.markForCheck();
            return;
          }
          // Use step index from API response so we store at the correct index
          const idx = stepIndex;
          this.loadedSteps[idx] = data;
          this.currentStepIndex = idx;
          this.currentStep = data;
          if (this.totalSteps <= idx) {
            this.totalSteps = idx + 1;
            this.finalStepNumber = idx;
          }
          this.selectedDistrictGroupIndex = null;
          this.syncIsolationFromCurrentStep();
          this.bridgeTractIds.clear();
          this.bridgeTractsData = null;
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.loadingMessage = '';
          this.errorMessage = '';
          this.cdr.markForCheck();
          this.renderFinalDistricts();
        },
        error: (err) => {
          this.isLoadingSteps = false;
          this.isLoading = false;
          this.loadingMessage = '';
          this.errorMessage = err?.message || 'Failed to load final step';
          this.cdr.markForCheck();
        }
      });
      this.subscriptions.push(sub);
    }
  }

  /**
   * Play button: runs the same sequence as manual Next → Move → Balance.
   * 1. Next-step repeatedly until final step (all single-district groups); at final step, detect-isolated-tracts runs.
   * 2. Move isolated tracts (loop until totalIsolated === 0).
   * 3. Balance tracts (loop until noMoreBalancingPossible); backend then triggers build-all-union-polygons and district-party (202).
   * 4. Frontend also calls triggerPolygonsForAllMissing() and triggerDistrictPartyIfNeeded() when balance completes.
   */
  playSteps(): void {
    if (this.isPlaying) {
      this.pauseSteps();
      return;
    }
    this.isPlaying = true;
    if (this.atFinalStepForPlay) {
      this.runFinalStepToCompletion();
      return;
    }
    this.nextStep();
  }

  /**
   * At final step: run move isolated until none left, then balance until no more, then trigger union polygons and party % jobs.
   * Called when play is started at final step; uses finalStepPhaseLabel for phase labels.
   */
  private runFinalStepToCompletion(): void {
    if (!this.isPlaying) return;
    if (this._runningFinalStepCompletion) return;
    this._runningFinalStepCompletion = true;
    if (this.hasUnresolvedIsolation) {
      this.finalStepPhaseLabel = 'Move isolated tracts';
      this.loadingMessage = 'Move isolated tracts';
      this.cdr.markForCheck();
      this.moveIsolatedTracts(
        (result) => {
          const totalIsolated = result?.isolationResult?.totalIsolated ?? 0;
          if (totalIsolated === 0) {
            this._runningFinalStepCompletion = false;
            setTimeout(() => this.runFinalStepToCompletion(), 0);
          } else {
            this._runningFinalStepCompletion = false;
            this.pauseSteps();
            this.isLoading = false;
            this.loadingMessage = '';
            this.finalStepPhaseLabel = 'Move isolated tracts (some remaining)';
            this.cdr.markForCheck();
          }
        },
        () => {
          this._runningFinalStepCompletion = false;
          this.pauseSteps();
          this.finalStepPhaseLabel = '';
          this.cdr.markForCheck();
        }
      );
      return;
    }
    if (!this.finalStepBalancingComplete) {
      this.finalStepPhaseLabel = 'Balance tracts';
      this.loadingMessage = 'Balance tracts';
      this.cdr.markForCheck();
      this.balanceDistrictsAfterIsolated(
        (result) => {
          const noMore = (result as { noMoreBalancingPossible?: boolean })?.noMoreBalancingPossible === true;
          if (noMore) {
            this._runningFinalStepCompletion = false;
            this.finalStepPhaseLabel = 'State geodistricting complete';
            this.loadingMessage = 'State geodistricting complete';
            this.triggerPolygonsForAllMissing();
            this.triggerDistrictPartyIfNeeded();
            this.pauseSteps();
            this.isLoading = false;
            this.loadingMessage = '';
            this.cdr.markForCheck();
            setTimeout(() => {
              this.finalStepPhaseLabel = '';
              this.cdr.markForCheck();
            }, 5000);
          } else {
            this._runningFinalStepCompletion = false;
            setTimeout(() => this.runFinalStepToCompletion(), 0);
          }
        },
        () => {
          this._runningFinalStepCompletion = false;
          this.pauseSteps();
          this.finalStepPhaseLabel = '';
          this.cdr.markForCheck();
        }
      );
      return;
    }
    this._runningFinalStepCompletion = false;
    this.finalStepPhaseLabel = 'State geodistricting complete';
    this.loadingMessage = 'State geodistricting complete';
    this.triggerPolygonsForAllMissing();
    this.triggerDistrictPartyIfNeeded();
    this.pauseSteps();
    this.isLoading = false;
    this.loadingMessage = '';
    this.cdr.markForCheck();
    setTimeout(() => {
      this.finalStepPhaseLabel = '';
      this.cdr.markForCheck();
    }, 5000);
  }

  pauseSteps(): void {
    this.isPlaying = false;
    this._runningFinalStepCompletion = false;
    this.finalStepPhaseLabel = '';
  }

  /**
   * Called when the current step has finished loading and displaying.
   * If auto-play is on, advances to next step or pauses at final step.
   */
  private onStepDisplayComplete(): void {
    if (!this.isPlaying) return;
    if (!this.canGoToNextStep()) {
      if (this.atFinalStepForPlay) {
        this.runFinalStepToCompletion();
      } else {
        this.pauseSteps();
      }
      return;
    }
    this.nextStep();
  }

  canGoToFirstStep(): boolean {
    if (this.isVisualizationOnly) {
      return this.currentStepIndex > 0;
    }
    // Dev mode: enable when map-only so user can run algorithm
    return this.currentStepIndex > 0 || (!!this.mapPolygons && !this.algorithmResult && !!this.selectedState && this.selectedState !== 'ALL' && this.isDevMode);
  }

  canGoToPreviousStep(): boolean {
    return this.currentStepIndex > 0;
  }

  canGoToLastStep(): boolean {
    const lastIndex = this.finalStepNumber ?? (this.getTotalSteps() - 1);
    return lastIndex >= 0 && this.currentStepIndex < lastIndex;
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

  /**
   * Label for the next division ratio only (percentages), e.g. "44/56", "50/50". Returns "–" when the group has only one district.
   */
  getNextDivisionLabel(group: DistrictGroup): string {
    const n = group.totalDistricts ?? (group.endDistrictNumber != null && group.startDistrictNumber != null
      ? group.endDistrictNumber - group.startDistrictNumber + 1 : 0);
    if (n <= 1) return '–';
    const first = Math.floor(n / 2);
    const second = n - first;
    const pctFirst = Math.round((first / n) * 100);
    const pctSecond = 100 - pctFirst;
    return `${pctFirst}/${pctSecond}`;
  }

  /**
   * Material icon name for next division direction: arrow_range (lat) or height (long). Null when group has one district.
   */
  getNextDivisionIcon(group: DistrictGroup): 'arrow_range' | 'height' | null {
    const n = group.totalDistricts ?? (group.endDistrictNumber != null && group.startDistrictNumber != null
      ? group.endDistrictNumber - group.startDistrictNumber + 1 : 0);
    if (n <= 1) return null;
    return (this.currentStepIndex + 1) % 2 === 1 ? 'arrow_range' : 'height';
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
    this.lastSliderHighlightedTractIds.forEach(tractId => {
      const layer = this.tractIdToLayer.get(tractId) as L.GeoJSON | undefined;
      if (!layer) return;
      const tractColor = this.tractGeoJsonLayers.get(layer) ?? '#888';
      (layer as any).setStyle({
        weight: normalWeight,
        color: '#000000',
        opacity: 0.8,
        fillOpacity: this.polygonFillOpacity,
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
    toUnhighlight.forEach(tractId => {
      const layer = this.tractIdToLayer.get(tractId) as L.GeoJSON | undefined;
      if (!layer) return;
      const tractColor = this.tractGeoJsonLayers.get(layer) ?? '#888';
      (layer as any).setStyle({
        weight: normalWeight,
        color: '#000000',
        opacity: 0.8,
        fillOpacity: this.polygonFillOpacity,
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

  /**
   * Render polygons from map-polygons response only (no algorithm result).
   * Used when in map-only view: state outline or final district polygons.
   */
  private renderMapPolygons(): void {
    if (!this.map || !this.tractLayer || !this.mapPolygons) return;
    if (this.mapPolygonsState !== this.selectedState) {
      this.tractLayer.clearLayers();
      this.tractGeoJsonLayers.clear();
      this.tractIdToLayer.clear();
      return;
    }

    this.tractLayer.clearLayers();
    this.tractGeoJsonLayers.clear();
    this.tractIdToLayer.clear();
    this.clearDivisionLines();

    const stateColor = this.getStatePartyColor(this.selectedState);
    const stateFillOpacity = this.getStatePartyOpacity(this.selectedState);
    const bounds = L.latLngBounds([] as L.LatLngExpression[]);

    if (this.mapPolygons.hasFinalStep && this.mapPolygons.finalDistrictPolygons && this.mapPolygons.finalDistrictPolygons.length > 0) {
      const polygons = this.mapPolygons.finalDistrictPolygons;
      polygons.forEach((feature: GeoJsonFeature, index: number) => {
        if (!feature?.geometry) return;
        const fillColor = this.getDistrictColor(index, polygons.length);
        const geoJson = L.geoJSON(feature as any, {
          style: {
            color: '#000000',
            weight: 2,
            opacity: 1.0,
            fillOpacity: this.polygonFillOpacity,
            fillColor
          }
        }).bindPopup(`<strong>District ${index + 1}</strong>`);
        this.tractLayer!.addLayer(geoJson);
        this.tractGeoJsonLayers.set(geoJson, fillColor);
        const layerBounds = geoJson.getBounds?.();
        if (layerBounds?.isValid()) bounds.extend(layerBounds);
      });
    } else {
      const stateFeature = this.mapPolygons.statePolygon;
      if (stateFeature?.geometry) {
        const geoJson = L.geoJSON(stateFeature as any, {
          style: {
            color: stateColor,
            weight: 2,
            opacity: 1.0,
            fillOpacity: stateFillOpacity,
            fillColor: stateColor
          }
        }).bindPopup(`<strong>${this.selectedState}</strong> (entire state)`);
        this.tractLayer.addLayer(geoJson);
        this.tractGeoJsonLayers.set(geoJson, stateColor);
        const layerBounds = geoJson.getBounds?.();
        if (layerBounds?.isValid()) bounds.extend(layerBounds);
      }
    }

    if (bounds.isValid()) {
      const padding: [number, number] = [20, 20];
      this.map.fitBounds(bounds, { padding });
      this.stateBoundsForSlider = bounds;
      this.map.setMinZoom(4);
      this.updateSliderTrackLength();
    }
    this.cdr.markForCheck();
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
    const isStep0StateOutline = this.currentStepIndex === 0 && districtsToRender.length === 1;
    districtsToRender.forEach((district, index) => {
        // Step 0 with one group = state boundary: shade by 119th party share; otherwise use district index or district party color
        let baseColor: string;
        if (isStep0StateOutline) {
          baseColor = this.getStatePartyColor(this.selectedState);
        } else if (this.showPartyColor && this.districtPartyByGroupKey) {
          const groupKey = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
          const partyData = this.districtPartyByGroupKey[groupKey];
          baseColor = partyData != null ? this.getTractColorByParty(partyData.pctDem) : this.getDistrictColor(index, districtsToRender.length);
        } else {
          baseColor = this.getDistrictColor(index, districtsToRender.length);
        }
        const isSelected = this.selectedDistrictGroupIndex === index;
        // Only apply grayscale if a district is selected AND this one is not selected
        const color = (this.selectedDistrictGroupIndex !== null && !isSelected) 
          ? this.colorToGrayscale(baseColor) 
          : baseColor;
        const groupKeyForOpacity = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
        const districtPartyForOpacity = this.showPartyColor ? this.districtPartyByGroupKey?.[groupKeyForOpacity] : undefined;
        const fillOpacity = isStep0StateOutline
          ? this.getStatePartyOpacity(this.selectedState)
          : this.polygonFillOpacity;

        if (!district.censusTracts || district.censusTracts.length === 0) {
          console.warn(`⚠️ District ${district.startDistrictNumber}-${district.endDistrictNumber} has no tracts`);
          return;
        }

      // When tract boundaries are hidden, use union polygon(s) if available (e.g. step complete, isolated resolved)
      if (!this.showTractBoundaries) {
        const unionPolygons = (district as any).unionPolygons;
        const hasUnionPolygonsArray = Array.isArray(unionPolygons) && unionPolygons.length > 0;
        const hasSingleUnionPolygon = !hasUnionPolygonsArray && district.unionPolygon?.geometry;
        const polygonsToRender = hasUnionPolygonsArray ? unionPolygons : (hasSingleUnionPolygon ? [district.unionPolygon] : []);

        if (polygonsToRender.length > 0) {
          console.log(`🖼️ Rendering union polygon(s) for DG ${district.startDistrictNumber}-${district.endDistrictNumber} (${polygonsToRender.length} part(s)), showTractBoundaries=false`);
          const districtLabel = district.startDistrictNumber === district.endDistrictNumber
            ? `District ${district.startDistrictNumber}` : `Districts ${district.startDistrictNumber}-${district.endDistrictNumber}`;
          const groupKey = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
          const districtParty = this.districtPartyByGroupKey?.[groupKey] ?? null;
          const popupContent = `<strong>${districtLabel}</strong><br>
            <strong>Population:</strong> ${(district.totalPopulation ?? 0).toLocaleString()}<br>
            <strong>Tracts in district:</strong> ${district.censusTracts.length}<br>
            ${this.getPopupPartyLine(districtParty)}`;

          for (const unionPolygon of polygonsToRender) {
            if (!unionPolygon?.geometry) continue;
            try {
              const geoJson = L.geoJSON(unionPolygon, {
                style: {
                  color: '#000000',
                  weight: 0.3,
                  opacity: 0.8,
                  fillOpacity,
                  fillColor: color
                }
              }).bindPopup(popupContent);
              this.tractLayer!.addLayer(geoJson);
              this.tractGeoJsonLayers.set(geoJson, color);
              const layerBounds = geoJson.getBounds();
              if (layerBounds?.isValid()) {
                bounds.extend(layerBounds);
                hasBounds = true;
              }
            } catch (e) {
              console.warn('Error rendering union polygon for district:', e);
            }
          }
          return; // skip tract-by-tract rendering
        }
      }

      // Render individual tracts (when showTractBoundaries, or when no union polygon yet e.g. before step complete)
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
            const partyData = this.tractPartyByGeoid;
            const groupKey = `${district.startDistrictNumber}-${district.endDistrictNumber}`;
            const useDistrictPartyColor = this.showPartyColor && this.districtPartyByGroupKey?.[groupKey];
            // When coloring by party, prefer one color per district; only use tract-level party when district data is missing
            let pctDemForOpacity: number | null = null;
            const useTractPartyColor = (this.showTractBoundaries || this.showPartyColor) && partyData && !useDistrictPartyColor;
            if (useTractPartyColor && partyData) {
              const geoid = this.normalizeTractPartyGeoid(tractId);
              const row = partyData[geoid];
              if (row != null) {
                tractColor = this.getTractColorByParty(row.pctDem);
                pctDemForOpacity = row.pctDem;
              }
            } else if (useDistrictPartyColor) {
              pctDemForOpacity = this.districtPartyByGroupKey![groupKey].pctDem;
            }
            const tractFillOpacity = this.polygonFillOpacity;

            // Determine border weight and color: border always black; bridge tracts get white 3px border.
            let borderWeight = this.showTractBoundaries ? 0.5 : 0.3;
            let borderColor = '#000000';
            if (isBridge) {
              borderWeight = 3;
              borderColor = '#ffffff';
            }
            const borderOpacityVal = isBridge ? 1.0 : 0.8;

            // Tracts should be GeoJSON Features - pass directly to L.geoJSON
            const geoJson = L.geoJSON(tract, {
              style: {
                color: borderColor,
                weight: borderWeight,
                opacity: borderOpacityVal,
                fillOpacity: tractFillOpacity,
                fillColor: tractColor
              }
            }).bindPopup(`
              <strong>District ${district.startDistrictNumber}${district.endDistrictNumber !== district.startDistrictNumber ? `-${district.endDistrictNumber}` : ''}</strong><br>
              <strong>Tract ID:</strong> ${tractProperties.TRACT_FIPS || tractProperties['GEOID'] || 'Unknown'}<br>
              ${isIsolated ? '<strong style="color: #d32f2f;">⚠️ ISOLATED TRACT</strong><br>' : ''}
              ${isBridge ? '<strong style="color: #1976d2;">🌉 BRIDGE TRACT</strong><br>' : ''}
              <strong>Population:</strong> ${(tractProperties.POPULATION || 0).toLocaleString()}<br>
              ${this.getPopupPartyLine(partyData ? partyData[this.normalizeTractPartyGeoid(tractId)] ?? null : null)}
              <strong>District Population:</strong> ${district.totalPopulation.toLocaleString()}<br>
              <strong>Tracts in District:</strong> ${district.censusTracts.length}<br>
              <strong>Sibling:</strong> ${this.getSiblingDGLabel(tract)}<br>
              <strong>bbox:</strong> ${this.getTractBboxString(tract)}
            `);
            
            // Store tract ID to layer mapping for popup access
            this.tractIdToLayer.set(tractId, geoJson);

            this.tractLayer!.addLayer(geoJson);
            this.tractGeoJsonLayers.set(geoJson, tractColor); // Store actual fill color (party or district) for style updates
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
      this.map.setMinZoom(4);
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
   * Color for step0 state boundary by 119th Congress party share (D/(D+R)).
   * Red for R-majority, blue for D-majority (no green/yellow). Lightness reflects strength (pale near 50%).
   */
  private getStatePartyColor(stateCode: string): string {
    const s = this.stateComparison?.states?.[stateCode];
    if (!s) return 'hsl(0, 0%, 55%)';
    const congressD = parseInt(String(s.congressD), 10) || 0;
    const congressR = parseInt(String(s.congressR), 10) || 0;
    const total = congressD + congressR;
    if (total === 0) return 'hsl(0, 0%, 55%)';
    const demPct = congressD / total;
    // Strength 0 = tie (50/50), 1 = 100% D or 100% R
    const strength = demPct <= 0.5 ? (0.5 - demPct) * 2 : (demPct - 0.5) * 2;
    const hue = demPct <= 0.5 ? 0 : 240; // red or blue only
    const lightness = Math.round(72 - strength * 22); // 72% at tie (pale), 50% at full
    return `hsl(${hue}, 70%, ${lightness}%)`;
  }

  /**
   * Fill color for a district in the All-states map view. Uses per-district party when available
   * (allStatesDistrictPartyByState), else state-level party (state-party-summaries or 119th Congress).
   */
  private getUSMapDistrictFillColor(stateCode: string, groupKey?: string): string {
    if (groupKey) {
      const partyData = this.allStatesDistrictPartyByState[stateCode]?.[groupKey];
      if (partyData != null && typeof partyData.pctDem === 'number') {
        return this.getTractColorByParty(partyData.pctDem);
      }
    }
    const partySummary = this.statePartySummaries?.[stateCode];
    if (partySummary != null && typeof partySummary.pctDem === 'number') {
      return this.getTractColorByParty(partySummary.pctDem);
    }
    return this.getStatePartyColor(stateCode);
  }

  /**
   * Fill opacity for state party shading: stronger majority = more opaque (0.35 at tie, 1 at full).
   */
  private getStatePartyOpacity(stateCode: string): number {
    const s = this.stateComparison?.states?.[stateCode];
    if (!s) return 0.6;
    const congressD = parseInt(String(s.congressD), 10) || 0;
    const congressR = parseInt(String(s.congressR), 10) || 0;
    const total = congressD + congressR;
    if (total === 0) return 0.6;
    const demPct = congressD / total;
    const strength = demPct <= 0.5 ? (0.5 - demPct) * 2 : (demPct - 0.5) * 2;
    return 0.35 + strength * 0.65;
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
   * Treat cached isolated-tracts data as stale when count is suspiciously high (e.g. pre-FIPS-fix cache).
   * When stale, we clear and re-detect so the UI does not show wrong counts (e.g. 1763).
   */
  private isStaleIsolatedTractsData(step: GeodistrictStep | null, stepIsolatedData: { isolatedTractIds?: string[]; totalIsolated?: number } | null): boolean {
    if (!step?.districtGroups || !stepIsolatedData) return false;
    const totalTracts = step.districtGroups.reduce((sum, g) => sum + (g.censusTracts?.length ?? 0), 0);
    const cachedCount = stepIsolatedData.totalIsolated ?? stepIsolatedData.isolatedTractIds?.length ?? 0;
    // Don't mark as stale if censusTracts aren't loaded (totalTracts = 0) - trust the cached data
    return cachedCount > 500 || (totalTracts > 0 && cachedCount > totalTracts * 0.1);
  }

  /**
   * Get step-0 island and excluded tract IDs for exclusion from isolation at steps 1+.
   * Includes both geographic island tracts (islandTractsByGroup) and water/special tracts (excludedTractIds).
   * Uses the step with step number 0 (not array index 0). Supports Firestore-serialized shape (group.tractIds).
   * Returns undefined if not available (e.g. step 0 not loaded or no islands/excluded).
   */
  private getStep0IslandTractIds(): string[] | undefined {
    const step0 = this.algorithmResult?.steps?.find(s => s && (s as any).step === 0);
    const islandTractsData = (step0 as any)?.islandTractsData;
    const islandData = islandTractsData?.islandTractsByGroup;
    const excludedIds = Array.isArray(islandTractsData?.excludedTractIds) ? islandTractsData.excludedTractIds : [];
    const ids: string[] = [...excludedIds];
    if (islandData && typeof islandData === 'object') {
      for (const islandGroups of Object.values(islandData)) {
        if (Array.isArray(islandGroups)) {
          for (const group of islandGroups) {
            if (Array.isArray(group)) {
              ids.push(...group);
            } else if (typeof group === 'string') {
              ids.push(group);
            } else if (group && Array.isArray((group as any).tractIds)) {
              ids.push(...(group as any).tractIds);
            }
          }
        }
      }
    }
    return ids.length > 0 ? ids : undefined;
  }

  /**
   * Step-0 island IDs merged with this step's excludedTractIds (unmovable tracts treated as islands for this step).
   * Use this when calling detect-isolated-tracts or move-all-isolated-tracts so backend excludes both.
   */
  private getStep0IslandTractIdsForRequest(): string[] | undefined {
    const step0 = this.getStep0IslandTractIds() ?? [];
    const stepExcluded = Array.isArray((this.currentStep as any)?.excludedTractIds) ? (this.currentStep as any).excludedTractIds as string[] : [];
    const merged = step0.length > 0 || stepExcluded.length > 0 ? [...new Set([...step0, ...stepExcluded])] : [];
    return merged.length > 0 ? merged : undefined;
  }

  /**
   * Step 0 only: list of geographic island tracts for the collapsible panel.
   * Each item has tractId and a group label (e.g. "Island group 1").
   */
  getStep0IslandTractsList(): Array<{ tractId: string; groupLabel: string }> {
    const step = this.currentStep;
    if (!step || step.step !== 0) return [];
    const islandData = (step as any).islandTractsData?.islandTractsByGroup;
    if (!islandData || typeof islandData !== 'object') return [];
    const list: Array<{ tractId: string; groupLabel: string }> = [];
    let groupNum = 0;
    for (const islandGroups of Object.values(islandData)) {
      if (!Array.isArray(islandGroups)) continue;
      for (const group of islandGroups) {
        groupNum++;
        const label = `Island group ${groupNum}`;
        const ids = Array.isArray(group) ? group : [group];
        for (const id of ids) {
          const tractId = typeof id === 'string' ? id : String(id);
          list.push({ tractId, groupLabel: label });
        }
      }
    }
    return list;
  }

  /**
   * Step 0 only: list of enclosed tracts (merged with their enclosing tract via TRACT_GROUP_ID).
   */
  getStep0EnclosedTractsList(): Array<{ tractId: string; enclosedBy: string }> {
    const step = this.currentStep;
    if (!step?.districtGroups?.length) return [];
    const list: Array<{ tractId: string; enclosedBy: string }> = [];
    for (const group of step.districtGroups) {
      for (const tract of group.censusTracts || []) {
        const enclosedBy = tract.properties?.['ENCLOSED_BY'];
        if (enclosedBy) {
          list.push({ tractId: this.getTractId(tract), enclosedBy: String(enclosedBy) });
        }
      }
    }
    return list;
  }

  /**
   * Detect isolated tracts in the current step's district groups.
   * Optional onComplete() is called when detection finishes (success or error); use when advancing to final step so play can continue after detection.
   */
  detectIsolatedTracts(onComplete?: () => void): void {
    if (!this.currentStep || !this.algorithmResult) {
      console.warn('No current step or algorithm result available');
      onComplete?.();
      return;
    }

    // Collect all tracts from all district groups
    const allTracts: GeoJsonFeature[] = [];
    for (const group of this.currentStep.districtGroups) {
      allTracts.push(...(group.censusTracts || []));
    }

    if (allTracts.length === 0) {
      console.warn('No tracts available for isolation detection');
      onComplete?.();
      return;
    }

    this.isDetectingIsolation = true;
    this.isolatedTractIds.clear();

    const stepNum = this.currentStep.step;
    const step0IslandIds = stepNum !== 0 ? this.getStep0IslandTractIdsForRequest() : undefined;

    const subscription = this.geodistrictService.detectIsolatedTracts(
      this.currentStep.districtGroups,
      allTracts,
      stepNum,
      step0IslandIds
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
        if (result.isolatedTractIds?.length) {
          this.finalStepBalancingComplete = false;
        }
        // Persist on current step so move has step data
        if (this.currentStep) {
          this.currentStep.isolatedTractsData = {
            isolatedTractsByGroup: result.isolatedTractsByGroup,
            isolatedTractIds: result.isolatedTractIds,
            totalIsolated: result.totalIsolated ?? result.isolatedTractIds?.length ?? 0,
            groupsWithIsolation: result.groupsWithIsolation ?? 0
          };
        }
        // Clear bridge tracts when new isolation is detected
        this.bridgeTractIds.clear();
        this.bridgeTractsData = null;
        
        // Debug: Check if we can match any tract IDs
        if (this.currentStep && this.currentStep.districtGroups.length > 0) {
          const sampleTract = this.currentStep.districtGroups[0].censusTracts?.[0];
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
        onComplete?.();
      },
      error: (error) => {
        console.error('Error detecting isolated tracts:', error);
        this.errorMessage = error.message || 'Failed to detect isolated tracts';
        this.isDetectingIsolation = false;
        onComplete?.();
      }
    });

    this.subscriptions.push(subscription);
  }

  /**
   * Normalize tract ID to 11-digit GEOID for tract-party lookup (matches backend tract_party key format).
   */
  private normalizeTractPartyGeoid(tractId: string): string {
    const digits = String(tractId).replace(/\D/g, '');
    return digits.padStart(11, '0').substring(0, 11);
  }

  /**
   * Get tract ID from a GeoJSON feature (GEOID or fallbacks).
   * IMPORTANT: Must match backend getTractId logic for proper ID matching
   */
  getTractId(tract: GeoJsonFeature): string {
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
    
    // Fallback: construct from STATE_FIPS + COUNTY_FIPS + TRACT_FIPS (pad to 2+3+6 for tract-party lookup)
    if (tract.properties?.['STATE_FIPS'] != null && tract.properties?.['COUNTY_FIPS'] != null && tract.properties?.['TRACT_FIPS'] != null) {
      const s = String(tract.properties['STATE_FIPS']).padStart(2, '0');
      const c = String(tract.properties['COUNTY_FIPS']).padStart(3, '0');
      const t = String(tract.properties['TRACT_FIPS']).padStart(6, '0');
      return `${s}${c}${t}`;
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
   * Move isolated tracts to opposite groups and re-run isolation detection.
   * Optional onSuccess(result) is called on success (e.g. for play flow chaining); onError(error) on failure.
   */
  moveIsolatedTracts(onSuccess?: (result: any) => void, onError?: (error: any) => void): void {
    if (!this.currentStep) {
      console.warn('Cannot move isolated tracts: missing current step');
      onError?.(new Error('Missing current step'));
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
      onSuccess?.({ isolationResult: { totalIsolated: 0 } });
      return;
    }

    this.isMovingIsolatedTracts = true;
    this.moveIsolatedHint = '';
    this.isLoading = true;
    this.loadingMessage = 'Moving isolated tracts...';

    console.log(`🔄 Moving all isolated tracts for step ${this.currentStep.step}${hasStepData ? ' (from step cache)' : ' (from manual detection)'}`);

    // Call new backend endpoint that processes all isolated tracts in one operation.
    // Send districtGroups only when every group has full censusTracts so the backend can use the fast path.
    const hasFullTractData = this.currentStep.districtGroups && Array.isArray(this.currentStep.districtGroups) &&
      this.currentStep.districtGroups.length > 0 &&
      this.currentStep.districtGroups.every(g => Array.isArray(g?.censusTracts) && (g.censusTracts?.length ?? 0) > 0);
    const districtGroupsToSend = hasFullTractData ? this.currentStep.districtGroups : undefined;

    const payloadIsolatedData = (this.currentStep?.isolatedTractsData?.isolatedTractsByGroup && Object.keys(this.currentStep.isolatedTractsData.isolatedTractsByGroup).length > 0)
      ? { isolatedTractsByGroup: this.currentStep.isolatedTractsData.isolatedTractsByGroup, isolatedTractIds: this.currentStep.isolatedTractsData.isolatedTractIds }
      : (this.isolatedTractsData ? { isolatedTractsByGroup: this.isolatedTractsData.isolatedTractsByGroup, isolatedTractIds: this.isolatedTractsData.isolatedTractIds } : undefined);
    const step0IslandIds = this.currentStep.step !== 0 ? this.getStep0IslandTractIdsForRequest() : undefined;
    this.geodistrictService.moveAllIsolatedTractsFromStep(
      this.selectedState,
      this.currentStep.step,
      100, // maxIterations
      payloadIsolatedData,
      districtGroupsToSend,
      this.currentStep.divisionLines && Array.isArray(this.currentStep.divisionLines) ? this.currentStep.divisionLines : undefined,
      step0IslandIds
    ).pipe(
      finalize(() => {
        this.isMovingIsolatedTracts = false;
        this.isLoading = false;
        this.loadingMessage = '';
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: (result) => {
        this.errorMessage = ''; // Clear any previous error on success
        // Log union polygons from response (for hide-tract rendering after move isolated)
        if (result.districtGroups?.length && result.isolationResult.totalIsolated === 0) {
          result.districtGroups.forEach((g: any, i: number) => {
            const hasUnion = !!(g.unionPolygon?.geometry || (Array.isArray(g.unionPolygons) && g.unionPolygons.length > 0));
            console.log(`🔍 Move isolated response: group ${i} (${g.startDistrictNumber}-${g.endDistrictNumber}) has union polygon: ${hasUnion}`);
          });
        }
        // Update current step with new district groups
        const isolatedIds = result.isolationResult?.isolatedTractIds ?? [];
        const isolatedByGroup = result.isolationResult?.isolatedTractsByGroup ?? {};
        if (this.currentStep) {
          this.currentStep.districtGroups = result.districtGroups;
          // Update isolated tracts data from result (empty = isolation resolved → show Balance button)
          this.currentStep.isolatedTractsData = {
            isolatedTractsByGroup: isolatedByGroup,
            isolatedTractIds: isolatedIds,
            totalIsolated: result.isolationResult?.totalIsolated ?? 0,
            groupsWithIsolation: Object.keys(isolatedByGroup).length
          };
          // Persist excludedTractIds (unmovable tracts treated as islands for this step) so next detect/move use them
          if (Array.isArray((result as any).excludedTractIds) && (result as any).excludedTractIds.length > 0) {
            (this.currentStep as any).excludedTractIds = (result as any).excludedTractIds;
          }
        }

        // Update component state so Move button hides and Balance button shows when isolation is resolved
        this.isolatedTractIds = new Set(isolatedIds);
        this.isolatedTractsData = {
          isolatedTractsByGroup: isolatedByGroup,
          isolatedTractIds: isolatedIds
        };
        if (isolatedIds.length > 0) {
          this.finalStepBalancingComplete = false;
        }
        if (result.isolationResult?.totalIsolated === 0) {
          this.finalStepBalancingComplete = false; // Show Balance button once all isolation is resolved
          console.log(`✅ All isolated tracts moved. Final isolation: 0 isolated tracts in 0 groups`);
          this.moveIsolatedHint = '';
        } else {
          console.log(`⚠️ Completed processing. Remaining isolation: ${result.isolationResult?.totalIsolated} isolated tracts in ${result.isolationResult?.groupsWithIsolation} groups`);
          this.moveIsolatedHint = (result as any).hint || 'Some tracts could not be moved. Try "Detect Bridge Tracts" then "Move Bridge Tracts".';
        }

        // Clear bridge tracts (will need to re-detect)
        this.bridgeTractIds.clear();
        this.bridgeTractsData = null;

        // Keep loadedSteps in sync (currentStep is same ref as loadedSteps[currentStepIndex])
        if (this.currentStep && this.currentStepIndex >= 0 && this.currentStepIndex < this.loadedSteps.length) {
          this.loadedSteps[this.currentStepIndex] = this.currentStep;
        }
        // Re-render map with updated groups
        this.renderFinalDistricts();
        this.cdr.detectChanges();
        onSuccess?.(result);
      },
      error: (error) => {
        console.error('Error moving isolated tracts:', error);
        this.errorMessage = error?.message || error.error?.message || error.message || 'Failed to move isolated tracts';
        onError?.(error);
      }
    });
  }

  /**
   * Run balance on the backend. At final step uses variance-based balance (no division lines required);
   * otherwise uses balanceSiblingPairsAfterIsolatedMoves (division lines required).
   * Optional onSuccess(result) and onError(error) for play flow chaining.
   */
  balanceDistrictsAfterIsolated(onSuccess?: (result: any) => void, onError?: (error: any) => void): void {
    if (!this.currentStep?.districtGroups?.length) return;
    if (!this.isFinalStepActive && !(this.currentStep?.divisionLines?.length)) return;
    this.isBalancingDistricts = true;
    this.errorMessage = '';
    this.isLoading = true;
    this.loadingMessage = 'Balancing districts...';
    const maxIterations = this.algorithmResult?.maxIterations ?? 100;
    this.geodistrictService.balanceAfterIsolated(
      this.selectedState,
      this.currentStep!.step,
      this.currentStep!.districtGroups,
      this.currentStep!.divisionLines ?? [],
      { maxIterations }
    ).pipe(
      finalize(() => {
        this.isBalancingDistricts = false;
        this.isLoading = false;
        this.loadingMessage = '';
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: (result) => {
        if (this.currentStep) {
          this.currentStep.districtGroups = result.districtGroups;
        }
        if (this.currentStepIndex >= 0 && this.currentStepIndex < this.loadedSteps.length) {
          this.loadedSteps[this.currentStepIndex] = this.currentStep!;
        }
        const noMore = (result as { noMoreBalancingPossible?: boolean }).noMoreBalancingPossible;
        if (noMore === true) {
          this.finalStepBalancingComplete = true;
        }
        this.renderFinalDistricts();
        this.cdr.detectChanges();
        onSuccess?.(result);
      },
      error: (error) => {
        console.error('Error balancing districts:', error);
        this.errorMessage = error?.message || error?.message || 'Failed to balance districts';
        onError?.(error);
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
        const stepNum = this.currentStep?.step;
        const step0IslandIds = stepNum !== 0 ? this.getStep0IslandTractIdsForRequest() : undefined;
        this.geodistrictService.detectIsolatedTracts(currentDistrictGroups, allTracts, stepNum, step0IslandIds).subscribe({
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
   * Find a tract feature by ID in the current step's district groups (for popup fallback when tract layers not rendered).
   */
  private findTractFeatureById(tractId: string): GeoJsonFeature | null {
    if (!this.currentStep?.districtGroups) return null;
    for (const group of this.currentStep.districtGroups) {
      if (!group.censusTracts) continue;
      const tract = group.censusTracts.find(t => this.getTractId(t) === tractId);
      if (tract) return tract;
    }
    return null;
  }

  /**
   * Show popup for a tract when clicking on table row.
   * When tract boundaries are not shown (union-polygon view), finds the tract in step data and pans to it with a popup.
   */
  showTractPopup(tractId: string): void {
    const layer = this.tractIdToLayer.get(tractId);
    if (layer && this.map) {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        const center = bounds.getCenter();
        layer.openPopup(center);
        if (!this.map.getBounds().contains(center)) {
          this.map.setView(center, Math.max(this.map.getZoom(), 10));
        }
      } else {
        layer.openPopup();
      }
      return;
    }

    // Fallback: tract not in tractIdToLayer (e.g. union-polygon-only view at step 2). Find feature and pan + popup.
    const tractFeature = this.findTractFeatureById(tractId);
    if (tractFeature && this.map) {
      const tempLayer = L.geoJSON(tractFeature);
      const bounds = tempLayer.getBounds?.();
      if (bounds && bounds.isValid()) {
        const center = bounds.getCenter();
        this.map.fitBounds(bounds, { maxZoom: 14, padding: [30, 30] });
        const props = tractFeature.properties || {};
        const groupLabel = this.getTractGroupLabel(tractFeature);
        const isIsolated = this.isolatedTractIds.has(tractId);
        const isBridge = this.bridgeTractIds.has(tractId);
        const siblingLabel = this.getSiblingDGLabel(tractFeature);
        const tractPartyRow = this.tractPartyByGeoid?.[this.normalizeTractPartyGeoid(tractId)] ?? null;
        const popupContent = `
          <strong>${groupLabel}</strong><br>
          <strong>Tract ID:</strong> ${props.TRACT_FIPS ?? props['GEOID'] ?? tractId}<br>
          ${isIsolated ? '<strong style="color: #d32f2f;">⚠️ ISOLATED TRACT</strong><br>' : ''}
          ${isBridge ? '<strong style="color: #1976d2;">🌉 BRIDGE TRACT</strong><br>' : ''}
          <strong>Population:</strong> ${(props.POPULATION ?? 0).toLocaleString()}<br>
          ${this.getPopupPartyLine(tractPartyRow)}
          <strong>Sibling:</strong> ${siblingLabel}<br>
          <strong>bbox:</strong> ${this.getTractBboxString(tractFeature)}
        `;
        L.popup({ className: 'tract-locate-popup' }).setLatLng(center).setContent(popupContent).openOn(this.map);
      } else {
        // Tract has no boundary data (e.g. water/special-purpose); show message and population at current map center
        console.warn(`Tract ${tractId}: could not get bounds from feature (no boundary data)`);
        const props = tractFeature.properties || {};
        const pop = (props.POPULATION ?? 0).toLocaleString();
        const noBoundsContent = `
          <strong>Tract ID:</strong> ${tractId}<br>
          <strong style="color: #666;">Tract has no boundary data; cannot show on map.</strong><br>
          <strong>Population:</strong> ${pop}
        `;
        const center = this.map.getCenter();
        L.popup({ className: 'tract-locate-popup' }).setLatLng(center).setContent(noBoundsContent).openOn(this.map);
      }
    } else {
      console.warn(`Tract layer not found for ID: ${tractId}`);
      // Tract not in layer and not in step data (or no map): show message at map center if we have a map
      if (this.map) {
        const noFeatureContent = `
          <strong>Tract ID:</strong> ${tractId}<br>
          <strong style="color: #666;">Tract has no boundary data; cannot show on map.</strong>
        `;
        const center = this.map.getCenter();
        L.popup({ className: 'tract-locate-popup' }).setLatLng(center).setContent(noFeatureContent).openOn(this.map);
      }
    }
  }

  /**
   * Get district group label for a tract (e.g. "Districts 6-7") from its tract_DG or by finding its group.
   */
  private getTractGroupLabel(tract: GeoJsonFeature): string {
    const dg = tract.properties?.['tract_DG'] ?? tract.properties?.['TRACT_DG'];
    if (dg && typeof dg === 'string') {
      const m = dg.match(/DG(\d+)-(\d+)/);
      if (m) return `Districts ${m[1]}-${m[2]}`;
    }
    if (!this.currentStep?.districtGroups) return 'District';
    const tractId = this.getTractId(tract);
    for (const group of this.currentStep.districtGroups) {
      if (group.censusTracts?.some(t => this.getTractId(t) === tractId))
        return `Districts ${group.startDistrictNumber}-${group.endDistrictNumber}`;
    }
    return 'District';
  }

  /**
   * Get sibling DG label for a tract (e.g. "Districts 8-9") from its sibling_DG property.
   */
  private getSiblingDGLabel(tract: GeoJsonFeature): string {
    const dg = tract.properties?.['sibling_DG'];
    if (dg && typeof dg === 'string') {
      const m = dg.match(/DG(\d+)-(\d+)/);
      if (m) return `Districts ${m[1]}-${m[2]}`;
    }
    return '–';
  }

  /** Format tract bbox for popup display (S, N, W, E from geometry or properties). */
  private getTractBboxString(tract: GeoJsonFeature): string {
    const b = this.getTractBoundsForSort(tract);
    if (!b) return '';
    return `S=${b.minLat.toFixed(4)} N=${b.maxLat.toFixed(4)} W=${b.minLng.toFixed(4)} E=${b.maxLng.toFixed(4)}`;
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
   * Final target population per district (state population / number of districts).
   * Use for display in info-header; differs from targetDGPopulation which is per current DG.
   */
  get finalTargetDistrictPopulation(): number {
    const pop = this.statePopulation;
    const n = this.getStateDistrictCount(this.selectedState);
    return n > 0 ? Math.round(pop / n) : 0;
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

  /** Target population for a district group (for variance tooltip). */
  getGroupTargetPopulation(group: DistrictGroup): number {
    const stateInfo = this.states.find(s => s.code === this.selectedState);
    if (!stateInfo || !this.currentStep?.districtGroups?.length) return 0;
    const totalStatePopulation = this.statePopulation;
    const targetPerDistrict = totalStatePopulation / stateInfo.districts;
    return Math.round(targetPerDistrict * group.totalDistricts);
  }

  /** Variance tooltip: "DG population / Target DG population". */
  getGroupVarianceTooltip(group: DistrictGroup): string {
    const target = this.getGroupTargetPopulation(group);
    return `${group.totalPopulation.toLocaleString()} / ${target.toLocaleString()}`;
  }

  /** Per-DG status for table (polygon and party). */
  getGroupStatusForIndex(i: number): PerGroupStatus | null {
    if (!this.perGroupStatus || this.perGroupStatus.length <= i) return null;
    return this.perGroupStatus[i];
  }

  /** True when union polygon is being built for this group (show hourglass). */
  isTriggeringPolygonForGroup(group: DistrictGroup): boolean {
    if (!this.triggeringForGroupKey) return false;
    return this.triggeringForGroupKey === `${group.startDistrictNumber}-${group.endDistrictNumber}`;
  }

  /** Fetch district-level party data for current state/step; used for map coloring and tooltips. */
  private fetchDistrictPartyForCurrentStep(): void {
    if (!this.selectedState || this.selectedState === 'ALL' || this.finalStepNumber == null) {
      this.districtPartyByGroupKey = null;
      return;
    }
    const maxIter = this.finalStepMaxIterations ?? 100;
    const vestYear = 2024;
    this.geodistrictService.getDistrictParty(this.selectedState, this.finalStepNumber, maxIter, vestYear).subscribe({
      next: (res) => {
        this.districtPartyByGroupKey = res.districts ?? null;
        this.renderFinalDistricts();
        this.cdr.markForCheck();
      },
      error: () => {
        this.districtPartyByGroupKey = null;
        this.cdr.markForCheck();
      }
    });
  }

  /** Refetch final step to update status (e.g. after district party job or union polygon build). */
  refetchFinalStepForStatus(state: string): void {
    this.geodistrictService.getFinalStep(state).subscribe({
      next: (resp: FinalStepResponse) => {
        if (this.selectedState !== state) return;
        this.unionPolygonsCached = resp.unionPolygonsCached === true;
        this.districtPartyPercentagesCalculated = resp.districtPartyPercentagesCalculated === true;
        this.perGroupStatus = resp.perGroupStatus ?? [];
        if (resp.districtPartyPercentagesCalculated === true && this.finalStepNumber != null) {
          this.fetchDistrictPartyForCurrentStep();
        } else {
          this.districtPartyByGroupKey = null;
        }
        // Merge step data so map and table show new union polygons / party data
        if (resp.data?.districtGroups?.length && this.currentStepIndex === resp.step) {
          this.currentStep = resp.data;
          if (this.currentStepIndex >= 0 && this.currentStepIndex < this.loadedSteps.length) {
            this.loadedSteps[this.currentStepIndex] = resp.data;
          }
          this.renderFinalDistricts();
        }
        this.cdr.markForCheck();
      }
    });
  }

  /** True when any district group still needs union polygon built (final step, dev mode). */
  needsBuildPolygons(): boolean {
    if (!this.currentStep?.districtGroups?.length || !this.perGroupStatus?.length) return false;
    return this.perGroupStatus.some(s => s.polygon === 'missing' || s.polygon === 'fail');
  }

  /** True when any district group still needs party % calculated (final step, dev mode). */
  needsCalcParty(): boolean {
    if (!this.currentStep?.districtGroups?.length || !this.perGroupStatus?.length) return false;
    return this.perGroupStatus.some(s => s.party === 'missing' || s.party === 'fail');
  }

  /** Trigger union polygon build for the first group that needs it (Build Polygons button). */
  triggerPolygonsForAllMissing(): void {
    if (!this.currentStep?.districtGroups?.length || !this.perGroupStatus?.length || this.triggeringForGroupKey) return;
    const idx = this.perGroupStatus.findIndex(s => s.polygon === 'missing' || s.polygon === 'fail');
    if (idx < 0) return;
    const group = this.currentStep.districtGroups[idx];
    this.triggerPolygonForGroup(group, { stopPropagation: () => {} } as Event);
  }

  /** Trigger district party job for the whole state (Calc Party % button). */
  triggerDistrictPartyIfNeeded(): void {
    if (!this.selectedState || this.selectedState === 'ALL' || this.finalStepNumber == null || this.districtPartyJobTriggered) return;
    this.districtPartyJobTriggered = true;
    const maxIter = this.finalStepMaxIterations ?? 100;
    this.geodistrictService.triggerDistrictPartyJob(this.selectedState, this.finalStepNumber, maxIter).subscribe({
      next: () => {
        this.cdr.markForCheck();
        setTimeout(() => this.refetchFinalStepForStatus(this.selectedState!), 3000);
      },
      error: () => {
        this.districtPartyJobTriggered = false;
        this.cdr.markForCheck();
      }
    });
  }

  /** Trigger union polygon for one DG (dev/maps). */
  triggerPolygonForGroup(group: DistrictGroup, e: Event): void {
    e.stopPropagation();
    if (!this.selectedState || this.currentStepIndex == null) return;
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    if (this.triggeringForGroupKey) return;
    this.triggeringForGroupKey = groupKey;
    this.errorMessage = '';
    const maxIter = this.algorithmResult?.maxIterations ?? this.finalStepMaxIterations ?? 100;
    this.geodistrictService.triggerUnionPolygonForGroup(this.selectedState, this.currentStepIndex, groupKey, maxIter).subscribe({
      next: () => {
        this.triggeringForGroupKey = null;
        this.errorMessage = '';
        this.refetchFinalStepForStatus(this.selectedState);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.triggeringForGroupKey = null;
        this.errorMessage = err?.error?.message || err?.message || 'Failed to build union polygon for this district.';
        this.cdr.markForCheck();
      }
    });
  }

  /** Trigger district party for one DG (dev/maps). */
  triggerPartyForGroup(group: DistrictGroup, e: Event): void {
    e.stopPropagation();
    if (!this.selectedState || this.currentStepIndex == null) return;
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    if (this.triggeringForGroupKey) return;
    this.triggeringForGroupKey = groupKey;
    const maxIter = this.algorithmResult?.maxIterations ?? this.finalStepMaxIterations ?? 100;
    const finalStep = this.finalStepNumber ?? this.currentStepIndex;
    this.geodistrictService.triggerDistrictPartyForGroup(this.selectedState, finalStep, groupKey, maxIter).subscribe({
      next: () => {
        this.triggeringForGroupKey = null;
        this.errorMessage = '';
        this.refetchFinalStepForStatus(this.selectedState);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.triggeringForGroupKey = null;
        this.errorMessage = err?.error?.error || err?.message || 'Failed to compute district party. Run tract party persistence for this state first.';
        this.cdr.markForCheck();
      }
    });
  }

  /** Summary text for union polygon status. */
  get unionPolygonStatusText(): string {
    if (!this.currentStep?.districtGroups?.length) return 'Not cached';
    const n = this.currentStep.districtGroups.length;
    const done = this.perGroupStatus?.filter(s => s.polygon === 'done').length ?? 0;
    if (done === n) return 'All cached';
    return `${done} of ${n} cached`;
  }

  /** Summary text for party % status. */
  get districtPartyStatusText(): string {
    if (!this.currentStep?.districtGroups?.length) return 'Not calculated';
    const n = this.currentStep.districtGroups.length;
    const done = this.perGroupStatus?.filter(s => s.party === 'done').length ?? 0;
    if (done === n) return 'All calculated';
    return `${done} of ${n} calculated`;
  }

  /** True when Party column should show status icon (in_progress/fail/missing) instead of percentage in dev mode. */
  showPartyStatusIcon(i: number): boolean {
    if (!this.isDevMode) return false;
    const st = this.getGroupStatusForIndex(i);
    return st != null && (st.party === 'in_progress' || st.party === 'fail' || st.party === 'missing');
  }

  /** Short display text for Party column: "D xx% · R yy%" when data exists, "–" otherwise. Works for both public and dev. */
  getGroupPartyDisplayText(group: DistrictGroup): string {
    if (!this.isFinalStepActive) return '–';
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    const d = this.districtPartyByGroupKey?.[groupKey];
    if (d && typeof d.pctDem === 'number') {
      const pctDem = (d.pctDem * 100).toFixed(1);
      const pctRep = (d.pctRep * 100).toFixed(1);
      return `D ${pctDem}% · R ${pctRep}%`;
    }
    return '–';
  }

  /** Tooltip for district row Party icon: show D/R % and vote count when party data is loaded. */
  getGroupPartyTooltip(group: DistrictGroup, status: PerGroupStatus | null): string {
    const groupKey = `${group.startDistrictNumber}-${group.endDistrictNumber}`;
    if (status?.party === 'done' && this.districtPartyByGroupKey?.[groupKey]) {
      const d = this.districtPartyByGroupKey[groupKey];
      const pctDem = (d.pctDem * 100).toFixed(1);
      const pctRep = (d.pctRep * 100).toFixed(1);
      const votes = (d.totalVotes ?? 0).toLocaleString();
      return `D ${pctDem}% · R ${pctRep}% · ${votes} votes`;
    }
    if (this.districtPartyByGroupKey?.[groupKey]) {
      const d = this.districtPartyByGroupKey[groupKey];
      const pctDem = (d.pctDem * 100).toFixed(1);
      const pctRep = (d.pctRep * 100).toFixed(1);
      const votes = (d.totalVotes ?? 0).toLocaleString();
      return `D ${pctDem}% · R ${pctRep}% · ${votes} votes`;
    }
    if (status?.party === 'done') return 'Party % calculated';
    if (status?.party === 'missing') return 'Click to calculate party %';
    return status?.party ?? '';
  }

  /** Returns HTML line for popup: "Party: D xx% · R yy% (votes)" or "" when no data. */
  private getPopupPartyLine(party: { pctDem: number; pctRep?: number; votesDem?: number; votesRep?: number; totalVotes?: number } | null): string {
    if (!party || typeof party.pctDem !== 'number') return '';
    const pctDem = (party.pctDem * 100).toFixed(1);
    const pctRep = (typeof party.pctRep === 'number' ? party.pctRep : 1 - party.pctDem) * 100;
    const pctRepStr = pctRep.toFixed(1);
    const votes = party.totalVotes != null ? (party.totalVotes as number).toLocaleString() : null;
    if (votes != null) {
      return `<strong>Party:</strong> D ${pctDem}% · R ${pctRepStr}% (${votes} votes)<br>`;
    }
    return `<strong>Party:</strong> D ${pctDem}% · R ${pctRepStr}%<br>`;
  }

  /** Message when party coloring is on but tract party data is not loaded for this state. */
  get partyDataUnavailableMessage(): string | null {
    if (!this.selectedState || this.selectedState === 'ALL') return null;
    if (!this.showPartyColor && !this.showTractBoundaries) return null;
    if (this.tractPartyByGeoid != null && Object.keys(this.tractPartyByGeoid).length > 0) return null;
    return 'Party data not loaded for this state. Run tract party persistence (POST /api/algorithm/tract-party-persistence).';
  }

  /** Fill opacity when coloring by party: 80%–100% so polygons are visible; scaled by opacity toggle. */
  getPartyFillOpacity(pctDem: number): number {
    const t = Math.max(0, Math.min(1, pctDem));
    const minOpacity = 0.8;
    const range = 1 - minOpacity;
    const distanceFrom50 = 2 * Math.abs(t - 0.5);
    return minOpacity + range * distanceFrom50;
  }

  /** Party color scale: 100 = 51%, 500 = 100%. Stops for interpolation. */
  private static readonly REPUBLICAN_STOPS: { v: number; hex: string }[] = [
    { v: 100, hex: '#FFCDD2' }, { v: 200, hex: '#EF9A9A' }, { v: 300, hex: '#E57373' },
    { v: 400, hex: '#EF5350' }, { v: 500, hex: '#F44336' }
  ];
  private static readonly DEMOCRATIC_STOPS: { v: number; hex: string }[] = [
    { v: 100, hex: '#BBDEFB' }, { v: 200, hex: '#90CAF9' }, { v: 300, hex: '#64B5F6' },
    { v: 400, hex: '#42A5F5' }, { v: 500, hex: '#2196F3' }
  ];

  /** Quantize value to nearest stop (100, 200, 300, 400, 500) and return that stop's exact hex. */
  private static colorFromStops(value: number, stops: { v: number; hex: string }[]): string {
    const v = Math.max(100, Math.min(500, value));
    const index = Math.min(4, Math.max(0, Math.round((v - 100) / 100)));
    return stops[index].hex;
  }

  /** Party color: majority party gets scale 100–500; use lowest scale (100) when majority is slim (e.g. 50.4% D). No tie band: D >= 0.5 → Democratic scale, D < 0.5 → Republican scale. */
  getTractColorByParty(pctDem: number): string {
    const t = Math.max(0, Math.min(1, pctDem));
    if (t >= 0.5) {
      const value = 100 + ((t - 0.5) / 0.5) * 400;
      return MapsPageComponent.colorFromStops(value, MapsPageComponent.DEMOCRATIC_STOPS);
    }
    const pctRep = 1 - t;
    const value = 100 + ((pctRep - 0.5) / 0.5) * 400;
    return MapsPageComponent.colorFromStops(value, MapsPageComponent.REPUBLICAN_STOPS);
  }

  /** Toggle party coloring and fetch tract party data if enabling. */
  togglePartyColor(): void {
    this.showPartyColor = !this.showPartyColor;
    if (this.showPartyColor && this.selectedState && this.selectedState !== 'ALL') {
      this.tractPartyByGeoid = null;
      this.geodistrictService.getTractParty(this.selectedState, 2024).subscribe({
        next: (res) => {
          this.tractPartyByGeoid = res.geoids || {};
          this.renderFinalDistricts();
          this.cdr.markForCheck();
        },
        error: () => {
          this.tractPartyByGeoid = null;
          this.showPartyColor = false;
          this.cdr.markForCheck();
        }
      });
      if (this.districtPartyPercentagesCalculated && this.finalStepNumber != null) {
        this.fetchDistrictPartyForCurrentStep();
      }
    } else if (!this.showPartyColor) {
      this.tractPartyByGeoid = null;
      this.renderFinalDistricts();
    }
    this.cdr.markForCheck();
  }

  // US View Methods
  private expandedStates: Set<string> = new Set();

  /**
   * Get US data for display in the summary row (from state-comparison API when loaded).
   */
  getUSData(source: '119th' | 'geodistricts' | 'swing', type: 'D' | 'R' | 'value'): string {
    const u = this.stateComparison?.us;
    if (u) {
      if (source === 'swing') return String(u.swing);
      if (source === '119th') return type === 'D' ? String(u.congressD) : String(u.congressR);
      if (source === 'geodistricts') return type === 'D' ? String(u.geodistrictsD) : String(u.geodistrictsR);
    }
    return '0';
  }

  /**
   * Get US data change indicator (optional; not populated initially).
   */
  getUSDataChange(_source: '119th' | 'geodistricts', _type: 'D' | 'R'): string | null {
    return null;
  }

  /**
   * Get state data for display in state rows (from state-comparison API; when All selected and party % available, use state-party-summaries for geodistricts and swing).
   * When state-party-summaries and state-comparison lack geodistricts data, derives from allStatesDistrictPartyByState (same data used for map coloring).
   */
  getStateData(stateCode: string, source: '119th' | 'geodistricts' | 'swing', type: 'D' | 'R' | 'value'): string {
    if (source === '119th') {
      const s = this.stateComparison?.states?.[stateCode];
      if (s) return type === 'D' ? String(s.congressD) : String(s.congressR);
      return '0';
    }
    const partySummary = this.statePartySummaries?.[stateCode];
    if (partySummary && (source === 'geodistricts' || source === 'swing')) {
      if (source === 'swing') return String(partySummary.swing);
      if (source === 'geodistricts') return type === 'D' ? String(partySummary.geodistrictsD) : String(partySummary.geodistrictsR);
    }
    const s = this.stateComparison?.states?.[stateCode];
    if (s) {
      if (source === 'swing') return String(s.swing);
      if (source === 'geodistricts') return type === 'D' ? String(s.geodistrictsD) : String(s.geodistrictsR);
    }
    // Fallback: derive from allStatesDistrictPartyByState (populated after map-polygons-all + district-party fetches)
    const districts = this.allStatesDistrictPartyByState[stateCode];
    if (districts && typeof districts === 'object' && (source === 'geodistricts' || source === 'swing')) {
      let geodistrictsD = 0;
      let geodistrictsR = 0;
      for (const d of Object.values(districts)) {
        if (d && typeof d.pctDem === 'number') {
          if (d.pctDem >= 0.5) geodistrictsD++;
          else geodistrictsR++;
        }
      }
      if (source === 'swing') {
        const congressD = parseInt(this.getStateData(stateCode, '119th', 'D'), 10) || 0;
        return String(geodistrictsD - congressD);
      }
      if (source === 'geodistricts') return type === 'D' ? String(geodistrictsD) : String(geodistrictsR);
    }
    return '0';
  }

  /**
   * Get state data change indicator (optional; not populated initially).
   */
  getStateDataChange(_stateCode: string, _source: '119th' | 'geodistricts', _type: 'D' | 'R'): string | null {
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
   * Get 2-digit Census state FIPS code for header (dev/maps step 0).
   */
  getStateFips(stateCode: string): string {
    if (!stateCode || stateCode === 'ALL') return '';
    return MapsPageComponent.stateCodeToFips[stateCode] ?? '';
  }

  /**
   * Tracts grouped by county FIPS, chunked every 100, for step-0 tract list (dev/maps). Empty when not step 0.
   * Prefers currentStep.districtGroups (same source as map/popup) when present; falls back to devTractList only when step has no tracts.
   * County FIPS normalized to 3 digits so numeric COUNTY_FIPS (e.g. IN) group correctly.
   */
  get tractsByCountyForList(): Array<{ countyFips: string; countyName?: string; countyPopulation: number; chunks: Array<{ start: number; end: number; tracts: GeoJsonFeature[] }> }> {
    if (this.currentStepIndex !== 0) return [];
    let tracts: GeoJsonFeature[];
    const hasStepTracts = this.currentStep?.districtGroups?.length &&
      this.currentStep.districtGroups.some(g => (g.censusTracts?.length ?? 0) > 0);
    if (hasStepTracts) {
      const allTracts = this.currentStep!.districtGroups!.flatMap(g => g.censusTracts || []);
      const byId = new Map<string, GeoJsonFeature>();
      for (const t of allTracts) {
        const id = this.getTractId(t);
        if (id && !byId.has(id)) byId.set(id, t);
      }
      tracts = Array.from(byId.values());
    } else if (this.isDevMode && (this.devTractList?.length ?? 0) > 0 && this.devTractListState === this.selectedState) {
      tracts = this.devTractList!;
    } else {
      return [];
    }
    if (tracts.length === 0) return [];
    const byId = new Map<string, GeoJsonFeature>();
    for (const t of tracts) {
      const id = this.getTractId(t);
      if (id && !byId.has(id)) byId.set(id, t);
    }
    const tractsDeduped = Array.from(byId.values());
    if (tractsDeduped.length === 0) return [];
    const byCounty = new Map<string, GeoJsonFeature[]>();
    for (const t of tractsDeduped) {
      const raw = t.properties?.['COUNTY_FIPS'] ?? (t.properties?.['GEOID'] != null ? String(t.properties['GEOID']).substring(2, 5) : '');
      const countyFips = String(raw).replace(/\D/g, '').padStart(3, '0');
      if (!byCounty.has(countyFips)) byCounty.set(countyFips, []);
      byCounty.get(countyFips)!.push(t);
    }
    const sortedCountyFips = Array.from(byCounty.keys()).sort();
    const result: Array<{ countyFips: string; countyName?: string; countyPopulation: number; chunks: Array<{ start: number; end: number; tracts: GeoJsonFeature[] }> }> = [];
    for (const countyFips of sortedCountyFips) {
      const countyTracts = (byCounty.get(countyFips) ?? []).slice().sort((a, b) => (this.getTractId(a) || '').localeCompare(this.getTractId(b) || ''));
      const countyPopulation = countyTracts.reduce((sum, t) => sum + (t.properties?.POPULATION ?? 0), 0);
      const countyName = countyTracts[0]?.properties?.['COUNTY'];
      const chunks: Array<{ start: number; end: number; tracts: GeoJsonFeature[] }> = [];
      const chunkSize = 100;
      for (let i = 0; i < countyTracts.length; i += chunkSize) {
        const slice = countyTracts.slice(i, i + chunkSize);
        chunks.push({ start: i + 1, end: i + slice.length, tracts: slice });
      }
      result.push({ countyFips, countyName, countyPopulation, chunks });
    }
    return result;
  }

  /** trackBy for county panels in tract list (by county FIPS). */
  trackByCountyFips(_index: number, county: { countyFips: string }): string {
    return county.countyFips;
  }

  /** trackBy for chunk panels in tract list (by chunk start index). */
  trackByChunkStart(_index: number, chunk: { start: number }): number {
    return chunk.start;
  }

  /** trackBy for tract rows in tract list (by tract ID). Arrow so ngFor invokes it with correct this. */
  trackByTractId = (_index: number, tract: GeoJsonFeature): string => {
    return this.getTractId(tract) ?? '';
  };

  /**
   * Icon name for tract list polygon column: check_circle (ok), error (missing), info (island), my_location (enclosed).
   */
  getTractPolygonIcon(tract: GeoJsonFeature): 'check_circle' | 'error' | 'info' | 'my_location' {
    const hasGeometry = !!(tract?.geometry && (tract.geometry.type === 'Polygon' || tract.geometry.type === 'MultiPolygon'));
    if (!hasGeometry) return 'error';
    const tractId = this.getTractId(tract);
    const islandIds = new Set(this.getStep0IslandTractsList().map(i => i.tractId));
    if (islandIds.has(tractId)) return 'info';
    if (tract.properties?.['ENCLOSED_BY'] || tract.properties?.['TRACT_GROUP_ID']) return 'my_location';
    return 'check_circle';
  }

  /**
   * Party label for tract list: R, D, or — when missing. Uses tractPartyByGeoid.
   */
  getTractPartyLabel(tract: GeoJsonFeature): string {
    if (!this.tractPartyByGeoid) return '—';
    const geoid = this.normalizeTractPartyGeoid(this.getTractId(tract));
    const row = this.tractPartyByGeoid[geoid];
    if (row == null) return '—';
    return row.pctDem > 0.5 ? 'D' : 'R';
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
    if (this.isSingleDistrictState(stateCode)) return;
    this.selectedState = stateCode;
    this.onStateChange();
  }

  /**
   * Get US row data for StateRowComponent
   */
  getUSRowData(): StateRowData {
    const congressD = parseInt(this.getUSData('119th', 'D'), 10) || 0;
    const congressR = parseInt(this.getUSData('119th', 'R'), 10) || 0;
    const geodistrictsD = parseInt(this.getUSData('geodistricts', 'D'), 10) || 0;
    const geodistrictsR = parseInt(this.getUSData('geodistricts', 'R'), 10) || 0;
    const districtCount = this.selectedState === 'ALL' ? this.usMapTotalDistricts : 435;
    const congressMarginD = congressD - congressR;
    const congressMarginR = congressR - congressD;
    const geodistrictsMarginD = geodistrictsD - geodistrictsR;
    const geodistrictsMarginR = geodistrictsR - geodistrictsD;
    const hasGeodistrictsPartyData =
      (this.statePartySummaries != null && Object.keys(this.statePartySummaries).length > 0) ||
      (this.allStatesDistrictPartyByState != null && Object.keys(this.allStatesDistrictPartyByState).some(
        (code) => this.allStatesDistrictPartyByState[code] && Object.keys(this.allStatesDistrictPartyByState[code]).length > 0
      ));
    return {
      stateCode: 'US',
      stateName: 'United States',
      districts: districtCount,
      congressD,
      congressR,
      congressDChange: congressMarginD > 0 ? congressMarginD : undefined,
      congressRChange: congressMarginR > 0 ? congressMarginR : undefined,
      geodistrictsD,
      geodistrictsR,
      geodistrictsDChange: geodistrictsMarginD > 0 ? geodistrictsMarginD : undefined,
      geodistrictsRChange: geodistrictsMarginR > 0 ? geodistrictsMarginR : undefined,
      swing: parseInt(this.getUSData('swing', 'value'), 10) || 0,
      hasGeodistrictsPartyData
    };
  }

  /**
   * Get state row data for StateRowComponent.
   * GeoDistricts column shows district-level delta from 119th Congress (D:+N in blue, R:+N in red when > 0).
   */
  getStateRowData(stateCode: string) {
    const state = this.states.find((s: { code: string }) => s.code === stateCode);
    const congressD = parseInt(this.getStateData(stateCode, '119th', 'D'), 10) || 0;
    const congressR = parseInt(this.getStateData(stateCode, '119th', 'R'), 10) || 0;
    const geodistrictsD = parseInt(this.getStateData(stateCode, 'geodistricts', 'D'), 10) || 0;
    const geodistrictsR = parseInt(this.getStateData(stateCode, 'geodistricts', 'R'), 10) || 0;
    const congressMarginD = congressD - congressR;
    const congressMarginR = congressR - congressD;
    const geodistrictsMarginD = geodistrictsD - geodistrictsR;
    const geodistrictsMarginR = geodistrictsR - geodistrictsD;
    const hasGeodistrictsPartyData =
      !!(this.statePartySummaries && this.statePartySummaries[stateCode]) ||
      !!(this.allStatesDistrictPartyByState[stateCode] && Object.keys(this.allStatesDistrictPartyByState[stateCode]).length > 0);
    return {
      stateCode: stateCode,
      stateName: state?.name,
      districts: state?.districts ?? 0,
      congressD,
      congressR,
      congressDChange: congressMarginD > 0 ? congressMarginD : undefined,
      congressRChange: congressMarginR > 0 ? congressMarginR : undefined,
      geodistrictsD,
      geodistrictsR,
      geodistrictsDChange: geodistrictsMarginD > 0 ? geodistrictsMarginD : undefined,
      geodistrictsRChange: geodistrictsMarginR > 0 ? geodistrictsMarginR : undefined,
      swing: parseInt(this.getStateData(stateCode, 'swing', 'value'), 10) || 0,
      hasGeodistrictsPartyData
    };
  }
}
