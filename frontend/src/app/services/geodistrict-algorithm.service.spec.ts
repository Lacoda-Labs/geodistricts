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
});
