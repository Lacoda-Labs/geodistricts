import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-sheet',
  standalone: true,
  imports: [CommonModule, MatSidenavModule, MatButtonModule, MatIconModule],
  template: `
    <mat-drawer-container>
      <mat-drawer #drawer mode="over" position="end" [opened]="opened">
        <div class="p-4">
          <button mat-icon-button (click)="close()" class="absolute top-4 right-4">
            <mat-icon>close</mat-icon>
          </button>
          <ng-content></ng-content>
        </div>
      </mat-drawer>
      <mat-drawer-content>
        <ng-content select="[trigger]"></ng-content>
      </mat-drawer-content>
    </mat-drawer-container>
  `,
})
export class SheetComponent {
  @Input() opened = false;
  @Output() openedChange = new EventEmitter<boolean>();

  close() {
    this.opened = false;
    this.openedChange.emit(false);
  }
}

