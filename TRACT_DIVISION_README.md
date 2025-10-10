# Census Tract Division Functionality

This document explains how to use the new census tract division functionality that allows you to divide a list of census tracts by latitude, longitude, or population according to a specified ratio.

## Overview

The `divideTractsByCoordinate` function takes a list of census tracts (GeoJSON features) and divides them into two groups based on their geographic coordinates or population. For geographic divisions, tracts are sorted by their centroid coordinates. For population divisions, tracts are assigned to groups to achieve the target population ratio as closely as possible.

## Function Signature

```typescript
divideTractsByCoordinate(tracts: GeoJsonFeature[], options: TractDivisionOptions = {}): TractDivisionResult
```

## Parameters

### `tracts`
An array of GeoJSON features representing census tracts. Each feature should have a `geometry` property with coordinate data.

### `options` (optional)
An object with the following properties:

- `ratio?: [number, number]` - Array of two numbers representing the split ratio (default: `[50, 50]`)
- `direction?: 'latitude' | 'longitude' | 'population'` - Either 'latitude' for north/south, 'longitude' for east/west, or 'population' for population-based division (default: 'latitude')

## Return Value

Returns a `TractDivisionResult` object with the following properties:

- `northTracts: GeoJsonFeature[]` - Tracts in the northern/high population group
- `southTracts: GeoJsonFeature[]` - Tracts in the southern/low population group
- `eastTracts: GeoJsonFeature[]` - Tracts in the eastern group (when using longitude division)
- `westTracts: GeoJsonFeature[]` - Tracts in the western group (when using longitude division)
- `divisionLine: number` - The coordinate value where the division occurs (or population ratio for population division)
- `divisionType: string` - The type of division performed ('latitude', 'longitude', or 'population')
- `totalPopulation: number` - Total population across all tracts
- `northPopulation: number` - Population in the northern/high population group
- `southPopulation: number` - Population in the southern/low population group
- `eastPopulation: number` - Population in the eastern group (when using longitude division)
- `westPopulation: number` - Population in the western group (when using longitude division)

## Usage Examples

### Example 1: Divide tracts 60/40 by latitude (60% north, 40% south)

```typescript
const result = censusService.divideTractsByCoordinate(tracts, {
  ratio: [40, 60],
  direction: 'latitude'
});

console.log(`North tracts: ${result.northTracts.length}`);
console.log(`South tracts: ${result.southTracts.length}`);
console.log(`Division line: ${result.divisionLine}° latitude`);
```

### Example 2: Divide tracts 50/50 by longitude (50% east, 50% west)

```typescript
const result = censusService.divideTractsByCoordinate(tracts, {
  ratio: [50, 50],
  direction: 'longitude'
});

console.log(`East tracts: ${result.eastTracts.length}`);
console.log(`West tracts: ${result.westTracts.length}`);
console.log(`Division line: ${result.divisionLine}° longitude`);
```

### Example 3: Divide tracts 50/50 by population (50% of population in each group)

```typescript
const result = censusService.divideTractsByCoordinate(tracts, {
  ratio: [50, 50],
  direction: 'population'
});

console.log(`High pop region: ${result.northPopulation.toLocaleString()} people`);
console.log(`Low pop region: ${result.southPopulation.toLocaleString()} people`);
console.log(`Total population: ${result.totalPopulation.toLocaleString()}`);
```

### Example 4: Using the convenience method with automatic data loading

```typescript
// This method automatically loads tract boundaries and then divides them
censusService.divideTractsByCoordinateWithData('06', undefined, {
  ratio: [30, 70],
  direction: 'population'
}).subscribe(result => {
  console.log(`High pop region: ${result.northPopulation.toLocaleString()} people`);
  console.log(`Low pop region: ${result.southPopulation.toLocaleString()} people`);
});
```

## How It Works

### Geographic Division (latitude/longitude)
1. **Centroid Calculation**: For each tract, the function calculates the centroid (center point) by averaging all coordinate points in the tract's geometry.

2. **Sorting**: Tracts are sorted by their centroid coordinates in the specified direction (latitude or longitude).

3. **Division**: Based on the ratio, the function determines how many tracts should be in each group and creates the division at the appropriate coordinate.

4. **Result**: Returns the divided tracts along with the coordinate value where the division occurs.

### Population Division
1. **Geographic Foundation**: First divides tracts geographically by latitude to create contiguous north/south regions.

2. **Population Balancing**: Iteratively moves tracts across the geographic boundary to achieve the target population ratio while maintaining geographic contiguity.

3. **Boundary Optimization**: Only moves tracts at the boundary between regions to preserve geographic coherence.

4. **Result**: Returns contiguous geographic regions with balanced population and the latitude of the division line.

## Notes

- The function handles both Polygon and MultiPolygon geometries
- Empty tract arrays return a result with empty groups
- For geographic divisions, the ratio is applied as closely as possible, but exact ratios may not be achievable due to the discrete nature of tract counts
- For population divisions, the algorithm first creates geographic regions then balances population by moving tracts across the boundary
- The division line represents the latitude of the boundary between the two geographic regions
- Population division maintains geographic contiguity while achieving the target population ratio
- Population data is extracted from the `POPULATION` property of each tract's properties

## Integration with Existing Code

The function is integrated into the `CensusService` and can be used alongside existing methods like `getTractBoundaries()`. An example implementation is available in the `StateMapPageComponent.divideTractsExample()` method.
