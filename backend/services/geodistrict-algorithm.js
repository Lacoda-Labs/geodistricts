const s4DataLoader = require('./s4-data-loader');

/**
 * Algorithm version - increment this when algorithm logic changes
 */
const ALGORITHM_VERSION = '20251113-1400';

/**
 * Congressional districts per state (2020 census apportionment)
 */
const CONGRESSIONAL_DISTRICTS_BY_STATE = {
  'AL': 7, 'AK': 1, 'AZ': 9, 'AR': 4, 'CA': 52,
  'CO': 8, 'CT': 5, 'DE': 1, 'FL': 28, 'GA': 14,
  'HI': 2, 'ID': 2, 'IL': 17, 'IN': 9, 'IA': 4,
  'KS': 4, 'KY': 6, 'LA': 6, 'ME': 2, 'MD': 8,
  'MA': 9, 'MI': 13, 'MN': 8, 'MS': 4, 'MO': 8,
  'MT': 2, 'NE': 3, 'NV': 4, 'NH': 2, 'NJ': 12,
  'NM': 3, 'NY': 26, 'NC': 14, 'ND': 1, 'OH': 15,
  'OK': 5, 'OR': 6, 'PA': 17, 'RI': 2, 'SC': 7,
  'SD': 1, 'TN': 9, 'TX': 38, 'UT': 4, 'VT': 1,
  'VA': 11, 'WA': 10, 'WV': 2, 'WI': 8, 'WY': 1,
  'DC': 1
};

/**
 * Get number of congressional districts for a state
 */
function getDistrictsForState(state) {
  return CONGRESSIONAL_DISTRICTS_BY_STATE[state.toUpperCase()] || null;
}

/**
 * Get tract ID from a GeoJSON feature
 */
function getTractId(tract) {
  return tract.properties?.TRACT_FIPS || tract.properties?.GEOID || tract.properties?.GEO_ID || null;
}

/**
 * Calculate bounds for a group of tracts
 */
function calculateBounds(tracts) {
  if (tracts.length === 0) {
    return { north: 0, south: 0, east: 0, west: 0 };
  }

  let north = -90, south = 90, east = -180, west = 180;

  for (const tract of tracts) {
    const centroid = calculateTractCentroid(tract);
    north = Math.max(north, centroid.lat);
    south = Math.min(south, centroid.lat);
    east = Math.max(east, centroid.lng);
    west = Math.min(west, centroid.lng);
  }

  return { north, south, east, west };
}

/**
 * Calculate centroid for a single tract
 */
