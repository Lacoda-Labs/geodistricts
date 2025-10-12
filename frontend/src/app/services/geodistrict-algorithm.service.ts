import { Injectable } from '@angular/core';
import { Observable, throwError, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CensusService, GeoJsonFeature, GeoJsonResponse } from './census.service';
import { CongressionalDistrictsService } from './congressional-districts.service';
import { environment } from '../../environments/environment';

// Interface for DistrictGroup as defined in the algorithm
export interface DistrictGroup {
  startDistrictNumber: number;
  endDistrictNumber: number;
  censusTracts: GeoJsonFeature[];
  totalDistricts: number;
  totalPopulation: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centroid: {
    lat: number;
    lng: number;
  };
}

// Interface for algorithm step visualization
export interface GeodistrictStep {
  step: number;
  level: number;
  districtGroups: DistrictGroup[];
  description: string;
  totalGroups: number;
  totalDistricts: number;
  divisionDirection: 'latitude' | 'longitude';
}

// Interface for algorithm result
export interface GeodistrictResult {
  finalDistricts: DistrictGroup[];
  steps: GeodistrictStep[];
  totalPopulation: number;
  averagePopulation: number;
  populationVariance: number;
  algorithmHistory: string[];
}

// Interface for algorithm options
export interface GeodistrictOptions {
  state: string;
  useDirectAPI?: boolean;
  forceInvalidate?: boolean;
  maxIterations?: number;
}

@Injectable({
  providedIn: 'root'
})
export class GeodistrictAlgorithmService {

  constructor(
    private censusService: CensusService,
    private congressionalDistrictsService: CongressionalDistrictsService
  ) {}

  /**
   * Run the geodistrict algorithm for a given state
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  runGeodistrictAlgorithm(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, useDirectAPI = false, forceInvalidate = false, maxIterations = 100 } = options;
    
    // In production, always use backend proxy (which handles Secret Manager)
    // In development, respect the useDirectAPI flag
    const shouldUseDirectAPI = useDirectAPI && !environment.production;

    console.log(`Starting geodistrict algorithm for state: ${state}`);

    // Convert state abbreviation to FIPS code if needed
    const stateFips = this.getStateFipsCode(state);
    console.log(`Using FIPS code: ${stateFips} for state: ${state}`);

    // Get total districts for the state
    return this.congressionalDistrictsService.getTotalDistrictsForState(state).pipe(
      switchMap(totalDistricts => {
        console.log(`Total districts for ${state}: ${totalDistricts}`);

        // Get census data and boundaries with fallback
        console.log(`Using ${shouldUseDirectAPI ? 'direct API' : 'backend proxy'} for state: ${state}`);
        const dataSource$ = shouldUseDirectAPI 
          ? this.censusService.getTractDataWithBoundariesDirect(stateFips, undefined, forceInvalidate)
          : this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate);

        return dataSource$.pipe(
          map(data => {
            if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
              throw new Error(`No tract boundaries found for state: ${state}`);
            }

            // Combine demographic data with boundary data
            const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);
            
            console.log(`Found ${tractsWithPopulation.length} census tracts for ${state}`);

            // Run the algorithm
            return this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations);
          }),
          catchError(error => {
            console.warn(`Direct API failed for state ${state}, falling back to backend proxy:`, error);
            
            // Fallback to backend proxy
            return this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate).pipe(
              map(data => {
                if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
                  throw new Error(`No tract boundaries found for state: ${state} (both direct API and backend proxy failed)`);
                }

                // Combine demographic data with boundary data
                const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);
                
                console.log(`Found ${tractsWithPopulation.length} census tracts for ${state} via backend proxy`);

                // Run the algorithm
                return this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations);
              })
            );
          })
        );
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Combine demographic data with boundary features
   * @param demographicData Census demographic data
   * @param boundaryFeatures GeoJSON boundary features
   * @returns Combined tract features with population data
   */
  private combineTractData(demographicData: any[], boundaryFeatures: GeoJsonFeature[]): GeoJsonFeature[] {
    const demographicMap = new Map<string, any>();
    
    console.log(`Combining ${demographicData.length} demographic records with ${boundaryFeatures.length} boundary features`);
    
    // Create a map of demographic data by FIPS code
    demographicData.forEach(tract => {
      const fipsKey = `${tract.state}${tract.county}${tract.tract}`;
      demographicMap.set(fipsKey, tract);
    });

    console.log(`Created demographic map with ${demographicMap.size} entries`);
    console.log('Sample demographic keys:', Array.from(demographicMap.keys()).slice(0, 5));

    // Combine with boundary features
    const combinedFeatures = boundaryFeatures.map(feature => {
      const stateFips = feature.properties?.STATE_FIPS || feature.properties?.STATE;
      const countyFips = feature.properties?.COUNTY_FIPS || feature.properties?.COUNTY;
      const tractFips = feature.properties?.TRACT_FIPS || feature.properties?.TRACT;
      
      const fipsKey = `${stateFips}${countyFips}${tractFips}`;
      const demographicTract = demographicMap.get(fipsKey);

      if (demographicTract) {
        // Update feature properties with population data
        feature.properties = {
          ...feature.properties,
          POPULATION: demographicTract.population || 0,
          NAME: demographicTract.name || feature.properties?.NAME,
          STATE: demographicTract.state || stateFips,
          COUNTY: demographicTract.county || countyFips,
          TRACT: demographicTract.tract || tractFips
        };
      } else {
        // Set default population if no demographic data found
        feature.properties = {
          ...feature.properties,
          POPULATION: feature.properties?.POPULATION || 0
        };
      }

      return feature;
    });

    const matchedCount = combinedFeatures.filter(f => (f.properties?.POPULATION || 0) > 0).length;
    console.log(`Matched ${matchedCount} out of ${combinedFeatures.length} features with demographic data`);
    
    if (matchedCount === 0) {
      console.log('Sample boundary feature properties:', boundaryFeatures[0]?.properties);
      console.log('Sample demographic tract:', demographicData[0]);
    }

    return combinedFeatures;
  }

