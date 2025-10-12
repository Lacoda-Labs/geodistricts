#!/bin/bash

# Setup script for API keys configuration
# This script helps set up the API keys configuration file

echo "Setting up API keys configuration..."

# Check if api-keys.ts already exists
if [ -f "frontend/src/config/api-keys.ts" ]; then
    echo "⚠️  api-keys.ts already exists. Skipping setup."
    echo "If you need to update your API key, edit frontend/src/config/api-keys.ts directly."
    exit 0
fi

# Check if template exists
if [ ! -f "frontend/src/config/api-keys.template.ts" ]; then
    echo "❌ Template file not found: frontend/src/config/api-keys.template.ts"
    exit 1
fi

# Copy template to actual config file
cp frontend/src/config/api-keys.template.ts frontend/src/config/api-keys.ts

echo "✅ Created frontend/src/config/api-keys.ts from template"
echo ""
echo "📝 Next steps:"
echo "1. Edit frontend/src/config/api-keys.ts"
echo "2. Replace 'YOUR_CENSUS_API_KEY_HERE' with your actual Census API key"
echo "3. Get your free API key from: https://api.census.gov/data/key_signup.html"
echo ""
echo "🔒 The api-keys.ts file is in .gitignore to keep your keys secure"
