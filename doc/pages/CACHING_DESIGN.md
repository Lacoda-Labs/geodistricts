# Caching Design Document

## Overview

The GeoDistricts application uses a multi-tier caching architecture to optimize performance and reduce API costs. The caching system handles:

1. **Census Data** (tract boundaries, demographics, counties)
2. **Algorithm Results** (geodistrict calculations, step-by-step state)
3. **User Preferences** (UI state)

The architecture separates data storage from algorithm results, uses normalization to reduce payload sizes, and implements a hybrid storage approach: **Cloud Storage for large files (> 1MB)** and **Firestore for small metadata and algorithm results**. Algorithm cache is always stored in Firestore (shared between localhost and production); census and state-tract data use either local files (development) or Firestore + Cloud Storage (production).

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
- **Cloud Storage**: Large static files (> 1MB) — state tract cache, algorithm state when large, union polygons, tract boundaries, voter registration, tract-party and district-party data, etc.
- **Firestore**: Small files (< 1MB), algorithm results, and metadata documents that reference Cloud Storage paths.
- **Local files** (development only): When `USE_LOCAL_CACHE=true` or `NODE_ENV !== 'production'`, census data is stored under `data/census-cache/`. See [backend/LOCAL_CACHE_CONFIG.md](../../backend/LOCAL_CACHE_CONFIG.md) for configuration.

**Dual-write (local + cloud):** Union polygons and party data (tract-level and district-level) are written to both local cache and Cloud Storage when calculated, so that dev and production can use either source. If GCP credentials are not configured (e.g. in dev), the cloud write is skipped and a warning is logged; local write still succeeds.

---

## Frontend Caching

**Location:** [frontend/src/app/services/geodistrict-cache.service.ts](../../frontend/src/app/services/geodistrict-cache.service.ts)

### 1. Memory Cache

**Structure:**
```typescript
Map<string, { result: GeodistrictResult; version: string }>
```

**Key Format:** `{state}:{maxIterations}` (e.g., `AZ:100`)

**Backend document ID (Firestore):** `{STATE}_{maxIterations}` with colons replaced by underscores (e.g., `AZ_100`).

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

**Keys:**
- `showTractBoundaries`: Boolean preference for showing/hiding tract boundaries on map

**Purpose:** Persist user UI preferences across sessions. No expiration.

### 3. Frontend Normalization

**Purpose:**
- Reduce payload size before sending to backend
- Separate tract geometries from algorithm metadata
- Achieve ~99% size reduction for algorithm cache

**Process:**
1. Extract all unique tracts from `finalDistricts` and `steps`
2. Create tract map: `Map<tractId, tractGeometry>`
3. Replace tract geometries with tract IDs in algorithm result
4. Send normalized result + tract map to backend via `POST /api/algorithm/cache`

**Normalized structure** (tract IDs only in groups; tract map sent separately):
- `totalPopulation`, `averagePopulation`, `populationVariance`, `algorithmHistory`
- `_normalized: true`, `_normalizedVersion: '2.0'`, `_state`, `_tractCount`
- `finalDistricts` and `steps[].districtGroups` with `censusTractIds` (no geometries)

**Tract map:** `Array<[tractId: string, tractGeometry: GeoJsonFeature]>`

---

## Backend Caching

### Cache Mode Selection

The backend supports two cache modes for **census data** (tract boundaries, tract data, counties, etc.):

1. **Local Files** (Development)
   - Triggered by: `USE_LOCAL_CACHE=true` **or** `NODE_ENV !== 'production'`
   - Storage: `data/census-cache/*.json` and `*.meta.json` files
   - See [backend/LOCAL_CACHE_CONFIG.md](../../backend/LOCAL_CACHE_CONFIG.md) for environment variables and API endpoints.

2. **Firestore + Cloud Storage** (Production)
   - Triggered by: `USE_LOCAL_CACHE !== 'true'` and `NODE_ENV === 'production'`
   - Census entries: Firestore for small payloads; payloads > 1MB go to Cloud Storage with a Firestore metadata document containing `cloudStoragePath` and `storedIn: 'cloud-storage'`.

**Note:** Algorithm cache (results and step-by-step state) **always** uses Firestore (and Cloud Storage for large algorithm state or state tract cache). It is shared between localhost and production.

### Firestore Collection: `census_cache`

Single collection for all backend cache documents. Key patterns:

