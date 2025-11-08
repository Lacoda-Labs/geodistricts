import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatToolbarModule],
  template: `
    <nav class="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-50">
      <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <button
          (click)="scrollToSection.emit('home')"
          class="text-gray-900 hover:text-gray-600 transition-colors">
          GeoDistricts
        </button>
        
        <!-- Desktop Navigation -->
        <div class="hidden md:flex gap-8">
          <button
            *ngFor="let item of navItems"
            (click)="scrollToSection.emit(item.id)"
            [class.text-gray-900]="activeSection === item.id"
            [class.text-gray-600]="activeSection !== item.id"
            class="hover:text-gray-900 transition-colors">
            {{ item.label }}
          </button>
        </div>
        
        <!-- Mobile Navigation -->
        <button
          mat-icon-button
          class="md:hidden"
          (click)="mobileMenuOpen = !mobileMenuOpen">
          <mat-icon>menu</mat-icon>
        </button>
      </div>
      
      <!-- Mobile Menu -->
      <div *ngIf="mobileMenuOpen" class="md:hidden fixed inset-0 z-50 bg-black/50" (click)="mobileMenuOpen = false">
        <div class="fixed right-0 top-0 h-full w-3/4 bg-white shadow-lg p-4" (click)="$event.stopPropagation()">
          <button
            mat-icon-button
            (click)="mobileMenuOpen = false"
            class="absolute top-4 right-4">
            <mat-icon>close</mat-icon>
          </button>
          <div class="flex flex-col gap-6 mt-12">
            <button
              *ngFor="let item of navItems"
              (click)="scrollToSection.emit(item.id); mobileMenuOpen = false"
              class="text-gray-600 hover:text-gray-900 transition-colors text-left p-2 text-lg">
              {{ item.label }}
            </button>
          </div>
        </div>
      </div>
    </nav>
  `,
})
export class NavigationComponent {
  @Input() activeSection = 'home';
  @Output() scrollToSection = new EventEmitter<string>();

  mobileMenuOpen = false;

  navItems = [
    { id: 'what', label: 'What is it?' },
    { id: 'how', label: 'How it works' },
    { id: 'impact', label: 'Impact' },
    { id: 'try', label: 'Try it' },
  ];
}

