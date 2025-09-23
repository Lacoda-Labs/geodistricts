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
   - Artifact Registry API
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
- Artifact Registry Writer
- Service Account User

**Note**: If you're using the existing service account, you may need to add the Artifact Registry Writer role to fix the deployment issue.

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

## 7. Create Artifact Registry Repository

1. Go to Google Cloud Console → "Artifact Registry"
2. Click "Create Repository"
3. Configure:
   - **Name**: `geodistricts-repo`
   - **Format**: Docker
   - **Location**: `us-central1`
   - **Description**: "Docker repository for GeoDistricts"
4. Click "Create"

## 8. Troubleshooting

### Artifact Registry Permission Errors

If you see errors like:
```
denied: Permission "artifactregistry.repositories.uploadArtifacts" denied
denied: gcr.io repo does not exist. Creating on push requires the artifactregistry.repositories.createOnPush permission
```

**Solution**: Add the required roles to your service account:

1. Go to Google Cloud Console → "IAM & Admin" → "IAM"
2. Find your service account (e.g., `cloud-run-admin@geodistricts.iam.gserviceaccount.com`)
3. Click the pencil icon to edit
4. Click "Add Another Role" and add these roles:
   - **Artifact Registry Writer**
   - **Artifact Registry Repository Administrator** (for createOnPush permission)
5. Click "Save"

### Enable Required APIs

If APIs aren't enabled:
1. Go to "APIs & Services" → "Library"
2. Search for and enable:
   - **Artifact Registry API**
   - **Cloud Resource Manager API**
   - **Service Usage API**