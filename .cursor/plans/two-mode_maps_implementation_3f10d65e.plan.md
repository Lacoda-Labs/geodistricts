---
name: Two-Mode Maps Implementation
overview: "Implement the two-mode architecture: make /maps a GET-only visualization page when precomputed data exists, add /dev/maps with current algorithm-run behavior (Option A), and remove #admin-specific logic from the maps page. Option B (full client-side algorithm) is deferred."
todos: []
isProject: false
---

# Two-Mode Architecture Implementation (Option B Deferred)

## Scope

- **In scope**: Formalize visualization on `/maps`, add `/dev/maps` with backend execution (Option A), backend enhancements (optional polygonsOnly, step-list), docs. Remove `#admin`-based logic from the maps page.
- **Deferred**: Option B (port algorithm to TypeScript / shared package, full client-side execution).

## Current Admin Mode (to be removed from /maps)

The maps page currently supports an **admin mode** when the URL hash is `#admin`:

- **[frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)**: `isAdminMode` is set from `window.location.hash === '#admin'` in `ngOnInit` and updated on `hashchange`.
- **[frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)**: Step bar gets `[variant]="isAdminMode ? 'admin' : 'public'"`.
- **[frontend/src/app/components/step-btn-bar.component.html](frontend/src/app/components/step-btn-bar.component.html)**: When `variant === 'admin'`, the bar shows **Restart** and **Clear cache** buttons; when `public`, those are hidden.

**Answer: Yes — the plan removes admin-specific logic from the current maps page.**  
`/maps` will become visualization-only (no run/execute, no restart, no clear-cache). All of that moves to `/dev/maps`. So we remove `isAdminMode`, the `#admin` hash check and `hashchange` listener, and always use the public step bar on `/maps` (no Restart/Clear cache). The “admin” experience is achieved by going to `/dev/maps`, not by `#admin` on `/maps`.

---

## 1. Maps Page: Visualization-Only Behavior

**File**: [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (and template as needed)

- **On state load**: Call `GET final-step` (or use existing `map-polygons` / final-step flow). If final step exists for that state:
  - Set a **visualization-only** flag for that state (e.g. `visualizationOnlyForState` or a single `isVisualizationOnly` when viewing a state with precomputed data).
  - **Step-through**: Use only `getStep(state, stepNumber)` (GET); do **not** call `executeNextStep` (POST) when the user moves to a step that is not yet in `loadedSteps`. In visualization mode, either preload step list and allow only navigation to already-fetched steps, or fetch steps on demand via GET only (e.g. `GET step/:state/:stepNumber`).
- **UI**: When visualization-only:
  - Hide or disable any “Run All Steps” / “Execute next step” entry points (today, “next” in the step bar can trigger `executeNextStep` when the step is missing; in viz mode that path must be disabled and only GET used).
  - Step scrubber (first/prev/play/next/last) remains; behavior is “navigate among steps already available from GET” (and optionally load more steps via GET only).
- **Remove admin logic**:
  - Remove `isAdminMode`, the `#admin` check in `ngOnInit`, and the `hashchange` listener.
  - In the template, stop passing `isAdminMode` into the step bar; use the public variant only (e.g. always `variant="public"` for the maps page so Restart and Clear cache are never shown on `/maps`).

Result: `/maps` is a thin visualization client (GET-only when data exists), with no `#admin` and no admin-only buttons.

---

## 2. New Route and Page: `/dev/maps`

- **Route**: In [frontend/src/app/app.routes.ts](frontend/src/app/app.routes.ts), add a route, e.g. `{ path: 'dev/maps', component: DevMapsPageComponent }` (or reuse a wrapper that loads the same underlying logic with “dev” behavior).
- **Component**: Introduce a **DevMapsPageComponent** that hosts the current “run algorithm” behavior:
  - Same or shared UI as the current state view (map, step slider, district groups, isolation/bridge/balance panels, step 0 tools).
  - Uses the same backend: `execute`, `execute/step-by-step`, `execute/next-step`, `latlong/divide`, isolation/bridge/balance endpoints, and optional step write.
  - **Option A (recommended)**: No algorithm port; dev page calls existing backend APIs. Backend can be run locally for dev. Option B (full client-side algorithm) is deferred.
- **Step bar on dev**: On `/dev/maps`, the step bar should show **admin** variant (Restart, Clear cache) and allow triggering run-all and execute-next-step where applicable. This can be done by always passing `variant="admin"` (or a “dev” variant that behaves like admin) from the dev page.
- **Reuse**: Prefer reusing existing services ([frontend/src/app/services/geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts), cache, census/TIGER/S4) and as much of the current maps state-view as possible (e.g. shared child component or the same component with an input like `mode: 'visualization' | 'development'`), to avoid duplication. The main split is: **maps page** = visualization-only + no admin UI; **dev/maps page** = full run controls + admin step bar.

---

## 3. Backend (Optional but Recommended)

- **GET step with union-only option**: Add optional query (e.g. `polygonsOnly=true`) to `GET /api/algorithm/step/:state/:stepNumber` so visualization clients can request step state with union geometries only (no tract-level geometries) for lighter step-through on mobile. Document for visualization clients.
- **Step list**: Optional `GET /api/algorithm/step-list/:state` returning e.g. `{ stepIndices: number[], finalStepNumber: number }` so the client can build the step scrubber without fetching each step until one is selected.
- **Production**: Consider disabling or rate-limiting POST `execute`, `execute/step-by-step`, `execute/next-step`, and `latlong/divide` in production (GCP); keep all GET and data endpoints for both modes. Dev uses local backend.

---

## 4. Documentation

- Update [doc/GeoDistrictsProjectOverview.md](doc/GeoDistrictsProjectOverview.md) (and any architecture docs) to describe:
  - **Visualization mode**: entry point `/maps`; GET-only when precomputed data exists; no `#admin`; no run/execute on the page.
  - **Development mode**: entry point `/dev/maps`; full run controls and backend execution (Option A); Option B (client-side algorithm) deferred.

---

## 5. Summary: Admin Logic


| Location    | Current                                                          | After implementation                                                            |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/maps`     | `#admin` shows Restart + Clear cache; next-step can trigger POST | No `#admin`; always public step bar; step-through via GET only when data exists |
| `/dev/maps` | N/A                                                              | New page; admin step bar + run/execute; same backend (Option A)                 |


So **yes**: building this plan removes admin-specific logic from the current maps page and replaces it with a dedicated `/dev/maps` route for development.