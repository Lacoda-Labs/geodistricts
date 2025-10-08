#!/bin/bash

# GeoDistricts Domain Setup Script
# This script helps set up a custom domain for the GeoDistricts application

set -e  # Exit on any error

echo "🌐 Setting up custom domain for GeoDistricts..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="geodistricts"
REGION="us-central1"
DOMAIN="geodistricts.org"
FRONTEND_SERVICE="geodistricts-web"
BACKEND_SERVICE="geodistricts-api"

echo -e "${BLUE}📋 Domain Configuration:${NC}"
echo "  Project ID: $PROJECT_ID"
echo "  Domain: $DOMAIN"
echo "  Frontend Service: $FRONTEND_SERVICE"
echo "  Backend Service: $BACKEND_SERVICE"
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

# Install beta components
echo -e "${BLUE}🔧 Installing beta components...${NC}"
gcloud components install beta --quiet

# Enable required APIs
echo -e "${BLUE}🔧 Enabling required APIs...${NC}"
gcloud services enable run.googleapis.com
gcloud services enable domains.googleapis.com
gcloud services enable dns.googleapis.com

# Get the current service URL
echo -e "${BLUE}🔍 Getting current service URL...${NC}"
SERVICE_URL=$(gcloud run services describe $FRONTEND_SERVICE --region=$REGION --format="value(status.url)")
echo "  Current service URL: $SERVICE_URL"

# Map the domain to the service
echo -e "${BLUE}🌐 Mapping domain $DOMAIN to Cloud Run service...${NC}"
echo "  This will create a domain mapping in Google Cloud Run"
echo "  You'll need to verify domain ownership and configure DNS records"

# Create domain mapping
echo "  Creating domain mapping..."
gcloud beta run domain-mappings create \
    --service $FRONTEND_SERVICE \
    --domain $DOMAIN \
    --region $REGION

echo ""
echo -e "${GREEN}✅ Domain mapping created successfully!${NC}"
echo ""

# Get the DNS records that need to be configured
echo -e "${BLUE}📋 DNS Configuration Required:${NC}"
echo ""
echo "You need to configure the following DNS records in your Namecheap account:"
echo ""

# Get the domain mapping details
echo "Getting DNS configuration details..."
DOMAIN_MAPPING=$(gcloud beta run domain-mappings describe $DOMAIN --region=$REGION --format="value(status.resourceRecords[].name,status.resourceRecords[].type,status.resourceRecords[].rrdata)")

echo -e "${YELLOW}📝 DNS Records to add in Namecheap:${NC}"
echo ""

# Parse and display DNS records
gcloud beta run domain-mappings describe $DOMAIN --region=$REGION --format="table(status.resourceRecords[].name,status.resourceRecords[].type,status.resourceRecords[].rrdata)" | tail -n +2 | while read -r line; do
    if [[ -n "$line" ]]; then
        echo "  $line"
    fi
done

echo ""
echo -e "${BLUE}📋 Step-by-Step Instructions:${NC}"
echo ""
echo "1. Log into your Namecheap account"
echo "2. Go to Domain List and click 'Manage' next to geodistricts.org"
echo "3. Go to the 'Advanced DNS' tab"
echo "4. Add the DNS records shown above"
echo "5. Wait for DNS propagation (can take up to 48 hours)"
echo "6. Test your domain: https://$DOMAIN"
echo ""

echo -e "${YELLOW}⚠️  Important Notes:${NC}"
echo "- DNS propagation can take 24-48 hours"
echo "- You can check DNS propagation status at: https://dnschecker.org"
echo "- The domain mapping will show as 'Pending' until DNS is configured"
echo "- Once DNS is configured, your site will be available at: https://$DOMAIN"
echo ""

echo -e "${GREEN}🎉 Domain setup initiated!${NC}"
echo "Complete the DNS configuration in Namecheap to finish the setup."
