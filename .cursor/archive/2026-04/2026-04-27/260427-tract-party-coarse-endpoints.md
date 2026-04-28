# 260427

## 2310 archive — tract party server-owned flow

### Prompt

/archive

### Response / actions

Archives a session on **coarse-grained, server-owned** tract/district party behavior (per prior user request: no client-driven tract-party polling; one server path to rebuild county VEST → tract; small D/R district payload for UI).

Plan (context, not edited in session): [.cursor/plans/percent-only-tract-party-rebuild_9602b6bb.plan.md](.cursor/plans/percent-only-tract-party-rebuild_9602b6bb.plan.md)

✅ **IMPLEMENTED** (backend `index.js`):

- `ensureTractPartyCacheForState`, `districtPartyForApiClient`, `mapDistrictsForApiClient` after `DEFAULT_VEST_YEAR`.
- `POST /api/algorithm/clear-cache`: after delete, `await ensureTractPartyCacheForState` with `apiBaseUrl` from request; response includes `tractPartyRebuild`.
- `GET /api/algorithm/district-party/...`: ensure tract party first; 503 on failure; response `districts` mapped to **pctDem / pctRep only** (two-party normalized).
- `runDistrictPartyJob`: optional `{ apiBaseUrl }`, ensure before work, persist API-shaped district rows.
- `POST /api/algorithm/district-party` and `POST .../district-party-for-group`: ensure + same client contract.
- `reconstructStepFromCache(..., apiBaseUrl)` and `enrichStepTractsWithParty(..., apiBaseUrl)`; call sites pass `req` base URL or `null` for background jobs.
- Step 0 inline party enrich: `ensureTractPartyCacheForState` before `loadTractPartyForState`.

✅ **IMPLEMENTED** (frontend): `forceRefreshAndReset` no longer chains `triggerTractPartyPersistence` + `waitUntilTractPartyReady`; uses `tractPartyRebuild` from clear-cache. `getDistrictParty` / `triggerDistrictPartyJob` replace heal/ensure chains; deprecated wrappers delegate.

**Validation:** `node --check backend/index.js`, `tsc -p tsconfig.app.json` (pass).

**Follow-up from logs (CT):** `runTractPartyPersistenceJob` can log `tract_party rebuild failed for CT: VEST tract-level data not available for this year` even after `County→tract allocation: CT 884 tracts` — **persistence/return path** in `tract-party-persistence.js` / `vest-data-loader` may not be writing or returning `vestData.data` for the state filter; **S4 adjacency** shows `09`… tract IDs vs `09003`… graph keys (separate ID/adjacency issue). All-states `forkJoin` map-polygons + district-party fan-out not changed in this pass.

To publish archive to site: `./scripts/sync-archive-to-docs.sh` and commit `docs/archive/`.
