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
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CongressionalBoundariesService, BoundariesByState, GeoJsonFeatureCollection } from '../services/congressional-boundaries.service';
import { GeodistrictAlgorithmService, GeodistrictStep } from '../services/geodistrict-algorithm.service';
import { transformGeoJson, ALASKA_TRANSFORM, HAWAII_TRANSFORM } from '../utils/geo-transform';
import {
  featureCollectionToPathDs,
  featureCollectionToPathDsByFeature,
  featureCollectionToPathDsWithUniformScale,
  featureCollectionToPathDsByFeatureWithUniformScale,
  CONUS_BOUNDS,
  SVG_VIEWBOX
} from '../utils/geo-svg';

/** Inset size in SVG units (viewBox 0 0 800 500) */
const INSET_SIZE = 50;

/** Alaska 50×50px inset, bottom-left – aspect ratio preserved via uniform scale */
const ALASKA_INSET_SVG = { x1: 40, y1: 500 - INSET_SIZE, x2: 40 + INSET_SIZE, y2: 500 };

/** Hawaii 50×50px inset, next to Alaska – aspect ratio preserved via uniform scale */
const HAWAII_INSET_SVG = { x1: 95, y1: 500 - INSET_SIZE, x2: 95 + INSET_SIZE, y2: 500 };

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
  /** When false, only CONUS is drawn (e.g. for hero background). */
  @Input() showInsetStates = true;
  /** 'hero' = translucent outline style for background use. */
  @Input() variant: 'default' | 'hero' = 'default';

  isLoading = true;
  errorMessage: string | null = null;
  byState: BoundariesByState | null = null;
  svgPathD: string[] = [];
  /** Hero only: paths revealed one-by-one with fill during state draw, then stroke-only. */
  heroAnimatedPaths: { d: string; stateKey: string; filled: boolean }[] = [];
  viewBox = SVG_VIEWBOX;
  private subscription: Subscription | null = null;
  private heroAnimationTimeouts: ReturnType<typeof setTimeout>[] = [];
  private lastStep0Ak: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null = null;
  private lastStep0Hi: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null = null;

  private static readonly HERO_DRAW_DURATION_MS = 30 * 1000;

  constructor(
    private boundariesService: CongressionalBoundariesService,
    private geodistrictService: GeodistrictAlgorithmService,
    private cdr: ChangeDetectorRef
  ) {}

  objectKeys(obj: BoundariesByState | null): string[] {
    return obj ? Object.keys(obj) : [];
  }

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['congress'] && !changes['congress'].firstChange) {
      this.loadBoundaries();
      return;
    }
    if ((changes['showInsetStates'] || changes['variant']) && this.byState) {
      this.svgPathD = this.buildSvgPaths(this.byState, this.lastStep0Ak, this.lastStep0Hi);
      this.cdr.markForCheck();
    }
  }

  ngAfterViewInit(): void {
    this.loadBoundaries();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.clearHeroAnimation();
  }

  private clearHeroAnimation(): void {
    this.heroAnimationTimeouts.forEach(t => clearTimeout(t));
    this.heroAnimationTimeouts = [];
  }

  private loadBoundaries(): void {
    this.isLoading = true;
    this.errorMessage = null;
    this.byState = null;
    this.svgPathD = [];
    this.cdr.markForCheck();

    const step0Ak$ = this.geodistrictService.getStep('AK', 0, 100).pipe(catchError(() => of(null)));
    const step0Hi$ = this.geodistrictService.getStep('HI', 0, 100).pipe(catchError(() => of(null)));

    this.subscription?.unsubscribe();
    this.subscription = forkJoin({
      byState: this.boundariesService.getBoundariesByCongress(this.congress),
      step0Ak: step0Ak$,
      step0Hi: step0Hi$
    }).subscribe({
      next: ({ byState, step0Ak, step0Hi }) => {
        this.isLoading = false;
        this.errorMessage = null;
        this.byState = byState;
        this.lastStep0Ak = step0Ak;
        this.lastStep0Hi = step0Hi;
        if (this.variant === 'hero') {
          this.heroAnimatedPaths = [];
          this.svgPathD = [];
          this.startHeroDrawAnimation(byState, step0Ak, step0Hi);
        } else {
          this.svgPathD = this.buildSvgPaths(byState, step0Ak, step0Hi);
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err?.message || 'Failed to load congressional boundaries.';
        this.cdr.markForCheck();
      }
    });
  }

  private buildSvgPaths(
    byState: BoundariesByState,
    step0Ak: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null,
    step0Hi: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null
  ): string[] {
    const paths: string[] = [];
    const stateNames = Object.keys(byState);
    const conus = stateNames.filter(n => n !== 'Alaska' && n !== 'Hawaii');

    conus.forEach(name => {
      const geo = byState[name];
      if (geo) paths.push(...featureCollectionToPathDs(geo, CONUS_BOUNDS));
    });

    if (!this.showInsetStates) return paths;

    const alaskaCollection = this.step0ToFeatureCollection(step0Ak);
    if (alaskaCollection) {
      const transformed = transformGeoJson(alaskaCollection, ALASKA_TRANSFORM);
      paths.push(...featureCollectionToPathDsWithUniformScale(
        transformed,
        ALASKA_INSET_SVG.x1,
        ALASKA_INSET_SVG.y1,
        ALASKA_INSET_SVG.x2,
        ALASKA_INSET_SVG.y2
      ));
    }

    const hawaiiCollection = this.step0ToFeatureCollection(step0Hi);
    if (hawaiiCollection) {
      const transformed = transformGeoJson(hawaiiCollection, HAWAII_TRANSFORM);
      paths.push(...featureCollectionToPathDsWithUniformScale(
        transformed,
        HAWAII_INSET_SVG.x1,
        HAWAII_INSET_SVG.y1,
        HAWAII_INSET_SVG.x2,
        HAWAII_INSET_SVG.y2
      ));
    }
    return paths;
  }

  /** Build districts (one path array per feature) grouped by state for hero animation. */
  private buildSvgPathsByState(
    byState: BoundariesByState,
    step0Ak: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null,
    step0Hi: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null
  ): { state: string; districts: string[][] }[] {
    const out: { state: string; districts: string[][] }[] = [];
    const stateNames = Object.keys(byState);
    const conus = stateNames.filter(n => n !== 'Alaska' && n !== 'Hawaii');
    conus.forEach(name => {
      const geo = byState[name];
      if (geo) {
        const districts = featureCollectionToPathDsByFeature(geo, CONUS_BOUNDS);
        if (districts.length) out.push({ state: name, districts });
      }
    });
    if (this.showInsetStates) {
      const alaskaCollection = this.step0ToFeatureCollection(step0Ak);
      if (alaskaCollection) {
        const transformed = transformGeoJson(alaskaCollection, ALASKA_TRANSFORM);
        const districts = featureCollectionToPathDsByFeatureWithUniformScale(
          transformed,
          ALASKA_INSET_SVG.x1,
          ALASKA_INSET_SVG.y1,
          ALASKA_INSET_SVG.x2,
          ALASKA_INSET_SVG.y2
        );
        if (districts.length) out.push({ state: 'Alaska', districts });
      }
      const hawaiiCollection = this.step0ToFeatureCollection(step0Hi);
      if (hawaiiCollection) {
        const transformed = transformGeoJson(hawaiiCollection, HAWAII_TRANSFORM);
        const districts = featureCollectionToPathDsByFeatureWithUniformScale(
          transformed,
          HAWAII_INSET_SVG.x1,
          HAWAII_INSET_SVG.y1,
          HAWAII_INSET_SVG.x2,
          HAWAII_INSET_SVG.y2
        );
        if (districts.length) out.push({ state: 'Hawaii', districts });
      }
    }
    return out;
  }

  private startHeroDrawAnimation(
    byState: BoundariesByState,
    step0Ak: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null,
    step0Hi: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null
  ): void {
    this.clearHeroAnimation();
    const byStateList = this.buildSvgPathsByState(byState, step0Ak, step0Hi);
    if (byStateList.length === 0) return;
    // Shuffle state order; flatten to one entry per district (each district = array of path d)
    const shuffled = [...byStateList].sort(() => Math.random() - 0.5);
    const flat: { paths: string[]; stateKey: string; isLastInState: boolean }[] = [];
    shuffled.forEach(({ state, districts }) => {
      districts.forEach((pathDs, i) => {
        flat.push({
          paths: pathDs,
          stateKey: state,
          isLastInState: i === districts.length - 1
        });
      });
    });
    const totalDistricts = flat.length;
    if (totalDistricts === 0) return;
    const delayMs = UsCongressionalMapComponent.HERO_DRAW_DURATION_MS / totalDistricts;
    flat.forEach((item, i) => {
      const t = setTimeout(() => {
        item.paths.forEach(d => {
          this.heroAnimatedPaths.push({ d, stateKey: item.stateKey, filled: true });
        });
        if (item.isLastInState) {
          setTimeout(() => {
            this.heroAnimatedPaths.forEach(p => {
              if (p.stateKey === item.stateKey) p.filled = false;
            });
            this.cdr.markForCheck();
          }, 0);
        }
        this.cdr.markForCheck();
      }, i * delayMs);
      this.heroAnimationTimeouts.push(t);
    });
  }

  /** Build a FeatureCollection from algorithm step 0 first group union polygon(s). */
  private step0ToFeatureCollection(
    stepResult: { step: GeodistrictStep; stepIndex: number; isComplete: boolean } | null
  ): GeoJsonFeatureCollection | null {
    if (!stepResult?.step?.districtGroups?.length) return null;
    const group = stepResult.step.districtGroups[0];
    const unionPolygons = (group as { unionPolygons?: Array<{ type: string; geometry: unknown; properties?: unknown }> }).unionPolygons;
    const unionPolygon = (group as { unionPolygon?: { type: string; geometry: unknown; properties?: unknown } }).unionPolygon;
    let features: Array<{ type: string; geometry: unknown; properties?: unknown }>;
    if (Array.isArray(unionPolygons) && unionPolygons.length > 0) {
      features = unionPolygons.filter(f => f != null && typeof (f as any).geometry !== 'undefined');
    } else if (unionPolygon && (unionPolygon as any).geometry) {
      features = [unionPolygon];
    } else {
      return null;
    }
    if (features.length === 0) return null;
    return { type: 'FeatureCollection', features: features as GeoJsonFeatureCollection['features'] };
  }
}
