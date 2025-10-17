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
        <p>An objective approach for calculating US Congressional district boundaries.</p>
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
          <a routerLink="/tract-debug" routerLinkActive="active">
            Tract Debug
          </a>
        </div>
      </nav>

      <main class="app-main">
        <div class="welcome-section">
          <h2>Welcome to GeoDistricts</h2>
          <ul>
            <li>How does it work?</li>
          </ul>
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
