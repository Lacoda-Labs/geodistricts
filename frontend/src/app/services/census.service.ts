import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError, switchMap, mergeMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Census API Configuration is now handled by the backend proxy service

// Cloud Run Census Proxy Configuration
const CENSUS_PROXY_BASE = environment.censusProxyUrl || 'https://census-proxy-<project-id>-uc.a.run.app';

// Cache is now handled by the backend proxy service

// TypeScript interfaces for census data
export interface CensusTractData {
  state: string;
  county: string;
  tract: string;
  name: string;
  population?: number;
  medianHouseholdIncome?: number;
  medianAge?: number;
  povertyRate?: number;
  educationLevel?: number;
  [key: string]: any; // Allow for additional dynamic properties
}

// Census API response types are now handled by the backend proxy service

// Census variable types are now handled by the backend proxy service

export interface GeoJsonFeature {
  type: 'Feature';
  properties: {
    STATE?: string;
    COUNTY?: string;
    TRACT?: string;
    STATE_FIPS?: string;
    COUNTY_FIPS?: string;
    TRACT_FIPS?: string;
    STATE_ABBR?: string;
    NAME?: string;
    POPULATION?: number;
    SQMI?: number;
    ALAND?: number;
    AWATER?: number;
    [key: string]: any;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
}

export interface GeoJsonResponse {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface TractDivisionOptions {
  ratio?: [number, number]; // Default [50, 50] for 50/50 split
  direction?: 'latitude' | 'longitude' | 'population'; // Default 'latitude'
}

export interface TractDivisionResult {
  northTracts: GeoJsonFeature[];
  southTracts: GeoJsonFeature[];
  eastTracts: GeoJsonFeature[];
  westTracts: GeoJsonFeature[];
  divisionLine: number; // The coordinate value where the division occurs (or population threshold)
  divisionType: 'latitude' | 'longitude' | 'population';
  totalPopulation: number;
  northPopulation: number;
  southPopulation: number;
  eastPopulation: number;
  westPopulation: number;
}

export interface District {
  id: number;
  tracts: GeoJsonFeature[];
  population: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centroid: {
    lat: number;
    lng: number;
  };
}

export interface RecursiveDivisionOptions {
  targetDistricts: number;
  maxIterations?: number;
  populationTolerance?: number; // Percentage tolerance for population balance
  preserveCountyBoundaries?: boolean; // Whether to prioritize county boundaries (default: true)
}

export interface DivisionStep {
  step: number;
  level: number;
  groups: Array<{
    id: number;
    tracts: GeoJsonFeature[];
    targetDistricts: number;
    direction: 'latitude' | 'longitude';
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
    centroid: {
      lat: number;
      lng: number;
    };
    population: number;
  }>;
  description: string;
  totalGroups: number;
  totalDistricts: number;
}

export interface RecursiveDivisionResult {
  districts: District[];
  totalPopulation: number;
  averagePopulation: number;
  populationVariance: number;
  divisionHistory: string[];
  divisionSteps: DivisionStep[];
}

export interface CountyGroup {
  countyId: string;
  countyName: string;
  tracts: GeoJsonFeature[];
  population: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centroid: {
    lat: number;
    lng: number;
  };
}

// Cache is now handled by the backend proxy service

@Injectable({
  providedIn: 'root'
})
export class CensusService {
  constructor(private http: HttpClient) {
    // API key is now handled by the Cloud Run proxy service
  }

  // Cache is now handled by the backend proxy service

