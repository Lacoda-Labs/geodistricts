import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { GeodistrictResult, AlgorithmType, ALGORITHM_VERSION } from './geodistrict-algorithm.service';
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
    return this.http.get<{ status: string; cached: boolean; data?: any; algorithmVersion?: string }>(
      `${this.API_BASE}/api/algorithm/${algorithm}/cache/${cacheKey}?algorithmVersion=${ALGORITHM_VERSION}`
    ).pipe(
      map(response => {
        if (response.cached && response.data) {
          // Check algorithm version - if missing or doesn't match, invalidate cache
          if (!response.algorithmVersion) {
            console.log(`🔄 Algorithm version missing: Old cache entry without version. Invalidating cache.`);
            // Invalidate this cache entry
            this.invalidate(state, algorithm, maxIterations).subscribe();
            return null;
          }
          
          if (response.algorithmVersion !== ALGORITHM_VERSION) {
            console.log(`🔄 Algorithm version mismatch: cached=${response.algorithmVersion}, current=${ALGORITHM_VERSION}. Invalidating cache.`);
            // Invalidate this cache entry
            this.invalidate(state, algorithm, maxIterations).subscribe();
            return null;
          }
          
          const result = response.data as GeodistrictResult;
          // Store in memory cache for faster access (with version)
          this.memoryCache.set(key, { result, version: response.algorithmVersion });
          console.log(`✅ Backend cache hit for ${key} (algorithm version: ${response.algorithmVersion})`);
          return result;
        } else {
          console.log(`❌ Cache miss for ${key}`);
          return null;
        }
      }),
      catchError(error => {
        console.error(`❌ Error reading from backend cache for ${key}:`, error);
        // Return null on error (fallback to no cache)
        return of(null);
      })
    );
  }

  /**
   * Store result in cache (async)
   */
  set(state: string, algorithm: AlgorithmType, maxIterations: number, result: GeodistrictResult): Observable<void> {
    const key = this.generateCacheKey(state, algorithm, maxIterations);
    const cacheKey = this.getDocId(state, algorithm, maxIterations);

    // Store in memory cache immediately (with version)
    this.memoryCache.set(key, { result, version: ALGORITHM_VERSION });

    // Store via backend API (which uses Firestore)
    return this.http.post<{ status: string; message: string; cacheKey: string }>(
      `${this.API_BASE}/api/algorithm/${algorithm}/cache`,
      {
        cacheKey,
        divisionResult: result,
        ttl: null, // No TTL - persist until invalidated
        algorithmVersion: ALGORITHM_VERSION // Include algorithm version for cache validation
      }
    ).pipe(
      map(() => {
        console.log(`💾 Cached result via backend API for ${key}`);
      }),
      catchError(error => {
        console.error(`❌ Error writing to backend cache for ${key}:`, error);
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

