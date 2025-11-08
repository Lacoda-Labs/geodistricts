import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ButtonComponent } from '../ui/button/button.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, ButtonComponent],
  template: `
    <div class="pt-32 pb-20 px-6 text-center">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-gray-900 mb-6 text-4xl md:text-5xl font-bold">
          GeoDistricts
        </h1>
        <h2 class="text-gray-900 mb-6 text-2xl md:text-3xl font-bold">
          No more gerrymandering... ever again.
        </h2>

        <p class="text-gray-600 mb-12 max-w-2xl mx-auto text-lg">
          Geographically drawn congressional districts.<br>No humans. Just a protocol that is 100% objective and fair. 
        </p>
        
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <app-button
            color="primary"
            buttonClass="group"
            (onClick)="scrollToSection.emit('what')">
            <span class="flex items-center">
              Learn more
              <mat-icon class="ml-2 group-hover:translate-x-1 transition-transform">arrow_forward</mat-icon>
            </span>
          </app-button>
          
          <button
            mat-stroked-button
            color="primary"
            (click)="scrollToSection.emit('try')"
            class="px-6 py-3">
            See it work
          </button>
        </div>
      </div>
    </div>
  `,
})
export class HeroComponent {
  @Output() scrollToSection = new EventEmitter<string>();
}

