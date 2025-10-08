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
        <p>100% objective and completely fair electoral districting for every jurisdiction in the United States.</p>
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
        </div>
      </nav>

      <main class="app-main">
        <div class="welcome-section">
          <h2>Welcome to GeoDistricts</h2>
          <ul>
            <li>How does it work?</li>
            <li>Voting Rights Act (VRA) of 1965</li>
          </ul>
        </div>
        
        <div class="geodistricts-usa-map">
          <h2>GeoDistricts USA Map</h2>
          <p>This is a map of the United States with the electoral districts for each state.</p>
          <div id="usaMap" style="height: 450px; width: 100%; border: 1px solid #ddd; border-radius: 8px;"></div>
          <p>This is a map of the United States with the electoral districts for each state.</p>
        </div>

        <div class="california-census-map">
          <h2>California Census Tracts</h2>
          <p>Interactive map showing census tract boundaries across California for fair districting analysis.</p>
          <div class="map-container">
            <div id="californiaMap" style="height: 500px; width: 100%; border: 1px solid #ddd; border-radius: 8px;"></div>
            <div class="map-overlay">
              <div class="census-info">
                <h3>Census Tract Data</h3>
                <p>California has approximately 8,000+ census tracts used for demographic analysis and fair districting.</p>
                <ul>
                  <li>Each tract contains 1,200-8,000 people</li>
                  <li>Boundaries follow visible features when possible</li>
                  <li>Used for Voting Rights Act compliance</li>
                  <li>Essential for fair redistricting</li>
                </ul>
                <div class="cta-section">
                  <a routerLink="/census" class="cta-button">
                    Explore Census Data →
                  </a>
                  <a routerLink="/map" class="cta-button">
                    View State Maps →
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
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
