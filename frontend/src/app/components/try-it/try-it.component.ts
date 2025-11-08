import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../ui/button/button.component';

const states = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming'
];

@Component({
  selector: 'app-try-it',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FormsModule,
    ButtonComponent,
  ],
  template: `
    <div class="max-w-4xl mx-auto">
      <h2 class="text-gray-900 mb-4 text-center text-3xl font-bold">Try It Yourself</h2>
      
      <p class="text-gray-600 text-center mb-12 max-w-2xl mx-auto text-lg">
        Generate a GeoDistricts map for any state and see how objective 
        redistricting compares to current maps.
      </p>
      
      <mat-card class="p-8">
        <div class="space-y-6">
          <div>
            <mat-form-field class="w-full">
              <mat-label>Select a state</mat-label>
              <mat-select [(value)]="selectedState">
                <mat-option *ngFor="let state of states" [value]="state">
                  {{ state }}
                </mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          
          <app-button
            color="primary"
            [disabled]="!selectedState || isGenerating"
            buttonClass="w-full"
            (onClick)="handleGenerate()">
            <mat-icon *ngIf="isGenerating" class="mr-2 animate-spin">refresh</mat-icon>
            <span *ngIf="!isGenerating">Generate GeoDistricts Map</span>
            <span *ngIf="isGenerating">Generating Map...</span>
          </app-button>
          
          <div *ngIf="generated" class="border-t border-gray-200 pt-6 mt-6">
            <div class="bg-gray-50 rounded-lg p-6 text-center">
              <h3 class="text-gray-900 mb-4 text-xl font-semibold">{{ selectedState }} - GeoDistricts Map</h3>
              <div class="bg-white rounded border-2 border-dashed border-gray-300 h-64 flex items-center justify-center mb-4">
                <div class="text-gray-400">
                  Interactive map visualization would appear here
                </div>
              </div>
              <p class="text-gray-600">
                This demo shows where the interactive map would be generated. 
                The full implementation would display district boundaries, 
                demographic data, and comparison metrics.
              </p>
            </div>
          </div>
        </div>
      </mat-card>
      
      <div class="mt-8 text-center">
        <p class="text-gray-500">
          Want to implement GeoDistricts in your state? Get in touch.
        </p>
      </div>
    </div>
  `,
})
export class TryItComponent {
  selectedState = '';
  isGenerating = false;
  generated = false;
  states = states;

  handleGenerate() {
    if (!this.selectedState) return;
    
    this.isGenerating = true;
    
    setTimeout(() => {
      this.isGenerating = false;
      this.generated = true;
    }, 2000);
  }
}

