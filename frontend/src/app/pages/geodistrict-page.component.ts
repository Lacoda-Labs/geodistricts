import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { GeodistrictViewerComponent } from '../components/geodistrict-viewer.component';
import { PageHeaderComponent } from '../components/page-header.component';
import { VERSION_INFO } from '../../version';

@Component({
  selector: 'app-geodistrict-page',
  standalone: true,
  imports: [CommonModule, RouterModule, GeodistrictViewerComponent, PageHeaderComponent],
  template: `
    <div class="geodistrict-page">
      <app-page-header
        (homeClick)="goHome()">
      </app-page-header>
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
  constructor(private router: Router) {}
  
  goHome(): void {
    this.router.navigate(['/home']);
  }
  
  ngOnInit() {
    console.log('🚀 GeoDistricts Page Loaded');
    console.log(`📦 Build Version: ${VERSION_INFO.buildVersion}`);
    console.log(`📅 Build Date: ${VERSION_INFO.buildDate}`);
    console.log(`🧮 Algorithm Version: ${VERSION_INFO.algorithmVersion}`);
    console.log('✨ New Features:', VERSION_INFO.features);
  }
}
