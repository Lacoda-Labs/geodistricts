# 260213

## 1300 move isolated tracts fast path

### Prompt

Moving isolated tracts should be super fast; it is just swapping tracts in the DG. (Later: implement fast path so backend skips cache I/O when frontend sends full step data.)

### Response / actions

✅ **IMPLEMENTED**: Fast path for move-all-isolated-tracts.

- **Backend** (`backend/index.js`): When request includes `districtGroups` (with `censusTracts`), `divisionLines`, and `isolatedTractsData` with at least one group, handler runs in-memory only: build `allTracts` from body, run move loop + `detectIsolatedTracts`, return `districtGroups` and `isolationResult`. No Firestore/cache reads or writes, no union polygon work.
- **Frontend service** (`geodistrict-algorithm.service.ts`): `moveAllIsolatedTractsFromStep` accepts optional 5th/6th args `districtGroups` and `divisionLines` and sends them in the POST body.
- **Maps page** (`maps-page.component.ts`): Passes `currentStep.districtGroups` and `currentStep.divisionLines` into the move call so the backend uses the fast path when the step is already loaded.

Cache path still used when body does not include full district groups (e.g. no step in memory).
