import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

export interface SelectOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSelectModule, MatFormFieldModule],
  template: `
    <mat-form-field [class]="formFieldClass">
      <mat-label *ngIf="label">{{ label }}</mat-label>
      <mat-select
        [value]="value"
        [placeholder]="placeholder"
        (selectionChange)="onValueChange.emit($event.value)">
        <mat-option *ngFor="let option of options" [value]="option.value">
          {{ option.label }}
        </mat-option>
      </mat-select>
    </mat-form-field>
  `,
})
export class SelectComponent {
  @Input() value = '';
  @Input() options: SelectOption[] = [];
  @Input() label = '';
  @Input() placeholder = '';
  @Input() formFieldClass = 'w-full';
  @Output() onValueChange = new EventEmitter<string>();
}

