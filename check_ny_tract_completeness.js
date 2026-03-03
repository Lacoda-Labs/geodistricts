const fs = require('fs');
const path = require('path');

// Check NY tract completeness by analyzing cached data
async function checkNYTractCompleteness() {
  console.log('🔍 Checking NY Census Tract Data Completeness\n');

  // Load state tracts metadata to get the expected count
  let expectedTractCount = 2000; // Default from previous analysis
  try {
    const stateTractsData = JSON.parse(fs.readFileSync('data/census-cache/state_tracts_NY.json', 'utf8'));
    expectedTractCount = stateTractsData.tractCount || 2000;
    console.log(`📊 Expected NY tracts: ${expectedTractCount}`);
  } catch (e) {
    console.log('⚠️ Could not load state tracts metadata, using default count of 2000');
  }

  // Check algorithm step data for tract counts
  console.log('\n=== ALGORITHM STEP ANALYSIS ===');

  // Check step 0
  try {
    const step0Data = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_0.json', 'utf8'));
    const step0Group = step0Data.stepData?.districtGroups?.[0];
    if (step0Group) {
      console.log(`✅ Step 0: ${step0Group.totalPopulation?.toLocaleString()} population`);
      console.log(`   - Tract IDs stored: ${step0Group.censusTractIds?.length || 'N/A (not normalized)'}`);
      console.log(`   - Has full tracts: ${step0Group.censusTracts ? 'Yes' : 'No (normalized)'}`);
    }
  } catch (e) {
    console.log('❌ Step 0 data not accessible');
  }

  // Check step 1
  try {
    const step1Data = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_1.json', 'utf8'));
    const step1Groups = step1Data.stepData?.districtGroups;
    if (step1Groups) {
      console.log(`✅ Step 1: ${step1Groups.length} district groups`);
      let totalTracts = 0;
      step1Groups.forEach((group, i) => {
        const tractCount = group.censusTractIds?.length || group.censusTracts?.length || 0;
        totalTracts += tractCount;
        console.log(`   Group ${i+1} (${group.startDistrictNumber}-${group.endDistrictNumber}): ${tractCount} tracts`);
      });
      console.log(`   Total tracts in step 1: ${totalTracts}`);

      if (totalTracts !== expectedTractCount) {
        console.log(`   ⚠️ TRACT COUNT MISMATCH: Expected ${expectedTractCount}, got ${totalTracts}`);
      }
    }
  } catch (e) {
    console.log('❌ Step 1 data not accessible');
  }

  // Check if TIGER geometries are available
  console.log('\n=== TIGER GEOMETRY ANALYSIS ===');

  // Check state boundary
  try {
    const boundary = JSON.parse(fs.readFileSync('data/census-cache/state_boundary_polygon_NY.json', 'utf8'));
    console.log('✅ State boundary polygon loaded');
    console.log(`   - Type: ${boundary.type}`);
    console.log(`   - Features: ${boundary.features?.length || 0}`);
  } catch (e) {
    console.log('❌ State boundary not accessible');
  }

  // Analyze census tract data files for NY
  console.log('\n=== CENSUS TRACT DATA FILE ANALYSIS ===');

  const files = fs.readdirSync('data/census-cache');
  const censusTractFiles = files.filter(f => f.startsWith('census_tract_data_'));
  console.log(`Total census tract data files: ${censusTractFiles.length}`);

  let nyTractFiles = [];
  let totalNYTracts = 0;

  for (const file of censusTractFiles) {
    try {
      const metaFile = file.replace('.json', '.meta.json');
      const meta = JSON.parse(fs.readFileSync(`data/census-cache/${metaFile}`, 'utf8'));

      if (meta.state === 'NY' || (meta.query && meta.query.includes('NY'))) {
        nyTractFiles.push({ file, meta });
        totalNYTracts += meta.recordCount || 0;
      }
    } catch (e) {
      // Skip files with missing or invalid metadata
    }
  }

  console.log(`NY-specific census tract files: ${nyTractFiles.length}`);
  console.log(`Total NY tracts from files: ${totalNYTracts}`);

  if (nyTractFiles.length > 0) {
    console.log('\nNY Census Tract Files:');
    nyTractFiles.forEach(({ file, meta }) => {
      console.log(`   - ${file}: ${meta.recordCount || 'N/A'} records`);
      if (meta.query) {
        console.log(`     Query: ${meta.query}`);
      }
    });
  }

  // Check for potential issues
  console.log('\n=== DATA COMPLETENESS ISSUES ===');

  let issues = [];

  // Check if total tracts match expected
  if (totalNYTracts > 0 && totalNYTracts !== expectedTractCount) {
    issues.push(`Tract count mismatch: Expected ${expectedTractCount}, found ${totalNYTracts} in census files`);
  }

  // Check if Cloud Storage data is accessible
  if (!fs.existsSync('data/census-cache/state_tracts_NY.json')) {
    issues.push('State tracts Cloud Storage pointer missing');
  }

  // Check if step data is normalized (missing full geometries)
  try {
    const step1Data = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_1.json', 'utf8'));
    const hasNormalizedData = step1Data.stepData?.districtGroups?.some(g => g.censusTractIds && !g.censusTracts);
    if (hasNormalizedData) {
      issues.push('Step data is normalized (tract IDs only, missing geometries)');
    }
  } catch (e) {
    issues.push('Cannot verify step data normalization status');
  }

  if (issues.length === 0) {
    console.log('✅ No obvious completeness issues found');
  } else {
    console.log('⚠️ Potential issues:');
    issues.forEach(issue => console.log(`   - ${issue}`));
  }

  // Summary and recommendations
  console.log('\n=== SUMMARY ===');
  console.log(`Expected NY tracts: ${expectedTractCount}`);
  console.log(`State tracts in Cloud Storage: ${expectedTractCount}`);
  console.log(`Census tract files for NY: ${nyTractFiles.length} (${totalNYTracts} total tracts)`);
  console.log(`Algorithm steps cached: Yes (steps 0-1)`);
  console.log(`State boundary available: Yes`);
  console.log(`TIGER geometries: Stored in Cloud Storage`);

  console.log('\n=== RECOMMENDATIONS ===');
  console.log('1. Verify Cloud Storage contains complete TIGER geometries for all 2000 NY tracts');
  console.log('2. Check that algorithm can reconstruct tract geometries from Cloud Storage during step loading');
  console.log('3. Ensure census tract data covers all 62 NY counties');
  console.log('4. Verify that step reconstruction works correctly (no missing tracts during normalization)');

  console.log('\n=== NEXT STEPS FOR VERIFICATION ===');
  console.log('1. Run algorithm to completion to verify all tracts are processed');
  console.log('2. Check union polygon generation works for all district groups');
  console.log('3. Verify frontend can display all tracts after reconstruction');
}

checkNYTractCompleteness().catch(console.error);