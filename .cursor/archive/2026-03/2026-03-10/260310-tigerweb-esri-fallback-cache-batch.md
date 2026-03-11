# 260310

## 2332 TIGERweb alternatives, Esri fallback, local cache, batch size

### Prompt

(Session included multiple prompts: look through docs on fetching TigerWeb data for alternative endpoints; whether recent changes consider data on local filesystem / why fetch from Esri if we have it local; where's the fallback when TIGERweb times out; configure resultRecordCount to reduce payload and avoid timeouts.)

### Response / actions

- **Doc and Esri fallback:** Added `doc/pages/TIGERWEB_ALTERNATIVES.md` (primary TIGERweb, Esri USA Census Tracts fallback, tigerWMS_Current, TIGER/Line shapefiles). In `backend/index.js`: `TIGERWEB_TRACT_LAYER_FALLBACK` (Esri), `getTractCount` and `fetchTractBoundariesForState` try TIGERweb first, then on network/5xx retry with Esri; Esri uses STATEFP/COUNTYFP where clause and `normalizeTractFeatureFromEsri`. Linked from `doc/GeoDistrictsProjectOverview.md`.
- **Local cache (state_tracts) first:** Step-by-step already calls `loadTractsFromStateTractCache(state)` before any external fetch. Fixed `loadTractsFromStateTractCache` to accept **raw-array** format: when USE_LOCAL_CACHE we write `state_tracts_*` as raw array via `setCacheDoc(key, finalTractMap)`; the loader expected a metadata wrapper with `algorithmVersion`/`data` and rejected the array. Now if `getCacheDoc` returns an array with length > 0 we use it as tractMap (no version/ttl check); otherwise keep metadata path. Log when using local file cache.
- **Fallback not running:** Axios reports timeout as `code: 'ECONNABORTED'`, not `ETIMEDOUT`. Added `ECONNABORTED` to the `isNetwork` check in both `getTractCount` and `fetchTractBoundariesForState` so Esri fallback runs when TIGERweb times out.
- **Configurable batch size:** Added `TIGERWEB_TRACT_BATCH_SIZE` (default 200, env override). Used for `resultRecordCount` in `fetchTractBoundariesForState` and `handleStreamingResponse`. Smaller batches reduce payload per request to help avoid timeouts. Documented in TIGERWEB_ALTERNATIVES.md.
- ✅ **FIXED:** TIGERweb alternatives doc and Esri fallback in place; local census-cache (raw array) used when present; ECONNABORTED triggers fallback; batch size configurable via `TIGERWEB_TRACT_BATCH_SIZE`.
