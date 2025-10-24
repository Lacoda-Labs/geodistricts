#!/bin/bash

# Test script for enclosed tract detection functionality
echo "🧪 Running Enclosed Tract Detection Tests"
echo "========================================"

# Run the specific test file
npm test -- --testNamePattern="Enclosed Tract Detection" --verbose

echo ""
echo "✅ Test execution complete!"
echo ""
echo "📋 Test Coverage:"
echo "  - findContainedTracts: Tests containment detection algorithm"
echo "  - fixIsolatedTractsAfterDivision: Tests isolated tract fixing"
echo "  - divideTractsByLine: Tests integration with division process"
echo "  - AZ tract 001700/001901: Tests specific real-world cases"
echo ""
echo "🔍 Key Test Cases:"
echo "  - Large dataset performance (250+ tracts)"
echo "  - Enclosed tract detection and movement"
echo "  - No-op when tracts are already correctly grouped"
echo "  - Handling of datasets with no enclosed tracts"
echo "  - Integration with lat/long division algorithm"
