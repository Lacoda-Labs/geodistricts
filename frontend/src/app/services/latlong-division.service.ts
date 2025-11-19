import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { DistrictGroup, ALGORITHM_VERSION } from './geodistrict-algorithm.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LatLongDivisionService {
  // Use base URL without /api since routes already include /api
  private readonly backendUrl = environment.censusProxyUrl || environment.apiUrl.replace('/api', '') || 'http://localhost:8080';

  constructor(
    private http: HttpClient
  ) {}

  /**
   * Generate a cache key for division results
   */
  private generateCacheKey(group: DistrictGroup, direction: 'latitude' | 'longitude'): string {
    // Create a unique key based on group properties and direction
    const keyData = {
      startDistrict: group.startDistrictNumber,
      endDistrict: group.endDistrictNumber,
      totalDistricts: group.totalDistricts,
      tractCount: group.censusTracts.length,
      totalPopulation: group.totalPopulation,
      direction: direction,
      // Include bounds for uniqueness
      north: group.bounds.north.toFixed(6),
      south: group.bounds.south.toFixed(6),
      east: group.bounds.east.toFixed(6),
      west: group.bounds.west.toFixed(6)
    };

    // Simple hash function for the key
    const str = JSON.stringify(keyData);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `latlong_division_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if cached result exists for this division
   */
  private checkCache(cacheKey: string): Observable<any> {
    // Backend handles version checking internally, no need to send version
    const url = `${this.backendUrl}/api/algorithm/latlong/cache/${encodeURIComponent(cacheKey)}`;
    return this.http.get<{ status: string; cached: boolean; data?: any; algorithmVersion?: string }>(url).pipe(
      map((response: any) => {
        if (response.cached && response.data) {
          // Backend already validated version, but log it for debugging
          console.log(`✅ LATLONG CACHE HIT: Retrieved cached result for key: ${cacheKey} (algorithm version: ${response.algorithmVersion || 'unknown'})`);
          return response.data;
        }
        return null;
      }),
      catchError(error => {
        console.warn(`⚠️ LATLONG CACHE CHECK FAILED: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Store division result in cache
   */
  private storeInCache(cacheKey: string, divisionResult: any): Observable<any> {
    const url = `${this.backendUrl}/api/algorithm/latlong/cache`;
    const payload = {
      cacheKey,
      divisionResult,
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      algorithmVersion: ALGORITHM_VERSION // Include algorithm version for cache validation
    };

    return this.http.post(url, payload).pipe(
      map((response: any) => {
        return response;
      }),
      catchError(error => {
        console.error(`Cache store failed for ${cacheKey}:`, error);
        return of(null);
      })
    );
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @param forceRecalculate Force recalculation even if cached result exists
   * @returns Observable with division result
   */
  divideDistrictGroup(group: DistrictGroup, direction: 'latitude' | 'longitude', forceRecalculate: boolean = false): Observable<{
    groups: DistrictGroup[];
    history: string[];
    dividingLine: number;
    intersectingTractIds?: string[];
  }> {
    return new Observable(observer => {
      const cacheKey = this.generateCacheKey(group, direction);

      // Check cache first unless force recalculate is requested
      if (!forceRecalculate) {
        this.checkCache(cacheKey).subscribe(cachedResult => {
          if (cachedResult) {
            observer.next(cachedResult);
            observer.complete();
            return;
          }

          // Cache miss - compute the result via backend API
          this.computeDivisionResult(group, direction, cacheKey).subscribe(result => {
            observer.next(result);
            observer.complete();
          });
        });
      } else {
        // Force recalculate - compute directly via backend API
        this.computeDivisionResult(group, direction, cacheKey).subscribe(result => {
          observer.next(result);
          observer.complete();
        });
      }
    });
  }

  /**
   * Compute the division result by calling the backend API
   */
  private computeDivisionResult(group: DistrictGroup, direction: 'latitude' | 'longitude', cacheKey: string): Observable<{
    groups: DistrictGroup[];
    history: string[];
    dividingLine: number;
    intersectingTractIds?: string[];
  }> {
    const url = `${this.backendUrl}/api/algorithm/latlong/divide`;
    
    return this.http.post<{
      status: string;
      groups: DistrictGroup[];
      history: string[];
      dividingLine: number;
      intersectingTractIds?: string[];
    }>(url, {
      group,
      direction,
      forceRecalculate: false
    }).pipe(
      map((response: any) => {
        if (response.status === 'success') {
          const result = {
            groups: response.groups,
            history: response.history || [],
            dividingLine: response.dividingLine,
            intersectingTractIds: response.intersectingTractIds
          };
          
          // Store result in cache (fire and forget)
          this.storeInCache(cacheKey, result).subscribe({
            next: () => console.log(`✅ Cached division result for key: ${cacheKey}`),
            error: (err) => console.warn(`⚠️ Failed to cache division result: ${err.message}`)
          });
          
          return result;
        } else {
          throw new Error(response.message || 'Division failed');
        }
      }),
      catchError(error => {
        console.error(`❌ Error computing division: ${error.message}`);
        return this.handleError(error);
      })
    );
  }

  /**
   * Handle errors from API calls
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error) {
      errorMessage = error.error.message || error.error.error || errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    console.error('❌ LatLong Division Service Error:', errorMessage);
    return new Observable(observer => {
      observer.error(new Error(errorMessage));
    });
  }
}
