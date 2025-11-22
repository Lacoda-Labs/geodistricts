import { Component } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../components/page-header.component';

declare global {
  interface Window {
    gtag: (command: string, action: string, parameters: any) => void;
  }
}


@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    PageHeaderComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss'],
})
export class HomePageComponent {
  activeSection = 'home';
  isMobileMenuOpen = false;
  selectedState: string = '';

  navItems = [
    { id: 'what', label: 'What is it?', route: null },
    { id: 'how', label: 'How it works', route: null },
    { id: 'try', label: 'Try it', route: '/geodistrict' },
  ];

  // US States with their congressional district counts
  states = [
    { code: 'AL', name: 'Alabama', districts: 7 },
    { code: 'AK', name: 'Alaska', districts: 1 },
    { code: 'AZ', name: 'Arizona', districts: 9 },
    { code: 'AR', name: 'Arkansas', districts: 4 },
    { code: 'CA', name: 'California', districts: 52 },
    { code: 'CO', name: 'Colorado', districts: 8 },
    { code: 'CT', name: 'Connecticut', districts: 5 },
    { code: 'DE', name: 'Delaware', districts: 1 },
    { code: 'FL', name: 'Florida', districts: 28 },
    { code: 'GA', name: 'Georgia', districts: 14 },
    { code: 'HI', name: 'Hawaii', districts: 2 },
    { code: 'ID', name: 'Idaho', districts: 2 },
    { code: 'IL', name: 'Illinois', districts: 17 },
    { code: 'IN', name: 'Indiana', districts: 9 },
    { code: 'IA', name: 'Iowa', districts: 4 },
    { code: 'KS', name: 'Kansas', districts: 4 },
    { code: 'KY', name: 'Kentucky', districts: 6 },
    { code: 'LA', name: 'Louisiana', districts: 6 },
    { code: 'ME', name: 'Maine', districts: 2 },
    { code: 'MD', name: 'Maryland', districts: 8 },
    { code: 'MA', name: 'Massachusetts', districts: 9 },
    { code: 'MI', name: 'Michigan', districts: 13 },
    { code: 'MN', name: 'Minnesota', districts: 8 },
    { code: 'MS', name: 'Mississippi', districts: 4 },
    { code: 'MO', name: 'Missouri', districts: 8 },
    { code: 'MT', name: 'Montana', districts: 2 },
    { code: 'NE', name: 'Nebraska', districts: 3 },
    { code: 'NV', name: 'Nevada', districts: 4 },
    { code: 'NH', name: 'New Hampshire', districts: 2 },
    { code: 'NJ', name: 'New Jersey', districts: 12 },
    { code: 'NM', name: 'New Mexico', districts: 3 },
    { code: 'NY', name: 'New York', districts: 26 },
    { code: 'NC', name: 'North Carolina', districts: 14 },
    { code: 'ND', name: 'North Dakota', districts: 1 },
    { code: 'OH', name: 'Ohio', districts: 15 },
    { code: 'OK', name: 'Oklahoma', districts: 5 },
    { code: 'OR', name: 'Oregon', districts: 6 },
    { code: 'PA', name: 'Pennsylvania', districts: 17 },
    { code: 'RI', name: 'Rhode Island', districts: 2 },
    { code: 'SC', name: 'South Carolina', districts: 7 },
    { code: 'SD', name: 'South Dakota', districts: 1 },
    { code: 'TN', name: 'Tennessee', districts: 9 },
    { code: 'TX', name: 'Texas', districts: 38 },
    { code: 'UT', name: 'Utah', districts: 4 },
    { code: 'VT', name: 'Vermont', districts: 1 },
    { code: 'VA', name: 'Virginia', districts: 11 },
    { code: 'WA', name: 'Washington', districts: 10 },
    { code: 'WV', name: 'West Virginia', districts: 2 },
    { code: 'WI', name: 'Wisconsin', districts: 8 },
    { code: 'WY', name: 'Wyoming', districts: 1 }
  ];

  constructor(private router: Router) {
    // Don't load selected state from localStorage on home page
    // Always start with empty selection so user explicitly chooses
    this.selectedState = '';
  }

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

  navigateToItem(item: any) {
    // Close mobile menu if open
    this.closeMobileMenu();

    if (item.route) {
      // Track "show me the maps" button click
      if (item.route === '/geodistrict') {
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'button_click', {
            event_category: 'CTA',
            event_label: 'Show me the maps',
            button_location: 'home_page'
          });
        }
      }
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

  getNavIcon(id: string): string {
    const iconMap: { [key: string]: string } = {
      'home': 'home',
      'what': 'info',
      'how': 'help_outline',
      'try': 'play_arrow',
    };
    return iconMap[id] || 'circle';
  }

  goHome(): void {
    // Already on home page, do nothing or scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

}

