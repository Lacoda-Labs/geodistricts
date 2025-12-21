import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export interface StateRowData {
  stateCode: string;
  stateName?: string;
  districts: number;
  congressD: number;
  congressR: number;
  congressDChange?: number;
  geodistrictsD: number;
  geodistrictsR: number;
  geodistrictsDChange?: number;
  swing: number;
}

@Component({
  selector: 'app-state-row',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './state-row.component.html',
  styleUrls: ['./state-row.component.scss']
})
export class StateRowComponent {
  @Input() data!: StateRowData;
  @Input() showArrow: boolean = true;
  @Input() clickable: boolean = true;
  @Input() variant: 'default' | 'no-bkg' = 'no-bkg';
  @Input() section: 'us-data' | 'info' = 'us-data'; // Determines text color (white for us-data, colored for info)
  
  @Output() rowClick = new EventEmitter<string>();

  onRowClick(): void {
    if (this.clickable && this.data.stateCode !== 'US') {
      this.rowClick.emit(this.data.stateCode);
    }
  }
}

