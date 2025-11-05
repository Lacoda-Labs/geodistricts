import { Injectable } from '@angular/core';
import { Observable, throwError, of, from } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CensusService, GeoJsonFeature, GeoJsonResponse } from './census.service';
import { CongressionalDistrictsService } from './congressional-districts.service';
import { GeoGraphTraversalService } from './geo-graph-traversal.service';
import { environment } from '../../environments/environment';
import * as turf from '@turf/turf';
import { HttpClient } from '@angular/common/http';

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
  algorithm?: 'geographic' | 'latlong' | 'greedy-traversal' | 'brown-s4' | 'geo-graph';
}

// Interface for steppable geo-graph algorithm results
export interface GeoGraphStepResult {
  phase: 'phase1' | 'phase2';
  step: number;
  totalSteps: number;
  isComplete: boolean;
  message: string;
  sortedTracts: GeoJsonFeature[];
  currentDistricts?: GeoJsonFeature[][];
  nextAction?: 'northwest' | 'southwest';
  groupIndex?: number;
}

// Algorithm types
export type AlgorithmType = 'geographic' | 'latlong' | 'greedy-traversal' | 'brown-s4' | 'geo-graph';

// Interface for S4 adjacency data
interface S4TractData {
  GISJOIN: string;
  YEAR: string;
  STATEID: string;
  COUNTYID: string;
  TRACTID: string;
  FID: string;
  NID: string;
  GEOID: string;
}

interface S4AdjacencyData {
  SOURCE_TRACTID: string; // Source tract ID
  NEIGHBOR_TRACTID: string; // Neighbor tract ID
}

@Injectable({
  providedIn: 'root'
})
export class GeodistrictAlgorithmService {
  private s4AdjacencyCache: Map<string, Map<string, string[]>> = new Map();
  private s4TractDataCache: Map<string, S4TractData[]> = new Map();

  constructor(
    private censusService: CensusService,
    private congressionalDistrictsService: CongressionalDistrictsService,
    private geoGraphTraversalService: GeoGraphTraversalService,
    private http: HttpClient
  ) { }

  /**
   * Run the geodistrict algorithm for a given state
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  runGeodistrictAlgorithm(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, useDirectAPI = false, forceInvalidate = false, maxIterations = 100, algorithm = 'brown-s4' } = options;

    // In production, always use backend proxy (which handles Secret Manager)
    // In development, respect the useDirectAPI flag
    const shouldUseDirectAPI = useDirectAPI && !environment.production;

    // Convert state abbreviation to FIPS code if needed
    const stateFips = this.getStateFipsCode(state);

    // Get total districts for the state
    return this.congressionalDistrictsService.getTotalDistrictsForState(state).pipe(
      switchMap(totalDistricts => {
        // Get census data and boundaries with fallback
        const dataSource$ = shouldUseDirectAPI
          ? this.censusService.getTractDataWithBoundariesDirect(stateFips, undefined, forceInvalidate)
          : this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate);

        return dataSource$.pipe(
          switchMap(data => {
            if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
              throw new Error(`No tract boundaries found for state: ${state}`);
            }

            // Combine demographic data with boundary data
            const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);

            // Run the algorithm
            return from(this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations, algorithm));
          }),
          catchError(error => {
            console.warn(`Direct API failed for state ${state}, falling back to backend proxy:`, error);

            // Fallback to backend proxy
            return this.censusService.getTractDataWithBoundaries(stateFips, undefined, forceInvalidate).pipe(
              switchMap(data => {
                if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
                  throw new Error(`No tract boundaries found for state: ${state} (both direct API and backend proxy failed)`);
                }

                // Combine demographic data with boundary data
                const tractsWithPopulation = this.combineTractData(data.demographic, data.boundaries.features);

                // Run the algorithm
                return from(this.executeGeodistrictAlgorithm(tractsWithPopulation, totalDistricts, maxIterations, algorithm));
              })
            );
          })
        );
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Run the geodistrict algorithm step by step (for visualization)
   * @param options Algorithm options
   * @returns Observable of algorithm result with step-by-step execution
   */
  runGeodistrictAlgorithmStepByStep(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, useDirectAPI = false, forceInvalidate = false, maxIterations = 100, algorithm = 'brown-s4' } = options;

    // In production, always use backend proxy (which handles Secret Manager)
    // In development, respect the useDirectAPI flag
    const shouldUseDirectAPI = useDirectAPI && !environment.production;

    // Choose data source based on environment and options
    const dataSource$ = shouldUseDirectAPI
      ? this.censusService.getTractDataWithBoundariesDirect(state, undefined, forceInvalidate)
      : this.censusService.getTractDataWithBoundaries(state, undefined, forceInvalidate);

    return dataSource$.pipe(
      switchMap(data => {
        if (!data.boundaries || !data.boundaries.features || data.boundaries.features.length === 0) {
          throw new Error(`No tract boundaries found for state: ${state} (${shouldUseDirectAPI ? 'direct API' : 'backend proxy'} failed)`);
        }

        // Combine boundary and demographic data to ensure STATE property is set
        const combinedTracts = this.combineTractData(data.demographic || [], data.boundaries.features);

        // Get number of districts for this state
        const totalDistricts = this.congressionalDistrictsService.getDistrictsForState(state);
        if (!totalDistricts) {
          throw new Error(`No congressional districts found for state: ${state}`);
        }

        // Execute only the first step of the algorithm
        return this.executeGeodistrictAlgorithmFirstStep(combinedTracts, totalDistricts, algorithm);
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Execute only the first step of the geodistrict algorithm
   * @param tracts Array of tract features
   * @param totalDistricts Total number of districts
   * @param algorithm Algorithm type to use
   * @returns Algorithm result with only the first step
   */
  private executeGeodistrictAlgorithmFirstStep(tracts: GeoJsonFeature[], totalDistricts: number, algorithm: AlgorithmType): Observable<GeodistrictResult> {
    return from(this.executeGeodistrictAlgorithmFirstStepAsync(tracts, totalDistricts, algorithm));
  }

  private async executeGeodistrictAlgorithmFirstStepAsync(tracts: GeoJsonFeature[], totalDistricts: number, algorithm: AlgorithmType): Promise<GeodistrictResult> {
    // Calculate total state population
    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    // Note: geo-graph and brown-s4 algorithms are now supported in first step mode

    // Sort tracts initially by latitude (north to south)
    const sortedTracts = algorithm === 'latlong'
      ? this.sortTractsForLatLongAlgorithm(tracts, 'latitude')
      : algorithm === 'greedy-traversal'
        ? this.sortTractsByGreedyTraversal(tracts, 'latitude')
        : algorithm === 'brown-s4'
          ? await this.sortTractsByBrownS4(tracts, 'latitude')
          : algorithm === 'geo-graph'
            ? await this.sortTractsByGeoGraph(tracts, 'latitude')
            : this.sortTractsByCentroid(tracts, 'latitude');

    // Initialize with all tracts as a single district group
    const initialGroup: DistrictGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: sortedTracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: this.calculateBounds(sortedTracts),
      centroid: this.calculateCentroid(sortedTracts)
    };

    const steps: GeodistrictStep[] = [];
    const algorithmHistory: string[] = [];
    let currentGroups: DistrictGroup[] = [initialGroup];
    let iteration = 0;

    // Create initial step
    steps.push(this.createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude'));

    // Execute only the first division
    if (currentGroups.some(group => group.totalDistricts > 1)) {
      iteration++;
      const newGroups: DistrictGroup[] = [];
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Divide this group
          const divisionResult = algorithm === 'latlong'
            ? this.divideDistrictGroupLatLong(group, direction)
            : algorithm === 'greedy-traversal'
              ? this.divideDistrictGroupGreedyTraversal(group, direction)
              : this.divideDistrictGroup(group, direction);
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
        }
      }

      // Create step for this iteration
      steps.push(this.createStep(iteration, 1, newGroups, `First division by ${direction}`, direction));
      currentGroups = newGroups;
    }

    // Calculate final statistics (for the current state)
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
   * Execute the next step of the geodistrict algorithm
   * @param currentResult Current algorithm result
   * @param algorithm Algorithm type to use
   * @returns Updated algorithm result with next step
   */
  executeNextStep(currentResult: GeodistrictResult, algorithm: AlgorithmType = 'geographic'): Observable<GeodistrictResult> {
    return from(this.executeNextStepAsync(currentResult, algorithm));
  }

  private async executeNextStepAsync(currentResult: GeodistrictResult, algorithm: AlgorithmType): Promise<GeodistrictResult> {
    const steps = [...currentResult.steps];
    const algorithmHistory = [...currentResult.algorithmHistory];
    let currentGroups = [...currentResult.finalDistricts];
    let iteration = steps.length - 1; // Last completed iteration

    // Check if we can continue
    if (!currentGroups.some(group => group.totalDistricts > 1)) {
      return currentResult;
    }

    // Execute next division
    iteration++;
    const newGroups: DistrictGroup[] = [];
    const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

    for (const group of currentGroups) {
      if (group.totalDistricts === 1) {
        // This group is already a single district
        newGroups.push(group);
        algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
      } else {
        // Divide this group
        const divisionResult = algorithm === 'latlong'
          ? this.divideDistrictGroupLatLong(group, direction)
          : algorithm === 'greedy-traversal'
            ? this.divideDistrictGroupGreedyTraversal(group, direction)
            : algorithm === 'geo-graph'
              ? await this.divideDistrictGroupGeoGraph(group, direction)
              : this.divideDistrictGroup(group, direction);
        newGroups.push(...divisionResult.groups);
        algorithmHistory.push(...divisionResult.history);
      }
    }

    // Create step for this iteration
    steps.push(this.createStep(iteration, steps.length, newGroups, `Division ${iteration} by ${direction}`, direction));
    currentGroups = newGroups;

    // Calculate final statistics
    const totalPopulation = currentResult.totalPopulation;
    const averagePopulation = totalPopulation / currentGroups.length;
    const populationVariance = currentGroups.reduce((sum, district) =>
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / currentGroups.length;

    return {
      finalDistricts: currentGroups,
      steps,
      totalPopulation,
      averagePopulation,
      populationVariance,
      algorithmHistory
    };
  }

  /**
   * Combine demographic data with boundary features
   * @param demographicData Census demographic data
   * @param boundaryFeatures GeoJSON boundary features
   * @returns Combined tract features with population data
   */
  public combineTractData(demographicData: any[], boundaryFeatures: GeoJsonFeature[]): GeoJsonFeature[] {
    const demographicMap = new Map<string, any>();

    // Create a map of demographic data by FIPS code
    demographicData.forEach(tract => {
      const fipsKey = `${tract.state}${tract.county}${tract.tract}`;
      demographicMap.set(fipsKey, tract);
    });

    // Combine with boundary features
    const combinedFeatures = boundaryFeatures.map(feature => {
      const stateFips = feature.properties?.STATE_FIPS || feature.properties?.STATE;
      const countyFips = feature.properties?.COUNTY_FIPS || feature.properties?.COUNTY;
      const tractFips = feature.properties?.TRACT_FIPS || feature.properties?.TRACT;

      const fipsKey = `${stateFips}${countyFips}${tractFips}`;
      const demographicTract = demographicMap.get(fipsKey);

      // Construct and set GEOID for all tracts
      const state = demographicTract?.state || stateFips;
      const county = demographicTract?.county || countyFips;
      const tract = demographicTract?.tract || tractFips;

      let geoid = '';
      if (state && county && tract) {
        // Construct GEOID: SSCCCTTTTTT (2+3+6 digits)
        const stateStr = state.toString().padStart(2, '0');
        const countyStr = county.toString().padStart(3, '0');
        const tractStr = tract.toString().padStart(6, '0');
        geoid = stateStr + countyStr + tractStr;
      }

      if (demographicTract) {
        // Update feature properties with population data
        feature.properties = {
          ...feature.properties,
          GEOID: geoid,
          POPULATION: demographicTract.population || 0,
          NAME: demographicTract.name || feature.properties?.NAME,
          STATE: demographicTract.state || stateFips,
          COUNTY: demographicTract.county || countyFips,
          TRACT: demographicTract.tract || tractFips,
          TRACT_FIPS: tractFips
        };
      } else {
        // Set default population if no demographic data found
        feature.properties = {
          ...feature.properties,
          GEOID: geoid,
          POPULATION: feature.properties?.POPULATION || 0,
          STATE: stateFips, // Ensure STATE property is always set
          TRACT_FIPS: tractFips
        };
      }

      // Calculate and store northwest coordinate for performance optimization
      const northwestCoord = this.calculateNorthwestCoordinate(feature);
      feature.properties = {
        ...feature.properties,
        NORTHWEST_LAT: northwestCoord.lat,
        NORTHWEST_LNG: northwestCoord.lng
      };

      return feature;
    });

    const matchedCount = combinedFeatures.filter(f => (f.properties?.POPULATION || 0) > 0).length;

    return combinedFeatures;
  }

  /**
   * Execute the geodistrict algorithm
   * @param tracts Array of census tract features with population data
   * @param totalDistricts Total number of districts to create
   * @param maxIterations Maximum number of iterations
   * @param algorithm Algorithm type to use
   * @returns Algorithm result
   */
  private async executeGeodistrictAlgorithm(tracts: GeoJsonFeature[], totalDistricts: number, maxIterations: number, algorithm: AlgorithmType): Promise<GeodistrictResult> {
    // Calculate total state population
    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

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

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Divide this group
          const divisionResult = algorithm === 'latlong'
            ? this.divideDistrictGroupLatLong(group, direction)
            : algorithm === 'greedy-traversal'
              ? this.divideDistrictGroupGreedyTraversal(group, direction)
              : algorithm === 'geo-graph'
                ? await this.divideDistrictGroupGeoGraph(group, direction)
                : this.divideDistrictGroup(group, direction);
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
        }
      }

      currentGroups = newGroups;
      steps.push(this.createStep(iteration, iteration, currentGroups,
        `Iteration ${iteration}: Divided groups by ${direction}`, direction));
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
   * Divide a district group using greedy traversal algorithm
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @returns Division result with new groups and history
   */
  private divideDistrictGroupGreedyTraversal(group: DistrictGroup, direction: 'latitude' | 'longitude'): {
    groups: DistrictGroup[];
    history: string[];
  } {
    const { totalDistricts } = group;

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;

    // Sort tracts using greedy traversal
    const sortedTracts = this.sortTractsByGreedyTraversal(group.censusTracts, direction);

    // Update the group with sorted tracts
    group.censusTracts = sortedTracts;

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

    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Greedy traversal division resulted in non-contiguous groups. This may indicate complex geographic barriers.`);
    }

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
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} using greedy traversal into ${division.first} + ${division.second} districts`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`
    ];

    return {
      groups: [firstGroup, secondGroup],
      history
    };
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param group District group to divide
   * @param direction Division direction (latitude or longitude)
   * @returns Division result with new groups and history
   */
  private divideDistrictGroupLatLong(group: DistrictGroup, direction: 'latitude' | 'longitude'): {
    groups: DistrictGroup[];
    history: string[];
  } {
    const { totalDistricts } = group;

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;

    // Find the dividing line using iterative approach
    const dividingLine = this.findOptimalDividingLine(group.censusTracts, direction, targetFirstGroupPopulation);

    // Divide tracts based on the dividing line
    const { firstGroupTracts, secondGroupTracts } = this.divideTractsByLine(
      group.censusTracts,
      direction,
      dividingLine
    );

    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Lat/long division resulted in non-contiguous groups. This is expected for some geographic configurations.`);
    }

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

    // Check for high variance and log warning
    const actualFirstPopulation = firstGroup.totalPopulation;
    const actualVariance = Math.abs(actualFirstPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation;

    if (actualVariance > 0.05) { // >5% variance
      console.warn(`⚠️ High population variance detected: ${(actualVariance * 100).toFixed(1)}% (target: ${targetFirstGroupPopulation.toLocaleString()}, actual: ${actualFirstPopulation.toLocaleString()})`);
      console.warn(`   This may indicate complex geographic distribution that requires multiple dividing lines or different approach.`);
    }

    const history = [
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} lat/long line at ${direction === 'latitude' ? dividingLine.toFixed(6) + '°N' : dividingLine.toFixed(6) + '°W'}`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`,
      `  - Population variance: ${(actualVariance * 100).toFixed(1)}%`
    ];

    return {
      groups: [firstGroup, secondGroup],
      history
    };
  }

  /**
   * Divide a district group into two groups (original geographic algorithm)
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

    // Sort tracts for contiguity
    const sortedTracts = this.sortTractsForContiguity(group.censusTracts, direction);

    // Update the group with sorted tracts
    group.censusTracts = sortedTracts;

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

    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Division resulted in non-contiguous groups. Attempting to fix...`);

      // Try to fix contiguity by adjusting the division point
      const fixedGroups = this.fixContiguityInDivision(sortedTracts, divisionIndex, group, division);
      if (fixedGroups) {
        return fixedGroups;
      }
    }

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
   * Sort tracts for lat/long dividing lines algorithm
   * @param tracts Array of tract features
   * @param direction Sort direction preference
   * @returns Sorted array of tracts
   */
  private sortTractsForLatLongAlgorithm(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    if (tracts.length <= 1) return tracts;

    // For lat/long algorithm, we don't need to sort tracts - we'll use the dividing line approach
    // But we still need to ensure northwest coordinates are pre-calculated
    const sortedTracts = tracts.map(tract => {
      // Ensure northwest coordinates are available
      if (!tract.properties?.['NORTHWEST_LAT'] || !tract.properties?.['NORTHWEST_LNG']) {
        const northwestCoord = this.calculateNorthwestCoordinate(tract);
        tract.properties = {
          ...tract.properties,
          NORTHWEST_LAT: northwestCoord.lat,
          NORTHWEST_LNG: northwestCoord.lng
        };
      }
      return tract;
    });

    return sortedTracts;
  }

