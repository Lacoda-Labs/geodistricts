const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

/**
 * State FIPS code mapping
 */
const STATE_FIPS_MAP = {
  'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
  'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
  'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
  'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
  'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
  'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
  'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
  'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
  'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
  'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
  'DC': '11'
};

/**
 * Get FIPS code for a state abbreviation
 */
function getStateFipsCode(state) {
  return STATE_FIPS_MAP[state.toUpperCase()] || null;
}

/**
 * S4 Data Loader Service
 * Loads and caches Brown University S4 adjacency data
 */
class S4DataLoader {
  constructor() {
    this.s4AdjacencyCache = new Map();
    this.s4TractDataCache = new Map();
    this.dataPath = path.join(__dirname, '../data/s4-data');
  }

  /**
   * Load S4 adjacency data for a state
   * @param {string} state - State abbreviation (e.g., 'AZ')
   * @returns {Promise<Map<string, string[]>>} - Adjacency graph (tractId -> [neighborIds])
   */
  async loadS4AdjacencyData(state) {
    const cacheKey = state.toLowerCase();
    
    if (this.s4AdjacencyCache.has(cacheKey)) {
      console.log(`📋 Using cached S4 adjacency data for ${state}`);
      return this.s4AdjacencyCache.get(cacheKey);
    }

    try {
      console.log(`📥 Loading S4 adjacency data for ${state}...`);
      
      // Load tract data
      const tractDataPath = path.join(this.dataPath, 'tract_2020.csv');
      const tractDataContent = fs.readFileSync(tractDataPath, 'utf8');
      const tractData = parse(tractDataContent, {
        columns: true,
        skip_empty_lines: true
      });
      
      // Filter tracts for the state
      const stateFips = getStateFipsCode(state);
      if (!stateFips) {
        throw new Error(`Invalid state code: ${state}`);
      }
      
      const stateTracts = tractData.filter(tract => tract.STATEID === stateFips);
      console.log(`📍 Found ${stateTracts.length} tracts for state ${state} (FIPS: ${stateFips})`);
      
      // Cache tract data
      this.s4TractDataCache.set(stateFips, stateTracts);
      
      // Load adjacency data
      const adjacencyDataPath = path.join(this.dataPath, 'nlist_2020.csv');
      const adjacencyDataContent = fs.readFileSync(adjacencyDataPath, 'utf8');
      const adjacencyData = parse(adjacencyDataContent, {
        columns: true,
        skip_empty_lines: true
      });
      
      // Debug: Check first few rows and column names
      if (adjacencyData.length > 0) {
        console.log(`🔍 DEBUG: First adjacency row keys: ${Object.keys(adjacencyData[0]).join(', ')}`);
        console.log(`🔍 DEBUG: First adjacency row: ${JSON.stringify(adjacencyData[0])}`);
        console.log(`🔍 DEBUG: Total adjacency rows: ${adjacencyData.length}`);
      }
      
      // Build adjacency graph
      const adjacencyGraph = new Map();
      const stateTractIds = new Set(stateTracts.map(t => t.GEOID));
      
      // Initialize adjacency lists
      for (const tract of stateTracts) {
        adjacencyGraph.set(tract.GEOID, []);
      }
      
      // Build adjacency relationships
      let matchedCount = 0;
      let totalAdjRows = 0;
      let sampleSourceIds = new Set();
      let sampleNeighborIds = new Set();
      let foundTestTracts = false;
      
      for (const adj of adjacencyData) {
        totalAdjRows++;
        // Try multiple possible column name variations (case-insensitive, with/without spaces)
        const sourceId = adj.SOURCE_TRACTID || adj['SOURCE_TRACTID'] || adj.source_tractid || adj.Source_TractID || adj.FID || adj.fid || Object.values(adj)[0];
        const neighborId = adj.NEIGHBOR_TRACTID || adj['NEIGHBOR_TRACTID'] || adj.neighbor_tractid || adj.Neighbor_TractID || adj.NID || adj.nid || Object.values(adj)[1];
        
        // Collect sample IDs for debugging
        if (totalAdjRows <= 10) {
          sampleSourceIds.add(sourceId);
          sampleNeighborIds.add(neighborId);
        }
        
        // Check for our test tracts
        if ((sourceId === '04005001700' || sourceId === '04005002302' || neighborId === '04005001700' || neighborId === '04005002302') && !foundTestTracts) {
          console.log(`🔍 DEBUG: Found test tract in adjacency data: source=${sourceId}, neighbor=${neighborId}`);
          console.log(`🔍 DEBUG: sourceId in stateTractIds: ${stateTractIds.has(sourceId)}, neighborId in stateTractIds: ${stateTractIds.has(neighborId)}`);
          foundTestTracts = true;
        }
        
        if (stateTractIds.has(sourceId) && stateTractIds.has(neighborId) && sourceId !== neighborId) {
          const neighbors = adjacencyGraph.get(sourceId) || [];
          if (!neighbors.includes(neighborId)) {
            neighbors.push(neighborId);
            adjacencyGraph.set(sourceId, neighbors);
            matchedCount++;
          }
        }
      }
      
      // Debug: Check sample IDs and state tract IDs
      console.log(`🔍 DEBUG: Sample source IDs from adjacency data: ${Array.from(sampleSourceIds).slice(0, 5).join(', ')}`);
      console.log(`🔍 DEBUG: Sample state tract IDs: ${Array.from(stateTractIds).slice(0, 5).join(', ')}`);
      console.log(`🔍 DEBUG: Test tract 04005001700 in stateTractIds: ${stateTractIds.has('04005001700')}`);
      console.log(`🔍 DEBUG: Test tract 04005002302 in stateTractIds: ${stateTractIds.has('04005002302')}`);
      
      // Debug: Check for specific tracts
      const testTract1 = '04005001700';
      const testTract2 = '04005002302';
      if (stateTractIds.has(testTract1)) {
        const neighbors1 = adjacencyGraph.get(testTract1) || [];
        console.log(`🔍 DEBUG: Tract ${testTract1} has ${neighbors1.length} neighbors: ${neighbors1.slice(0, 5).join(', ')}${neighbors1.length > 5 ? '...' : ''}`);
      }
      if (stateTractIds.has(testTract2)) {
        const neighbors2 = adjacencyGraph.get(testTract2) || [];
        console.log(`🔍 DEBUG: Tract ${testTract2} has ${neighbors2.length} neighbors: ${neighbors2.slice(0, 5).join(', ')}${neighbors2.length > 5 ? '...' : ''}`);
      }
      
      console.log(`🔍 DEBUG: Processed ${totalAdjRows} adjacency rows, matched ${matchedCount} relationships for ${stateTracts.length} tracts`);
      
      // Cache the result
      this.s4AdjacencyCache.set(cacheKey, adjacencyGraph);
      
      const totalAdjacencies = Array.from(adjacencyGraph.values()).reduce((sum, neighbors) => sum + neighbors.length, 0);
      console.log(`✅ S4 adjacency data loaded: ${totalAdjacencies} total adjacencies for ${stateTracts.length} tracts`);
      
      return adjacencyGraph;
    } catch (error) {
      console.error(`❌ Error loading S4 data for ${state}:`, error);
      throw new Error(`Failed to load S4 adjacency data for ${state}: ${error.message}`);
    }
  }

  /**
   * Get cached S4 tract data for a state
   */
  getS4TractData(state) {
    const stateFips = getStateFipsCode(state);
    return this.s4TractDataCache.get(stateFips) || null;
  }

  /**
   * Get cached S4 adjacency data for a state (synchronous)
   * @param {string} cacheKey - State abbreviation in lowercase (e.g., 'az')
   * @returns {Map<string, string[]>|null} - Adjacency graph or null if not loaded
   */
  getS4AdjacencyData(cacheKey) {
    return this.s4AdjacencyCache.get(cacheKey) || null;
  }

  /**
   * Clear cache (for testing/debugging)
   */
  clearCache() {
    this.s4AdjacencyCache.clear();
    this.s4TractDataCache.clear();
  }
}

// Export singleton instance
module.exports = new S4DataLoader();


