# tract-party/

**Tract-level party registration** (or partisan data) by state and year. Used for partisan balance metrics and comparison.

## Path pattern

- `tract-party/{STATE}/{YEAR}.json` — one file per state and year (e.g. `CA/2024.json`).
- Cache key format: `tract_party_{state}_{year}` (state = 2-letter code, year = 4-digit).

## Content

- JSON: tract-level party or partisan breakdown (e.g. registration or vote share by party). Schema depends on the data source and backend processing.

## Usage

- Written when tract-party data is fetched/computed and exceeds the Cloud Storage threshold; read by the backend when the app or API requests partisan/tract-party data for a state and year.
