import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule, MatCardModule],
  template: `
    <mat-card [class]="cn('bg-card text-card-foreground flex flex-col gap-6 rounded-xl border', cardClass)">
      <ng-content></ng-content>
    </mat-card>
  `,
})
export class CardComponent {
  @Input() cardClass = '';
  cn = cn;
}

