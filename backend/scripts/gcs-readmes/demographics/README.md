# demographics/

Cached **census tract and county demographic data** (e.g. population, housing) keyed by cache key.

## Path pattern

- `demographics/{cacheKey}.json` — one file per cache key.
- Cache key format: `census_tract_data_*` (exact key varies by product/state/county).

## Content

- JSON: census API–style demographic data (tract or county level) used for population equality and algorithm inputs.

## Usage

- Filled when demographic data is requested and exceeds the Cloud Storage size threshold; read by the backend when serving census data to the app or algorithm.
