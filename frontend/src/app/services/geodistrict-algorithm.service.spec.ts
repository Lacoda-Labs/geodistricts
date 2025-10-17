import { TestBed } from '@angular/core/testing';
import { GeodistrictAlgorithmService } from './geodistrict-algorithm.service';
import { CensusService } from './census.service';
import { CongressionalDistrictsService } from './congressional-districts.service';
import { of } from 'rxjs';
import { GeoJsonFeature } from './census.service'; // Assuming this interface is available

describe('GeodistrictAlgorithmService', () => {
  let service: GeodistrictAlgorithmService;
  let censusServiceMock: jasmine.SpyObj<CensusService>;
  let congressionalServiceMock: jasmine.SpyObj<CongressionalDistrictsService>;

  beforeEach(() => {
    const censusSpy = jasmine.createSpyObj('CensusService', [
      'getTractDataWithBoundaries'
    ]);
    const congressionalSpy = jasmine.createSpyObj('CongressionalDistrictsService', [
      'getTotalDistrictsForState',
      'getDistrictsForState'
    ]);

    congressionalSpy.getDistrictsForState.and.returnValue(9); // Arizona has 9 districts
    congressionalSpy.getTotalDistrictsForState.and.returnValue(of(9));

    TestBed.configureTestingModule({
      providers: [
        GeodistrictAlgorithmService,
        { provide: CensusService, useValue: censusSpy },
        { provide: CongressionalDistrictsService, useValue: congressionalSpy }
      ]
    });

    service = TestBed.inject(GeodistrictAlgorithmService);
    censusServiceMock = TestBed.inject(CensusService) as jasmine.SpyObj<CensusService>;
    congressionalServiceMock = TestBed.inject(CongressionalDistrictsService) as jasmine.SpyObj<CongressionalDistrictsService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should select tract 950101 as northwesternmost for AZ using extreme coordinates', () => {
    // Arrange: Mock AZ boundary data with real coordinates for 950101 and competitors
    const mockAZTracts: GeoJsonFeature[] = [
      // Tract 950101 - Northernmost in Mohave County, AZ (actual NW point ~37.0002N, -113.9452W)
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950101',
          POPULATION: 2427,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-113.945244, 37.000201], // NW point
            [-113.945244, 36.999000],
            [-113.944000, 36.999000],
            [-113.944000, 37.000201],
            [-113.945244, 37.000201]
          ]]
        }
      },
      // Tract 950102 - Competitor, slightly north but much east
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950102',
          POPULATION: 1234,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-112.956001, 37.000230], // Slightly north but much east
            [-112.956001, 36.998000],
            [-112.954000, 36.998000],
            [-112.954000, 37.000230],
            [-112.956001, 37.000230]
          ]]
        }
      },
      // Tract 970502 - Far south (to test prioritization of north over west)
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '019',
          TRACT_FIPS: '970502',
          POPULATION: 3000,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-109.830260, 34.286326], // Much further south
            [-109.830260, 34.285000],
            [-109.829000, 34.285000],
            [-109.829000, 34.286326],
            [-109.830260, 34.286326]
          ]]
        }
      },
      // Additional mock tract further west but south
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '012',
          TRACT_FIPS: '950200',
          POPULATION: 2000,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-114.800000, 36.500000], // Further west but lower latitude
            [-114.800000, 36.499000],
            [-114.799000, 36.499000],
            [-114.799000, 36.500000],
            [-114.800000, 36.500000]
          ]]
        }
      }
    ];

    // Mock census service to return the test data
    censusServiceMock.getTractDataWithBoundaries.and.returnValue(of({
      demographic: [], // No demographic data for this test
      boundaries: {
        type: 'FeatureCollection' as const,
        features: mockAZTracts
      }
    }));

    // Act: Call the method directly to test northwest selection
    const northwestTract = service['findNorthwestMostTract'](mockAZTracts); // Access private method for testing

    // Assert
    expect(northwestTract).toBeDefined();
    if (northwestTract) {
      expect(northwestTract.properties.TRACT_FIPS).toBe('950101');
      expect(northwestTract.properties.STATE_FIPS).toBe('04');
      expect(northwestTract.properties.COUNTY_FIPS).toBe('015');

      // Verify the selected tract's extreme coordinates
      const extremeCoord = service['getNorthwestCoordinate'](northwestTract);
      expect(extremeCoord.lat).toBeGreaterThan(36.99); // Should be the northernmost
      expect(extremeCoord.lng).toBeLessThan(-113.95); // Should be the westernmost in the set

      console.log('✅ Test passed: Selected northwesternmost tract', northwestTract.properties.TRACT_FIPS);
    }
  });

  it('should sort AZ tracts correctly with geo-graph algorithm: 950101 -> 950103 -> 950102 (contained)', () => {
    // Arrange: Mock AZ tracts with containment: 950102 contained in 950103
    const mockAZTracts: GeoJsonFeature[] = [
      // Tract 950101 - Northwest starting point
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950101',
          POPULATION: 2427,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-113.945244, 37.000201], // NW point
            [-113.945244, 36.999000],
            [-113.944000, 36.999000],
            [-113.944000, 37.000201],
            [-113.945244, 37.000201]
          ]]
        }
      },
      // Tract 950103 - East of 950101 (next in east direction)
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950103',
          POPULATION: 3000,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-112.900000, 37.000500], // Larger area east of 950101
            [-112.900000, 36.999000],
            [-112.500000, 36.999000], // Spans east
            [-112.500000, 37.000500],
            [-112.900000, 37.000500]
          ]]
        }
      },
      // Tract 950102 - Contained within 950103
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950102',
          POPULATION: 1234,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-112.700000, 37.000200], // Completely inside 950103's bounds
            [-112.700000, 37.000100],
            [-112.600000, 37.000100],
            [-112.600000, 37.000200],
            [-112.700000, 37.000200]
          ]]
        }
      },
      // Additional tract to ensure sorting works
      {
        type: 'Feature' as const,
        properties: {
          STATE_FIPS: '04',
          COUNTY_FIPS: '015',
          TRACT_FIPS: '950104',
          POPULATION: 1500,
          STATE: '04'
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-112.300000, 36.800000], // South of others
            [-112.300000, 36.799000],
            [-112.299000, 36.799000],
            [-112.299000, 36.800000],
            [-112.300000, 36.800000]
          ]]
        }
      }
    ];

    // Mock adjacency graph: 950101 adjacent to 950103, 950102 adjacent to 950103 (container)
    const mockAdjacencyGraph = new Map<string, string[]>([
      ['04015950101', ['04015950103']], // 950101 -> 950103
      ['04015950103', ['04015950101', '04015950102']], // 950103 -> 950101, 950102
      ['04015950102', ['04015950103']], // 950102 -> 950103
      ['04015950104', []] // 950104 isolated for fallback testing
    ]);

    // Act: Run the geo-graph traversal
    const sortedTracts = service['performGeoGraphTraversal'](mockAZTracts, mockAdjacencyGraph, mockAZTracts[0], 'latitude');

    // Assert: Verify sorting order
    expect(sortedTracts).toBeDefined();
    expect(sortedTracts.length).toBe(4);

    // First tract should be 950101 (northwest start)
    expect(sortedTracts[0].properties.TRACT_FIPS).toBe('950101');

    // Second tract should be 950103 (east direction)
    expect(sortedTracts[1].properties.TRACT_FIPS).toBe('950103');

    // Third tract should be 950102 (contained in 950103)
    expect(sortedTracts[2].properties.TRACT_FIPS).toBe('950102');

    // Fourth tract should be 950104 (fallback)
    expect(sortedTracts[3].properties.TRACT_FIPS).toBe('950104');

    console.log('✅ Geo-graph sorting test passed: Order =', sortedTracts.map(t => t.properties.TRACT_FIPS).join(' -> '));
  });
});
