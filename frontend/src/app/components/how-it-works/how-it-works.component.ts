import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="max-w-4xl mx-auto">
      <h2 class="text-gray-900 mb-4 text-center text-3xl font-bold">How It Works</h2>
      
      <p class="text-gray-600 text-center mb-16 max-w-2xl mx-auto text-lg">
        Four simple steps from raw data to fair districts.
      </p>
      
      <div class="grid md:grid-cols-2 gap-8">
        <div *ngFor="let step of steps; let i = index" class="relative">
          <div class="flex gap-4">
            <div class="text-gray-300 flex-shrink-0 text-2xl font-bold">
              {{ step.number }}
            </div>
            <div>
              <h3 class="text-gray-900 mb-2 text-xl font-semibold">{{ step.title }}</h3>
              <p class="text-gray-600">{{ step.description }}</p>
            </div>
          </div>
          <mat-icon
            *ngIf="i < steps.length - 1 && i % 2 === 0"
            class="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 text-gray-300">
            arrow_forward
          </mat-icon>
        </div>
      </div>
    </div>
  `,
})
export class HowItWorksComponent {
  steps = [
    {
      number: '01',
      title: 'Data Collection',
      description: 'Census data, geographic boundaries, and population demographics.',
    },
    {
      number: '02',
      title: 'AI Prompt Chaining',
      description: 'Multiple AI agents collaborate to define objective criteria.',
    },
    {
      number: '03',
      title: 'Algorithm Generation',
      description: 'The protocol creates a transparent, repeatable algorithm.',
    },
    {
      number: '04',
      title: 'District Mapping',
      description: 'Maps are drawn without human intervention or bias.',
    },
  ];
}

