import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StateRowData {
  stateCode: string;
  stateName?: string;
  districts: number;
  congressD: number;
  congressR: number;
  congressDChange?: number;
  congressRChange?: number;
  geodistrictsD: number;
  geodistrictsR: number;
  geodistrictsDChange?: number;
  geodistrictsRChange?: number;
  swing: number;
  /** Delta from 119th Congress to GeoDistricts: D seats gained (show D:+N in blue when > 0). */
  geodistrictsDDeltaFromCongress?: number;
  /** Delta from 119th Congress to GeoDistricts: R seats gained (show R:+N in red when > 0). */
  geodistrictsRDeltaFromCongress?: number;
}

@Component({
  selector: 'app-state-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './state-row.component.html',
  styleUrls: ['./state-row.component.scss']
})
export class StateRowComponent {
  @Input() data!: StateRowData;
  @Input() clickable: boolean = true;
  @Input() background: 'off' | 'on' = 'off';
  @Input() section: 'us-data' | 'info' = 'us-data'; // Determines text color (white for us-data, colored for info)
  
  @Output() rowClick = new EventEmitter<string>();

  onRowClick(): void {
    if (this.clickable && this.data.stateCode !== 'US') {
      this.rowClick.emit(this.data.stateCode);
    }
  }

  /** Format delta for display: always (+n). */
  formatDelta(change: number | undefined): string {
    if (change === undefined || change === null) return '';
    return `(+${Math.abs(change)})`;
  }

  /** Format district-level delta from Congress for GeoDistricts column: e.g. D:+1 or R:+1 (always +N). */
  formatDeltaFromCongress(party: 'D' | 'R', delta: number | undefined): string {
    if (delta == null || delta <= 0) return '';
    return `${party}:+${delta}`;
  }

  /** True if D has majority in 119th Congress column (show D delta). Tie: D. */
  get showCongressDDelta(): boolean {
    return (this.data.congressD >= this.data.congressR) && this.data.congressDChange !== undefined && this.data.congressDChange !== null;
  }

  /** True if R has majority in 119th Congress column (show R delta). Tie: D wins so no R. */
  get showCongressRDelta(): boolean {
    return (this.data.congressR > this.data.congressD) && this.data.congressRChange !== undefined && this.data.congressRChange !== null;
  }

  /** True when GeoDistricts has more D seats than 119th Congress (show D:+N in blue). */
  get showGeodistrictsDDeltaFromCongress(): boolean {
    return (this.data.geodistrictsDDeltaFromCongress ?? 0) > 0;
  }

  /** True when GeoDistricts has more R seats than 119th Congress (show R:+N in red). */
  get showGeodistrictsRDeltaFromCongress(): boolean {
    return (this.data.geodistrictsRDeltaFromCongress ?? 0) > 0;
  }

  /** Share of Congress column that is D (0–1). Used for shade intensity. */
  get congressDPct(): number {
    const t = this.data.congressD + this.data.congressR;
    return t ? this.data.congressD / t : 0;
  }

  /** Share of Congress column that is R (0–1). Used for shade intensity. */
  get congressRPct(): number {
    const t = this.data.congressD + this.data.congressR;
    return t ? this.data.congressR / t : 0;
  }

  /** Share of GeoDistricts column that is D (0–1). Used for shade intensity. */
  get geodistrictsDPct(): number {
    const t = this.data.geodistrictsD + this.data.geodistrictsR;
    return t ? this.data.geodistrictsD / t : 0;
  }

  /** Share of GeoDistricts column that is R (0–1). Used for shade intensity. */
  get geodistrictsRPct(): number {
    const t = this.data.geodistrictsD + this.data.geodistrictsR;
    return t ? this.data.geodistrictsR / t : 0;
  }
}

