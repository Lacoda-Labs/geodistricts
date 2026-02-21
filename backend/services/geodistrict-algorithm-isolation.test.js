/**
 * Minimal tests for tract isolation detection (fast one-pass) and bridge scope.
 * Run with: node backend/services/geodistrict-algorithm-isolation.test.js
 * (Backend npm test is currently a no-op; this file can be run directly.)
 */
const latLongDivision = require('./latlong-division');
const { GeodistrictAlgorithmService } = require('./geodistrict-algorithm');

function runTests() {
  const latLongDivisionService = latLongDivision;
  const algorithmService = new GeodistrictAlgorithmService(latLongDivisionService);

  // --- 1. _buildDgAdjacentGroups: two tracts, no edge => two components
  const groupTracts = [
    { properties: { GEOID: '99001', STATE: 'XX' } },
    { properties: { GEOID: '99002', STATE: 'XX' } }
  ];
  const groupTractIds = new Set(['99001', '99002']);
  const adjacencyGraph = new Map();
  adjacencyGraph.set('99001', []);
  adjacencyGraph.set('99002', []);
  const components = algorithmService._buildDgAdjacentGroups(groupTracts, groupTractIds, adjacencyGraph);
  if (components.length !== 2 || components[0].size !== 1 || components[1].size !== 1) {
    console.error('FAIL: _buildDgAdjacentGroups expected 2 components of size 1 each, got', components.length, components.map(c => c.size));
    process.exitCode = 1;
    return;
  }
  console.log('PASS: _buildDgAdjacentGroups two disconnected tracts => two components');

  // --- 2. detectIsolatedTracts: one group with two disconnected tracts => one isolated
  const districtGroups = [
    {
      startDistrictNumber: 1,
      endDistrictNumber: 2,
      censusTracts: groupTracts
    }
  ];
  const allTracts = [...groupTracts];
  const result = algorithmService.detectIsolatedTracts(districtGroups, allTracts, 1, null);
  if (!result.isolatedTractsByGroup || !result.isolatedTractIds || !result.groupStats || result.isolatedComponentsByGroup === undefined) {
    console.error('FAIL: detectIsolatedTracts missing return keys', Object.keys(result));
    process.exitCode = 1;
    return;
  }
  if (result.groupStats.length !== 1 || result.groupStats[0].maxReachable !== 1) {
    console.error('FAIL: expected one group with maxReachable 1, got', result.groupStats);
    process.exitCode = 1;
    return;
  }
  if (result.isolatedTractIds.size !== 1 || result.isolatedTractsByGroup.size !== 1) {
    console.error('FAIL: expected 1 isolated tract in 1 group, got', result.isolatedTractIds.size, result.isolatedTractsByGroup.size);
    process.exitCode = 1;
    return;
  }
  const isolatedComponents = result.isolatedComponentsByGroup.get(0);
  if (!isolatedComponents || isolatedComponents.length !== 1 || isolatedComponents[0].size !== 1) {
    console.error('FAIL: expected isolatedComponentsByGroup[0] = [Set(1)], got', isolatedComponents);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: detectIsolatedTracts returns correct shape and one isolated (two disconnected tracts)');

  // --- 3. detectBridgeTracts with isolatedComponentsByGroup: single-tract component => skip bridge for that group
  const bridgeWithComponents = algorithmService.detectBridgeTracts(
    districtGroups,
    allTracts,
    result.isolatedTractsByGroup,
    result.isolatedComponentsByGroup
  );
  if (bridgeWithComponents.bridgeTractsByIsolatedGroup.size !== 0) {
    console.error('FAIL: expected no bridge when only single-tract isolated components, got', bridgeWithComponents.bridgeTractsByIsolatedGroup.size);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: detectBridgeTracts with isolatedComponentsByGroup skips group with only single-tract component');

  // --- 4. detectBridgeTracts without isolatedComponentsByGroup: same input => can return bridges (or none if no sibling); we only check it doesn't throw
  const bridgeNoComponents = algorithmService.detectBridgeTracts(districtGroups, allTracts, result.isolatedTractsByGroup);
  if (!bridgeNoComponents.bridgeTractsByIsolatedGroup || typeof bridgeNoComponents.bridgeTractsByIsolatedGroup.size !== 'number') {
    console.error('FAIL: detectBridgeTracts without 4th param should return bridgeTractsByIsolatedGroup');
    process.exitCode = 1;
    return;
  }
  console.log('PASS: detectBridgeTracts without isolatedComponentsByGroup runs (backward compatible)');

  // --- 5. _getAdjacentGroupIndicesForComponent: component tract has neighbor in another group => that group index returned
  const tractIdToGroupIndex = new Map([['99001', 0], ['99002', 1], ['99003', 0]]);
  const adjGraph = new Map([['99001', ['99002']], ['99002', ['99001']], ['99003', []]]);
  const adjacent = algorithmService._getAdjacentGroupIndicesForComponent(new Set(['99001']), 0, tractIdToGroupIndex, adjGraph);
  if (!Array.isArray(adjacent) || adjacent.length !== 1 || adjacent[0] !== 1) {
    console.error('FAIL: _getAdjacentGroupIndicesForComponent expected [1], got', adjacent);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: _getAdjacentGroupIndicesForComponent returns adjacent group index');

  // --- 6. _chooseTargetGroupForComponent: when sibling is in adjacent set, prefer it
  const twoGroups = [
    { startDistrictNumber: 1, endDistrictNumber: 1, censusTracts: [{ properties: { GEOID: '99001', sibling_DG: 'DG2-2' } }] },
    { startDistrictNumber: 2, endDistrictNumber: 2, censusTracts: [{ properties: { GEOID: '99002' } }] }
  ];
  const allTractsTwo = [
    { properties: { GEOID: '99001', sibling_DG: 'DG2-2' } },
    { properties: { GEOID: '99002' } }
  ];
  const target = algorithmService._chooseTargetGroupForComponent([1, 0], ['99001'], twoGroups, allTractsTwo);
  if (target !== 1) {
    console.error('FAIL: _chooseTargetGroupForComponent expected 1 (sibling), got', target);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: _chooseTargetGroupForComponent prefers sibling when in adjacent set');

  console.log('All isolation/bridge tests passed.');
}

runTests();
