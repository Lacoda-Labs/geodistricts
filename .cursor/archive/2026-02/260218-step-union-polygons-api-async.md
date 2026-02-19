# 260218

## 2130 step union polygons API async and move-all-isolated trigger

### Prompt

[1] Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

[2] the POST should not block but return immediately, and the request should be handled as a job. change from synchronous implementation.

[3] backend step behaviour is not calling new POST endpoint which should be async.

[4] after POST to move isolated tracts, if the step is complete, then call the POST create union polygons endpoint to trigger the build job.

[5] not seeing a log message that confirms that POST to create union polygons was requested.

[6] /archive

### Response / actions

Plan: [.cursor/plans/step_union_polygons_api_5cdd306e.plan.md](.cursor/plans/step_union_polygons_api_5cdd306e.plan.md)

- **Backend**: Added `GET /api/algorithm/step/:state/:stepNumber/union-polygons` (200 with districtGroups or 404) and `POST /api/algorithm/step/:state/:stepNumber/union-polygons` (202 Accepted, background job via `runUnionPolygonGenerationJob` in setImmediate). Step 0 rejected on POST. `loadUnionPolygonsFromCache` used for GET; job reconstructs step, calls `recreateUnionPolygonsForGroups` and `cacheUnionPolygons`, updates step cache.
- **Backend step flows**: Next-step, run-all (onStepComplete), and move-all-isolated (cache path) no longer build union polygons inline; they save step with `unionPolygonsCached: false` and trigger the job (run-all/next-step via setImmediate(runUnionPolygonGenerationJob); move-all-isolated via axios POST to same union-polygons endpoint). `reconstructStepFromCache` no longer recreates missing unions inline.
- **Move-all-isolated**: When step is complete after save, fire-and-forget `axios.post(unionPolygonsUrl)` to trigger build job; added log before trigger and in POST handler so logs show "requesting POST .../union-polygons" and "Received: POST .../union-polygons".
- **Frontend**: Service `getStepUnionPolygons` (GET, returns null on 404) and `generateStepUnionPolygons` (POST, 15s timeout); maps page merges union payload after getStep, polls GET after POST (3s interval, 5 min timeout); "Generate union polygons" button in admin; default render is tracts with blended borders when unions missing; `mergeUnionPolygonsIntoStep` helper.

✅ **IMPLEMENTED**: Step union polygons are generated asynchronously; POST returns 202 and job runs in background; move-all-isolated (and next-step/run-all when step complete) trigger the build via POST; logs confirm POST create union polygons request.
