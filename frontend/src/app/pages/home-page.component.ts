import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationComponent } from '../components/navigation/navigation.component';
import { HeroComponent } from '../components/hero/hero.component';
import { WhatIsItComponent } from '../components/what-is-it/what-is-it.component';
import { HowItWorksComponent } from '../components/how-it-works/how-it-works.component';
import { VoterSwingComponent } from '../components/voter-swing/voter-swing.component';
import { TryItComponent } from '../components/try-it/try-it.component';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    CommonModule,
    NavigationComponent,
    HeroComponent,
    WhatIsItComponent,
    HowItWorksComponent,
    VoterSwingComponent,
    TryItComponent,
  ],
  template: `
    <div class="min-h-screen bg-white">
      <app-navigation 
        [activeSection]="activeSection"
        (scrollToSection)="scrollToSection($event)">
      </app-navigation>
      
      <main>
        <section id="home">
          <app-hero (scrollToSection)="scrollToSection($event)"></app-hero>
        </section>
        
        <section id="what" class="py-20 px-6">
          <app-what-is-it></app-what-is-it>
        </section>
        
        <section id="how" class="py-20 px-6 bg-gray-50">
          <app-how-it-works></app-how-it-works>
        </section>
        
        <section id="impact" class="py-20 px-6">
          <app-voter-swing></app-voter-swing>
        </section>
        
        <section id="try" class="py-20 px-6 bg-gray-50">
          <app-try-it></app-try-it>
        </section>
      </main>
      
      <footer class="border-t border-gray-200 py-12 px-6">
        <div class="max-w-4xl mx-auto text-center text-gray-500">
          <p>© 2025 GeoDistricts. Objective redistricting through AI.</p>
        </div>
      </footer>
    </div>
  `,
})
export class HomePageComponent {
  activeSection = 'home';

  scrollToSection(sectionId: string) {
    this.activeSection = sectionId;
    const element = document.getElementById(sectionId);
    element?.scrollIntoView({ behavior: 'smooth' });
  }
}

