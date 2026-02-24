---
name: Maps party color and tooltip
overview: Fix the maps page so geodistricts are colored by party when "Color by party %" is on (using district-level party data), ensure district party data is loaded for the current state/step (including AZ), and show district party stats in a tooltip when hovering over the district row Party icon.
todos: []
isProject: false
---

# Maps Page: Party-Based District Colors and Party Tooltip

## Current behavior (why it’s wrong)

- **Union polygon path** (typical final step with boundaries hidden): In `[renderFinalDistricts()](frontend/src/app/pages/maps-page.component.ts)` the fill color is always `getDistrictColor(index)` (or state party for step 0). `showPartyColor` is **never** used for these union polygons.
- **Tract path**: When drawing tracts, party color is applied per-**tract** from `tractPartyByGeoid` (tract-level data), not per-district. So “Color by party %” only affects the tract view and uses tract-level data.
- **District-level party data**: The backend exposes `GET /api/algorithm/district-party/:state/:stepNumber` and returns `districts` (groupKey → `{ pctDem, pctRep, votesDem, votesRep, totalVotes }`). The frontend **never** calls this endpoint; it only has `districtPartyPercentagesCalculated` (boolean) and `perGroupStatus` (polygon/party status), so it cannot color by **district** party or show district party in a tooltip.

So: geodistrict **district** colors are not based on party because (1) union polygons ignore `showPartyColor`, and (2) district-level party data is not loaded on the frontend.

## AZ and party percentages

- Party percentages for **any** state (including AZ) are computed by the same backend flow: tract-party data (e.g. VEST) → `runDistrictPartyJob` or `district-party-for-group` → cache key `district_party_{state}_{finalStepNumber}_{maxIterations}`.
- The backend does not special-case AZ; once the district-party job has been run for AZ (or per-group calculation done), the cache is populated and `districtPartyPercentagesCalculated` is true for that state. No frontend/backend change is required for AZ specifically; the fix is to **use** the existing district-party API and cache on the maps page.

## Implementation plan

### 1. Frontend: fetch district-level party data

- **Service** (`[frontend/src/app/services/geodistrict-algorithm.service.ts](frontend/src/app/services/geodistrict-algorithm.service.ts)`):
  - Add `getDistrictParty(state: string, stepNumber: number, maxIterations?: number): Observable<{ state: string; step: number; maxIterations: number; districts: Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }> }>` calling `GET /api/algorithm/district-party/:state/:stepNumber?maxIterations=...`.
- **Maps page** (`[frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)`):
  - Add `districtPartyByGroupKey: Record<string, { pctDem: number; pctRep: number; votesDem: number; votesRep: number; totalVotes: number }> | null = null`.
  - When the final step is loaded and `districtPartyPercentagesCalculated === true` (in the same callback where `perGroupStatus` and `finalStepNumber` are set), call the new `getDistrictParty(selectedState, finalStepNumber, finalStepMaxIterations)` and assign the response `districts` to `districtPartyByGroupKey` (and clear it when state/step changes or when final step has no party data).
  - When the user toggles “Color by party %” **on**, if we don’t already have `districtPartyByGroupKey` for the current state/step but `districtPartyPercentagesCalculated` is true, fetch district party and then re-render.
  - After `refetchFinalStepForStatus` updates `districtPartyPercentagesCalculated`/`perGroupStatus`, if party is now calculated and we’re on the final step, fetch district party so the map and tooltip can use it.

### 2. Map: color geodistricts by district party when “Color by party %” is on

- In `**renderFinalDistricts()`** (`[frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)`):
  - For the **union polygon** branch (when `!showTractBoundaries` and union polygon(s) exist): when computing `baseColor` for each district, if `showPartyColor` and `districtPartyByGroupKey` is non-null, compute `groupKey =` ${district.startDistrictNumber}-${district.endDistrictNumber}`` and get `partyData = districtPartyByGroupKey[groupKey]`. If `partyData` exists, set `baseColor = this.getTractColorByParty(partyData.pctDem)` (reuse existing D/R color scale). Otherwise keep current logic (state party for step 0, else `getDistrictColor(index, ...)`).
  - For the **tract** branch: when assigning `tractColor`, the existing logic already uses tract-level party when `showPartyColor && tractPartyByGeoid`. Optionally, when **not** showing tract boundaries and we’re drawing tracts only because there are no union polygons yet, you could use district party for the district’s base color if `showPartyColor` and district party exist; that’s a minor consistency improvement and can be done in the same way (look up district party by groupKey and use `getTractColorByParty(partyData.pctDem)` for the base color passed into the tract loop).

Result: when “Color by party %” is on and district party data is loaded, each geodistrict (union polygon or district-level color) is shaded by that district’s party percentage; AZ behaves like any other state once its district-party cache is populated.

### 3. Tooltip on district row Party icon

- **Maps page**:
  - Add `getGroupPartyTooltip(group: DistrictGroup, status: PerGroupStatus | null): string`:
    - If `status?.party === 'done'` and `districtPartyByGroupKey` and `districtPartyByGroupKey[groupKey]` exist, return a short line with district party data, e.g. `D ${(pctDem*100).toFixed(1)}% · R ${(pctRep*100).toFixed(1)}% · ${totalVotes.toLocaleString()} votes`.
    - Otherwise keep current behavior: “Party % calculated”, “Click to calculate party %”, or status text.
- **Template** (`[frontend/src/app/pages/maps-page.component.html](frontend/src/app/pages/maps-page.component.html)`):
  - In the Party column (around line 337–345), change the tooltip from the current `[matTooltip]="st.party === 'done' ? 'Party % calculated' : ..."` to `[matTooltip]="getGroupPartyTooltip(group, st)"` so that when party is done and we have district data, the tooltip shows the actual percentages and vote count.

### 4. Edge cases and UX

- **Party data not loaded**: If the user turns “Color by party %” on before district party is calculated, keep existing behavior (e.g. partyDataUnavailableMessage for tract data). Once `districtPartyPercentagesCalculated` is true, fetching district party will enable both map colors and the detailed tooltip.
- **404 on GET district-party**: If the backend returns 404 (e.g. cache missing for that state/step), leave `districtPartyByGroupKey` null; map falls back to index colors and tooltip to “Party % calculated” without details.
- **Dev mode**: The Party column and tooltip are already behind `isDevMode`; no change needed for that.

## Files to change


| Area           | File                                                         | Changes                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service        | `frontend/src/app/services/geodistrict-algorithm.service.ts` | Add `getDistrictParty(state, stepNumber, maxIterations?)` calling GET district-party.                                                                                                                                                                                               |
| Maps page TS   | `frontend/src/app/pages/maps-page.component.ts`              | Add `districtPartyByGroupKey`; fetch it when final step loads (and when toggling party color / after refetch) when party is calculated; in `renderFinalDistricts` use district party for `baseColor` when showPartyColor and data exist; add `getGroupPartyTooltip(group, status)`. |
| Maps page HTML | `frontend/src/app/pages/maps-page.component.html`            | Party column: use `getGroupPartyTooltip(group, st)` for `matTooltip`.                                                                                                                                                                                                               |


## Verification

- **AZ**: Select AZ, run algorithm to completion, ensure district-party job has run (or trigger it). Turn “Color by party %” on: map should show district colors by party; hovering the Party icon on a district row should show D/R % and vote count in the tooltip.
- **Other states**: Same flow for any state with tract-party and district-party data (e.g. FL, VA) to confirm no regressions and that union-polygon view now respects party color.

