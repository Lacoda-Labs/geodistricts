import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule, MatChipsModule],
  template: `
    <mat-chip [class]="cn('inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0', badgeClass)"
              [color]="variant === 'destructive' ? 'warn' : 'primary'">
      <ng-content></ng-content>
    </mat-chip>
  `,
})
export class BadgeComponent {
  @Input() variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
  @Input() badgeClass = '';
  cn = cn;
}

