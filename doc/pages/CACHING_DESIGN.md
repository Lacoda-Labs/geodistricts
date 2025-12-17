# Caching Design Document

## Overview

The GeoDistricts application uses a multi-tier caching architecture to optimize performance and reduce API costs. The caching system handles:

1. **Census Data** (tract boundaries, demographics, counties)
2. **Algorithm Results** (geodistrict calculations)
3. **User Preferences** (UI state)

The architecture separates data storage from algorithm results, uses normalization to reduce payload sizes, and implements a hybrid storage approach: **Cloud Storage for large files (> 1MB)** and **Firestore for small metadata and algorithm results**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Memory Cache │  │ localStorage │  │ Normalization│      │
│  │  (in-memory) │  │  (UI state)  │  │  (pre-cache) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                 │
│                            ▼                                 │
│                    HTTP API Calls                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Local Files  │  │  Firestore   │  │ Cloud Storage│      │
│  │  (dev only)  │  │  (metadata)  │  │  (large data)│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                            │                  │             │
│                            └──────────────────┘             │
│                      (references)                           │
└─────────────────────────────────────────────────────────────┘
```

**Storage Strategy:**
- **Cloud Storage**: Large static files (> 1MB) - tract boundaries, state tract cache
- **Firestore**: Small files (< 1MB) - algorithm results, metadata, references to Cloud Storage
- **Automatic Selection**: System automatically routes files based on size threshold

---

## Frontend Caching

### 1. Memory Cache

**Location:** `GeodistrictCacheService.memoryCache`

**Structure:**
```typescript
Map<string, { 
  result: GeodistrictResult; 
  version: string 
}>
```

**Key Format:** `{state}_{algorithm}_{maxIterations}` (e.g., `AZ_latlong_100`)

**Purpose:**
- Fast in-memory access for recently used algorithm results
- Reduces HTTP requests during the same session
- Validates algorithm version to prevent stale data

**Lifecycle:**
- Populated on cache hit from backend
- Cleared on version mismatch
- Cleared on cache invalidation
- Lost on page refresh (not persistent)

**Version Checking:**
- Algorithm version stored with each cached result
- Version mismatch triggers cache invalidation
- Prevents using results from outdated algorithm versions

### 2. localStorage

**Location:** Browser `localStorage`

**Keys:**
- `showTractBoundaries`: Boolean preference for showing/hiding tract boundaries on map

**Purpose:**
- Persist user UI preferences across sessions
- No expiration (persists until user clears browser data)

**Usage:**
```typescript
// Save preference
localStorage.setItem('showTractBoundaries', 'true');

