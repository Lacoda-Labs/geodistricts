#!/bin/bash

# GeoDistricts GCP Deployment Script
# This script builds and deploys the application to Google Cloud Run

set -e  # Exit on any error

echo "🚀 Starting GeoDistricts GCP Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="geodistricts"
REGION="us-central1"
GAR_REPOSITORY="geodistricts-repo"
BACKEND_SERVICE="geodistricts-api"
FRONTEND_SERVICE="geodistricts-web"

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "  Project ID: $PROJECT_ID"
echo "  Region: $REGION"
echo "  Backend Service: $BACKEND_SERVICE"
echo "  Frontend Service: $FRONTEND_SERVICE"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    echo "Visit: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${YELLOW}⚠️  Not authenticated with gcloud. Please run: gcloud auth login${NC}"
    exit 1
fi

# Set the project
echo -e "${BLUE}🔧 Setting project to $PROJECT_ID...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${BLUE}🔧 Enabling required APIs...${NC}"
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# Configure Docker for Artifact Registry
echo -e "${BLUE}🔧 Configuring Docker for Artifact Registry...${NC}"
gcloud auth configure-docker $REGION-docker.pkg.dev

# Build and deploy backend
echo -e "${BLUE}🏗️  Building and deploying backend...${NC}"
cd backend

# Build backend Docker image
echo "  Building backend Docker image..."
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$BACKEND_SERVICE:latest .

# Push backend image
echo "  Pushing backend image to Artifact Registry..."
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$BACKEND_SERVICE:latest

# Deploy backend to Cloud Run
echo "  Deploying backend to Cloud Run..."
gcloud run deploy $BACKEND_SERVICE \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$BACKEND_SERVICE:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10

cd ..

# Build and deploy frontend
echo -e "${BLUE}🏗️  Building and deploying frontend...${NC}"
cd frontend

# Install dependencies
echo "  Installing frontend dependencies..."
npm ci

# Build frontend
echo "  Building frontend..."
npm run build

# Build frontend Docker image
echo "  Building frontend Docker image..."
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$FRONTEND_SERVICE:latest .

# Push frontend image
echo "  Pushing frontend image to Artifact Registry..."
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$FRONTEND_SERVICE:latest

# Deploy frontend to Cloud Run
echo "  Deploying frontend to Cloud Run..."
gcloud run deploy $FRONTEND_SERVICE \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$GAR_REPOSITORY/$FRONTEND_SERVICE:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 80 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10

cd ..

# Get service URLs
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}🌐 Service URLs:${NC}"

BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region=$REGION --format="value(status.url)")
FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region=$REGION --format="value(status.url)")

echo "  Backend API: $BACKEND_URL"
echo "  Frontend App: $FRONTEND_URL"
echo ""

# Test the deployment
echo -e "${BLUE}🧪 Testing deployment...${NC}"

# Test backend health
echo "  Testing backend health..."
if curl -s -f "$BACKEND_URL/api/health" > /dev/null; then
    echo -e "  ${GREEN}✅ Backend is healthy${NC}"
else
    echo -e "  ${YELLOW}⚠️  Backend health check failed (this might be expected if no health endpoint exists)${NC}"
fi

# Test frontend
echo "  Testing frontend..."
if curl -s -f "$FRONTEND_URL" > /dev/null; then
    echo -e "  ${GREEN}✅ Frontend is accessible${NC}"
else
    echo -e "  ${RED}❌ Frontend is not accessible${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Deployment Summary:${NC}"
echo "  ✅ Backend deployed to: $BACKEND_URL"
echo "  ✅ Frontend deployed to: $FRONTEND_URL"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo "  1. Visit the frontend URL to test the application"
echo "  2. Check the browser console for any errors"
echo "  3. Test the census tract mapping functionality"
echo "  4. Verify all states load their complete tract data"
echo ""
echo -e "${GREEN}🚀 GeoDistricts is now live on Google Cloud Run!${NC}"
