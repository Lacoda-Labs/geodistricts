import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { GeodistrictResult, AlgorithmType, ALGORITHM_VERSION, DistrictGroup, GeodistrictStep } from './geodistrict-algorithm.service';
import { GeoJsonFeature } from './census.service';
import { environment } from '../../environments/environment';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

/**
 * Cache key for storing geodistrict algorithm results
 */
interface CacheKey {
  state: string;
  algorithm: AlgorithmType;
  maxIterations: number;
}

/**
 * Firestore document structure for cached results
 */
interface CacheDocument {
  result: GeodistrictResult;
  state: string;
  algorithm: AlgorithmType;
  maxIterations: number;
  cachedAt: number;
  algorithmVersion: string; // Version of algorithm that generated this result
}

/**
 * Service for caching geodistrict algorithm results using backend API (which uses Firestore)
 * Cache has no TTL - persists until invalidated
 */
@Injectable({
  providedIn: 'root'
})
export class GeodistrictCacheService {
  // Use censusProxyUrl (base URL) since backend routes already include /api
  private readonly API_BASE = environment.censusProxyUrl || environment.apiUrl.replace('/api', '');
  private memoryCache: Map<string, { result: GeodistrictResult; version: string }> = new Map(); // In-memory fallback with version

  constructor(private http: HttpClient) {}

  /**
   * Get unique tract ID from a tract feature
   */
  private getTractId(tract: GeoJsonFeature): string | null {
    if (!tract || !tract.properties) return null;
    // Try multiple possible ID fields
    return tract.properties['GEOID'] || 
           tract.properties['GISJOIN'] || 
           tract.properties['TRACT_FIPS'] || 
           (tract.properties['STATE_FIPS'] && tract.properties['COUNTY_FIPS'] && tract.properties['TRACT_FIPS']
             ? `${tract.properties['STATE_FIPS']}${tract.properties['COUNTY_FIPS']}${tract.properties['TRACT_FIPS']}`
             : null) ||
           null;
  }

  /**
   * Normalize result on frontend: extract tract geometries and replace with IDs
   * This reduces payload size before sending to backend
   */
  private normalizeResultForCache(result: GeodistrictResult, state: string): { normalizedResult: any; tractMap: Array<[string, GeoJsonFeature]> } {
    const tractMap = new Map<string, GeoJsonFeature>();
    const tractIds = new Set<string>();

    // Collect all unique tracts
    const collectTracts = (groups: DistrictGroup[]) => {
      if (!groups) return;
      groups.forEach(group => {
        if (group.censusTracts && Array.isArray(group.censusTracts)) {
          group.censusTracts.forEach(tract => {
            const tractId = this.getTractId(tract);
            if (tractId && !tractIds.has(tractId)) {
              tractIds.add(tractId);
              tractMap.set(tractId, tract);
            }
          });
        }
      });
    };

    // Collect from finalDistricts
    if (result.finalDistricts) {
      collectTracts(result.finalDistricts);
    }

    // Collect from steps
    if (result.steps) {
      result.steps.forEach(step => {
        if (step.districtGroups) {
          collectTracts(step.districtGroups);
        }
      });
    }

    // Create normalized structure with only tract IDs
    const normalizeGroup = (group: DistrictGroup) => ({
      startDistrictNumber: group.startDistrictNumber,
      endDistrictNumber: group.endDistrictNumber,
      totalDistricts: group.totalDistricts,
      totalPopulation: group.totalPopulation,
      bounds: group.bounds,
      centroid: group.centroid,
      censusTractIds: group.censusTracts ? group.censusTracts.map(t => this.getTractId(t)).filter((id): id is string => id !== null) : []
    });

    // Create normalized structure - explicitly exclude censusTracts arrays
    const normalized: any = {
      totalPopulation: result.totalPopulation,
      averagePopulation: result.averagePopulation,
      populationVariance: result.populationVariance,
      algorithmHistory: result.algorithmHistory || [],
      _normalized: true,
      _normalizedVersion: '2.0',
      _state: state,
      _tractCount: tractMap.size,
      finalDistricts: result.finalDistricts ? result.finalDistricts.map(normalizeGroup) : result.finalDistricts,
      steps: result.steps ? result.steps.map(step => ({
        step: step.step,
        level: step.level,
        description: step.description,
        totalGroups: step.totalGroups,
        totalDistricts: step.totalDistricts,
        divisionDirection: step.divisionDirection,
        divisionLine: step.divisionLine,
        divisionLines: step.divisionLines,
        districtGroups: step.districtGroups ? step.districtGroups.map(normalizeGroup) : step.districtGroups
      })) : result.steps
    };

    return {
      normalizedResult: normalized,
      tractMap: Array.from(tractMap.entries())
    };
  }