  /**
   * Get cache info from Cloud Run proxy
   */
  getProxyCacheInfo(): Observable<any[]> {
    return this.http.get<any[]>(`${CENSUS_PROXY_BASE}/api/census/cache-info`).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Clear cache on Cloud Run proxy
   */
  clearProxyCache(key?: string): Observable<any> {
    const url = key ? `${CENSUS_PROXY_BASE}/api/census/cache?key=${encodeURIComponent(key)}` : `${CENSUS_PROXY_BASE}/api/census/cache`;
    return this.http.delete(url).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Debug method to log both local and proxy cache status
   */
  debugAllCacheStatus(): void {
    console.log('=== All Cache Status Debug ===');
    
    // Local cache is now handled by the backend proxy service
    console.log('Local cache is now handled by the backend proxy service');
    
    // Proxy cache
    this.getProxyCacheInfo().subscribe({
      next: (proxyCacheInfo) => {
        console.log('=== Cloud Run Proxy Cache Debug ===');
        console.log(`Proxy cache entries: ${proxyCacheInfo.length}`);
        proxyCacheInfo.forEach(entry => {
          console.log(`- ${entry.key}: ${entry.isExpired ? 'EXPIRED' : 'VALID'} (${new Date(entry.timestamp).toISOString()}, size: ${entry.size} bytes)`);
        });
        console.log('=== End Proxy Cache Debug ===');
      },
      error: (error) => {
        console.error('Failed to get proxy cache info:', error);
      }
    });
  }

  /**
   * Get census tract data for a specific tract
   */
  getTractData(state: string, county?: string, tract?: string, forceInvalidate: boolean = false): Observable<CensusTractData[]> {
    const params = new URLSearchParams();
    params.set('state', state);
    if (county) params.set('county', county);
    if (tract) params.set('tract', tract);
    if (forceInvalidate) params.set('forceInvalidate', 'true');

    return this.http.get<CensusTractData[]>(`${CENSUS_PROXY_BASE}/api/census/tract-data?${params.toString()}`).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get census tract data by state and county
   */
  getTractsByCounty(state: string, county: string, variables?: string[], forceInvalidate: boolean = false): Observable<CensusTractData[]> {
    return this.getTractData(state, county, undefined, forceInvalidate);
  }

  /**
   * Get census tract data by tract FIPS code
   */
  getTractByFips(state: string, county: string, tract: string, variables?: string[], forceInvalidate: boolean = false): Observable<CensusTractData[]> {
    return this.getTractData(state, county, tract, forceInvalidate);
  }

  /**
   * Get available census variables for a dataset
   */
  getVariables(dataset: string = 'acs/acs5', year: string = '2022'): Observable<any[]> {
    // Note: This method would need to be implemented in the Cloud Run proxy
    // For now, return empty array as this functionality is not critical
    console.warn('getVariables method not implemented in Cloud Run proxy');
    return new Observable(observer => {
      observer.next([]);
      observer.complete();
    });
  }

  /**
   * Search for census tracts by name or partial FIPS code
   */
  searchTracts(query: string, state?: string): Observable<CensusTractData[]> {
    // Note: This method would need to be implemented in the Cloud Run proxy
    // For now, return empty array as this functionality is not critical
    console.warn('searchTracts method not implemented in Cloud Run proxy');
    return new Observable(observer => {
      observer.next([]);
      observer.complete();
    });
  }

  /**
   * Get demographic summary for a census tract
   */
  getDemographicSummary(state: string, county: string, tract: string, forceInvalidate: boolean = false): Observable<any> {
    const demographicVariables = [
      'B01003_001E', // Total population
      'B01001_002E', // Male population
      'B01001_026E', // Female population
      'B02001_002E', // White alone
      'B02001_003E', // Black or African American alone
      'B02001_004E', // American Indian and Alaska Native alone
      'B02001_005E', // Asian alone
      'B02001_006E', // Native Hawaiian and Other Pacific Islander alone
      'B02001_007E', // Some other race alone
      'B02001_008E', // Two or more races
      'B03001_002E', // Not Hispanic or Latino
      'B03001_003E'  // Hispanic or Latino
    ];

    return this.getTractByFips(state, county, tract, demographicVariables, forceInvalidate).pipe(
      map(tracts => tracts.length > 0 ? this.calculateDemographicSummary(tracts[0]) : null)
    );
  }

  // Direct Census API calls are now handled by the backend proxy service

  // Census API response transformation is now handled by the backend proxy service



  // Variables response transformation is now handled by the backend proxy service

  /**
   * Calculate demographic summary
   */
  private calculateDemographicSummary(tractData: CensusTractData): any {
    const totalPop = tractData.population || 0;

    return {
      totalPopulation: totalPop,
      demographics: {
        male: tractData['B01001_002E'] || 0,
        female: tractData['B01001_026E'] || 0,
        white: tractData['B02001_002E'] || 0,
        black: tractData['B02001_003E'] || 0,
        asian: tractData['B02001_005E'] || 0,
        hispanic: tractData['B03001_003E'] || 0,
        other: (tractData['B02001_004E'] || 0) + (tractData['B02001_006E'] || 0) +
          (tractData['B02001_007E'] || 0) + (tractData['B02001_008E'] || 0)
      },
      percentages: {
        malePercent: totalPop > 0 ? ((tractData['B01001_002E'] || 0) / totalPop * 100).toFixed(1) : '0',
        femalePercent: totalPop > 0 ? ((tractData['B01001_026E'] || 0) / totalPop * 100).toFixed(1) : '0',
        whitePercent: totalPop > 0 ? ((tractData['B02001_002E'] || 0) / totalPop * 100).toFixed(1) : '0',
        blackPercent: totalPop > 0 ? ((tractData['B02001_003E'] || 0) / totalPop * 100).toFixed(1) : '0',
        asianPercent: totalPop > 0 ? ((tractData['B02001_005E'] || 0) / totalPop * 100).toFixed(1) : '0',
        hispanicPercent: totalPop > 0 ? ((tractData['B03001_003E'] || 0) / totalPop * 100).toFixed(1) : '0'
      }
    };
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): Observable<never> {
    console.error('Census API Error:', error);
    let errorMessage = 'An error occurred while fetching census data';

    if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return throwError(() => new Error(errorMessage));
  }


  /**
   * Get available datasets
   */
  getAvailableDatasets(): Observable<any> {
    // Note: This method would need to be implemented in the Cloud Run proxy
    // For now, return empty object as this functionality is not critical
    console.warn('getAvailableDatasets method not implemented in Cloud Run proxy');
    return new Observable(observer => {
      observer.next({});
      observer.complete();
    });
  }

  /**
   * Get census tract boundaries from TIGERweb via Cloud Run proxy
   */
  getTractBoundaries(state: string, county?: string, forceInvalidate: boolean = false): Observable<GeoJsonResponse> {
    const params = new URLSearchParams();
    params.set('state', state);
    if (county) params.set('county', county);
    if (forceInvalidate) params.set('forceInvalidate', 'true');

    console.log('Getting tract boundaries via Cloud Run proxy for state:', state);

    return this.http.get<any>(`${CENSUS_PROXY_BASE}/api/census/tract-boundaries?${params.toString()}`, {
      // Increase timeout for large datasets
      timeout: 300000 // 5 minutes
    }).pipe(
      map(response => {
        // Check if response is ultra-compressed format
        if (response.t === 'FeatureCollection' && response.f) {
          console.log(`Retrieved ultra-compressed ${response.f.length} tract boundaries for state ${state}`);
          return this.decompressGeoJson(response);
        } else {
          console.log(`Retrieved ${response.features?.length || 0} tract boundaries for state ${state}`);
          return response;
        }
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Decompress ultra-compressed GeoJSON format
   */
  private decompressGeoJson(compressed: any): GeoJsonResponse {
    if (!compressed || compressed.t !== 'FeatureCollection' || !compressed.f) {
      return compressed;
    }

    const features = compressed.f.map((feature: any) => ({
      type: feature.t,
      properties: {
        STATE_FIPS: feature.p.s,
        COUNTY_FIPS: feature.p.c,
        TRACT_FIPS: feature.p.t,
        POPULATION: feature.p.pop
      },
      geometry: {
        type: feature.g.t,
        coordinates: feature.g.c
      }
    }));

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  // Direct TIGERweb calls are now handled by the backend proxy service

  // Paginated TIGERweb calls are now handled by the backend proxy service


  /**
   * Get county boundaries from TIGERweb
   */
  getCountyBoundaries(state: string): Observable<GeoJsonResponse> {
    // Note: This method would need to be implemented in the Cloud Run proxy
    // For now, return empty response as this functionality is not critical
    console.warn('getCountyBoundaries method not implemented in Cloud Run proxy');
    return new Observable(observer => {
      observer.next({
        type: 'FeatureCollection',
        features: []
      });
      observer.complete();
    });
  }

  /**
   * Get state boundaries from TIGERweb
   */
  getStateBoundaries(state?: string): Observable<GeoJsonResponse> {
    // Note: This method would need to be implemented in the Cloud Run proxy
    // For now, return empty response as this functionality is not critical
    console.warn('getStateBoundaries method not implemented in Cloud Run proxy');
    return new Observable(observer => {
      observer.next({
        type: 'FeatureCollection',
        features: []
      });
      observer.complete();
    });
  }

  /**
   * Get combined tract data with boundaries
   */
  getTractDataWithBoundaries(state: string, county?: string, forceInvalidate: boolean = false): Observable<{
    demographic: CensusTractData[];
    boundaries: GeoJsonResponse;
  }> {
    const demographicData$ = county
      ? this.getTractsByCounty(state, county, undefined, forceInvalidate)
      : this.getTractData(state, undefined, undefined, forceInvalidate);

    const boundaryData$ = this.getTractBoundaries(state, county, forceInvalidate);

    return new Observable(observer => {
      let demographicData: CensusTractData[] = [];
      let boundaryData: GeoJsonResponse | null = null;
      let completed = 0;

      const checkComplete = () => {
        completed++;
        if (completed === 2) {
          observer.next({
            demographic: demographicData,
            boundaries: boundaryData!
          });
          observer.complete();
        }
      };

      demographicData$.subscribe({
        next: (data) => {
          demographicData = data;
          checkComplete();
        },
        error: (error) => {
          console.warn('Failed to load demographic data:', error);
          checkComplete();
        }
      });

      boundaryData$.subscribe({
        next: (data) => {
          boundaryData = data;
          checkComplete();
        },
        error: (error) => {
          console.warn('Failed to load boundary data:', error);
          checkComplete();
        }
      });
    });
  }

  /**
   * Sort tracts using boundary-based adjacency to ensure true geographic contiguity
   * @param tractsWithCentroids Array of tracts with their centroids
   * @param direction Either 'latitude' for north/south or 'longitude' for east/west
   * @returns Sorted array of tracts in contiguous order
   */
  private zigZagSortTracts(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    direction: 'latitude' | 'longitude'
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    if (tractsWithCentroids.length === 0) return [];

    // For small datasets, try boundary-based adjacency sorting with timeout
    if (tractsWithCentroids.length <= 50) {
      try {
        const startTime = Date.now();
        const result = this.sortTractsByAdjacency(tractsWithCentroids, direction);
        const elapsed = Date.now() - startTime;
        
        if (elapsed > 5000) { // If it took more than 5 seconds, warn and use fallback
          console.warn(`Boundary-based sorting took ${elapsed}ms, using fallback for better performance`);
          return this.fallbackGeographicSort(tractsWithCentroids, direction);
        }
        
        return result;
      } catch (error) {
        console.warn('Boundary-based sorting failed, falling back to geographic sorting:', error);
        return this.fallbackGeographicSort(tractsWithCentroids, direction);
      }
    }

    // For larger datasets, use efficient geographic sorting to prevent performance issues
    console.log(`Using efficient geographic sorting for ${tractsWithCentroids.length} tracts`);
    return this.fallbackGeographicSort(tractsWithCentroids, direction);
  }

  /**
   * Sort tracts by boundary-based adjacency to ensure true contiguity
   * @param tractsWithCentroids Array of tracts with their centroids
   * @param direction Either 'latitude' for north/south or 'longitude' for east/west
   * @returns Sorted array of tracts in contiguous order
   */
  private sortTractsByAdjacency(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    direction: 'latitude' | 'longitude'
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    if (tractsWithCentroids.length === 0) return [];
    if (tractsWithCentroids.length === 1) return tractsWithCentroids;

    // Find the starting tract (top-north-west)
    let startTract = tractsWithCentroids[0];
    for (const tract of tractsWithCentroids) {
      if (tract.centroid.lat > startTract.centroid.lat || 
          (tract.centroid.lat === startTract.centroid.lat && tract.centroid.lng < startTract.centroid.lng)) {
        startTract = tract;
      }
    }

    // Build adjacency map
    const adjacencyMap = this.buildAdjacencyMap(tractsWithCentroids);
    
    // Use a path-finding algorithm that maintains contiguity
    const visited = new Set<string>();
    const result: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> = [];
    
    // Start with the top-north-west tract
    const startKey = `${startTract.centroid.lat},${startTract.centroid.lng}`;
    visited.add(startKey);
    result.push(startTract);
    
    // Build contiguous path by always choosing the next adjacent tract
    let currentTract = startTract;
    let attempts = 0;
    const maxAttempts = tractsWithCentroids.length * 2; // Prevent infinite loops
    const startTime = Date.now();
    const maxTime = 3000; // 3 second timeout for better responsiveness
    
    while (result.length < tractsWithCentroids.length && attempts < maxAttempts && (Date.now() - startTime) < maxTime) {
      attempts++;
      const currentKey = `${currentTract.centroid.lat},${currentTract.centroid.lng}`;
      const adjacent = adjacencyMap.get(currentKey) || [];
      
      // Find the best next tract (adjacent and not visited)
      const unvisitedAdjacent = adjacent.filter(tract => 
        !visited.has(`${tract.centroid.lat},${tract.centroid.lng}`)
      );
      
      if (unvisitedAdjacent.length > 0) {
        // Sort by direction preference and choose the best one
        const sortedAdjacent = this.sortAdjacentTracts(unvisitedAdjacent, currentTract, direction);
        const nextTract = sortedAdjacent[0];
        
        const nextKey = `${nextTract.centroid.lat},${nextTract.centroid.lng}`;
        visited.add(nextKey);
        result.push(nextTract);
        currentTract = nextTract;
      } else {
        // No adjacent unvisited tracts - need to find the closest unvisited tract
        const unvisitedTracts = tractsWithCentroids.filter(tract => 
          !visited.has(`${tract.centroid.lat},${tract.centroid.lng}`)
        );
        
        if (unvisitedTracts.length > 0) {
          // Find the closest unvisited tract to any tract in our current path
          let closestTract = unvisitedTracts[0];
          let minDistance = Infinity;
          
          for (const unvisited of unvisitedTracts) {
            for (const visitedTract of result) {
              const distance = Math.sqrt(
                Math.pow(unvisited.centroid.lat - visitedTract.centroid.lat, 2) +
                Math.pow(unvisited.centroid.lng - visitedTract.centroid.lng, 2)
              );
              
              if (distance < minDistance) {
                minDistance = distance;
                closestTract = unvisited;
              }
            }
          }
          
          // Add the closest tract (this breaks contiguity but ensures we get all tracts)
          const closestKey = `${closestTract.centroid.lat},${closestTract.centroid.lng}`;
          visited.add(closestKey);
          result.push(closestTract);
          currentTract = closestTract;
          
          console.warn(`Warning: Added non-adjacent tract ${closestTract.tract.properties?.TRACT || 'unknown'} to maintain completeness`);
        } else {
          break; // All tracts visited
        }
      }
    }
    
    // If we didn't visit all tracts, there might be disconnected components
    // In that case, we need to handle them separately
    if (result.length < tractsWithCentroids.length) {
      console.warn(`Warning: Found ${tractsWithCentroids.length - result.length} disconnected tracts`);
      
      // If we have too many disconnected tracts, fall back to simple geographic sorting
      const disconnectedCount = tractsWithCentroids.length - result.length;
      if (disconnectedCount > tractsWithCentroids.length * 0.5) {
        console.warn('Too many disconnected tracts, falling back to simple geographic sorting');
        return this.fallbackGeographicSort(tractsWithCentroids, direction);
      }
      
      // Add remaining tracts in geographic order
      const remaining = tractsWithCentroids.filter(t => 
        !visited.has(`${t.centroid.lat},${t.centroid.lng}`)
      );
      result.push(...remaining);
    }
    
    // Check if we timed out or hit max attempts
    if (attempts >= maxAttempts) {
      console.warn('Path finding hit max attempts, falling back to geographic sorting');
      return this.fallbackGeographicSort(tractsWithCentroids, direction);
    }
    
    if ((Date.now() - startTime) >= maxTime) {
      console.warn('Path finding timed out, falling back to geographic sorting');
      return this.fallbackGeographicSort(tractsWithCentroids, direction);
    }
    
    return result;
  }

  /**
   * Fallback to simple geographic sorting when boundary-based approach fails
   * @param tractsWithCentroids Array of tracts with their centroids
   * @param direction Division direction
   * @returns Sorted array of tracts
   */
  private fallbackGeographicSort(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    direction: 'latitude' | 'longitude'
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    console.log('Using fallback geographic sorting');
    
    if (direction === 'latitude') {
      // Sort by latitude first, then longitude for tie-breaking
      return tractsWithCentroids.sort((a, b) => {
        if (Math.abs(a.centroid.lat - b.centroid.lat) < 0.001) {
          return a.centroid.lng - b.centroid.lng; // West to east
        }
        return b.centroid.lat - a.centroid.lat; // North to south
      });
    } else {
      // Sort by longitude first, then latitude for tie-breaking
      return tractsWithCentroids.sort((a, b) => {
        if (Math.abs(a.centroid.lng - b.centroid.lng) < 0.001) {
          return b.centroid.lat - a.centroid.lat; // North to south
        }
        return a.centroid.lng - b.centroid.lng; // West to east
      });
    }
  }

  /**
   * Build adjacency map based on boundary intersection (optimized)
   * @param tractsWithCentroids Array of tracts with their centroids
   * @returns Map of tract keys to their adjacent tracts
   */
  private buildAdjacencyMap(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>
  ): Map<string, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>> {
    const adjacencyMap = new Map<string, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>>();
    
    // Initialize map
    tractsWithCentroids.forEach(tract => {
      const key = `${tract.centroid.lat},${tract.centroid.lng}`;
      adjacencyMap.set(key, []);
    });
    
    // For large datasets, use spatial indexing to reduce complexity
    if (tractsWithCentroids.length > 100) {
      console.log(`Building adjacency map for ${tractsWithCentroids.length} tracts using spatial optimization...`);
      return this.buildAdjacencyMapOptimized(tractsWithCentroids);
    }
    
    // For smaller datasets, use the full O(n²) approach
    console.log(`Building adjacency map for ${tractsWithCentroids.length} tracts...`);
    for (let i = 0; i < tractsWithCentroids.length; i++) {
      for (let j = i + 1; j < tractsWithCentroids.length; j++) {
        const tract1 = tractsWithCentroids[i];
        const tract2 = tractsWithCentroids[j];
        
        if (this.areTractsAdjacent(tract1.tract, tract2.tract)) {
          const key1 = `${tract1.centroid.lat},${tract1.centroid.lng}`;
          const key2 = `${tract2.centroid.lat},${tract2.centroid.lng}`;
          
          adjacencyMap.get(key1)!.push(tract2);
          adjacencyMap.get(key2)!.push(tract1);
        }
      }
    }
    
    return adjacencyMap;
  }

  /**
   * Optimized adjacency map building using spatial indexing
   * @param tractsWithCentroids Array of tracts with their centroids
   * @returns Map of tract keys to their adjacent tracts
   */
  private buildAdjacencyMapOptimized(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>
  ): Map<string, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>> {
    const adjacencyMap = new Map<string, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>>();
    
    // Initialize map
    tractsWithCentroids.forEach(tract => {
      const key = `${tract.centroid.lat},${tract.centroid.lng}`;
      adjacencyMap.set(key, []);
    });
    
    // Create spatial grid for faster neighbor lookup
    const gridSize = 0.1; // 0.1 degree grid cells
    const spatialGrid = new Map<string, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>>();
    
    // Populate spatial grid
    tractsWithCentroids.forEach(tract => {
      const gridKey = `${Math.floor(tract.centroid.lat / gridSize)},${Math.floor(tract.centroid.lng / gridSize)}`;
      if (!spatialGrid.has(gridKey)) {
        spatialGrid.set(gridKey, []);
      }
      spatialGrid.get(gridKey)!.push(tract);
    });
    
    // Check adjacency only for tracts in nearby grid cells
    tractsWithCentroids.forEach(tract => {
      const key = `${tract.centroid.lat},${tract.centroid.lng}`;
      const gridLat = Math.floor(tract.centroid.lat / gridSize);
      const gridLng = Math.floor(tract.centroid.lng / gridSize);
      
      // Check current cell and 8 surrounding cells
      for (let latOffset = -1; latOffset <= 1; latOffset++) {
        for (let lngOffset = -1; lngOffset <= 1; lngOffset++) {
          const neighborGridKey = `${gridLat + latOffset},${gridLng + lngOffset}`;
          const neighborTracts = spatialGrid.get(neighborGridKey) || [];
          
          neighborTracts.forEach(neighborTract => {
            if (neighborTract !== tract && this.areTractsAdjacent(tract.tract, neighborTract.tract)) {
              adjacencyMap.get(key)!.push(neighborTract);
            }
          });
        }
      }
    });
    
    return adjacencyMap;
  }

  /**
   * Check if two tracts are adjacent by examining their boundaries
   * @param tract1 First tract
   * @param tract2 Second tract
   * @returns True if tracts share a boundary
   */
  private areTractsAdjacent(tract1: GeoJsonFeature, tract2: GeoJsonFeature): boolean {
    try {
      // Extract coordinates from both tracts
      const coords1 = this.extractAllCoordinates(tract1.geometry);
      const coords2 = this.extractAllCoordinates(tract2.geometry);
      
      // Check if any coordinate from tract1 is very close to any coordinate from tract2
      // This is a simplified adjacency check - in production, you'd want more sophisticated boundary analysis
      const tolerance = 0.0001; // Approximately 10 meters
      
      for (const coord1 of coords1) {
        for (const coord2 of coords2) {
          const distance = Math.sqrt(
            Math.pow(coord1[0] - coord2[0], 2) + 
            Math.pow(coord1[1] - coord2[1], 2)
          );
          
          if (distance < tolerance) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Error checking tract adjacency:', error);
      // Fallback to centroid-based proximity
      const centroid1 = this.calculateTractCentroid(tract1);
      const centroid2 = this.calculateTractCentroid(tract2);
      const distance = Math.sqrt(
        Math.pow(centroid1.lat - centroid2.lat, 2) + 
        Math.pow(centroid1.lng - centroid2.lng, 2)
      );
      return distance < 0.01; // 1km tolerance for fallback
    }
  }

  /**
   * Sort adjacent tracts by direction preference
   * @param adjacent Array of adjacent tracts
   * @param current Current tract
   * @param direction Division direction
   * @returns Sorted array of adjacent tracts
   */
  private sortAdjacentTracts(
    adjacent: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    current: { tract: GeoJsonFeature, centroid: { lat: number, lng: number } },
    direction: 'latitude' | 'longitude'
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    return adjacent.sort((a, b) => {
      if (direction === 'latitude') {
        // For latitude division, prefer moving east-west, then south
        const aEastWest = Math.abs(a.centroid.lng - current.centroid.lng);
        const bEastWest = Math.abs(b.centroid.lng - current.centroid.lng);
        const aSouth = a.centroid.lat - current.centroid.lat;
        const bSouth = b.centroid.lat - current.centroid.lat;
        
        // Prefer east-west movement, then south
        if (aEastWest > 0 && bEastWest === 0) return -1;
        if (aEastWest === 0 && bEastWest > 0) return 1;
        if (aEastWest > 0 && bEastWest > 0) return aEastWest - bEastWest;
        return aSouth - bSouth;
      } else {
        // For longitude division, prefer moving north-south, then east
        const aNorthSouth = Math.abs(a.centroid.lat - current.centroid.lat);
        const bNorthSouth = Math.abs(b.centroid.lat - current.centroid.lat);
        const aEast = a.centroid.lng - current.centroid.lng;
        const bEast = b.centroid.lng - current.centroid.lng;
        
        // Prefer north-south movement, then east
        if (aNorthSouth > 0 && bNorthSouth === 0) return -1;
        if (aNorthSouth === 0 && bNorthSouth > 0) return 1;
        if (aNorthSouth > 0 && bNorthSouth > 0) return aNorthSouth - bNorthSouth;
        return aEast - bEast;
      }
    });
  }

  /**
   * Zig-zag sort by latitude (north/south division)
   * Start at top-north-west, zig-zag east-west while moving south
   * Creates a true contiguous path through all tracts
   */
  private zigZagSortByLatitude(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    bandWidth: number
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    if (tractsWithCentroids.length === 0) return [];
    
    // Group tracts into latitude bands
    const bands = new Map<number, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>>();
    
    tractsWithCentroids.forEach(tract => {
      const bandKey = Math.floor(tract.centroid.lat / bandWidth);
      if (!bands.has(bandKey)) {
        bands.set(bandKey, []);
      }
      bands.get(bandKey)!.push(tract);
    });

    // Sort bands from north to south (highest to lowest latitude)
    const sortedBandKeys = Array.from(bands.keys()).sort((a, b) => b - a);
    
    const result: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> = [];
    let lastTract: { tract: GeoJsonFeature, centroid: { lat: number, lng: number } } | null = null;
    
    sortedBandKeys.forEach((bandKey, bandIndex) => {
      const bandTracts = bands.get(bandKey)!;
      
      // Sort tracts within band by longitude
      bandTracts.sort((a, b) => a.centroid.lng - b.centroid.lng);
      
      // Alternate direction: odd bands go west to east, even bands go east to west
      if (bandIndex % 2 === 1) {
        bandTracts.reverse(); // Reverse to go east to west
      }
      
      // For true contiguity, we need to connect bands properly
      if (lastTract && bandTracts.length > 0) {
        // Find the tract in this band that's closest to the last tract from previous band
        let closestIndex = 0;
        let minDistance = Infinity;
        
        bandTracts.forEach((tract, index) => {
          const distance = Math.sqrt(
            Math.pow(tract.centroid.lat - lastTract!.centroid.lat, 2) +
            Math.pow(tract.centroid.lng - lastTract!.centroid.lng, 2)
          );
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = index;
          }
        });
        
        // Reorder the band to start with the closest tract
        if (closestIndex > 0) {
          const reorderedBand = [
            ...bandTracts.slice(closestIndex),
            ...bandTracts.slice(0, closestIndex)
          ];
          
          // If we reversed the band, we need to reverse the reordered band too
          if (bandIndex % 2 === 1) {
            reorderedBand.reverse();
          }
          
          result.push(...reorderedBand);
          lastTract = reorderedBand[reorderedBand.length - 1];
        } else {
          result.push(...bandTracts);
          lastTract = bandTracts[bandTracts.length - 1];
        }
      } else {
        result.push(...bandTracts);
        if (bandTracts.length > 0) {
          lastTract = bandTracts[bandTracts.length - 1];
        }
      }
    });
    
    return result;
  }

  /**
   * Zig-zag sort by longitude (east/west division)
   * Start at top-north-west, zig-zag north-south while moving east
   * Creates a true contiguous path through all tracts
   */
  private zigZagSortByLongitude(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    bandWidth: number
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    if (tractsWithCentroids.length === 0) return [];
    
    // Group tracts into longitude bands
    const bands = new Map<number, Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>>();
    
    tractsWithCentroids.forEach(tract => {
      const bandKey = Math.floor(tract.centroid.lng / bandWidth);
      if (!bands.has(bandKey)) {
        bands.set(bandKey, []);
      }
      bands.get(bandKey)!.push(tract);
    });

    // Sort bands from west to east (lowest to highest longitude)
    const sortedBandKeys = Array.from(bands.keys()).sort((a, b) => a - b);
    
    const result: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> = [];
    let lastTract: { tract: GeoJsonFeature, centroid: { lat: number, lng: number } } | null = null;
    
    sortedBandKeys.forEach((bandKey, bandIndex) => {
      const bandTracts = bands.get(bandKey)!;
      
      // Sort tracts within band by latitude (north to south)
      bandTracts.sort((a, b) => b.centroid.lat - a.centroid.lat);
      
      // Alternate direction: odd bands go north to south, even bands go south to north
      if (bandIndex % 2 === 1) {
        bandTracts.reverse(); // Reverse to go south to north
      }
      
      // For true contiguity, we need to connect bands properly
      if (lastTract && bandTracts.length > 0) {
        // Find the tract in this band that's closest to the last tract from previous band
        let closestIndex = 0;
        let minDistance = Infinity;
        
        bandTracts.forEach((tract, index) => {
          const distance = Math.sqrt(
            Math.pow(tract.centroid.lat - lastTract!.centroid.lat, 2) +
            Math.pow(tract.centroid.lng - lastTract!.centroid.lng, 2)
          );
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = index;
          }
        });
        
        // Reorder the band to start with the closest tract
        if (closestIndex > 0) {
          const reorderedBand = [
            ...bandTracts.slice(closestIndex),
            ...bandTracts.slice(0, closestIndex)
          ];
          
          // If we reversed the band, we need to reverse the reordered band too
          if (bandIndex % 2 === 1) {
            reorderedBand.reverse();
          }
          
          result.push(...reorderedBand);
          lastTract = reorderedBand[reorderedBand.length - 1];
        } else {
          result.push(...bandTracts);
          lastTract = bandTracts[bandTracts.length - 1];
        }
      } else {
        result.push(...bandTracts);
        if (bandTracts.length > 0) {
          lastTract = bandTracts[bandTracts.length - 1];
        }
      }
    });
    
    return result;
  }

  /**
   * Divide census tracts by latitude, longitude, or population according to a given ratio
   * 
   * This function takes a list of census tracts and divides them into two groups
   * based on their geographic coordinates (latitude or longitude) or population
   * according to a specified ratio. For geographic divisions, tracts are sorted by
   * their centroid coordinates. For population divisions, tracts are assigned to
   * groups to achieve the target population ratio as closely as possible.
   * 
   * @param tracts Array of GeoJSON features representing census tracts
   * @param options Division options including ratio and direction
   * @param options.ratio Array of two numbers representing the split ratio (default: [50, 50])
   * @param options.direction Either 'latitude' for north/south, 'longitude' for east/west, or 'population' for population-based division (default: 'latitude')
   * @returns Division result with tracts split into groups, population statistics, and division information
   * 
   * @example
   * // Divide tracts 60/40 by latitude (60% north, 40% south)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [40, 60],
   *   direction: 'latitude'
   * });
   * console.log(`North tracts: ${result.northTracts.length}, South tracts: ${result.southTracts.length}`);
   * 
   * @example
   * // Divide tracts 50/50 by longitude (50% east, 50% west)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [50, 50],
   *   direction: 'longitude'
   * });
   * console.log(`East tracts: ${result.eastTracts.length}, West tracts: ${result.westTracts.length}`);
   * 
   * @example
   * // Divide tracts 50/50 by population (50% of population in each group, maintaining geographic contiguity)
   * const result = censusService.divideTractsByCoordinate(tracts, {
   *   ratio: [50, 50],
   *   direction: 'population'
   * });
   * console.log(`North region: ${result.northPopulation.toLocaleString()} people, South region: ${result.southPopulation.toLocaleString()} people`);
   */
  divideTractsByCoordinate(tracts: GeoJsonFeature[], options: TractDivisionOptions = {}): TractDivisionResult {
    const { ratio = [50, 50], direction = 'latitude' } = options;

    if (tracts.length === 0) {
      return {
        northTracts: [],
        southTracts: [],
        eastTracts: [],
        westTracts: [],
        divisionLine: 0,
        divisionType: direction,
        totalPopulation: 0,
        northPopulation: 0,
        southPopulation: 0,
        eastPopulation: 0,
        westPopulation: 0
      };
    }

    if (direction === 'population') {
      return this.divideTractsByPopulation(tracts, ratio);
    }

    // Calculate centroids for all tracts
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract)
    }));

    // Sort tracts using zig-zag pattern to ensure geographic contiguity
    const sortedTracts = this.zigZagSortTracts(tractsWithCentroids, direction);

    // Calculate division point based on population ratio
    const totalPopulation = this.calculateTotalPopulation(tracts);
    const targetFirstGroupPopulation = (totalPopulation * ratio[0]) / (ratio[0] + ratio[1]);
    
    // Find the division index where cumulative population is closest to target
    let cumulativePopulation = 0;
    let divisionIndex = 0;
    let bestDifference = Infinity;
    
    for (let i = 0; i < sortedTracts.length; i++) {
      cumulativePopulation += this.getTractPopulation(sortedTracts[i].tract);
      const difference = Math.abs(cumulativePopulation - targetFirstGroupPopulation);
      
      if (difference < bestDifference) {
        bestDifference = difference;
        divisionIndex = i + 1; // Split after this tract
      }
    }

    // Find the division line coordinate
    const divisionLine = direction === 'latitude'
      ? sortedTracts[Math.max(0, divisionIndex - 1)].centroid.lat
      : sortedTracts[Math.max(0, divisionIndex - 1)].centroid.lng;

    // Split tracts into groups
    const firstGroup = sortedTracts.slice(0, divisionIndex).map(item => item.tract);
    const secondGroup = sortedTracts.slice(divisionIndex).map(item => item.tract);

    // Calculate population totals
    const firstGroupPopulation = this.calculateTotalPopulation(firstGroup);
    const secondGroupPopulation = this.calculateTotalPopulation(secondGroup);

    // Return result based on direction
    if (direction === 'latitude') {
      return {
        northTracts: secondGroup, // Higher latitude values
        southTracts: firstGroup,  // Lower latitude values
        eastTracts: [],
        westTracts: [],
        divisionLine,
        divisionType: direction,
        totalPopulation,
        northPopulation: secondGroupPopulation,
        southPopulation: firstGroupPopulation,
        eastPopulation: 0,
        westPopulation: 0
      };
    } else {
      return {
        northTracts: [],
        southTracts: [],
        eastTracts: secondGroup,  // Higher longitude values
        westTracts: firstGroup,   // Lower longitude values
        divisionLine,
        divisionType: direction,
        totalPopulation,
        northPopulation: 0,
        southPopulation: 0,
        eastPopulation: secondGroupPopulation,
        westPopulation: firstGroupPopulation
      };
    }
  }

  /**
   * Divide tracts by population with geographic contiguity
   * 
   * This method creates contiguous geographic regions while balancing population:
   * 1. First divides tracts geographically by latitude (north/south)
   * 2. Then iteratively moves tracts across the boundary to achieve the target population ratio
   * 3. Maintains geographic contiguity by only moving tracts at the boundary between regions
   * 
   * @param tracts Array of GeoJSON features representing census tracts
   * @param ratio Array of two numbers representing the population split ratio
   * @returns Division result with tracts split by population while maintaining geographic contiguity
   */
  private divideTractsByPopulation(tracts: GeoJsonFeature[], ratio: [number, number]): TractDivisionResult {
    // Calculate total population
    const totalPopulation = this.calculateTotalPopulation(tracts);

    // Calculate target population for each group
    const targetFirstGroupPopulation = (totalPopulation * ratio[0]) / (ratio[0] + ratio[1]);
    const targetSecondGroupPopulation = totalPopulation - targetFirstGroupPopulation;

    // First, divide tracts geographically by latitude to create contiguous regions
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract),
      population: this.getTractPopulation(tract)
    }));

    // Sort tracts by latitude (north to south)
    const sortedByLatitude = tractsWithCentroids.sort((a, b) => b.centroid.lat - a.centroid.lat);

    // Find the geographic division point that creates two roughly equal geographic regions
    const totalTracts = sortedByLatitude.length;
    const geographicDivisionPoint = Math.floor(totalTracts / 2);

    // Create initial geographic regions
    const northTracts = sortedByLatitude.slice(0, geographicDivisionPoint);
    const southTracts = sortedByLatitude.slice(geographicDivisionPoint);

    // Calculate current population in each geographic region
    let northPopulation = northTracts.reduce((sum, item) => sum + item.population, 0);
    let southPopulation = southTracts.reduce((sum, item) => sum + item.population, 0);

    // Now balance population between regions by moving tracts across the boundary
    // We'll move tracts from the overpopulated region to the underpopulated region
    const maxIterations = Math.min(50, totalTracts); // Prevent infinite loops
    let iterations = 0;

    while (iterations < maxIterations) {
      const northError = Math.abs(northPopulation - targetSecondGroupPopulation);
      const southError = Math.abs(southPopulation - targetFirstGroupPopulation);

      // If we're close enough to the target, stop
      if (northError < totalPopulation * 0.01 && southError < totalPopulation * 0.01) {
        break;
      }

      // Determine which region needs more population
      const northNeedsMore = northPopulation < targetSecondGroupPopulation;
      const southNeedsMore = southPopulation < targetFirstGroupPopulation;

      if (northNeedsMore && southTracts.length > 0) {
        // Move a tract from south to north
        // Find the northernmost tract in the south region (closest to the boundary)
        const tractToMove = southTracts.shift()!; // Take from the beginning (northernmost in south)
        northTracts.push(tractToMove); // Add to the end (southernmost in north)
        northPopulation += tractToMove.population;
        southPopulation -= tractToMove.population;
      } else if (southNeedsMore && northTracts.length > 0) {
        // Move a tract from north to south
        // Find the southernmost tract in the north region (closest to the boundary)
        const tractToMove = northTracts.pop()!; // Take from the end (southernmost in north)
        southTracts.unshift(tractToMove); // Add to the beginning (northernmost in south)
        southPopulation += tractToMove.population;
        northPopulation -= tractToMove.population;
      } else {
        // No more tracts to move or we're close enough
        break;
      }

      iterations++;
    }

    // Sort the final regions by latitude to maintain geographic order
    northTracts.sort((a, b) => b.centroid.lat - a.centroid.lat);
    southTracts.sort((a, b) => b.centroid.lat - a.centroid.lat);

    // Calculate the actual population ratio achieved
    const actualRatio = southPopulation / (northPopulation + southPopulation);

    // Find the division line (latitude of the boundary between regions)
    const divisionLine = southTracts.length > 0 && northTracts.length > 0
      ? (northTracts[northTracts.length - 1].centroid.lat + southTracts[0].centroid.lat) / 2
      : 0;

    return {
      northTracts: northTracts.map(item => item.tract), // Higher latitude region
      southTracts: southTracts.map(item => item.tract), // Lower latitude region
      eastTracts: [],
      westTracts: [],
      divisionLine,
      divisionType: 'population',
      totalPopulation,
      northPopulation,
      southPopulation,
      eastPopulation: 0,
      westPopulation: 0
    };
  }

