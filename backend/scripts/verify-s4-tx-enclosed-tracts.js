#!/usr/bin/env node
/**
 * Verify S4 data for Texas (48) includes tracts 48409010500, 48409010700, 48409010800
 * and that 10500/10800 list 10700 as neighbor (enclosed-by relationship).
 * Run from repo root: node backend/scripts/verify-s4-tx-enclosed-tracts.js
 * Requires backend/data/s4-data/tract_2020.csv and nlist_2020.csv (full or TX subset).
 */
const path = require('path');
const s4DataLoader = require(path.join(__dirname, '../services/s4-data-loader'));

const TX_ENCLOSED_TRACT_IDS = ['48409010500', '48409010700', '48409010800'];

async function main() {
  try {
    await s4DataLoader.loadS4AdjacencyData('TX');
    const graph = s4DataLoader.getS4AdjacencyData('tx');
    if (!graph) {
      console.error('S4 adjacency data not available for TX');
      process.exit(1);
    }
    console.log('Texas (TX) S4 enclosed tracts verification:');
    for (const tractId of TX_ENCLOSED_TRACT_IDS) {
      const neighbors = graph.get(tractId) || [];
      const has10700 = neighbors.includes('48409010700');
      console.log(`  ${tractId}: ${neighbors.length} neighbor(s) [${neighbors.join(', ')}], includes 10700: ${has10700}`);
    }
    const n10500 = (graph.get('48409010500') || []);
    const n10800 = (graph.get('48409010800') || []);
    const ok = n10500.length >= 1 && n10800.length >= 1 && n10500.includes('48409010700') && n10800.includes('48409010700');
    if (ok) {
      console.log('OK: 48409010500 and 48409010800 both have 48409010700 as neighbor (enclosed-by).');
    } else {
      console.log('WARN: Expected 10500 and 10800 to list 10700 as neighbor. Check S4 nlist for state 48.');
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
