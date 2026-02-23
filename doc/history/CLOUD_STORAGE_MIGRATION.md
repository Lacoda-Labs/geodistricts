# Cloud Storage Migration Guide

## Overview

The GeoDistricts backend now uses a **hybrid storage approach** that automatically routes large files (> 1MB) to Google Cloud Storage instead of Firestore. This provides:

- **Better Performance**: Single file read vs multiple chunked reads
- **Lower Costs**: ~89% cheaper storage, ~50% cheaper reads
- **No Size Limits**: Cloud Storage supports files up to 5TB (vs Firestore's 1MB limit)
- **Simpler Code**: No chunking logic needed for large files

## Architecture

### Storage Decision Logic

```
File Size > 1MB?
├─ Yes → Cloud Storage (with Firestore metadata reference)
└─ No  → Firestore (direct storage)
```

### What Gets Stored Where

**Cloud Storage:**
- Tract boundaries (> 1MB) - e.g., `boundaries/AZ.json` (52MB)
- State tract cache (> 1MB) - e.g., `state-tracts/AZ.json` (14MB)
- Large demographic data files (> 1MB)

**Firestore:**
- Algorithm results (normalized, < 1MB)
- Metadata and references to Cloud Storage files
- Small census data files (< 1MB)

## Implementation Details

### New Components

1. **Cloud Storage Service** (`backend/services/cloud-storage-cache.js`)
   - Handles all Cloud Storage operations
   - Automatic bucket creation
   - Organized file paths by data type

2. **Updated Cache Functions** (`backend/index.js`)
   - `getFromCache()` - Checks Firestore first, then Cloud Storage
   - `setCache()` - Automatically routes based on file size
   - Algorithm cache - Uses Cloud Storage for state tract cache

### File Organization

```
gs://geodistricts-census-data/
├── boundaries/
│   ├── AZ.json
│   ├── IN.json
│   └── ...
├── state-tracts/
│   ├── AZ.json
│   ├── IN.json
│   └── ...
└── demographics/
    └── ...
```

## Configuration

### Environment Variables

```bash
# Cloud Storage bucket name (default: geodistricts-census-data)
CENSUS_DATA_BUCKET=geodistricts-census-data

# Google Cloud Project (required)
GOOGLE_CLOUD_PROJECT=geodistricts
```

### Required Permissions

The service account needs:
- `storage.objects.create` - To store files
- `storage.objects.get` - To retrieve files
- `storage.objects.delete` - To delete files
- `storage.buckets.get` - To check bucket existence
- `storage.buckets.create` - To create bucket if needed

## Migration

### Automatic Migration

New files are automatically stored in Cloud Storage if they exceed 1MB. No action needed.

### Manual Migration (Optional)

To migrate existing large files from Firestore to Cloud Storage:

```bash
cd backend
node scripts/migrate-to-cloud-storage.js
```

This script:
1. Scans Firestore for documents > 1MB
2. Migrates them to Cloud Storage
3. Updates Firestore references
4. Removes data from Firestore (keeps metadata)

## Usage

### Backend Code

The cache functions automatically handle Cloud Storage:

```javascript
// Store (automatically uses Cloud Storage if > 1MB)
await setCache('census_tract_boundaries_AZ', largeGeoJsonData);

// Retrieve (automatically checks Cloud Storage if referenced)
const cached = await getFromCache('census_tract_boundaries_AZ');
```

### Algorithm Cache

State tract cache is automatically stored in Cloud Storage:

```javascript
// When caching algorithm results
// State tract cache (> 1MB) → Cloud Storage
// Algorithm result (< 1MB) → Firestore
```

## Benefits

### Performance

- **Before**: 17 reads + reassembly for 14MB tract cache
- **After**: 1 read for 14MB tract cache
- **Improvement**: ~17x faster reads

### Cost

**Example: AZ state tract cache (14MB)**

| Metric | Firestore (Chunked) | Cloud Storage |
|--------|---------------------|---------------|
| Storage | $0.0025/month | $0.00028/month |
| Reads (1000/month) | $0.00017 | $0.000005 |
| **Total** | **$0.00267/month** | **$0.000285/month** |
| **Savings** | - | **89%** |

### Scalability

- **Before**: Limited by Firestore 1MB chunks
- **After**: No size limits (up to 5TB per file)
- **Improvement**: Can handle any state size

## Fallback Behavior

If Cloud Storage is unavailable:
1. System falls back to Firestore chunking
2. Logs warning but continues operation
3. No data loss

## Monitoring

Check Cloud Storage usage:

```bash
gsutil du -sh gs://geodistricts-census-data/
gsutil ls -lh gs://geodistricts-census-data/state-tracts/
```

## Bucket READMEs

Each folder (prefix) in the bucket has a `README.md` describing its data and usage. To create or update them, edit the files under `backend/scripts/gcs-readmes/` and run:

```bash
cd backend && node scripts/upload-gcs-readmes.js
```

## Troubleshooting

### Cloud Storage Not Initializing

**Error**: `Failed to initialize Cloud Storage bucket`

**Solution**:
1. Check `GOOGLE_CLOUD_PROJECT` is set
2. Verify service account has Storage permissions
3. Check bucket name doesn't conflict (must be globally unique)

### Migration Fails

**Error**: `Failed to migrate {key}`

**Solution**:
1. Check Cloud Storage permissions
2. Verify bucket exists or can be created
3. Check file size (very large files may timeout)

### Files Not Found

**Error**: `Cloud Storage file missing for {key}`

**Solution**:
1. Check if file exists: `gsutil ls gs://geodistricts-census-data/...`
2. Verify Firestore metadata has correct `cloudStoragePath`
3. Re-run migration if needed

## Future Enhancements

1. **CDN Integration**: Enable Cloud CDN for even faster global access
2. **Compression**: Add gzip compression for Cloud Storage files
3. **Lifecycle Policies**: Auto-delete old files after expiration
4. **Monitoring**: Add Cloud Monitoring alerts for storage usage

