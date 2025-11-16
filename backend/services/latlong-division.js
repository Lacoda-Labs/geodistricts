const { calculateBounds, calculateCentroid, calculateTractCentroid } = require('./geodistrict-algorithm');

/**
 * LatLong Division Service
 * Divides district groups using latitude/longitude dividing lines
 */
class LatLongDivisionService {
  /**
   * Calculate optimal division ratio
   */
  calculateOptimalDivision(totalDistricts) {
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
   * Get tract bounds
   */
  getTractBounds(tract) {
    if (!tract.geometry) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

    if (tract.geometry.type === 'Polygon') {
      for (const ring of tract.geometry.coordinates) {
        for (const coord of ring) {
          const lng = coord[0];
          const lat = coord[1];
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            const lng = coord[0];
            const lat = coord[1];
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          }
        }
      }
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Check if tract is entirely north or west of a line
   */
  isTractEntirelyNorthOrWest(tract, direction, lineCoordinate) {
    const bounds = this.getTractBounds(tract);
    
    if (direction === 'latitude') {
      // For latitude: "north" means maxLat <= lineCoordinate (tract is entirely north)
      return bounds.maxLat <= lineCoordinate;
    } else {
      // For longitude: "west" means maxLng <= lineCoordinate (tract is entirely west)
      return bounds.maxLng <= lineCoordinate;
    }
  }

  /**
   * Calculate populations on each side of a dividing line
   */
  calculatePopulationsByLine(tracts, direction, lineCoordinate) {
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
   * Find optimal dividing line using iterative approach
   */
  findOptimalDividingLine(tracts, direction, targetPopulation) {
    // Get the range of coordinates for the direction using bounding boxes
    const bounds = tracts.map(tract => this.getTractBounds(tract));

    let minCoord, maxCoord;
    if (direction === 'latitude') {
      minCoord = Math.min(...bounds.map(b => b.minLat));
      maxCoord = Math.max(...bounds.map(b => b.maxLat));
    } else {
      minCoord = Math.min(...bounds.map(b => b.minLng));
      maxCoord = Math.max(...bounds.map(b => b.maxLng));
    }
    const centerCoord = (minCoord + maxCoord) / 2;

    // Start with center coordinate and iterate to find optimal position
    let currentLine = centerCoord;
    let bestLine = centerCoord;
    let bestDifference = Infinity;
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.0001; // About 10 meters

    while (iterations < maxIterations) {
      // Calculate populations on each side of the line
      const { firstGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, currentLine);

      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = currentLine;
      }

      // If we're close enough, stop
      if (difference < targetPopulation * 0.005) { // Within 0.5% of target
        break;
      }

      // Calculate adjustment based on population difference
      const populationDifference = firstGroupPopulation - targetPopulation;

      // Determine direction to move the line
      let adjustment;
      if (direction === 'latitude') {
        // For latitude: if first group has too many people, move line north (increase latitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      } else {
        // For longitude: if first group has too many people, move line east (increase longitude)
        adjustment = (populationDifference / targetPopulation) * (maxCoord - minCoord) * 0.1;
      }

      // Prevent infinite loops by ensuring we don't go outside bounds
      const newLine = Math.max(minCoord, Math.min(maxCoord, currentLine + adjustment));

      if (Math.abs(newLine - currentLine) < tolerance) {
        break;
      }

      currentLine = newLine;
      iterations++;
    }

    // If we didn't converge well, try binary search as fallback
    if (bestDifference > targetPopulation * 0.05) { // If still >5% off target
      const binarySearchLine = this.binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord);
      const binarySearchDifference = Math.abs(this.calculatePopulationsByLine(tracts, direction, binarySearchLine).firstGroupPopulation - targetPopulation);

      if (binarySearchDifference < bestDifference) {
        return binarySearchLine;
      }
    }

    return bestLine;
  }

  /**
   * Binary search for optimal dividing line
   */
  binarySearchOptimalLine(tracts, direction, targetPopulation, minCoord, maxCoord) {
    let left = minCoord;
    let right = maxCoord;
    let bestLine = (left + right) / 2;
    let bestDifference = Infinity;
    const maxIterations = 50;
    const tolerance = 0.0001;

    for (let i = 0; i < maxIterations; i++) {
      const mid = (left + right) / 2;
      const { firstGroupPopulation } = this.calculatePopulationsByLine(tracts, direction, mid);
      const difference = Math.abs(firstGroupPopulation - targetPopulation);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = mid;
      }

      if (difference < targetPopulation * 0.01 || Math.abs(right - left) < tolerance) {
        break;
      }

      if (firstGroupPopulation < targetPopulation) {
        left = mid; // Move north/east (increase coordinate)
      } else {
        right = mid; // Move south/west (decrease coordinate)
      }
    }

    return bestLine;
  }

