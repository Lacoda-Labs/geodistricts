# congressional-boundaries/

**Current or precedent congressional district boundaries** (Lewis boundaries) by Congress and state. Used for comparison and reference maps (e.g. existing districts vs geodistricts).

## Path pattern

- `congressional-boundaries/{CONGRESS}/{stateName}.json`
  - `{CONGRESS}` = Congress number (e.g. `119`).
  - `{stateName}` = state name as in the key (e.g. `Alabama`, `New_York`).
- Cache key format: `congressional_boundaries_{congress}_{stateName}`.

## Content

- GeoJSON: district boundaries for that state and Congress. Ingested from an external source (e.g. Lewis boundary data); see `backend/scripts/ingest-lewis-boundaries.js`.

## Usage

- Ingest script fetches boundaries and uploads one file per state per Congress to this prefix. The backend and frontend read these for comparison views and overlay layers.
