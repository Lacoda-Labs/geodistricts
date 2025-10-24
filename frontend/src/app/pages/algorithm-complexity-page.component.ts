import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-algorithm-complexity-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './algorithm-complexity-page.component.html',
  styleUrls: ['./algorithm-complexity-page.component.scss']
})
export class AlgorithmComplexityPageComponent {
  constructor() { }

  scrollToSection(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
