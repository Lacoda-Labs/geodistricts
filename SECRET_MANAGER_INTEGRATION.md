# Secret Manager Integration Summary

## Overview

Successfully moved the Census API key from frontend environment files to Google Cloud Secret Manager, implementing secure secret management for the GeoDistricts API service.


## What Was Done

### 1. **Removed API Key from Frontend**
- ✅ Removed `censusApiKey` from `frontend/src/environments/environment.ts`
- ✅ Removed `censusApiKey` from `frontend/src/environments/environment.prod.ts`
- ✅ Frontend no longer has access to the API key (more secure)

### 2. **Updated Backend for Secret Manager**
- ✅ Added `@google-cloud/secret-manager` dependency
- ✅ Implemented `getCensusApiKey()` function to retrieve from Secret Manager
- ✅ Added fallback to environment variable for local development
- ✅ Updated census proxy endpoints to use Secret Manager API key

### 3. **Enhanced Deployment Process**
- ✅ Updated `scripts/deploy.sh` to enable Secret Manager API
- ✅ Added secret existence check before deployment
- ✅ Removed `--set-secrets` flag (no longer needed)
- ✅ Added comprehensive setup instructions

### 4. **Created Helper Scripts and Documentation**
- ✅ Created `scripts/setup-secrets.sh` for permission management
- ✅ Created `CENSUS_API_KEY_SETUP.md` with detailed instructions
- ✅ Updated backend README with Secret Manager information

## Technical Implementation

### Backend Changes (`backend/index.js`)

```javascript
// Added Secret Manager client
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Initialize Secret Manager
const secretClient = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts';
const CENSUS_API_KEY_SECRET_NAME = 'census-api-key';

// Function to retrieve API key from Secret Manager
async function getCensusApiKey() {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${CENSUS_API_KEY_SECRET_NAME}/versions/latest`,
    });
    
    const apiKey = version.payload.data.toString();
    console.log('Successfully retrieved Census API key from Secret Manager');
    return apiKey;
  } catch (error) {
    console.error('Error retrieving Census API key from Secret Manager:', error);
    // Fallback to environment variable for local development
    const fallbackKey = process.env.CENSUS_API_KEY;
    if (fallbackKey) {
      console.log('Using fallback Census API key from environment variable');
      return fallbackKey;
    }
    throw new Error('Census API key not found in Secret Manager or environment variables');
  }
}
```

### Frontend Changes

**Before:**
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080/api',
  censusApiKey: 'EXPOSED_API_KEY_REMOVED', // ❌ EXPOSED - Key removed for security
  censusProxyUrl: 'http://localhost:8080'
};
```

**After:**
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080/api',
  censusProxyUrl: 'http://localhost:8080' // ✅ No API key exposure
};
```

## Security Benefits

### 1. **Eliminated API Key Exposure**
- **Before**: API key was in frontend code and committed to GitHub
- **After**: API key is stored securely in Secret Manager, never in code

### 2. **Centralized Secret Management**
- **Before**: API key scattered across environment files
- **After**: Single source of truth in Secret Manager

### 3. **Access Control**
- **Before**: Anyone with code access had API key
- **After**: Only authorized services can access the secret

### 4. **Audit Trail**
- **Before**: No tracking of API key usage
- **After**: Secret Manager provides access logs and audit trails

## Setup Instructions

### 1. **Request New Census API Key**

**⚠️ CRITICAL**: The exposed API key must be replaced immediately.

1. Visit: https://api.census.gov/data/key_signup.html
2. Fill out the request form with your information
3. Wait for approval (1-2 business days)
4. Receive your new API key via email

### 2. **Create Secret in Secret Manager**

```bash
# Set your project ID
export PROJECT_ID="geodistricts"

# Create the secret with your new API key
echo "YOUR_NEW_API_KEY" | gcloud secrets create census-api-key --data-file=-
```

### 3. **Set Up Permissions**

```bash
# Run the helper script
./scripts/setup-secrets.sh

# Or manually:
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$(gcloud run services describe geodistricts-api --region=us-central1 --format='value(spec.template.spec.serviceAccountName)')" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. **Deploy the Service**

