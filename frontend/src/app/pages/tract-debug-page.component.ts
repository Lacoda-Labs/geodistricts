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
  templateUrl: './tract-debug-page.component.html',
  styleUrl: './tract-debug-page.component.scss'
})
export class TractDebugPageComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedState: string = 'AZ';
  selectedAlgorithm: string = 'latlong';
  useDirectAPI: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';

  // S4 adjacency data for accurate adjacency checking
  private s4AdjacencyData: Map<string, string[]> | null = null;

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


  stateData: GeoJsonResponse | null = null;
  sortedTracts: GeoJsonFeature[] = [];
  currentTractIndex: number = 0;
  map: any = null;
  tractLayers: any[] = [];
  sweepLineLayer: any = null; // Layer for drawing the sweep line visualization
  sweepMarkers: any[] = []; // Markers for sweep line visualization (midpoint and intersection)
  
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
    // Auto-load state data if default state is set
    if (this.selectedState) {
      this.loadStateData();
    }
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


  onSettingsChange() {
    console.log('Settings changed - useDirectAPI:', this.useDirectAPI);
  }



  updateMapLayers() {
    // Clear existing layers
    if (this.tractLayers) {
      this.tractLayers.forEach(layer => this.map.removeLayer(layer));
      this.tractLayers = [];
    }
    
    // Add new layers
    this.addTractLayers();
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

    // Load both tract data and S4 adjacency data
    Promise.all([
      this.censusService.getTractDataWithBoundaries(this.selectedState, undefined, false).toPromise(),
      this.loadS4AdjacencyData()
    ]).then(([data, s4Data]) => {
      console.log(`Loaded ${data!.boundaries.features.length} tracts for ${this.selectedState}`);
      this.stateData = data!.boundaries;
      this.s4AdjacencyData = s4Data;
      console.log(`Loaded S4 adjacency data for ${this.selectedState}: ${s4Data ? s4Data.size : 0} tracts`);
      
      this.sortTracts().then(() => {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
          this.initializeMap();
          // Auto-select the first tract after sorting
          if (this.sortedTracts.length > 0) {
            this.selectTract(0);
          }
        }, 100);
      });
      this.isLoading = false;
    }).catch((error) => {
      console.error('Error loading state data:', error);
      this.errorMessage = `Failed to load data for ${this.selectedState}: ${error.message}`;
      this.isLoading = false;
    });
  }

  /**
   * Load S4 adjacency data for the selected state
   * @returns Promise with S4 adjacency data
   */
  private async loadS4AdjacencyData(): Promise<Map<string, string[]> | null> {
    try {
      console.log(`📥 Loading S4 adjacency data for ${this.selectedState}...`);
      return await this.geodistrictAlgorithmService.loadS4AdjacencyData(this.selectedState);
    } catch (error) {
      console.warn(`⚠️ Failed to load S4 adjacency data for ${this.selectedState}:`, error);
      return null;
    }
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
    this.map = L.map('stateMap', {
      scrollWheelZoom: false
    }).fitBounds(bounds);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Add map click handler to show coordinates
    this.map.on('click', (e: any) => {
      const latlng = e.latlng;
      const popupContent = `Click Location<br>Lat: ${latlng.lat.toFixed(6)}<br>Lng: ${latlng.lng.toFixed(6)}`;
      L.popup()
        .setLatLng(latlng)
        .setContent(popupContent)
        .openOn(this.map);
    });

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
    
    // Clear sweep line visualization
    this.clearSweepLine();

    // Add each tract as a layer (in sorted order for debugging)
    this.sortedTracts.forEach((tract, index) => {
      const layer = L.geoJSON(tract, {
        style: {
          color: 'black',
          weight: 1,
          fillColor: '#6c757d',
          fillOpacity: 1
        }
      }).addTo(this.map);

      // Bind popup with click coordinates
      layer.on('click', (e: any) => {
        const latlng = e.latlng;
        const tractInfo = `Tract: ${tract.properties?.['TRACTCE'] || tract.properties?.['TRACT_FIPS'] || 'unknown'} (${this.getTractId(tract)})<br>Click: (${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)})`;
        layer.bindPopup(tractInfo).openPopup();
        this.selectTract(index);
      });

      // Set default popup (will be updated on click with coordinates)
      layer.bindPopup(`Tract: ${tract.properties?.['TRACTCE'] || tract.properties?.['TRACT_FIPS'] || 'unknown'} (${this.getTractId(tract)})`);

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

    // Find all adjacent tracts first (excluding current)
    const currentAdjacentIndices: number[] = [];
    for (let i = 0; i < this.sortedTracts.length; i++) {
      if (i !== this.currentTractIndex && this.isAdjacentTract(i)) {
        currentAdjacentIndices.push(i);
      }
    }

    // Update all tracts with proper styling
    for (let i = 0; i < this.sortedTracts.length; i++) {
      if (i <= this.currentTractIndex) {
        // All tracts from 0 to currentTractIndex (inclusive): visited (dark #444444)
        this.updateTractStyle(i, 'visited');
      } else if (currentAdjacentIndices.includes(i)) {
        // Adjacent tract that is beyond current: adjacent (yellow)
        this.updateTractStyle(i, 'adjacent');
      } else {
        // Unvisited tract: default (gray)
        this.updateTractStyle(i, 'default');
      }
    }
    
    // Override current tract with selected style (red) - this overrides the visited style
    this.updateTractStyle(this.currentTractIndex, 'selected');
    
    this.previousSelectedIndex = this.currentTractIndex;
    this.previousAdjacentIndices = currentAdjacentIndices;
  }

  private updateTractStyle(index: number, style: 'default' | 'selected' | 'adjacent' | 'visited') {
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
      case 'visited':
        color = '#444444';
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
      // Clear sweep line when selecting a different tract
      this.clearSweepLine();
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
    
    let isAdjacent = false;
    
    // Use S4 adjacency data if available, otherwise fall back to geometric boundary intersection
    if (this.s4AdjacencyData) {
      // Convert tract IDs to S4 format (full FIPS code)
      const currentS4Id = this.convertToS4TractId(currentId);
      const otherS4Id = this.convertToS4TractId(otherId);
      
      // Debug: Log the conversion
      if (currentId !== currentS4Id || otherId !== otherS4Id) {
        console.log(`🔄 ID Conversion: ${currentId} -> ${currentS4Id}, ${otherId} -> ${otherS4Id}`);
      }
      
      // Debug: Log some sample S4 data keys for the first check
      if (currentId === this.getTractId(this.getCurrentTract()!) && this.s4AdjacencyData.size > 0) {
        const sampleKeys = Array.from(this.s4AdjacencyData.keys()).slice(0, 5);
        // console.log(`🔍 Sample S4 data keys:`, sampleKeys);
        // console.log(`🔍 Original tract ID: ${currentId}`);
        // console.log(`🔍 Converted to S4: ${currentS4Id}`);
        // console.log(`🔍 Has key: ${this.s4AdjacencyData.has(currentS4Id)}`);
        
        // Try to find a similar key
        const similarKeys = Array.from(this.s4AdjacencyData.keys()).filter(key => 
          key.includes(currentId.substring(0, 3)) || key.includes(currentId.substring(3, 6))
        ).slice(0, 3);
        if (similarKeys.length > 0) {
          // console.log(`🔍 Similar keys found:`, similarKeys);
        }
      }
      
      // Check if the current tract has the other tract as a neighbor in S4 data
      const neighbors = this.s4AdjacencyData.get(currentS4Id);
      isAdjacent = neighbors ? neighbors.includes(otherS4Id) : false;
      
      // Only log successful matches to reduce noise
      if (isAdjacent) {
        // console.log(`✅ S4 Adjacency Match: ${currentS4Id} -> ${otherS4Id}`);
      }
    } else {
      // Fallback to geometric boundary intersection
      console.log(`⚠️ S4 adjacency data not available, using geometric boundary intersection`);
      isAdjacent = this.censusService.areTractsAdjacent(currentTract, otherTract);
    }
    
    // Cache the result
    this.adjacencyCache.set(cacheKey, isAdjacent);
    
    return isAdjacent;
  }

  /**
   * Convert tract ID to S4 format
   * If we're getting the full GEOID (11 digits), we can use it directly
   * Otherwise, we need to construct it from the available parts
   */
  private convertToS4TractId(tractId: string): string {
    // If it's already 11 digits, it's likely the full GEOID
    if (tractId.length === 11) {
      // console.log(`✅ Using 11-digit GEOID directly: ${tractId}`);
      return tractId;
    }
    
    // If it's 8 digits, it might be state + county + tract (2+3+3)
    if (tractId.length === 8) {
      console.log(`✅ Using 8-digit ID directly: ${tractId}`);
      return tractId;
    }
    
    // For shorter IDs, we need to construct the full GEOID
    // This is a fallback case - ideally we should be getting the full GEOID
    const stateFips = this.getStateFipsCode(this.selectedState);
    
    if (tractId.length === 6) {
      // Assume first 3 are county, last 3 are tract
      const county = tractId.substring(0, 3);
      const tract = tractId.substring(3, 6).padStart(6, '0');
      const constructed = stateFips + county + tract;
      console.log(`🔧 Constructed 11-digit GEOID: ${constructed} from ${tractId}`);
      return constructed;
    }
    
    // Fallback: pad to 11 digits
    const padded = tractId.padStart(11, '0');
    console.log(`⚠️ Padded to 11 digits: ${padded} from ${tractId}`);
    return padded;
  }

  getAdjacentTracts(): GeoJsonFeature[] {
    if (!this.getCurrentTract()) {
      return [];
    }

    return this.sortedTracts.filter((_, index) => this.isAdjacentTract(index));
  }

  /**
   * Get adjacent tracts sorted in geographic clockwise order
   * Order: Northeast > East > Southeast > South > Southwest > West > Northwest > North
   */
  getAdjacentTractsSorted(): GeoJsonFeature[] {
    const adjacentTracts = this.getAdjacentTracts();
    // console.log('🔍 getAdjacentTractsSorted called, found', adjacentTracts.length, 'adjacent tracts');
    
    if (adjacentTracts.length === 0) {
      console.log('📭 No adjacent tracts found');
      return [];
    }

    const currentTract = this.getCurrentTract()!;
    const currentCentroid = this.getTractCentroid(currentTract);
    // console.log('📍 Current tract centroid:', currentCentroid);

    // Sort adjacent tracts by angle from current tract centroid
    const sortedTracts = adjacentTracts.sort((a, b) => {
      const aCentroid = this.getTractCentroid(a);
      const bCentroid = this.getTractCentroid(b);

      // Calculate angles from current centroid to each adjacent tract
      const aAngle = Math.atan2(aCentroid.lat - currentCentroid.lat, aCentroid.lng - currentCentroid.lng);
      const bAngle = Math.atan2(bCentroid.lat - currentCentroid.lat, bCentroid.lng - currentCentroid.lng);

      // Convert angles to clockwise order starting from North (0°)
      // North = 0°, East = 90°, South = 180°, West = 270°
      // We want: Northeast > East > Southeast > South > Southwest > West > Northwest > North
      // This means we need to adjust the angle calculation
      
      // Convert to clockwise from North (0°)
      let aClockwise = (Math.PI / 2) - aAngle; // Rotate 90° counterclockwise
      let bClockwise = (Math.PI / 2) - bAngle;
      
      // Normalize to 0-2π range
      if (aClockwise < 0) aClockwise += 2 * Math.PI;
      if (bClockwise < 0) bClockwise += 2 * Math.PI;

      return aClockwise - bClockwise;
    });

    // console.log('🔄 Sorted adjacent tracts:', sortedTracts.map(t => ({
    //   id: this.getTractId(t),
    //   direction: this.getDirectionFromCenter(t),
    //   centroid: this.getTractCentroid(t)
    // })));

    return sortedTracts;
  }


  /**
   * Draw a line from geometric midpoint through the first intersection with adjacent tract boundary
   */
  private drawSweepLine(currentTract: GeoJsonFeature, adjacentTract: GeoJsonFeature) {
    if (!this.map) {
      console.error('⚠️ Map not initialized, cannot draw sweep line');
      return;
    }

    console.log('🎨 Drawing sweep line visualization...');

    // Clear existing sweep line
    this.clearSweepLine();

    const currentMidpoint = this.getGeometricMidpoint(currentTract);
    const adjacentMidpoint = this.getGeometricMidpoint(adjacentTract);

    console.log(`📍 Current midpoint: (${currentMidpoint.lat.toFixed(6)}, ${currentMidpoint.lng.toFixed(6)})`);
    console.log(`📍 Adjacent midpoint: (${adjacentMidpoint.lat.toFixed(6)}, ${adjacentMidpoint.lng.toFixed(6)})`);

    // Calculate direction from current midpoint toward adjacent midpoint
    const dx = adjacentMidpoint.lng - currentMidpoint.lng;
    const dy = adjacentMidpoint.lat - currentMidpoint.lat;
    
    // Find the intersection point where the ray first hits the adjacent tract's boundary
    const intersectionPoint = this.findLinePolygonIntersection(
      currentMidpoint,
      { lat: adjacentMidpoint.lat, lng: adjacentMidpoint.lng },
      adjacentTract
    );

    if (intersectionPoint) {
      console.log(`✅ Found intersection point: (${intersectionPoint.lat.toFixed(6)}, ${intersectionPoint.lng.toFixed(6)})`);
      
      // Draw line from current midpoint to intersection point
      // Leaflet expects coordinates as [lat, lng] arrays
      const lineCoordinates = [
        [currentMidpoint.lat, currentMidpoint.lng],
        [intersectionPoint.lat, intersectionPoint.lng]
      ];

      try {
        this.sweepLineLayer = L.polyline(lineCoordinates, {
          color: '#ff0000',
          weight: 3,
          opacity: 0.8,
          dashArray: '10, 5'
        }).addTo(this.map);
        console.log('✅ Sweep line polyline added to map');

        // Add a marker at the intersection point
        const intersectionMarker = L.marker([intersectionPoint.lat, intersectionPoint.lng], {
          icon: L.divIcon({
            className: 'sweep-intersection-marker',
            html: '<div style="background-color: red; width: 8px; height: 8px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
          })
        }).addTo(this.map).bindPopup(`Intersection Point<br>(${intersectionPoint.lat.toFixed(6)}, ${intersectionPoint.lng.toFixed(6)})`);
        this.sweepMarkers.push(intersectionMarker);
        console.log('✅ Intersection marker added');

        // Add a marker at the geometric midpoint
        const midpointMarker = L.marker([currentMidpoint.lat, currentMidpoint.lng], {
          icon: L.divIcon({
            className: 'geometric-midpoint-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          })
        }).addTo(this.map).bindPopup(`Geometric Midpoint<br>(${currentMidpoint.lat.toFixed(6)}, ${currentMidpoint.lng.toFixed(6)})`);
        this.sweepMarkers.push(midpointMarker);
        console.log('✅ Midpoint marker added');
      } catch (error) {
        console.error('❌ Error adding sweep line to map:', error);
      }
    } else {
      console.log(`⚠️ Could not find intersection point, drawing fallback line to adjacent midpoint`);
      
      // Fallback: draw line to adjacent midpoint if intersection calculation fails
      const lineCoordinates = [
        [currentMidpoint.lat, currentMidpoint.lng],
        [adjacentMidpoint.lat, adjacentMidpoint.lng]
      ];

      try {
        this.sweepLineLayer = L.polyline(lineCoordinates, {
          color: '#ff0000',
          weight: 2,
          opacity: 0.6,
          dashArray: '5, 5'
        }).addTo(this.map);
        console.log('✅ Fallback line added to map');

        // Still add markers for visibility
        const midpointMarker = L.marker([currentMidpoint.lat, currentMidpoint.lng], {
          icon: L.divIcon({
            className: 'geometric-midpoint-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          })
        }).addTo(this.map).bindPopup(`Geometric Midpoint<br>(${currentMidpoint.lat.toFixed(6)}, ${currentMidpoint.lng.toFixed(6)})`);
        this.sweepMarkers.push(midpointMarker);

        const adjacentMarker = L.marker([adjacentMidpoint.lat, adjacentMidpoint.lng], {
          icon: L.divIcon({
            className: 'adjacent-midpoint-marker',
            html: '<div style="background-color: orange; width: 8px; height: 8px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
          })
        }).addTo(this.map).bindPopup(`Adjacent Midpoint<br>(${adjacentMidpoint.lat.toFixed(6)}, ${adjacentMidpoint.lng.toFixed(6)})`);
        this.sweepMarkers.push(adjacentMarker);
      } catch (error) {
        console.error('❌ Error adding fallback line to map:', error);
      }
    }
  }

  /**
   * Clear the sweep line visualization
   */
  private clearSweepLine() {
    if (this.map) {
      // Remove sweep line layer
      if (this.sweepLineLayer) {
        this.map.removeLayer(this.sweepLineLayer);
        this.sweepLineLayer = null;
      }
      
      // Remove all sweep markers
      this.sweepMarkers.forEach(marker => {
        if (this.map.hasLayer(marker)) {
          this.map.removeLayer(marker);
        }
      });
      this.sweepMarkers = [];
    }
  }

  /**
   * Find the intersection point where a ray from start point toward end point
   * first intersects with a polygon's boundary
   */
  private findLinePolygonIntersection(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    polygon: GeoJsonFeature
  ): { lat: number; lng: number } | null {
    if (!polygon.geometry) {
      console.log('⚠️ No geometry in polygon');
      return null;
    }

    // Get the outer ring of the polygon (first ring for Polygon, first ring of first polygon for MultiPolygon)
    let outerRing: number[][] = [];
    
    if (polygon.geometry.type === 'Polygon') {
      // First ring is the outer boundary
      if (polygon.geometry.coordinates && polygon.geometry.coordinates[0]) {
        outerRing = polygon.geometry.coordinates[0];
      }
    } else if (polygon.geometry.type === 'MultiPolygon') {
      // First ring of first polygon is the outer boundary
      if (polygon.geometry.coordinates && polygon.geometry.coordinates[0] && polygon.geometry.coordinates[0][0]) {
        outerRing = polygon.geometry.coordinates[0][0];
      }
    }

    if (outerRing.length < 3) {
      console.log(`⚠️ Outer ring has only ${outerRing.length} points, need at least 3`);
      return null;
    }

    console.log(`🔍 Checking intersection with polygon outer ring (${outerRing.length} points)`);

    // Convert ray to parametric form: P(t) = start + t * (end - start)
    const rayDx = end.lng - start.lng;
    const rayDy = end.lat - start.lat;
    
    let closestIntersection: { lat: number; lng: number; t: number } | null = null;

    // Check intersection with each edge of the polygon outer ring
    for (let i = 0; i < outerRing.length - 1; i++) {
      const p1 = outerRing[i];
      const p2 = outerRing[i + 1];
      
      // Skip if coordinates are invalid
      if (!p1 || !p2 || p1.length < 2 || p2.length < 2) continue;
      
      // Edge from p1 to p2 (coordinates are [lng, lat] in GeoJSON)
      const edgeDx = p2[0] - p1[0]; // lng difference
      const edgeDy = p2[1] - p1[1]; // lat difference

      // Solve for intersection: start + t * ray = p1 + s * edge
      // Using parametric form: ray: (start.lng + t*rayDx, start.lat + t*rayDy)
      //                        edge: (p1[0] + s*edgeDx, p1[1] + s*edgeDy)
      const denominator = rayDx * edgeDy - rayDy * edgeDx;
      
      if (Math.abs(denominator) < 1e-10) {
        // Lines are parallel, skip
        continue;
      }

      const t = ((p1[0] - start.lng) * edgeDy - (p1[1] - start.lat) * edgeDx) / denominator;
      const s = ((p1[0] - start.lng) * rayDy - (p1[1] - start.lat) * rayDx) / denominator;

      // Check if intersection is on the ray (t >= 0) and on the edge segment (0 <= s <= 1)
      if (t >= 0 && t <= 10 && s >= 0 && s <= 1) { // Limit t to reasonable range (within 10x distance)
        const intersection = {
          lat: start.lat + t * rayDy,
          lng: start.lng + t * rayDx,
          t: t
        };

        // Keep the closest intersection (smallest t, meaning earliest along the ray)
        if (!closestIntersection || intersection.t < closestIntersection.t) {
          closestIntersection = intersection;
        }
      }
    }

    if (closestIntersection) {
      console.log(`✅ Found intersection at t=${closestIntersection.t.toFixed(6)}`);
      return { lat: closestIntersection.lat, lng: closestIntersection.lng };
    }

    // If no intersection found with edges, return null (fallback to midpoint)
    console.log('⚠️ No intersection found with polygon edges');
    return null;
  }

  /**
   * Get the cardinal direction of an adjacent tract relative to the current tract
   */
  getDirectionFromCenter(adjacentTract: GeoJsonFeature): string {
    const currentTract = this.getCurrentTract();
    if (!currentTract) {
      console.log('⚠️ No current tract for direction calculation');
      return 'Unknown';
    }

    const currentCentroid = this.getTractCentroid(currentTract);
    const adjacentCentroid = this.getTractCentroid(adjacentTract);

    // Calculate angle from current tract to adjacent tract
    const angle = Math.atan2(adjacentCentroid.lat - currentCentroid.lat, adjacentCentroid.lng - currentCentroid.lng);
    
    // Convert to degrees and normalize to 0-360 range
    let degrees = (angle * 180 / Math.PI);
    if (degrees < 0) degrees += 360;

    // Determine cardinal direction based on angle
    // North = 0°, East = 90°, South = 180°, West = 270°
    let direction = 'Unknown';
    if (degrees >= 337.5 || degrees < 22.5) direction = 'North';
    else if (degrees >= 22.5 && degrees < 67.5) direction = 'Northeast';
    else if (degrees >= 67.5 && degrees < 112.5) direction = 'East';
    else if (degrees >= 112.5 && degrees < 157.5) direction = 'Southeast';
    else if (degrees >= 157.5 && degrees < 202.5) direction = 'South';
    else if (degrees >= 202.5 && degrees < 247.5) direction = 'Southwest';
    else if (degrees >= 247.5 && degrees < 292.5) direction = 'West';
    else if (degrees >= 292.5 && degrees < 337.5) direction = 'Northwest';
    
    // console.log(`🧭 Direction calculation: ${this.getTractId(adjacentTract)} at ${degrees.toFixed(1)}° = ${direction}`);
    return direction;
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
    // Debug: Log tract properties for the first few tracts
    // if (Math.random() < 0.01) {
    //   console.log('🔍 Tract properties:', Object.keys(tract.properties || {}));
    //   console.log('🔍 Sample tract properties:', tract.properties);
    // }

    // Try GEOID first (should be the full 11-digit FIPS code)
    if (tract.properties?.['GEOID']) {
      // console.log(`✅ Found GEOID: ${tract.properties['GEOID']}`);
      return tract.properties['GEOID'];
    }

    // Try other possible ID fields
    if (tract.properties?.['geoid']) {
      console.log(`✅ Found geoid: ${tract.properties['geoid']}`);
      return tract.properties['geoid'];
    }

    if (tract.properties?.['id']) {
      console.log(`✅ Found id: ${tract.properties['id']}`);
      return tract.properties['id'];
    }

    // Try TRACT_FIPS or similar - but only if it's a full GEOID
    if (tract.properties?.['TRACT_FIPS'] && tract.properties['TRACT_FIPS'].length >= 11) {
      console.log(`✅ Found TRACT_FIPS (11+ digits): ${tract.properties['TRACT_FIPS']}`);
      return tract.properties['TRACT_FIPS'];
    }

    if (tract.properties?.['TRACTID']) {
      console.log(`✅ Found TRACTID: ${tract.properties['TRACTID']}`);
      return tract.properties['TRACTID'];
    }

    // Try to construct GEOID from available fields
    const stateFips = tract.properties?.['STATE_FIPS'] || tract.properties?.['STATE'];
    const countyFips = tract.properties?.['COUNTY_FIPS'] || tract.properties?.['COUNTY'];
    const tractFips = tract.properties?.['TRACT_FIPS'] || tract.properties?.['TRACT'];
    
    if (stateFips && countyFips && tractFips) {
      // Construct full GEOID: state + county + tract (padded to 6 digits)
      const fullGEOID = stateFips.padStart(2, '0') + countyFips.padStart(3, '0') + tractFips.padStart(6, '0');
      // console.log(`🔧 Constructed GEOID: ${fullGEOID} from STATE=${stateFips}, COUNTY=${countyFips}, TRACT=${tractFips}`);
      return fullGEOID;
    }

    // Fallback to original logic
    const fallbackId = tract.properties?.TRACT_FIPS || tract.properties?.TRACT || 'Unknown';
    console.log(`⚠️ Using fallback ID: ${fallbackId}`);
    return fallbackId;
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

  /**
   * Get the geometric midpoint (center of bounding box)
   * This gives the true center based on boundaries, not vertex distribution
   */
  getGeometricMidpoint(tract: GeoJsonFeature): { lat: number; lng: number } {
    const bounds = this.getTractBounds(tract);
    return {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2
    };
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
