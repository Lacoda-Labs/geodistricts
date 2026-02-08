import {
  Component,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  AfterViewInit,
  ChangeDetectorRef,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CongressionalBoundariesService, BoundariesByState, GeoJsonFeatureCollection } from '../services/congressional-boundaries.service';
import { transformGeoJson, ALASKA_TRANSFORM, HAWAII_TRANSFORM } from '../utils/geo-transform';
import {
  featureCollectionToPathDs,
  CONUS_BOUNDS,
  ALASKA_INSET_BOUNDS,
  HAWAII_INSET_BOUNDS,
  SVG_VIEWBOX
} from '../utils/geo-svg';

const DEFAULT_CONGRESS = 119;

@Component({
  selector: 'app-us-congressional-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './us-congressional-map.component.html',
  styleUrls: ['./us-congressional-map.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class UsCongressionalMapComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() congress: number = DEFAULT_CONGRESS;

  isLoading = true;
  errorMessage: string | null = null;
  byState: BoundariesByState | null = null;
  svgPathD: string[] = [];
  viewBox = SVG_VIEWBOX;
  private subscription: Subscription | null = null;

  constructor(
    private boundariesService: CongressionalBoundariesService,
    private cdr: ChangeDetectorRef
  ) {}

  objectKeys(obj: BoundariesByState | null): string[] {
    return obj ? Object.keys(obj) : [];
  }

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['congress'] && !changes['congress'].firstChange) {
      this.loadBoundaries();
    }
  }

  ngAfterViewInit(): void {
    this.loadBoundaries();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private loadBoundaries(): void {
    this.isLoading = true;
    this.errorMessage = null;
    this.byState = null;
    this.svgPathD = [];
    this.cdr.markForCheck();

    this.subscription?.unsubscribe();
    this.subscription = this.boundariesService.getBoundariesByCongress(this.congress).subscribe({
      next: (byState) => {
        this.isLoading = false;
        this.errorMessage = null;
        this.byState = byState;
        this.svgPathD = this.buildSvgPaths(byState);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err?.message || 'Failed to load congressional boundaries.';
        this.cdr.markForCheck();
      }
    });
  }

  private buildSvgPaths(byState: BoundariesByState): string[] {
    const paths: string[] = [];
    const stateNames = Object.keys(byState);
    const conus = stateNames.filter(n => n !== 'Alaska' && n !== 'Hawaii');
    const alaska = byState['Alaska'];
    const hawaii = byState['Hawaii'];

    conus.forEach(name => {
      const geo = byState[name];
      if (geo) paths.push(...featureCollectionToPathDs(geo, CONUS_BOUNDS));
    });
    if (alaska) {
      const transformed = transformGeoJson(alaska, ALASKA_TRANSFORM);
      paths.push(...featureCollectionToPathDs(transformed, ALASKA_INSET_BOUNDS));
    }
    if (hawaii) {
      const transformed = transformGeoJson(hawaii, HAWAII_TRANSFORM);
      paths.push(...featureCollectionToPathDs(transformed, HAWAII_INSET_BOUNDS));
    }
    return paths;
  }
}
