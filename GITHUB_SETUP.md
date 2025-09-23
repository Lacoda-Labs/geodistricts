# GitHub Repository Setup Guide

## 1. Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right corner
3. Select "New repository"
4. Name it `geodistricts`
5. Make it public or private (your choice)
6. Don't initialize with README (we already have one)
7. Click "Create repository"

## 2. Connect Local Repository to GitHub

```bash
# Add the remote origin
git remote add origin https://github.com/Lacoda-Labs/geodistricts.git

# Push your code to GitHub
git branch -M main
git push -u origin main
```

## 3. Set up GitHub Secrets

1. Go to your repository on GitHub
2. Click on "Settings" tab
3. In the left sidebar, click "Secrets and variables" → "Actions"
4. Click "New repository secret" and add:

### GCP_PROJECT_ID
- Name: `GCP_PROJECT_ID`
- Value: Your Google Cloud project ID (e.g., `my-geodistricts-project`)

### GCP_SA_KEY
- Name: `GCP_SA_KEY`
- Value: The entire contents of your service account JSON key file

## 4. Test GitHub Actions

1. Make a small change to any file
2. Commit and push the change
3. Go to the "Actions" tab in your GitHub repository
4. Watch the workflow run and deploy to Cloud Run