# Local File Cache Configuration

## Environment Variables

To configure the local file cache system, set these environment variables:

### Cache Mode
```bash
# Use local file cache (default for development)
USE_LOCAL_CACHE=true

# Use Firestore cache (default for production)
USE_LOCAL_CACHE=false
```

### Census API Key
```bash
# Get your free API key from: https://api.census.gov/data/key_signup.html
CENSUS_API_KEY=your_census_api_key_here
```

### Server Configuration
```bash
PORT=8080
NODE_ENV=development
```

## Cache Mode Selection

The system automatically selects the cache mode based on:

1. **Local Files** (default for development):
   - `NODE_ENV !== 'production'` OR
   - `USE_LOCAL_CACHE=true`

2. **Firestore** (default for production):
   - `NODE_ENV === 'production'` AND
   - `USE_LOCAL_CACHE !== 'true'`

## Local-Only Data (dev/maps on localhost)

When `USE_LOCAL_CACHE` is true (default when `NODE_ENV !== 'production'` or `USE_LOCAL_CACHE=true`), primary reads and writes use the local filesystem. The following are also written to **both** local and cloud when possible:

- **Union polygons**: Full geometry is stored locally (with metadata) and in Cloud Storage. On read, the local blob is used when present; otherwise Cloud Storage is used.
- **Tract-level party data** (`tract_party_{state}_{year}`): Written to local cache and to Cloud Storage. If GCP credentials are not configured (e.g. in dev), the cloud write is skipped and a warning is logged; local write still succeeds.
- **District-level party data** (`district_party_{state}_{step}_{maxIterations}_{vestYear}`): Written to local (or Firestore when not using local cache) and to Cloud Storage. Cloud write is skipped with a warning if credentials are unavailable.

Other cache data (Census API cache, VEST processed data, algorithm step cache, state tract cache) remains local-only when `USE_LOCAL_CACHE` is true.

The server can start **without GCP credentials** in this mode. When credentials are missing, cloud writes for union polygons and party data are skipped; Firestore and Cloud Storage are not initialized until a code path that requires them runs (i.e. when `USE_LOCAL_CACHE` is false).

### Tract party calculation (local workflow)

Tract party calculation is intended to be run from local dev (e.g. `cd backend && npm run tract-party`). For this workflow:

- Tract party data is stored under **`backend/data/census-cache/`** (keys `tract_party_{state}_{year}`) and is also written to Cloud Storage when GCP credentials are available.
- The script `run-tract-party-persistence.js` forces `USE_LOCAL_CACHE='true'` so that output always goes to the local filesystem regardless of `NODE_ENV`.

### Risks and considerations

- **Disk space**: Local cache can grow with state tracts, step data, and VEST data. Clear `backend/data/census-cache/` (and optionally `backend/data/vest/`) if needed.
- **Large payloads**: Single JSON files (e.g. for large states) have no built-in size cap. Monitor disk usage for very large states (e.g. CA, TX).
- **Dev vs production**: Data in local cache is not in GCP. Switching from local to Firestore (or vice versa) does not migrate data; repopulate or clear as needed.
- **Listing/querying**: Listing cache keys uses the local cache directory (e.g. for algorithm step invalidation). Some Firestore-style queries are emulated via key prefix and loading docs.

## Local File Cache Benefits

- ✅ **No external dependencies** - No need for Firestore or cloud services
- ✅ **Fast access** - Local file system access is very fast
- ✅ **Persistent** - Data persists between server restarts
- ✅ **Transparent** - Easy to inspect and debug cache contents
- ✅ **Version control friendly** - Can be included in git for development data
- ✅ **Cost effective** - No cloud storage costs for development

## Cache Directory Structure

```
data/census-cache/
├── README.md                    # Documentation
├── census_counties_*.json       # County data cache files
├── census_tract_data_*.json     # Tract demographic data cache files
├── census_tract_boundaries_*.json # Tract boundary GeoJSON cache files
└── *.meta.json                  # Metadata files for each cache entry
```

## Cache Management

### API Endpoints
- `GET /health` - Check server health and cache mode
- `GET /api/test/cache` - Test cache connectivity
- `GET /api/census/cache-info` - View cache entries and statistics
- `DELETE /api/census/cache` - Clear cache entries
- `POST /api/census/cache/cleanup` - Clean up expired entries

### Manual File Management
Cache files are stored in `/data/census-cache/` and can be:
- Manually deleted to clear cache
- Inspected to debug cache contents
- Backed up for development data preservation

## Testing

Run the test script to verify local cache functionality:
```bash
cd backend
node test-local-cache.js
```

## Troubleshooting

### Cache Not Working
1. Check if cache directory exists and is writable
2. Verify environment variables are set correctly
3. Check server logs for cache-related errors
4. Test cache connectivity: `GET /api/test/cache`

### Performance Issues
1. Check disk space availability
2. Monitor file system performance
3. Consider using SSD storage for better performance

### Large Cache Files
1. Use cleanup endpoint to remove expired entries
2. Monitor cache size via cache info endpoint
3. Consider reducing TTL for development
