import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeodistrictViewerComponent } from '../components/geodistrict-viewer.component';

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
export class GeodistrictPageComponent {
  constructor() {}
}
