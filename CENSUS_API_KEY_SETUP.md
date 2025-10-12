# Census API Key Setup Guide

## ⚠️ Security Notice

The previous Census API key (`50b6b6cb3983813724eb6e4f9c0c4020d47d270d`) was exposed in the GitHub repository and should be considered compromised. **You must request a new API key immediately.**

## How to Request a New Census API Key

### 1. **Visit the Census API Key Request Page**

Go to: https://api.census.gov/data/key_signup.html

### 2. **Fill Out the Request Form**

You'll need to provide:

- **First Name**: Your first name
- **Last Name**: Your last name  
- **Email Address**: Your email address
- **Organization**: Your organization name (e.g., "GeoDistricts Project")
- **Intended Use**: Describe how you'll use the API

**Sample Intended Use Description:**
```
I am developing a web application called GeoDistricts that helps visualize and analyze census tract data for redistricting purposes. The application will:

1. Display census tract boundaries and demographic data
2. Allow users to explore population statistics by geographic area
3. Provide tools for analyzing demographic distributions
4. Cache data to improve performance and reduce API calls

The application is for educational and research purposes related to understanding demographic patterns and geographic data visualization.
```

### 3. **Submit the Request**

- Click "Submit" to send your request
- You should receive a confirmation email
- **Processing time**: Usually 1-2 business days

### 4. **Receive Your API Key**

- You'll receive an email with your new API key
- **Important**: Keep this key secure and never commit it to version control

## Setting Up the New API Key in Google Cloud

### 1. **Create the Secret in Secret Manager**

```bash
# Set your project ID
export PROJECT_ID="geodistricts"

# Create the secret (replace YOUR_NEW_API_KEY with the actual key)
echo "YOUR_NEW_API_KEY" | gcloud secrets create census-api-key --data-file=-

# Or if you prefer to enter it interactively:
gcloud secrets create census-api-key --data-file=- <<< 'YOUR_NEW_API_KEY'
```

### 2. **Verify the Secret Was Created**

```bash
# List secrets to confirm it exists
gcloud secrets list --filter="name:census-api-key"

# Test accessing the secret (optional)
gcloud secrets versions access latest --secret="census-api-key"
```

### 3. **Grant Access to Cloud Run Service**

The Cloud Run service needs permission to access the secret:

```bash
# Get the Cloud Run service account
SERVICE_ACCOUNT=$(gcloud run services describe geodistricts-api \
  --region=us-central1 \
  --format="value(spec.template.spec.serviceAccountName)")

# Grant Secret Manager Secret Accessor role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

## Local Development Setup

For local development, you can set the API key as an environment variable:

### 1. **Create a .env file in the backend directory**

```bash
cd backend
echo "CENSUS_API_KEY=YOUR_NEW_API_KEY" > .env
```

### 2. **Add .env to .gitignore**

Make sure `.env` is in your `.gitignore` file:

```bash
echo ".env" >> .gitignore
```

### 3. **Test Local Development**

```bash
cd backend
npm install
npm run dev
```

## Testing the API Key

### 1. **Test the Secret Manager Integration**

```bash
# Test the backend health endpoint
curl https://geodistricts-api-uc.a.run.app/health

# Test the census proxy endpoint
curl "https://geodistricts-api-uc.a.run.app/api/census/tract-data?state=06&county=001"
```

### 2. **Check the Logs**

```bash
# View recent logs to see if the API key is being retrieved successfully
gcloud logs read --service=geodistricts-api --limit=20 --filter="textPayload:~/census/"
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

- Check your API usage regularly at: https://api.census.gov/data/key_signup.html
- Set up alerts for unusual usage patterns

## Troubleshooting

### Common Issues

#### 1. **"Census API key not available" Error**

**Cause**: Secret Manager can't access the API key

**Solutions**:
```bash
# Check if the secret exists
gcloud secrets list --filter="name:census-api-key"

# Check if the service account has permission
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/secretmanager.secretAccessor"
```

#### 2. **"Invalid API Key" Error**

**Cause**: The API key is incorrect or expired

**Solutions**:
- Verify the API key is correct
- Check if the key has been revoked
- Request a new key if necessary

#### 3. **"Rate Limit Exceeded" Error**

**Cause**: Too many API requests

**Solutions**:
- Implement proper caching (already done)
- Add delays between requests
- Consider upgrading to a higher rate limit

### Debug Commands

```bash
# Check secret exists and is accessible
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

## API Key Management Commands

### Update the Secret

```bash
# Update the secret with a new API key
echo "NEW_API_KEY" | gcloud secrets versions add census-api-key --data-file=-
```

### Delete the Secret (if needed)

```bash
# Delete the secret (use with caution)
gcloud secrets delete census-api-key
```

### List Secret Versions

```bash
# List all versions of the secret
gcloud secrets versions list census-api-key
```

## Next Steps After Setup

1. **Deploy the updated service**:
   ```bash
   ./scripts/deploy.sh
   ```

2. **Test the integration**:
   ```bash
   curl https://geodistricts-api-uc.a.run.app/api/census/cache-info
   ```

3. **Monitor the logs** to ensure the API key is being retrieved successfully

4. **Test the frontend** to ensure census data loads properly

## Contact Information

If you encounter issues:

1. **Census API Issues**: Contact the U.S. Census Bureau API support
2. **Google Cloud Issues**: Check the Google Cloud documentation or support
3. **Application Issues**: Review the application logs and error messages

## Important Notes

- **API Key Exposure**: The previous key was exposed in GitHub and should be considered compromised
- **Rate Limits**: Census API has rate limits; the application includes caching to minimize API calls
- **Data Attribution**: Always include proper attribution when using Census data
- **Terms of Service**: Ensure compliance with Census API terms of service

Remember: **Never commit API keys to version control!** Always use Secret Manager for production and environment variables for local development.
