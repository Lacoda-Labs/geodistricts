import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PageHeaderComponent } from '../components/page-header.component';

@Component({
  selector: 'app-contribute-page',
  standalone: true,
  imports: [CommonModule, RouterModule, MatButtonModule, MatIconModule, PageHeaderComponent],
  templateUrl: './contribute-page.component.html',
  styleUrls: ['./contribute-page.component.scss'],
})
export class ContributePageComponent {
  githubUrl = 'https://github.com/Lacoda-Labs/geodistricts';
  
  // Track expanded state for accordion
  expandedSections: { [key: string]: boolean } = {
    build: false,
    fund: false,
    share: false,
  };
  
  // Social media links - update with actual URLs when available
  socialLinks = {
    x: 'https://x.com/geodistricts', // Update with actual X/Twitter handle
    instagram: 'https://instagram.com/geodistricts', // Update with actual Instagram handle
    tiktok: 'https://tiktok.com/@geodistricts', // Update with actual TikTok handle
    facebook: 'https://facebook.com/geodistricts', // Update with actual Facebook handle
  };

  // Donation links - update with actual URLs when available
  donationLinks = {
    givesendgo: '', // Add GiveSendGo link when available
    bitcoin: '', // Add Bitcoin address when available
    ethereum: '', // Add Ethereum address when available
    solana: '', // Add Solana address when available
  };

  constructor(private router: Router) {}

  toggleSection(section: string): void {
    this.expandedSections[section] = !this.expandedSections[section];
  }

  goHome(): void {
    this.router.navigate(['/home']);
  }
}

