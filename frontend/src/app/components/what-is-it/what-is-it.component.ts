import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-what-is-it',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="max-w-4xl mx-auto">
      <h2 class="text-gray-900 mb-4 text-center text-3xl font-bold">What is GeoDistricts?</h2>
      
      <p class="text-gray-600 text-center mb-16 max-w-2xl mx-auto text-lg">
        A revolutionary approach to congressional redistricting that removes human 
        subjectivity from the process. Our AI protocol creates district maps based 
        purely on geographic and demographic data.
      </p>
      
      <div class="grid md:grid-cols-3 gap-12">
        <div *ngFor="let feature of features" class="text-center">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-900 text-white mb-4">
            <mat-icon>{{ feature.icon }}</mat-icon>
          </div>
          <h3 class="text-gray-900 mb-2 text-xl font-semibold">{{ feature.title }}</h3>
          <p class="text-gray-600">{{ feature.description }}</p>
        </div>
      </div>
    </div>
  `,
})
export class WhatIsItComponent {
  features = [
    {
      icon: 'gps_fixed',
      title: 'Objective Protocol',
      description: 'No human bias. No political manipulation.',
    },
    {
      icon: 'memory',
      title: 'AI-Driven',
      description: 'Agentic prompt chaining generates the algorithm.',
    },
    {
      icon: 'balance',
      title: 'Fair Representation',
      description: 'Districts drawn by math, not partisan interests.',
    },
  ];
}

