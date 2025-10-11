#!/bin/bash

# Setup Secret Manager permissions for GeoDistricts API
# This script grants the Cloud Run service account access to Secret Manager

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="geodistricts"
REGION="us-central1"
BACKEND_SERVICE="geodistricts-api"
SECRET_NAME="census-api-key"

echo -e "${BLUE}🔐 Setting up Secret Manager permissions for GeoDistricts API...${NC}"
echo ""

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Set the project
echo -e "${BLUE}📋 Setting project to $PROJECT_ID...${NC}"
gcloud config set project $PROJECT_ID

# Check if the secret exists
echo -e "${BLUE}🔍 Checking if census-api-key secret exists...${NC}"
if ! gcloud secrets describe $SECRET_NAME &> /dev/null; then
    echo -e "${YELLOW}⚠️  census-api-key secret not found.${NC}"
    echo -e "${YELLOW}Please create it first with:${NC}"
    echo "   gcloud secrets create $SECRET_NAME --data-file=- <<< 'your-census-api-key'"
    echo ""
    echo -e "${BLUE}📚 See CENSUS_API_KEY_SETUP.md for detailed instructions.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ census-api-key secret found.${NC}"

# Get the Cloud Run service account
echo -e "${BLUE}🔍 Getting Cloud Run service account...${NC}"
SERVICE_ACCOUNT=$(gcloud run services describe $BACKEND_SERVICE \
  --region=$REGION \
  --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")

if [ -z "$SERVICE_ACCOUNT" ]; then
    echo -e "${YELLOW}⚠️  Cloud Run service not found or not deployed yet.${NC}"
    echo -e "${YELLOW}Please deploy the service first with: ./scripts/deploy.sh${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Found service account: $SERVICE_ACCOUNT${NC}"

# Check if the service account already has the required permission
echo -e "${BLUE}🔍 Checking existing permissions...${NC}"
if gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/secretmanager.secretAccessor AND bindings.members:$SERVICE_ACCOUNT" \
  --format="value(bindings.members)" | grep -q "$SERVICE_ACCOUNT"; then
    echo -e "${GREEN}✅ Service account already has Secret Manager access.${NC}"
else
    echo -e "${BLUE}🔧 Granting Secret Manager access to service account...${NC}"
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:$SERVICE_ACCOUNT" \
      --role="roles/secretmanager.secretAccessor"
    echo -e "${GREEN}✅ Permission granted successfully.${NC}"
fi

# Test secret access
echo -e "${BLUE}🧪 Testing secret access...${NC}"
if gcloud secrets versions access latest --secret=$SECRET_NAME &> /dev/null; then
    echo -e "${GREEN}✅ Secret access test successful.${NC}"
else
    echo -e "${YELLOW}⚠️  Secret access test failed. This might be expected if the service account doesn't have access yet.${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Secret Manager setup completed!${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo "  1. Deploy the backend service: ./scripts/deploy.sh"
echo "  2. Test the census proxy endpoints"
echo "  3. Verify the application works correctly"
echo ""
echo -e "${BLUE}🔍 To verify the setup:${NC}"
echo "  - Check service logs: gcloud logs read --service=$BACKEND_SERVICE --limit=20"
echo "  - Test health endpoint: curl https://$BACKEND_SERVICE-uc.a.run.app/health"
echo "  - Test census proxy: curl https://$BACKEND_SERVICE-uc.a.run.app/api/census/cache-info"
