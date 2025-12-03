# GeoDistricts

A modern web application that demonstrates objective, geographically-based congressional district mapping. Built with Angular and Node.js, deployed on Google Cloud Run. GeoDistricts uses an algorithmic approach to create fair, unbiased congressional districts based solely on geographic and demographic data.

![Voter Data Progress](https://img.shields.io/badge/Voter%20Data-5%2F50%20states-10%25-brightgreen) [![Help Wanted](https://img.shields.io/badge/Help%20Wanted-46%20states-orange)](.github/ISSUE_TEMPLATE/data-source-request.md)

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/Lacoda-Labs/geodistricts.git
cd geodistricts

# Set up API keys (optional - for direct Census API access)
chmod +x scripts/setup-api-keys.sh
./scripts/setup-api-keys.sh

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

## 🧮 Geodistrict Algorithm

This project implements a geographically-based geodistricting algorithm that creates congressional districts using an objective, algorithmic method. The algorithm:

- Divides census tracts into district groups recursively
- Alternates between latitude and longitude divisions
- Maintains geographic contiguity
- Balances population across districts
- Provides step-by-step visualization
- Uses publicly available U.S. Census Bureau data

### Accessing the Algorithm

Navigate to `/maps` or `/geodistrict` in the application to view and interact with the algorithm. The application provides interactive maps showing how districts are created using the algorithmic approach.

### API Key Setup

For direct Census API access (recommended), see [CENSUS_API_KEY_SETUP.md](doc/CENSUS_API_KEY_SETUP.md) for detailed setup instructions.

## 🆘 Help Wanted: Voter Registration Data for All 50 States

We need your help! To calculate party balance in geodistricts, we need voter registration party data for all 50 states + DC. Currently, we only have data sources for **5 states (10% complete)**.

### How You Can Help

1. **Find Data Sources**: Research your state's election office website for voter registration statistics
2. **Create an Issue**: Use our [State Data Source Request template](.github/ISSUE_TEMPLATE/data-source-request.md)
3. **Share Information**: Provide links, formats, costs, and access methods
4. **Help Implement**: Optionally help implement the data loader (see [CONTRIBUTING.md](CONTRIBUTING.md))

### What We Need

For each state, we need:
- **Geographic granularity**: Precinct or county level (preferably precinct)
- **Data fields**: Total voters, Democratic, Republican, Other/Independent
- **Format**: CSV, Excel, or API access
- **Cost**: Free or low-cost preferred

### Current Status

- ✅ **Configured**: 5 states (AZ, CA, FL, NY, TX)
- 🔍 **Help Needed**: 46 states

See [State Data Sources Tracking](doc/STATE_DATA_SOURCES.md) for detailed status.

### Resources

- [Voter Registration Data Plan](doc/VOTER_REGISTRATION_DATA_PLAN.md) - Detailed requirements
- [Contributing Guidelines](CONTRIBUTING.md) - How to contribute
- [Campaign Content Templates](doc/CAMPAIGN_CONTENT_TEMPLATES.md) - Social media templates

**Contributors will be recognized in project documentation and social media (with permission).**

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

Quick start:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

**Priority**: Help us find voter registration data sources for all 50 states! See [Help Wanted](#-help-wanted-voter-registration-data-for-all-50-states) section above.

## Privacy & Terms

This application includes:
- [Privacy Policy](/privacy) - Information about data collection and usage
- [Terms of Service](/terms) - Terms and conditions for using the service

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.


## notes:
```
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="geodistricts-api" AND resource.labels.location="us-central1" AND severity>=DEFAULT AND timestamp >= "2025-12-02T21:10:00-08:00"' --project=geodistricts --format="value(timestamp, textPayload)" --limit=1000 > console.debug/gcp-service-geodistricts-api.log
```