function calculateTractCentroid(tract) {
  if (!tract.geometry) return { lat: 0, lng: 0 };
  
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
 * Calculate centroid for a group of tracts (population-weighted)
 */
function calculateCentroid(tracts) {
  if (tracts.length === 0) {
    return { lat: 0, lng: 0 };
  }

  let totalLat = 0, totalLng = 0, totalPopulation = 0;

  for (const tract of tracts) {
    const population = tract.properties?.POPULATION || 0;
    const centroid = calculateTractCentroid(tract);
    
    totalLat += centroid.lat * population;
    totalLng += centroid.lng * population;
    totalPopulation += population;
  }

  if (totalPopulation === 0) {
    // Fallback to geometric centroid if no population data
    let sumLat = 0, sumLng = 0;
    for (const tract of tracts) {
      const centroid = calculateTractCentroid(tract);
      sumLat += centroid.lat;
      sumLng += centroid.lng;
    }
    return { lat: sumLat / tracts.length, lng: sumLng / tracts.length };
  }

  return {
    lat: totalLat / totalPopulation,
    lng: totalLng / totalPopulation
  };
}

/**
 * Calculate optimal division ratio
 */
function calculateOptimalDivision(totalDistricts) {
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
 * Create a step object
 */
function createStep(step, level, districtGroups, description, divisionDirection, divisionLine, divisionLines) {
  return {
    step,
    level,
    districtGroups,
    description,
    totalGroups: districtGroups.length,
    totalDistricts: districtGroups.reduce((sum, g) => sum + g.totalDistricts, 0),
    divisionDirection: divisionDirection || 'latitude',
    divisionLine,
    divisionLines: divisionLines || []
  };
}

/**
 * Geodistrict Algorithm Service
 * Executes the geodistricting algorithm
 */
class GeodistrictAlgorithmService {
  constructor(latLongDivisionService) {
    this.latLongDivisionService = latLongDivisionService;
  }

  /**
   * Execute the geodistrict algorithm
   * @param {Array} tracts - Array of GeoJSON tract features
   * @param {number} totalDistricts - Total number of districts to create
   * @param {number} maxIterations - Maximum iterations
   * @param {string} algorithm - Algorithm type ('latlong')
   * @param {boolean} forceInvalidate - Force recalculation
   * @returns {Promise<Object>} GeodistrictResult
   */
  async executeGeodistrictAlgorithm(tracts, totalDistricts, maxIterations, algorithm = 'latlong', forceInvalidate = false) {
    // Preload S4 adjacency data if available
    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      try {
        await s4DataLoader.loadS4AdjacencyData(state);
        console.log(`✅ Preloaded S4 adjacency data for ${state} before algorithm execution`);
      } catch (error) {
        console.warn(`⚠️ Failed to preload S4 adjacency data for ${state}:`, error);
      }
    }

    // Calculate total state population
    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    // Initialize with all tracts as a single district group
    const initialGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: tracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: calculateBounds(tracts),
      centroid: calculateCentroid(tracts)
    };

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Create initial step
    steps.push(createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude'));

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const newGroups = [];
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';

      const divisionLines = [];
      let divisionLine = undefined;

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          // This group is already a single district
          newGroups.push(group);
          algorithmHistory.push(`Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Already single district`);
        } else {
          // Calculate division ratio for this group
          const division = calculateOptimalDivision(group.totalDistricts);
          
          // Divide this group using latlong algorithm
          const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, forceInvalidate);
          
          if (!divisionResult) {
            throw new Error('Division result is undefined');
          }
          
          newGroups.push(...divisionResult.groups);
          algorithmHistory.push(...divisionResult.history);
          
          // Capture dividing line if available
          if (divisionResult.dividingLine !== undefined) {
            divisionLine = divisionResult.dividingLine;
            
            divisionLines.push({
              line: divisionResult.dividingLine,
              direction: direction,
              parentGroup: {
                startDistrictNumber: group.startDistrictNumber,
                endDistrictNumber: group.endDistrictNumber,
                totalDistricts: group.totalDistricts
              },
              ratio: division.ratio,
              intersectingTractIds: divisionResult.intersectingTractIds
            });
          }
        }
      }

      currentGroups = newGroups;
      
      // Validate: Ensure all tracts are assigned to exactly one group
      const assignedTractIds = new Set();
      for (const group of currentGroups) {
        for (const tract of group.censusTracts) {
          const tractId = getTractId(tract);
          if (assignedTractIds.has(tractId)) {
            console.error(`⚠️ ERROR: Tract ${tractId} is assigned to multiple groups!`);
          }
          assignedTractIds.add(tractId);
        }
      }
      
      // Check for missing tracts
      const allTractIds = new Set(tracts.map(t => getTractId(t)));
      const missingTracts = [];
      for (const tractId of allTractIds) {
        if (!assignedTractIds.has(tractId)) {
          missingTracts.push(tractId);
        }
      }
      
      if (missingTracts.length > 0) {
        console.error(`⚠️ ERROR: ${missingTracts.length} tract(s) not assigned to any group after division step ${iteration}`);
        
        // Assign missing tracts to the nearest group based on centroid
        for (const missingTractId of missingTracts) {
          const missingTract = tracts.find(t => getTractId(t) === missingTractId);
          if (missingTract) {
            const tractCentroid = calculateTractCentroid(missingTract);
            let nearestGroup = null;
            let minDistance = Infinity;
            
            for (const group of currentGroups) {
              const groupCentroid = group.centroid;
              const distance = Math.sqrt(
                Math.pow(tractCentroid.lat - groupCentroid.lat, 2) +
                Math.pow(tractCentroid.lng - groupCentroid.lng, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                nearestGroup = group;
              }
            }
            
            if (nearestGroup) {
              nearestGroup.censusTracts.push(missingTract);
              nearestGroup.totalPopulation += missingTract.properties?.POPULATION || 0;
              nearestGroup.bounds = calculateBounds(nearestGroup.censusTracts);
              nearestGroup.centroid = calculateCentroid(nearestGroup.censusTracts);
              console.log(`🔧 Fixed: Assigned missing tract ${missingTractId} to group ${nearestGroup.startDistrictNumber}-${nearestGroup.endDistrictNumber}`);
            }
          }
        }
      }
      
      // TODO: Fix isolated tracts and rebalance populations
      // For now, we'll skip these steps to get basic algorithm working
      
      steps.push(createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${direction}`, direction, divisionLine, divisionLines));
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
   * Execute algorithm step-by-step (for SSE streaming)
   * @param {Array} tracts - Array of GeoJSON tract features
   * @param {number} totalDistricts - Total number of districts
   * @param {number} maxIterations - Maximum iterations
   * @param {string} algorithm - Algorithm type
   * @param {Function} onStep - Callback for each step
   * @returns {Promise<Object>} Final result
   */
  async *executeGeodistrictAlgorithmStepByStep(tracts, totalDistricts, maxIterations, algorithm = 'latlong', onStep) {
    // Similar to executeGeodistrictAlgorithm but yields steps as they're created
    const state = tracts[0]?.properties?.['STATE'] || '';
    if (state) {
      try {
        await s4DataLoader.loadS4AdjacencyData(state);
      } catch (error) {
        console.warn(`⚠️ Failed to preload S4 adjacency data:`, error);
      }
    }

    const totalStatePopulation = tracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0);
    const targetDistrictPopulation = totalStatePopulation / totalDistricts;

    const initialGroup = {
      startDistrictNumber: 1,
      endDistrictNumber: totalDistricts,
      censusTracts: tracts,
      totalDistricts: totalDistricts,
      totalPopulation: totalStatePopulation,
      bounds: calculateBounds(tracts),
      centroid: calculateCentroid(tracts)
    };

    const steps = [];
    const algorithmHistory = [];
    let currentGroups = [initialGroup];
    let iteration = 0;

    // Yield initial step
    const initialStep = createStep(0, 0, currentGroups, 'Initial state: All tracts in single group', 'latitude');
    steps.push(initialStep);
    yield { step: 0, data: initialStep, isComplete: false };

    // Main algorithm loop
    while (currentGroups.some(group => group.totalDistricts > 1) && iteration < maxIterations) {
      iteration++;
      const direction = iteration % 2 === 1 ? 'latitude' : 'longitude';
      const newGroups = [];
      const divisionLines = [];

      for (const group of currentGroups) {
        if (group.totalDistricts === 1) {
          newGroups.push(group);
        } else {
          const division = calculateOptimalDivision(group.totalDistricts);
          const divisionResult = await this.latLongDivisionService.divideDistrictGroup(group, direction, false);
          
          if (divisionResult) {
            newGroups.push(...divisionResult.groups);
            algorithmHistory.push(...divisionResult.history);
            
            if (divisionResult.dividingLine !== undefined) {
              divisionLines.push({
                line: divisionResult.dividingLine,
                direction: direction,
                parentGroup: {
                  startDistrictNumber: group.startDistrictNumber,
                  endDistrictNumber: group.endDistrictNumber,
                  totalDistricts: group.totalDistricts
                },
                ratio: division.ratio,
                intersectingTractIds: divisionResult.intersectingTractIds
              });
            }
          }
        }
      }

      currentGroups = newGroups;
      
      const step = createStep(iteration, iteration, currentGroups,
        `Division ${iteration} by ${direction}`, direction, undefined, divisionLines);
      steps.push(step);
      
      yield { step: iteration, data: step, isComplete: false };
    }

    // Calculate final statistics
    const finalDistricts = currentGroups;
    const averagePopulation = totalStatePopulation / finalDistricts.length;
    const populationVariance = finalDistricts.reduce((sum, district) =>
      sum + Math.pow(district.totalPopulation - averagePopulation, 2), 0) / finalDistricts.length;

    const result = {
      finalDistricts,
      steps,
      totalPopulation: totalStatePopulation,
      averagePopulation,
      populationVariance,
      algorithmHistory
    };

    yield { step: iteration, data: result, isComplete: true };
  }
}

module.exports = {
  GeodistrictAlgorithmService,
  getDistrictsForState,
  getTractId,
  calculateBounds,
  calculateCentroid,
  calculateTractCentroid,
  calculateOptimalDivision,
  createStep,
  ALGORITHM_VERSION
};

