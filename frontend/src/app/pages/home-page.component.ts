import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../services/api.service';
import * as L from 'leaflet';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="app-container">
      <header class="app-header">
        <h1>{{ title }}</h1>
        <p>A revolutionary solution to U.S. Congressional district gerrymandering through objective, algorithmic district boundary creation.</p>
      </header>

      <nav class="app-navigation">
        <div class="nav-container">
          <a routerLink="/home" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}">
            Home
          </a>
          <a routerLink="/census" routerLinkActive="active">
            Census Data
          </a>
          <a routerLink="/map" routerLinkActive="active">
            State Map
          </a>
          <a routerLink="/districts" routerLinkActive="active">
            Congressional Districts
          </a>
          <a routerLink="/geodistrict" routerLinkActive="active">
            Geodistrict Algorithm
          </a>
          <a routerLink="/algorithm-complexity" routerLinkActive="active">
            Algorithm Complexity
          </a>
          <a routerLink="/tract-debug" routerLinkActive="active">
            Tract Debug
          </a>
        </div>
      </nav>

      <main class="app-main">
        <section class="problem-section">
          <h2>The Problem: Gerrymandering as Subversion of Democracy</h2>
          <p>Gerrymandering represents a true <strong>subversion of democracy</strong> - far beyond being just a "threat to democracy." It systematically undermines the fundamental principle of equal representation by allowing partisan manipulation of electoral boundaries.</p>
          
          <h3>Current Legal Challenges</h3>
          <ul>
            <li><strong>Proposition 50</strong> and ongoing SCOTUS cases on <strong>VRA Section 2</strong> highlight the legal complexity</li>
            <li>Even <strong>bipartisan redistricting committees</strong> remain subjective with potential for bias</li>
            <li>Human decision-makers can be influenced, compromised, or manipulated</li>
          </ul>

          <h3>Why Current Solutions Fail</h3>
          <ul>
            <li><strong>Partisan Control</strong>: State legislatures draw boundaries to favor their party</li>
            <li><strong>Subjective Criteria</strong>: Even "independent" commissions use subjective judgments</li>
            <li><strong>Lack of Transparency</strong>: Decision-making processes are often opaque</li>
            <li><strong>Legal Complexity</strong>: VRA compliance creates additional opportunities for manipulation</li>
          </ul>
        </section>

        <section class="solution-section">
          <h2>The Solution: Algorithmic Protocol for Objective District Creation</h2>
          <p>GeoDistricts is fundamentally an <strong>algorithmic protocol</strong> - a computational method that establishes objective rules for district creation, designed to be adopted as a standardized legal framework.</p>

          <h3>Core Principles</h3>
          <ol>
            <li><strong>Population Equality First</strong>: Districts must be as close to equal population as possible (target: <1% variance)</li>
            <li><strong>Geographic Sorting Only</strong>: Uses pure latitude/longitude sorting with no political considerations</li>
            <li><strong>Automated Process</strong>: No human intervention in boundary decisions</li>
            <li><strong>Deterministic Results</strong>: Same inputs always produce identical outputs</li>
          </ol>

          <h3>How It Works</h3>
          <ul>
            <li><strong>Input</strong>: Census tract population data + TIGER/Line boundaries + district count per state</li>
            <li><strong>Process</strong>: Two-phase hierarchical division (county-level → tract-level refinement)</li>
            <li><strong>Output</strong>: Districts with <1% population variance, maximum contiguity</li>
            <li><strong>Transparency</strong>: Step-by-step logging of all algorithmic decisions</li>
          </ul>

          <h3>Technical Implementation</h3>
          <ol>
            <li><strong>Initialization</strong>: Calculate target population per district from total state population</li>
            <li><strong>County-Level Division</strong>: Sort counties geographically, divide into balanced groups</li>
            <li><strong>Tract-Level Refinement</strong>: Within each group, sort tracts geographically and divide to meet population targets</li>
            <li><strong>Validation</strong>: Check population variance and contiguity scores</li>
          </ol>
        </section>

        <section class="benefits-section">
          <h2>Benefits: Democracy Preserved Through Technology</h2>
          
          <h3>Eliminates Gerrymandering</h3>
          <ul>
            <li><strong>No Political Considerations</strong>: Algorithm uses only census data and geography</li>
            <li><strong>No Human Bias</strong>: Deterministic process removes subjective decision-making</li>
            <li><strong>Transparent Process</strong>: Every decision is logged and auditable</li>
            <li><strong>Consistent Results</strong>: Same inputs always produce same outputs</li>
          </ul>

          <h3>Legal and Constitutional Compliance</h3>
          <ul>
            <li><strong>Equal Representation</strong>: Meets constitutional requirements for equal population</li>
            <li><strong>VRA Compliance</strong>: Algorithm design inherently meets Voting Rights Act requirements</li>
            <li><strong>Scalable</strong>: Works for states with 1 district (Wyoming) to 52 districts (California)</li>
            <li><strong>Auditable</strong>: Complete algorithmic decision trail for legal review</li>
          </ul>

          <h3>Implementation Advantages</h3>
          <ul>
            <li><strong>Open Source</strong>: All implementations are transparent and verifiable</li>
            <li><strong>DAO Governance</strong>: Protocol governed by decentralized autonomous organization</li>
            <li><strong>Cost Effective</strong>: Eliminates expensive redistricting litigation</li>
            <li><strong>Timely</strong>: Automated process completes in minutes, not months</li>
          </ul>
        </section>

        <section class="future-section">
          <h2>The Future of Fair Representation</h2>
          <p>GeoDistricts represents a paradigm shift from subjective, political redistricting to objective, algorithmic district creation. By removing all political considerations and using only objective geographic and demographic data, we eliminate the possibility of partisan manipulation while still meeting constitutional requirements for equal representation.</p>
          <p><strong>The result</strong>: Democracy is preserved as no centralized state authority can be compromised into gerrymandering.</p>
        </section>
      </main>

      <footer class="app-footer">
        <p>&copy; 2025 Lacoda Labs, Inc.</p>
      </footer>
    </div>
  `,
  styleUrls: ['../app.scss']
})
export class HomePageComponent implements OnInit, AfterViewInit {
  title = 'GeoDistricts';
  apiMessage = '';
  healthStatus = '';
  private usaMap: L.Map | null = null;
  private californiaMap: L.Map | null = null;

  constructor(private apiService: ApiService) {}

  ngOnInit() {
    this.testApiConnection();
  }

  ngAfterViewInit() {
    // Initialize maps after view is ready
    setTimeout(() => {
      this.initializeUSAMap();
      this.initializeCaliforniaMap();
    }, 100);
  }

  testApiConnection() {
    this.apiService.getHello().subscribe({
      next: (response) => {
        this.apiMessage = response.message;
      },
      error: (error) => {
        this.apiMessage = 'API connection failed';
        console.error('API Error:', error);
      }
    });

    this.apiService.getHealth().subscribe({
      next: (response) => {
        this.healthStatus = response.status;
      },
      error: (error) => {
        this.healthStatus = 'Health check failed';
        console.error('Health Check Error:', error);
      }
    });
  }

  private initializeUSAMap() {
    const mapElement = document.getElementById('usaMap');
    if (mapElement && !this.usaMap) {
      this.usaMap = L.map('usaMap').setView([39.8283, -98.5795], 4);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.usaMap);

      // Add a marker for the center of the US
      L.marker([39.8283, -98.5795]).addTo(this.usaMap)
        .bindPopup('United States<br>Electoral Districts')
        .openPopup();
    }
  }

  private initializeCaliforniaMap() {
    const mapElement = document.getElementById('californiaMap');
    if (mapElement && !this.californiaMap) {
      this.californiaMap = L.map('californiaMap').setView([36.7783, -119.4179], 6);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.californiaMap);

      // Add a marker for California
      L.marker([36.7783, -119.4179]).addTo(this.californiaMap)
        .bindPopup('California<br>Census Tracts')
        .openPopup();
    }
  }
}
