import { Injectable } from '@angular/core';
import { GeoJsonFeature } from './census.service';
import * as turf from '@turf/turf';

/**
 * Service for performing geo-graph traversal operations using zig-zag patterns.
 * This class encapsulates the complex traversal logic for sorting tracts geographically.
 */
@Injectable({
  providedIn: 'root'
})
export class GeoGraphTraversalService {

  /**
   * Perform geo-graph traversal using proper zig-zag pattern as described in documentation:
   * - Latitude division: Start northwest → move east (northeast bias) → find southeastern tract → move west (northwest bias) → repeat southward
   * - Longitude division: Start southwest → move north (northwest bias) → find northwestern tract → move south (southwest bias) → repeat eastward
   *   This is the latitude algorithm rotated 90° counterclockwise
   * @param tracts Array of tracts
   * @param adjacencyGraph S4 adjacency graph
   * @param startTract Starting tract (northwest for latitude, southwest for longitude)
   * @param direction Traversal direction
   * @returns Sorted tracts
   */
  performGeoGraphTraversal(tracts: GeoJsonFeature[], adjacencyGraph: Map<string, string[]>, startTract: GeoJsonFeature, direction: 'latitude' | 'longitude'): GeoJsonFeature[] {
    const tractMap = new Map<string, GeoJsonFeature>();
    for (const tract of tracts) {
      const tractId = this.getTractId(tract);
      tractMap.set(tractId, tract);
    }

    // Pre-compute state boundary tracts (tracts that have edges on the state border)
    const stateBoundaryTracts = this.findStateBoundaryTracts(tracts);

    // Pre-compute containment relationships (allow large datasets for AZ with 1765 tracts)
    // Use adjacency graph to optimize: tracts with only 1 adjacent tract are likely contained
    const containedTracts = this.findContainedTracts(tracts, true, adjacencyGraph);
    const containerToContained = new Map<string, string[]>();
    for (const pair of containedTracts) {
      if (!containerToContained.has(pair.container)) {
        containerToContained.set(pair.container, []);
      }
      containerToContained.get(pair.container)!.push(pair.contained);
    }

    const visited = new Set<string>();
    const sortedTracts: GeoJsonFeature[] = [];

    // Helper function to add tract and its contained tracts
    function addTractWithContained(tractId: string) {
      if (visited.has(tractId)) return;
      visited.add(tractId);
      const tract = tractMap.get(tractId);
      if (tract) {
        sortedTracts.push(tract);
        // Add contained tracts immediately after
        const contained = containerToContained.get(tractId) || [];
        for (const containedId of contained) {
          if (!visited.has(containedId)) {
            visited.add(containedId);
            const containedTract = tractMap.get(containedId);
            if (containedTract) {
              sortedTracts.push(containedTract);
            }
          }
        }
      }
    }

    // Helper function to find the most extreme adjacent tract using clockwise sweep approach
    // Draws a line from the geometric midpoint, rotating clockwise from a starting direction,
    // and returns the first adjacent tract whose boundary is intersected by the line.
    const findExtremeAdjacentTract = (currentTractId: string, requestedDirection: 'east' | 'west' | 'north' | 'south' | 'northeast' | 'northwest' | 'southeast' | 'southwest'): GeoJsonFeature | null => {
      const adjacentIds = adjacencyGraph.get(currentTractId) || [];
      const currentTract = tractMap.get(currentTractId);
      if (!currentTract) return null;

      // Use geometric midpoint instead of northwest coordinate or centroid
      const currentMidpoint = this.getGeometricMidpoint(currentTract);

      // Get all unvisited adjacent tracts
      const unvisitedAdjacentTracts = adjacentIds
        .map(id => tractMap.get(id))
        .filter(tract => tract && !visited.has(this.getTractId(tract))) as GeoJsonFeature[];

      if (unvisitedAdjacentTracts.length === 0) return null;

      // Map direction to angle ranges for clockwise sweep
      const directionAngles: { [key: string]: { start: number; end: number } } = {
        'northeast': { start: 0, end: 90 },
        'east': { start: 45, end: 135 },
        'southeast': { start: 90, end: 180 },
        'south': { start: 135, end: 225 },
        'southwest': { start: 180, end: 270 },
        'west': { start: 225, end: 315 },
        'northwest': { start: 270, end: 360 },
        'north': { start: 315, end: 45 } // Wraps around
      };

      // Determine starting angle for clockwise sweep based on sort direction
      // For latitude sort: start at north (0°), for longitude sort: start at west (270°)
      // For longitude with northwest/southwest bias, we want to prioritize west-clockwise tracts
      // "West-clockwise" means starting from west (270°) and going clockwise:
      // west(270°) -> northwest(315°) -> north(0°) -> northeast(45°) -> etc.
      // So for northwest bias, we want to check northwest (315°) before pure west (270°)
      let sweepStartAngle = direction === 'longitude' ? 270 : 0;
      
      // For longitude division with northwest bias, start sweep slightly after west to prioritize northwest
      // This ensures we check northwest (315°) before checking pure west (270°)
      if (direction === 'longitude' && requestedDirection === 'northwest') {
        // Start at 271° (just after west) so northwest (315°) is checked before west (270° when angle wraps)
        // Actually, since we sweep clockwise, we want to prioritize angles closer to northwest (315°)
        // Start at west (270°) but adjust the range check to prioritize angles further clockwise
        sweepStartAngle = 270;
      }

      // Sweep the full 360 degrees clockwise from the starting angle
      const startAngle = sweepStartAngle;
      const endAngle = startAngle + 360; // Full 360 degree sweep

      // Sweep increment (in degrees) - smaller increments = more precise but slower
      const sweepIncrement = 0.1; // 0.1 degree increments

      // Get the angle range for the requested direction (for filtering)
      const range = directionAngles[requestedDirection];
      if (!range) {
        return null;
      }

      // Sweep clockwise from start angle for full 360 degrees
      for (let angle = startAngle; angle < endAngle; angle += sweepIncrement) {
        // Normalize angle to 0-360 range
        const normalizedAngle = angle % 360;
        
        // Convert angle to radians for calculations
        // Our angle convention: 0° = north, 90° = east, 180° = south, 270° = west (geographic)
        const angleRad = normalizedAngle * Math.PI / 180;
        
        // Calculate a point far away in the direction of the ray (for intersection testing)
        // Use a distance that's guaranteed to extend beyond any tract boundary
        // For geographic angles: 0° = north (lat increases), 90° = east (lng increases)
        // So: lat = lat0 + distance * cos(angle), lng = lng0 + distance * sin(angle)
        const rayDistance = 10.0; // 10 degrees (~1100km) should be plenty
        const rayEndPoint = {
          lat: currentMidpoint.lat + rayDistance * Math.cos(angleRad), // 0° = north, lat increases
          lng: currentMidpoint.lng + rayDistance * Math.sin(angleRad)  // 90° = east, lng increases
        };

        // Check if the current sweep angle falls within the requested direction range
        let inDirectionRange = false;
        if (range.start > range.end) {
          // Wraparound case (e.g., north: 315° to 45°)
          inDirectionRange = normalizedAngle >= range.start || normalizedAngle <= range.end;
        } else {
          inDirectionRange = normalizedAngle >= range.start && normalizedAngle <= range.end;
        }

        // For longitude division with northwest/southwest bias, prioritize west-clockwise angles
        // Exclude only pure west (around 270°) when requesting northwest to prioritize northwest (315°)
        // West-clockwise means starting from west (270°) and going clockwise to northwest (315°)
        // We only skip a small range around pure west (268°-275°) to allow northwest (315°+) to be checked first
        // but still allow northwest angles from 275°-315° to be considered
        if (direction === 'longitude' && requestedDirection === 'northwest' && normalizedAngle >= 268 && normalizedAngle < 275) {
          // Skip only a small range around pure west (268°-274.9°) to prioritize northwest (315°+)
          // This ensures we check northwest (315°+) before pure west (270°), but still allow northwest angles (275°-315°)
          inDirectionRange = false;
        }

        // Only check tracts if we're in the correct direction range
        if (inDirectionRange) {
          // Check each adjacent tract to see if the ray intersects its boundary
          // We don't filter by midpoint direction - the ray sweep and intersection is sufficient
          for (const tract of unvisitedAdjacentTracts) {
            // Check if ray from currentMidpoint to rayEndPoint intersects the tract's boundary
            // The angular range filter (inDirectionRange) ensures we're checking the correct direction
            const intersection = this.findLinePolygonIntersection(
              currentMidpoint,
              rayEndPoint,
              tract
            );

            if (intersection) {
              // Found the first intersection! This is the tract we want
              return tract;
            }
          }
        }
      }

      // No intersection found in the full 360 degree sweep
      return null;
    };

    // Helper function to find the next starting tract for a new row/column
    const findNextStartingTract = (): GeoJsonFeature | null => {
      // Get current tract's latitude to determine next row south
      const currentTract = tractMap.get(currentTractId);
      if (!currentTract) return null;

      const currentCoord = this.getNorthwestCoordinate(currentTract);

      if (direction === 'latitude') {
        // For latitude division: find the next row south and start from westernmost tract
        // This implements proper row-by-row zig-zag traversal as described in documentation

        // Find all unvisited tracts south of current position
        const southernTracts: { tract: GeoJsonFeature; coord: any }[] = [];

        for (const tract of tracts) {
          const tractId = this.getTractId(tract);
          if (visited.has(tractId)) continue;

          const coord = this.getNorthwestCoordinate(tract);
          if (coord.lat < currentCoord.lat) { // South of current position
            southernTracts.push({ tract, coord });
          }
        }

        if (southernTracts.length === 0) {
          return null; // No more tracts to visit
        }

        // Find the southernmost latitude among southern tracts
        let southernmostLat = -Infinity;
        for (const item of southernTracts) {
          if (item.coord.lat > southernmostLat) {
            southernmostLat = item.coord.lat;
          }
        }

        // Among tracts in the southernmost latitude band, find the westernmost
        let bestTract: GeoJsonFeature | null = null;
        let bestLng = Infinity;

        for (const item of southernTracts) {
          // Only consider tracts within a small latitude band of the southernmost
          if (Math.abs(item.coord.lat - southernmostLat) < 0.01) { // Within ~1km latitude
            if (item.coord.lng < bestLng) {
              bestLng = item.coord.lng;
              bestTract = item.tract;
            }
          }
        }


        return bestTract;
      } else {
        // For longitude division: find westernmost unvisited tract to start new column
        // This maintains the westward-to-eastward column progression pattern (rotated from latitude)
        let bestTract: GeoJsonFeature | null = null;
        let bestLng = Infinity; // Find westernmost (lowest longitude)

        for (const tract of tracts) {
          const tractId = this.getTractId(tract);
          if (visited.has(tractId)) continue;

          const coord = this.getSouthwestCoordinate(tract); // Use southwest coordinate
          if (coord.lng < bestLng) {
            bestLng = coord.lng;
            bestTract = tract;
          }
        }

        return bestTract;
      }
    };

    // Start with the appropriate starting tract
    const startTractId = this.getTractId(startTract);
    addTractWithContained(startTractId);

    let currentTractId = startTractId;
    let moveDirection: 'east' | 'west' | 'north' | 'south' = direction === 'latitude' ? 'east' : 'north';
    let iterationCount = 0;
    const maxIterations = Math.min(tracts.length * 3, 10000);

    // Main zig-zag traversal loop
    while (visited.size < tracts.length && iterationCount < maxIterations) {
      iterationCount++;

      // Find the most extreme adjacent tract in the current movement direction
      // Use biased directions to maintain zig-zag pattern
      let biasedDirection: 'east' | 'west' | 'north' | 'south' | 'northeast' | 'northwest' | 'southeast' | 'southwest';

      if (direction === 'latitude') {
        // Latitude division: maintain northward bias when moving east/west
        if (moveDirection === 'east') {
          biasedDirection = 'northeast'; // East movement with north bias
        } else if (moveDirection === 'west') {
          biasedDirection = 'northwest'; // West movement with north bias
        } else {
          biasedDirection = moveDirection;
        }
      } else {
        // Longitude division: maintain westward bias when moving north/south (rotate latitude 90° CCW)
        if (moveDirection === 'north') {
          biasedDirection = 'northwest'; // North movement with west bias (rotated from latitude's northeast)
        } else if (moveDirection === 'south') {
          biasedDirection = 'southwest'; // South movement with west bias (rotated from latitude's southeast)
        } else {
          biasedDirection = moveDirection;
        }
      }

      let nextTract = findExtremeAdjacentTract(currentTractId, biasedDirection);

      // Fallback: If moving west with northwest bias finds nothing, try northeast to maintain northward bias
      // This handles cases where the next tract is northeast (not northwest) but still maintains northward progression
      if (!nextTract && direction === 'latitude' && moveDirection === 'west' && biasedDirection === 'northwest') {
        nextTract = findExtremeAdjacentTract(currentTractId, 'northeast');
      }
      // Fallback: If moving east with northeast bias finds nothing, try northwest to maintain northward bias
      if (!nextTract && direction === 'latitude' && moveDirection === 'east' && biasedDirection === 'northeast') {
        nextTract = findExtremeAdjacentTract(currentTractId, 'northwest');
      }
      
      // Fallback for longitude division: If moving north with northwest bias finds nothing, try northeast to maintain westward bias
      // This handles cases where the next tract is northeast (not northwest) but still maintains westward progression
      if (!nextTract && direction === 'longitude' && moveDirection === 'north' && biasedDirection === 'northwest') {
        nextTract = findExtremeAdjacentTract(currentTractId, 'northeast');
      }
      // Fallback: If moving south with southwest bias finds nothing, try northwest instead of southeast
      // In some geographical layouts, pivoting northwest (biased towards north) works better than continuing southeast
      if (!nextTract && direction === 'longitude' && moveDirection === 'south' && biasedDirection === 'southwest') {
        // First try adjacent northwest tract
        nextTract = findExtremeAdjacentTract(currentTractId, 'northwest');
        
        // If no adjacent northwest, find the most northern unvisited northwest-biased tract
        if (!nextTract) {
          const currentTract = tractMap.get(currentTractId);
          if (currentTract) {
            const currentCoord = this.getSouthwestCoordinate(currentTract);
            let bestNorthwestTract: GeoJsonFeature | null = null;
            let bestScore = -Infinity; // Higher score = more northwest (prioritize north, then west)
            
            // Look for unvisited tracts that are northwest of current position
            for (const tract of tracts) {
              const tractId = this.getTractId(tract);
              if (visited.has(tractId)) continue;
              
              const coord = this.getSouthwestCoordinate(tract);
              // Check if tract is northwest of current position (more north AND more west)
              // Prioritize north first, then west (biased towards north as requested)
              if (coord.lat > currentCoord.lat && coord.lng < currentCoord.lng) {
                // Score: prioritize north (higher lat) first, then west (lower lng)
                // Higher score = more northwest, biased towards north
                const score = (coord.lat - currentCoord.lat) * 100 - (currentCoord.lng - coord.lng);
                if (score > bestScore) {
                  bestScore = score;
                  bestNorthwestTract = tract;
                }
              }
            }
            
            if (bestNorthwestTract) {
              nextTract = bestNorthwestTract;
            }
          }
        }
      }

      if (nextTract) {
        // Continue in the same direction
        const nextTractId = this.getTractId(nextTract);
        addTractWithContained(nextTractId);
        currentTractId = nextTractId;
      } else {
        // No more tracts in current direction - border detection

        if (direction === 'latitude') {
          // For latitude division: proper zig-zag pattern
          if (moveDirection === 'east') {
            // Hit east border: find southeast adjacent tract as starting point to move west (Step 5)
            const southeastTract = findExtremeAdjacentTract(currentTractId, 'southeast');
            if (southeastTract) {
              const southeastTractId = this.getTractId(southeastTract);
              addTractWithContained(southeastTractId);
              currentTractId = southeastTractId;
              moveDirection = 'west'; // Start moving west from this southeast position
            } else {
              // No southeast adjacent tract, find new northeastern starting point
              const newStartTract = findNextStartingTract();
              if (newStartTract) {
                const newStartTractId = this.getTractId(newStartTract);
                addTractWithContained(newStartTractId);
                currentTractId = newStartTractId;
                moveDirection = 'east'; // Start new row going east
              } else {
                break;
              }
            }
          } else {
            // Hit west border: find northeast adjacent tract as starting point to move east
            // This maintains the zig-zag pattern - similar to finding southeast when hitting east border
            const northeastTract = findExtremeAdjacentTract(currentTractId, 'northeast');
            if (northeastTract) {
              const northeastTractId = this.getTractId(northeastTract);
              addTractWithContained(northeastTractId);
              currentTractId = northeastTractId;
              moveDirection = 'east'; // Start moving east from this northeast position
            } else {
              // No northeast adjacent tract, find new northeastern starting point
              const newStartTract = findNextStartingTract();
              if (newStartTract) {
                const newStartTractId = this.getTractId(newStartTract);
                addTractWithContained(newStartTractId);
                currentTractId = newStartTractId;
                moveDirection = 'east'; // Start new row going east
              } else {
                break;
              }
            }
          }
        } else {
          // For longitude division: proper zig-zag pattern (rotated latitude 90° CCW)
          if (moveDirection === 'north') {
            // Check if we're at the state northern boundary
            const isAtStateBoundary = stateBoundaryTracts.has(currentTractId);
            
            if (isAtStateBoundary) {
              console.log(`🔴 State northern boundary detected at tract ${currentTractId} - zigzagging south`);
              // We're at the state northern boundary - zigzag south by selecting south-clockwise (southwest) adjacent tract
              let pivotTract = findExtremeAdjacentTract(currentTractId, 'southwest');
              if (!pivotTract) {
                // Fallback: try southeast or south to continue south
                pivotTract = findExtremeAdjacentTract(currentTractId, 'southeast') ||
                           findExtremeAdjacentTract(currentTractId, 'south');
              }
              
              if (pivotTract) {
                const pivotTractId = this.getTractId(pivotTract);
                addTractWithContained(pivotTractId);
                currentTractId = pivotTractId;
                moveDirection = 'south'; // Start moving south from this pivot position
              } else {
                // No south-adjacent tract found, try to find new westernmost starting point
                const newStartTract = findNextStartingTract();
                if (newStartTract) {
                  const newStartTractId = this.getTractId(newStartTract);
                  addTractWithContained(newStartTractId);
                  currentTractId = newStartTractId;
                  moveDirection = 'north'; // Start new column going north
                } else {
                  break;
                }
              }
            } else {
              // Normal border detection: Hit north border (not state boundary) - find northwest adjacent tract as starting point to move south
              // Try multiple adjacent directions before jumping to non-adjacent tract
              let pivotTract = findExtremeAdjacentTract(currentTractId, 'northwest');
              if (!pivotTract) {
                // Fallback: try northeast adjacent (still maintains west bias progression)
                pivotTract = findExtremeAdjacentTract(currentTractId, 'northeast');
              }
              if (!pivotTract) {
                // Fallback: try north adjacent (any adjacent tract to continue)
                pivotTract = findExtremeAdjacentTract(currentTractId, 'north');
              }
              
              if (pivotTract) {
                const pivotTractId = this.getTractId(pivotTract);
                addTractWithContained(pivotTractId);
                currentTractId = pivotTractId;
                moveDirection = 'south'; // Start moving south from this pivot position
              } else {
                // No adjacent tract found in any northern direction - start new column
                // Only jump to non-adjacent tract if absolutely no adjacent tracts available
                const newStartTract = findNextStartingTract();
                if (newStartTract) {
                  const newStartTractId = this.getTractId(newStartTract);
                  addTractWithContained(newStartTractId);
                  currentTractId = newStartTractId;
                  moveDirection = 'north'; // Start new column going north
                } else {
                  break;
                }
              }
            }
          } else {
            // Check if we're at the state southern boundary
            const isAtStateBoundary = stateBoundaryTracts.has(currentTractId);
            
            if (isAtStateBoundary) {
              console.log(`🔴 State southern boundary detected at tract ${currentTractId} - zigzagging north`);
              // We're at the state southern boundary - zigzag north by selecting north-clockwise (northwest) adjacent tract
              let pivotTract = findExtremeAdjacentTract(currentTractId, 'northwest');
              if (!pivotTract) {
                // Fallback: try northeast or north to continue north
                pivotTract = findExtremeAdjacentTract(currentTractId, 'northeast') ||
                           findExtremeAdjacentTract(currentTractId, 'north');
              }
              
              if (pivotTract) {
                const pivotTractId = this.getTractId(pivotTract);
                addTractWithContained(pivotTractId);
                currentTractId = pivotTractId;
                moveDirection = 'north'; // Start moving north from this pivot position
              } else {
                // No north-adjacent tract found, try to find new westernmost starting point
                const newStartTract = findNextStartingTract();
                if (newStartTract) {
                  const newStartTractId = this.getTractId(newStartTract);
                  addTractWithContained(newStartTractId);
                  currentTractId = newStartTractId;
                  moveDirection = 'north'; // Start new column going north
                } else {
                  break;
                }
              }
            } else {
              // Normal border detection: Hit south border (not state boundary) - find southwest adjacent tract as starting point to move north
              // Try multiple adjacent directions before jumping to non-adjacent tract
              let pivotTract = findExtremeAdjacentTract(currentTractId, 'southwest');
              if (!pivotTract) {
                // Fallback: try southeast adjacent (still maintains west bias progression)
                pivotTract = findExtremeAdjacentTract(currentTractId, 'southeast');
              }
              if (!pivotTract) {
                // Fallback: try south adjacent (any adjacent tract to continue)
                pivotTract = findExtremeAdjacentTract(currentTractId, 'south');
              }
              
              if (pivotTract) {
                const pivotTractId = this.getTractId(pivotTract);
                addTractWithContained(pivotTractId);
                currentTractId = pivotTractId;
                moveDirection = 'north'; // Start moving north from this pivot position
              } else {
                // No adjacent tract found in any southern direction - start new column
                // Only jump to non-adjacent tract if absolutely no adjacent tracts available
                const newStartTract = findNextStartingTract();
                if (newStartTract) {
                  const newStartTractId = this.getTractId(newStartTract);
                  addTractWithContained(newStartTractId);
                  currentTractId = newStartTractId;
                  moveDirection = 'north'; // Start new column going north
                } else {
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Check completion
    const unvisitedTracts = tracts.filter(tract => !visited.has(this.getTractId(tract)));
    if (unvisitedTracts.length > 0) {
      const progressPercent = ((visited.size / tracts.length) * 100).toFixed(1);
      console.warn(`⚠️ Geo-graph traversal incomplete: ${unvisitedTracts.length} tracts remain unvisited after ${iterationCount} iterations. Progress: ${visited.size}/${tracts.length} (${progressPercent}%)`);

      // Add remaining unvisited tracts
      for (const tract of unvisitedTracts) {
        addTractWithContained(this.getTractId(tract));
      }
    }

    return sortedTracts;
  }

  /**
   * Public method to find the most extreme adjacent tract using clockwise sweep approach
   * Draws a line from the geometric midpoint, rotating clockwise from a starting direction,
   * and returns the first adjacent tract whose boundary is intersected by the line.
   * @param currentTract The current tract
   * @param adjacentTracts Array of adjacent tracts to search from
   * @param direction Direction to find extreme tract ('east', 'west', 'north', 'south', 'northeast', 'northwest', 'southeast', 'southwest')
   * @param sortDirection Optional sort direction ('latitude' or 'longitude') to determine starting sweep direction
   * @returns The first adjacent tract encountered in the clockwise sweep, or null if none found
   */
  public findExtremeAdjacentTract(
    currentTract: GeoJsonFeature,
    adjacentTracts: GeoJsonFeature[],
    direction: 'east' | 'west' | 'north' | 'south' | 'northeast' | 'northwest' | 'southeast' | 'southwest',
    sortDirection?: 'latitude' | 'longitude'
  ): GeoJsonFeature | null {
    if (!adjacentTracts || adjacentTracts.length === 0) return null;

    // Use geometric midpoint instead of northwest coordinate or centroid
    const currentMidpoint = this.getGeometricMidpoint(currentTract);

    // Map direction to angle ranges for clockwise sweep
    const directionAngles: { [key: string]: { start: number; end: number } } = {
      'northeast': { start: 0, end: 90 },
      'east': { start: 45, end: 135 },
      'southeast': { start: 90, end: 180 },
      'south': { start: 135, end: 225 },
      'southwest': { start: 180, end: 270 },
      'west': { start: 225, end: 315 },
      'northwest': { start: 270, end: 360 },
      'north': { start: 315, end: 45 } // Wraps around
    };

    // Determine starting angle for clockwise sweep based on sort direction
    let sweepStartAngle: number;
    if (sortDirection === 'longitude') {
      // For longitude sort: start at west (270°) and move clockwise
      sweepStartAngle = 270;
    } else {
      // For latitude sort (default): start at north (0°) and move clockwise
      sweepStartAngle = 0;
    }

    // Sweep the full 360 degrees clockwise from the starting angle
    // The starting angle depends on sort direction (north for latitude, west for longitude)
    const startAngle = sweepStartAngle;
    const endAngle = startAngle + 360; // Full 360 degree sweep

    // Sweep increment (in degrees) - smaller increments = more precise but slower
    const sweepIncrement = 0.1; // 0.1 degree increments

    // Get the angle range for the requested direction (for filtering)
    const range = directionAngles[direction];
    if (!range) {
      console.warn(`⚠️ Unknown direction: ${direction}`);
      return null;
    }

    // Sweep clockwise from start angle for full 360 degrees
    for (let angle = startAngle; angle < endAngle; angle += sweepIncrement) {
      // Normalize angle to 0-360 range
      const normalizedAngle = angle % 360;
      
      // Convert angle to radians for calculations
      // Our angle convention: 0° = north, 90° = east, 180° = south, 270° = west (geographic)
      const angleRad = normalizedAngle * Math.PI / 180;
      
      // Calculate a point far away in the direction of the ray (for intersection testing)
      // Use a distance that's guaranteed to extend beyond any tract boundary
      // For geographic angles: 0° = north (lat increases), 90° = east (lng increases)
      // So: lat = lat0 + distance * cos(angle), lng = lng0 + distance * sin(angle)
      const rayDistance = 10.0; // 10 degrees (~1100km) should be plenty
      const rayEndPoint = {
        lat: currentMidpoint.lat + rayDistance * Math.cos(angleRad), // 0° = north, lat increases
        lng: currentMidpoint.lng + rayDistance * Math.sin(angleRad)  // 90° = east, lng increases
      };

      // Check if the current sweep angle falls within the requested direction range
      let inDirectionRange = false;
      if (range.start > range.end) {
        // Wraparound case (e.g., north: 315° to 45°)
        inDirectionRange = normalizedAngle >= range.start || normalizedAngle <= range.end;
      } else {
        inDirectionRange = normalizedAngle >= range.start && normalizedAngle <= range.end;
      }

      // Only check tracts if we're in the correct direction range
      if (inDirectionRange) {
        // Check each adjacent tract to see if the ray intersects its boundary
        // We don't filter by midpoint direction - the ray sweep and intersection is sufficient
        for (const tract of adjacentTracts) {
          const tractId = this.getTractId(tract);
          
          // Debug: Check for specific tract (04001942700, not 04019942700)
          if ((tractId === '04001942700' || tractId === '04019942700') && direction === 'northeast') {
            console.log(`🔍 Checking target tract ${tractId} at angle ${normalizedAngle.toFixed(2)}°`);
            console.log(`   Current midpoint: (${currentMidpoint.lat.toFixed(6)}, ${currentMidpoint.lng.toFixed(6)})`);
            console.log(`   Ray endpoint: (${rayEndPoint.lat.toFixed(6)}, ${rayEndPoint.lng.toFixed(6)})`);
          }

          // Check if ray from currentMidpoint to rayEndPoint intersects the tract's boundary
          // The angular range filter (inDirectionRange) ensures we're checking the correct direction
          const intersection = this.findLinePolygonIntersection(
            currentMidpoint,
            rayEndPoint,
            tract
          );

          if (intersection) {
            // Found the first intersection! This is the tract we want
            return tract;
          }
        }
      }
    }

    // No intersection found in the full 360 degree sweep
    return null;
  }

  /**
   * Get the tract ID from a GeoJsonFeature
   */
  private getTractId(tract: GeoJsonFeature): string {
    // Try GEOID first
    if (tract.properties?.['GEOID']) {
      return tract.properties['GEOID'];
    }

    // Fallback to other common identifiers
    if (tract.properties?.['TRACT']) {
      return tract.properties['TRACT'];
    }

    // Last resort: use object ID or generate one
    if (tract.properties?.['OBJECTID']) {
      return tract.properties['OBJECTID'].toString();
    }

    // Generate a unique ID based on coordinates if all else fails
    if (tract.geometry && tract.geometry.coordinates) {
      const coords = tract.geometry.coordinates;
      if (Array.isArray(coords) && coords.length > 0) {
        // Use first coordinate as identifier
        const firstCoord = coords[0];
        if (Array.isArray(firstCoord) && firstCoord.length >= 2) {
          return `${firstCoord[1]}_${firstCoord[0]}`;
        }
      }
    }

    // Ultimate fallback
    return `tract_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the geometric midpoint (center of bounding box)
   * This gives the true center based on boundaries, not vertex distribution
   */
  private getGeometricMidpoint(tract: GeoJsonFeature): { lat: number; lng: number } {
    if (!tract.geometry || (tract.geometry.type !== 'Polygon' && tract.geometry.type !== 'MultiPolygon')) {
      return { lat: 0, lng: 0 };
    }
    let maxLat = -Infinity, minLat = Infinity, maxLng = -Infinity, minLng = Infinity;
    
    const processCoordinates = (coordinates: number[][]) => {
      for (const coord of coordinates) {
        if (coord.length >= 2) {
          const lng = coord[0];
          const lat = coord[1];
          if (lat > maxLat) maxLat = lat;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lng < minLng) minLng = lng;
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

    return { lat: (maxLat + minLat) / 2, lng: (maxLng + minLng) / 2 };
  }

  /**
   * Get the northwest coordinate of a tract (highest latitude, lowest longitude)
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
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
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
          if (lat < minLat) minLat = lat;
          if (lng < minLng) minLng = lng;
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
   * Find all tracts that are on the state boundary by merging all tracts and comparing boundaries
   * A tract is on the state boundary if any of its boundary segments match the merged state polygon boundary
   * @param tracts Array of all census tracts in the state
   * @returns Set of tract IDs that are on the state boundary
   */
  private findStateBoundaryTracts(tracts: GeoJsonFeature[]): Set<string> {
    const boundaryTracts = new Set<string>();
    
    if (!tracts || tracts.length === 0) {
      return boundaryTracts;
    }

    try {
      // Convert all tracts to turf features
      const turfFeatures = tracts.map(tract => {
        if (!tract.geometry) return null;
        return turf.feature(tract.geometry);
      }).filter((f): f is any => f !== null);

      if (turfFeatures.length === 0) {
        return boundaryTracts;
      }

      // Merge all tract polygons into a single state polygon
      // Start with the first feature and union the rest
      let mergedPolygon = turfFeatures[0];
      for (let i = 1; i < turfFeatures.length; i++) {
        try {
          mergedPolygon = turf.union(mergedPolygon, turfFeatures[i]);
        } catch (error) {
          // If union fails for a feature, try to continue with next
          continue;
        }
      }

      // Extract the boundary of the merged state polygon
      // The boundary is the outer ring of the merged polygon
      const stateBoundary = this.extractPolygonBoundary(mergedPolygon);
      if (!stateBoundary || stateBoundary.length < 3) {
        return boundaryTracts;
      }

      // For each tract, check if any of its boundary segments match the state boundary
      // A tract is on the boundary if any edge of the tract's polygon is on the state boundary
      for (const tract of tracts) {
        if (!tract.geometry) continue;

        const tractId = this.getTractId(tract);
        const tractBoundary = this.extractPolygonBoundary(tract);
        
        if (!tractBoundary || tractBoundary.length < 3) continue;

        // Check if any segment of the tract boundary matches a segment of the state boundary
        // We use a tolerance-based comparison since floating point coordinates might not match exactly
        if (this.hasBoundaryOverlap(tractBoundary, stateBoundary)) {
          boundaryTracts.add(tractId);
        }
      }
    } catch (error) {
      console.warn('⚠️ Error finding state boundary tracts:', error);
    }

    console.log(`🗺️ Found ${boundaryTracts.size} state boundary tracts out of ${tracts.length} total tracts`);
    return boundaryTracts;
  }

  /**
   * Extract the outer boundary ring from a polygon or multipolygon feature
   */
  private extractPolygonBoundary(feature: any): number[][] | null {
    if (!feature || !feature.geometry) return null;

    const geom = feature.geometry;
    
    if (geom.type === 'Polygon') {
      // First ring is the outer boundary
      return geom.coordinates[0] || null;
    } else if (geom.type === 'MultiPolygon') {
      // First ring of first polygon is the outer boundary
      if (geom.coordinates && geom.coordinates[0] && geom.coordinates[0][0]) {
        return geom.coordinates[0][0];
      }
    }

    return null;
  }

  /**
   * Check if a tract boundary overlaps with the state boundary
   * Uses distance-based comparison since exact coordinate matching may fail due to floating point precision
   */
  private hasBoundaryOverlap(tractBoundary: number[][], stateBoundary: number[][]): boolean {
    const tolerance = 0.00001; // ~1 meter tolerance for coordinate comparison
    
    // For each segment in the tract boundary, check if it matches any segment in the state boundary
    for (let i = 0; i < tractBoundary.length - 1; i++) {
      const tractP1 = tractBoundary[i];
      const tractP2 = tractBoundary[i + 1];
      
      // Check this tract segment against all state boundary segments
      for (let j = 0; j < stateBoundary.length - 1; j++) {
        const stateP1 = stateBoundary[j];
        const stateP2 = stateBoundary[j + 1];
        
        // Check if segments match (forward or reverse direction)
        if (this.segmentsMatch(tractP1, tractP2, stateP1, stateP2, tolerance)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if two line segments match (within tolerance), accounting for both forward and reverse directions
   */
  private segmentsMatch(p1: number[], p2: number[], q1: number[], q2: number[], tolerance: number): boolean {
    // Check forward direction
    const forwardMatch = 
      Math.abs(p1[0] - q1[0]) < tolerance && Math.abs(p1[1] - q1[1]) < tolerance &&
      Math.abs(p2[0] - q2[0]) < tolerance && Math.abs(p2[1] - q2[1]) < tolerance;
    
    // Check reverse direction
    const reverseMatch = 
      Math.abs(p1[0] - q2[0]) < tolerance && Math.abs(p1[1] - q2[1]) < tolerance &&
      Math.abs(p2[0] - q1[0]) < tolerance && Math.abs(p2[1] - q1[1]) < tolerance;
    
    return forwardMatch || reverseMatch;
  }

  /**
   * Find contained tracts within a set of tracts
   * Uses adjacency graph to optimize: tracts with only 1 adjacent tract are likely contained
   */
  public findContainedTracts(tracts: GeoJsonFeature[], allowLargeDatasets: boolean = false, adjacencyGraph?: Map<string, string[]>): { container: string; contained: string }[] {
    // For performance, skip containment checks for large datasets unless explicitly allowed
    if (tracts.length > 100 && !allowLargeDatasets) {
      console.log(`📦 Skipping containment check for large dataset (${tracts.length} tracts) - too slow`);
      return [];
    }

    if (tracts.length > 200 && allowLargeDatasets) {
      console.log(`🔍 Checking for enclosed tracts in ${tracts.length} tracts...`);
    }

    const containedPairs: { container: string; contained: string }[] = [];
    const tractMap = new Map<string, GeoJsonFeature>();
    
    // Build tract map for quick lookup
    for (const tract of tracts) {
      tractMap.set(this.getTractId(tract), tract);
    }

    // Optimization: Use adjacency graph to identify tracts with only 1 adjacent tract
    // These tracts (often on borders or "dependent" on a single neighbor) should be added
    // immediately after their adjacent tract, regardless of containment
    const singleAdjacentTractIds = new Set<string>();
    const tractToSingleAdjacent = new Map<string, string>(); // Maps tract to its single adjacent tract
    if (adjacencyGraph) {
      for (const tract of tracts) {
        const tractId = this.getTractId(tract);
        const adjacentIds = adjacencyGraph.get(tractId) || [];
        
        // If tract has only 1 adjacent tract, it's "dependent" on that tract
        // This includes boundary tracts and truly contained tracts
        if (adjacentIds.length === 1) {
          singleAdjacentTractIds.add(tractId);
          tractToSingleAdjacent.set(tractId, adjacentIds[0]);
        }
      }
    }

    let optimizedChecks = 0;
    let totalChecks = 0;

    // First pass: Tracts with only 1 adjacent tract are "dependent" and should be added immediately after
    // This handles both truly contained tracts and boundary tracts (like 950102 on northern border)
    if (adjacencyGraph && singleAdjacentTractIds.size > 0) {
      for (const dependentId of singleAdjacentTractIds) {
        const dependentTract = tractMap.get(dependentId);
        if (!dependentTract || !dependentTract.geometry) continue;

        const containerId = tractToSingleAdjacent.get(dependentId);
        if (!containerId) continue;
        
        const containerTract = tractMap.get(containerId);
        if (!containerTract || !containerTract.geometry) continue;
        
        totalChecks++;
        optimizedChecks++;
        
        // Check if truly contained (geometric containment)
        // Even if not contained, we'll still add it as "dependent" if it only has 1 adjacent tract
        const isGeometricallyContained = this.isTractContainedIn(dependentTract, containerTract);
        
        // Always add dependent tracts (those with only 1 adjacent), regardless of geometric containment
        // This handles boundary tracts that share borders with state boundaries
        containedPairs.push({
          container: containerId,
          contained: dependentId
        });
        
      }
    }

    // Second pass: Check remaining tract pairs (full O(n²) check if needed)
    // Only check pairs that weren't already verified in the optimized pass
    const alreadyChecked = new Set<string>();
    for (const pair of containedPairs) {
      alreadyChecked.add(`${pair.contained}_${pair.container}`);
    }

    for (let i = 0; i < tracts.length; i++) {
      const containedTract = tracts[i];
      const containedId = this.getTractId(containedTract);

      // Skip if already found to be dependent in optimized pass
      if (singleAdjacentTractIds.has(containedId)) continue;
      
      // Skip if no geometry
      if (!containedTract.geometry) continue;

      // Only check against tracts that might contain it (use adjacency if available)
      const candidatesToCheck = adjacencyGraph 
        ? (adjacencyGraph.get(containedId) || [])
        : tracts.map(t => this.getTractId(t));

      for (const candidateId of candidatesToCheck) {
        const containerTract = tractMap.get(candidateId);
        if (!containerTract || !containerTract.geometry) continue;
        if (containedId === candidateId) continue; // Don't check against itself

        // Skip if already checked
        const checkKey = `${containedId}_${candidateId}`;
        if (alreadyChecked.has(checkKey)) continue;

        totalChecks++;
        
        if (this.isTractContainedIn(containedTract, containerTract)) {
          containedPairs.push({
            container: candidateId,
            contained: containedId
          });

          alreadyChecked.add(checkKey);
        }
      }
    }


    return containedPairs;
  }

  /**
   * Check if tract A is completely contained within tract B
   */
  private isTractContainedIn(tractA: GeoJsonFeature, tractB: GeoJsonFeature): boolean {
    if (!tractA.geometry || !tractB.geometry) return false;

    const tractAId = this.getTractId(tractA);
    const tractBId = this.getTractId(tractB);

    // Get only the outer ring of tract A (first ring) for containment check
    // Holes (inner rings) don't affect containment - we just need the outer boundary
    let outerRingA: number[][] = [];
    if (tractA.geometry?.type === 'Polygon' && tractA.geometry.coordinates?.[0]) {
      outerRingA = tractA.geometry.coordinates[0]; // First ring is outer boundary
    } else if (tractA.geometry?.type === 'MultiPolygon' && tractA.geometry.coordinates?.[0]?.[0]) {
      outerRingA = tractA.geometry.coordinates[0][0]; // First ring of first polygon
    }
    
    if (outerRingA.length < 3) {
      return false; // Invalid polygon
    }

    // Get only the outer ring of tract B (first ring) for containment check
    // Holes (inner rings) don't affect containment - we just need the outer boundary
    let outerRingB: number[][] = [];
    if (tractB.geometry?.type === 'Polygon' && tractB.geometry.coordinates?.[0]) {
      outerRingB = tractB.geometry.coordinates[0]; // First ring is outer boundary
    } else if (tractB.geometry?.type === 'MultiPolygon' && tractB.geometry.coordinates?.[0]?.[0]) {
      outerRingB = tractB.geometry.coordinates[0][0]; // First ring of first polygon
    }
    
    if (outerRingB.length < 3) {
      return false; // Invalid polygon
    }


    // Use point-in-polygon algorithm
    // Check if tract A is contained within tract B
    // For containment, we check a sample of points from tract A's outer ring to see if they're inside tract B's outer ring
    // Use a reasonable sample size (all points for small polygons, sample for large ones)
    const sampleSize = Math.min(outerRingA.length, 100); // Sample up to 100 points
    const step = Math.max(1, Math.floor(outerRingA.length / sampleSize));
    
    let pointsInside = 0;
    let pointsChecked = 0;
    
    for (let i = 0; i < outerRingA.length; i += step) {
      const point = outerRingA[i];
      // Check if point is inside the outer ring of tract B
      // Note: point and outerRingB are [lng, lat] format (GeoJSON)
      if (this.isPointInPolygon(point, outerRingB)) {
        pointsInside++;
      }
      pointsChecked++;
    }
    
    // Require at least 90% of sampled points to be inside for containment
    // This handles edge cases where some points might be exactly on the boundary
    const containmentThreshold = 0.9;
    const isContained = pointsInside / pointsChecked >= containmentThreshold;
    
    return isContained;
  }

  /**
   * Get all coordinates from a GeoJsonFeature
   */
  private getAllCoordinates(tract: GeoJsonFeature): number[][] {
    if (!tract.geometry) return [];

    const coordinates: number[][] = [];

    if (tract.geometry.type === 'Polygon') {
      // For Polygon, coordinates is an array of rings (first is outer, rest are holes)
      for (const ring of tract.geometry.coordinates) {
        coordinates.push(...ring);
      }
    } else if (tract.geometry.type === 'MultiPolygon') {
      // For MultiPolygon, coordinates is an array of polygons
      for (const polygon of tract.geometry.coordinates) {
        for (const ring of polygon) {
          coordinates.push(...ring);
        }
      }
    }

    return coordinates;
  }

  /**
   * Check if a point is inside a polygon using ray casting algorithm
   */
  private isPointInPolygon(point: number[], polygon: number[][]): boolean {
    const x = point[0], y = point[1];
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Find the intersection point where a ray from start point toward end point
   * first intersects with a polygon's boundary
   */
  private findLinePolygonIntersection(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    polygon: GeoJsonFeature
  ): { lat: number; lng: number } | null {
    if (!polygon.geometry) {
      return null;
    }

    // Get the outer ring of the polygon (first ring for Polygon, first ring of first polygon for MultiPolygon)
    let outerRing: number[][] = [];
    
    if (polygon.geometry.type === 'Polygon') {
      // First ring is the outer boundary
      if (polygon.geometry.coordinates && polygon.geometry.coordinates[0]) {
        outerRing = polygon.geometry.coordinates[0];
      }
    } else if (polygon.geometry.type === 'MultiPolygon') {
      // First ring of first polygon is the outer boundary
      if (polygon.geometry.coordinates && polygon.geometry.coordinates[0] && polygon.geometry.coordinates[0][0]) {
        outerRing = polygon.geometry.coordinates[0][0];
      }
    }

    if (outerRing.length < 3) {
      return null;
    }

    // Convert ray to parametric form: P(t) = start + t * (end - start)
    const rayDx = end.lng - start.lng;
    const rayDy = end.lat - start.lat;
    
    let closestIntersection: { lat: number; lng: number; t: number } | null = null;

    // Check intersection with each edge of the polygon outer ring
    for (let i = 0; i < outerRing.length - 1; i++) {
      const p1 = outerRing[i];
      const p2 = outerRing[i + 1];
      
      // Skip if coordinates are invalid
      if (!p1 || !p2 || p1.length < 2 || p2.length < 2) continue;
      
      // Edge from p1 to p2 (coordinates are [lng, lat] in GeoJSON)
      const edgeDx = p2[0] - p1[0]; // lng difference
      const edgeDy = p2[1] - p1[1]; // lat difference

      // Solve for intersection: start + t * ray = p1 + s * edge
      // Using parametric form: ray: (start.lng + t*rayDx, start.lat + t*rayDy)
      //                        edge: (p1[0] + s*edgeDx, p1[1] + s*edgeDy)
      const denominator = rayDx * edgeDy - rayDy * edgeDx;
      
      if (Math.abs(denominator) < 1e-10) {
        // Lines are parallel, skip
        continue;
      }

      const t = ((p1[0] - start.lng) * edgeDy - (p1[1] - start.lat) * edgeDx) / denominator;
      const s = ((p1[0] - start.lng) * rayDy - (p1[1] - start.lat) * rayDx) / denominator;

      // Check if intersection is on the ray (t >= 0) and on the edge segment (0 <= s <= 1)
      if (t >= 0 && t <= 10 && s >= 0 && s <= 1) { // Limit t to reasonable range (within 10x distance)
        const intersection = {
          lat: start.lat + t * rayDy,
          lng: start.lng + t * rayDx,
          t: t
        };

        // Keep the closest intersection (smallest t, meaning earliest along the ray)
        if (!closestIntersection || intersection.t < closestIntersection.t) {
          closestIntersection = intersection;
        }
      }
    }

    if (closestIntersection) {
      return { lat: closestIntersection.lat, lng: closestIntersection.lng };
    }

    return null;
  }
}
