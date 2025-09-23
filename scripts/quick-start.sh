#!/bin/bash

echo "�� GeoDistricts Quick Start"
echo "=========================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Angular CLI is installed
if ! command -v ng &> /dev/null; then
    echo "�� Installing Angular CLI..."
    npm install -g @angular/cli
fi

# Run setup
echo "�� Running setup..."
npm run setup

echo ""
echo "🎉 Setup complete! Starting development servers..."
echo ""
echo "Starting both backend and frontend..."
echo "Backend will be available at: http://localhost:8080"
echo "Frontend will be available at: http://localhost:4200"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start both servers
npm run dev
