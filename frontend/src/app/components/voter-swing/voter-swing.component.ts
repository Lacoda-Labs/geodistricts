import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../ui/badge/badge.component';

interface StateData {
  state: string;
  currentR: number;
  currentD: number;
  geoR: number;
  geoD: number;
  swing: number;
  direction: 'R' | 'D' | 'neutral';
}

@Component({
  selector: 'app-voter-swing',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    BadgeComponent,
  ],
  template: `
    <div class="max-w-4xl mx-auto">
      <h2 class="text-gray-900 mb-4 text-center text-3xl font-bold">The Impact</h2>
      
      <p class="text-gray-600 text-center mb-12 max-w-2xl mx-auto text-lg">
        Comparing GeoDistricts maps to current gerrymandered districts reveals 
        significant shifts toward fair representation.
      </p>
      
      <mat-card class="p-6 mb-8">
        <div class="text-center mb-6">
          <div class="text-gray-500 mb-2">Net Change (Nationwide)</div>
          <div class="text-gray-900 text-2xl font-bold">
            <span class="text-blue-600">+{{ netSwing }}</span> seats toward fair representation
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4 text-center">
          <div>
            <div class="text-gray-500 mb-1">From R Gerrymanders</div>
            <div class="text-blue-600 font-semibold">+{{ totalSwingD }} D seats</div>
          </div>
          <div>
            <div class="text-gray-500 mb-1">From D Gerrymanders</div>
            <div class="text-red-600 font-semibold">+{{ totalSwingR }} R seats</div>
          </div>
        </div>
      </mat-card>
      
      <div class="mb-6">
        <mat-form-field class="w-full md:w-64">
          <mat-label>Select a state</mat-label>
          <mat-select [(value)]="selectedState">
            <mat-option value="all">All States</mat-option>
            <mat-option *ngFor="let state of stateData" [value]="state.state">
              {{ state.state }}
            </mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      
      <div class="space-y-4">
        <mat-card *ngFor="let data of filteredData" class="p-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div class="flex items-center gap-3 mb-2">
                <h3 class="text-gray-900 text-xl font-semibold">{{ data.state }}</h3>
                <app-badge
                  *ngIf="data.swing > 0"
                  [variant]="data.direction === 'D' ? 'default' : 'destructive'">
                  +{{ data.swing }} {{ data.direction }}
                </app-badge>
              </div>
              <div class="text-gray-600">
                Current: {{ data.currentR }}R / {{ data.currentD }}D → GeoDistricts: {{ data.geoR }}R / {{ data.geoD }}D
              </div>
            </div>
          </div>
        </mat-card>
      </div>
    </div>
  `,
})
export class VoterSwingComponent {
  selectedState = 'all';

  stateData: StateData[] = [
    { state: 'Texas', currentR: 25, currentD: 13, geoR: 21, geoD: 17, swing: 4, direction: 'D' },
    { state: 'North Carolina', currentR: 10, currentD: 4, geoR: 7, geoD: 7, swing: 3, direction: 'D' },
    { state: 'Ohio', currentR: 13, currentD: 2, geoR: 10, geoD: 5, swing: 3, direction: 'D' },
    { state: 'Pennsylvania', currentR: 9, currentD: 8, geoR: 8, geoD: 9, swing: 2, direction: 'D' },
    { state: 'Georgia', currentR: 9, currentD: 5, geoR: 8, geoD: 6, swing: 1, direction: 'D' },
    { state: 'Florida', currentR: 20, currentD: 8, geoR: 18, geoD: 10, swing: 2, direction: 'D' },
    { state: 'Wisconsin', currentR: 6, currentD: 2, geoR: 5, geoD: 3, swing: 1, direction: 'D' },
    { state: 'Maryland', currentR: 1, currentD: 7, geoR: 3, geoD: 5, swing: 2, direction: 'R' },
    { state: 'Illinois', currentR: 5, currentD: 12, geoR: 7, geoD: 10, swing: 2, direction: 'R' },
    { state: 'New York', currentR: 11, currentD: 15, geoR: 11, geoD: 15, swing: 0, direction: 'neutral' },
  ];

  get filteredData() {
    return this.selectedState === 'all'
      ? this.stateData
      : this.stateData.filter(s => s.state === this.selectedState);
  }

  get totalSwingD() {
    return this.stateData.filter(s => s.direction === 'D').reduce((acc, s) => acc + s.swing, 0);
  }

  get totalSwingR() {
    return this.stateData.filter(s => s.direction === 'R').reduce((acc, s) => acc + s.swing, 0);
  }

  get netSwing() {
    return this.totalSwingD - this.totalSwingR;
  }
}