  /**
   * Calculate the total population of a list of tracts
   * @param tracts Array of GeoJSON features
   * @returns Total population
   */
  private calculateTotalPopulation(tracts: GeoJsonFeature[]): number {
    return tracts.reduce((total, tract) => total + this.getTractPopulation(tract), 0);
  }

  /**
   * Get the population of a single tract
   * @param tract GeoJSON feature representing a census tract
   * @returns Population count
   */
  private getTractPopulation(tract: GeoJsonFeature): number {
    return tract.properties?.POPULATION || 0;
  }

  /**
   * Calculate the centroid (center point) of a census tract from its GeoJSON geometry
   * @param tract GeoJSON feature representing a census tract
   * @returns Object with lat and lng coordinates
   */
  private calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    const coordinates = this.extractAllCoordinates(tract.geometry);

    if (coordinates.length === 0) {
      return { lat: 0, lng: 0 };
    }

    // Calculate the centroid using the arithmetic mean of all coordinates
    let totalLat = 0;
    let totalLng = 0;

    coordinates.forEach(coord => {
      totalLng += coord[0]; // longitude
      totalLat += coord[1]; // latitude
    });

    return {
      lat: totalLat / coordinates.length,
      lng: totalLng / coordinates.length
    };
  }

  /**
   * Extract all coordinate pairs from a GeoJSON geometry
   * @param geometry GeoJSON geometry object
   * @returns Array of coordinate pairs [lng, lat]
   */
  private extractAllCoordinates(geometry: any): number[][] {
    const coordinates: number[][] = [];

    if (!geometry || !geometry.coordinates) {
      return coordinates;
    }

    const extractFromArray = (coordArray: any): void => {
      if (Array.isArray(coordArray)) {
        if (coordArray.length === 2 && typeof coordArray[0] === 'number' && typeof coordArray[1] === 'number') {
          // This is a coordinate pair [lng, lat]
          coordinates.push([coordArray[0], coordArray[1]]);
        } else {
          // This is an array of coordinates or nested arrays
          coordArray.forEach(extractFromArray);
        }
      }
    };

    if (geometry.type === 'Polygon') {
      // Polygon coordinates are an array of linear rings
      geometry.coordinates.forEach((ring: any) => {
        extractFromArray(ring);
      });
    } else if (geometry.type === 'MultiPolygon') {
      // MultiPolygon coordinates are an array of polygons
      geometry.coordinates.forEach((polygon: any) => {
        polygon.forEach((ring: any) => {
          extractFromArray(ring);
        });
      });
    } else {
      // For other geometry types, try to extract coordinates
      extractFromArray(geometry.coordinates);
    }

    return coordinates;
  }

