import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

const GITHUB_CONTENTS = 'https://api.github.com/repos/JeffreyBLewis/congressional-district-boundaries/contents/GeoJson';
const RAW_BASE = 'https://raw.githubusercontent.com/JeffreyBLewis/congressional-district-boundaries/master/GeoJson';
const FILE_REGEX = /^(.+)_(\d+)_to_(\d+)\.geojson$/i;

/** GeoJSON FeatureCollection as returned by the API */
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: number[] | number[][] | number[][][] | number[][][][];
}

export interface CongressStateListResponse {
  congress: number;
  stateNames: string[];
}

/** Per-state GeoJSON keyed by state name (as stored, e.g. Alabama, New_York) */
export type BoundariesByState = Record<string, GeoJsonFeatureCollection>;

@Injectable({
  providedIn: 'root'
})
export class CongressionalBoundariesService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get list of state names that have boundary data for a Congress.
   */
  getStateNamesForCongress(congress: number): Observable<string[]> {
    return this.http
      .get<CongressStateListResponse>(`${this.apiUrl}/congressional-boundaries/${congress}`)
      .pipe(
        map(res => res.stateNames || []),
        catchError(() => of([]))
      );
  }

  /**
   * Get GeoJSON for one state.
   */
  getBoundariesForState(congress: number, stateName: string): Observable<GeoJsonFeatureCollection | null> {
    return this.http
      .get<GeoJsonFeatureCollection>(`${this.apiUrl}/congressional-boundaries/${congress}/${encodeURIComponent(stateName)}`)
      .pipe(catchError(() => of(null)));
  }

  /**
   * Get all state boundaries for a Congress. Uses API first; if no data, falls back to Lewis GitHub repo.
   */
  getBoundariesByCongress(congress: number): Observable<BoundariesByState> {
    return this.getStateNamesForCongress(congress).pipe(
      switchMap(stateNames => {
        if (stateNames.length > 0) {
          return forkJoin(
            stateNames.map(name =>
              this.getBoundariesForState(congress, name).pipe(
                map(geo => (geo ? { [name]: geo } : {}))
              )
            )
          ).pipe(map(arr => Object.assign({}, ...arr)));
        }
        return this.fetchFromLewis(congress);
      }),
      catchError(() => of({}))
    );
  }

  /**
   * Fallback: fetch boundary GeoJSON from Lewis repo when API has no data.
   */
  private fetchFromLewis(congress: number): Observable<BoundariesByState> {
    return this.http.get<Array<{ name: string; download_url?: string }>>(GITHUB_CONTENTS, {
      params: { per_page: '100' },
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'GeoDistricts' }
    }).pipe(
      catchError(() => of([])),
      switchMap(contents => {
        const files = (Array.isArray(contents) ? contents : [])
          .filter(f => f.name && f.name.endsWith('.geojson'))
          .map(f => {
            const m = f.name.match(FILE_REGEX);
            return m ? { stateName: m[1], start: +m[2], end: +m[3], name: f.name } : null;
          })
          .filter((f): f is { stateName: string; start: number; end: number; name: string } =>
            f !== null && congress >= f.start && congress <= f.end
          );
        if (files.length === 0) return of({});
        const url = (n: string) => `${RAW_BASE}/${encodeURIComponent(n)}`;
        return forkJoin(
          files.map(f =>
            this.http.get<GeoJsonFeatureCollection>(url(f.name)).pipe(
              map(geo => ({ [f.stateName]: geo })),
              catchError(() => of({}))
            )
          )
        ).pipe(map(arr => Object.assign({}, ...arr)));
      })
    );
  }
}
