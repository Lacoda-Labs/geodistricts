# boundaries/

Census tract **boundary** GeoJSON by state. Used for map rendering and algorithm geometry.

## Path pattern

- `boundaries/{STATE}.json` — one file per state (e.g. `AZ.json`, `CA.json`).
- Cache key format: `census_tract_boundaries_{state}` (state = 2-letter code).

## Content

- GeoJSON (FeatureCollection or equivalent) of census tract polygons for the state.
- Source: TIGER/Line shapefiles (e.g. via TIGERweb or Census shapefile services).
- Files are often large (>1 MB), so they are stored in Cloud Storage instead of Firestore.

## Usage

- Loaded by the backend when serving tract geometry for a state (e.g. for maps or algorithm input).
- Written when boundaries are first fetched and exceed the Cloud Storage size threshold.