  /**
   * Convenience method to divide tracts by coordinate with automatic data loading
   * @param state State FIPS code
   * @param county Optional county FIPS code
   * @param options Division options
   * @param forceInvalidate Whether to force invalidate cache
   * @returns Observable with division result
   */
  divideTractsByCoordinateWithData(state: string, county?: string, options: TractDivisionOptions = {}, forceInvalidate: boolean = false): Observable<TractDivisionResult> {
    return this.getTractBoundaries(state, county, forceInvalidate).pipe(
      map(geojsonData => {
        if (!geojsonData || !geojsonData.features) {
          return {
            northTracts: [],
            southTracts: [],
            eastTracts: [],
            westTracts: [],
            divisionLine: 0,
            divisionType: options.direction || 'latitude',
            totalPopulation: 0,
            northPopulation: 0,
            southPopulation: 0,
            eastPopulation: 0,
            westPopulation: 0
          };
        }

        return this.divideTractsByCoordinate(geojsonData.features, options);
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Recursively divide census tracts into a specified number of districts
   * Alternates between latitude and longitude divisions while maintaining population balance
   * @param tracts Array of GeoJSON features representing census tracts
   * @param options Division options including target number of districts
   * @returns Result with array of districts and statistics
   */
  divideTractsIntoDistricts(tracts: GeoJsonFeature[], options: RecursiveDivisionOptions): RecursiveDivisionResult {
    const { targetDistricts, maxIterations = 100, populationTolerance = 0.01, preserveCountyBoundaries = true } = options;

    if (tracts.length === 0 || targetDistricts <= 0) {
      return {
        districts: [],
        totalPopulation: 0,
        averagePopulation: 0,
        populationVariance: 0,
        divisionHistory: [],
        divisionSteps: []
      };
    }

    if (targetDistricts === 1) {
      // Single district - return all tracts as one district
      const district = this.createDistrict(1, tracts);
      const initialStep = this.createDivisionStep(0, 0, [{
        id: 1,
        tracts: tracts,
        targetDistricts: 1,
        direction: 'latitude' as 'latitude' | 'longitude',
        bounds: district.bounds,
        centroid: district.centroid,
        population: district.population
      }], 'Single district created');
      
      return {
        districts: [district],
        totalPopulation: district.population,
        averagePopulation: district.population,
        populationVariance: 0,
        divisionHistory: ['Single district created'],
        divisionSteps: [initialStep]
      };
    }

    console.log(`Starting recursive division: ${tracts.length} tracts → ${targetDistricts} districts`);

    let result: { districts: District[], divisionHistory: string[], divisionSteps: DivisionStep[] };

    if (preserveCountyBoundaries) {
      console.log('Using county-aware division to preserve county boundaries');
      result = this.divideTractsIntoDistrictsWithCountyPreservation(tracts, targetDistricts, maxIterations, populationTolerance);
    } else {
      console.log('Using standard geographic division');
      // Start with all tracts as a single group
      const initialGroup = {
        tracts: tracts,
        targetDistricts: targetDistricts,
        level: 0,
        direction: 'latitude' as 'latitude' | 'longitude'
      };

      result = this.recursiveDivideGroupsWithSteps([initialGroup], 0, maxIterations, populationTolerance);
    }
    
    // Calculate final statistics
    const totalPopulation = result.districts.reduce((sum, district) => sum + district.population, 0);
    const averagePopulation = totalPopulation / result.districts.length;
    const populationVariance = result.districts.reduce((sum, district) =>
      sum + Math.pow(district.population - averagePopulation, 2), 0) / result.districts.length;

    return {
      districts: result.districts,
      totalPopulation,
      averagePopulation,
      populationVariance,
      divisionHistory: result.divisionHistory,
      divisionSteps: result.divisionSteps
    };
  }

  /**
   * Divide tracts into districts while preserving county boundaries
   * Groups tracts by county first, then consumes entire counties when possible
   * @param tracts Array of GeoJSON features representing census tracts
   * @param targetDistricts Target number of districts
   * @param maxIterations Maximum iterations to prevent infinite loops
   * @param populationTolerance Population balance tolerance
   * @returns Result with districts, division history, and division steps
   */
  private divideTractsIntoDistrictsWithCountyPreservation(
    tracts: GeoJsonFeature[],
    targetDistricts: number,
    maxIterations: number,
    populationTolerance: number
  ): { districts: District[], divisionHistory: string[], divisionSteps: DivisionStep[] } {
    
    // Group tracts by county
    const countyGroups = this.groupTractsByCounty(tracts);
    console.log(`Grouped ${tracts.length} tracts into ${countyGroups.length} counties`);
    
    // Calculate target population per district
    const totalPopulation = countyGroups.reduce((sum, county) => sum + county.population, 0);
    const targetPopulationPerDistrict = totalPopulation / targetDistricts;
    
    console.log(`Target population per district: ${targetPopulationPerDistrict.toLocaleString()}`);
    
    // Sort counties by population (largest first) to optimize assignment
    const sortedCounties = countyGroups.sort((a, b) => b.population - a.population);
    
    // Create districts by assigning counties
    const districts: District[] = [];
    const divisionHistory: string[] = [];
    const divisionSteps: DivisionStep[] = [];
    
    // Initialize districts
    for (let i = 0; i < targetDistricts; i++) {
      districts.push({
        id: i + 1,
        tracts: [],
        population: 0,
        bounds: { north: -90, south: 90, east: -180, west: 180 },
        centroid: { lat: 0, lng: 0 }
      });
    }
    
    // Assign counties to districts
    const countyAssignments: Array<{ county: CountyGroup, districtId: number }> = [];
    
    for (const county of sortedCounties) {
      // Check if county population is greater than or equal to target district size
      if (county.population >= targetPopulationPerDistrict) {
        // County is large enough to be its own district
        // Find an empty district or the district with smallest population
        let bestDistrict = districts[0];
        let bestDistrictIndex = 0;
        let smallestPopulation = districts[0].population;
        
        for (let i = 0; i < districts.length; i++) {
          if (districts[i].population === 0) {
            // Prefer empty districts
            bestDistrict = districts[i];
            bestDistrictIndex = i;
            break;
          } else if (districts[i].population < smallestPopulation) {
            smallestPopulation = districts[i].population;
            bestDistrict = districts[i];
            bestDistrictIndex = i;
          }
        }
        
        // Assign entire county to this district
        countyAssignments.push({ county, districtId: bestDistrictIndex + 1 });
        
        // Update district with entire county
        bestDistrict.tracts.push(...county.tracts);
        bestDistrict.population += county.population;
        
        // Update bounds
        bestDistrict.bounds.north = Math.max(bestDistrict.bounds.north, county.bounds.north);
        bestDistrict.bounds.south = Math.min(bestDistrict.bounds.south, county.bounds.south);
        bestDistrict.bounds.east = Math.max(bestDistrict.bounds.east, county.bounds.east);
        bestDistrict.bounds.west = Math.min(bestDistrict.bounds.west, county.bounds.west);
        
        divisionHistory.push(`Created District ${bestDistrictIndex + 1} entirely from ${county.countyName} (${county.population.toLocaleString()} people) - county population ≥ target district size`);
      } else {
        // County is smaller than target district size - assign to district with smallest population
        let bestDistrict = districts[0];
        let bestDistrictIndex = 0;
        let smallestPopulation = districts[0].population;
        
        for (let i = 0; i < districts.length; i++) {
          if (districts[i].population < smallestPopulation) {
            smallestPopulation = districts[i].population;
            bestDistrict = districts[i];
            bestDistrictIndex = i;
          }
        }
        
        // Assign county to the best district
        countyAssignments.push({ county, districtId: bestDistrictIndex + 1 });
        
        // Update district
        bestDistrict.tracts.push(...county.tracts);
        bestDistrict.population += county.population;
        
        // Update bounds
        bestDistrict.bounds.north = Math.max(bestDistrict.bounds.north, county.bounds.north);
        bestDistrict.bounds.south = Math.min(bestDistrict.bounds.south, county.bounds.south);
        bestDistrict.bounds.east = Math.max(bestDistrict.bounds.east, county.bounds.east);
        bestDistrict.bounds.west = Math.min(bestDistrict.bounds.west, county.bounds.west);
        
        divisionHistory.push(`Assigned ${county.countyName} (${county.population.toLocaleString()} people) to District ${bestDistrictIndex + 1} - county population < target district size`);
      }
    }
    
    // Recalculate centroids for all districts
    districts.forEach(district => {
      if (district.tracts.length > 0) {
        const centroid = this.calculateDistrictCentroid(district.tracts);
        district.centroid = centroid;
      }
    });
    
    // Create division steps
    const step = this.createDivisionStepFromDistricts(districts, 0, 'County-based district assignment completed');
    divisionSteps.push(step);
    
    // Handle any remaining population imbalance by splitting large counties if necessary
    const balancedResult = this.balanceDistrictsBySplittingCounties(districts, targetPopulationPerDistrict, populationTolerance);
    
    return {
      districts: balancedResult.districts,
      divisionHistory: [...divisionHistory, ...balancedResult.divisionHistory],
      divisionSteps: [...divisionSteps, ...balancedResult.divisionSteps]
    };
  }

  /**
   * Group tracts by county
   * @param tracts Array of GeoJSON features representing census tracts
   * @returns Array of county groups
   */
  private groupTractsByCounty(tracts: GeoJsonFeature[]): CountyGroup[] {
    const countyMap = new Map<string, CountyGroup>();
    
    for (const tract of tracts) {
      const countyId = tract.properties?.COUNTY_FIPS || tract.properties?.COUNTY || 'unknown';
      const countyName = tract.properties?.NAME || `County ${countyId}`;
      
      if (!countyMap.has(countyId)) {
        countyMap.set(countyId, {
          countyId,
          countyName,
          tracts: [],
          population: 0,
          bounds: { north: -90, south: 90, east: -180, west: 180 },
          centroid: { lat: 0, lng: 0 }
        });
      }
      
      const county = countyMap.get(countyId)!;
      county.tracts.push(tract);
      county.population += this.getTractPopulation(tract);
    }
    
    // Calculate bounds and centroids for each county
    const counties = Array.from(countyMap.values());
    counties.forEach(county => {
      if (county.tracts.length > 0) {
        county.bounds = this.calculateCountyBounds(county.tracts);
        county.centroid = this.calculateDistrictCentroid(county.tracts);
      }
    });
    
    return counties;
  }

  /**
   * Calculate bounds for a group of tracts
   * @param tracts Array of tracts
   * @returns Bounds object
   */
  private calculateCountyBounds(tracts: GeoJsonFeature[]): { north: number; south: number; east: number; west: number } {
    let north = -90, south = 90, east = -180, west = 180;
    
    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    });
    
    return { north, south, east, west };
  }

  /**
   * Calculate centroid for a group of tracts
   * @param tracts Array of tracts
   * @returns Centroid coordinates
   */
  private calculateDistrictCentroid(tracts: GeoJsonFeature[]): { lat: number; lng: number } {
    if (tracts.length === 0) {
      return { lat: 0, lng: 0 };
    }
    
    let totalLat = 0, totalLng = 0;
    
    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
    });
    
    return {
      lat: totalLat / tracts.length,
      lng: totalLng / tracts.length
    };
  }

