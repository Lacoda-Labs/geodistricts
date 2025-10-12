# GeoDistricts API Service

A Cloud Run service that provides the main API for GeoDistricts, including Census API proxy functionality with Firestore caching.

## Features

- **Census API Proxy**: Proxies calls to the U.S. Census Bureau API
- **TIGERweb Proxy**: Proxies calls to TIGERweb for geographic boundaries
- **Firestore Caching**: Caches responses in Google Cloud Firestore
- **Data Compression**: Compresses GeoJSON data to reduce storage size
- **CORS Support**: Handles CORS for frontend applications
- **Health Monitoring**: Provides health check endpoints
- **Cache Management**: API endpoints for cache inspection and management

## API Endpoints

### General
- `GET /health` - Health check endpoint
- `GET /api/hello` - Hello world endpoint

### Census Data
- `GET /api/census/tract-data` - Get census tract demographic data
- `GET /api/census/tract-boundaries` - Get census tract geographic boundaries

### Cache Management
- `GET /api/census/cache-info` - Get information about cached entries
- `DELETE /api/census/cache` - Clear cache entries (all or specific key)

## Environment Variables

- `NODE_ENV` - Environment (production/development)
- `PORT` - Port to run the service on (default: 8080)
- `GOOGLE_CLOUD_PROJECT` - Google Cloud project ID
- `FRONTEND_URL` - Frontend URL for CORS configuration

## Secrets

- `census-api-key` - U.S. Census Bureau API key (stored in Google Cloud Secret Manager)

**Note**: The Census API key is retrieved from Secret Manager in production and from the `CENSUS_API_KEY` environment variable in local development.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   export GOOGLE_CLOUD_PROJECT=geodistricts
   export CENSUS_API_KEY=your-census-api-key  # For local development only
   export FRONTEND_URL=http://localhost:4200
   ```

   **Note**: For production, the Census API key is stored in Secret Manager and retrieved automatically.

3. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

### Prerequisites

1. **Create the Census API key secret**:
   ```bash
   gcloud secrets create census-api-key --data-file=- <<< 'your-census-api-key'
   ```

2. **Set up Secret Manager permissions**:
   ```bash
   ./scripts/setup-secrets.sh
   ```

### Deploy the Service

Use the main deployment script:

```bash
./scripts/deploy.sh
```

Or deploy manually:

1. Build and push the Docker image:
   ```bash
   gcloud builds submit --tag gcr.io/geodistricts/geodistricts-api
   ```

2. Deploy to Cloud Run:
   ```bash
   gcloud run deploy geodistricts-api \
     --image gcr.io/geodistricts/geodistricts-api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

## Firestore Setup

The service uses Firestore for caching. Make sure:

1. Firestore is enabled in your Google Cloud project
2. The service has appropriate Firestore permissions
3. The `census_cache` collection is created automatically

## Cache Configuration

- **TTL**: 24 hours (configurable)
- **Version**: 1.0 (for cache invalidation)
- **Compression**: GeoJSON data is compressed to reduce storage
- **Attribution**: Includes proper data source attribution

## Data Sources

- **Census API**: https://api.census.gov/data
- **TIGERweb**: https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0

## Performance Features

- **Pagination**: Handles large datasets with automatic pagination
- **Compression**: Reduces data size for storage and transmission
- **Caching**: Reduces API calls and improves response times
- **Error Handling**: Graceful error handling and fallbacks

## Security

- **CORS**: Configured for specific frontend origins
- **API Key**: Census API key stored as Cloud Run secret
- **Authentication**: Service is publicly accessible (no auth required for census data)

## Monitoring

- **Health Checks**: Built-in health check endpoint
- **Logging**: Comprehensive logging for debugging
- **Metrics**: Cloud Run provides built-in metrics

## Cost Optimization

- **Auto-scaling**: Scales to zero when not in use
- **Efficient Caching**: Reduces redundant API calls
- **Data Compression**: Minimizes storage costs
- **Resource Limits**: Configured for optimal cost/performance
