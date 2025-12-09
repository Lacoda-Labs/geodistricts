import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
  ],
  templateUrl: './page-header.component.html',
  styleUrls: ['./page-header.component.scss'],
})
export class PageHeaderComponent {
  @Output() homeClick = new EventEmitter<void>();

  onHomeClick(): void {
    this.homeClick.emit();
  }
}

