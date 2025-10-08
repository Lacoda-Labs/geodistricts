# GeoDistricts

A modern web application built with Angular and Node.js, deployed on Google Cloud Run.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/Lacoda-Labs/geodistricts.git
cd geodistricts

# Run quick setup (installs dependencies and starts dev servers)
chmod +x scripts/quick-start.sh
./scripts/quick-start.sh
```

## 📁 Project Structure

```
geodistricts/
├── backend/          # Node.js API server
├── frontend/         # Angular web client
├── deploy/           # Deployment configurations
└── .github/          # GitHub Actions workflows
```

## Getting Started

### Prerequisites

- Node.js 18+
- Angular CLI
- Docker
- Google Cloud SDK

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your environment variables:
   ```
   PORT=8080
   NODE_ENV=development
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   ng serve
   ```

## Deployment

### Google Cloud Run

1. Build and push the Docker image:
   ```bash
   cd backend
   docker build -t gcr.io/PROJECT_ID/geodistricts-api .
   docker push gcr.io/PROJECT_ID/geodistricts-api
   ```

2. Deploy to Cloud Run:
   ```bash
   gcloud run deploy geodistricts-api \
     --image gcr.io/PROJECT_ID/geodistricts-api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

### GitHub Actions

The project includes a GitHub Actions workflow that automatically:
- Runs tests on pull requests
- Builds and deploys to Cloud Run on pushes to main

To set up GitHub Actions:
1. Add the following secrets to your GitHub repository:
   - `GCP_PROJECT_ID`: Your Google Cloud project ID
   - `GCP_SA_KEY`: Your Google Cloud service account key

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.
