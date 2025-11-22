import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { PageHeaderComponent } from '../components/page-header.component';

@Component({
  selector: 'app-terms-page',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent],
  templateUrl: './terms-page.component.html',
  styleUrls: ['./terms-page.component.scss'],
})
export class TermsPageComponent {
  constructor(private router: Router) {}

  goHome(): void {
    this.router.navigate(['/home']);
  }
}