| Key pattern | Description |
|-------------|-------------|
| `census_tract_boundaries_{hash}` | Tract boundary GeoJSON (or Cloud Storage ref when > 1MB) |
| `census_tract_data_{hash}` | Tract demographic data |
| `census_counties_{hash}` | County data |
| `{STATE}_{maxIterations}` (e.g. `AZ_100`) | Algorithm result (normalized); references `tractCacheKey` |
| `state_tracts_{state}` | State tract cache: either metadata pointing to Cloud Storage, or single/chunked Firestore docs |
| `algorithm_state_{state}_{maxIterations}` | Step-by-step algorithm state (or Cloud Storage ref when large) |
| `algorithm_step_{state}_{maxIterations}_{step}` | Cached step data |
| `step_{state}_{step}_{version}` | Run-all step cache |
| `union_polygon_{state}_{step}_{group}` | Metadata; blob in Cloud Storage |
| `voter_registration_{state}` | Voter registration data (or Cloud Storage ref when > 1MB) |

**Census document structure** (when stored in Firestore):
- `data`, `timestamp`, `ttl`, `version`, `source`, `attribution`
- When in Cloud Storage: document holds `cloudStoragePath`, `storedIn: 'cloud-storage'`, `size`, `sizeMB`, etc.

**Algorithm result document** (e.g. `AZ_100`):
- Normalized result (no tract geometries), `timestamp`, `ttl`, `version`, `algorithmVersion`, `normalized: true`, `state`, `tractCacheKey: state_tracts_{state}`

### Cloud Storage

**Bucket:** `CENSUS_DATA_BUCKET` or `geodistricts-census-data`

**Path layout** (from [backend/services/cloud-storage-cache.js](../../backend/services/cloud-storage-cache.js)):

| Key prefix | Path pattern |
|------------|----------------|
| `state_tracts_*` | `state-tracts/{state}.json` |
| `census_tract_boundaries_*` | `boundaries/{state}.json` |
| `census_tract_data_*` | `demographics/{key}.json` |
| `voter_registration_*` | `voter-registration/{state}.json` |
| `union_polygon_*` | `union-polygons/{state}/step-{step}/{key}.json` |
| `congressional_boundaries_*` | `congressional-boundaries/{congress}/{stateName}.json` |
| Other | `data/{key}.json` |

**When used:**
- Payloads > 1MB for census data, state tract cache, algorithm state, and other large blobs.
- State tract cache: **primary** path when size > 1MB; Firestore chunking is fallback if Cloud Storage is unavailable.

### State Tract Cache (detailed)

**Key:** `state_tracts_{stateCode}` (e.g. `state_tracts_AZ`)

**Preferred (size > 1MB):** Cloud Storage
- Firestore holds a metadata document: `cloudStoragePath`, `cloudStorage: true`, `chunked: false`, `tractCount`, `state`, `size`, `sizeMB`, `ttl: null`, `version`, etc.
- Cloud Storage file: `state-tracts/{state}.json` — single file, no size limit.

**Fallback (Firestore):**
- **Single document** (size ≤ 1MB): `data` array + metadata, `chunked: false`.
- **Chunked** (size > 1MB when Cloud Storage not used): metadata doc with `chunked: true`, `chunkKeys: [ state_tracts_{state}_chunk_0, ... ]`; chunk docs `state_tracts_{state}_chunk_{index}` with `data` array per chunk. Chunk data target ~700KB to stay under Firestore 1MB limit.

**Retrieval:** Backend checks metadata; if `cloudStorage` and `cloudStoragePath` present, fetches from Cloud Storage; else if `chunked` and `chunkKeys`, fetches chunks in parallel and concatenates; else reads single `data` field.

---

## Cache Key Generation

### Frontend

**Memory key:** `state:maxIterations` (e.g. `AZ:100`)

**Document ID (Firestore):** `state_maxIterations` with colons replaced by underscores (e.g. `AZ_100`).

```typescript
generateCacheKey(state: string, maxIterations: number): string {
  return `${state}:${maxIterations}`;
}
getDocId(state: string, maxIterations: number): string {
  return `${state}_${maxIterations}`;  // colons already not used in doc id
}
```

### Backend

