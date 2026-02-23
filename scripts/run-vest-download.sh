#!/bin/bash

# Wrapper script to run VEST download from the backend directory
# This ensures proper environment and dependencies are available
#
# Usage: ./scripts/run-vest-download.sh
#
# Environment variables:
#   VEST_DRY_RUN=1        - Dry run mode (no downloads)
#   RUN_VEST_BULK_TESTS=1 - Run tests after completion
#   VEST_YEAR=2020        - Override default year

cd "$(dirname "$0")/../backend"

echo "Running VEST download from backend directory..."
echo "Current directory: $(pwd)"
echo "Node version: $(node --version)"
echo ""

# Run the download script from backend directory
node download-vest-2020.js "$@"