  /**
   * Sort tracts using centroid coordinates for simple geographic ordering
   * @param tracts Array of tracts
   * @param direction Preferred sorting direction
   * @returns Geographically sorted tracts by centroid
   */
  private sortTractsByCentroid(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    if (tracts.length <= 1) return tracts;

    // Sort tracts by their centroid coordinates
    const sortedTracts = tracts.sort((a, b) => {
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

    return sortedTracts;
  }

  /**
   * Sort tracts using centroid coordinates (simple geographic approach)
   * @param tracts Array of tract features
   * @param direction Sort direction preference
   * @returns Sorted array of tracts
   */
  private sortTractsForContiguity(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    if (tracts.length <= 1) return tracts;

    // Use centroid-based sorting for better performance
    return this.sortTractsByCentroid(tracts, direction);
  }

  /**
   * Sort tracts using greedy directional traversal (Method 1 from Grok)
   * @param tracts Array of tract features
   * @param direction Sort direction preference
   * @returns Sorted array of tracts using greedy traversal
   */
  private sortTractsByGreedyTraversal(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    if (tracts.length <= 1) return tracts;

    try {
      // Build adjacency graph using northwest coordinates
      const adjacencyGraph = this.buildAdjacencyGraph(tracts);

      // Check if adjacency graph is viable
      const totalAdjacencies = Array.from(adjacencyGraph.values()).reduce((sum, neighbors) => sum + neighbors.length, 0);
      const averageAdjacencies = totalAdjacencies / tracts.length;

      if (averageAdjacencies < 0.1) {  // Relaxed from 1.0 to 0.1
        console.warn(`⚠️  Adjacency graph too sparse (${averageAdjacencies.toFixed(2)} avg neighbors), falling back to centroid sorting`);
        return this.sortTractsByCentroid(tracts, direction);
      }

      // Find starting tract (NW-most for lat-sort; SW-most for long-sort)
      const startTract = this.findStartingTract(tracts, direction);
      if (!startTract) {
        console.warn('Could not find starting tract, falling back to centroid sorting');
        return this.sortTractsByCentroid(tracts, direction);
      }

      // Perform greedy traversal
      const sortedTracts = this.performGreedyTraversal(tracts, adjacencyGraph, startTract, direction);

      return sortedTracts;
    } catch (error) {
      console.error('❌ Error in greedy traversal, falling back to centroid sorting:', error);
      return this.sortTractsByCentroid(tracts, direction);
    }
  }

  /**
   * Calculate the most northwest coordinate from a tract's polygon geometry
   * @param tract Tract feature with geometry
   * @returns Northwest coordinate {lat, lng}
   */
  private calculateNorthwestCoordinate(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry) {
      return { lat: 0, lng: 0 };
    }

    let northwestLat = -90; // Start with southernmost possible
    let northwestLng = 180; // Start with easternmost possible
    let coordinateCount = 0;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const [lng, lat] = coord;
          coordinateCount++;
          // Find the most northwest point: highest latitude (north) and lowest longitude (west)
          if (lat > northwestLat || (lat === northwestLat && lng < northwestLng)) {
            northwestLat = lat;
            northwestLng = lng;
          }
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const [lng, lat] = coord;
            coordinateCount++;
            // Find the most northwest point: highest latitude (north) and lowest longitude (west)
            if (lat > northwestLat || (lat === northwestLat && lng < northwestLng)) {
              northwestLat = lat;
              northwestLng = lng;
            }
          }
        }
      }
    }

    return { lat: northwestLat, lng: northwestLng };
  }

  /**
  * Check if two bounding boxes overlap or touch (with tolerance for floating-point precision)
  * @param boundsA First bounding box
  * @param boundsB Second bounding box
  * @returns True if boxes overlap or touch
  */
  private boundingBoxesOverlap(boundsA: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    boundsB: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean {
    const tolerance = 0.0001; // ~10m tolerance for floating-point precision

    return !(
      (boundsA.maxLat + tolerance < boundsB.minLat) ||
      (boundsA.minLat - tolerance > boundsB.maxLat) ||
      (boundsA.maxLng + tolerance < boundsB.minLng) ||
      (boundsA.minLng - tolerance > boundsB.maxLng)
    );
  }

  /**
   * Get the bounding box for a tract's polygon geometry
   * @param tract Tract feature with geometry
   * @returns Bounding box coordinates
   */
  private getTractBounds(tract: GeoJsonFeature): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    if (!this.isValidPolygon(tract.geometry)) {
      console.warn(`Invalid polygon geometry for tract ${this.getTractId(tract)}, using default bounds`);
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let processedCoords = 0;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const [lng, lat] = coord;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          processedCoords++;
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const [lng, lat] = coord;
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            processedCoords++;
          }
        }
      }
    }

    // Log if bounds seem invalid (no change from initial values)
    if (minLat === 90 || maxLat === -90 || minLng === 180 || maxLng === -180) {
      console.warn(`⚠️  Invalid bounds calculated for tract ${this.getTractId(tract)}: processed ${processedCoords} coords but bounds unchanged`);
    } else {
      if (processedCoords > 0) {
        // Bounds calculated but not logged
      }
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Get a unique identifier for a tract, with fallback for missing GEOID
   * @param tract Tract feature
   * @returns Unique tract identifier
   */
  private findMatchingS4Tract(northwest: { lat: number; lng: number }): S4TractData | null {
    // Get the state FIPS code from the first tract (assuming all tracts are from the same state)
    const stateFips = '04'; // Arizona FIPS code
    
    // Get S4 tract data for this state
    const s4Tracts = this.s4TractDataCache.get(stateFips);
    if (!s4Tracts) {
      return null;
    }

    // Find the closest S4 tract by northwest coordinate
    let closestTract: S4TractData | null = null;
    let closestDistance = Infinity;

    for (const s4Tract of s4Tracts) {
      // Parse the GEOID to extract county and tract information
      const geoid = s4Tract.GEOID;
      if (geoid.length !== 11) continue;
      
      const stateCode = geoid.substring(0, 2);
      const countyCode = geoid.substring(2, 5);
      const tractCode = geoid.substring(5, 11);
      
      // Use a simple coordinate-based distance calculation
      // This is a heuristic approach since we don't have actual coordinates for S4 tracts
      const estimatedLat = 32.0 + (parseInt(countyCode) % 10) * 0.5; // Rough latitude estimation
      const estimatedLng = -114.0 - (parseInt(tractCode) % 1000) * 0.001; // Rough longitude estimation
      
      const distance = Math.sqrt(
        Math.pow(northwest.lat - estimatedLat, 2) + 
        Math.pow(northwest.lng - estimatedLng, 2)
      );
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestTract = s4Tract;
      }
    }

    return closestTract;
  }

  private constructGEOIDFromProperties(tract: GeoJsonFeature): string | null {
    // Try to construct GEOID from state, county, tract components
    const state = tract.properties?.['STATE'] || tract.properties?.['STATEFP'] || tract.properties?.['STATE_FIPS'];
    const county = tract.properties?.['COUNTY'] || tract.properties?.['COUNTYFP'] || tract.properties?.['COUNTY_FIPS'];
    const tractNum = tract.properties?.['TRACT'] || tract.properties?.['TRACTCE'] || tract.properties?.['TRACT_FIPS'];
    
    if (state && county && tractNum) {
      // Construct GEOID: SSCCCTTTTTT (2+3+6 digits)
      const stateStr = state.toString().padStart(2, '0');
      const countyStr = county.toString().padStart(3, '0');
      const tractStr = tractNum.toString().padStart(6, '0');
      const geoid = stateStr + countyStr + tractStr;
      return geoid;
    }
    
    return null;
  }

  private getTractId(tract: GeoJsonFeature): string {
    // Debug: Log available properties for first few tracts
    // if (Math.random() < 0.001) {
    //   console.log('🔍 Available tract properties:', Object.keys(tract.properties || {}));
    //   console.log('🔍 Sample tract properties:', tract.properties);
    // }

    // Try GEOID first
    if (tract.properties?.['GEOID']) {
      return tract.properties['GEOID'];
    }

    // Try other possible ID fields
    if (tract.properties?.['geoid']) {
      return tract.properties['geoid'];
    }

    if (tract.properties?.['id']) {
      return tract.properties['id'];
    }

    // Try to construct GEOID from boundary data properties first
    const constructedGEOID = this.constructGEOIDFromProperties(tract);
    if (constructedGEOID && constructedGEOID.length === 11) {
      return constructedGEOID;
    }
    
    // Fallback: try to find a matching GEOID in S4 data by coordinates
    const northwest = this.getNorthwestCoordinate(tract);
    const matchingS4Tract = this.findMatchingS4Tract(northwest);
    if (matchingS4Tract) {
      console.log(`🔧 Found matching S4 tract: ${matchingS4Tract.GEOID} for coordinates (${northwest.lat.toFixed(6)}, ${northwest.lng.toFixed(6)})`);
      return matchingS4Tract.GEOID;
    }

    // Try TRACT_FIPS or similar - but only if it's a full GEOID
    if (tract.properties?.['TRACT_FIPS'] && tract.properties['TRACT_FIPS'].length >= 11) {
      return tract.properties['TRACT_FIPS'];
    }

    if (tract.properties?.['TRACTID']) {
      return tract.properties['TRACTID'];
    }

    // Fallback: use index-based ID
    const index = tract.properties?.['index'] || Math.random().toString(36).substr(2, 9);
    console.warn(`⚠️ Using fallback ID for tract, no state/county/tract found`);
    return `tract_${index}`;
  }


  /**
   * Validate that a polygon geometry has valid coordinates
   * @param geometry GeoJSON geometry
   * @returns True if valid polygon or multipolygon
   */
  private isValidPolygon(geometry: any): boolean {
    if (!geometry) return false;

    const type = geometry.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      console.warn(`Unsupported geometry type: ${type}`);
      return false;
    }

    if (!geometry.coordinates || !Array.isArray(geometry.coordinates)) {
      console.warn(`Invalid coordinates structure for geometry type ${type}`);
      return false;
    }

    let totalRings = 0;
    let totalCoords = 0;

    if (type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        if (!Array.isArray(ring) || ring.length < 4) {
          console.warn(`Invalid ring in Polygon: ${ring.length} coords (needs >=4 for closed polygon)`);
          return false;
        }
        totalRings++;
        for (const coord of ring) {
          if (!Array.isArray(coord) || coord.length < 2 ||
            typeof coord[0] !== 'number' || typeof coord[1] !== 'number' ||
            !isFinite(coord[0]) || !isFinite(coord[1])) {
            console.warn(`Invalid coordinate in Polygon ring: [${coord}]`);
            return false;
          }
          totalCoords++;
        }
      }
    } else if (type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        if (!Array.isArray(polygon)) {
          console.warn(`Invalid polygon in MultiPolygon`);
          return false;
        }
        for (const ring of polygon) {
          if (!Array.isArray(ring) || ring.length < 4) {
            console.warn(`Invalid ring in MultiPolygon: ${ring.length} coords`);
            return false;
          }
          totalRings++;
          for (const coord of ring) {
            if (!Array.isArray(coord) || coord.length < 2 ||
              typeof coord[0] !== 'number' || typeof coord[1] !== 'number' ||
              !isFinite(coord[0]) || !isFinite(coord[1])) {
              console.warn(`Invalid coordinate in MultiPolygon ring: [${coord}]`);
              return false;
            }
            totalCoords++;
          }
        }
      }
    }

    return true;
  }

  /**
   * Get the TIGER internal point from tract properties
   * @param tract Tract feature with TIGER internal point data
   * @returns Internal point coordinate {lat, lng}
   */
  private getTigerInternalPoint(tract: GeoJsonFeature): { lat: number; lng: number } {
    const intptlat = tract.properties?.['INTPTLAT'];
    const intptlon = tract.properties?.['INTPTLON'];

    // If TIGER internal points are not available, fall back to centroid
    if (intptlat === undefined || intptlon === undefined ||
      intptlat === null || intptlon === null ||
      (intptlat === 0 && intptlon === 0)) {
      console.warn(`⚠️  TIGER internal point not available for tract ${this.getTractId(tract)}, using centroid`);
      return this.calculateTractCentroid(tract);
    }

    return {
      lat: parseFloat(intptlat),
      lng: parseFloat(intptlon)
    };
  }


  /**
   * Get the pre-calculated northwest coordinate from tract properties
   * @param tract Tract feature with pre-calculated northwest coordinates
   * @returns Northwest coordinate {lat, lng}
   */
  private getNorthwestCoordinate(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry || (tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon')) {
      return { lat: 0, lng: 0 };
    }
    let maxLat = -Infinity;
    let minLng = Infinity;
    const processCoordinates = (coordinates: number[][]) => {
      for (const coord of coordinates) {
        if (coord.length >= 2) {
          const lng = coord[0];
          const lat = coord[1];
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
        }
      }
    };
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        processCoordinates(ring);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          processCoordinates(ring);
        }
      }
    }
    return { lat: maxLat, lng: minLng };
  }

  /**
   * Get state FIPS code from state abbreviation
   * @param state State abbreviation (e.g., 'CA', 'TX') or FIPS code
   * @returns State FIPS code
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
      throw new Error(`Invalid state abbreviation: ${state}`);
    }

    return fipsCode;
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

    for (const tract of tracts) {
      const centroid = this.calculateTractCentroid(tract);
      north = Math.max(north, centroid.lat);
      south = Math.min(south, centroid.lat);
      east = Math.max(east, centroid.lng);
      west = Math.min(west, centroid.lng);
    }

    return { north, south, east, west };
  }

  /**
   * Calculate bounds for a single tract
   */
  private calculateSingleTractBounds(tract: GeoJsonFeature): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    const coords = this.getAllCoordinates(tract);
    if (coords.length === 0) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    
    for (const coord of coords) {
      const [lng, lat] = coord;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }

    return { minLat, maxLat, minLng, maxLng };
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
    for (const tract of tracts) {
      const centroid = this.calculateTractCentroid(tract);
      totalLat += centroid.lat;
      totalLng += centroid.lng;
    }

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
    if (!tract.geometry || tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon') {
      return { lat: 0, lng: 0 };
    }

    let totalLat = 0, totalLng = 0, pointCount = 0;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          totalLng += coord[0];
          totalLat += coord[1];
          pointCount++;
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            totalLng += coord[0];
            totalLat += coord[1];
            pointCount++;
          }
        }
      }
    }

    return pointCount > 0 ? { lat: totalLat / pointCount, lng: totalLng / pointCount } : { lat: 0, lng: 0 };
  }

  /**
   * Create a step object
   * @param iteration Iteration number
   * @param stepNumber Step number
   * @param groups District groups
   * @param description Step description
   * @param direction Division direction
   * @returns Step object
   */
  private createStep(iteration: number, stepNumber: number, groups: DistrictGroup[], description: string, direction: string): GeodistrictStep {
    return {
      step: stepNumber,
      level: iteration,
      districtGroups: groups,
      description,
      totalGroups: groups.length,
      totalDistricts: groups.reduce((sum, group) => sum + group.totalDistricts, 0),
      divisionDirection: direction as 'latitude' | 'longitude'
    };
  }

  /**
   * Calculate optimal division for a group
   * @param totalDistricts Total number of districts
   * @returns Division object
   */
  private calculateOptimalDivision(totalDistricts: number): { ratio: [number, number]; first: number; second: number } {
    if (totalDistricts === 1) {
      return { ratio: [100, 0], first: 1, second: 0 };
    }

    const firstGroupDistricts = Math.ceil(totalDistricts / 2);
    const secondGroupDistricts = totalDistricts - firstGroupDistricts;

    const firstRatio = Math.round((firstGroupDistricts / totalDistricts) * 100);
    const secondRatio = 100 - firstRatio;

    return { ratio: [firstRatio, secondRatio], first: firstGroupDistricts, second: secondGroupDistricts };
  }

  /**
   * Validate that tracts in a group are contiguous (simplified - always returns true)
   * @param tracts Array of tract features
   * @param groupName Name of the group for logging
   * @returns Always true (no contiguity checking)
   */
  private validateContiguity(tracts: GeoJsonFeature[], groupName: string): boolean {
    console.log(`✅ ${groupName}: Contiguity check skipped (${tracts.length} tracts)`);
    return true;
  }

  /**
   * Fix contiguity in division (simplified - returns original groups)
   * @param sortedTracts Sorted tracts
   * @param divisionIndex Division index
   * @param group Original group
   * @param division Division object
   * @returns Fixed groups
   */
  private fixContiguityInDivision(sortedTracts: GeoJsonFeature[], divisionIndex: number, group: DistrictGroup, division: { ratio: [number, number]; first: number; second: number }): { groups: DistrictGroup[]; history: string[] } {
    // Simplified - just return the original division without contiguity fixes
    const totalPopulation = sortedTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;

    let cumulativePopulation = 0;
    let actualDivisionIndex = 0;

    for (let i = 0; i < sortedTracts.length; i++) {
      cumulativePopulation += sortedTracts[i].properties?.POPULATION || 0;
      if (cumulativePopulation >= targetFirstGroupPopulation) {
        actualDivisionIndex = i + 1;
        break;
      }
    }

    const firstGroupTracts = sortedTracts.slice(0, actualDivisionIndex);
    const secondGroupTracts = sortedTracts.slice(actualDivisionIndex);

    const groups: DistrictGroup[] = [
      {
        startDistrictNumber: 1,
        endDistrictNumber: Math.ceil(division.ratio[0] / 100 * (firstGroupTracts.length + secondGroupTracts.length)),
        censusTracts: firstGroupTracts,
        totalDistricts: Math.ceil(division.ratio[0] / 100 * (firstGroupTracts.length + secondGroupTracts.length)),
        totalPopulation: firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
        bounds: this.calculateBounds(firstGroupTracts),
        centroid: this.calculateCentroid(firstGroupTracts)
      },
      {
        startDistrictNumber: Math.ceil(division.ratio[0] / 100 * (firstGroupTracts.length + secondGroupTracts.length)) + 1,
        endDistrictNumber: firstGroupTracts.length + secondGroupTracts.length,
        censusTracts: secondGroupTracts,
        totalDistricts: Math.floor(division.ratio[1] / 100 * (firstGroupTracts.length + secondGroupTracts.length)),
        totalPopulation: secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
        bounds: this.calculateBounds(secondGroupTracts),
        centroid: this.calculateCentroid(secondGroupTracts)
      }
    ];

    return {
      groups,
      history: [`Division completed: ${firstGroupTracts.length} + ${secondGroupTracts.length} tracts`]
    };
  }

  /**
   * Find the optimal dividing line using iterative approach
   * @param tracts Array of tract features
   * @param direction Division direction (latitude or longitude)
   * @param targetPopulation Target population for first group
   * @returns Optimal dividing line coordinate
   */
  private findOptimalDividingLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', targetPopulation: number): number {
    console.log(`🔍 Finding optimal ${direction} dividing line for target population: ${targetPopulation.toLocaleString()}`);

    // Get the range of coordinates for the direction using bounding boxes
    const bounds = tracts.map(tract => this.getTractBounds(tract));

    let minCoord: number, maxCoord: number;
    if (direction === 'latitude') {
      minCoord = Math.min(...bounds.map(b => b.minLat));
      maxCoord = Math.max(...bounds.map(b => b.maxLat));
    } else {
      minCoord = Math.min(...bounds.map(b => b.minLng));
      maxCoord = Math.max(...bounds.map(b => b.maxLng));
    }
    const centerCoord = (minCoord + maxCoord) / 2;

    console.log(`📍 Coordinate range: ${minCoord.toFixed(6)} to ${maxCoord.toFixed(6)}, center: ${centerCoord.toFixed(6)}`);

    // Start with center coordinate and iterate to find optimal position
    let currentLine = centerCoord;
    let bestLine = centerCoord;
    let bestDifference = Infinity;
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.0001; // About 10 meters

    while (iterations < maxIterations) {
      // Calculate populations on each side of the line
      const { firstGroupPopulation, secondGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, currentLine);

      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      console.log(`  Iteration ${iterations + 1}: Line at ${currentLine.toFixed(6)}, populations: ${firstGroupPopulation.toLocaleString()} vs ${secondGroupPopulation.toLocaleString()}, difference: ${difference.toLocaleString()}`);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = currentLine;
      }

      // If we're close enough, stop
      if (difference < targetPopulation * 0.01) { // Within 1% of target
        console.log(`✅ Found optimal line at ${currentLine.toFixed(6)} within 1% tolerance`);
        break;
      }

      // Calculate adjustment based on population difference
      const populationDifference = firstGroupPopulation - targetPopulation;
      const populationRatio = Math.abs(populationDifference) / targetPopulation;

      // Determine direction to move the line
      let adjustment: number;
      if (direction === 'latitude') {
        // For latitude: if first group has too many people, move line north (increase latitude)
        // if first group has too few people, move line south (decrease latitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      } else {
        // For longitude: if first group has too many people, move line east (increase longitude)
        // if first group has too few people, move line west (decrease longitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      }

      console.log(`    Population difference: ${populationDifference.toLocaleString()}, adjustment: ${adjustment.toFixed(6)}`);

      // Prevent infinite loops by ensuring we don't go outside bounds
      const newLine = Math.max(minCoord, Math.min(maxCoord, currentLine + adjustment));

      if (Math.abs(newLine - currentLine) < tolerance) {
        console.log(`✅ Converged at line ${currentLine.toFixed(6)}`);
        break;
      }

      currentLine = newLine;
      iterations++;
    }

    console.log(`🎯 Final optimal ${direction} line: ${bestLine.toFixed(6)} (${iterations} iterations)`);

    // If we didn't converge well, try binary search as fallback
    if (bestDifference > targetPopulation * 0.05) { // If still >5% off target
      console.log(`🔄 Iterative approach didn't converge well (${bestDifference.toLocaleString()} difference), trying binary search...`);
      const binarySearchLine = this.binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord);
      const binarySearchDifference = Math.abs(this.calculatePopulationsByLine(tracts, direction, binarySearchLine).firstGroupPopulation - targetPopulation);

      if (binarySearchDifference < bestDifference) {
        console.log(`✅ Binary search found better line: ${binarySearchLine.toFixed(6)} (difference: ${binarySearchDifference.toLocaleString()})`);
        return binarySearchLine;
      }
    }

    return bestLine;
  }

  /**
   * Binary search for optimal dividing line
   * @param tracts Array of tract features
   * @param direction Division direction
   * @param targetPopulation Target population for first group
   * @param minCoord Minimum coordinate
   * @param maxCoord Maximum coordinate
   * @returns Optimal line coordinate
   */
  private binarySearchOptimalLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', targetPopulation: number, minCoord: number, maxCoord: number): number {
    console.log(`🔍 Binary search for optimal ${direction} line between ${minCoord.toFixed(6)} and ${maxCoord.toFixed(6)} using bounding box intersection`);

    let left = minCoord;
    let right = maxCoord;
    let bestLine = (left + right) / 2;
    let bestDifference = Infinity;
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.0001;

    while (iterations < maxIterations && (right - left) > tolerance) {
      const mid = (left + right) / 2;
      const { firstGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, mid);
      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      console.log(`  Binary search iteration ${iterations + 1}: Line at ${mid.toFixed(6)}, population: ${firstGroupPopulation.toLocaleString()}, difference: ${difference.toLocaleString()}`);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = mid;
      }

      // If we're close enough, stop
      if (difference < targetPopulation * 0.01) {
        console.log(`✅ Binary search found optimal line at ${mid.toFixed(6)} within 1% tolerance`);
        return mid;
      }

      // Adjust search bounds based on population
      if (firstGroupPopulation < targetPopulation) {
        // Need more population in first group
        if (direction === 'latitude') {
          right = mid; // ✅ Move line south (lower lat) to include more northern tracts
        } else {
          left = mid; // ✅ Move line east (higher lng) to include more western tracts
        }
      } else {
        // Too much population in first group
        if (direction === 'latitude') {
          left = mid; // ✅ Move line north (higher lat) to exclude northern tracts
        } else {
          right = mid; // ✅ Move line west (lower lng) to exclude western tracts
        }
      }

      iterations++;
    }

    console.log(`🎯 Binary search completed: ${bestLine.toFixed(6)} (${iterations} iterations, difference: ${bestDifference.toLocaleString()})`);
    return bestLine;
  }

  /**
   * Calculate populations on each side of a dividing line using entire tract geometry
   * @param tracts Array of tract features
   * @param direction Division direction
   * @param lineCoordinate Line coordinate
   * @returns Populations for each side
   */
  private calculatePopulationsByLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', lineCoordinate: number): {
    firstGroupPopulation: number;
    secondGroupPopulation: number;
  } {
    let firstGroupPopulation = 0;
    let secondGroupPopulation = 0;

    for (const tract of tracts) {
      const population = tract.properties?.POPULATION || 0;
      const isEntirelyNorthOrWest = this.isTractEntirelyNorthOrWest(tract, direction, lineCoordinate);

      if (isEntirelyNorthOrWest) {
        firstGroupPopulation += population;
      } else {
        secondGroupPopulation += population;
      }
    }

    return { firstGroupPopulation, secondGroupPopulation };
  }

  /**
   * Divide tracts by a lat/long line using entire tract geometry
   * @param tracts Array of tract features
   * @param direction Division direction
   * @param lineCoordinate Line coordinate
   * @returns Divided tract groups
   */
  private divideTractsByLine(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', lineCoordinate: number): {
    firstGroupTracts: GeoJsonFeature[];
    secondGroupTracts: GeoJsonFeature[];
  } {
    const firstGroupTracts: GeoJsonFeature[] = [];
    const secondGroupTracts: GeoJsonFeature[] = [];

    for (const tract of tracts) {
      const isEntirelyNorthOrWest = this.isTractEntirelyNorthOrWest(tract, direction, lineCoordinate);

      if (isEntirelyNorthOrWest) {
        firstGroupTracts.push(tract);
      } else {
        secondGroupTracts.push(tract);
      }
    }

    console.log(`📊 Divided ${tracts.length} tracts by entire geometry: ${firstGroupTracts.length} + ${secondGroupTracts.length} by ${direction} line at ${lineCoordinate.toFixed(6)}`);

    // Fix isolated tracts after division
    const fixedResult = this.fixIsolatedTractsAfterDivision(firstGroupTracts, secondGroupTracts, tracts);
    
    return { 
      firstGroupTracts: fixedResult.firstGroupTracts, 
      secondGroupTracts: fixedResult.secondGroupTracts 
    };
  }

  /**
   * Fix isolated tracts after division by moving them to the group containing their container
   * @param firstGroupTracts First group of tracts
   * @param secondGroupTracts Second group of tracts
   * @param allTracts All tracts in the original dataset
   * @returns Fixed tract groups
   */
  private fixIsolatedTractsAfterDivision(
    firstGroupTracts: GeoJsonFeature[],
    secondGroupTracts: GeoJsonFeature[],
    allTracts: GeoJsonFeature[]
  ): {
    firstGroupTracts: GeoJsonFeature[];
    secondGroupTracts: GeoJsonFeature[];
  } {
    console.log(`🔧 FIX ISOLATED TRACTS: Starting isolated tract detection for ${allTracts.length} total tracts`);
    const movedTracts: { tractId: string; fromGroup: string; toGroup: string }[] = [];
    
    // Detect enclosed tracts (allow large datasets for isolated tract fixing)
    const enclosedMap = this.findContainedTracts(allTracts, true);
    
    // Debug: Log the enclosed relationships found
    if (enclosedMap.length > 0) {
      console.log(`🔍 Found ${enclosedMap.length} enclosed tract relationships:`);
      for (const rel of enclosedMap) {
        console.log(`   ${rel.contained} is enclosed by ${rel.container}`);
      }
    } else {
      console.log(`🔧 FIX ISOLATED TRACTS: No enclosed tracts found, but will check for isolated tracts`);
    }
    
        // Debug: Log some sample tract IDs to see what we're working with
        if (allTracts.length > 0) {
          console.log(`🔍 Sample tract IDs in dataset:`);
          for (let i = 0; i < Math.min(5, allTracts.length); i++) {
            const tractId = this.getTractId(allTracts[i]);
            console.log(`   ${i}: ${tractId}`);
          }
          
          // Check specifically for tract 001700
          const tract001700 = allTracts.find(tract => this.getTractId(tract).includes('001700'));
          if (tract001700) {
            console.log(`🎯 FOUND TRACT 001700: ${this.getTractId(tract001700)} in dataset!`);
          } else {
            console.log(`❌ TRACT 001700 NOT FOUND in dataset`);
          }
      
      // Analyze which counties are in the dataset
      const counties = new Set<string>();
      allTracts.forEach(tract => {
        const tractId = this.getTractId(tract);
        if (tractId && tractId.length >= 5) {
          const county = tractId.substring(2, 5); // Extract county code
          counties.add(county);
        }
      });
      
      const sortedCounties = Array.from(counties).sort();
      console.log(`🏛️ Counties in dataset: ${sortedCounties.join(', ')}`);
      
      // Check for missing key counties
      const keyCounties = ['001', '003', '005', '007', '009', '011', '012', '013', '015', '017', '019', '021', '023', '025', '027'];
      const missingCounties = keyCounties.filter(county => !counties.has(county));
      if (missingCounties.length > 0) {
        console.log(`⚠️ Missing counties from dataset: ${missingCounties.join(', ')}`);
        if (missingCounties.includes('005')) {
          console.log(`🚨 County 005 (Coconino) is missing - tract 001700 may not be available`);
        }
      }
      
      // Check if our target tracts are in the dataset
      const targetTracts = ['04001001700', '04001001901', '04005001700'];
      for (const targetTract of targetTracts) {
        const found = allTracts.find(tract => this.getTractId(tract) === targetTract);
        console.log(`🎯 Target tract ${targetTract}: ${found ? 'FOUND' : 'NOT FOUND'}`);
      }
    }
    
    let updatedFirstGroup = [...firstGroupTracts];
    let updatedSecondGroup = [...secondGroupTracts];
    
    // Check each enclosed tract for isolation
    for (const relationship of enclosedMap) {
      const enclosedId = relationship.contained;
      const containerId = relationship.container;
      
      // Debug: Check if these are the specific tracts we're looking for
      if (enclosedId.includes('001700') || enclosedId.includes('001901') || 
          containerId.includes('001700') || containerId.includes('001901') ||
          enclosedId === '04001001700' || enclosedId === '04001001901' ||
          containerId === '04001001700' || containerId === '04001001901') {
        console.log(`🎯 Found target tract in relationship: ${enclosedId} enclosed by ${containerId}`);
      }
      
      // Find the enclosed tract and its container in the groups
      const enclosedTract = allTracts.find(tract => this.getTractId(tract) === enclosedId);
      const containerTract = allTracts.find(tract => this.getTractId(tract) === containerId);
      
      if (!enclosedTract || !containerTract) continue;
      
      // Check which group each tract is in
      const enclosedInFirst = updatedFirstGroup.some(tract => this.getTractId(tract) === enclosedId);
      const enclosedInSecond = updatedSecondGroup.some(tract => this.getTractId(tract) === enclosedId);
      const containerInFirst = updatedFirstGroup.some(tract => this.getTractId(tract) === containerId);
      const containerInSecond = updatedSecondGroup.some(tract => this.getTractId(tract) === containerId);
      
      // Debug: Show group assignments for target tracts
      if (enclosedId.includes('001700') || enclosedId.includes('001901') || 
          containerId.includes('001700') || containerId.includes('001901') ||
          enclosedId === '04001001700' || enclosedId === '04001001901' ||
          containerId === '04001001700' || containerId === '04001001901') {
        console.log(`🎯 Group assignments: enclosed=${enclosedId} (first:${enclosedInFirst}, second:${enclosedInSecond}), container=${containerId} (first:${containerInFirst}, second:${containerInSecond})`);
      }
      
      // If enclosed tract is in a different group than its container, move it
      if (enclosedInFirst && containerInSecond) {
        // Move enclosed tract from first group to second group
        updatedFirstGroup = updatedFirstGroup.filter(tract => this.getTractId(tract) !== enclosedId);
        updatedSecondGroup.push(enclosedTract);
        movedTracts.push({
          tractId: enclosedId,
          fromGroup: 'first',
          toGroup: 'second'
        });
        console.log(`📦 Fixed isolated tract: ${enclosedId} moved to be with container ${containerId}`);
      } else if (enclosedInSecond && containerInFirst) {
        // Move enclosed tract from second group to first group
        updatedSecondGroup = updatedSecondGroup.filter(tract => this.getTractId(tract) !== enclosedId);
        updatedFirstGroup.push(enclosedTract);
        movedTracts.push({
          tractId: enclosedId,
          fromGroup: 'second',
          toGroup: 'first'
        });
        console.log(`📦 Fixed isolated tract: ${enclosedId} moved to be with container ${containerId}`);
      }
    }
    
    // Handle truly isolated tracts (not enclosed, but isolated by the division line)
    // First, check problematic tracts that were checked but found no containment
    const problematicTractIds = ['04025001901', '04012020505', '04001970502'];
    const checkedProblematicTracts = new Set<string>();
    
    for (const tractId of problematicTractIds) {
      const tract = allTracts.find(t => this.getTractId(t) === tractId);
      if (!tract) continue;
      
      // Check if this tract was already handled (moved as enclosed)
      if (movedTracts.some(m => m.tractId === tractId)) continue;
      
      // Check if it's in the enclosed map
      if (enclosedMap.some(e => e.contained === tractId)) continue;
      
      // This tract is truly isolated - check adjacency to move it to the right group
      const inFirst = updatedFirstGroup.some(t => this.getTractId(t) === tractId);
      const inSecond = updatedSecondGroup.some(t => this.getTractId(t) === tractId);
      
      if (!inFirst && !inSecond) continue; // Not in either group
      
      checkedProblematicTracts.add(tractId);
      this.moveIsolatedTractToBetterGroup(tractId, tract, updatedFirstGroup, updatedSecondGroup, allTracts, movedTracts);
    }
    
    // Now check for ANY isolated tracts (not just problematic ones)
    // A tract is isolated if it has no neighbors in its own group
    console.log(`🔍 Checking for any isolated tracts (no neighbors in their group)...`);
    
    // Build adjacency graph once for efficiency
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    
    // Check all tracts in both groups for isolation
    const allTractsInGroups = [...updatedFirstGroup, ...updatedSecondGroup];
    
    for (const tract of allTractsInGroups) {
      const tractId = this.getTractId(tract);
      
      // Skip if already handled
      if (movedTracts.some(m => m.tractId === tractId)) continue;
      if (enclosedMap.some(e => e.contained === tractId)) continue;
      if (checkedProblematicTracts.has(tractId)) continue; // Already checked above
      
      const inFirst = updatedFirstGroup.some(t => this.getTractId(t) === tractId);
      const inSecond = updatedSecondGroup.some(t => this.getTractId(t) === tractId);
      
      if (!inFirst && !inSecond) continue;
      
      const neighbors = adjacencyGraph.get(tractId) || [];
      
      // Count neighbors in each group
      let neighborsInFirst = 0;
      let neighborsInSecond = 0;
      
      for (const neighborId of neighbors) {
        if (updatedFirstGroup.some(t => this.getTractId(t) === neighborId)) {
          neighborsInFirst++;
        } else if (updatedSecondGroup.some(t => this.getTractId(t) === neighborId)) {
          neighborsInSecond++;
        }
      }
      
      // Check if tract is isolated (no neighbors in its own group)
      const isIsolated = (inFirst && neighborsInFirst === 0) || (inSecond && neighborsInSecond === 0);
      
      if (isIsolated && neighbors.length > 0) {
        console.log(`🚨 Found isolated tract ${tractId}: ${neighbors.length} total neighbors, but ${inFirst ? neighborsInFirst : neighborsInSecond} in own group`);
        this.moveIsolatedTractToBetterGroup(tractId, tract, updatedFirstGroup, updatedSecondGroup, allTracts, movedTracts);
      }
    }
    
    if (movedTracts.length > 0) {
      console.log(`✅ Fixed ${movedTracts.length} isolated tracts`);
    }
    
    return {
      firstGroupTracts: updatedFirstGroup,
      secondGroupTracts: updatedSecondGroup
    };
  }

  /**
   * Move an isolated tract to the group with more neighbors
   * @param tractId Tract ID to move
   * @param tract Tract feature
   * @param updatedFirstGroup First group (modified in place)
   * @param updatedSecondGroup Second group (modified in place)
   * @param allTracts All tracts for adjacency lookup
   * @param movedTracts Array to track moved tracts
   */
  private moveIsolatedTractToBetterGroup(
    tractId: string,
    tract: GeoJsonFeature,
    updatedFirstGroup: GeoJsonFeature[],
    updatedSecondGroup: GeoJsonFeature[],
    allTracts: GeoJsonFeature[],
    movedTracts: { tractId: string; fromGroup: string; toGroup: string }[]
  ): void {
    const inFirst = updatedFirstGroup.some(t => this.getTractId(t) === tractId);
    const inSecond = updatedSecondGroup.some(t => this.getTractId(t) === tractId);
    
    if (!inFirst && !inSecond) return; // Not in either group
    
    console.log(`🔍 Checking adjacency for isolated tract ${tractId}...`);
    
    // Build adjacency graph if not already built
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(allTracts);
    const neighbors = adjacencyGraph.get(tractId) || [];
    
    if (neighbors.length === 0) {
      console.log(`⚠️ Isolated tract ${tractId} has no neighbors - keeping in current group`);
      return;
    }
    
    // Count neighbors in each group
    let neighborsInFirst = 0;
    let neighborsInSecond = 0;
    
    for (const neighborId of neighbors) {
      if (updatedFirstGroup.some(t => this.getTractId(t) === neighborId)) {
        neighborsInFirst++;
      } else if (updatedSecondGroup.some(t => this.getTractId(t) === neighborId)) {
        neighborsInSecond++;
      }
    }
    
    console.log(`   ${tractId} has ${neighbors.length} neighbors: ${neighborsInFirst} in first group, ${neighborsInSecond} in second group`);
    
    // Move to the group with more neighbors
    // If equal, move to the group where it has at least one neighbor (rather than staying isolated)
    // If truly isolated (0 neighbors in own group), force move to the group with neighbors
    if (inFirst && (neighborsInSecond > neighborsInFirst || (neighborsInFirst === 0 && neighborsInSecond > 0))) {
      // Remove from first group (modify in place)
      const index = updatedFirstGroup.findIndex(t => this.getTractId(t) === tractId);
      if (index >= 0) {
        updatedFirstGroup.splice(index, 1);
      }
      updatedSecondGroup.push(tract);
      movedTracts.push({
        tractId: tractId,
        fromGroup: 'first',
        toGroup: 'second'
      });
      console.log(`📦 Moved isolated tract ${tractId} from first to second group (${neighborsInSecond} neighbors vs ${neighborsInFirst})`);
    } else if (inSecond && (neighborsInFirst > neighborsInSecond || (neighborsInSecond === 0 && neighborsInFirst > 0))) {
      // Remove from second group (modify in place)
      const index = updatedSecondGroup.findIndex(t => this.getTractId(t) === tractId);
      if (index >= 0) {
        updatedSecondGroup.splice(index, 1);
      }
      updatedFirstGroup.push(tract);
      movedTracts.push({
        tractId: tractId,
        fromGroup: 'second',
        toGroup: 'first'
      });
      console.log(`📦 Moved isolated tract ${tractId} from second to first group (${neighborsInFirst} neighbors vs ${neighborsInSecond})`);
    } else {
      // Check if truly isolated (no neighbors in own group)
      const isTrulyIsolated = (inFirst && neighborsInFirst === 0) || (inSecond && neighborsInSecond === 0);
      if (isTrulyIsolated && neighbors.length > 0) {
        // Force move to the group with neighbors, even if it's a tie
        if (neighborsInSecond > 0 && inFirst) {
          const index = updatedFirstGroup.findIndex(t => this.getTractId(t) === tractId);
          if (index >= 0) {
            updatedFirstGroup.splice(index, 1);
          }
          updatedSecondGroup.push(tract);
          movedTracts.push({
            tractId: tractId,
            fromGroup: 'first',
            toGroup: 'second'
          });
          console.log(`📦 Force moved isolated tract ${tractId} from first to second group (has ${neighborsInSecond} neighbors in second, 0 in first)`);
        } else if (neighborsInFirst > 0 && inSecond) {
          const index = updatedSecondGroup.findIndex(t => this.getTractId(t) === tractId);
          if (index >= 0) {
            updatedSecondGroup.splice(index, 1);
          }
          updatedFirstGroup.push(tract);
          movedTracts.push({
            tractId: tractId,
            fromGroup: 'second',
            toGroup: 'first'
          });
          console.log(`📦 Force moved isolated tract ${tractId} from second to first group (has ${neighborsInFirst} neighbors in first, 0 in second)`);
        } else {
          console.log(`   Keeping ${tractId} in current group (has ${inFirst ? neighborsInFirst : neighborsInSecond} neighbors there)`);
        }
      } else {
        console.log(`   Keeping ${tractId} in current group (has more neighbors there)`);
      }
    }
  }

  /**
   * Build adjacency graph using northwest coordinates and bounding box overlap
   * @param tracts Array of tract features
   * @returns Map of tract ID to adjacent tract IDs
   */
  private buildAdjacencyGraph(tracts: GeoJsonFeature[]): Map<string, string[]> {
    console.log(`🔗 Building adjacency graph for ${tracts.length} tracts using northwest coordinates`);

    const adjacencyGraph = new Map<string, string[]>();
    const tractMap = new Map<string, GeoJsonFeature>();

    // Initialize graph and create tract map
    for (const tract of tracts) {
      const tractId = this.getTractId(tract);
      if (tractId && tractId !== 'Unknown') {
        adjacencyGraph.set(tractId, []);
        tractMap.set(tractId, tract);
      } else {
        console.warn(`⚠️  Skipping tract with invalid ID: ${tractId}`);
      }
    }

    // Build adjacency relationships using northwest coordinates and bounding box overlap
    for (let i = 0; i < tracts.length; i++) {
      const tractA = tracts[i];
      const tractIdA = this.getTractId(tractA);

      // Skip tracts with invalid IDs
      if (!tractIdA || tractIdA === 'Unknown' || !adjacencyGraph.has(tractIdA)) {
        continue;
      }

      const boundsA = this.getTractBounds(tractA);
      const northwestA = this.getNorthwestCoordinate(tractA);

      for (let j = i + 1; j < tracts.length; j++) {
        const tractB = tracts[j];
        const tractIdB = this.getTractId(tractB);

        // Skip tracts with invalid IDs
        if (!tractIdB || tractIdB === 'Unknown' || !adjacencyGraph.has(tractIdB)) {
          continue;
        }

        const boundsB = this.getTractBounds(tractB);
        const northwestB = this.getNorthwestCoordinate(tractB);

        // Check if bounding boxes overlap (performance optimization)
        if (this.boundingBoxesOverlap(boundsA, boundsB)) {
          // Use a more sophisticated adjacency check
          const isAdjacent = this.areTractsAdjacent(tractA, tractB, boundsA, boundsB);

          if (isAdjacent) {
            // Add bidirectional adjacency
            const neighborsA = adjacencyGraph.get(tractIdA);
            const neighborsB = adjacencyGraph.get(tractIdB);

            if (neighborsA && neighborsB) {
              neighborsA.push(tractIdB);
              neighborsB.push(tractIdA);
            } else {
              console.warn(`⚠️  Missing adjacency arrays for tracts ${tractIdA} or ${tractIdB}`);
            }
          }
        } else {
          // Debug: Log some non-overlapping cases
          if (i < 3 && j < 3) {
            console.log(`🔍 Non-overlapping: ${tractIdA} vs ${tractIdB}`);
            console.log(`  Bounds A: (${boundsA.minLat.toFixed(6)}, ${boundsA.minLng.toFixed(6)}) to (${boundsA.maxLat.toFixed(6)}, ${boundsA.maxLng.toFixed(6)})`);
            console.log(`  Bounds B: (${boundsB.minLat.toFixed(6)}, ${boundsB.minLng.toFixed(6)}) to (${boundsB.maxLat.toFixed(6)}, ${boundsB.maxLng.toFixed(6)})`);
          }
        }
      }
    }

    // Log adjacency statistics
    const totalAdjacencies = Array.from(adjacencyGraph.values()).reduce((sum, neighbors) => sum + neighbors.length, 0);
    const averageAdjacencies = totalAdjacencies / tracts.length;
    const connectedTracts = Array.from(adjacencyGraph.values()).filter(neighbors => neighbors.length > 0).length;
    console.log(`✅ Adjacency graph built: ${totalAdjacencies} total adjacencies, ${averageAdjacencies.toFixed(1)} average per tract`);
    console.log(`🔗 Connected tracts: ${connectedTracts}/${tracts.length} (${(connectedTracts / tracts.length * 100).toFixed(1)}%)`);

    // Log some sample adjacencies for debugging
    const sampleTracts = Array.from(adjacencyGraph.entries()).slice(0, 3);
    for (const [tractId, neighbors] of sampleTracts) {
      console.log(`📍 Tract ${tractId}: ${neighbors.length} neighbors`);
    }

    // Debug: Show some sample bounding boxes
    console.log(`🔍 Sample bounding boxes:`);
    for (let i = 0; i < Math.min(3, tracts.length); i++) {
      const tract = tracts[i];
      const tractId = this.getTractId(tract);
      const bounds = this.getTractBounds(tract);
      console.log(`  ${tractId}: (${bounds.minLat.toFixed(6)}, ${bounds.minLng.toFixed(6)}) to (${bounds.maxLat.toFixed(6)}, ${bounds.maxLng.toFixed(6)})`);
    }

    return adjacencyGraph;
  }

  /**
   * Find the northwest most census tract
   * @param tracts Array of tract features
   * @returns Northwest most tract
   */
  private findNorthwestMostTract(tracts: GeoJsonFeature[]): GeoJsonFeature | null {
    console.log(`🔍 Finding northwest most tract from ${tracts.length} tracts using extreme coordinates`);
    let bestTract: GeoJsonFeature | null = null;
    let bestScore = -Infinity;
    const topCandidates: Array<{ tract: GeoJsonFeature; coord: { lat: number; lng: number }; score: number }> = [];

    for (const tract of tracts) {
      const northwest = this.getNorthwestCoordinate(tract);
      if (northwest.lat === 0 || northwest.lng === Infinity) continue; // Invalid coordinates

      // Score: Prioritize north (max lat) first, then west (min lng, more negative)
      // Higher score = more northwest: lat * 100 (north first) - lng (west second)
      const score = northwest.lat * 100 - northwest.lng;

      topCandidates.push({ tract, coord: northwest, score });

      if (score > bestScore) {
        bestScore = score;
        bestTract = tract;
      }
    }

    // Log top 5 candidates
    topCandidates.sort((a, b) => b.score - a.score);
    console.log(`🔍 Top 5 northwest candidates (prioritizing north first, then west):`);
    topCandidates.slice(0, 5).forEach((candidate, index) => {
      const tractId = this.getTractId(candidate.tract);
      console.log(`  ${index + 1}. ${tractId}: (${candidate.coord.lat.toFixed(6)}, ${candidate.coord.lng.toFixed(6)}) score: ${candidate.score.toFixed(6)}`);
    });

    if (bestTract) {
      const bestId = this.getTractId(bestTract);
      const bestCoord = this.getNorthwestCoordinate(bestTract);
      console.log(`📍 Selected northwest most tract: ${bestId} at (${bestCoord.lat.toFixed(6)}, ${bestCoord.lng.toFixed(6)}) with score ${bestScore.toFixed(6)}`);
    } else {
      console.warn(`⚠️ No valid northwest tract found`);
    }

    return bestTract;
  }

  /**
   * Find the southwest-most tract from a collection of tracts
   * @param tracts Array of tracts to search
   * @returns Southwest-most tract or null if none found
   */
  private findSouthwestMostTract(tracts: GeoJsonFeature[]): GeoJsonFeature | null {
    console.log(`🔍 Finding southwest most tract from ${tracts.length} tracts using extreme coordinates`);
    let bestTract: GeoJsonFeature | null = null;
    let bestScore = -Infinity;
    const topCandidates: Array<{ tract: GeoJsonFeature; coord: { lat: number; lng: number }; score: number }> = [];

    for (const tract of tracts) {
      const southwest = this.getSouthwestCoordinate(tract);
      if (southwest.lat === 0 || southwest.lng === Infinity) continue; // Invalid coordinates

      // Score: Prioritize west (min lng, more negative) first, then south (min lat)
      // Higher score = more southwest: -lng * 100 (west first) - lat (south second)
      // This gives west bias for longitude division (rotated 90° CCW from latitude's north-first bias)
      const score = -southwest.lng * 100 - southwest.lat;

      topCandidates.push({ tract, coord: southwest, score });

      if (score > bestScore) {
        bestScore = score;
        bestTract = tract;
      }
    }

    // Log top 5 candidates
    topCandidates.sort((a, b) => b.score - a.score);
    console.log(`🔍 Top 5 southwest candidates (prioritizing west first, then south):`);
    topCandidates.slice(0, 5).forEach((candidate, index) => {
      const tractId = this.getTractId(candidate.tract);
      console.log(`  ${index + 1}. ${tractId}: (${candidate.coord.lat.toFixed(6)}, ${candidate.coord.lng.toFixed(6)}) score: ${candidate.score.toFixed(6)}`);
    });

    if (bestTract) {
      const bestId = this.getTractId(bestTract);
      const bestCoord = this.getSouthwestCoordinate(bestTract);
      console.log(`📍 Selected southwest most tract: ${bestId} at (${bestCoord.lat.toFixed(6)}, ${bestCoord.lng.toFixed(6)}) with score ${bestScore.toFixed(6)}`);
    } else {
      console.warn(`⚠️ No valid southwest tract found`);
    }

    return bestTract;
  }


  /**
   * Find nearby tracts by coordinates (fallback when adjacency graph is missing)
   */
  private findNearbyTractsByCoordinates(tract: GeoJsonFeature, allTracts: GeoJsonFeature[], visited: Set<string>, maxDistance: number, maxCount: number = 10): string[] {
    const tractExtreme = this.getNorthwestCoordinate(tract); // Use NW as reference
    const nearby: { id: string; distance: number }[] = [];

    for (const other of allTracts) {
      if (other === tract) continue;
      const otherId = this.getTractId(other);
      if (visited.has(otherId)) continue;

      const otherExtreme = this.getNorthwestCoordinate(other);
      const distance = Math.sqrt(
        Math.pow(tractExtreme.lat - otherExtreme.lat, 2) +
        Math.pow(tractExtreme.lng - otherExtreme.lng, 2)
      );

      if (distance <= maxDistance) {
        nearby.push({ id: otherId, distance });
      }
    }

    // Sort by distance and take top maxCount
    nearby.sort((a, b) => a.distance - b.distance);
    return nearby.slice(0, maxCount).map(n => n.id);
  }

  /**
   * Check if tract A is completely contained within tract B
   */
  private isTractContainedIn(tractA: GeoJsonFeature, tractB: GeoJsonFeature): boolean {
    if (!tractA.geometry || !tractB.geometry) return false;

    const tractAId = this.getTractId(tractA);
    const tractBId = this.getTractId(tractB);

    // Get outer ring of tract A (the potentially contained tract)
    const outerRingA = this.getOuterRing(tractA);
    if (outerRingA.length < 3) return false;

    // Get outer ring of tract B (the potentially containing tract)
    const outerRingB = this.getOuterRing(tractB);
    if (outerRingB.length < 3) return false;

    // Debug: Check specifically for tract 001700
    if (tractAId.includes('001700') || tractBId.includes('001700')) {
      console.log(`🔍 isTractContainedIn: ${tractAId} vs ${tractBId}`);
      console.log(`   OuterRingA: ${outerRingA.length} points, OuterRingB: ${outerRingB.length} points`);
    }

    // Quick bounding box check first
    const bboxA = this.calculateBoundingBox(outerRingA);
    const bboxB = this.calculateBoundingBox(outerRingB);
    
    if (bboxA.minX < bboxB.minX || bboxA.maxX > bboxB.maxX ||
        bboxA.minY < bboxB.minY || bboxA.maxY > bboxB.maxY) {
      // Bounding box check fails - can't be contained
      if (tractAId.includes('001700') || tractBId.includes('001700')) {
        console.log(`   Bounding box check: FAILED`);
      }
      return false;
    }

    // Sample points from tract A's outer ring (not all points - too many)
    // Sample every Nth point to get a reasonable sample size
    const sampleSize = Math.min(outerRingA.length, 50); // Sample up to 50 points
    const step = Math.max(1, Math.floor(outerRingA.length / sampleSize));
    const samplePoints: number[][] = [];
    
    for (let i = 0; i < outerRingA.length; i += step) {
      samplePoints.push(outerRingA[i]);
    }
    
    // Also include the centroid as a sample point
    const centroidA = this.calculateRingCentroid(outerRingA);
    samplePoints.push(centroidA);

    // Check if all sampled points are inside tract B's outer ring
    let pointsInside = 0;
    let pointsOutside = 0;
    
    for (const point of samplePoints) {
      if (this.isPointInPolygon(point, outerRingB)) {
        pointsInside++;
      } else {
        pointsOutside++;
        // Debug: Log first outside point for 001700
        if ((tractAId.includes('001700') || tractBId.includes('001700')) && pointsOutside === 1) {
          console.log(`   First outside point: [${point[0].toFixed(6)}, ${point[1].toFixed(6)}]`);
        }
      }
    }

    // Debug: Show containment results for tract 001700
    if (tractAId.includes('001700') || tractBId.includes('001700')) {
      console.log(`   Sampled ${samplePoints.length} points: ${pointsInside} inside, ${pointsOutside} outside`);
      console.log(`   Containment: ${pointsOutside === 0 ? 'YES' : 'NO'}`);
    }

    return pointsOutside === 0;
  }

  /**
   * Get the outer ring of a GeoJSON feature
   */
  private getOuterRing(feature: GeoJsonFeature): number[][] {
    if (!feature.geometry) return [];

    if (feature.geometry.type === 'Polygon') {
      // First ring is the outer boundary
      if (feature.geometry.coordinates && feature.geometry.coordinates[0]) {
        return feature.geometry.coordinates[0];
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      // First ring of first polygon is the outer boundary
      if (feature.geometry.coordinates && feature.geometry.coordinates[0] && feature.geometry.coordinates[0][0]) {
        return feature.geometry.coordinates[0][0];
      }
    }

    return [];
  }

  /**
   * Calculate bounding box from coordinates
   */
  private calculateBoundingBox(coords: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
    if (coords.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    let minX = coords[0][0];
    let maxX = coords[0][0];
    let minY = coords[0][1];
    let maxY = coords[0][1];

    for (const coord of coords) {
      minX = Math.min(minX, coord[0]);
      maxX = Math.max(maxX, coord[0]);
      minY = Math.min(minY, coord[1]);
      maxY = Math.max(maxY, coord[1]);
    }

    return { minX, maxX, minY, maxY };
  }

  /**
   * Calculate centroid of a ring (array of coordinates)
   */
  private calculateRingCentroid(ring: number[][]): number[] {
    if (ring.length === 0) return [0, 0];

    let sumX = 0;
    let sumY = 0;
    for (const coord of ring) {
      sumX += coord[0];
      sumY += coord[1];
    }

    return [sumX / ring.length, sumY / ring.length];
  }

  /**
   * Get all coordinates from a GeoJSON feature
   */
  private getAllCoordinates(feature: GeoJsonFeature): number[][] {
    const coords: number[][] = [];

    if (!feature.geometry) return coords;

    const processRing = (ring: number[][]) => {
      for (const coord of ring) {
        if (coord.length >= 2) {
          coords.push([coord[0], coord[1]]);
        }
      }
    };

    if (feature.geometry.type === 'Polygon') {
      for (const ring of feature.geometry.coordinates) {
        processRing(ring);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const polygon of feature.geometry.coordinates) {
        for (const ring of polygon) {
          processRing(ring);
        }
      }
    }

    return coords;
  }

  /**
   * Point in polygon test using ray casting algorithm
   */
  private isPointInPolygon(point: number[], polygon: number[][]): boolean {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Find contained tracts in the dataset
   * @param tracts Array of tract features
   * @param allowLargeDatasets Whether to allow checking large datasets (for isolated tract fixing)
   * @returns Array of containment relationships
   */
  public findContainedTracts(tracts: GeoJsonFeature[], allowLargeDatasets: boolean = false): { container: string; contained: string }[] {
    // For performance, skip containment checks for large datasets unless explicitly allowed
    if (tracts.length > 100 && !allowLargeDatasets) {
      console.log(`📦 Skipping containment check for large dataset (${tracts.length} tracts) - too slow`);
      return [];
    }
    
    if (tracts.length > 200 && allowLargeDatasets) {
      console.log(`🔍 Checking for enclosed tracts in ${tracts.length} tracts...`);
    }
    
    // Debug: Log some sample tract IDs to see what we're working with
    if (tracts.length > 0) {
      console.log(`🔍 Sample tract IDs for containment check:`);
      for (let i = 0; i < Math.min(3, tracts.length); i++) {
        const tractId = this.getTractId(tracts[i]);
        console.log(`   ${i}: ${tractId}`);
      }
      
      // Check specifically for tract 001700
      const tract001700 = tracts.find(tract => this.getTractId(tract).includes('001700'));
      if (tract001700) {
        console.log(`🎯 FOUND TRACT 001700: ${this.getTractId(tract001700)} in containment check dataset!`);
      } else {
        console.log(`❌ TRACT 001700 NOT FOUND in containment check dataset`);
      }
    }

    const containedPairs: { container: string; contained: string }[] = [];
    const tractMap = new Map<string, GeoJsonFeature>();

    // Create map for quick lookup
    for (const tract of tracts) {
      const id = this.getTractId(tract);
      tractMap.set(id, tract);
    }

    console.log(`🔍 Checking for contained tracts among ${tracts.length} tracts...`);

    // For efficiency, only check pairs that are adjacent and where one is much smaller
    const adjacencyGraph = this.buildGeometryAdjacencyGraph(tracts);
    
    // Special check: Look for known problematic tracts that may be enclosed or isolated
    // These should be checked against ALL other tracts, not just adjacent ones
    const problematicTractIds = ['04005001700', '04025001901', '04012020505', '04001970502'];
    const problematicTracts = tracts.filter(t => {
      const id = this.getTractId(t);
      return problematicTractIds.some(problemId => id.includes(problemId));
    });
    
    if (problematicTracts.length > 0) {
      console.log(`🔍 Found ${problematicTracts.length} problematic tract(s) to check: ${problematicTracts.map(t => this.getTractId(t)).join(', ')}`);
      
      for (const problematicTract of problematicTracts) {
        const tractAId = this.getTractId(problematicTract);
        
        // Skip if already found as contained
        if (containedPairs.some(p => p.contained === tractAId)) continue;
        
        const outerRingA = this.getOuterRing(problematicTract);
        if (outerRingA.length < 3) continue;
        
        const bboxA = this.calculateBoundingBox(outerRingA);
        
        console.log(`🔍 Checking problematic tract ${tractAId} against all ${tracts.length} other tracts...`);
        
        let checkedCount = 0;
        let bboxPassedCount = 0;
        
        // Check against ALL other tracts
        for (const tractB of tracts) {
          const tractBId = this.getTractId(tractB);
          if (tractBId === tractAId) continue;
          if (containedPairs.some(p => p.container === tractBId && p.contained === tractAId)) continue;
          
          checkedCount++;
          
          const outerRingB = this.getOuterRing(tractB);
          if (outerRingB.length < 3) continue;
          
          const bboxB = this.calculateBoundingBox(outerRingB);
          
          // Quick bounding box check - A must be smaller than B
          // Allow a small tolerance (1% of bounding box size) for floating point precision
          const toleranceX = (bboxB.maxX - bboxB.minX) * 0.01;
          const toleranceY = (bboxB.maxY - bboxB.minY) * 0.01;
          
          if (bboxA.minX < (bboxB.minX - toleranceX) || bboxA.maxX > (bboxB.maxX + toleranceX) ||
              bboxA.minY < (bboxB.minY - toleranceY) || bboxA.maxY > (bboxB.maxY + toleranceY)) {
            continue; // Bounding box check fails
          }
          
          bboxPassedCount++;
          console.log(`🎯 Checking problematic tract ${tractAId} vs ${tractBId} (bbox check passed)`);
          
          if (this.isTractContainedIn(problematicTract, tractB)) {
            containedPairs.push({ container: tractBId, contained: tractAId });
            console.log(`✅ Found containment (problematic tract): ${tractAId} is contained in ${tractBId}`);
            break; // Found container, move to next problematic tract
          } else {
            console.log(`   Containment check failed for ${tractAId} vs ${tractBId}`);
          }
        }
        
        if (!containedPairs.some(p => p.contained === tractAId)) {
          console.log(`⚠️ Problematic tract ${tractAId}: checked ${checkedCount} tracts, ${bboxPassedCount} passed bbox check, but no containment found`);
        }
      }
    }
    
    // Check for isolated tracts (no neighbors) - these are likely enclosed
    const isolatedTracts: string[] = [];
    
    for (const [tractId, neighbors] of adjacencyGraph.entries()) {
      if (neighbors.length === 0) {
        isolatedTracts.push(tractId);
      }
    }
    
    if (isolatedTracts.length > 0) {
      console.log(`🔍 Found ${isolatedTracts.length} isolated tracts: ${isolatedTracts.join(', ')}`);
    }
    
    // Check each isolated tract against ALL other tracts for containment
    for (const isolatedTractId of isolatedTracts) {
      const isolatedTract = tractMap.get(isolatedTractId);
      if (!isolatedTract) continue;
      
      // Skip if already found as contained
      if (containedPairs.some(p => p.contained === isolatedTractId)) continue;
      
      const outerRingIsolated = this.getOuterRing(isolatedTract);
      if (outerRingIsolated.length < 3) continue;
      
      const bboxIsolated = this.calculateBoundingBox(outerRingIsolated);
      
      for (const [tractBId, tractB] of tractMap.entries()) {
        if (tractBId === isolatedTractId) continue;
        if (containedPairs.some(p => p.container === tractBId && p.contained === isolatedTractId)) continue;
        
        const outerRingB = this.getOuterRing(tractB);
        if (outerRingB.length < 3) continue;
        
        const bboxB = this.calculateBoundingBox(outerRingB);
        
        // Quick bounding box check - isolated tract must be smaller
        if (bboxIsolated.minX < bboxB.minX || bboxIsolated.maxX > bboxB.maxX ||
            bboxIsolated.minY < bboxB.minY || bboxIsolated.maxY > bboxB.maxY) {
          continue; // Bounding box check fails
        }
        
        // Check containment
        if (this.isTractContainedIn(isolatedTract, tractB)) {
          containedPairs.push({ container: tractBId, contained: isolatedTractId });
          console.log(`🔍 Found containment (isolated): ${isolatedTractId} is contained in ${tractBId}`);
          break; // Found container, move to next isolated tract
        }
      }
    }

    // Check tracts with only 1 neighbor - these are likely enclosed
    // An enclosed tract typically only touches its container
    const singleNeighborTracts: string[] = [];
    for (const [tractId, neighbors] of adjacencyGraph.entries()) {
      if (neighbors.length === 1) {
        singleNeighborTracts.push(tractId);
      }
    }
    
    if (singleNeighborTracts.length > 0) {
      console.log(`🔍 Found ${singleNeighborTracts.length} tracts with only 1 neighbor (likely enclosed): ${singleNeighborTracts.join(', ')}`);
      
      // Check each single-neighbor tract against ALL other tracts for containment
      // This is more thorough than just checking the neighbor
      for (const tractAId of singleNeighborTracts) {
        // Skip if already found as contained
        if (containedPairs.some(p => p.contained === tractAId)) continue;
        
        const tractA = tractMap.get(tractAId);
        if (!tractA) continue;
        
        const outerRingA = this.getOuterRing(tractA);
        if (outerRingA.length < 3) continue;
        
        const bboxA = this.calculateBoundingBox(outerRingA);
        
        // Check against all other tracts, prioritizing larger ones
        for (const [tractBId, tractB] of tractMap.entries()) {
          if (tractBId === tractAId) continue;
          if (containedPairs.some(p => p.container === tractBId && p.contained === tractAId)) continue;
          
          const outerRingB = this.getOuterRing(tractB);
          if (outerRingB.length < 3) continue;
          
          const bboxB = this.calculateBoundingBox(outerRingB);
          
          // Quick bounding box check - A must be smaller than B
          if (bboxA.minX < bboxB.minX || bboxA.maxX > bboxB.maxX ||
              bboxA.minY < bboxB.minY || bboxA.maxY > bboxB.maxY) {
            continue; // Bounding box check fails
          }
          
          // Debug: Check specifically for tract 001700
          if (tractAId.includes('001700') || tractBId.includes('001700')) {
            console.log(`🎯 Checking containment for single-neighbor tract 001700: ${tractAId} vs ${tractBId}`);
            console.log(`   OuterRingA: ${outerRingA.length} points, OuterRingB: ${outerRingB.length} points`);
          }
          
          if (this.isTractContainedIn(tractA, tractB)) {
            containedPairs.push({ container: tractBId, contained: tractAId });
            console.log(`🔍 Found containment (single-neighbor): ${tractAId} is contained in ${tractBId}`);
            break; // Found container, move to next tract
          }
        }
      }
    }

    // Check adjacent tracts for containment (original logic)
    for (const [tractAId, neighbors] of adjacencyGraph.entries()) {
      // Skip if already found as contained
      if (containedPairs.some(p => p.contained === tractAId)) continue;
      
      const tractA = tractMap.get(tractAId);
      if (!tractA) continue;

      const coordsA = this.getAllCoordinates(tractA);

      for (const tractBId of neighbors) {
        // Skip if already found as contained
        if (containedPairs.some(p => p.container === tractBId && p.contained === tractAId)) continue;
        
        const tractB = tractMap.get(tractBId);
        if (!tractB) continue;

        const coordsB = this.getAllCoordinates(tractB);

        // Only check if A is much smaller than B (potential containment)
        if (coordsA.length * 3 < coordsB.length && coordsA.length > 0) {
          // Debug: Check specifically for tract 001700
          if (tractAId.includes('001700') || tractBId.includes('001700')) {
            console.log(`🎯 Checking containment for tract 001700: ${tractAId} vs ${tractBId}`);
            console.log(`   CoordsA length: ${coordsA.length}, CoordsB length: ${coordsB.length}`);
            console.log(`   Size check: ${coordsA.length * 3} < ${coordsB.length} = ${coordsA.length * 3 < coordsB.length}`);
          }
          
          if (this.isTractContainedIn(tractA, tractB)) {
            containedPairs.push({ container: tractBId, contained: tractAId });
            console.log(`🔍 Found containment: ${tractAId} is contained in ${tractBId}`);
          }
        }
      }
    }

    return containedPairs;
  }

  /**
   * Build adjacency graph from tract geometries (for containment check)
   */
  private buildGeometryAdjacencyGraph(tracts: GeoJsonFeature[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const tract of tracts) {
      const id = this.getTractId(tract);
      graph.set(id, []);
    }

    console.log(`🔍 Building adjacency graph for ${tracts.length} tracts using geometric intersection...`);

    // Use proper geometric boundary intersection for adjacency
    for (let i = 0; i < tracts.length; i++) {
      for (let j = i + 1; j < tracts.length; j++) {
        const tractA = tracts[i];
        const tractB = tracts[j];
        const idA = this.getTractId(tractA);
        const idB = this.getTractId(tractB);

        // Calculate bounding boxes for adjacency check
        const boundsA = this.calculateSingleTractBounds(tractA);
        const boundsB = this.calculateSingleTractBounds(tractB);
        
        if (this.areTractsAdjacent(tractA, tractB, boundsA, boundsB)) {
          graph.get(idA)!.push(idB);
          graph.get(idB)!.push(idA);
        }
      }
    }

    // Debug: Count total adjacency relationships
    let totalAdjacencies = 0;
    for (const [tractId, neighbors] of graph.entries()) {
      totalAdjacencies += neighbors.length;
    }
    console.log(`🔍 Built adjacency graph: ${totalAdjacencies} total relationships (${(totalAdjacencies / 2).toFixed(0)} unique pairs)`);

    return graph;
  }

  /**
   * Get distance between two tracts (using centroids)
   */
  private getTractDistance(tractA: GeoJsonFeature, tractB: GeoJsonFeature): number {
    const centroidA = this.calculateCentroidFromGeometry(tractA);
    const centroidB = this.calculateCentroidFromGeometry(tractB);

    return Math.sqrt(
      Math.pow(centroidA[0] - centroidB[0], 2) + Math.pow(centroidA[1] - centroidB[1], 2)
    );
  }

  /**
   * Calculate centroid from geometry
   */
  private calculateCentroidFromGeometry(feature: GeoJsonFeature): [number, number] {
    const coords = this.getAllCoordinates(feature);
    if (coords.length === 0) return [0, 0];

    let sumX = 0, sumY = 0;
    for (const [x, y] of coords) {
      sumX += x;
      sumY += y;
    }

    return [sumX / coords.length, sumY / coords.length];
  }

  /**
   * Calculate directional score for neighbor selection based on Grok reference
   * @param currentTract Current tract
   * @param neighborTract Neighbor tract
   * @param direction Overall direction preference (latitude or longitude)
   * @returns Directional score (higher is better)
   */
  private calculateDirectionalScore(currentTract: GeoJsonFeature, neighborTract: GeoJsonFeature, direction: 'latitude' | 'longitude', phase: 'east' | 'west' | 'south' = 'east'): number {
    const currentExtreme = this.getExtremeCoordinate(currentTract, direction, phase);
    const neighborExtreme = this.getExtremeCoordinate(neighborTract, direction, phase);
    const epsilon = 0.01;
    
    if (direction === 'latitude') {
      if (phase === 'east') {
        const latDiff = neighborExtreme.lat - currentExtreme.lat;
        const lngDiff = neighborExtreme.lng - currentExtreme.lng; // East: positive lng
        return latDiff + epsilon * lngDiff;
      } else if (phase === 'west') {
        const latDiff = neighborExtreme.lat - currentExtreme.lat;
        const lngDiff = currentExtreme.lng - neighborExtreme.lng; // West: negative lng diff
        return latDiff - epsilon * lngDiff; // Adjust for west direction
      } else {
        const latDiff = neighborExtreme.lat - currentExtreme.lat; // South: negative lat
        const lngDiff = neighborExtreme.lng - currentExtreme.lng;
        return -latDiff + epsilon * lngDiff; // Prioritize south
      }
    } else {
      // Longitude direction similar adjustments
      const lngDiff = neighborExtreme.lng - currentExtreme.lng;
      const latDiff = neighborExtreme.lat - currentExtreme.lat;
      return lngDiff + epsilon * latDiff;
    }
  }

  /**
   * Get extreme coordinate for a tract based on direction
   * @param tract Tract feature
   * @param direction Direction preference
   * @returns Extreme coordinate (north_lat, east_long for lat-sort; east_long, north_lat for long-sort)
   */
  private getExtremeCoordinate(tract: GeoJsonFeature, direction: 'latitude' | 'longitude', traversalPhase: 'start' | 'east' | 'south' | 'west' = 'start'): { lat: number; lng: number } {
    switch (direction) {
      case 'latitude':
        if (traversalPhase === 'start' || traversalPhase === 'west') {
          return this.getNorthwestCoordinate(tract); // For north/west bias
        } else {
          return this.getNortheastCoordinate(tract); // For east bias
        }
      case 'longitude':
        // For longitude direction, use southeast or southwest as needed
        if (traversalPhase === 'south') {
          return this.getSoutheastCoordinate(tract); // Placeholder, implement if needed
        } else {
          return this.getSouthwestCoordinate(tract); // Placeholder
        }
      default:
        return this.getNorthwestCoordinate(tract);
    }
  }

  /**
   * Get northeast coordinate (northernmost latitude, easternmost longitude)
   * @param tract Tract feature
   * @returns Northeast coordinate
   */
  private getNortheastCoordinate(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry || tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon') {
      return { lat: 0, lng: 0 };
    }

    let maxLat = -Infinity;
    let maxLng = -Infinity;

    const processCoordinates = (coordinates: number[][]) => {
      for (const coord of coordinates) {
        if (coord.length >= 2) {
          const lng = coord[0];
          const lat = coord[1];
          maxLat = Math.max(maxLat, lat);
          maxLng = Math.max(maxLng, lng);
        }
      }
    };

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        processCoordinates(ring);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          processCoordinates(ring);
        }
      }
    }

    return { lat: maxLat, lng: maxLng };
  }

  /**
   * Get southeast coordinate (southernmost latitude, easternmost longitude)
   * @param tract Tract feature
   * @returns Southeast coordinate
   */
  private getSoutheastCoordinate(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry || (tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon')) {
      return { lat: 0, lng: 0 };
    }
    let minLat = Infinity;
    let maxLng = -Infinity;
    const processCoordinates = (coordinates: number[][]) => {
      for (const coord of coordinates) {
        if (coord.length >= 2) {
          const lng = coord[0];
          const lat = coord[1];
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
        }
      }
    };
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        processCoordinates(ring);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          processCoordinates(ring);
        }
      }
    }
    return { lat: minLat, lng: maxLng };
  }

  /**
   * Get southwest coordinate (southernmost latitude, westernmost longitude)
   * @param tract Tract feature
   * @returns Southwest coordinate
   */
  private getSouthwestCoordinate(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry || (tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon')) {
      return { lat: 0, lng: 0 };
    }
    let minLat = Infinity;
    let minLng = Infinity;
    const processCoordinates = (coordinates: number[][]) => {
      for (const coord of coordinates) {
        if (coord.length >= 2) {
          const lng = coord[0];
          const lat = coord[1];
          minLat = Math.min(minLat, lat);
          minLng = Math.min(minLng, lng);
        }
      }
    };
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        processCoordinates(ring);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          processCoordinates(ring);
        }
      }
    }
    return { lat: minLat, lng: minLng };
  }


  /**
   * Find the starting tract for greedy traversal
   * @param tracts Array of tract features
   * @param direction Traversal direction
   * @returns Starting tract
   */
  private findStartingTract(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): GeoJsonFeature | null {
    if (tracts.length === 0) return null;

    console.log(`🔍 Finding starting tract for ${direction} direction`);

    let bestTract = tracts[0];
    let bestScore = -Infinity;

    // Log all tract coordinates for debugging
    console.log(`📍 All tract northwest coordinates:`);
    for (let i = 0; i < Math.min(10, tracts.length); i++) {
      const tract = tracts[i];
      const northwest = this.getNorthwestCoordinate(tract);
      const tractId = this.getTractId(tract);
      console.log(`  ${tractId}: (${northwest.lat.toFixed(6)}, ${northwest.lng.toFixed(6)})`);
    }

    for (const tract of tracts) {
      const northwest = this.getNorthwestCoordinate(tract);
      let score: number;

      if (direction === 'latitude') {
        // For lat-sort: prefer NW-most (prioritize north first, then west)
        // Use a large scale factor to ensure north takes priority over west
        score = northwest.lat * 100 - northwest.lng; // Prioritize latitude (north) over longitude (west)
      } else {
        // For long-sort: prefer SW-most (prioritize south first, then west)
        score = -northwest.lat * 100 - northwest.lng; // Prioritize latitude (south) over longitude (west)
      }

      if (score > bestScore) {
        bestScore = score;
        bestTract = tract;
      }
    }

    const northwest = this.getNorthwestCoordinate(bestTract);
    console.log(`📍 Selected starting tract: ${this.getTractId(bestTract)} at (${northwest.lat.toFixed(6)}, ${northwest.lng.toFixed(6)}) with score ${bestScore.toFixed(6)}`);

    return bestTract;
  }

  /**
   * Perform greedy traversal from starting tract
   * @param tracts Array of tract features
   * @param adjacencyGraph Adjacency graph
   * @param startTract Starting tract
   * @param direction Traversal direction
   * @returns Sorted array of tracts
   */
  private performGreedyTraversal(tracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>, startTract: GeoJsonFeature, direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    console.log(`🚀 Starting greedy traversal from ${this.getTractId(startTract)}`);

    const tractMap = new Map<string, GeoJsonFeature>();
    for (const tract of tracts) {
      tractMap.set(this.getTractId(tract), tract);
    }

    const visited = new Set<string>();
    const sortedTracts: GeoJsonFeature[] = [];
    const queue: { tract: GeoJsonFeature; priority: number }[] = [];

    // Initialize with starting tract
    const startTractId = this.getTractId(startTract);
    queue.push({ tract: startTract, priority: 0 });
    visited.add(startTractId);
    sortedTracts.push(startTract);

    let iterationCount = 0;
    while (queue.length > 0 && iterationCount < 1000) { // Safety limit
      const { tract: currentTract } = queue.shift()!;
      const currentTractId = this.getTractId(currentTract);
      const neighbors = adjacencyGraph.get(currentTractId) || [];

      if (iterationCount < 5) { // Log first few iterations
        console.log(`🔄 Traversal iteration ${iterationCount}: processing tract ${currentTractId} with ${neighbors.length} neighbors`);
      }

      // Get unvisited neighbors and calculate directional scores
      const candidateNeighbors = neighbors
        .filter(neighborId => !visited.has(neighborId))
        .map(neighborId => {
          const neighborTract = tractMap.get(neighborId);
          if (!neighborTract) return null;

          const currentNorthwest = this.getNorthwestCoordinate(currentTract);
          const neighborNorthwest = this.getNorthwestCoordinate(neighborTract);

          // Calculate directional score (northeast bias)
          const latDiff = neighborNorthwest.lat - currentNorthwest.lat;
          const lngDiff = neighborNorthwest.lng - currentNorthwest.lng;
          const epsilon = 0.1; // Increased scale factor for longitude

          let score: number;
          if (direction === 'latitude') {
            // For lat-sort: prefer south (negative lat diff) then east (positive lng diff)
            // This creates a northwest-to-southeast traversal pattern
            score = -latDiff + epsilon * lngDiff;
          } else {
            // For long-sort: prefer east (positive lng diff) then south (negative lat diff)
            // This creates a west-to-east traversal pattern
            score = lngDiff + epsilon * (-latDiff);
          }

          return { tract: neighborTract, score };
        })
        .filter((item): item is { tract: GeoJsonFeature; score: number } => item !== null)
        .sort((a, b) => b.score - a.score); // Sort by score descending (best first)

      // Add neighbors to queue and mark as visited
      for (const { tract: neighborTract } of candidateNeighbors) {
        const neighborTractId = this.getTractId(neighborTract);
        visited.add(neighborTractId);
        sortedTracts.push(neighborTract);
        queue.push({ tract: neighborTract, priority: queue.length + 1 });
      }

      iterationCount++;
    }

    if (iterationCount >= 1000) {
      console.warn(`⚠️  Traversal stopped at iteration limit (1000)`);
    }

    // Handle any disconnected components
    const unvisitedTracts = tracts.filter(tract => !visited.has(this.getTractId(tract)));
    if (unvisitedTracts.length > 0) {
      console.log(`⚠️  Found ${unvisitedTracts.length} disconnected tracts (${(unvisitedTracts.length / tracts.length * 100).toFixed(1)}%)`);

      // If too many tracts are disconnected, fall back to centroid sorting
      if (unvisitedTracts.length > tracts.length * 0.3) { // More than 30% disconnected
        console.log(`🔄 Too many disconnected tracts, falling back to centroid sorting`);
        return this.sortTractsByCentroid(tracts, direction);
      }

      // Sort disconnected tracts by centroid and add them
      const sortedUnvisited = this.sortTractsByCentroid(unvisitedTracts, direction);
      sortedTracts.push(...sortedUnvisited);
    }

    console.log(`✅ Greedy traversal complete: ${sortedTracts.length} tracts processed`);
    return sortedTracts;
  }

  /**
   * Check if two tracts are adjacent using multiple criteria
   * @param tractA First tract
   * @param tractB Second tract
   * @param boundsA Bounding box of first tract
   * @param boundsB Bounding box of second tract
   * @returns True if tracts are adjacent
   */
  private areTractsAdjacent(tractA: GeoJsonFeature, tractB: GeoJsonFeature, boundsA: any, boundsB: any): boolean {
    const tractIdA = this.getTractId(tractA);
    const tractIdB = this.getTractId(tractB);

    // Method 1: Check if bounding boxes share an edge (more reliable than distance)
    const shareEdge = this.boundingBoxesShareEdge(boundsA, boundsB);
    if (shareEdge) {
      if (tractIdA === '950101' || tractIdB === '950101') {
        console.log(`✅ Edge sharing: ${tractIdA} <-> ${tractIdB}`);
      }
      return true;
    }

    // Method 2: Check if bounding boxes are very close (overlapping or touching)
    const tolerance = 0.005; // Approximately 500m
    const closeEnough = (
      (boundsA.minLng <= boundsB.maxLng + tolerance && boundsA.maxLng >= boundsB.minLng - tolerance) &&
      (boundsA.minLat <= boundsB.maxLat + tolerance && boundsA.maxLat >= boundsB.minLat - tolerance)
    );

    if (closeEnough) {
      if (tractIdA === '950101' || tractIdB === '950101') {
        console.log(`✅ Close proximity: ${tractIdA} <-> ${tractIdB}`);
      }
      return true;
    }

    // Method 3: Check northwest coordinate proximity (fallback)
    const northwestA = this.getNorthwestCoordinate(tractA);
    const northwestB = this.getNorthwestCoordinate(tractB);
    const distance = this.calculateDistance(northwestA, northwestB);
    const maxAdjacentDistance = 0.05; // Approximately 5km - more permissive

    const isClose = distance <= maxAdjacentDistance;
    if (isClose && (tractIdA === '950101' || tractIdB === '950101')) {
      console.log(`✅ Distance proximity: ${tractIdA} <-> ${tractIdB} (distance: ${distance.toFixed(6)})`);
    }

    return isClose;
  }

  /**
   * Check if two bounding boxes share an edge
   * @param boundsA First bounding box
   * @param boundsB Second bounding box
   * @returns True if boxes share an edge
   */
  private boundingBoxesShareEdge(boundsA: any, boundsB: any): boolean {
    const tolerance = 0.001; // Small tolerance for floating point precision

    // Check if boxes share a vertical edge (same longitude boundary)
    const shareVerticalEdge = (
      (Math.abs(boundsA.minLng - boundsB.maxLng) < tolerance || Math.abs(boundsA.maxLng - boundsB.minLng) < tolerance) &&
      !(boundsA.maxLat < boundsB.minLat || boundsA.minLat > boundsB.maxLat)
    );

    // Check if boxes share a horizontal edge (same latitude boundary)
    const shareHorizontalEdge = (
      (Math.abs(boundsA.minLat - boundsB.maxLat) < tolerance || Math.abs(boundsA.maxLat - boundsB.minLat) < tolerance) &&
      !(boundsA.maxLng < boundsB.minLng || boundsA.minLng > boundsB.maxLng)
    );

    return shareVerticalEdge || shareHorizontalEdge;
  }

  /**
   * Calculate distance between two coordinates
   * @param coord1 First coordinate
   * @param coord2 Second coordinate
   * @returns Distance in degrees
   */
  private calculateDistance(coord1: { lat: number; lng: number }, coord2: { lat: number; lng: number }): number {
    const latDiff = coord1.lat - coord2.lat;
    const lngDiff = coord1.lng - coord2.lng;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }

  /**
   * Check if the entire tract geometry is north or west of a dividing line
   * @param tract Tract feature with geometry
   * @param direction Division direction (latitude or longitude)
   * @param lineCoordinate Line coordinate
   * @returns True if entire tract is north/west of the line
   */
  private isTractEntirelyNorthOrWest(tract: GeoJsonFeature, direction: 'latitude' | 'longitude', lineCoordinate: number): boolean {
    if (!this.isValidPolygon(tract.geometry)) {
      console.warn(`Invalid geometry for tract ${this.getTractId(tract)}, using centroid fallback`);
      const centroid = this.calculateTractCentroid(tract);
      if (direction === 'latitude') {
        return centroid.lat >= lineCoordinate;
      } else {
        return centroid.lng <= lineCoordinate;
      }
    }

    if (direction === 'latitude') {
      // For latitude: check if entire tract is north of the line
      // This means ALL coordinates must be at or above the line
      return this.isTractEntirelyNorthOfLine(tract, lineCoordinate);
    } else {
      // For longitude: check if entire tract is west of the line
      // This means ALL coordinates must be at or west of the line
      return this.isTractEntirelyWestOfLine(tract, lineCoordinate);
    }
  }

  /**
   * Check if entire tract is north of a latitude line
   * @param tract Tract feature
   * @param latitudeLine Latitude line coordinate
   * @returns True if all coordinates are at or above the line
   */
  private isTractEntirelyNorthOfLine(tract: GeoJsonFeature, latitudeLine: number): boolean {
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const [lng, lat] = coord;
          if (lat < latitudeLine) {
            return false; // Found a coordinate south of the line
          }
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const [lng, lat] = coord;
            if (lat < latitudeLine) {
              return false; // Found a coordinate south of the line
            }
          }
        }
      }
    }
    return true; // All coordinates are at or above the line
  }

  /**
   * Check if entire tract is west of a longitude line
   * @param tract Tract feature
   * @param longitudeLine Longitude line coordinate
   * @returns True if all coordinates are at or west of the line
   */
  private isTractEntirelyWestOfLine(tract: GeoJsonFeature, longitudeLine: number): boolean {
    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const [lng, lat] = coord;
          if (lng > longitudeLine) {
            return false; // Found a coordinate east of the line
          }
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const [lng, lat] = coord;
            if (lng > longitudeLine) {
              return false; // Found a coordinate east of the line
            }
          }
        }
      }
    }
    return true; // All coordinates are at or west of the line
  }

  /**
   * Run the geodistrict algorithm asynchronously (for Brown S4)
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  private runGeodistrictAlgorithmAsync(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, useDirectAPI = false, forceInvalidate = false, maxIterations = 100, algorithm = 'brown-s4' } = options;

    // In production, always use backend proxy (which handles Secret Manager)
    // In development, respect the useDirectAPI flag
    const shouldUseDirectAPI = useDirectAPI && !environment.production;

    if (shouldUseDirectAPI) {
      console.log('🔧 Using direct Census API (development mode)');
      return this.runGeodistrictAlgorithmDirectAsync(options);
    } else {
      console.log('🔧 Using backend proxy (production mode)');
      return this.runGeodistrictAlgorithmProxyAsync(options);
    }
  }

  /**
   * Run geodistrict algorithm using backend proxy (async version)
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  private runGeodistrictAlgorithmProxyAsync(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, forceInvalidate = false, maxIterations = 100, algorithm = 'brown-s4' } = options;

    const params = new URLSearchParams({
      state: state,
      forceInvalidate: forceInvalidate.toString(),
      maxIterations: maxIterations.toString(),
      algorithm: algorithm
    });

    const url = `${environment.apiUrl}/api/geodistrict?${params.toString()}`;
    console.log(`🌐 Calling backend proxy: ${url}`);

    return this.http.get<GeodistrictResult>(url).pipe(
      map(result => {
        console.log('✅ Backend proxy response received');
        return result;
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Run geodistrict algorithm using direct Census API (async version)
   * @param options Algorithm options
   * @returns Observable with algorithm result
   */
  private runGeodistrictAlgorithmDirectAsync(options: GeodistrictOptions): Observable<GeodistrictResult> {
    const { state, maxIterations = 100, algorithm = 'brown-s4' } = options;

    return this.congressionalDistrictsService.getTotalDistrictsForState(state).pipe(
      switchMap(totalDistricts => {
        console.log(`📊 State ${state} has ${totalDistricts} congressional districts`);

        return this.censusService.getTractDataWithBoundaries(state).pipe(
          switchMap((data) => {
            const tracts = data.boundaries.features;
            console.log(`📍 Found ${tracts.length} census tracts for ${state}`);

            const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
            const targetDistrictPopulation = totalStatePopulation / totalDistricts;

            console.log(`Total state population: ${totalStatePopulation.toLocaleString()}`);
            console.log(`Target population per district: ${targetDistrictPopulation.toLocaleString()}`);

            // Sort tracts initially by latitude (north to south) using Brown S4
            console.log(`🔄 Sorting tracts initially by latitude (north to south) using ${algorithm} algorithm`);
            
            // Use async/await properly with from() to convert Promise to Observable
            return from(this.sortTractsByBrownS4(tracts, 'latitude')).pipe(
              switchMap(sortedTracts => {
                // Initialize with all tracts as a single district group
                const initialGroup: DistrictGroup = {
                  startDistrictNumber: 1,
                  endDistrictNumber: totalDistricts,
                  censusTracts: sortedTracts,
                  totalDistricts: totalDistricts,
                  totalPopulation: totalStatePopulation,
                  bounds: this.calculateBounds(sortedTracts),
                  centroid: this.calculateCentroid(sortedTracts)
                };

                // Run the division algorithm
                return from(this.runDivisionAlgorithmAsync([initialGroup], maxIterations, algorithm)).pipe(
                  map(result => ({
                    finalDistricts: result.districts,
                    steps: [], // No step-by-step tracking for async version
                    totalPopulation: totalStatePopulation,
                    averagePopulation: totalStatePopulation / result.districts.length,
                    populationVariance: result.populationVariance,
                    algorithmHistory: [`Brown S4 algorithm completed in ${result.iterations} iterations`]
                  }))
                );
              })
            );
          })
        );
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Run the division algorithm asynchronously
   * @param groups Initial district groups
   * @param maxIterations Maximum iterations
   * @param algorithm Algorithm type
   * @returns Division result
   */
  private async runDivisionAlgorithmAsync(groups: DistrictGroup[], maxIterations: number, algorithm: string): Promise<{ districts: DistrictGroup[]; iterations: number; populationVariance: number }> {
    let currentGroups = [...groups];
    let iteration = 0;

    while (iteration < maxIterations) {
      console.log(`\n🔄 Iteration ${iteration + 1}: Processing ${currentGroups.length} groups`);

      // Find the group with the most districts
      const groupToDivide = currentGroups.find(group => group.totalDistricts > 1);
      if (!groupToDivide) {
        console.log('✅ All groups have been divided into single districts');
        break;
      }

      console.log(`📊 Dividing group ${groupToDivide.startDistrictNumber}-${groupToDivide.endDistrictNumber} (${groupToDivide.totalDistricts} districts, ${groupToDivide.censusTracts.length} tracts)`);

      // Determine division direction (alternate between latitude and longitude)
      const direction: 'latitude' | 'longitude' = iteration % 2 === 0 ? 'latitude' : 'longitude';
      console.log(`🧭 Division direction: ${direction}`);

      // Divide the group using the selected algorithm
      const divisionResult = algorithm === 'geo-graph'
        ? await this.divideDistrictGroupGeoGraph(groupToDivide, direction)
        : await this.divideDistrictGroupBrownS4(groupToDivide, direction);
      const newGroups = divisionResult.groups;

      // Remove the original group and add the new groups
      currentGroups = currentGroups.filter(group => group !== groupToDivide);
      currentGroups.push(...newGroups);

      console.log(`✅ Group divided into ${newGroups.length} new groups`);
      iteration++;
    }

    // Calculate final statistics
    const totalPopulation = currentGroups.reduce((sum, group) => sum + group.totalPopulation, 0);
    const averagePopulation = totalPopulation / currentGroups.length;
    const populationVariance = currentGroups.reduce((sum, district) =>
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / currentGroups.length;

    return {
      districts: currentGroups,
      iterations: iteration,
      populationVariance: populationVariance
    };
  }

  // ============================================================================
  // BROWN S4 ALGORITHM IMPLEMENTATION
  // ============================================================================

  /**
   * Load S4 adjacency data for a state
   * @param state State abbreviation
   * @returns Promise with adjacency graph
   */
  public async loadS4AdjacencyData(state: string): Promise<Map<string, string[]>> {
    const cacheKey = state.toLowerCase();
    
    if (this.s4AdjacencyCache.has(cacheKey)) {
      console.log(`📋 Using cached S4 adjacency data for ${state}`);
      return this.s4AdjacencyCache.get(cacheKey)!;
    }

    try {
      console.log(`📥 Loading S4 adjacency data for ${state}...`);
      
      // Load tract data (using actual Brown S4 data files)
      const tractDataUrl = `s4-data/tract_2020.csv`;
      const tractDataResponse = await this.http.get(tractDataUrl, { responseType: 'text' }).toPromise();
      const tractData = this.parseCSV(tractDataResponse!) as S4TractData[];
      
      // Filter tracts for the state (using STATEID column with FIPS code)
      const stateFips = this.getStateFipsCode(state);
      const stateTracts = tractData.filter(tract => tract.STATEID === stateFips);
      console.log(`📍 Found ${stateTracts.length} tracts for state ${state} (FIPS: ${stateFips})`);
      
      // Load adjacency data (using actual Brown S4 data files)
      const adjacencyDataUrl = `s4-data/nlist_2020.csv`;
      const adjacencyDataResponse = await this.http.get(adjacencyDataUrl, { responseType: 'text' }).toPromise();
      const adjacencyData = this.parseCSV(adjacencyDataResponse!) as S4AdjacencyData[];
      
      // Build adjacency graph
      const adjacencyGraph = new Map<string, string[]>();
      const stateTractIds = new Set(stateTracts.map(t => t.GEOID));
      
      // Initialize adjacency lists
      for (const tract of stateTracts) {
        adjacencyGraph.set(tract.GEOID, []);
      }
      
      // Build adjacency relationships
      for (const adj of adjacencyData) {
        if (stateTractIds.has(adj.SOURCE_TRACTID) && stateTractIds.has(adj.NEIGHBOR_TRACTID) && adj.SOURCE_TRACTID !== adj.NEIGHBOR_TRACTID) {
          const neighbors = adjacencyGraph.get(adj.SOURCE_TRACTID) || [];
          neighbors.push(adj.NEIGHBOR_TRACTID);
          adjacencyGraph.set(adj.SOURCE_TRACTID, neighbors);
        }
      }
      
      // Cache the result
      this.s4AdjacencyCache.set(cacheKey, adjacencyGraph);
      
      const totalAdjacencies = Array.from(adjacencyGraph.values()).reduce((sum, neighbors) => sum + neighbors.length, 0);
      console.log(`✅ S4 adjacency data loaded: ${totalAdjacencies} total adjacencies for ${stateTracts.length} tracts`);
      
      return adjacencyGraph;
    } catch (error) {
      console.error(`❌ Error loading S4 data for ${state}:`, error);
      throw new Error(`Failed to load S4 adjacency data for ${state}`);
    }
  }

  /**
   * Parse CSV data into objects
   * @param csvData Raw CSV string
   * @returns Array of objects
   */
  private parseCSV(csvData: string): any[] {
    const lines = csvData.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const result: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const obj: any = {};
      
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = values[j] || '';
      }
      
      result.push(obj);
    }
    
    return result;
  }

  /**
   * Sort tracts using Geo-Graph algorithm with Brown S4 adjacency data
   * Implements the zig-zag traversal pattern described in the algorithm specification
   * @param tracts Array of tracts
   * @param direction Sorting direction
   * @returns Sorted tracts using geo-graph traversal
   */
  public async sortTractsByGeoGraph(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): Promise<GeoJsonFeature[]> {
    if (tracts.length <= 1) return tracts;

    console.log(`🔄 Starting Geo-Graph algorithm for ${tracts.length} tracts (${direction} direction)`);

    // Get state from first tract
    const state = tracts[0].properties?.STATE || '';
    if (!state) {
      throw new Error('Geo-graph algorithm failed: No state found in tract properties');
    }

    // Load S4 adjacency data
    const adjacencyGraph = await this.loadS4AdjacencyData(state);

    // Find starting tract based on direction
    let startTract: GeoJsonFeature | null;
    if (direction === 'latitude') {
      // For latitude division: start from northwest-most tract
      startTract = this.findNorthwestMostTract(tracts);
      if (!startTract) {
        throw new Error('Geo-graph algorithm failed: Could not find northwest most tract');
      }
      console.log(`📍 Starting tract (NW-most): ${this.getTractId(startTract)} at (${this.getNorthwestCoordinate(startTract).lat.toFixed(6)}, ${this.getNorthwestCoordinate(startTract).lng.toFixed(6)})`);
    } else {
      // For longitude division: start from southwest-most tract
      startTract = this.findSouthwestMostTract(tracts);
      if (!startTract) {
        throw new Error('Geo-graph algorithm failed: Could not find southwest most tract');
      }
      console.log(`📍 Starting tract (SW-most): ${this.getTractId(startTract)} at (${this.getSouthwestCoordinate(startTract).lat.toFixed(6)}, ${this.getSouthwestCoordinate(startTract).lng.toFixed(6)})`);
    }

    // Perform geo-graph traversal with zig-zag pattern
    return this.geoGraphTraversalService.performGeoGraphTraversal(tracts, adjacencyGraph, startTract, direction);
  }

  /**
   * Execute geo-graph algorithm with step-by-step control
   * @param tracts Array of tracts
   * @param direction Sorting direction
   * @param step Current step number
   * @returns Step result with current state
   */
  public async executeGeoGraphStep(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude', step: number = 0): Promise<GeoGraphStepResult> {
    if (tracts.length <= 1) {
      return {
        phase: 'phase1',
        step: 0,
        totalSteps: 1,
        isComplete: true,
        message: 'Only one tract, no sorting needed',
        sortedTracts: tracts
      };
    }

    console.log(`🔄 Executing Geo-Graph step ${step} for ${tracts.length} tracts`);

    // Get state from first tract
    const state = tracts[0].properties?.STATE || '';
    if (!state) {
      throw new Error('Geo-graph algorithm failed: No state found in tract properties');
    }

    // Load S4 adjacency data
    const adjacencyGraph = await this.loadS4AdjacencyData(state);

    // Find northwest most census tract as starting point
    const startTract = this.findNorthwestMostTract(tracts);
    if (!startTract) {
      throw new Error('Geo-graph algorithm failed: Could not find northwest most tract');
    }

    if (step === 0) {
      // Phase 1: Complete northwest expansion
      const sortedTracts = await this.geoGraphTraversalService.performGeoGraphTraversal(tracts, adjacencyGraph, startTract, direction);
      
      return {
        phase: 'phase1',
        step: 0,
        totalSteps: 1,
        isComplete: true,
        message: `Phase 1 Complete: ${sortedTracts.length} tracts sorted using northwest expansion`,
        sortedTracts: sortedTracts
      };
    } else {
      // Phase 2: Divide into 2 groups and alternate latitude/longitude sorting
      return await this.executePhase2Step(tracts, step);
    }
  }

  /**
   * Execute Phase 2: Recursive district division with alternating latitude/longitude sorting
   * @param tracts Array of sorted tracts from Phase 1
   * @param step Current step number (1-based for Phase 2)
   * @returns Phase 2 step result
   */
  private async executePhase2Step(tracts: GeoJsonFeature[], step: number): Promise<GeoGraphStepResult> {
    console.log(`📍 PHASE 2 Step ${step}: Recursive district division`);

    // Calculate total population for division ratio
    const totalPopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    
    // For demonstration, we'll simulate dividing into 2 districts
    // In a real implementation, this would use the actual target district count
    const targetDistricts = 2;
    const division = this.calculateOptimalDivision(targetDistricts);
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;

    console.log(`📊 Division ratio: ${division.ratio[0]}% / ${division.ratio[1]}% (${division.first} / ${division.second} districts)`);
    console.log(`🎯 Target first group population: ${targetFirstGroupPopulation.toLocaleString()}`);

    // Alternate between latitude and longitude sorting
    const isLatitudeStep = step % 2 === 1; // Odd steps = latitude, Even steps = longitude
    const sortDirection = isLatitudeStep ? 'latitude' : 'longitude';
    const fillDirection = isLatitudeStep ? 'east/west' : 'north/south';

    console.log(`🔄 Step ${step}: ${sortDirection} sorting (fills ${fillDirection})`);

    // Sort tracts using geo-graph algorithm
    let sortedTracts: GeoJsonFeature[];
    try {
      // Get state from first tract
      const state = tracts[0].properties?.STATE || '';
      if (state) {
        // Load S4 adjacency data
        const adjacencyGraph = await this.loadS4AdjacencyData(state);
        
        // Find appropriate starting tract based on direction
        let startTract: GeoJsonFeature | null;
        if (isLatitudeStep) {
          startTract = this.findNorthwestMostTract(tracts);
        } else {
          startTract = this.findSouthwestMostTract(tracts);
        }
        
        if (startTract) {
          // Use geo-graph traversal for proper sorting
          sortedTracts = this.geoGraphTraversalService.performGeoGraphTraversal(tracts, adjacencyGraph, startTract, sortDirection);
        } else {
          // Fallback to simple sorting
          sortedTracts = this.sortTractsForLatLongAlgorithm(tracts, sortDirection);
        }
      } else {
        // Fallback to simple sorting
        sortedTracts = this.sortTractsForLatLongAlgorithm(tracts, sortDirection);
      }
    } catch (error) {
      console.warn('⚠️ Error in geo-graph sorting, falling back to simple sorting:', error);
      sortedTracts = this.sortTractsForLatLongAlgorithm(tracts, sortDirection);
    }

    // Divide tracts by accumulating population
    let accumulatedPopulation = 0;
    let splitIndex = 0;

    for (let i = 0; i < sortedTracts.length; i++) {
      const tract = sortedTracts[i];
      const tractPopulation = tract.properties?.POPULATION || 0;
      
      if (accumulatedPopulation + tractPopulation >= targetFirstGroupPopulation && splitIndex === 0) {
        splitIndex = i;
        break;
      }
      
      accumulatedPopulation += tractPopulation;
    }

    // Ensure we have at least one tract in each group
    if (splitIndex === 0) splitIndex = 1;
    if (splitIndex >= sortedTracts.length) splitIndex = sortedTracts.length - 1;

    let group1 = sortedTracts.slice(0, splitIndex);
    let group2 = sortedTracts.slice(splitIndex);

    // Identify and merge enclosed tracts with their containers
    // This prevents isolated tracts from being separated from their containing tracts
    const enclosedTracts = this.findContainedTracts(tracts, true);
    if (enclosedTracts.length > 0) {
      console.log(`🔍 Found ${enclosedTracts.length} enclosed tract(s), checking for group mismatches...`);
      
      // Create maps for quick lookup
      const group1TractIds = new Set(group1.map(t => this.getTractId(t)));
      const group2TractIds = new Set(group2.map(t => this.getTractId(t)));
      const allTractMap = new Map<string, GeoJsonFeature>();
      for (const tract of tracts) {
        allTractMap.set(this.getTractId(tract), tract);
      }
      
      let movedCount = 0;
      for (const { container, contained } of enclosedTracts) {
        const containerInGroup1 = group1TractIds.has(container);
        const containerInGroup2 = group2TractIds.has(container);
        const containedInGroup1 = group1TractIds.has(contained);
        const containedInGroup2 = group2TractIds.has(contained);
        
        // If enclosed tract and container are in different groups, move enclosed to container's group
        if (containerInGroup1 && containedInGroup2) {
          // Move contained tract from group2 to group1
          const containedTract = allTractMap.get(contained);
          if (containedTract) {
            group2 = group2.filter(t => this.getTractId(t) !== contained);
            group1.push(containedTract);
            group1TractIds.add(contained);
            group2TractIds.delete(contained);
            movedCount++;
            console.log(`📦 Moving enclosed tract ${contained} from group 2 to group 1 (container ${container} is in group 1)`);
          }
        } else if (containerInGroup2 && containedInGroup1) {
          // Move contained tract from group1 to group2
          const containedTract = allTractMap.get(contained);
          if (containedTract) {
            group1 = group1.filter(t => this.getTractId(t) !== contained);
            group2.push(containedTract);
            group1TractIds.delete(contained);
            group2TractIds.add(contained);
            movedCount++;
            console.log(`📦 Moving enclosed tract ${contained} from group 1 to group 2 (container ${container} is in group 2)`);
          }
        }
      }
      
      if (movedCount > 0) {
        console.log(`✅ Moved ${movedCount} enclosed tract(s) to be with their containers`);
      }
    }

    const group1Population = group1.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const group2Population = group2.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);

    console.log(`📊 ${sortDirection} division: ${group1.length} tracts (${group1Population.toLocaleString()} people) + ${group2.length} tracts (${group2Population.toLocaleString()} people)`);

    const currentDistricts = [group1, group2];
    const nextSortDirection = (step + 1) % 2 === 1 ? 'latitude' : 'longitude';
    const nextFillDirection = nextSortDirection === 'latitude' ? 'east/west' : 'north/south';

    // Calculate total steps needed (roughly log2 of target districts)
    const totalSteps = Math.ceil(Math.log2(targetDistricts)) + 2; // Add buffer for demonstration

    return {
      phase: 'phase2',
      step: step,
      totalSteps: totalSteps,
      isComplete: step >= totalSteps,
      message: `Step ${step}: ${sortDirection} division complete (${fillDirection} fill). ${group1.length} + ${group2.length} tracts. Next: ${nextSortDirection} sorting (${nextFillDirection} fill)`,
      sortedTracts: sortedTracts,
      currentDistricts: currentDistricts,
      nextAction: nextSortDirection === 'latitude' ? 'northwest' : 'southwest',
      groupIndex: step % 2
    };
  }

  /**
   * Sort tracts using Brown S4 adjacency data
   * @param tracts Array of tracts
   * @param direction Sorting direction
   * @returns Sorted tracts using S4 adjacency
   */
  public async sortTractsByBrownS4(tracts: GeoJsonFeature[], direction: 'latitude' | 'longitude'): Promise<GeoJsonFeature[]> {
    if (tracts.length <= 1) return tracts;

    console.log(`🔄 Starting Brown S4 adjacency-based sorting for ${tracts.length} tracts (${direction} direction)`);

    try {
      // Get state from first tract
      const state = tracts[0].properties?.STATE || '';
      if (!state) {
        console.warn('⚠️  No state found in tract properties, falling back to greedy traversal');
        return this.sortTractsByGreedyTraversal(tracts, direction);
      }

      // Load S4 adjacency data
      const adjacencyGraph = await this.loadS4AdjacencyData(state);
      
      // Find starting tract (NW-most for lat-sort; SW-most for long-sort)
      const startTract = this.findStartingTract(tracts, direction);
      if (!startTract) {
        console.warn('Could not find starting tract, falling back to greedy traversal');
        return this.sortTractsByGreedyTraversal(tracts, direction);
      }

      console.log(`📍 Starting tract: ${this.getTractId(startTract)} at (${this.getNorthwestCoordinate(startTract).lat.toFixed(6)}, ${this.getNorthwestCoordinate(startTract).lng.toFixed(6)})`);

      // Perform S4-based traversal
      const sortedTracts = this.performS4Traversal(tracts, adjacencyGraph, startTract, direction);

      console.log(`✅ Brown S4 traversal complete: ${sortedTracts.length} tracts sorted`);
      return sortedTracts;
    } catch (error) {
      console.error('❌ Error in Brown S4 traversal, falling back to greedy traversal:', error);
      return this.sortTractsByGreedyTraversal(tracts, direction);
    }
  }

  /**
   * Perform traversal using S4 adjacency data
   * @param tracts Array of tracts
   * @param adjacencyGraph S4 adjacency graph
   * @param startTract Starting tract
   * @param direction Traversal direction
   * @returns Sorted tracts
   */
  private performS4Traversal(tracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>, startTract: GeoJsonFeature, direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    console.log(`🚀 Starting S4 traversal from ${this.getTractId(startTract)}`);

    const tractMap = new Map<string, GeoJsonFeature>();
    for (const tract of tracts) {
      tractMap.set(this.getTractId(tract), tract);
    }

    const visited = new Set<string>();
    const sortedTracts: GeoJsonFeature[] = [];
    const queue: { tract: GeoJsonFeature; priority: number }[] = [];

    // Initialize with starting tract
    const startTractId = this.getTractId(startTract);
    queue.push({ tract: startTract, priority: 0 });
    visited.add(startTractId);
    sortedTracts.push(startTract);

    let iterationCount = 0;
    while (queue.length > 0 && iterationCount < 1000) { // Safety limit
      const { tract: currentTract } = queue.shift()!;
      const currentTractId = this.getTractId(currentTract);
      
      // Get neighbors from S4 adjacency data
      const neighbors = adjacencyGraph.get(currentTractId) || [];

      if (iterationCount < 5) { // Log first few iterations
        console.log(`🔄 S4 traversal iteration ${iterationCount}: processing tract ${currentTractId} with ${neighbors.length} neighbors`);
      }

      // Get unvisited neighbors and calculate directional scores
      const candidateNeighbors = neighbors
        .filter(neighborId => !visited.has(neighborId))
        .map(neighborId => {
          const neighborTract = tractMap.get(neighborId);
          if (!neighborTract) return null;

          const currentNorthwest = this.getNorthwestCoordinate(currentTract);
          const neighborNorthwest = this.getNorthwestCoordinate(neighborTract);

          // Calculate directional score (northeast bias)
          const latDiff = neighborNorthwest.lat - currentNorthwest.lat;
          const lngDiff = neighborNorthwest.lng - currentNorthwest.lng;
          const epsilon = 0.1; // Scale factor for longitude

          let score: number;
          if (direction === 'latitude') {
            // For lat-sort: prefer south (negative lat diff) then east (positive lng diff)
            score = -latDiff + epsilon * lngDiff;
          } else {
            // For long-sort: prefer east (positive lng diff) then south (negative lat diff)
            score = lngDiff + epsilon * (-latDiff);
          }

          return { tract: neighborTract, score };
        })
        .filter((item): item is { tract: GeoJsonFeature; score: number } => item !== null)
        .sort((a, b) => b.score - a.score); // Sort by score descending (best first)

      // Add neighbors to queue and mark as visited
      for (const { tract: neighborTract } of candidateNeighbors) {
        const neighborTractId = this.getTractId(neighborTract);
        visited.add(neighborTractId);
        sortedTracts.push(neighborTract);
        queue.push({ tract: neighborTract, priority: queue.length + 1 });
      }

      iterationCount++;
    }

    if (iterationCount >= 1000) {
      console.warn(`⚠️  S4 traversal stopped at iteration limit (1000)`);
    }

    // Handle any disconnected components
    const unvisitedTracts = tracts.filter(tract => !visited.has(this.getTractId(tract)));
    if (unvisitedTracts.length > 0) {
      console.log(`⚠️  Found ${unvisitedTracts.length} disconnected tracts (${(unvisitedTracts.length / tracts.length * 100).toFixed(1)}%)`);

      // If too many tracts are disconnected, fall back to centroid sorting
      if (unvisitedTracts.length > tracts.length * 0.3) { // More than 30% disconnected
        console.log(`🔄 Too many disconnected tracts, falling back to centroid sorting`);
        return this.sortTractsByCentroid(tracts, direction);
      }

      // Sort disconnected tracts by centroid and add them
      const sortedUnvisited = this.sortTractsByCentroid(unvisitedTracts, direction);
      sortedTracts.push(...sortedUnvisited);
    }

    console.log(`✅ S4 traversal complete: ${sortedTracts.length} tracts processed`);
    return sortedTracts;
  }

  /**
   * Divide district group using Geo-Graph algorithm
   * @param group District group to divide
   * @param direction Division direction
   * @returns Division result
   */
  private async divideDistrictGroupGeoGraph(group: DistrictGroup, direction: 'latitude' | 'longitude'): Promise<{ groups: DistrictGroup[]; history: string[] }> {
    console.log(`🔄 Using Geo-Graph algorithm for ${group.censusTracts.length} tracts (${group.totalDistricts} districts)`);

    try {
      // Sort tracts using Geo-Graph algorithm with proper zig-zag pattern
      const sortedTracts = await this.sortTractsByGeoGraph(group.censusTracts, direction);

      // Update the group with sorted tracts
      group.censusTracts = sortedTracts;

      // Calculate division ratio based on number of districts
      const division = this.calculateOptimalDivision(group.totalDistricts);
      const targetFirstGroupPopulation = (group.totalPopulation * division.ratio[0]) / 100;

      console.log(`📊 Division ratio: ${division.ratio[0]}% / ${division.ratio[1]}% (${division.first} / ${division.second} districts)`);
      console.log(`🎯 Target first group population: ${targetFirstGroupPopulation.toLocaleString()} (${((targetFirstGroupPopulation / group.totalPopulation) * 100).toFixed(1)}%)`);

      // Divide tracts by accumulating population using geo-graph sorted order
      let accumulatedPopulation = 0;
      let splitIndex = 0;

      for (let i = 0; i < sortedTracts.length; i++) {
        const tract = sortedTracts[i];
        const tractPopulation = tract.properties?.POPULATION || 0;
        
        if (accumulatedPopulation + tractPopulation >= targetFirstGroupPopulation && splitIndex === 0) {
          splitIndex = i;
          break;
        }
        
        accumulatedPopulation += tractPopulation;
      }

      // Ensure we have at least one tract in each group
      if (splitIndex === 0) splitIndex = 1;
      if (splitIndex >= sortedTracts.length) splitIndex = sortedTracts.length - 1;

      const firstGroupTracts = sortedTracts.slice(0, splitIndex);
      const secondGroupTracts = sortedTracts.slice(splitIndex);

      const firstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
      const secondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);

      // Calculate population variance for quality assessment
      const firstGroupVariance = Math.abs(firstGroupPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation;
      const secondGroupVariance = Math.abs(secondGroupPopulation - (group.totalPopulation - targetFirstGroupPopulation)) / (group.totalPopulation - targetFirstGroupPopulation);
      const totalVariance = (firstGroupVariance + secondGroupVariance) / 2;

      console.log(`📊 Population distribution: ${firstGroupPopulation.toLocaleString()} (${((firstGroupPopulation / group.totalPopulation) * 100).toFixed(1)}%) + ${secondGroupPopulation.toLocaleString()} (${((secondGroupPopulation / group.totalPopulation) * 100).toFixed(1)}%)`);
      console.log(`📊 Population variance: ${(totalVariance * 100).toFixed(2)}%`);

      const firstGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.startDistrictNumber + division.first - 1,
        censusTracts: firstGroupTracts,
        totalDistricts: division.first,
        totalPopulation: firstGroupPopulation,
        bounds: this.calculateBounds(firstGroupTracts),
        centroid: this.calculateCentroid(firstGroupTracts)
      };

      const secondGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber + division.first,
        endDistrictNumber: group.endDistrictNumber,
        censusTracts: secondGroupTracts,
        totalDistricts: division.second,
        totalPopulation: secondGroupPopulation,
        bounds: this.calculateBounds(secondGroupTracts),
        centroid: this.calculateCentroid(secondGroupTracts)
      };

      console.log(
        `✅ Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} using Geo-Graph into ${division.first} + ${division.second} districts`,
        `Populations: ${firstGroupPopulation.toLocaleString()} + ${secondGroupPopulation.toLocaleString()} (variance: ${(totalVariance * 100).toFixed(2)}%)`
      );

      const history = [
        `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} using Geo-Graph into ${division.first} + ${division.second} districts`,
        `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroupPopulation.toLocaleString()} people (${((firstGroupPopulation / group.totalPopulation) * 100).toFixed(1)}%), ${firstGroupTracts.length} tracts`,
        `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroupPopulation.toLocaleString()} people (${((secondGroupPopulation / group.totalPopulation) * 100).toFixed(1)}%), ${secondGroupTracts.length} tracts`,
        `  - Population variance: ${(totalVariance * 100).toFixed(2)}%`
      ];

      return { groups: [firstGroup, secondGroup], history };
    } catch (error) {
      console.error('❌ Error in Geo-Graph division, falling back to greedy traversal:', error);
      return this.divideDistrictGroupGreedyTraversal(group, direction);
    }
  }

  /**
   * Divide district group using Brown S4 algorithm
   * @param group District group to divide
   * @param direction Division direction
   * @returns Division result
   */
  private async divideDistrictGroupBrownS4(group: DistrictGroup, direction: 'latitude' | 'longitude'): Promise<{ groups: DistrictGroup[]; history: string[] }> {
    console.log(`🔄 Using Brown S4 algorithm for ${group.censusTracts.length} tracts`);

    try {
      // Sort tracts using Brown S4 adjacency
      const sortedTracts = await this.sortTractsByBrownS4(group.censusTracts, direction);

      // Update the group with sorted tracts
      group.censusTracts = sortedTracts;

      // Divide tracts by accumulating population
      const division = this.calculateOptimalDivision(group.totalDistricts);
      const targetFirstGroupPopulation = (group.totalPopulation * division.ratio[0]) / 100;

      let accumulatedPopulation = 0;
      let splitIndex = 0;

      for (let i = 0; i < sortedTracts.length; i++) {
        const tract = sortedTracts[i];
        const tractPopulation = tract.properties?.POPULATION || 0;
        
        if (accumulatedPopulation + tractPopulation >= targetFirstGroupPopulation && splitIndex === 0) {
          splitIndex = i;
          break;
        }
        
        accumulatedPopulation += tractPopulation;
      }

      // Ensure we have at least one tract in each group
      if (splitIndex === 0) splitIndex = 1;
      if (splitIndex >= sortedTracts.length) splitIndex = sortedTracts.length - 1;

      const firstGroupTracts = sortedTracts.slice(0, splitIndex);
      const secondGroupTracts = sortedTracts.slice(splitIndex);

      const firstGroupPopulation = firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
      const secondGroupPopulation = secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);

      const firstGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber,
        endDistrictNumber: group.startDistrictNumber + division.first - 1,
        censusTracts: firstGroupTracts,
        totalDistricts: division.first,
        totalPopulation: firstGroupPopulation,
        bounds: this.calculateBounds(firstGroupTracts),
        centroid: this.calculateCentroid(firstGroupTracts)
      };

      const secondGroup: DistrictGroup = {
        startDistrictNumber: group.startDistrictNumber + division.first,
        endDistrictNumber: group.endDistrictNumber,
        censusTracts: secondGroupTracts,
        totalDistricts: division.second,
        totalPopulation: secondGroupPopulation,
        bounds: this.calculateBounds(secondGroupTracts),
        centroid: this.calculateCentroid(secondGroupTracts)
      };

      console.log(
        `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} using Brown S4 into ${division.first} + ${division.second} districts`,
        `Populations: ${firstGroupPopulation.toLocaleString()} + ${secondGroupPopulation.toLocaleString()}`
      );

      const history = [
        `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} using Brown S4 into ${division.first} + ${division.second} districts`,
        `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroupPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
        `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroupPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`
      ];

      return { groups: [firstGroup, secondGroup], history };
    } catch (error) {
      console.error('❌ Error in Brown S4 division, falling back to greedy traversal:', error);
      return this.divideDistrictGroupGreedyTraversal(group, direction);
    }
  }

  /**
   * Public method to sort tracts by algorithm for debugging purposes
   * @param tractsWithCentroids Array of tracts with centroids
   * @param algorithm Algorithm to use for sorting
   * @returns Sorted array of tracts with centroids
   */
  public sortTractsByAlgorithm(
    tractsWithCentroids: Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }>,
    algorithm: 'geographic' | 'latlong' | 'greedy-traversal' | 'brown-s4' | 'geo-graph'
  ): Array<{ tract: GeoJsonFeature, centroid: { lat: number, lng: number } }> {
    if (!tractsWithCentroids || tractsWithCentroids.length === 0) {
      return [];
    }

    const tracts = tractsWithCentroids.map(item => item.tract);

    let sortedTracts: GeoJsonFeature[];

    switch (algorithm) {
      case 'geographic':
        sortedTracts = this.sortTractsGeographically(tracts, 'latitude');
        break;
      case 'latlong':
        sortedTracts = this.sortTractsForLatLongAlgorithm(tracts, 'latitude');
        break;
      case 'greedy-traversal':
        sortedTracts = this.sortTractsByGreedyTraversal(tracts, 'latitude');
        break;
      case 'brown-s4':
        // Note: This method is async, but this public wrapper is synchronous.
        // The TractDebugPageComponent handles the async call directly.
        console.warn('Brown S4 algorithm is asynchronous and should be called directly for full functionality.');
        sortedTracts = this.sortTractsByGreedyTraversal(tracts, 'latitude'); // Fallback for sync call
        break;
      case 'geo-graph':
        // Note: This method is async, but this public wrapper is synchronous.
        // The TractDebugPageComponent handles the async call directly.
        console.warn('Geo-Graph algorithm is asynchronous and should be called directly for full functionality.');
        sortedTracts = this.sortTractsByGreedyTraversal(tracts, 'latitude'); // Fallback for sync call
        break;
      default:
        console.warn(`Unknown algorithm: ${algorithm}, falling back to geographic`);
        sortedTracts = this.sortTractsGeographically(tracts, 'latitude');
    }

    // Map back to tracts with centroids
    return sortedTracts.map(tract => {
      const originalItem = tractsWithCentroids.find(item => item.tract === tract);
      return originalItem || { tract, centroid: this.calculateTractCentroid(tract) };
    });
  }


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