// Load preference
const saved = localStorage.getItem('showTractBoundaries');
```

### 3. Frontend Normalization

**Location:** `GeodistrictCacheService.normalizeResultForCache()`

**Purpose:**
- Reduce payload size before sending to backend
- Separate tract geometries from algorithm metadata
- Achieve ~99% size reduction for algorithm cache

**Process:**
1. Extract all unique tracts from `finalDistricts` and `steps`
2. Create tract map: `Map<tractId, tractGeometry>`
3. Replace tract geometries with tract IDs in algorithm result
4. Send normalized result + tract map to backend

**Normalized Structure:**
```typescript
{
  // Algorithm metadata (small, ~0.1MB)
  totalPopulation: number;
  averagePopulation: number;
  populationVariance: number;
  algorithmHistory: any[];
  _normalized: true;
  _normalizedVersion: '2.0';
  _state: string;
  _tractCount: number;
  
  // District groups with tract IDs only (no geometries)
  finalDistricts: [{
    startDistrictNumber: number;
    endDistrictNumber: number;
    totalDistricts: number;
    totalPopulation: number;
    bounds: {...};
    centroid: {...};
    censusTractIds: string[]; // IDs only, no geometries
  }],
  
  steps: [{
    step: number;
    level: number;
    description: string;
    districtGroups: [{...}] // Similar structure with tract IDs
  }]
}
```

**Tract Map:**
```typescript
Array<[tractId: string, tractGeometry: GeoJsonFeature]>
```

---

## Backend Caching

### Cache Mode Selection

The backend supports two cache modes:

1. **Local Files** (Development)
   - Triggered by: `USE_LOCAL_CACHE=true` OR `NODE_ENV !== 'production'`
   - Storage: `data/census-cache/*.json` files
   - Benefits: No external dependencies, fast local access, easy debugging

2. **Firestore** (Production)
   - Triggered by: `USE_LOCAL_CACHE !== 'true'` AND `NODE_ENV === 'production'`
   - Storage: Google Cloud Firestore `census_cache` collection
   - Benefits: Shared between localhost and production, scalable, persistent

**Note:** Algorithm cache **always** uses Firestore (shared between environments)

### Firestore Collection Structure

**Collection:** `census_cache`

**Document Types:**

#### 1. Census Data Documents

**Key Format:** `census_{type}_{hash}`
- `census_tract_boundaries_{hash}`: Tract boundary GeoJSON
- `census_tract_data_{hash}`: Tract demographic data
- `census_counties_{hash}`: County data

**Document Structure:**
```javascript
{
  data: any,                    // The actual cached data
  timestamp: number,            // Unix timestamp (ms)
  ttl: number | null,           // Time to live (ms), null = no expiration
  version: string,              // Cache version (for invalidation)
  source: string,               // Data source identifier
  attribution: string           // Attribution string
}
```

**Example:**
```javascript
{
  data: {
    type: "FeatureCollection",
    features: [...]
  },
  timestamp: 1700000000000,
  ttl: 86400000,  // 24 hours
  version: "1.0",
  source: "U.S. Census Bureau",
  attribution: "Data provided by the U.S. Census Bureau (public domain)"
}
```

#### 2. Algorithm Result Documents

**Key Format:** `{state}_{algorithm}_{maxIterations}` (e.g., `AZ_latlong_100`)

**Document Structure:**
```javascript
{
  data: {
    // Normalized algorithm result (no tract geometries)
    totalPopulation: number,
    averagePopulation: number,
    populationVariance: number,
    algorithmHistory: any[],
    _normalized: true,
    _normalizedVersion: '2.0',
    _state: string,
    _tractCount: number,
    finalDistricts: [...],  // With tract IDs only
    steps: [...]            // With tract IDs only
  },
  timestamp: number,
  ttl: number | null,       // null = no expiration (algorithm results are static)
  version: string,          // Cache version
  algorithmVersion: string, // Algorithm version (for validation)
  source: string,           // e.g., "latlong-algorithm-cache"
  attribution: string,
  compressed: true,
  normalized: true,
  state: string,            // State code (e.g., "AZ")
  tractCacheKey: string     // Reference to state tract cache
}
```

#### 3. State Tract Cache Documents

**Key Format:** `state_tracts_{stateCode}` (e.g., `state_tracts_AZ`)

**Cloud Storage Structure** (when > 1MB - **Preferred**):
- **Firestore Metadata Document:** `state_tracts_{stateCode}`
  ```javascript
  {
    cloudStoragePath: "gs://geodistricts-census-data/state-tracts/AZ.json",
    timestamp: number,
    ttl: null,                // No expiration (tract geometries are static)
    version: string,
    source: "state-tract-cache-metadata",
    attribution: string,
    chunked: false,
    cloudStorage: true,       // Flag indicating Cloud Storage storage
    totalChunks: 0,           // Not chunked
    tractCount: number,
    state: string,
    size: number,            // Size in bytes
    sizeMB: number            // Size in MB
  }
  ```
- **Cloud Storage File:** `gs://geodistricts-census-data/state-tracts/{stateCode}.json`
  - Contains: `Array<[tractId: string, tractGeometry: GeoJsonFeature]>`
  - No size limit (unlike Firestore's 1MB limit)
  - Single file read (no chunking needed)

**Single Firestore Document Structure** (when < 1MB - **Legacy**):
```javascript
{
  data: Array<[tractId: string, tractGeometry: GeoJsonFeature]>,
  timestamp: number,
  ttl: null,                // No expiration (tract geometries are static)
  version: string,
  source: "state-tract-cache",
  attribution: string,
  compressed: true,
  tractCount: number,
  chunked: false
}
```

**Chunked Firestore Document Structure** (when > 1MB - **Legacy/Fallback**):
- **Metadata Document:** `state_tracts_{stateCode}`
  ```javascript
  {
    timestamp: number,
    ttl: null,
    version: string,
    source: "state-tract-cache-metadata",
    attribution: string,
    chunked: true,
    totalChunks: number,
    tractCount: number,
    state: string,
    chunkKeys: [           // Array of chunk document keys
      "state_tracts_AZ_chunk_0",
      "state_tracts_AZ_chunk_1",
      ...
    ]
  }
  ```

- **Chunk Documents:** `state_tracts_{stateCode}_chunk_{index}`
  ```javascript
  {
    data: Array<[tractId: string, tractGeometry: GeoJsonFeature]>, // Subset of tracts
    timestamp: number,
    ttl: null,
    version: string,
    source: "state-tract-cache-chunk",
    attribution: string,
    compressed: true,
    chunkIndex: number,
    totalChunks: number,
    tractCount: number,     // Number of tracts in this chunk
    state: string
  }
  ```

### Chunking Strategy

**Trigger:** When tract cache size > 1MB (Firestore document limit)

**Process:**
1. Calculate tract cache size
2. If > 1MB, split into chunks
3. Each chunk limited to ~700KB (70% of 1MB limit) to account for document overhead
4. Verify each chunk document size before saving
5. Store chunks as separate documents
6. Store metadata document with chunk references

**Chunk Size Calculation:**
- Target: 70% of 1MB limit (~700KB for data field)
- Accounts for document metadata overhead (~200 bytes per document)
- Validates actual document size before saving
- Handles edge cases where individual tracts are very large

**Retrieval:**
1. Fetch metadata document
2. Check `chunked` flag
3. If chunked, fetch all chunk documents in parallel
4. Combine chunks into single tract array
5. Use combined array for decompression

---

## Cache Key Generation

### Frontend Cache Keys

**Algorithm Results:**
```typescript
generateCacheKey(state: string, algorithm: AlgorithmType, maxIterations: number): string {
  return `${state}_${algorithm}_${maxIterations}`;
}
```

**Example:** `AZ_latlong_100`

**Document ID (for Firestore):**
```typescript
getDocId(state: string, algorithm: AlgorithmType, maxIterations: number): string {
  return `${state}_${algorithm}_${maxIterations}`.replace(/:/g, '_');
}
```

### Backend Cache Keys

**Census Data:**
```javascript
function generateCacheKey(type, params) {
  // Creates hash from parameters
  // Example: census_tract_boundaries_jbcaic
}
```

**Algorithm Results:**
- Same format as frontend: `{state}_{algorithm}_{maxIterations}`

**State Tract Cache:**
- Format: `state_tracts_{stateCode}`
- Example: `state_tracts_AZ`

**Chunk Keys:**
- Format: `state_tracts_{stateCode}_chunk_{index}`
- Example: `state_tracts_AZ_chunk_0`

---

## Cache Flow

### Algorithm Result Caching Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Frontend: Execute Algorithm                              │
│    - Run algorithm or fetch from backend                    │
│    - Get GeodistrictResult with full tract geometries       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend: Normalize Result                               │
│    - Extract all unique tracts                              │
│    - Create tract map: Map<tractId, tractGeometry>          │
│    - Replace geometries with IDs in result                  │
│    - Size: 14MB → 0.1MB (algorithm) + 14MB (tracts)        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Frontend: Send to Backend                                │
│    POST /api/algorithm/{algorithm}/cache                    │
│    Body: {                                                  │
│      cacheKey: "AZ_latlong_100",                            │
│      divisionResult: normalizedResult,                      │
│      tractMap: [...],                                       │
│      algorithmVersion: "20251113-1400"                      │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Backend: Store Algorithm Result                          │
│    - Store normalized result in Firestore                    │
│    - Document: census_cache/AZ_latlong_100                  │
│    - Size: ~0.1MB (fits within 1MB limit)                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Backend: Store Tract Cache                                │
│    - Check tract cache size                                 │
│    - If > 1MB: Split into chunks                            │
│    - Store chunks: state_tracts_AZ_chunk_0, _chunk_1, ...   │
│    - Store metadata: state_tracts_AZ                        │
└─────────────────────────────────────────────────────────────┘
```

### Algorithm Result Retrieval Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Frontend: Check Memory Cache                             │
│    - Check in-memory Map                                    │
│    - Validate algorithm version                             │
│    - Return if found                                        │
└─────────────────────────────────────────────────────────────┘
                            │ (miss)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend: Request from Backend                           │
│    GET /api/algorithm/{algorithm}/cache/{cacheKey}         │
│    Query: ?algorithmVersion=20251113-1400                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Backend: Fetch Algorithm Result                          │
│    - Get from Firestore: census_cache/AZ_latlong_100        │
│    - Validate version and expiration                        │
│    - Extract tractCacheKey reference                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Backend: Fetch Tract Cache                               │
│    - Get metadata: census_cache/state_tracts_AZ             │
│    - If chunked: Fetch all chunks in parallel               │
│    - Combine chunks into single array                       │
│    - Return tract map                                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Backend: Decompress Result                               │
│    - Reconstruct full result with tract geometries          │
│    - Replace tract IDs with actual geometries               │
│    - Return complete GeodistrictResult                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Frontend: Store in Memory Cache                          │
│    - Cache result in memory Map                             │
│    - Store with algorithm version                           │
│    - Return to caller                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Cache Invalidation

### Version-Based Invalidation

**Algorithm Version:**
- Stored with each cached result: `algorithmVersion: "20251113-1400"`
- Frontend requests include version: `?algorithmVersion=20251113-1400`
- Version mismatch triggers cache invalidation
- Prevents using results from outdated algorithm versions

**Cache Version:**
- Stored with each cached entry: `version: "1.0"`
- Used for cache structure changes
- Version mismatch triggers cache deletion

### TTL-Based Expiration

**Census Data:**
- Default TTL: 24 hours (86400000 ms)
- Configurable per cache entry
- Expired entries are automatically deleted

**Algorithm Results:**
- TTL: `null` (no expiration)
- Algorithm results are static and don't change
- Only invalidated by version changes

**Tract Geometries:**
- TTL: `null` (no expiration)
- Tract geometries are static census data
- Only invalidated by version changes

### Manual Invalidation

**Frontend:**
```typescript
cacheService.invalidate(state, algorithm, maxIterations)
```

**Backend:**
```http
DELETE /api/algorithm/{algorithm}/cache
Body: { cacheKey: "AZ_latlong_100" }
```

---

## Size Limits and Constraints

### Firestore Limits

- **Document Size:** 1MB maximum
- **Field Size:** 1MB maximum
- **Array Size:** No explicit limit, but constrained by document size

### Chunking Thresholds

- **Tract Cache Chunk Size:** ~700KB (70% of 1MB limit)
- **Accounts for:** Document metadata overhead (~200 bytes)
- **Validation:** Actual document size verified before saving

### Cloud Run Limits

- **Request Size:** 32MB maximum
- **Response Size:** 32MB maximum (for streaming)

### Normalization Benefits

**Before Normalization:**
- Algorithm result: ~14MB (includes all tract geometries)
- Exceeds Firestore 1MB limit

**After Normalization:**
- Algorithm result: ~0.1MB (tract IDs only)
- Tract cache: ~14MB (separate, chunked if needed)
- **99% reduction** in algorithm cache size

---

## Error Handling

### Cache Miss
- Returns `null` or empty result
- Triggers fresh data fetch
- No error thrown (expected behavior)

### Cache Version Mismatch
- Automatically deletes outdated cache
- Logs warning message
- Treats as cache miss

### Size Limit Exceeded
- Returns HTTP 413 (Payload Too Large)
- Provides detailed error message
- Includes size information for debugging

### Firestore Errors
- Logs detailed error information
- Returns appropriate HTTP status codes
- Falls back gracefully when possible

---

## Performance Considerations

### Frontend
- **Memory Cache:** O(1) lookup, instant access
- **Normalization:** Reduces payload size by ~99%
- **Parallel Requests:** Chunks fetched in parallel

### Backend
- **Firestore:** Shared cache between localhost and production
- **Chunking:** Enables caching of large datasets
- **Batch Operations:** Multiple chunks saved in single batch

### Network
- **Normalization:** Reduces transfer size significantly
- **Chunking:** Allows incremental loading if needed
- **Caching:** Reduces API calls and improves response times

---

## Security Considerations

### Data Access
- Firestore uses Application Default Credentials (ADC)
- Requires `gcloud auth application-default login` for localhost
- Production uses service account credentials

### Cache Validation
- Algorithm version checking prevents stale data
- Cache version checking prevents structure mismatches
- TTL expiration prevents indefinitely stale data

### Data Privacy
- Census data is public domain (no PII)
- Algorithm results contain no user data
- Cache keys don't expose sensitive information

---

## Monitoring and Debugging

### Logging

**Frontend:**
- Cache hits/misses
- Normalization statistics
- Version mismatches

**Backend:**
- Cache operations (get/set)
- Chunking operations
- Size calculations
- Firestore operations

### Metrics

**Cache Performance:**
- Hit rate
- Miss rate
- Average response time
- Cache size

**Size Metrics:**
- Original size
- Normalized size
- Compression ratio
- Chunk count

---

## Future Improvements

1. **Compression:** Add gzip compression for large payloads
2. **CDN:** Use CDN for static tract geometries
3. **Incremental Loading:** Load chunks on-demand
4. **Cache Warming:** Pre-populate cache for common states
5. **Analytics:** Track cache performance metrics
6. **Compression Algorithms:** Use more efficient serialization formats

---

## References

- [Firestore Limits](https://firebase.google.com/docs/firestore/quotas)
- [Cloud Run Limits](https://cloud.google.com/run/quotas)
- [Census API Documentation](https://www.census.gov/data/developers/data-sets.html)

