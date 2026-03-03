const fs = require('fs');

// Check if NY tracts in Cloud Storage have TIGER geometries
async function checkTigerGeometries() {
  console.log('🔍 Checking TIGER Geometries in NY Tract Data\n');

  // First, let's check what the algorithm state says about tract reconstruction
  console.log('=== ALGORITHM STATE ANALYSIS ===');

  try {
    const algoState = JSON.parse(fs.readFileSync('data/census-cache/algorithm_state_NY_100.json', 'utf8'));
    console.log('✅ Algorithm state loaded');

    if (algoState.data?.currentGroups) {
      console.log(`📊 Current groups: ${algoState.data.currentGroups.length}`);

      let totalTracts = 0;
      let totalTractsWithGeometry = 0;

      algoState.data.currentGroups.forEach((group, i) => {
        if (group.censusTracts) {
          totalTracts += group.censusTracts.length;
          const tractsWithGeom = group.censusTracts.filter(t => t.geometry).length;
          totalTractsWithGeometry += tractsWithGeom;

          console.log(`   Group ${i+1}: ${group.censusTracts.length} tracts, ${tractsWithGeom} with geometry`);
        }
      });

      console.log(`\n📈 SUMMARY:`);
      console.log(`   Total tracts: ${totalTracts}`);
      console.log(`   Tracts with geometry: ${totalTractsWithGeometry}`);
      console.log(`   Tracts missing geometry: ${totalTracts - totalTractsWithGeometry}`);

      if (totalTractsWithGeometry === 0) {
        console.log('\n❌ CRITICAL: No tracts have geometry in algorithm state!');
        console.log('This means TIGER geometries were never attached to census tracts.');
      } else if (totalTractsWithGeometry < totalTracts) {
        console.log(`\n⚠️ PARTIAL: ${totalTracts - totalTractsWithGeometry} tracts missing TIGER geometries`);
      } else {
        console.log('\n✅ COMPLETE: All tracts have TIGER geometries');
      }
    }
  } catch (e) {
    console.log('❌ Could not load algorithm state');
  }

  // Check step data
  console.log('\n=== STEP DATA ANALYSIS ===');

  try {
    const step1 = JSON.parse(fs.readFileSync('data/census-cache/algorithm_step_NY_100_1.json', 'utf8'));
    console.log('✅ Step 1 data loaded');

    if (step1.stepData?.districtGroups) {
      let totalTracts = 0;
      let totalWithGeom = 0;

      step1.stepData.districtGroups.forEach((group, i) => {
        if (group.censusTracts) {
          totalTracts += group.censusTracts.length;
          const withGeom = group.censusTracts.filter(t => t.geometry).length;
          totalWithGeom += withGeom;

          console.log(`   Group ${i+1}: ${group.censusTracts.length} tracts, ${withGeom} with geometry`);
        }
      });

      console.log(`\n📈 STEP 1 SUMMARY:`);
      console.log(`   Total tracts: ${totalTracts}`);
      console.log(`   With geometry: ${totalWithGeom}`);
      console.log(`   Missing geometry: ${totalTracts - totalWithGeom}`);
    }
  } catch (e) {
    console.log('❌ Could not load step 1 data');
  }

  // Check if the issue is in the reconstruction process
  console.log('\n=== DIAGNOSIS ===');

  console.log('Possible causes for missing TIGER geometries:');
  console.log('1. TIGER boundary data was never fetched for NY');
  console.log('2. TIGER API returned empty/invalid data');
  console.log('3. Census tract IDs don\'t match TIGER GEOIDs');
  console.log('4. Cloud Storage data was saved without geometries');
  console.log('5. Reconstruction process is not working correctly');

  console.log('\n=== RECOMMENDED FIXES ===');
  console.log('1. Check backend logs for TIGER fetch errors during NY tract creation');
  console.log('2. Manually re-fetch TIGER boundaries for NY');
  console.log('3. Verify census tract IDs match TIGER GEOIDs');
  console.log('4. Rebuild NY state tract cache with proper TIGER data');
  console.log('5. Test reconstruction process with sample data');

  console.log('\n=== IMMEDIATE VERIFICATION ===');
  console.log('Run the backend with NY tract creation to see TIGER attachment logs:');
  console.log('   POST /api/census/tracts/:state with forceInvalidate=true');
  console.log('Look for: "Attached X TIGER polygons to canonical tracts (Y unmatched)"');
}

checkTigerGeometries().catch(console.error);