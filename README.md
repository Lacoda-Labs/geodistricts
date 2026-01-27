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

<p>GeoDistricts implements a hierarchical, geography-based algorithm that:</p>
<ul>
<li><strong>Population Equality</strong>: Targets &lt;1% variance between districts</li>
<li><strong>Contiguity</strong>: Maintains geographic continuity where possible</li>
<li><strong>Objectivity</strong>: Deterministic, automated process using census data only</li>
<li><strong>Two-Phase Approach</strong>: County-level grouping → Tract-level refinement</li>
</ul>

<p><strong>Key Features:</strong></p>
<ul>
<li>Recursive geographic division (alternating latitude/longitude)</li>
<li>Step-by-step visualization and debugging</li>
<li>Population variance tracking</li>
<li>Contiguity scoring</li>
</ul>

<p>→ <a href="doc/pages/GeodistrictingAlgorithmSpecification.md"><strong>Complete Algorithm Specification</strong></a></p>
</details>

<details>
<summary><strong>🏗️ Architecture & Tech Stack</strong> - System design and components</summary>

<p><strong>Frontend:</strong> Angular 17+, TypeScript, SCSS, Interactive mapping with Leaflet<br>
<strong>Backend:</strong> Node.js, Express, Census API integration<br>
<strong>Data:</strong> U.S. Census Bureau TIGER/Line shapefiles, Population data via Census API<br>
<strong>Infrastructure:</strong> Google Cloud Run, Cloud Storage, Secret Manager<br>
<strong>CI/CD:</strong> GitHub Actions for automated testing and deployment</p>

<p><strong>Project Structure:</strong></p>
<pre><code>├── frontend/         # Angular web client
├── backend/          # Node.js API server
├── doc/             # Comprehensive documentation
├── scripts/         # Setup and deployment utilities
└── data/            # Census data cache</code></pre>

<p>→ <a href="doc/GeoDistrictsProjectOverview.md"><strong>Architecture Details</strong></a></p>
</details>

<details>
<summary><strong>🚀 Development Setup</strong> - Get the project running locally</summary>

<p><strong>Prerequisites:</strong> Node.js 18+, Angular CLI, Docker (optional)</p>

<p><strong>Quick Setup:</strong></p>
<pre><code>git clone https://github.com/Lacoda-Labs/geodistricts.git
cd geodistricts
./scripts/quick-start.sh  # Installs deps & starts dev servers</code></pre>

<p><strong>Manual Setup:</strong></p>
<ul>
<li>Backend: <code>cd backend && npm install && npm run dev</code></li>
<li>Frontend: <code>cd frontend && npm install && ng serve</code></li>
<li>Census API: Run <code>./scripts/setup-api-keys.sh</code> for direct API access</li>
</ul>

<p>→ <a href="doc/pages/GITHUB_SETUP.md"><strong>Detailed Setup Guide</strong></a></p>
</details>

<details>
<summary><strong>📊 Data Sources</strong> - Census data and voter registration</summary>

<p><strong>Census Data:</strong> Population, geography from U.S. Census Bureau APIs<br>
<strong>Geographic Boundaries:</strong> TIGER/Line shapefiles for tract/county boundaries<br>
<strong>Voter Registration:</strong> Party affiliation data by precinct/county (help needed!)</p>

<p><strong>Current Status:</strong> 5/50 states configured (AZ, CA, FL, NY, TX)<br>
<strong>Priority Need:</strong> Voter data sources for remaining 46 states</p>

<p>→ <a href="doc/pages/STATE_DATA_SOURCES.md"><strong>State Data Sources</strong></a> • <a href=".github/ISSUE_TEMPLATE/data-source-request.md"><strong>Request Template</strong></a></p>
</details>

<details>
<summary><strong>☁️ Deployment</strong> - Cloud infrastructure and CI/CD</summary>

<p><strong>Platforms:</strong> Google Cloud Run, GitHub Pages<br>
<strong>CI/CD:</strong> Automated testing, building, and deployment via GitHub Actions<br>
<strong>Domains:</strong> Custom domain setup with SSL certificates</p>

<p><strong>Quick Deploy:</strong></p>
<pre><code>./scripts/deploy.sh  # Full GCP deployment</code></pre>

<p>→ <a href="doc/pages/GCP_SETUP.md"><strong>GCP Setup Guide</strong></a> • <a href="doc/pages/DOMAIN_SETUP_GUIDE.md"><strong>Domain Setup</strong></a></p>
</details>

<details>
<summary><strong>🤝 Contributing</strong> - How developers can help</summary>

<p><strong>Priority Areas:</strong></p>
<ol>
<li><strong>Data Collection</strong>: Find voter registration sources for remaining states</li>
<li><strong>Algorithm Enhancement</strong>: Improve contiguity scoring, performance optimization</li>
<li><strong>UI/UX</strong>: Better visualization, accessibility improvements</li>
<li><strong>Testing</strong>: Unit tests, integration tests, algorithm validation</li>
</ol>

<p><strong>Getting Started:</strong></p>
<ol>
<li>Fork the repository</li>
<li>Create a feature branch</li>
<li>Make your changes following our <a href="CONTRIBUTING.md">contributing guidelines</a></li>
<li>Submit a pull request</li>
</ol>

<p>→ <a href="CONTRIBUTING.md"><strong>Contributing Guide</strong></a> • <a href=".github/ISSUE_TEMPLATE/"><strong>Issue Templates</strong></a></p>
</details>

<details>
<summary><strong>📚 Documentation</strong> - Complete project documentation</summary>

<p><strong>Core Documentation:</strong></p>
<ul>
<li><a href="doc/GeoDistrictsProjectOverview.md"><strong>Project Overview</strong></a> - Complete solution brief and architecture</li>
<li><a href="doc/pages/GeodistrictingAlgorithmSpecification.md"><strong>Algorithm Specification</strong></a> - Detailed algorithm design</li>
<li><a href="doc/pages/IMPLEMENTATION_VERIFICATION.md"><strong>Implementation Guide</strong></a> - Verification procedures</li>
</ul>

<p><strong>Setup & Deployment:</strong></p>
<ul>
<li><a href="doc/pages/GCP_SETUP.md"><strong>GCP Setup</strong></a> - Cloud infrastructure configuration</li>
<li><a href="doc/pages/CENSUS_SERVICE_README.md"><strong>API Integration</strong></a> - Census data integration</li>
<li><a href="doc/pages/DOMAIN_SETUP_GUIDE.md"><strong>Domain Setup</strong></a> - Custom domain configuration</li>
</ul>

<p><strong>Development:</strong></p>
<ul>
<li><a href="CONTRIBUTING.md"><strong>Contributing Guidelines</strong></a> - How to contribute code</li>
<li><a href="doc/pages/CACHING_DESIGN.md"><strong>Caching Design</strong></a> - Performance optimization</li>
<li><a href="doc/pages/DIVISION_BOXES_COMPONENT.md"><strong>UI Components</strong></a> - Frontend component docs</li>
</ul>

<p><strong>Campaign & Outreach:</strong></p>
<ul>
<li><a href="doc/pages/CAMPAIGN_DESIGN_ASSETS.md"><strong>Campaign Assets</strong></a> - Marketing materials</li>
<li><a href="doc/pages/SOCIAL_MEDIA_LAUNCH_GUIDE.md"><strong>Social Media Guide</strong></a> - Launch strategy</li>
</ul>
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