  /**
   * Balance districts by splitting counties if necessary
   * @param districts Array of districts
   * @param targetPopulationPerDistrict Target population per district
   * @param populationTolerance Population balance tolerance
   * @returns Balanced result
   */
  private balanceDistrictsBySplittingCounties(
    districts: District[],
    targetPopulationPerDistrict: number,
    populationTolerance: number
  ): { districts: District[], divisionHistory: string[], divisionSteps: DivisionStep[] } {
    
    const divisionHistory: string[] = [];
    const divisionSteps: DivisionStep[] = [];
    const tolerance = targetPopulationPerDistrict * populationTolerance;
    
    // Check if any districts are significantly over or under target
    let needsBalancing = false;
    for (const district of districts) {
      const deviation = Math.abs(district.population - targetPopulationPerDistrict);
      if (deviation > tolerance) {
        needsBalancing = true;
        break;
      }
    }
    
    if (!needsBalancing) {
      divisionHistory.push('Districts are within acceptable population balance');
      return { districts, divisionHistory, divisionSteps };
    }
    
    // Find the most overpopulated and underpopulated districts
    let mostOverpopulated = districts[0];
    let mostUnderpopulated = districts[0];
    let maxOverpopulation = 0;
    let maxUnderpopulation = 0;
    
    for (const district of districts) {
      const deviation = district.population - targetPopulationPerDistrict;
      if (deviation > maxOverpopulation) {
        maxOverpopulation = deviation;
        mostOverpopulated = district;
      }
      if (deviation < -maxUnderpopulation) {
        maxUnderpopulation = -deviation;
        mostUnderpopulated = district;
      }
    }
    
    // If the overpopulated district has counties that can be split, do so
    if (maxOverpopulation > tolerance && mostOverpopulated.tracts.length > 1) {
      divisionHistory.push(`Attempting to balance District ${mostOverpopulated.id} (${mostOverpopulated.population.toLocaleString()} people) with District ${mostUnderpopulated.id} (${mostUnderpopulated.population.toLocaleString()} people)`);
      
      // Group tracts by county within the overpopulated district
      const countyGroups = this.groupTractsByCounty(mostOverpopulated.tracts);
      
      // Find the smallest county that can help balance
      const sortedCounties = countyGroups.sort((a, b) => a.population - b.population);
      
      for (const county of sortedCounties) {
        if (county.population <= maxOverpopulation && county.population > 0) {
          // Move this entire county to the underpopulated district
          mostOverpopulated.tracts = mostOverpopulated.tracts.filter(tract => 
            !county.tracts.includes(tract)
          );
          mostUnderpopulated.tracts.push(...county.tracts);
          
          mostOverpopulated.population -= county.population;
          mostUnderpopulated.population += county.population;
          
          // Recalculate bounds and centroids
          mostOverpopulated.bounds = this.calculateCountyBounds(mostOverpopulated.tracts);
          mostUnderpopulated.bounds = this.calculateCountyBounds(mostUnderpopulated.tracts);
          mostOverpopulated.centroid = this.calculateDistrictCentroid(mostOverpopulated.tracts);
          mostUnderpopulated.centroid = this.calculateDistrictCentroid(mostUnderpopulated.tracts);
          
          divisionHistory.push(`Moved ${county.countyName} (${county.population.toLocaleString()} people) from District ${mostOverpopulated.id} to District ${mostUnderpopulated.id}`);
          break;
        }
      }
    }
    
    // Create final step
    const finalStep = this.createDivisionStepFromDistricts(districts, 1, 'County-based balancing completed');
    divisionSteps.push(finalStep);
    
    return { districts, divisionHistory, divisionSteps };
  }

