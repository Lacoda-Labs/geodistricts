# Architecture Details

## Overview

GeoDistricts is a modern web application built with a microservices architecture, designed for scalability, maintainability, and developer experience. The application consists of a TypeScript/Angular frontend and a Node.js/Express backend, deployed on Google Cloud Platform.

## System Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │     Backend     │    │   Data Sources  │
│   (Angular)     │◄──►│   (Node.js)     │◄──►│   (Census API)  │
│                 │    │                 │    │                 │
│ - Interactive   │    │ - REST API      │    │ - Population     │
│   Maps          │    │ - Algorithm     │    │ - Geography      │
│ - UI Components │    │   Execution     │    │ - Boundaries     │
│ - State Mgmt    │    │ - Data Caching  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │ Infrastructure  │
                       │ (Google Cloud)  │
                       │                 │
                       │ - Cloud Run     │
                       │ - Cloud Storage │
                       │ - Secret Manager│
                       │ - CDN           │
                       └─────────────────┘
```

## Frontend Architecture

### Technology Stack
- **Framework**: Angular 17+ with standalone components
- **Language**: TypeScript 5.0+
- **Styling**: SCSS with Angular Material design system
- **Mapping**: Leaflet with custom plugins for geographic visualization
- **State Management**: RxJS Observables and Angular services
- **Build Tool**: Angular CLI with custom webpack configuration

### Component Architecture

```
src/app/
├── core/              # Core services and utilities
│   ├── services/      # API services, state management
│   ├── guards/        # Route guards
│   └── interceptors/  # HTTP interceptors
├── shared/            # Shared components and utilities
│   ├── components/    # Reusable UI components
│   ├── directives/    # Custom directives
│   └── pipes/         # Custom pipes
├── features/          # Feature modules
│   ├── maps/          # Interactive mapping feature
│   ├── geodistrict/   # Algorithm visualization
│   └── admin/         # Administrative features
└── layouts/           # Application layouts
```

### Key Components

#### Maps Component
- Interactive Leaflet-based map visualization
- Real-time algorithm execution display
- Geographic boundary rendering
- Population density overlays

#### Geodistrict Algorithm Component
- Step-by-step algorithm visualization
- Interactive controls for algorithm parameters
- Progress tracking and result display
- Export functionality for generated districts

#### Admin Interface
- State selection and configuration
- Algorithm parameter tuning
- Data source management
- Performance monitoring

## Backend Architecture

### Technology Stack
- **Runtime**: Node.js 18+ LTS
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with spatial extensions (PostGIS)
- **Caching**: Redis for algorithm results and census data
- **API Documentation**: OpenAPI/Swagger
- **Testing**: Jest with Supertest for API testing

### API Architecture

```
Backend API Structure:
├── /api/v1/
│   ├── /states           # State management endpoints
│   ├── /census           # Census data endpoints
│   ├── /algorithm        # Algorithm execution endpoints
│   ├── /districts        # Generated districts endpoints
│   └── /health           # Health check endpoints
├── Middleware
│   ├── Authentication    # JWT-based auth
│   ├── Caching           # Redis caching layer
│   ├── Validation        # Request validation
│   └── Error Handling    # Centralized error handling
└── Services
    ├── Census Service    # Census API integration
    ├── Algorithm Service # Core algorithm logic
    ├── PoliGeo Analyst  # Estimated party impact from VEST, comparison to current representation
    ├── Cache Service     # Caching abstraction
    └── Storage Service   # Cloud storage abstraction
```

### Core Services

#### Census Service
- Integration with U.S. Census Bureau APIs
- TIGER/Line shapefile processing
- Population data retrieval and caching
- Geographic boundary management

#### Algorithm Service
- Hierarchical geographic division algorithm
- Population balancing logic
- Contiguity validation
- Performance optimization

#### PoliGeo Analyst
- Estimated party impact from VEST election data and comparison to current US House representation. See [PoliGeo Analyst](POLIGEO_ANALYST.md).

#### Cache Service
- Redis-based caching for census data
- Algorithm result caching
- TTL-based cache invalidation
- Cache warming strategies

## Data Architecture

### Data Sources

#### Primary Data Sources
- **Census Population Data**: Annual population estimates by census tract
- **TIGER/Line Shapefiles**: Geographic boundaries for census tracts and counties
- **State Election Data**: Voter registration statistics (in development)

#### Data Processing Pipeline

```
Raw Data → Validation → Processing → Storage → API
    ↓         ↓           ↓         ↓       ↓
 Census   Data Quality  Geographic  PostgreSQL  REST API
  APIs    Checks       Transformation + PostGIS
```

### Database Schema

#### Core Tables
- `states`: State metadata and configuration
- `counties`: County geographic and demographic data
- `tracts`: Census tract boundaries and population
- `districts`: Generated congressional districts
- `algorithm_runs`: Algorithm execution history

#### Spatial Features
- PostGIS for geographic operations
- Spatial indexes for performance
- Geographic coordinate transformations
- Boundary intersection calculations

## Infrastructure Architecture

### Google Cloud Platform

#### Compute
- **Cloud Run**: Serverless containers for API and background processing
- **App Engine**: Frontend hosting with CDN
- **Cloud Functions**: Event-driven processing (future)

#### Storage
- **Cloud Storage**: Census data and shapefile storage
- **Cloud SQL**: PostgreSQL database with PostGIS
- **Memorystore**: Redis caching layer

#### Security
- **Secret Manager**: API keys and credentials
- **Identity-Aware Proxy**: Access control
- **VPC**: Network isolation

### Deployment Pipeline

```
GitHub → Cloud Build → Container Registry → Cloud Run
   ↓         ↓              ↓               ↓
Source   Build & Test    Store Images    Deploy API
```

#### CI/CD Features
- Automated testing on pull requests
- Multi-stage builds for different environments
- Blue-green deployments
- Rollback capabilities

## Performance & Scalability

### Caching Strategy
- Multi-layer caching (Redis + CDN)
- Intelligent cache invalidation
- Background cache warming
- Compression and optimization

### Algorithm Optimization
- County-level preprocessing to reduce complexity
- Parallel processing for large states
- Memory-efficient geographic operations
- Result caching for repeated queries

### Monitoring & Observability
- Cloud Logging for centralized logging
- Cloud Monitoring for metrics and alerting
- Custom dashboards for algorithm performance
- Error tracking and debugging tools

## Security Considerations

### Data Security
- Encryption at rest and in transit
- Secure API key management
- Input validation and sanitization
- Rate limiting and abuse prevention

### Application Security
- HTTPS everywhere
- Content Security Policy (CSP)
- Cross-Origin Resource Sharing (CORS) configuration
- Regular security updates and patches

## Development Workflow

### Local Development
- Docker Compose for local services
- Hot reloading for frontend development
- Local database with sample data
- Integrated testing environment

### Code Quality
- TypeScript strict mode
- ESLint and Prettier for code formatting
- Unit and integration tests
- Code coverage requirements

### Collaboration
- GitHub Issues and Projects for task management
- Pull request reviews and approvals
- Automated code quality checks
- Documentation requirements

## Future Architecture Considerations

### Planned Enhancements
- Microservices decomposition for better scalability
- GraphQL API for more flexible data fetching
- Real-time algorithm progress updates
- Advanced geographic analysis features

### Technology Evolution
- Migration to newer Angular versions
- Evaluation of alternative cloud providers
- Adoption of newer Node.js features
- Performance optimization opportunities