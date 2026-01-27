# TIGER/Line Shapefiles

## Overview

TIGER/Line shapefiles provide the geographic boundaries and spatial data that define the physical shape and location of census tracts, counties, and other geographic entities used in GeoDistricts. These files are the authoritative source for U.S. geographic boundaries and are maintained by the U.S. Census Bureau.

## Data Source

- **Provider**: U.S. Census Bureau
- **System**: Topologically Integrated Geographic Encoding and Referencing (TIGER)
- **Distribution**: TIGER/Line Shapefiles
- **Access Method**: Download from TIGERweb or FTP
- **Update Frequency**: Annual updates, major revisions with decennial census

## Geographic Entities

### Core Geographic Levels
- **States**: State boundaries and identifiers
- **Counties**: County subdivisions within states
- **Census Tracts**: Small statistical areas (typically 1,200-8,000 people)
- **Block Groups**: Subdivisions of census tracts (600-3,000 people)

### Coordinate System
- **Projection**: Geographic (latitude/longitude)
- **Datum**: NAD83 (North American Datum 1983)
- **Format**: Decimal degrees
- **Precision**: High precision for mapping applications

## File Structure

### Shapefile Components
Each geographic layer consists of multiple files:
- `.shp`: Geometry data (points, lines, polygons)
- `.dbf`: Attribute data (population, names, codes)
- `.shx`: Spatial index for geometry
- `.prj`: Projection information
- `.cpg`: Character encoding information

### Directory Structure
```
TIGER2020/
├── STATE/           # State-level boundaries
├── COUNTY/          # County boundaries
├── TRACT/           # Census tract boundaries
├── BG/             # Block group boundaries
└── PLACE/          # Incorporated places
```

## Data Fields

### Census Tract Attributes
- `GEOID`: Unique 11-digit identifier (STATE+COUNTY+TRACT)
- `NAME`: Human-readable tract name
- `NAMELSAD`: Legal/statistical area description
- `MTFCC`: MAF/TIGER feature class code
- `FUNCSTAT`: Functional status
- `ALAND`: Land area in square meters
- `AWATER`: Water area in square meters

### Geographic Identifiers
- `STATEFP`: State FIPS code
- `COUNTYFP`: County FIPS code
- `TRACTCE`: Census tract code
- `GEOIDFQ`: Fully qualified GEOID

## Usage in GeoDistricts

### Spatial Operations

The shapefiles enable critical geographic calculations:

```typescript
interface GeographicBoundary {
  geoid: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    name: string;
    state: string;
    county: string;
    landArea: number;
    waterArea: number;
  };
}
```

### Algorithm Integration

1. **Boundary Loading**: Import shapefile geometries into spatial database
2. **Spatial Indexing**: Create indexes for efficient geographic queries
3. **Intersection Analysis**: Calculate relationships between geographic entities
4. **Contiguity Testing**: Verify district boundary connections

### Visualization
- Interactive map rendering with Leaflet
- Boundary overlays on population density maps
- District boundary highlighting during algorithm execution
- Zoom-dependent geometry simplification

## Data Processing Pipeline

### Import Process
```bash
# Download shapefile
wget https://www2.census.gov/geo/tiger/TIGER2020/TRACT/tl_2020_${STATEFP}_tract.zip

# Extract and import
unzip tl_2020_${STATEFP}_tract.zip
ogr2ogr -f PostgreSQL "PG:host=localhost dbname=geodistricts" tl_2020_${STATEFP}_tract.shp
```

### Geometry Processing
```sql
-- Add spatial column and index
ALTER TABLE tracts ADD COLUMN geom geometry(MultiPolygon, 4326);
CREATE INDEX idx_tracts_geom ON tracts USING GIST (geom);

-- Transform and validate geometries
UPDATE tracts SET geom = ST_Transform(ST_SetSRID(wkb_geometry, 4269), 4326);
UPDATE tracts SET geom = ST_MakeValid(geom) WHERE NOT ST_IsValid(geom);
```

## Spatial Analysis Features

### Contiguity Validation
- **Rook Contiguity**: Shared boundary edges
- **Queen Contiguity**: Shared edges or vertices
- **Geographic Constraints**: Natural barriers (rivers, mountains)

### Area Calculations
- Land area vs. water area analysis
- Population density computation
- Geographic compactness metrics

### Spatial Relationships
- Point-in-polygon operations for tract assignment
- Boundary intersection detection
- Distance and adjacency calculations

## Performance Optimization

### Database Optimization
- Spatial indexes (GIST) for fast geometric queries
- Clustering by geographic location
- Partitioning by state for large datasets

### Caching Strategy
- Pre-computed adjacency matrices
- Cached boundary simplification for different zoom levels
- Memory-efficient geometry storage

### Query Optimization
- Bounding box filtering for map extents
- Spatial join optimization
- Parallel processing for bulk operations

## Data Quality & Maintenance

### Accuracy
- Official Census Bureau boundaries
- Consistent with population data geographies
- Regular updates with address changes and annexations

### Completeness
- Complete coverage of all U.S. territories
- Consistent topology across all layers
- Valid geometry with no self-intersections

### Update Process
- Annual TIGER updates with new construction
- Major revisions with decennial census
- Automated download and integration pipeline

## Integration with Population Data

### Geographic Alignment
- Perfect alignment between tract boundaries and population statistics
- Consistent GEOID identifiers across datasets
- Temporal alignment for multi-year analysis

### Cross-Referencing
- Population density calculation (population ÷ land area)
- Demographic distribution analysis
- Urban/rural classification

## Technical Implementation

### Libraries & Tools
- **GDAL/OGR**: Shapefile processing and conversion
- **PostGIS**: Spatial database operations
- **Leaflet**: Web-based geographic visualization
- **Turf.js**: Client-side spatial analysis

### API Endpoints
```javascript
// Boundary retrieval
GET /api/v1/boundaries/tracts?state=CA&county=001

// Spatial queries
GET /api/v1/boundaries/intersects?lat=37.7749&lng=-122.4194

// Contiguity analysis
GET /api/v1/boundaries/contiguous?geoid=06075010100
```

## Future Enhancements

### Advanced Spatial Features
- 3D terrain integration for elevation analysis
- Time-series boundary changes
- Historical boundary archives

### Performance Improvements
- Vector tile generation for faster rendering
- Edge computing for spatial operations
- Real-time boundary updates

### Data Enrichment
- Additional geographic attributes (urban/rural, climate zones)
- Integration with other spatial datasets
- Enhanced metadata and documentation

## Monitoring & Troubleshooting

### Data Validation
- Geometry validity checks
- Topology consistency verification
- Coordinate system validation

### Performance Monitoring
- Query execution time tracking
- Cache hit rate monitoring
- Database size and growth analysis

### Error Handling
- Corrupted shapefile detection
- Missing data gap filling
- Coordinate system transformation errors

## Support Resources

### Census Bureau Resources
- TIGERweb interactive mapping
- Technical documentation and metadata
- FTP download directories
- API access for automated retrieval

### GeoDistricts Resources
- Data processing scripts and utilities
- Integration guides and best practices
- Performance optimization tips
- Troubleshooting and support forums