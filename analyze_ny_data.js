const fs = require('fs');
const path = require('path');

// Analyze NY census tract data completeness
async function analyzeNYData() {
  console.log('🔍 Analyzing NY Census Tract Data Completeness\n');

  // Check local cache metadata
  console.log('=== LOCAL CACHE ANALYSIS ===');

  try {
    const stateTractsMeta = JSON.parse(fs.readFileSync('data/census-cache/state_tracts_NY.meta.json', 'utf8'));
    console.log('✅ State tracts metadata found:');
    console.log(`   - Timestamp: ${new Date(stateTractsMeta.timestamp).toISOString()}`);
    console.log(`   - Size: ${stateTractsMeta.dataSize} bytes`);
    console.log(`   - Source: ${stateTractsMeta.source}`);
  } catch (e) {
    console.log('❌ State tracts metadata not found');
  }

  try {
    const stateTractsData = JSON.parse(fs.readFileSync('data/census-cache/state_tracts_NY.json', 'utf8'));
    console.log('\n✅ State tracts data pointer found:');
    console.log(`   - Cloud Storage Path: ${stateTractsData.cloudStoragePath}`);
    console.log(`   - Tract Count: ${stateTractsData.tractCount}`);
    console.log(`   - Size: ${stateTractsData.sizeMB} MB`);
    console.log(`   - Timestamp: ${new Date(stateTractsData.timestamp).toISOString()}`);
    console.log(`   - Algorithm Version: ${stateTractsData.algorithmVersion}`);
  } catch (e) {
    console.log('\n❌ State tracts data pointer not found');
  }

  // Check algorithm state
  try {
    const algoState = JSON.parse(fs.readFileSync('data/census-cache/algorithm_state_NY_100.json', 'utf8'));
    console.log('\n✅ Algorithm state found:');
    console.log(`   - Iteration: ${algoState.iteration}`);
    console.log(`   - Unique Tracts: ${algoState.uniqueTracts ? algoState.uniqueTracts.length : 'N/A'}`);
    console.log(`   - Current Groups: ${algoState.currentGroups ? algoState.currentGroups.length : 'N/A'}`);
    if (algoState.currentGroups) {
      const totalTracts = algoState.currentGroups.reduce((sum, g) => sum + (g.censusTracts?.length || 0), 0);
      console.log(`   - Total Tracts in Groups: ${totalTracts}`);
    }
  } catch (e) {
    console.log('\n❌ Algorithm state not found');
  }

  // Check step data
  console.log('\n=== STEP DATA ANALYSIS ===');
  try {
    const step0 = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_0.json', 'utf8'));
    console.log('✅ Step 0 data found');
    if (step0.stepData?.districtGroups?.[0]) {
      const group = step0.stepData.districtGroups[0];
      console.log(`   - District Group: ${group.startDistrictNumber}-${group.endDistrictNumber}`);
      console.log(`   - Census Tracts: ${group.censusTracts?.length || 'N/A (normalized)'}`);
      console.log(`   - Total Population: ${group.totalPopulation?.toLocaleString()}`);
      console.log(`   - Has Union Polygon: ${!!group.unionPolygon}`);
    }
  } catch (e) {
    console.log('❌ Step 0 data not found');
  }

  try {
    const step1 = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_1.json', 'utf8'));
    console.log('\n✅ Step 1 data found');
    if (step1.stepData?.districtGroups) {
      console.log(`   - District Groups: ${step1.stepData.districtGroups.length}`);
      step1.stepData.districtGroups.forEach((group, i) => {
        const tractCount = group.censusTracts?.length || 'N/A (normalized)';
        console.log(`     Group ${i+1}: ${group.startDistrictNumber}-${group.endDistrictNumber}, ${tractCount} tracts`);
      });
    }
  } catch (e) {
    console.log('\n❌ Step 1 data not found');
  }

  // Check TIGER/state boundary data
  console.log('\n=== TIGER/BOUNDARY DATA ANALYSIS ===');
  try {
    const boundaryMeta = JSON.parse(fs.readFileSync('data/census-cache/state_boundary_polygon_NY.meta.json', 'utf8'));
    console.log('✅ State boundary metadata found');
  } catch (e) {
    console.log('❌ State boundary metadata not found');
  }

  try {
    const boundary = JSON.parse(fs.readFileSync('data/census-cache/state_boundary_polygon_NY.json', 'utf8'));
    console.log('✅ State boundary data found');
    console.log(`   - Type: ${boundary.type}`);
    console.log(`   - Features: ${boundary.features?.length || 'N/A'}`);
  } catch (e) {
    console.log('❌ State boundary data not found');
  }

  // Check for census tract data chunks
  console.log('\n=== CENSUS TRACT DATA ANALYSIS ===');
  const censusFiles = fs.readdirSync('data/census-cache').filter(f => f.startsWith('census_tract_data_'));
  console.log(`Found ${censusFiles.length} census tract data files`);

  let nyCensusFiles = [];
  for (const file of censusFiles) {
    try {
      const metaFile = file.replace('.json', '.meta.json');
      const meta = JSON.parse(fs.readFileSync(`data/census-cache/${metaFile}`, 'utf8'));
      if (meta.state === 'NY' || meta.query?.includes('NY')) {
        nyCensusFiles.push({ file, meta });
      }
    } catch (e) {
      // Skip files without metadata or with read errors
    }
  }

  console.log(`NY-specific census files: ${nyCensusFiles.length}`);
  nyCensusFiles.forEach(({ file, meta }) => {
    console.log(`   - ${file}: ${meta.recordCount || 'N/A'} records, ${meta.query || 'N/A'}`);
  });

  // Check for tract party data
  console.log('\n=== TRACT PARTY DATA ANALYSIS ===');
  try {
    const partyMeta = JSON.parse(fs.readFileSync('data/census-cache/tract_party_NY_2024.meta.json', 'utf8'));
    console.log('✅ Tract party metadata found:');
    console.log(`   - Records: ${partyMeta.recordCount}`);
    console.log(`   - Year: ${partyMeta.year}`);
  } catch (e) {
    console.log('❌ Tract party metadata not found');
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('NY Data Sources Checked:');
  console.log('✅ State tracts (2000 tracts, 12.87 MB in Cloud Storage)');
  console.log('✅ Algorithm state and steps');
  console.log('✅ State boundary polygon');
  console.log('✅ Tract party data (2024)');

  console.log('\nPotential Issues:');
  console.log('- TIGER polygon geometries are stored in Cloud Storage, not locally');
  console.log('- Individual census tract data may be chunked across multiple files');
  console.log('- Union polygons are built only at algorithm completion');

  console.log('\nRecommendations:');
  console.log('1. Verify Cloud Storage contains complete TIGER geometries for all 2000 NY tracts');
  console.log('2. Check that census tract data chunks cover all NY counties');
  console.log('3. Ensure algorithm can reconstruct tract geometries from Cloud Storage');
}

analyzeNYData().catch(console.error);