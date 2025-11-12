import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';

interface StateData {
  state: string;
  currentR: number;
  currentD: number;
  geoR: number;
  geoD: number;
  swing: number;
  direction: 'R' | 'D' | 'neutral';
}

const TRY_IT_STATES = [
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
  selector: 'app-home-page',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
  ],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss'],
})
export class HomePageComponent {
  activeSection = 'home';
  isMobileMenuOpen = false;

  navItems = [
    { id: 'what', label: 'What is it?', route: null },
    { id: 'how', label: 'How it works', route: null },
    { id: 'impact', label: 'Impact', route: null },
    { id: 'try', label: 'Try it', route: '/geodistrict' },
  ];

  constructor(private router: Router) {}

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

  tryItSelectedState = '';
  isGenerating = false;
  generated = false;
  tryItStates = TRY_IT_STATES;

  navigateToItem(item: any) {
    // Close mobile menu if open
    this.closeMobileMenu();

    if (item.route) {
      // Navigate to route
      this.router.navigate([item.route]);
    } else {
      // Scroll to section
      this.activeSection = item.id;
      const element = document.getElementById(item.id);
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu() {
    this.isMobileMenuOpen = false;
  }

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

  handleGenerate() {
    if (!this.tryItSelectedState) return;
    
    this.isGenerating = true;
    
    setTimeout(() => {
      this.isGenerating = false;
      this.generated = true;
    }, 2000);
  }
}