  /**
   * Create a division step from districts
   * @param districts Array of districts
   * @param level Division level
   * @param description Step description
   * @returns Division step
   */
  private createDivisionStepFromDistricts(districts: District[], level: number, description: string): DivisionStep {
    const stepGroups = districts.map(district => ({
      id: district.id,
      tracts: district.tracts,
      targetDistricts: 1,
      direction: 'latitude' as 'latitude' | 'longitude',
      bounds: district.bounds,
      centroid: district.centroid,
      population: district.population
    }));

    return this.createDivisionStep(
      level,
      level,
      stepGroups,
      description
    );
  }

  /**
   * Recursively divide groups of tracts into districts with step tracking
   * @param groups Array of groups to divide
   * @param currentLevel Current recursion level
   * @param maxIterations Maximum iterations to prevent infinite loops
   * @param populationTolerance Population balance tolerance
   * @returns Result with districts, division history, and division steps
   */
  private recursiveDivideGroupsWithSteps(
    groups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }>,
    currentLevel: number,
    maxIterations: number,
    populationTolerance: number
  ): { districts: District[], divisionHistory: string[], divisionSteps: DivisionStep[] } {

    if (currentLevel >= maxIterations) {
      console.warn(`Max iterations reached (${maxIterations}). Stopping recursion.`);
      const districts = groups.map((group, index) => this.createDistrict(index + 1, group.tracts));
      const finalStep = this.createDivisionStepFromGroups(groups, currentLevel, `Max iterations reached at level ${currentLevel}`);
      return {
        districts,
        divisionHistory: [`Max iterations reached at level ${currentLevel}`],
        divisionSteps: [finalStep]
      };
    }

    const newGroups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }> = [];
    const divisionHistory: string[] = [];
    const divisionSteps: DivisionStep[] = [];
    let stepCounter = 0;

