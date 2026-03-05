---
name: Union polygon properties cleanup
overview: Use only district-level metadata on union polygon GeoJSON features (DISTRICT_START, DISTRICT_END, TOTAL_POPULATION, TRACT_COUNT) and remove single-tract property spread so cached union polygons do not carry one-tract metadata.
todos: []
isProject: false
---

# Union polygon properties cleanup

## Findings

**Frontend does not use union polygon feature properties for the map or popup.**

- In [frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts) (lines 3884-3908), the popup is built from the **district group**: `district.totalPopulation`, `district.censusTracts.length`, `district.startDistrictNumber` / `district.endDistrictNumber`, and `districtPartyByGroupKey`. The union polygon is used only for **geometry**; the same `popupContent` is bound to each layer. Feature `properties` are passed through to `L.geoJSON(feature, ...)` but never read for display.
- [us-congressional-map.component.ts](frontend/src/app/components/us-congressional-map.component.ts) uses group-level data (e.g. `groupKey` from the district group) for fill and features only for geometry. No reads of union feature `.properties`.

**Backend currently spreads the first tract’s full properties onto every union feature.**

In [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) union features are built with:

- `...group.censusTracts[0].properties` or `...tracts[0].properties` (tract name, GEOID, COUNTY_FIPS, STATE_FIPS, population of one tract, etc.)
- Plus district fields: `DISTRICT_START`, `DISTRICT_END`, `TOTAL_POPULATION`, `TRACT_COUNT`

That produces the “one tract’s metadata” in the cached JSON (e.g. `name`, `GEOID`, `population` of a single tract) even though the geometry represents the whole district.

## Proposed change

**Backend only:** In [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js), stop spreading tract properties onto union polygon features. Set only district-relevant properties on every union feature (single or multi-part):

- `DISTRICT_START`
- `DISTRICT_END`
- `TOTAL_POPULATION`
- `TRACT_COUNT`

**Locations to update (4):**

1. **createUnionFromTracts** (S4 path, ~lines 843-852): Replace
  `properties: { ...tracts[0].properties, DISTRICT_START, DISTRICT_END, TOTAL_POPULATION, TRACT_COUNT }`  
   with  
   `properties: { DISTRICT_START: group.startDistrictNumber, DISTRICT_END: group.endDistrictNumber, TOTAL_POPULATION: group.totalPopulation, TRACT_COUNT: tracts.length }`.
2. **createUnionPolygon – dissolve success path** (~lines 1414-1423): Remove `...group.censusTracts[0].properties`; keep only the four district properties (same keys/values as today).
3. **createUnionPolygon – batched dissolve + union success path** (~lines 1505-1516): Same as (2) – only the four district properties.
4. **createUnionPolygon – sequential union** (~lines 1537-1544): `groupProperties` is currently `{ ...group.censusTracts[0].properties, DISTRICT_START, ... }`. Change to only the four district properties. This object is used for both the single-feature return and the multi-part array return, so both will carry only district metadata.

**No frontend changes** – the map and popup already rely on district group data, not union feature properties.

**Optional:** If any backend or script explicitly reads union feature properties (e.g. STATE or GEOID from the cached JSON), those references would need to be updated to use step/state or group context instead. A quick grep suggests only the four district fields are read from union features (e.g. TRACT_COUNT for sorting in S4 path at 1016-1017); keeping those four satisfies that.

## Summary


| File                                                                                   | Change                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) | In 4 places where union Feature `properties` are set, use only `DISTRICT_START`, `DISTRICT_END`, `TOTAL_POPULATION`, `TRACT_COUNT`. Remove any spread of `tracts[0].properties` or `group.censusTracts[0].properties`. |


After the change, cached union polygon JSON will contain only district-level metadata; single-tract fields (name, GEOID, county, tract population, etc.) will no longer appear on union features.