  /**
   * Execute the geodistrict algorithm
   * @param tracts Array of census tract features with population data
   * @param totalDistricts Total number of districts to create
   * @param maxIterations Maximum number of iterations
   * @returns Algorithm result
   */
  private executeGeodistrictAlgorithm(tracts: GeoJsonFeature[], totalDistricts: number, maxIterations: number): GeodistrictResult {
    console.log(`Executing geodistrict algorithm: ${tracts.length} tracts → ${totalDistricts} districts`);

    // Calculate total state population
    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    console.log(`Total state population: ${totalStatePopulation.toLocaleString()}`);
    console.log(`Target population per district: ${targetDistrictPopulation.toLocaleString()}`);

    // Initialize with all tracts as a single district group
    const initialGroup: DistrictGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: tracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: this.calculateBounds(tracts),
      centroid: this.calculateCentroid(tracts)
    };

    const steps: GeodistrictStep[] = [];
    const algorithmHistory: string[] = [];
    let currentGroups: DistrictGroup[] = [initialGroup];
    let iteration = 0;

    // Create initial step
    steps.push(this.createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude'));

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const newGroups: DistrictGroup[] = [];
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

      console.log(`Iteration ${iteration}: Dividing ${currentGroups.length} groups by ${direction}`);

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Divide this group
          const divisionResult = this.divideDistrictGroup(group, direction);
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
        }
      }

      currentGroups = newGroups;
      steps.push(this.createStep(iteration, iteration, currentGroups, 
        `Iteration ${iteration}: Divided groups by ${direction}`, direction));

      console.log(`After iteration ${iteration}: ${currentGroups.length} groups, ${currentGroups.reduce((sum, g) => sum + g.totalDistricts, 0)} total districts`);
    }

    if (iteration >= maxIterations) {
      algorithmHistory.push(`Algorithm stopped: Maximum iterations (${maxIterations}) reached`);
    } else {
      algorithmHistory.push(`Algorithm completed: ${currentGroups.length} districts created in ${iteration} iterations`);
    }

    // Calculate final statistics
    const finalDistricts = currentGroups;
    const averagePopulation = totalStatePopulation / finalDistricts.length;
    const populationVariance = finalDistricts.reduce((sum, district) => 
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / finalDistricts.length;

    return {
      finalDistricts,
      steps,
      totalPopulation: totalStatePopulation,
      averagePopulation,
      populationVariance,
      algorithmHistory
    };
  }

  /**
   * Divide a district group into two groups
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @returns Division result with new groups and history
   */
  private divideDistrictGroup(group: DistrictGroup, direction: 'latitude' | 'longitude'): {
    groups: DistrictGroup[];
    history: string[];
  } {
    const { totalDistricts } = group;
    
    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);
    
    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    
    // Sort tracts geographically
    const sortedTracts = this.sortTractsGeographically(group.censusTracts, direction);
    
    // Divide tracts by accumulating population
    let cumulativePopulation = 0;
    let divisionIndex = 0;
    let bestDifference = Infinity;
    
    for (let i = 0; i < sortedTracts.length; i++) {
      cumulativePopulation += sortedTracts[i].properties?.POPULATION || 0;
      const difference = Math.abs(cumulativePopulation - targetFirstGroupPopulation);
      
      if (difference < bestDifference) {
        bestDifference = difference;
        divisionIndex = i + 1;
      }
    }
    
    // Split tracts into two groups
    const firstGroupTracts = sortedTracts.slice(0, divisionIndex);
    const secondGroupTracts = sortedTracts.slice(divisionIndex);
    
    // Create new district groups
    const firstGroup: DistrictGroup = {
      startDistrictNumber: group.startDistrictNumber,
      endDistrictNumber: group.startDistrictNumber + division.first - 1,
      censusTracts: firstGroupTracts,
      totalDistricts: division.first,
      totalPopulation: firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: this.calculateBounds(firstGroupTracts),
      centroid: this.calculateCentroid(firstGroupTracts)
    };
    
    const secondGroup: DistrictGroup = {
      startDistrictNumber: group.startDistrictNumber + division.first,
      endDistrictNumber: group.endDistrictNumber,
      censusTracts: secondGroupTracts,
      totalDistricts: division.second,
      totalPopulation: secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: this.calculateBounds(secondGroupTracts),
      centroid: this.calculateCentroid(secondGroupTracts)
    };
    
    const history = [
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} into ${division.first} + ${division.second} districts`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`
    ];
    
    return {
      groups: [firstGroup, secondGroup],
      history
    };
  }

  /**
   * Sort tracts geographically by direction
   * @param tracts Array of tract features
   * @param direction Sort direction
   * @returns Sorted array of tracts
   */
  private sortTractsGeographically(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    return tracts.sort((a, b) => {
      const centroidA = this.calculateTractCentroid(a);
      const centroidB = this.calculateTractCentroid(b);
      
      if (direction === 'latitude') {
        // Sort by latitude (north to south), then longitude (west to east)
        if (Math.abs(centroidA.lat - centroidB.lat) < 0.001) {
          return centroidA.lng - centroidB.lng;
        }
        return centroidB.lat - centroidA.lat;
      } else {
        // Sort by longitude (west to east), then latitude (north to south)
        if (Math.abs(centroidA.lng - centroidB.lng) < 0.001) {
          return centroidB.lat - centroidA.lat;
        }
        return centroidA.lng - centroidB.lng;
      }
    });
  }

  /**
   * Calculate optimal division for a number of districts
   * @param totalDistricts Total number of districts
   * @returns Division configuration
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number]; first: number; second: number } {
    if (totalDistricts <= 1) {
      return { ratio: [100, 0], first: 1, second: 0 };
    }

    if (totalDistricts % 2 === 0) {
      // Even number: divide 50/50
      const half = totalDistricts / 2;
      return { ratio: [50, 50], first: half, second: half };
    } else {
      // Odd number: divide as evenly as possible
      const first = Math.floor(totalDistricts / 2);
      const second = Math.ceil(totalDistricts / 2);
      const ratio: [number, number] = [
        Math.round((first / totalDistricts) * 100),
        Math.round((second / totalDistricts) * 100)
      ];
      return { ratio, first, second };
    }
  }

  /**
   * Calculate bounds for a group of tracts
   * @param tracts Array of tract features
   * @returns Bounds object
   */
  private calculateBounds(tracts: GeoJsonFeature[]): { north: number; south: number; east: number; west: number } {
    if (tracts.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = -90, south = 90, east = -180, west = 180;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    });

    return { north, south, east, west };
  }

  /**
   * Calculate centroid for a group of tracts
   * @param tracts Array of tract features
   * @returns Centroid coordinates
   */
  private calculateCentroid(tracts: GeoJsonFeature[]): { lat: number; lng: number } {
    if (tracts.length === 0) {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0, totalLng = 0;

    tracts.forEach(tract => {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
    });

    return {
      lat: totalLat / tracts.length,
      lng: totalLng / tracts.length
    };
  }

  /**
   * Calculate centroid for a single tract
   * @param tract Tract feature
   * @returns Centroid coordinates
   */
  private calculateTractCentroid(tract: GeoJsonFeature): { lat: number; lng: number } {
    const coordinates = this.extractAllCoordinates(tract.geometry);

    if (coordinates.length === 0) {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0, totalLng = 0;

    coordinates.forEach(coord => {
      totalLng += coord[0]; // longitude
      totalLat += coord[1]; // latitude
    });

    return {
      lat: totalLat / coordinates.length,
      lng: totalLng / coordinates.length
    };
  }

  /**
   * Extract all coordinate pairs from a GeoJSON geometry
   * @param geometry GeoJSON geometry object
   * @returns Array of coordinate pairs [lng, lat]
   */
  private extractAllCoordinates(geometry: any): number[][] {
    const coordinates: number[][] = [];

    if (!geometry || !geometry.coordinates) {
      return coordinates;
    }

    const extractFromArray = (coordArray: any): void => {
      if (Array.isArray(coordArray)) {
        if (coordArray.length === 2 && typeof coordArray[0] === 'number' && typeof coordArray[1] === 'number') {
          coordinates.push([coordArray[0], coordArray[1]]);
        } else {
          coordArray.forEach(extractFromArray);
        }
      }
    };

    if (geometry.type === 'Polygon') {
      geometry.coordinates.forEach((ring: any) => {
        extractFromArray(ring);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((polygon: any) => {
        polygon.forEach((ring: any) => {
          extractFromArray(ring);
        });
      });
    } else {
      extractFromArray(geometry.coordinates);
    }

    return coordinates;
  }

  /**
   * Create a step for visualization
   * @param step Step number
   * @param level Level number
   * @param groups District groups
   * @param description Step description
   * @param direction Division direction
   * @returns Step object
   */
  private createStep(step: number, level: number, groups: DistrictGroup[], description: string, direction: 'latitude' | 'longitude'): GeodistrictStep {
    return {
      step,
      level,
      districtGroups: groups,
      description,
      totalGroups: groups.length,
      totalDistricts: groups.reduce((sum, group) => sum + group.totalDistricts, 0),
      divisionDirection: direction
    };
  }

  /**
   * Get FIPS code for a state abbreviation
   * @param state State abbreviation or FIPS code
   * @returns FIPS code
   */
  private getStateFipsCode(state: string): string {
    // If it's already a FIPS code (2 digits), return as is
    if (/^\d{2}$/.test(state)) {
      return state;
    }

    // Convert state abbreviation to FIPS code
    const stateFipsMap: { [key: string]: string } = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06', 'CO': '08', 'CT': '09', 'DE': '10',
      'FL': '12', 'GA': '13', 'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19', 'KS': '20',
      'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28',
      'MO': '29', 'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34', 'NM': '35', 'NY': '36',
      'NC': '37', 'ND': '38', 'OH': '39', 'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
      'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50', 'VA': '51', 'WA': '53', 'WV': '54',
      'WI': '55', 'WY': '56'
    };

    const fipsCode = stateFipsMap[state.toUpperCase()];
    if (!fipsCode) {
      throw new Error(`Invalid state code: ${state}`);
    }

    return fipsCode;
  }

  /**
   * Handle errors
   * @param error Error object
   * @returns Observable that throws error
   */
  private handleError(error: any): Observable<never> {
    console.error('Geodistrict Algorithm Error:', error);
    let errorMessage = 'An error occurred while running the geodistrict algorithm';

    if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return throwError(() => new Error(errorMessage));
  }
}