  /**
   * Generate a cache key from options
   */
  private generateCacheKey(state: string, algorithm: AlgorithmType, maxIterations: number): string {
    return `${state}:${algorithm}:${maxIterations}`;
  }

  /**
   * Get document ID from cache key
   */
  private getDocId(state: string, algorithm: AlgorithmType, maxIterations: number): string {
    // Firestore document IDs can't contain colons, so replace with underscore
    return this.generateCacheKey(state, algorithm, maxIterations).replace(/:/g, '_');
  }

  /**
   * Get cached result if available (async, returns Observable)
   */
  get(state: string, algorithm: AlgorithmType, maxIterations: number): Observable<GeodistrictResult | null> {
    const key = this.generateCacheKey(state, algorithm, maxIterations);
    const cacheKey = this.getDocId(state, algorithm, maxIterations);

    // Check in-memory cache first
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached) {
      // Check algorithm version - if missing or doesn't match, invalidate memory cache
      if (!memoryCached.version || memoryCached.version !== ALGORITHM_VERSION) {
        console.log(`🔄 Memory cache version mismatch or missing: cached=${memoryCached.version || 'missing'}, current=${ALGORITHM_VERSION}. Invalidating memory cache.`);
        this.memoryCache.delete(key);
      } else {
        console.log(`✅ Memory cache hit for ${key} (algorithm version: ${memoryCached.version})`);
        return of(memoryCached.result);
      }
    }

    // Try backend API (which uses Firestore)
    // Include algorithm version in query parameter for cache validation
    const cacheUrl = `${this.API_BASE}/api/algorithm/${algorithm}/cache/${cacheKey}?algorithmVersion=${ALGORITHM_VERSION}`;
    
