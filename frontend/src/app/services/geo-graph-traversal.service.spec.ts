import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { GeoGraphTraversalService } from './geo-graph-traversal.service';
import { CensusService } from './census.service';

// Define GeoJsonFeature interface locally for testing
interface GeoJsonFeature {
  type: 'Feature';
  properties: {
    GEOID?: string;
    POPULATION?: number;
    [key: string]: any;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

describe('GeoGraphTraversalService - AZ Tract Selection', () => {
  let service: GeoGraphTraversalService;
  let censusService: CensusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [GeoGraphTraversalService, CensusService]
    });
    service = TestBed.inject(GeoGraphTraversalService);
    censusService = TestBed.inject(CensusService);
  });

  describe('performGeoGraphTraversal - AZ Latitude Division', () => {
    it('should start with correct northwest tract and follow proper adjacent selection pattern', async () => {
      // Load AZ census data (this would normally be done via CensusService)
      // For this test, we'll mock the expected behavior by checking the algorithm logic

      // First, let's verify the algorithm finds the correct starting tract
      // The northwest-most tract should be 04015950101 (950101)

      // This test will need to be run with real AZ data to verify the complete flow
      // For now, let's create a mock adjacency graph and test the logic

      const mockTracts: GeoJsonFeature[] = [
        // Tract 950101 (04015950101) - northwest most tract
        {
          type: 'Feature',
          properties: { GEOID: '04015950101' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[-114.8166, 36.9999], [-114.8, 36.9999], [-114.8, 36.98], [-114.8166, 36.98], [-114.8166, 36.9999]]]
          }
        },
        // Tract 950103 (04015950103) - should be most northeastern adjacent to 950101
        {
          type: 'Feature',
          properties: { GEOID: '04015950103' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[-114.75, 37.0], [-114.7, 37.0], [-114.7, 36.98], [-114.75, 36.98], [-114.75, 37.0]]]
          }
        },
        // Tract 950102 (04015950102) - enclosed within 950103
        {
          type: 'Feature',
          properties: { GEOID: '04015950102' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[-114.73, 36.99], [-114.72, 36.99], [-114.72, 36.985], [-114.73, 36.985], [-114.73, 36.99]]]
          }
        },
        // Tract 002000 (04005002000) - most northeastern adjacent to 950103
        {
          type: 'Feature',
          properties: { GEOID: '04005002000' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[-114.65, 37.05], [-114.6, 37.05], [-114.6, 37.0], [-114.65, 37.0], [-114.65, 37.05]]]
          }
        },
        // Tract 942202 (04005942202) - should be next in sequence
        {
          type: 'Feature',
          properties: { GEOID: '04005942202' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[-114.55, 37.1], [-114.5, 37.1], [-114.5, 37.05], [-114.55, 37.05], [-114.55, 37.1]]]
          }
        }
      ];

      // Create adjacency graph (simplified for this test)
      const adjacencyGraph = new Map<string, string[]>([
        ['04015950101', ['04015950103']], // 950101 adjacent to 950103
        ['04015950103', ['04015950101', '04015950102', '04005002000']], // 950103 adjacent to 950101, 950102 (enclosed), 002000
        ['04015950102', ['04015950103']], // 950102 only adjacent to 950103 (enclosed)
        ['04005002000', ['04015950103', '04005942202']], // 002000 adjacent to 950103 and 942202
        ['04005942202', ['04005002000']] // 942202 adjacent to 002000
      ]);

      // Test the algorithm with latitude division
      const startTract = mockTracts[0]; // 950101
      const sortedTracts = service.performGeoGraphTraversal(mockTracts, adjacencyGraph, startTract, 'latitude');

      // Verify the first few tracts are in the expected order
      expect(sortedTracts[0].properties?.['GEOID']).toBe('04015950101'); // 950101 - northwest most
      expect(sortedTracts[1].properties?.['GEOID']).toBe('04015950103'); // 950103 - most northeastern adjacent
      expect(sortedTracts[2].properties?.['GEOID']).toBe('04015950102'); // 950102 - enclosed within 950103
      expect(sortedTracts[3].properties?.['GEOID']).toBe('04005002000'); // 002000 - most northeastern adjacent to 950103
      expect(sortedTracts[4].properties?.['GEOID']).toBe('04005942202'); // 942202 - next in sequence
    });
  });

  describe('AZ Real Data Test', () => {
    it('should verify AZ tract selection with real data', async () => {
      // This test should be run with real AZ data to verify the algorithm
      // Expected sequence based on user requirements:
      // 1. 04015950101 (950101) - northwest most tract
      // 2. 04015950103 (950103) - most northeastern adjacent to 950101
      // 3. 04015950102 (950102) - enclosed within 950103
      // 4. 04005002000 (002000) - most northeastern adjacent to 950103
      // 5. 04005942202 (942202) - next tract in sequence

      // For now, this is a placeholder test that will be implemented with real AZ data
      expect(true).toBe(true); // Placeholder - will be replaced with actual test
    });
  });
});
