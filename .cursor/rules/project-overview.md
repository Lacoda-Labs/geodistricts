# GeoDistricts Project Overview

## Project Description
GeoDistricts is an algorithmic protocol for U.S. Congressional redistricting that eliminates gerrymandering by using objective, geography-based district creation.

## Project Structure
- `frontend/` - Angular application
- `backend/` - Node.js/Express API
- `doc/` - Project documentation
- `doc/pages/` - Detailed documentation files
- `data/` - Census data and cache files
- `.cursor/commands/` - Cursor command definitions
- `.cursor/rules/` - Cursor project rules

## Technology Stack
- **Frontend**: TypeScript, Angular, SCSS
- **Backend**: Node.js, Express
- **Data**: Census API, TIGER/Line shapefiles
- **Infrastructure**: Google Cloud Platform

## When Making Changes
- Follow existing code patterns and architecture
- Update relevant documentation if changing algorithm behavior
- Maintain backward compatibility when possible
- Test with multiple states (especially large ones like CA, TX, FL)
- Consider edge cases (single-district states, island tracts, etc.)