- **Census:** `generateCacheKey(type, params)` produces hashed keys (e.g. `census_tract_boundaries_xyz`, `census_tract_data_abc`).
- **Algorithm result:** Same as frontend doc id: `{STATE}_{maxIterations}`.
- **State tract cache:** `state_tracts_{stateCode}`.
- **Algorithm state:** `algorithm_state_{state}_{maxIterations}`.
- **Union polygon:** `union_polygon_{state}_{step}_{group}`.

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/algorithm/cache/:cacheKey` | Get cached algorithm result (reconstructs with state tract cache). |
| POST | `/api/algorithm/cache` | Store normalized result + tract map; body: `cacheKey`, `divisionResult`, `state`, `algorithmVersion`, `tractMap`. |
| DELETE | `/api/algorithm/cache` | Invalidate one entry; body: `{ cacheKey: "AZ_100" }`. |
| POST | `/api/algorithm/clear-cache` | Trash: delete all algorithm cache for state (steps 0..N, algorithm state, union polygons). Does **not** delete external cache. |
| POST | `/api/algorithm/restart` | Delete steps 1..N and algorithm state; keep step 0; set algorithm state to iteration 0. |

---

## Cache Flow (algorithm result)

**Store:** Frontend normalizes result → POST `/api/algorithm/cache` with `cacheKey`, `divisionResult`, `tractMap`, `algorithmVersion` → Backend stores normalized result in Firestore under `cacheKey` → Backend stores tract map in state tract cache (Cloud Storage if > 1MB, else Firestore single or chunked) and sets `tractCacheKey` on algorithm doc.

**Retrieve:** Frontend checks memory cache (key `state:maxIterations`) → on miss, GET `/api/algorithm/cache/{cacheKey}` → Backend loads algorithm doc from Firestore, loads tract map from `tractCacheKey` (Cloud Storage or Firestore), reconstructs full result → returns to frontend → frontend stores in memory cache.

---

## Cache Invalidation

### Version-based

- **Algorithm version:** Stored with each cached result; mismatch causes invalidation.
- **Cache version:** `version: "1.0"` on entries; structure changes can bump version and invalidate old entries.

### TTL

- **Census data:** Default 24 hours; configurable.
- **Algorithm results / state tract cache / algorithm state:** TTL `null` (no expiration); invalidated by version or manual delete.

### Manual

- **Frontend:** `cacheService.invalidate(state, maxIterations)` — clears memory and calls DELETE `/api/algorithm/cache` with `cacheKey`.

### External vs algorithm cache (trash / restart)

**Rule:** Trash and restart only delete **algorithm** cache. They must **never** delete or invalidate **external** cache.

**External (never cleared by trash/restart):**
- Tract boundaries, census tract data, `state_tracts_{state}` (Firestore metadata + Cloud Storage)
- State boundary polygon, S4 adjacency, and other external data keys

**Algorithm (cleared by clear-cache; step 1+ cleared by restart):**
- `algorithm_step_{state}_{maxIterations}_{step}`
- `step_{state}_{step}_{version}`
- `algorithm_state_{state}_{maxIterations}` (Firestore + Cloud Storage when large)
- Union polygon docs and Cloud Storage files: `union_polygon_{state}_{step}_{group}`

**Endpoints:**
- **POST /api/algorithm/clear-cache** (trash): Deletes all algorithm step cache (0..N), algorithm state, and union polygons for the state. Does not touch external data.
- **POST /api/algorithm/restart**: Deletes step 1..N and algorithm state; keeps step 0. Sets algorithm state to iteration 0 so the next “Next” runs step 1.

---

## Size Limits and Constraints

- **Firestore:** 1MB max document size; field size 1MB.
- **Cloud Run:** 32MB request/response limit.
- **State tract chunking (Firestore fallback):** ~700KB per chunk (70% of 1MB) to account for metadata.

---

## Error Handling

- **Cache miss:** Returns `null` or empty result; triggers fresh fetch. No error thrown.
- **Version mismatch:** Outdated cache deleted; treated as miss.
- **Payload too large:** HTTP 413 with message and size info.
- **Firestore/Cloud errors:** Logged; appropriate HTTP status; fallback where possible (e.g. Cloud Storage fallback to Firestore chunking for state tract cache).

---

## References

- [backend/LOCAL_CACHE_CONFIG.md](../../backend/LOCAL_CACHE_CONFIG.md) — Local file cache configuration and endpoints
- [Firestore Limits](https://firebase.google.com/docs/firestore/quotas)
- [Cloud Run Limits](https://cloud.google.com/run/quotas)
- [Census API Documentation](https://www.census.gov/data/developers/data-sets.html)