    return this.http.get<{ status: string; cached: boolean; data?: any; algorithmVersion?: string }>(
      cacheUrl
    ).pipe(
      map(response => {
        if (response.cached && response.data) {
          // Check algorithm version - if missing or doesn't match, invalidate cache
          if (!response.algorithmVersion) {
            // Invalidate this cache entry
            this.invalidate(state, algorithm, maxIterations).subscribe();
            return null;
          }
          
          if (response.algorithmVersion !== ALGORITHM_VERSION) {
            // Invalidate this cache entry
            this.invalidate(state, algorithm, maxIterations).subscribe();
            return null;
          }
          
          const result = response.data as GeodistrictResult;
          // Store in memory cache for faster access (with version)
          this.memoryCache.set(key, { result, version: response.algorithmVersion });
          return result;
        } else {
          return null;
        }
      }),
      catchError(error => {
        console.error(`Cache read error for ${key}:`, error);
        // Return null on error (fallback to no cache)
        return of(null);
      })
    );
  }

  /**
   * Store result in cache (async)
   * Uses normalized caching: tract geometries stored separately at state level
   */
  set(state: string, algorithm: AlgorithmType, maxIterations: number, result: GeodistrictResult): Observable<void> {
    const key = this.generateCacheKey(state, algorithm, maxIterations);
    const cacheKey = this.getDocId(state, algorithm, maxIterations);

    // Store in memory cache immediately (with version)
    this.memoryCache.set(key, { result, version: ALGORITHM_VERSION });

    // Normalize on frontend to reduce payload size BEFORE sending
    const { normalizedResult, tractMap } = this.normalizeResultForCache(result, state);
    
    // Check normalized payload size
    const normalizedPayload = {
      cacheKey,
      divisionResult: normalizedResult,
      state: state,
      ttl: null,
      algorithmVersion: ALGORITHM_VERSION
    };
    const normalizedSize = JSON.stringify(normalizedPayload).length;
    const normalizedSizeMB = (normalizedSize / (1024 * 1024)).toFixed(2);
    const originalSize = JSON.stringify({ cacheKey, divisionResult: result, state, ttl: null, algorithmVersion: ALGORITHM_VERSION }).length;
    const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Frontend normalization: ${originalSizeMB} MB → ${normalizedSizeMB} MB (${((1 - normalizedSize / originalSize) * 100).toFixed(1)}% reduction, ${tractMap.length} tracts)`);
    
    if (normalizedSize > 30 * 1024 * 1024) {
      console.warn(`⚠️ Normalized payload size (${normalizedSizeMB} MB) is still close to Cloud Run 32MB limit. Cache may fail.`);
    }

    // Include tract map in payload so backend can store it in state-level cache
    const payload = {
      ...normalizedPayload,
      tractMap: tractMap // Include tract map for state-level caching
    };

    // Store via backend API (which uses Firestore with normalized caching)
    return this.http.post<{ 
      status: string; 
      message: string; 
      cacheKey: string; 
      stateTractCacheKey?: string;
      sizes?: {
        originalMB: number;
        normalizedMB: number;
        tractCacheMB: number;
        compressionRatio: number;
        tractCount: number;
      }
    }>(
      `${this.API_BASE}/api/algorithm/${algorithm}/cache`,
      payload
    ).pipe(
      map((response) => {
        if (response.sizes) {
          console.log(`💾 Cached normalized result via backend API for ${key}`);
          console.log(`   Algorithm cache: ${response.sizes.normalizedMB} MB, Tract cache: ${response.sizes.tractCacheMB} MB (${response.sizes.tractCount} tracts)`);
          console.log(`   Total reduction: ${response.sizes.compressionRatio}% (${response.sizes.originalMB} MB → ${response.sizes.normalizedMB} MB algorithm cache)`);
        } else {
          console.log(`💾 Cached result via backend API for ${key}`);
        }
      }),
      catchError(error => {
        // Handle specific error types
        if (error.status === 413) {
          const errorMsg = error.error?.message || error.message || 'Request too large';
          console.error(`❌ Cache request too large for ${key}: ${errorMsg}`);
          console.warn(`⚠️ Result will only be available in memory cache (not persisted to Firestore)`);
        } else if (error.status === 0) {
          // CORS or network error
          console.error(`❌ Network/CORS error writing to backend cache for ${key}:`, error);
        } else {
          console.error(`❌ Error writing to backend cache for ${key}:`, error);
        }
        // Don't throw - memory cache is still available
        return of(undefined);
      })
    );
  }

  /**
   * Invalidate cache for a specific state and algorithm (async)
   */
  invalidate(state: string, algorithm: AlgorithmType, maxIterations: number): Observable<void> {
    const key = this.generateCacheKey(state, algorithm, maxIterations);
    const cacheKey = this.getDocId(state, algorithm, maxIterations);

    // Remove from memory cache
    this.memoryCache.delete(key);

    // Remove via backend API (using request options for body)
    return this.http.request('DELETE', `${this.API_BASE}/api/algorithm/${algorithm}/cache`, {
      body: { cacheKey },
      headers: { 'Content-Type': 'application/json' }
    }).pipe(
      map(() => {
        console.log(`🗑️ Invalidated cache via backend API for ${key}`);
      }),
      catchError(error => {
        console.error(`❌ Error deleting from backend cache for ${key}:`, error);
        return of(undefined);
      })
    );
  }

  /**
   * Invalidate all cache entries for a state (async)
   * Note: This clears memory cache only. Backend cache invalidation by state would require backend support.
   */
  invalidateState(state: string): Observable<void> {
    // Clear from memory cache
    const keysToDelete: string[] = [];
    this.memoryCache.forEach((_, key) => {
      if (key.startsWith(`${state}:`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.memoryCache.delete(key);
    });
    console.log(`🗑️ Invalidated ${keysToDelete.length} memory cache entries for state ${state}`);
    return of(undefined);
  }

  /**
   * Clear all cache (async)
   * Note: This clears memory cache only. Backend cache clearing would require backend support.
   */
  clear(): Observable<void> {
    const memorySize = this.memoryCache.size;
    this.memoryCache.clear();
    console.log(`🗑️ Cleared all memory cache (${memorySize} entries)`);
    return of(undefined);
  }

  /**
   * Get cache size (returns memory cache size, Firestore size would require a query)
   */
  size(): number {
    return this.memoryCache.size;
  }
}