    // Create initial step
    const initialStep = this.createDivisionStepFromGroups(groups, currentLevel, `Starting division at level ${currentLevel}`);
    divisionSteps.push(initialStep);
    stepCounter++;

    for (const group of groups) {
      if (group.targetDistricts === 1) {
        // This group becomes a single district
        newGroups.push({
          tracts: group.tracts,
          targetDistricts: 1,
          level: group.level + 1,
          direction: group.direction === 'latitude' ? 'longitude' : 'latitude'
        });
        divisionHistory.push(`Level ${group.level}: Group with ${group.tracts.length} tracts → 1 district`);
        continue;
      }

      // Calculate how to divide this group
      const division = this.calculateOptimalDivision(group.targetDistricts);
      const direction = group.direction;

      // Perform the division
      const divisionResult = this.divideTractsByCoordinate(group.tracts, {
        ratio: division.ratio,
        direction: direction
      });

      // Create new groups for the divided tracts
      const firstGroupTracts = direction === 'latitude' ? divisionResult.southTracts : divisionResult.westTracts;
      const secondGroupTracts = direction === 'latitude' ? divisionResult.northTracts : divisionResult.eastTracts;

      newGroups.push({
        tracts: firstGroupTracts,
        targetDistricts: division.first,
        level: group.level + 1,
        direction: direction === 'latitude' ? 'longitude' : 'latitude'
      });

      newGroups.push({
        tracts: secondGroupTracts,
        targetDistricts: division.second,
        level: group.level + 1,
        direction: direction === 'latitude' ? 'longitude' : 'latitude'
      });

      divisionHistory.push(
        `Level ${group.level}: ${group.tracts.length} tracts → ${division.first} + ${division.second} districts (${direction})`
      );

      // Create step for this division
      const stepDescription = `Level ${group.level}: ${group.tracts.length} tracts → ${division.first} + ${division.second} districts (${direction})`;
      const step = this.createDivisionStepFromGroups(newGroups, currentLevel + 1, stepDescription);
      divisionSteps.push(step);
      stepCounter++;
    }

