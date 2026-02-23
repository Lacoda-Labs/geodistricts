# voter-registration/

Cached **state-level voter registration** statistics (e.g. by party, county).

## Path pattern

- `voter-registration/{STATE}.json` — one file per state (e.g. `AZ.json`).
- Cache key format: `voter_registration_{state}` (state = 2-letter uppercase code).

## Content

- JSON: aggregated voter registration data for the state. Source and schema depend on the state (e.g. secretary of state CSV or state API); see `backend/services/voter-registration-loader.js` and related backend code for parsing and structure.

## Usage

- Written by the voter registration loader when state data is fetched and is large enough for Cloud Storage; read when the app or API requests voter registration for a state.
