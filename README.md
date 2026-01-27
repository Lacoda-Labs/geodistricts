# GeoDistricts

**An algorithmic protocol for U.S. Congressional redistricting that eliminates gerrymandering through objective, geography-based district creation.**

![Voter Data Progress](https://img.shields.io/badge/Voter%20Data-5%2F50%20states-10%25-brightgreen) [![Help Wanted](https://img.shields.io/badge/Help%20Wanted-46%20states-orange)](.github/ISSUE_TEMPLATE/data-source-request.md)

GeoDistricts creates fair, unbiased congressional districts using an automated algorithm that relies solely on geographic and demographic data from the U.S. Census Bureau. No human intervention, no political bias - just mathematics and geography.

## 🚀 Quick Start

```bash
git clone https://github.com/Lacoda-Labs/geodistricts.git
cd geodistricts && ./scripts/quick-start.sh
```

Visit [geodistricts.org](https://geodistricts.org) for live demos and interactive maps.

## 🧮 Algorithm Overview

GeoDistricts implements a hierarchical, geography-based algorithm that:

- **Population Equality**: Targets <1% variance between districts
- **Contiguity**: Maintains geographic continuity where possible
- **Objectivity**: Deterministic, automated process using census data only
- **Two-Phase Approach**: County-level grouping → Tract-level refinement

**Key Features:**
- Recursive geographic division (alternating latitude/longitude)
- Step-by-step visualization and debugging
- Population variance tracking
- Contiguity scoring

→ **[Complete Algorithm Specification](doc/pages/GeodistrictingAlgorithmSpecification.md)**

## 🏗️ Architecture & Tech Stack

**Frontend:** Angular 17+, TypeScript, SCSS, Interactive mapping with Leaflet  
**Backend:** Node.js, Express, Census API integration  
**Data:** U.S. Census Bureau TIGER/Line shapefiles, Population data via Census API  
**Infrastructure:** Google Cloud Run, Cloud Storage, Secret Manager  
**CI/CD:** GitHub Actions for automated testing and deployment

**Project Structure:**
```
├── frontend/         # Angular web client
├── backend/          # Node.js API server
├── doc/             # Comprehensive documentation
├── scripts/         # Setup and deployment utilities
└── data/            # Census data cache
```

→ **[Architecture Details](doc/pages/ARCHITECTURE_DETAILS.md)**

## 🚀 Development Setup

**Prerequisites:** Node.js 18+, Angular CLI, Docker (optional)

**Quick Setup:**
```bash
git clone https://github.com/Lacoda-Labs/geodistricts.git
cd geodistricts
./scripts/quick-start.sh  # Installs deps & starts dev servers
```

**Manual Setup:**
- Backend: `cd backend && npm install && npm run dev`
- Frontend: `cd frontend && npm install && ng serve`
- Census API: Run `./scripts/setup-api-keys.sh` for direct API access

→ **[Detailed Setup Guide](doc/pages/GITHUB_SETUP.md)**

## 📊 Data Sources

**Census Population Data:** Demographic statistics from U.S. Census Bureau APIs
→ **[Census Population Data Details](doc/pages/CENSUS_POPULATION_DATA.md)**

**TIGER/Line Shapefiles:** Geographic boundaries and spatial data
→ **[TIGER/Line Shapefiles Details](doc/pages/TIGER_LINE_SHAPEFILES.md)**

**State Election Data:** Voter registration and party affiliation statistics
→ **[State Election Data Details](doc/pages/STATE_ELECTION_DATA.md)**

**Current Status:** 5/50 states configured (AZ, CA, FL, NY, TX)  
**Priority Need:** Voter data sources for remaining 46 states

→ **[State Data Sources Status](doc/pages/STATE_DATA_SOURCES.md)** • **[Request Template](.github/ISSUE_TEMPLATE/data-source-request.md)**

## ☁️ Deployment

**Platforms:** Google Cloud Run, GitHub Pages  
**CI/CD:** Automated testing, building, and deployment via GitHub Actions  
**Domains:** Custom domain setup with SSL certificates

**Quick Deploy:**
```bash
./scripts/deploy.sh  # Full GCP deployment
```

→ **[GCP Setup Guide](doc/pages/GCP_SETUP.md)** • **[Domain Setup](doc/pages/DOMAIN_SETUP_GUIDE.md)**

## 🤝 Contributing

**Priority Areas:**
1. **Data Collection**: Find voter registration sources for remaining states
2. **Algorithm Enhancement**: Improve contiguity scoring, performance optimization
3. **UI/UX**: Better visualization, accessibility improvements
4. **Testing**: Unit tests, integration tests, algorithm validation

**Getting Started:**
1. Fork the repository
2. Create a feature branch
3. Make your changes following our [contributing guidelines](CONTRIBUTING.md)
4. Submit a pull request

→ **[Contributing Guide](CONTRIBUTING.md)** • **[Issue Templates](.github/ISSUE_TEMPLATE/)**

---

## 📄 License & Legal

**License:** MIT License - see [LICENSE](LICENSE) file for details

**Privacy & Terms:**
- [Privacy Policy](/privacy) - Data collection and usage
- [Terms of Service](/terms) - Service terms and conditions

---
