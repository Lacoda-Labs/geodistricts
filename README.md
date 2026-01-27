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

<details>
<summary><strong>🧮 Algorithm Overview</strong> - How GeoDistricts creates fair districts</summary>

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
</details>

<details>
<summary><strong>🏗️ Architecture & Tech Stack</strong> - System design and components</summary>

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

→ **[Architecture Details](doc/GeoDistrictsProjectOverview.md)**
</details>

<details>
<summary><strong>🚀 Development Setup</strong> - Get the project running locally</summary>

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
</details>

<details>
<summary><strong>📊 Data Sources</strong> - Census data and voter registration</summary>

**Census Data:** Population, geography from U.S. Census Bureau APIs
**Geographic Boundaries:** TIGER/Line shapefiles for tract/county boundaries
**Voter Registration:** Party affiliation data by precinct/county (help needed!)

**Current Status:** 5/50 states configured (AZ, CA, FL, NY, TX)
**Priority Need:** Voter data sources for remaining 46 states

→ **[State Data Sources](doc/pages/STATE_DATA_SOURCES.md)** • **[Request Template](.github/ISSUE_TEMPLATE/data-source-request.md)**
</details>

<details>
<summary><strong>☁️ Deployment</strong> - Cloud infrastructure and CI/CD</summary>

**Platforms:** Google Cloud Run, GitHub Pages
**CI/CD:** Automated testing, building, and deployment via GitHub Actions
**Domains:** Custom domain setup with SSL certificates

**Quick Deploy:**
```bash
./scripts/deploy.sh  # Full GCP deployment
```

→ **[GCP Setup Guide](doc/pages/GCP_SETUP.md)** • **[Domain Setup](doc/pages/DOMAIN_SETUP_GUIDE.md)**
</details>

<details>
<summary><strong>🤝 Contributing</strong> - How developers can help</summary>

**Priority Areas:**
1. **Data Collection**: Find voter registration sources for remaining states
2. **Algorithm Enhancement**: Improve contiguity scoring, performance optimization
3. **UI/UX**: Better visualization, accessibility improvements
4. **Testing**: Unit tests, integration tests, algorithm validation

**Getting Started:**
1. Fork the repository
2. Create a feature branch
3. Make changes following our [contributing guidelines](CONTRIBUTING.md)
4. Submit a pull request

→ **[Contributing Guide](CONTRIBUTING.md)** • **[Issue Templates](.github/ISSUE_TEMPLATE/)**
</details>

<details>
<summary><strong>📚 Documentation</strong> - Complete project documentation</summary>

**Core Documentation:**
- **[Project Overview](doc/GeoDistrictsProjectOverview.md)** - Complete solution brief and architecture
- **[Algorithm Specification](doc/pages/GeodistrictingAlgorithmSpecification.md)** - Detailed algorithm design
- **[Implementation Guide](doc/pages/IMPLEMENTATION_VERIFICATION.md)** - Verification procedures

**Setup & Deployment:**
- **[GCP Setup](doc/pages/GCP_SETUP.md)** - Cloud infrastructure configuration
- **[API Integration](doc/pages/CENSUS_SERVICE_README.md)** - Census data integration
- **[Domain Setup](doc/pages/DOMAIN_SETUP_GUIDE.md)** - Custom domain configuration

**Development:**
- **[Contributing Guidelines](CONTRIBUTING.md)** - How to contribute code
- **[Caching Design](doc/pages/CACHING_DESIGN.md)** - Performance optimization
- **[UI Components](doc/pages/DIVISION_BOXES_COMPONENT.md)** - Frontend component docs

**Campaign & Outreach:**
- **[Campaign Assets](doc/pages/CAMPAIGN_DESIGN_ASSETS.md)** - Marketing materials
- **[Social Media Guide](doc/pages/SOCIAL_MEDIA_LAUNCH_GUIDE.md)** - Launch strategy
</details>

---

## 📄 License & Legal

**License:** MIT License - see [LICENSE](LICENSE) file for details

**Privacy & Terms:**
- [Privacy Policy](/privacy) - Data collection and usage
- [Terms of Service](/terms) - Service terms and conditions

---

## 🆘 Priority: Voter Data Collection

**Critical Need:** Voter registration data for 46 remaining states to enable party balance calculations.

**Impact:** Without complete voter data, we cannot demonstrate how GeoDistricts preserves political balance while eliminating gerrymandering.

**How to Help:**
1. Research your state's election office for voter registration statistics
2. Submit data source details via our [request template](.github/ISSUE_TEMPLATE/data-source-request.md)
3. Contributors recognized in documentation and social media (with permission)

**Current Progress:** 5/50 states complete (10%) - AZ, CA, FL, NY, TX configured

→ **[Data Sources Status](doc/pages/STATE_DATA_SOURCES.md)** • **[Voter Data Plan](doc/pages/VOTER_REGISTRATION_DATA_PLAN.md)**