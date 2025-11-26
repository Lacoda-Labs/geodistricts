/**
 * Representation Comparison Engine
 * Compares voting patterns to current district representation
 * Identifies mismatches between vote share and seat control
 */

/**
 * State FIPS code mapping
 */
const STATE_FIPS_MAP = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '12': 'FL', '13': 'GA',
  '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO',
  '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
  '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC',
  '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT',
  '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
  '11': 'DC'
};

/**
 * Representation Comparison Engine Class
 * 
 * Note: This is a simplified implementation. In production, you would:
 * 1. Load current district boundaries from Census TIGER or RDH
 * 2. Query Ballotpedia/Dave's Redistricting App APIs for current partisan control
 * 3. Cache this data and update it periodically
 * 
 * For now, we'll use placeholder data structures that can be populated
 * with actual data sources.
 */
class RepresentationComparisonEngine {
  constructor() {
    // Cache for district representation data
    // Format: { state: { stateHouse: [...], stateSenate: [...], usHouse: [...] } }
    this.districtDataCache = new Map();
  }

  /**
   * Get state code from FIPS or GEOID
   */
  getStateCode(geoidOrFips) {
    const fips = String(geoidOrFips).substring(0, 2);
    return STATE_FIPS_MAP[fips] || null;
  }

  /**
   * Extract state from geodistrict (array of GEOIDs)
   */
  extractStateFromGeodistrict(geoids) {
    const states = new Set();
    for (const geoid of geoids) {
      const state = this.getStateCode(geoid);
      if (state) {
        states.add(state);
      }
    }
    return Array.from(states);
  }

  /**
   * Load current district representation data for a state
   * This is a placeholder - in production, load from Ballotpedia/RDH/etc.
   */
  async loadDistrictRepresentation(state) {
    // Check cache
    if (this.districtDataCache.has(state)) {
      return this.districtDataCache.get(state);
    }

    // Placeholder data structure
    // In production, this would fetch from:
    // - Ballotpedia API
    // - Dave's Redistricting App API
    // - Redistricting Data Hub (RDH)
    // - Census TIGER district boundaries + election results
    
    const placeholderData = {
      stateHouse: [], // Array of { district: '1', party: 'D' or 'R', incumbent: 'Name' }
      stateSenate: [],
      usHouse: [],
      lastUpdated: null,
      source: 'placeholder',
    };

    // TODO: Implement actual data loading
    // For now, return placeholder
    this.districtDataCache.set(state, placeholderData);
    return placeholderData;
  }

  /**
   * Find overlapping districts for a geodistrict
   * This is a simplified version - in production, use spatial intersection
   */
  async findOverlappingDistricts(geoids, state) {
    // For now, we'll return placeholder data
    // In production, you would:
    // 1. Load district boundaries for the state
    // 2. Perform spatial intersection with the geodistrict
    // 3. Determine which districts overlap
    
    const districtData = await this.loadDistrictRepresentation(state);
    
    // Placeholder: return empty arrays
    // In production, calculate actual overlaps
    return {
      stateHouse: [],
      stateSenate: [],
      usHouse: [],
    };
  }

  /**
   * Calculate partisan control summary
   * Given an array of districts with party affiliations, return summary
   */
  calculatePartisanControl(districts) {
    let demCount = 0;
    let repCount = 0;
    let otherCount = 0;

    for (const district of districts) {
      if (district.party === 'D' || district.party === 'Democratic') {
        demCount++;
      } else if (district.party === 'R' || district.party === 'Republican') {
        repCount++;
      } else {
        otherCount++;
      }
    }

    const total = demCount + repCount + otherCount;
    return {
      demCount,
      repCount,
      otherCount,
      total,
      demPercent: total > 0 ? (demCount / total) * 100 : 0,
      repPercent: total > 0 ? (repCount / total) * 100 : 0,
      summary: total > 0 ? `${demCount}D–${repCount}R${otherCount > 0 ? `–${otherCount}O` : ''}` : 'Unknown',
    };
  }