  /**
   * Divide tracts by a lat/long line
   */
  divideTractsByLine(tracts, direction, dividingLine, targetFirstGroupPopulation, targetSecondGroupPopulation, history) {
    const firstGroupTracts = [];
    const secondGroupTracts = [];
    const intersectingTractIds = [];

    for (const tract of tracts) {
      const population = tract.properties?.POPULATION || 0;
      const bounds = this.getTractBounds(tract);
      
      let isEntirelyNorthOrWest = false;
      let intersectsLine = false;

      if (direction === 'latitude') {
        isEntirelyNorthOrWest = bounds.maxLat <= dividingLine;
        intersectsLine = bounds.minLat < dividingLine && bounds.maxLat > dividingLine;
      } else {
        isEntirelyNorthOrWest = bounds.maxLng <= dividingLine;
        intersectsLine = bounds.minLng < dividingLine && bounds.maxLng > dividingLine;
      }

      if (intersectsLine) {
        // Tract intersects the line - assign based on centroid
        const centroid = calculateTractCentroid(tract);
        const tractId = tract.properties?.TRACT_FIPS || tract.properties?.GEOID || 'unknown';
        
        if (direction === 'latitude') {
          if (centroid.lat <= dividingLine) {
            firstGroupTracts.push(tract);
          } else {
            secondGroupTracts.push(tract);
          }
        } else {
          if (centroid.lng <= dividingLine) {
            firstGroupTracts.push(tract);
          } else {
            secondGroupTracts.push(tract);
          }
        }
        
        intersectingTractIds.push(tractId);
      } else if (isEntirelyNorthOrWest) {
        firstGroupTracts.push(tract);
      } else {
        secondGroupTracts.push(tract);
      }
    }

    return { firstGroupTracts, secondGroupTracts, intersectingTractIds };
  }

  /**
   * Validate contiguity (simplified - always returns true for now)
   * TODO: Implement full contiguity checking using S4 adjacency data
   */
  validateContiguity(tracts, groupName) {
    // Simplified: always return true
    // Full implementation would use S4 adjacency data to check if all tracts are connected
    return true;
  }

  /**
   * Divide a district group using lat/long dividing lines algorithm
   * @param {Object} group - District group to divide
   * @param {string} direction - Division direction ('latitude' or 'longitude')
   * @param {boolean} forceRecalculate - Force recalculation (ignored for now)
   * @returns {Promise<Object>} Division result
   */
  async divideDistrictGroup(group, direction, forceRecalculate = false) {
    const { totalDistricts } = group;

    // Calculate how to divide the districts
    const division = this.calculateOptimalDivision(totalDistricts);

    // Calculate target population for each group
    const totalPopulation = group.totalPopulation;
    const targetFirstGroupPopulation = (totalPopulation * division.ratio[0]) / 100;
    const targetSecondGroupPopulation = group.totalPopulation - targetFirstGroupPopulation;

    // Find the dividing line using iterative approach
    const dividingLine = this.findOptimalDividingLine(group.censusTracts, direction, targetFirstGroupPopulation);

    // Create history array
    const history = [];

    // Divide tracts based on the dividing line
    const { firstGroupTracts, secondGroupTracts, intersectingTractIds } = this.divideTractsByLine(
      group.censusTracts,
      direction,
      dividingLine,
      targetFirstGroupPopulation,
      targetSecondGroupPopulation,
      history
    );

    // Validate contiguity of both groups
    const firstGroupContiguous = this.validateContiguity(firstGroupTracts, `First Group (Districts ${group.startDistrictNumber}-${group.startDistrictNumber + division.first - 1})`);
    const secondGroupContiguous = this.validateContiguity(secondGroupTracts, `Second Group (Districts ${group.startDistrictNumber + division.first}-${group.endDistrictNumber})`);

    if (!firstGroupContiguous || !secondGroupContiguous) {
      console.warn(`⚠️  Lat/long division resulted in non-contiguous groups. This is expected for some geographic configurations.`);
    }

    // Create new district groups
    const firstGroup = {
      startDistrictNumber: group.startDistrictNumber,
      endDistrictNumber: group.startDistrictNumber + division.first - 1,
      censusTracts: firstGroupTracts,
      totalDistricts: division.first,
      totalPopulation: firstGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: calculateBounds(firstGroupTracts),
      centroid: calculateCentroid(firstGroupTracts)
    };

    const secondGroup = {
      startDistrictNumber: group.startDistrictNumber + division.first,
      endDistrictNumber: group.endDistrictNumber,
      censusTracts: secondGroupTracts,
      totalDistricts: division.second,
      totalPopulation: secondGroupTracts.reduce((sum, tract) => sum + (tract.properties?.POPULATION || 0), 0),
      bounds: calculateBounds(secondGroupTracts),
      centroid: calculateCentroid(secondGroupTracts)
    };

    // Calculate variance
    const actualFirstPopulation = firstGroup.totalPopulation;
    const actualVariance = Math.abs(actualFirstPopulation - targetFirstGroupPopulation) / targetFirstGroupPopulation;

    // Format ratio for display
    const ratioDisplay = `${division.ratio[0]}/${division.ratio[1]}`;

    // Add history entries
    history.push(
      `Group ${group.startDistrictNumber}-${group.endDistrictNumber}: Divided by ${direction} lat/long line at ${dividingLine.toFixed(6) + (direction === 'latitude' ? '°N' : '°W')} by ${ratioDisplay} ratio`,
      `  - First group: Districts ${firstGroup.startDistrictNumber}-${firstGroup.endDistrictNumber}, ${firstGroup.totalPopulation.toLocaleString()} people, ${firstGroupTracts.length} tracts`,
      `  - Second group: Districts ${secondGroup.startDistrictNumber}-${secondGroup.endDistrictNumber}, ${secondGroup.totalPopulation.toLocaleString()} people, ${secondGroupTracts.length} tracts`,
      `  - Population variance: ${(actualVariance * 100).toFixed(1)}%`
    );

    return {
      groups: [firstGroup, secondGroup],
      history,
      dividingLine,
      intersectingTractIds
    };
  }
}

module.exports = new LatLongDivisionService();

