# state-tracts/

**State tract cache**: census tracts plus geometry and metadata for a state, used as the main input for the GeoDistricts algorithm (division, steps, union polygons).

## Path pattern

- `state-tracts/{STATE}.json` — one file per state (e.g. `CA.json`, `TX.json`).
- Cache key format: `state_tracts_{state}` (state = 2-letter uppercase code).

## Content

- JSON: array of `[id, tract]` pairs, where each tract includes properties (e.g. population, county, GEOID) and optionally geometry.
- Built from census data and boundary data; may include island/bridge tract metadata used by the algorithm.

## Usage

- Read at algorithm start for a state (e.g. run-all or next-step); written when a state’s tract cache is first built or refreshed.
- Large files (>1 MB) are stored here; Firestore holds metadata and a reference (`cloudStoragePath`) to this object.

## Notes

- Ensure tract objects include geometry when the cache is written if downstream steps (e.g. union polygons, map display) require it.