    // Check if we have reached the target number of districts
    const totalTargetDistricts = newGroups.reduce((sum, group) => sum + group.targetDistricts, 0);

    if (totalTargetDistricts === newGroups.length) {
      // All groups are single districts - we're done
      const districts = newGroups.map((group, index) => this.createDistrict(index + 1, group.tracts));
      const finalStep = this.createDivisionStepFromGroups(newGroups, currentLevel + 1, 'Final districts created');
      divisionSteps.push(finalStep);
      return { districts, divisionHistory, divisionSteps };
    }

    // Continue recursion
    const recursiveResult = this.recursiveDivideGroupsWithSteps(newGroups, currentLevel + 1, maxIterations, populationTolerance);
    return {
      districts: recursiveResult.districts,
      divisionHistory: [...divisionHistory, ...recursiveResult.divisionHistory],
      divisionSteps: [...divisionSteps, ...recursiveResult.divisionSteps]
    };
  }

  /**
   * Create a division step from groups
   */
  private createDivisionStepFromGroups(
    groups: Array<{ tracts: GeoJsonFeature[], targetDistricts: number, level: number, direction: 'latitude' | 'longitude' }>,
    level: number,
    description: string
  ): DivisionStep {
    const stepGroups = groups.map((group, index) => {
      const district = this.createDistrict(index + 1, group.tracts);
      return {
        id: index + 1,
        tracts: group.tracts,
        targetDistricts: group.targetDistricts,
        direction: group.direction,
        bounds: district.bounds,
        centroid: district.centroid,
        population: district.population
      };
    });

    return this.createDivisionStep(
      level,
      level,
      stepGroups,
      description
    );
  }

  /**
   * Create a division step
   */
  private createDivisionStep(
    step: number,
    level: number,
    groups: Array<{
      id: number;
      tracts: GeoJsonFeature[];
      targetDistricts: number;
      direction: 'latitude' | 'longitude';
      bounds: { north: number; south: number; east: number; west: number };
      centroid: { lat: number; lng: number };
      population: number;
    }>,
    description: string
  ): DivisionStep {
    const totalDistricts = groups.reduce((sum, group) => sum + group.targetDistricts, 0);
    
    return {
      step,
      level,
      groups,
      description,
      totalGroups: groups.length,
      totalDistricts
    };
  }

  /**
   * Calculate the optimal way to divide a number of districts
   * @param totalDistricts Total number of districts to divide
   * @returns Object with ratio and target counts for each group
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number], first: number, second: number } {
    if (totalDistricts <= 1) {
      return { ratio: [1, 0], first: 1, second: 0 };
    }

    // For even numbers, divide 50/50
    if (totalDistricts % 2 === 0) {
      const half = totalDistricts / 2;
      return { ratio: [50, 50], first: half, second: half };
    }

    // For odd numbers, divide as evenly as possible
    const first = (totalDistricts - 1) / 2;
    const second = ((totalDistricts - 1) / 2) + 1;
    const ratio: [number, number] = [Math.round((first / totalDistricts) * 100), Math.round((second / totalDistricts) * 100)];

    return { ratio, first, second };
  }





  /**
   * Check if a district is geographically contiguous
   * @param tracts Array of tracts in the district
   * @returns True if the district is contiguous
   */
  private isDistrictContiguous(tracts: GeoJsonFeature[]): boolean {
    if (tracts.length <= 1) return true;
    
    // Calculate centroids for all tracts
    const tractsWithCentroids = tracts.map(tract => ({
      tract,
      centroid: this.calculateTractCentroid(tract)
    }));
    
    // Find the tract with the northernmost, westernmost position (top-left)
    let startTract = tractsWithCentroids[0];
    for (const tract of tractsWithCentroids) {
      if (tract.centroid.lat > startTract.centroid.lat || 
          (tract.centroid.lat === startTract.centroid.lat && tract.centroid.lng < startTract.centroid.lng)) {
        startTract = tract;
      }
    }
    
    // Use a simple flood-fill approach to check contiguity
    const visited = new Set<string>();
    const queue = [startTract];
    const tractMap = new Map<string, typeof tractsWithCentroids[0]>();
    
    // Create a map for quick lookup
    tractsWithCentroids.forEach(tract => {
      const key = `${tract.centroid.lat},${tract.centroid.lng}`;
      tractMap.set(key, tract);
    });
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.centroid.lat},${current.centroid.lng}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      
      // Check all other tracts to see if they're adjacent
      for (const tract of tractsWithCentroids) {
        if (tract === current) continue;
        
        const distance = Math.sqrt(
          Math.pow(tract.centroid.lat - current.centroid.lat, 2) +
          Math.pow(tract.centroid.lng - current.centroid.lng, 2)
        );
        
        // Consider tracts adjacent if they're within a reasonable distance
        // This is a simplified check - in reality, we'd need to check actual boundaries
        if (distance < 0.5 && !visited.has(`${tract.centroid.lat},${tract.centroid.lng}`)) {
          queue.push(tract);
        }
      }
    }
    
    return visited.size === tracts.length;
  }

  /**
   * Create a district object from a list of tracts
   * @param id District ID
   * @param tracts Array of tracts in the district
   * @returns District object with calculated properties
   */
  private createDistrict(id: number, tracts: GeoJsonFeature[]): District {
    if (tracts.length === 0) {
      return {
        id,
        tracts: [],
        population: 0,
        bounds: { north: 0, south: 0, east: 0, west: 0 },
        centroid: { lat: 0, lng: 0 }
      };
    }

    const population = this.calculateTotalPopulation(tracts);

    // Calculate bounds and centroid
    let north = -90, south = 90, east = -180, west = 180;
    let totalLat = 0, totalLng = 0;
    let totalPoints = 0;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
      totalPoints++;

      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    });

    return {
      id,
      tracts,
      population,
      bounds: { north, south, east, west },
      centroid: {
        lat: totalLat / totalPoints,
        lng: totalLng / totalPoints
      }
    };
  }

  /**
   * Test method to verify county grouping functionality
   * @param state State FIPS code
   * @param forceInvalidate Whether to force invalidate cache
   * @returns Observable with county grouping test result
   */
  testCountyGrouping(state: string, forceInvalidate: boolean = false): Observable<{ counties: CountyGroup[], totalTracts: number, totalPopulation: number }> {
    return this.getTractBoundaries(state, undefined, forceInvalidate).pipe(
      map(geojsonData => {
        if (!geojsonData || !geojsonData.features) {
          return { counties: [], totalTracts: 0, totalPopulation: 0 };
        }

        const counties = this.groupTractsByCounty(geojsonData.features);
        const totalTracts = geojsonData.features.length;
        const totalPopulation = counties.reduce((sum, county) => sum + county.population, 0);

        console.log(`County Grouping Test Results for State ${state}:`);
        console.log(`- Total tracts: ${totalTracts}`);
        console.log(`- Total counties: ${counties.length}`);
        console.log(`- Total population: ${totalPopulation.toLocaleString()}`);
        console.log(`- Counties by population:`);
        counties.sort((a, b) => b.population - a.population).forEach((county, index) => {
          console.log(`  ${index + 1}. ${county.countyName}: ${county.population.toLocaleString()} people (${county.tracts.length} tracts)`);
        });

        return { counties, totalTracts, totalPopulation };
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Convenience method to divide tracts into districts with automatic data loading
   * @param state State FIPS code
   * @param county Optional county FIPS code
   * @param options Division options including target number of districts
   * @param forceInvalidate Whether to force invalidate cache
   * @returns Observable with recursive division result
   */
  divideTractsIntoDistrictsWithData(state: string, county: string | undefined, options: RecursiveDivisionOptions, forceInvalidate: boolean = false): Observable<RecursiveDivisionResult> {
    return this.getTractBoundaries(state, county, forceInvalidate).pipe(
      map(geojsonData => {
        if (!geojsonData || !geojsonData.features) {
          return {
            districts: [],
            totalPopulation: 0,
            averagePopulation: 0,
            populationVariance: 0,
            divisionHistory: ['No tract data available'],
            divisionSteps: []
          };
        }

        return this.divideTractsIntoDistricts(geojsonData.features, options);
      }),
      catchError(this.handleError)
    );
  }
}

