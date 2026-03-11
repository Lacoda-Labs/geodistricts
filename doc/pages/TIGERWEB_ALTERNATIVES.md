# TIGERweb and Alternative Tract Boundary Sources

When the primary Census TIGERweb service (`tigerweb.geo.census.gov`) is unavailable (e.g. timeout, 5xx), the backend can use alternative endpoints to fetch census tract boundaries. This doc lists options and how they are used.

## Primary: Census TIGERweb (current)

- **URL**: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10`
- **Layer 10**: Census 2020 Census Tracts
- **Query**: ArcGIS REST `query` with `where=STATE='53'`, `outFields=STATE,COUNTY,TRACT,GEOID,POP100`, `f=geojson`, `outSR=4326`, `resultRecordCount` / `resultOffset` for pagination
- **Fields**: STATE (2-digit FIPS), COUNTY (3-digit), TRACT, GEOID (11-char), POP100
- **Issue**: Host can be slow or unreachable (e.g. `ETIMEDOUT` to 148.129.75.240), so a fallback is useful

## Alternative 1: Esri USA Census Tracts (fallback in code)

- **URL**: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0`
- **Use**: Backend tries this when TIGERweb request fails (timeout or connection error)
- **Query**: Same ArcGIS REST pattern; field names may differ (e.g. STATEFP/STATE, COUNTYFP/COUNTY, TRACTCE/TRACT, GEOID). Response is normalized to STATE, COUNTY, TRACT, GEOID, POP100
- **Pros**: Different host; often more reliable when Census TIGERweb is slow
- **Cons**: Esri-hosted; not Census Bureau primary source (GDIP-003 allows “TIGER/Line or equivalent”)

## Alternative 2: TIGERweb Tracts_Blocks other layers

Same host as primary; only helps if the failure is layer-specific:

- **MapServer/7**: ACS 2024 Census Tracts (parent layer 6)
- **MapServer/0**: May be parent or different year; confirm at [TIGERweb Tracts_Blocks](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer)

If `tigerweb.geo.census.gov` is down or timing out, these will not help; use Esri or shapefiles.

## Alternative 3: TIGERweb tigerWMS_Current

- **URL**: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer`
- **Layers**: Census Tracts (e.g. layer 8), Block Groups (10); confirm layer IDs in the service description
- **Use**: Same host as primary; useful only if Tracts_Blocks is failing but tigerWMS_Current is not

## Alternative 4: TIGER/Line Shapefiles (offline or batch)

- **Census**: [TIGER/Line Shapefiles](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html)
- **By state**: `https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_<STATEFP>_tract.zip` (e.g. WA = 53 → `tl_2024_53_tract.zip`)
- **Use**: Download zip, unzip, convert shapefile to GeoJSON (e.g. `ogr2ogr`, or Node `shapefile` + `shp2json`). Good for one-time or batch ingestion; not used as runtime fallback in current backend
- **Fields**: STATEFP, COUNTYFP, TRACTCE, GEOID, ALAND, AWATER, etc.; no POP100 in shapefile (demographics from Census API)

## Backend behavior

1. **Tract count** (`getTractCount`): Tries TIGERweb MapServer/10; on failure (e.g. `ETIMEDOUT`, `ECONNABORTED`), retries with Esri FeatureServer/0 (returnCountOnly=true).
2. **Tract boundaries** (`fetchTractBoundariesForState`): Tries TIGERweb in batches; on failure, retries with Esri in same batch pattern and normalizes property names.
3. **State tract cache**: Prefer loading from local or Cloud Storage (`state_tracts_<state>`) so TIGERweb/Esri are only used when cache is missing. See [CACHING_DESIGN](CACHING_DESIGN.md) and clear-cache behavior.
4. **Batch size**: `resultRecordCount` is configurable via **`TIGERWEB_TRACT_BATCH_SIZE`** (default 200). Smaller values reduce payload per request and can help avoid timeouts; larger values (e.g. 500) mean fewer requests but bigger responses. Set in the environment if needed (e.g. `TIGERWEB_TRACT_BATCH_SIZE=150`).

## References

- [TIGER/Line Shapefiles](TIGER_LINE_SHAPEFILES.md) – shapefile structure and processing
- [GDIP-003 Required Data Sources](../protocol/GDIPs/gdip-003-required-data-sources.md) – tract boundaries from TIGER/Line or TIGERweb
- [.cursor/plans/tigerweb_and_geoid-based_party_allocation_9c8f8fb6.plan.md](.cursor/plans/tigerweb_and_geoid-based_party_allocation_9c8f8fb6.plan.md) – TIGERweb vs Esri and GEOID-based allocation
