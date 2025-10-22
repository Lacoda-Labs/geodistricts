# Census Data Local File Cache

This directory contains locally cached census data files, similar to the brown-s4 data structure.

## Directory Structure

```
data/census-cache/
├── README.md                    # This file
├── census_counties_*.json       # County data cache files
├── census_tract_data_*.json     # Tract demographic data cache files
├── census_tract_boundaries_*.json # Tract boundary GeoJSON cache files
└── *.meta.json                  # Metadata files for each cache entry
```

## Cache File Format

### Data Files
- **Format**: JSON files containing the actual cached data
- **Naming**: `census_{type}_{hash}.json`
- **Content**: Raw census API responses or processed data

### Metadata Files
- **Format**: JSON files containing cache metadata
- **Naming**: `census_{type}_{hash}.meta.json`
- **Content**: Cache metadata including:
  - `timestamp`: When the data was cached
  - `ttl`: Time-to-live in milliseconds (24 hours = 86,400,000ms)
  - `version`: Cache version for compatibility
  - `source`: Data source attribution
  - `dataSize`: Size of the cached data in bytes

## Cache Configuration

- **TTL**: 24 hours (86,400,000 milliseconds)
- **Version**: 1.0
- **Storage**: Local JSON files
- **Compression**: Applied for large datasets (>1000 features)

## Cache Management

### Automatic Cleanup
- Expired entries are automatically cleaned up when accessed
- Manual cleanup available via API endpoint: `POST /api/census/cache/cleanup`

### Manual Management
- **View cache info**: `GET /api/census/cache-info`
- **Clear specific entry**: `DELETE /api/census/cache?key={cache_key}`
- **Clear all cache**: `DELETE /api/census/cache`
- **Test cache**: `GET /api/test/cache`

## Cache Keys

Cache keys are generated based on request parameters:
- **Counties**: `census_counties_{state_hash}`
- **Tract Data**: `census_tract_data_{state_county_variables_hash}`
- **Tract Boundaries**: `census_tract_boundaries_{state_county_hash}`

## Benefits of Local File Cache

1. **No External Dependencies**: No need for Firestore or cloud services
2. **Fast Access**: Local file system access is very fast
3. **Persistent**: Data persists between server restarts
4. **Transparent**: Easy to inspect and debug cache contents
5. **Version Control**: Can be included in git for development data
6. **Cost Effective**: No cloud storage costs for development

## Environment Configuration

The cache mode is determined by environment variables:
- **Local Files**: `NODE_ENV !== 'production'` OR `USE_LOCAL_CACHE=true`
- **Firestore**: `NODE_ENV === 'production'` AND `USE_LOCAL_CACHE !== 'true'`

## Data Attribution

All cached data includes proper attribution:
- **Source**: U.S. Census Bureau
- **Attribution**: Data provided by the U.S. Census Bureau (public domain)

## File Size Management

- Large datasets (>2000 features) use streaming responses
- GeoJSON data is compressed for datasets >1000 features
- Coordinate precision reduced to 4 decimal places (~11m precision)
- Automatic garbage collection during large data processing

## Troubleshooting

### Cache Not Working
1. Check if cache directory exists and is writable
2. Verify environment variables are set correctly
3. Check server logs for cache-related errors
4. Test cache connectivity: `GET /api/test/cache`

### Large Cache Files
1. Use cleanup endpoint to remove expired entries
2. Monitor cache size via cache info endpoint
3. Consider reducing TTL for development

### Performance Issues
1. Check disk space availability
2. Monitor file system performance
3. Consider using SSD storage for better performance
