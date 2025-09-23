# Google Cloud Setup Guide

## 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: `geodistricts` (or your preferred name)
4. Note the Project ID (you'll need this for GitHub secrets)
5. Click "Create"

## 2. Enable Required APIs

1. In the Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for and enable these APIs:
   - Cloud Run API
   - Container Registry API
   - Cloud Build API

## 3. Create Service Account

1. Go to "IAM & Admin" → "Service Accounts"
2. Click "Create Service Account"
3. Name: `geodistricts-deploy`
4. Description: `Service account for GeoDistricts deployment`
5. Click "Create and Continue"

## 4. Assign Roles

Add these roles to your service account:
- Cloud Run Admin
- Storage Admin
- Service Account User

## 5. Create and Download Key

1. Click on your service account
2. Go to "Keys" tab
3. Click "Add Key" → "Create new key"
4. Select "JSON" format
5. Click "Create"
6. Save the downloaded JSON file securely
7. Copy the entire contents for the `GCP_SA_KEY` GitHub secret

## 6. Test Deployment

After setting up GitHub secrets, push a change to trigger deployment:

```bash
git add .
git commit -m "Initial deployment setup"
git push origin main
```

Check the Actions tab in GitHub to see the deployment progress.