```bash
./scripts/deploy.sh
```

## Local Development Setup

For local development, create a `.env` file in the backend directory:

```bash
cd backend
echo "CENSUS_API_KEY=YOUR_NEW_API_KEY" > .env
```

**Important**: Add `.env` to `.gitignore` to prevent committing the API key.

## Testing the Integration

### 1. **Test Secret Manager Access**

```bash
# Test if the secret exists and is accessible
gcloud secrets versions access latest --secret="census-api-key"
```

### 2. **Test Backend Health**

```bash
# Test the health endpoint
curl https://geodistricts-api-uc.a.run.app/health
```

### 3. **Test Census Proxy**

```bash
# Test the census proxy endpoint
curl "https://geodistricts-api-uc.a.run.app/api/census/tract-data?state=06&county=001"
```

### 4. **Check Logs**

```bash
# View logs to see if API key is being retrieved successfully
gcloud logs read --service=geodistricts-api --limit=20 --filter="textPayload:~/census/"
```

## Troubleshooting

### Common Issues

#### 1. **"Census API key not available" Error**

**Cause**: Secret Manager can't access the API key

**Solutions**:
```bash
# Check if the secret exists
gcloud secrets list --filter="name:census-api-key"

# Check service account permissions
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/secretmanager.secretAccessor"
```

#### 2. **"Permission denied" Error**

**Cause**: Service account doesn't have Secret Manager access

**Solution**:
```bash
# Grant the required permission
./scripts/setup-secrets.sh
```

#### 3. **"Invalid API Key" Error**

**Cause**: The API key is incorrect or expired

**Solutions**:
- Verify the API key is correct
- Check if the key has been revoked
- Request a new key if necessary

### Debug Commands

```bash
# Check secret exists
gcloud secrets describe census-api-key

# Test secret access
gcloud secrets versions access latest --secret="census-api-key"

# Check service account permissions
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/secretmanager.secretAccessor"

# View service logs
gcloud logs read --service=geodistricts-api --limit=50

# Test API key directly
curl "https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E&for=state:06&key=YOUR_API_KEY"
```

## Security Best Practices

### 1. **Never Commit API Keys**
- ✅ Use Secret Manager for production
- ✅ Use environment variables for local development
- ✅ Add `.env` to `.gitignore`
- ❌ Never commit API keys to version control

### 2. **Rotate Keys Regularly**
- Set a reminder to rotate your Census API key every 6-12 months
- Monitor API usage for any suspicious activity

### 3. **Monitor Usage**
- Check your API usage regularly
- Set up alerts for unusual usage patterns
- Review Secret Manager access logs

### 4. **Principle of Least Privilege**
- Only grant necessary permissions
- Use service accounts with minimal required access
- Regularly review and audit permissions

## Files Modified

### Backend Files
- `backend/package.json` - Added Secret Manager dependency
- `backend/index.js` - Added Secret Manager integration
- `backend/README.md` - Updated documentation

### Frontend Files
- `frontend/src/environments/environment.ts` - Removed API key
- `frontend/src/environments/environment.prod.ts` - Removed API key

### Scripts
- `scripts/deploy.sh` - Added Secret Manager setup
- `scripts/setup-secrets.sh` - New helper script for permissions

### Documentation
- `CENSUS_API_KEY_SETUP.md` - Comprehensive setup guide
- `SECRET_MANAGER_INTEGRATION.md` - This summary document

## Next Steps

1. **Request new Census API key** (CRITICAL - current key is compromised)
2. **Create secret in Secret Manager** with the new API key
3. **Set up permissions** using the helper script
4. **Deploy the updated service**
5. **Test the integration** thoroughly
6. **Monitor logs** to ensure everything works correctly

## Summary

The integration successfully:

- ✅ **Eliminated API key exposure** from frontend code
- ✅ **Implemented secure secret management** with Secret Manager
- ✅ **Maintained backward compatibility** for local development
- ✅ **Enhanced security** with proper access controls
- ✅ **Provided comprehensive documentation** and helper scripts
- ✅ **Created audit trail** for secret access

The solution follows security best practices and provides a robust foundation for managing sensitive credentials in the GeoDistricts application.
