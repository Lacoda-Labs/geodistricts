#!/bin/bash

echo "�� Setting up GeoDistricts project..."

# Install backend dependencies
echo "�� Installing backend dependencies..."
cd backend
npm install
cd ..

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Create backend .env file if it doesn't exist
if [ ! -f backend/.env ]; then
    echo "�� Creating backend .env file..."
    cat > backend/.env << EOF
PORT=8080
NODE_ENV=development
EOF
fi

echo "✅ Setup complete!"
echo ""
echo "To start development:"
echo "  Backend:  cd backend && npm run dev"
echo "  Frontend: cd frontend && ng serve"
echo ""
echo "Your app will be available at:"
echo "  Frontend: http://localhost:4200"
echo "  Backend:  http://localhost:8080"