  /**
   * Compare voting patterns to representation
   * Returns comparison object with mismatch flags
   */
  async compareToRepresentation(geodistrictData, voteShare) {
    const { geoids, state } = geodistrictData;
    
    // Extract state if not provided
    const states = state ? [state] : this.extractStateFromGeodistrict(geoids);
    if (states.length === 0) {
      return {
        error: 'Could not determine state from geodistrict',
      };
    }

    // For multi-state geodistricts, we'll use the primary state
    // In production, handle multi-state districts properly
    const primaryState = states[0];
    
    // Get vote share percentage (Democratic)
    const demVoteShare = voteShare.pct_dem_pres || 0;
    const repVoteShare = voteShare.pct_rep_pres || 0;

    // Load district representation
    const districtData = await this.loadDistrictRepresentation(primaryState);
    
    // Find overlapping districts (placeholder for now)
    const overlapping = await this.findOverlappingDistricts(geoids, primaryState);

    // Calculate representation control
    const stateHouseControl = this.calculatePartisanControl(overlapping.stateHouse);
    const stateSenateControl = this.calculatePartisanControl(overlapping.stateSenate);
    const usHouseControl = this.calculatePartisanControl(overlapping.usHouse);

    // Calculate mismatches (>8 point difference)
    const stateHouseMismatch = Math.abs(demVoteShare * 100 - stateHouseControl.demPercent) > 8;
    const stateSenateMismatch = Math.abs(demVoteShare * 100 - stateSenateControl.demPercent) > 8;
    const usHouseMismatch = Math.abs(demVoteShare * 100 - usHouseControl.demPercent) > 8;

    // Generate comparison notes
    const notes = [];
    if (stateHouseMismatch) {
      const diff = (demVoteShare * 100 - stateHouseControl.demPercent).toFixed(1);
      notes.push(`State House: Area voted ${(demVoteShare * 100).toFixed(1)}% Democratic but is represented ${stateHouseControl.summary} → ${diff > 0 ? 'underrepresented' : 'overrepresented'} Democrats`);
    }
    if (stateSenateMismatch) {
      const diff = (demVoteShare * 100 - stateSenateControl.demPercent).toFixed(1);
      notes.push(`State Senate: Area voted ${(demVoteShare * 100).toFixed(1)}% Democratic but is represented ${stateSenateControl.summary} → ${diff > 0 ? 'underrepresented' : 'overrepresented'} Democrats`);
    }
    if (usHouseMismatch) {
      const diff = (demVoteShare * 100 - usHouseControl.demPercent).toFixed(1);
      notes.push(`U.S. House: Area voted ${(demVoteShare * 100).toFixed(1)}% Democratic but is represented ${usHouseControl.summary} → ${diff > 0 ? 'underrepresented' : 'overrepresented'} Democrats`);
    }

    return {
      state: primaryState,
      currentStateHouseDelegation: stateHouseControl.summary || 'Unknown',
      currentStateSenateDelegation: stateSenateControl.summary || 'Unknown',
      currentUsHouseDistrictsOverlapping: overlapping.usHouse.map(d => `${primaryState}-${d.district} (${d.party})`),
      mismatchFlag: stateHouseMismatch || stateSenateMismatch || usHouseMismatch,
      note: notes.join('; ') || 'Vote share aligns with representation',
      details: {
        voteShare: {
          dem: demVoteShare * 100,
          rep: repVoteShare * 100,
        },
        representation: {
          stateHouse: stateHouseControl,
          stateSenate: stateSenateControl,
          usHouse: usHouseControl,
        },
        mismatches: {
          stateHouse: stateHouseMismatch,
          stateSenate: stateSenateMismatch,
          usHouse: usHouseMismatch,
        },
      },
    };
  }
}

// Export singleton instance
module.exports = new RepresentationComparisonEngine();

