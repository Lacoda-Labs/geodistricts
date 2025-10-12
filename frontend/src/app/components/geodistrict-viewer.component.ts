import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { GeodistrictAlgorithmService, GeodistrictResult, GeodistrictStep, DistrictGroup, GeodistrictOptions } from '../services/geodistrict-algorithm.service';
import { CongressionalDistrictsService } from '../services/congressional-districts.service';

@Component({
  selector: 'app-geodistrict-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="geodistrict-viewer">
      <div class="header">
        <h1>Geodistrict Algorithm Visualization</h1>
        <p>Visualizing the Fresh Approach algorithm for creating congressional districts</p>
      </div>

      <div class="controls">
        <div class="control-group">
          <label for="stateSelect">State:</label>
          <select id="stateSelect" [(ngModel)]="selectedState" (change)="onStateChange()">
            <option value="CA">California (52 districts)</option>
            <option value="TX">Texas (38 districts)</option>
            <option value="FL">Florida (28 districts)</option>
            <option value="NY">New York (26 districts)</option>
            <option value="PA">Pennsylvania (17 districts)</option>
            <option value="IL">Illinois (17 districts)</option>
            <option value="OH">Ohio (15 districts)</option>
            <option value="GA">Georgia (14 districts)</option>
            <option value="NC">North Carolina (14 districts)</option>
            <option value="MI">Michigan (13 districts)</option>
          </select>
        </div>

        <div class="control-group">
          <label>
            <input type="checkbox" [(ngModel)]="useDirectAPI" (change)="onSettingsChange()">
            Use Direct Census API (development only - production uses Secret Manager)
          </label>
        </div>

        <div class="control-group">
          <button (click)="runAlgorithm()" [disabled]="isLoading">
            {{ isLoading ? 'Running Algorithm...' : 'Run Geodistrict Algorithm' }}
          </button>
        </div>
      </div>

      <div class="results" *ngIf="algorithmResult">
        <div class="summary">
          <h2>Algorithm Results</h2>
          <div class="stats">
            <div class="stat">
              <span class="label">Total Population:</span>
              <span class="value">{{ algorithmResult.totalPopulation.toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="label">Average District Population:</span>
              <span class="value">{{ algorithmResult.averagePopulation.toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="label">Population Variance:</span>
              <span class="value">{{ algorithmResult.populationVariance.toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="label">Total Districts:</span>
              <span class="value">{{ algorithmResult.finalDistricts.length }}</span>
            </div>
          </div>
        </div>

        <div class="step-navigation">
          <h3>Algorithm Steps</h3>
          <div class="step-controls">
            <button (click)="previousStep()" [disabled]="currentStepIndex <= 0">Previous</button>
            <span class="step-info">
              Step {{ currentStepIndex + 1 }} of {{ algorithmResult.steps.length }}
            </span>
            <button (click)="nextStep()" [disabled]="currentStepIndex >= algorithmResult.steps.length - 1">Next</button>
          </div>
          
          <div class="step-selector">
            <label for="stepSelect">Jump to Step:</label>
            <select id="stepSelect" [(ngModel)]="currentStepIndex" (change)="onStepChange()">
              <option *ngFor="let step of algorithmResult.steps; let i = index" [value]="i">
                Step {{ i + 1 }}: {{ step.description }}
              </option>
            </select>
          </div>
        </div>

        <div class="current-step" *ngIf="currentStep">
          <h3>{{ currentStep.description }}</h3>
          <div class="step-details">
            <div class="step-meta">
              <span class="label">Level:</span> {{ currentStep.level }}
              <span class="label">Groups:</span> {{ currentStep.totalGroups }}
              <span class="label">Total Districts:</span> {{ currentStep.totalDistricts }}
              <span class="label">Direction:</span> {{ currentStep.divisionDirection }}
            </div>
          </div>

          <div class="step-overview-map">
            <h4>Step Overview Map</h4>
            <div class="full-width-map-container">
              <div id="stepOverviewMap" class="step-overview-map-view"></div>
            </div>
          </div>

          <div class="district-groups">
            <h4>District Groups ({{ currentStep.districtGroups.length }})</h4>
            <div class="groups-grid">
              <div *ngFor="let group of currentStep.districtGroups; let i = index" 
                   class="district-group" 
                   [style.background-color]="getGroupColor(i)">
                <div class="group-map">
                  <div [id]="'groupMap' + i" class="mini-map"></div>
                </div>
                
                <div class="group-content">
                  <div class="group-header">
                    <h5>Group {{ i + 1 }}</h5>
                    <span class="district-range">
                      Districts {{ group.startDistrictNumber }}-{{ group.endDistrictNumber }}
                    </span>
                  </div>
                  
                  <div class="group-stats">
                  <div class="stat">
                    <span class="label">Tracts:</span>
                    <span class="value">{{ group.censusTracts.length }}</span>
                  </div>
                  <div class="stat">
                    <span class="label">Population:</span>
                    <span class="value">{{ group.totalPopulation.toLocaleString() }}</span>
                  </div>
                  <div class="stat">
                    <span class="label">Target Districts:</span>
                    <span class="value">{{ group.totalDistricts }}</span>
                  </div>
                </div>
                <div class="group-bounds">
                  <div class="bound">
                    <span class="label">North:</span> {{ group.bounds.north.toFixed(4) }}
                  </div>
                  <div class="bound">
                    <span class="label">South:</span> {{ group.bounds.south.toFixed(4) }}
                  </div>
                  <div class="bound">
                    <span class="label">East:</span> {{ group.bounds.east.toFixed(4) }}
                  </div>
                  <div class="bound">
                    <span class="label">West:</span> {{ group.bounds.west.toFixed(4) }}
                  </div>
                </div>
                <div class="group-centroid">
                  <span class="label">Centroid:</span> 
                  ({{ group.centroid.lat.toFixed(4) }}, {{ group.centroid.lng.toFixed(4) }})
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="final-districts">
          <h3>Final Geodistricts</h3>
          
          <div class="district-stats">
            <div class="stat-card">
              <h4>Population Statistics</h4>
              <div class="stat-item">
                <span class="label">Average Population:</span>
                <span class="value">{{ algorithmResult.averagePopulation.toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Population Variance:</span>
                <span class="value">{{ algorithmResult.populationVariance.toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Standard Deviation:</span>
                <span class="value">{{ getPopulationStdDev().toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Min Population:</span>
                <span class="value">{{ getMinPopulation().toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Max Population:</span>
                <span class="value">{{ getMaxPopulation().toLocaleString() }}</span>
              </div>
            </div>
            
            <div class="stat-card">
              <h4>District Statistics</h4>
              <div class="stat-item">
                <span class="label">Total Districts:</span>
                <span class="value">{{ algorithmResult.finalDistricts.length }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Total Tracts:</span>
                <span class="value">{{ getTotalTracts() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Average Tracts per District:</span>
                <span class="value">{{ getAverageTractsPerDistrict().toFixed(1) }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Target Population per District:</span>
                <span class="value">{{ algorithmResult.averagePopulation.toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="label">Average Population Variance:</span>
                <span class="value">{{ getAveragePopulationVariance().toFixed(2) }}%</span>
              </div>
            </div>
          </div>
          
          <div class="districts-table-container">
            <table class="districts-table">
              <thead>
                <tr>
                  <th>District</th>
                  <th>Population</th>
                  <th>Tracts</th>
                  <th>Population Variance</th>
                  <th>Centroid</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let district of algorithmResult.finalDistricts; let i = index" 
                    class="district-row">
                  <td class="district-number">{{ district.startDistrictNumber }}</td>
                  <td class="population">{{ district.totalPopulation.toLocaleString() }}</td>
                  <td class="tract-count">{{ district.censusTracts.length }}</td>
                  <td class="population-variance">{{ calculatePopulationVariance(district).toFixed(2) }}%</td>
                  <td class="centroid">
                    {{ district.centroid.lat.toFixed(4) }}, {{ district.centroid.lng.toFixed(4) }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="summary-row">
                  <td><strong>Total</strong></td>
                  <td><strong>{{ algorithmResult.totalPopulation.toLocaleString() }}</strong></td>
                  <td><strong>{{ getTotalTracts() }}</strong></td>
                  <td><strong>{{ getAveragePopulationVariance().toFixed(2) }}%</strong></td>
                  <td><strong>Average</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="algorithm-history">
          <h3>Algorithm History</h3>
          <div class="history-log">
            <div *ngFor="let entry of algorithmResult.algorithmHistory; let i = index" 
                 class="history-entry">
              <span class="step-number">{{ i + 1 }}.</span>
              <span class="entry-text">{{ entry }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="error" *ngIf="errorMessage">
        <h3>Error</h3>
        <p>{{ errorMessage }}</p>
        <button (click)="clearError()">Clear Error</button>
      </div>

      <div class="loading" *ngIf="isLoading">
        <div class="spinner"></div>
        <p>Running geodistrict algorithm...</p>
      </div>
    </div>
  `,
  styles: [`
    .geodistrict-viewer {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
    }

    .header h1 {
      color: #2c3e50;
      margin-bottom: 10px;
    }

    .header p {
      color: #7f8c8d;
      font-size: 1.1em;
    }

    .controls {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      align-items: center;
    }

    .control-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .control-group label {
      font-weight: 600;
      color: #2c3e50;
    }

    .control-group select,
    .control-group input[type="checkbox"] {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .control-group button {
      background: #3498db;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }

    .control-group button:hover:not(:disabled) {
      background: #2980b9;
    }

    .control-group button:disabled {
      background: #bdc3c7;
      cursor: not-allowed;
    }

    .results {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .summary {
      background: #2c3e50;
      color: white;
      padding: 20px;
    }

    .summary h2 {
      margin: 0 0 15px 0;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }

    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
    }

    .stat .label {
      font-weight: 600;
    }

    .stat .value {
      font-weight: 700;
      color: #3498db;
    }

    .step-navigation {
      padding: 20px;
      border-bottom: 1px solid #ecf0f1;
    }

    .step-navigation h3 {
      margin: 0 0 15px 0;
      color: #2c3e50;
    }

    .step-controls {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }

    .step-controls button {
      background: #27ae60;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    }

    .step-controls button:hover:not(:disabled) {
      background: #229954;
    }

    .step-controls button:disabled {
      background: #bdc3c7;
      cursor: not-allowed;
    }

    .step-info {
      font-weight: 600;
      color: #2c3e50;
    }

    .step-selector {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .step-selector label {
      font-weight: 600;
      color: #2c3e50;
    }

    .step-selector select {
      flex: 1;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }

    .current-step {
      padding: 20px;
      border-bottom: 1px solid #ecf0f1;
    }


    .current-step h3 {
      margin: 0 0 15px 0;
      color: #2c3e50;
    }

    .step-details {
      margin-bottom: 20px;
    }

    .step-meta {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      font-size: 14px;
    }

    .step-meta .label {
      font-weight: 600;
      color: #7f8c8d;
    }

    .district-groups h4 {
      margin: 0 0 15px 0;
      color: #2c3e50;
    }

    .groups-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
    }

    .district-group {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      background: #f8f9fa;
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 15px;
      align-items: start;
    }

    .group-map {
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #ddd;
    }

    .mini-map {
      height: 150px;
      width: 100%;
    }

    .mini-map svg {
      border-radius: 6px;
    }

    .group-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .step-overview-map {
      margin: 20px 0;
      
      h4 {
        margin: 0 0 15px 0;
        color: #2c3e50;
        font-size: 1.1rem;
      }
    }

    .full-width-map-container {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
      border: 1px solid #e9ecef;
    }

    .step-overview-map-view {
      height: 400px;
      width: 100%;
    }

    .step-overview-map-view svg {
      border-radius: 8px;
    }

    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ddd;
    }

    .group-header h5 {
      margin: 0;
      color: #2c3e50;
    }

    .district-range {
      font-size: 12px;
      color: #7f8c8d;
      font-weight: 600;
    }

    .group-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .group-stats .stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 12px;
    }

    .group-stats .label {
      font-weight: 600;
      color: #7f8c8d;
    }

    .group-stats .value {
      font-weight: 700;
      color: #2c3e50;
    }

    .group-bounds {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
      margin-bottom: 10px;
      font-size: 11px;
    }

    .bound {
      display: flex;
      justify-content: space-between;
    }

    .bound .label {
      font-weight: 600;
      color: #7f8c8d;
    }

    .group-centroid {
      font-size: 11px;
      color: #7f8c8d;
    }

    .group-centroid .label {
      font-weight: 600;
    }

    .final-districts {
      padding: 20px;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      background: #f8f9fa;
      
      h3 {
        margin: 0 0 15px 0;
        color: #2c3e50;
      }
      
      .districts-table-container {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        overflow: hidden;
        margin-top: 1rem;
        height: 300px;
        overflow-y: auto;
        
        .districts-table {
          width: 100%;
          border-collapse: collapse;
          
          th, td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #e9ecef;
          }
          
          th {
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            position: sticky;
            top: 0;
            z-index: 10;
          }
          
          td {
            font-size: 0.9rem;
            color: #212529;
          }
          
          .district-row {
            transition: background-color 0.2s ease;
            
            &:hover {
              background-color: #f8f9fa;
            }
            
            &:nth-child(even) {
              background-color: #fafafa;
            }
          }
          
          .district-number {
            font-weight: 600;
            color: #007bff;
            text-align: center;
          }
          
          .population {
            font-weight: 500;
            text-align: right;
          }
          
          .tract-count {
            text-align: center;
          }
          
          .population-variance {
            text-align: right;
            color: #dc3545;
            font-weight: 500;
          }
          
          .centroid {
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            color: #6c757d;
          }
          
          .summary-row {
            background: #e9ecef;
            font-weight: 600;
            
            td {
              border-top: 2px solid #dee2e6;
              padding: 1rem 0.75rem;
            }
          }
        }
      }
      
      .district-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
        margin-top: 1rem;
        
        .stat-card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          padding: 1.5rem;
          
          h4 {
            color: #2c3e50;
            margin-bottom: 1rem;
            font-size: 1.1rem;
            border-bottom: 2px solid #e9ecef;
            padding-bottom: 0.5rem;
          }
          
          .stat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem 0;
            border-bottom: 1px solid #f8f9fa;
            
            &:last-child {
              border-bottom: none;
            }
            
            .label {
              color: #6c757d;
              font-size: 0.9rem;
            }
            
            .value {
              font-weight: 600;
              color: #212529;
              font-size: 0.9rem;
            }
          }
        }
      }
    }

    .algorithm-history {
      padding: 20px;
    }

    .algorithm-history h3 {
      margin: 0 0 15px 0;
      color: #2c3e50;
    }

    .history-log {
      max-height: 300px;
      overflow-y: auto;
      background: #f8f9fa;
      border-radius: 4px;
      padding: 15px;
    }

    .history-entry {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 14px;
      line-height: 1.4;
    }

    .step-number {
      font-weight: 700;
      color: #3498db;
      min-width: 20px;
    }

    .entry-text {
      color: #2c3e50;
    }

    .error {
      background: #e74c3c;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .error h3 {
      margin: 0 0 10px 0;
    }

    .error button {
      background: white;
      color: #e74c3c;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 10px;
    }

    .loading {
      text-align: center;
      padding: 40px;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .controls {
        flex-direction: column;
        align-items: stretch;
      }
      
      .final-districts {
        .districts-table-container {
          overflow-x: auto;
          
          .districts-table {
            min-width: 600px;
          }
        }
        
        .district-stats {
          grid-template-columns: 1fr;
        }
      }


      .step-controls {
        flex-direction: column;
        align-items: stretch;
      }

      .district-group {
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .group-map {
        order: 1;
      }

      .group-content {
        order: 2;
      }

      .step-selector {
        flex-direction: column;
        align-items: stretch;
      }

      .groups-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class GeodistrictViewerComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedState: string = 'CA';
  useDirectAPI: boolean = false; // Default to backend proxy (uses Secret Manager in production)
  isLoading: boolean = false;
  errorMessage: string = '';
  algorithmResult: GeodistrictResult | null = null;
  currentStepIndex: number = 0;
  currentStep: GeodistrictStep | null = null;
  private groupSvgs: Map<number, SVGElement> = new Map();
  private stepOverviewSvg: SVGElement | null = null;

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
    this.cleanupSvgs();
  }

  private cleanupSvgs(): void {
    this.groupSvgs.forEach((svg, groupIndex) => {
      if (svg && svg.parentNode) {
        svg.parentNode.removeChild(svg);
      }
    });
    this.groupSvgs.clear();
    
    if (this.stepOverviewSvg && this.stepOverviewSvg.parentNode) {
      this.stepOverviewSvg.parentNode.removeChild(this.stepOverviewSvg);
      this.stepOverviewSvg = null;
    }
  }

  private createGroupSvg(groupIndex: number, group: DistrictGroup, color: string): void {
    const mapId = `groupMap${groupIndex}`;
    const mapElement = document.getElementById(mapId);
    
    if (!mapElement) {
      console.warn(`Map element with id ${mapId} not found`);
      return;
    }

    // Clean up existing SVG if it exists
    if (this.groupSvgs.has(groupIndex)) {
      const existingSvg = this.groupSvgs.get(groupIndex);
      if (existingSvg && existingSvg.parentNode) {
        existingSvg.parentNode.removeChild(existingSvg);
      }
    }

    // Clear the container
    mapElement.innerHTML = '';

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 400 300');
    svg.style.background = '#f8f9fa';

    // Create a single contiguous polygon from all tracts
    if (group.censusTracts && group.censusTracts.length > 0) {
      const combinedGeometry = this.combineTractGeometries(group.censusTracts);
      
      if (combinedGeometry) {
        // Calculate bounds and create viewBox
        const bounds = this.calculateGeometryBounds(combinedGeometry);
        if (bounds) {
          const padding = 20;
          const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + 2 * padding} ${bounds.height + 2 * padding}`;
          svg.setAttribute('viewBox', viewBox);
        }

        // Draw the polygon(s)
        this.drawGeometryToSvg(svg, combinedGeometry, color);
      }
    }

    mapElement.appendChild(svg);
    this.groupSvgs.set(groupIndex, svg);
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

  private calculateGeometryBounds(geometry: any): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
    if (!geometry || !geometry.geometry) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const processCoordinates = (coords: any) => {
      if (Array.isArray(coords)) {
        if (typeof coords[0] === 'number') {
          // Single coordinate pair
          const [x, y] = coords;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        } else {
          // Array of coordinates
          coords.forEach(processCoordinates);
        }
      }
    };

    if (geometry.geometry.type === 'Polygon') {
      geometry.geometry.coordinates.forEach(processCoordinates);
    } else if (geometry.geometry.type === 'MultiPolygon') {
      geometry.geometry.coordinates.forEach((polygon: any) => {
        polygon.forEach(processCoordinates);
      });
    }

    if (minX === Infinity) return null;

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  private drawGeometryToSvg(svg: SVGElement, geometry: any, color: string): void {
    if (!geometry || !geometry.geometry) return;

    if (geometry.geometry.type === 'Polygon') {
      geometry.geometry.coordinates.forEach((ring: number[][], index: number) => {
        const polygon = this.createSvgPolygon(ring, color, index === 0);
        svg.appendChild(polygon);
      });
    } else if (geometry.geometry.type === 'MultiPolygon') {
      geometry.geometry.coordinates.forEach((polygonCoords: number[][][]) => {
        polygonCoords.forEach((ring: number[][], index: number) => {
          const polygon = this.createSvgPolygon(ring, color, index === 0);
          svg.appendChild(polygon);
        });
      });
    }
  }

  private createSvgPolygon(coordinates: number[][], color: string, isExterior: boolean): SVGElement {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    
    // Convert coordinates to SVG points string
    const points = coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ');
    polygon.setAttribute('points', points);
    
    // Style the polygon
    polygon.setAttribute('fill', isExterior ? color : 'white');
    polygon.setAttribute('stroke', color);
    polygon.setAttribute('stroke-width', '1');
    polygon.setAttribute('fill-opacity', '1');
    polygon.setAttribute('stroke-opacity', '1');
    
    return polygon;
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
    
    this.cleanupSvgs();
    
    // Create the step overview map first
    this.createStepOverviewSvg();
    
    // Then create individual group maps
    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      this.createGroupSvg(index, group, color);
    });
  }

  private createStepOverviewSvg(): void {
    if (!this.currentStep) return;

    const mapElement = document.getElementById('stepOverviewMap');
    if (!mapElement) {
      console.warn('Step overview map element not found');
      return;
    }

    // Clean up existing SVG
    if (this.stepOverviewSvg && this.stepOverviewSvg.parentNode) {
      this.stepOverviewSvg.parentNode.removeChild(this.stepOverviewSvg);
    }

    // Clear the container
    mapElement.innerHTML = '';

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 800 600');
    svg.style.background = '#f8f9fa';

    // Calculate overall bounds for all groups
    let overallBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null = null;

    this.currentStep.districtGroups.forEach((group, index) => {
      const combinedGeometry = this.combineTractGeometries(group.censusTracts);
      
      if (combinedGeometry) {
        const bounds = this.calculateGeometryBounds(combinedGeometry);
        if (bounds) {
          if (!overallBounds) {
            overallBounds = { ...bounds };
          } else {
            overallBounds.minX = Math.min(overallBounds.minX, bounds.minX);
            overallBounds.minY = Math.min(overallBounds.minY, bounds.minY);
            overallBounds.maxX = Math.max(overallBounds.maxX, bounds.maxX);
            overallBounds.maxY = Math.max(overallBounds.maxY, bounds.maxY);
            overallBounds.width = overallBounds.maxX - overallBounds.minX;
            overallBounds.height = overallBounds.maxY - overallBounds.minY;
          }
        }
      }
    });

    // Set viewBox based on overall bounds
    if (overallBounds !== null) {
      const padding = 50;
      const bounds = overallBounds as { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
      const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + 2 * padding} ${bounds.height + 2 * padding}`;
      svg.setAttribute('viewBox', viewBox);
    }

    // Add all district groups to the SVG
    this.currentStep.districtGroups.forEach((group, index) => {
      const color = this.getGroupColor(index);
      const combinedGeometry = this.combineTractGeometries(group.censusTracts);
      
      if (combinedGeometry) {
        // Create a group element for this district group
        const groupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        groupElement.setAttribute('data-group-index', index.toString());
        
        // Add title for tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `Group ${index + 1} - Districts: ${group.startDistrictNumber}-${group.endDistrictNumber} - Population: ${group.totalPopulation.toLocaleString()} - Tracts: ${group.censusTracts.length}`;
        groupElement.appendChild(title);

        // Draw the geometry
        this.drawGeometryToSvg(groupElement, combinedGeometry, color);
        
        svg.appendChild(groupElement);
      }
    });

    mapElement.appendChild(svg);
    this.stepOverviewSvg = svg;
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
    return colors[index % colors.length] + '20'; // Add transparency
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
