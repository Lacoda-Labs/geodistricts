# Census Proxy Implementation

## Overview

This implementation creates a Cloud Run service that proxies Census API calls and caches results in Firestore, solving the localStorage quota limitation (5MB) while providing better performance and scalability.

## Architecture

```
Frontend (Angular) → Cloud Run Proxy → Census APIs
                          ↓
                    Firestore Cache
```

## Components

### 1. Cloud Run Backend Service (`backend/census-proxy.js`)

**Features:**
- Express.js server with CORS support
- Census API proxy endpoints
- TIGERweb proxy for geographic boundaries
- Firestore caching with TTL and versioning
- Data compression for GeoJSON
- Health monitoring
- Cache management APIs

**Key Endpoints:**
- `GET /api/census/tract-data` - Census demographic data
- `GET /api/census/tract-boundaries` - Geographic boundaries
- `GET /api/census/cache-info` - Cache status
- `DELETE /api/census/cache` - Clear cache
- `GET /health` - Health check

### 2. Modified Client Service (`frontend/src/app/services/census.service.ts`)

**Changes:**
- Added `CENSUS_PROXY_BASE` configuration
- Modified `getTractData()` to use Cloud Run proxy
- Modified `getTractBoundaries()` to use Cloud Run proxy
- Added proxy cache management methods
- Maintained local caching as fallback
- Added comprehensive debugging methods

**New Methods:**
- `getProxyCacheInfo()` - Get proxy cache status
- `clearProxyCache()` - Clear proxy cache
- `debugAllCacheStatus()` - Debug both local and proxy caches

### 3. Environment Configuration

**Development (`environment.ts`):**
```typescript
censusProxyUrl: 'http://localhost:8080'
```

**Production (`environment.prod.ts`):**
```typescript
censusProxyUrl: 'https://census-proxy-<project-id>-uc.a.run.app'
```

### 4. Deployment Configuration

**Dockerfile:**
- Node.js 18 Alpine base image
- Non-root user for security
- Health checks
- Production optimizations

**Cloud Run Configuration (`cloud-run.yaml`):**
- Auto-scaling (0-10 instances)
- Resource limits (512Mi memory, 1 CPU)
- Environment variables and secrets
- Health probes

**Deployment Script (`deploy-census-proxy.sh`):**
- Automated build and deployment
- API enablement
- Health check validation
- Configuration guidance

## Benefits

### 1. Solves localStorage Quota Issue
- **Before**: 5MB localStorage limit exceeded
- **After**: Unlimited Firestore storage with compression

### 2. Improved Performance
- **Server-side caching**: Reduces API calls
- **Data compression**: Smaller payloads
- **CDN benefits**: Cloud Run global distribution

### 3. Better Reliability
- **Fallback caching**: Local cache as backup
- **Error handling**: Graceful degradation
- **Health monitoring**: Proactive issue detection

### 4. Cost Optimization
- **Auto-scaling**: Scales to zero when unused
- **Efficient caching**: Reduces redundant API calls
- **Compression**: Minimizes storage costs

## Data Flow

### 1. First Request
```
Frontend → Cloud Run → Census API → Firestore Cache → Frontend
```

### 2. Cached Request
```
Frontend → Cloud Run → Firestore Cache → Frontend
```

### 3. Local Cache Fallback
```
Frontend → Local Cache → Frontend
```

## Cache Strategy

### Firestore Cache (Primary)
- **TTL**: 24 hours
- **Version**: 1.0 for compatibility
- **Compression**: GeoJSON data compressed
- **Attribution**: Proper data source attribution

### Local Cache (Fallback)
- **TTL**: 24 hours
- **Version**: 1.0 for compatibility
- **Size**: Limited by localStorage quota
- **Purpose**: Offline capability and performance

## Deployment Steps

### 1. Prerequisites
```bash
# Install gcloud CLI
# Authenticate with Google Cloud
gcloud auth login
gcloud config set project geodistricts
```

### 2. Deploy Backend
```bash
cd backend
./scripts/deploy-census-proxy.sh
```

### 3. Update Frontend Configuration
```typescript
// environment.prod.ts
censusProxyUrl: 'https://census-proxy-<actual-project-id>-uc.a.run.app'
```

### 4. Deploy Frontend
```bash
cd frontend
npm run build
# Deploy to your hosting platform
```

## Monitoring and Debugging

### Health Checks
```bash
curl https://census-proxy-<project-id>-uc.a.run.app/health
```

### Cache Status
```typescript
// In browser console
censusService.debugAllCacheStatus();
```

### Cache Management
```typescript
// Clear all proxy cache
censusService.clearProxyCache().subscribe();

// Get proxy cache info
censusService.getProxyCacheInfo().subscribe(console.log);
```

## Security Considerations

### 1. CORS Configuration
- Restricted to specific frontend origins
- Credentials support for authenticated requests

### 2. API Key Management
- Census API key stored as Cloud Run secret
- Not exposed in client-side code

### 3. Public Access
- Service is publicly accessible (census data is public)
- No authentication required for census data access

## Performance Metrics

### Expected Improvements
- **Cache Hit Rate**: 80-90% for repeated requests
- **Response Time**: 50-80% reduction for cached data
- **Storage**: Unlimited (vs 5MB localStorage limit)
- **Reliability**: 99.9% uptime with Cloud Run

### Monitoring
- Cloud Run metrics (requests, latency, errors)
- Firestore metrics (reads, writes, storage)
- Custom application metrics via logging

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Check `FRONTEND_URL` environment variable
   - Verify frontend URL matches CORS configuration

2. **Cache Misses**
   - Check Firestore permissions
   - Verify cache TTL and version settings

3. **API Errors**
   - Check Census API key secret
   - Verify API quotas and limits

4. **Performance Issues**
   - Monitor Cloud Run metrics
   - Check Firestore performance
   - Review data compression settings

### Debug Commands
```bash
# Check service logs
gcloud logs read --service=census-proxy --limit=50

# Test health endpoint
curl -v https://census-proxy-<project-id>-uc.a.run.app/health

# Check cache status
curl https://census-proxy-<project-id>-uc.a.run.app/api/census/cache-info
```

## Future Enhancements

1. **Advanced Caching**
   - Redis for faster cache access
   - Cache warming strategies
   - Intelligent cache invalidation

2. **Data Processing**
   - Server-side data aggregation
   - Real-time data updates
   - Data validation and cleaning

3. **Analytics**
   - Usage tracking
   - Performance monitoring
   - Cost optimization insights

4. **Security**
   - Rate limiting
   - API authentication
   - Data encryption at rest
