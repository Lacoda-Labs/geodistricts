import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeodistrictViewerComponent } from '../components/geodistrict-viewer.component';
import { VERSION_INFO } from '../../version';

@Component({
  selector: 'app-geodistrict-page',
  standalone: true,
  imports: [CommonModule, GeodistrictViewerComponent],
  template: `
    <div class="geodistrict-page">
      <app-geodistrict-viewer></app-geodistrict-viewer>
    </div>
  `,
  styles: [`
    .geodistrict-page {
      min-height: 100vh;
      background: linear-gradient(135deg,rgb(182, 194, 246) 0%, #764ba2 100%);
      padding: 0;
    }
  `]
})
export class GeodistrictPageComponent implements OnInit {
  constructor() {}
  
  ngOnInit() {
    console.log('🚀 GeoDistricts Page Loaded');
    console.log(`📦 Build Version: ${VERSION_INFO.buildVersion}`);
    console.log(`📅 Build Date: ${VERSION_INFO.buildDate}`);
    console.log(`🧮 Algorithm Version: ${VERSION_INFO.algorithmVersion}`);
    console.log('📍 New Geo-Graph Algorithm available');
    console.log('🔗 This algorithm uses Brown S4 adjacency data with zig-zag traversal pattern');
    console.log('📊 Available algorithms: brown-s4 (default), geo-graph, greedy-traversal, geographic, latlong');
    console.log('✨ New Features:', VERSION_INFO.features);
  }
}
