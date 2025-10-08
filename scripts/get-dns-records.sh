#!/bin/bash

# Get DNS Records for GeoDistricts Domain Setup
# This script helps you get the DNS records needed for domain setup

set -e  # Exit on any error

echo "🔍 Getting DNS records for GeoDistricts domain setup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="geodistricts"
DOMAIN="geodistricts.org"
FRONTEND_SERVICE="geodistricts-web"

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Project ID: $PROJECT_ID"
echo "  Domain: $DOMAIN"
echo "  Service: $FRONTEND_SERVICE"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Set the project
echo -e "${BLUE}🔧 Setting project to $PROJECT_ID...${NC}"
gcloud config set project $PROJECT_ID

echo -e "${BLUE}📋 Manual Domain Setup Instructions:${NC}"
echo ""
echo "Since domain ownership verification is required, here's what you need to do:"
echo ""

echo -e "${YELLOW}1. Go to Google Cloud Console:${NC}"
echo "   https://console.cloud.google.com/run/domains?project=$PROJECT_ID"
echo ""

echo -e "${YELLOW}2. Click 'Add Domain Mapping':${NC}"
echo "   - Domain: $DOMAIN"
echo "   - Service: $FRONTEND_SERVICE"
echo "   - Region: us-central1"
echo ""

echo -e "${YELLOW}3. Google will provide DNS records to verify ownership${NC}"
echo "   You'll get a TXT record like:"
echo "   Type: TXT"
echo "   Name: @"
echo "   Value: google-site-verification=XXXXXXXXXX"
echo ""

echo -e "${YELLOW}4. Add the verification record in Namecheap:${NC}"
echo "   - Log into Namecheap"
echo "   - Go to Domain List → Manage → Advanced DNS"
echo "   - Add the TXT record provided by Google"
echo ""

echo -e "${YELLOW}5. After verification, Google will provide additional DNS records:${NC}"
echo "   - A record pointing to Google Cloud Run IP"
echo "   - CNAME record for www subdomain"
echo ""

echo -e "${YELLOW}6. Add all DNS records in Namecheap:${NC}"
echo "   - A record: @ → [Google Cloud Run IP]"
echo "   - CNAME record: www → ghs.googlehosted.com"
echo "   - TXT record: @ → [verification string]"
echo ""

echo -e "${BLUE}📋 Alternative: Use Cloudflare (Faster Setup)${NC}"
echo ""
echo "For faster setup, consider using Cloudflare:"
echo "1. Transfer domain to Cloudflare (free)"
echo "2. Add CNAME record: @ → geodistricts-web-hrw5uyg3sa-uc.a.run.app"
echo "3. Enable SSL/TLS in Cloudflare"
echo "4. Domain will be live in minutes instead of hours"
echo ""

echo -e "${GREEN}🎯 Expected Timeline:${NC}"
echo "- Manual setup: 24-48 hours (DNS propagation)"
echo "- Cloudflare setup: 5-10 minutes"
echo ""

echo -e "${BLUE}📝 Current Application URLs:${NC}"
echo "- Frontend: https://geodistricts-web-hrw5uyg3sa-uc.a.run.app"
echo "- Backend: https://geodistricts-api-hrw5uyg3sa-uc.a.run.app"
echo ""

echo -e "${GREEN}✅ Next Steps:${NC}"
echo "1. Follow the manual setup instructions above"
echo "2. Or consider using Cloudflare for faster setup"
echo "3. Test your domain once DNS is configured"
echo "4. Your application will be available at https://$DOMAIN"
