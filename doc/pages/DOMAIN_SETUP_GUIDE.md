# GeoDistricts Domain Setup Guide

This guide will help you set up a custom domain (geodistricts.org) for your GeoDistricts application deployed on Google Cloud Run.

## Current Application URLs
- **Frontend**: https://geodistricts-web-hrw5uyg3sa-uc.a.run.app
- **Backend**: https://geodistricts-api-hrw5uyg3sa-uc.a.run.app

## Step 1: Verify Domain Ownership in Google Cloud

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `geodistricts`
3. Navigate to **Cloud Run** → **Domain Mappings**
4. Click **"Add Domain Mapping"**
5. Enter your domain: `geodistricts.org`
6. Select your service: `geodistricts-web`
7. Google will provide you with DNS records to verify ownership

## Step 2: Configure DNS Records in Namecheap

### Option A: Using Google Cloud DNS (Recommended)

1. **Enable Cloud DNS API**:
   ```bash
   gcloud services enable dns.googleapis.com
   ```

2. **Create a DNS zone**:
   ```bash
   gcloud dns managed-zones create geodistricts-zone \
       --dns-name=geodistricts.org. \
       --description="DNS zone for geodistricts.org"
   ```

3. **Get the name servers**:
   ```bash
   gcloud dns managed-zones describe geodistricts-zone --format="value(nameServers)"
   ```

4. **Update Namecheap DNS**:
   - Log into your Namecheap account
   - Go to Domain List → Manage → Advanced DNS
   - Change nameservers to the ones provided by Google Cloud DNS
   - This will give you full control over DNS records

### Option B: Using Namecheap DNS (Current Setup)

If you prefer to keep using Namecheap DNS, you'll need to add the following records:

#### Required DNS Records

1. **A Record** (for the root domain):
   ```
   Type: A
   Host: @
   Value: [Google Cloud Run IP - will be provided after domain mapping]
   TTL: 300
   ```

2. **CNAME Record** (for www subdomain):
   ```
   Type: CNAME
   Host: www
   Value: ghs.googlehosted.com
   TTL: 300
   ```

3. **TXT Record** (for domain verification):
   ```
   Type: TXT
   Host: @
   Value: [Verification string from Google Cloud]
   TTL: 300
   ```

## Step 3: Create Domain Mapping

Once domain ownership is verified:

```bash
gcloud beta run domain-mappings create \
    --service geodistricts-web \
    --domain geodistricts.org \
    --region us-central1
```

## Step 4: Configure SSL Certificate

Google Cloud Run automatically provisions SSL certificates for custom domains. The certificate will be issued once the domain mapping is active and DNS is properly configured.

## Step 5: Test Your Domain

1. Wait for DNS propagation (24-48 hours)
2. Test your domain: https://geodistricts.org
3. Check SSL certificate status in Cloud Run console

## Troubleshooting

### Common Issues

1. **Domain not verified**: Make sure you've added the TXT record for verification
2. **DNS not propagating**: Use [DNS Checker](https://dnschecker.org) to verify propagation
3. **SSL certificate pending**: Wait for automatic certificate provisioning

### Useful Commands

```bash
# Check domain mapping status
gcloud beta run domain-mappings describe geodistricts.org --region=us-central1

# List all domain mappings
gcloud beta run domain-mappings list --region=us-central1

# Check DNS records
nslookup geodistricts.org
dig geodistricts.org
```

## Alternative: Quick Setup with Cloudflare

If you want a faster setup, consider:

1. Transfer your domain to Cloudflare (free)
2. Use Cloudflare's DNS management
3. Set up a CNAME record pointing to your Cloud Run service
4. Enable Cloudflare's SSL/TLS

## Expected Timeline

- **Domain verification**: 5-10 minutes
- **DNS propagation**: 24-48 hours
- **SSL certificate**: 1-2 hours after DNS propagation
- **Total setup time**: 24-48 hours

## Final Result

Once complete, your application will be accessible at:
- **https://geodistricts.org** (main site)
- **https://www.geodistricts.org** (www redirect)

The application will maintain all its current functionality:
- Complete census tract coverage for all states
- Real-time data from TIGERweb API
- Interactive Leaflet maps
- Loading indicators and progress tracking
