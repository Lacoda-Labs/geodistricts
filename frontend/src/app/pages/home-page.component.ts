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

}

