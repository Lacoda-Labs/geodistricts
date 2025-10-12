import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, DistrictGroup, GeodistrictOptions } from '../services/geodistrict-algorithm.service';
import { CongressionalDistrictsService } from '../services/congressional-districts.service';

@Component({
  selector: 'app-geodistrict-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './geodistrict-viewer.component.html',
  styleUrls: ['./geodistrict-viewer.component.scss']
})
export class GeodistrictViewerComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedState: string = 'CA';
  useDirectAPI: boolean = false; // Use backend proxy
  isLoading: boolean = false;
  errorMessage: string = '';
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  private groupMaps: Map<number, L.Map> = new Map();
  private stepOverviewMap: L.Map | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private geodistrictService: GeodistrictAlgorithmService,
    private congressionalDistrictsService: CongressionalDistrictsService
  ) {}

  ngOnInit(): void {
    // Auto-run algorithm for California on component initialization
    this.runAlgorithm();
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
    
    if (this.stepOverviewMap) {
      this.stepOverviewMap.remove();
      this.stepOverviewMap = null;
    }
  }

  private createGroupMap(groupIndex: number, group: DistrictGroup, color: string): void {
    const mapId = `groupMap${groupIndex}`;
    const mapElement = document.getElementById(mapId);
    
    if (!mapElement) {
      console.warn(`Map element with id ${mapId} not found`);
      return;
    }

    // Clean up existing map if it exists
    if (this.groupMaps.has(groupIndex)) {
      this.groupMaps.get(groupIndex)?.remove();
    }

    // Create new map
    const map = L.map(mapId, {
      zoomControl: true,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false
    }).setView([group.centroid.lat, group.centroid.lng], 8);

    // Add tile layer with minimal styling
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      className: 'minimal-tiles'
    }).addTo(map);

    // Add individual tract geometries (keeping combineTractGeometries function but not using it)
    if (group.censusTracts && group.censusTracts.length > 0) {
      // Add each tract as a separate feature
      group.censusTracts.forEach(tract => {
        if (tract.geometry) {
          L.geoJSON(tract.geometry, {
            style: {
              color: color,
              weight: 1,
              opacity: 1,//0.8,
              fillOpacity: 1,//0.6,
              fillColor: color
            }
          }).addTo(map);
        }
      });

      // Fit map to all tract bounds
      const allBounds = L.latLngBounds([]);
      group.censusTracts.forEach(tract => {
        if (tract.geometry) {
          const geoJson = L.geoJSON(tract.geometry);
          const bounds = geoJson.getBounds();
          if (bounds.isValid()) {
            allBounds.extend(bounds);
          }
        }
      });
      
      if (allBounds.isValid()) {
        map.fitBounds(allBounds, { padding: [10, 10] });
      }
    }

    this.groupMaps.set(groupIndex, map);
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

  onStepChange(): void {
    if (this.algorithmResult && this.currentStepIndex >= 0 && this.currentStepIndex < this.algorithmResult.steps.length) {
      this.currentStep = this.algorithmResult.steps[this.currentStepIndex];
      // Create maps for the new step after a short delay to ensure DOM is updated
      setTimeout(() => {
        this.createMapsForCurrentStep();
      }, 100);
    }
  }

  private createMapsForCurrentStep(): void {
    if (!this.currentStep) return;
    
    this.cleanupMaps();
    
    // Create the step overview map first
    this.createStepOverviewMap();
    
    // Then create individual group maps
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

    // Clean up existing map
    if (this.stepOverviewMap) {
      this.stepOverviewMap.remove();
    }

    // Create new map
    this.stepOverviewMap = L.map('stepOverviewMap', {
      zoomControl: true,
      attributionControl: true
    });

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      className: 'minimal-tiles'
    }).addTo(this.stepOverviewMap);

    // Add all district groups to the map
    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      
      // Add individual tract geometries instead of combined geometry
      group.censusTracts.forEach(tract => {
        if (tract.geometry) {
          const geoJson = L.geoJSON(tract.geometry, {
            style: {
              color: color,
              weight: 1,
              opacity: 1,//0.8,
              fillOpacity: 1,//0.6,
              fillColor: color
            }
          }).bindPopup(`
            <strong>Group ${index + 1}</strong><br>
            Districts: ${group.startDistrictNumber}-${group.endDistrictNumber}<br>
            Population: ${group.totalPopulation.toLocaleString()}<br>
            Tracts: ${group.censusTracts.length}
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

    // Fit map to show all groups
    if (hasBounds && bounds.isValid()) {
      this.stepOverviewMap.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  runAlgorithm(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.clearResults();

    const options: GeodistrictOptions = {
      state: this.selectedState,
      useDirectAPI: this.useDirectAPI,
      forceInvalidate: false,
      maxIterations: 100
    };

    const subscription = this.geodistrictService.runGeodistrictAlgorithm(options).subscribe({
      next: (result) => {
        this.algorithmResult = result;
        this.currentStepIndex = 0;
        this.currentStep = result.steps[0];
        this.isLoading = false;
        console.log('Algorithm completed:', result);
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
  calculatePopulationVariance(district: any): number {
    if (!this.algorithmResult?.averagePopulation) return 0;
    const targetPopulation = this.algorithmResult.averagePopulation;
    if (targetPopulation === 0) return 0;
    
    const difference = district.totalPopulation - targetPopulation;
    const percentageVariance = (difference / targetPopulation) * 100;
    return Math.abs(percentageVariance);
  }

  getTotalTracts(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    return this.algorithmResult.finalDistricts.reduce((total, district) => 
      total + district.censusTracts.length, 0);
  }

  getAveragePopulationVariance(): number {
    if (!this.algorithmResult?.finalDistricts) return 0;
    const totalVariance = this.algorithmResult.finalDistricts.reduce((total, district) => 
      total + this.calculatePopulationVariance(district), 0);
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

  private clearResults(): void {
    this.algorithmResult = null;
    this.currentStep = null;
    this.currentStepIndex = 0;
  }
}