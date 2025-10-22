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
