#!/usr/bin/env node
/**
 * Verify backend setup and test endpoints
 */

console.log('🔍 Verifying backend setup...\n');

// Check 1: Dependencies
console.log('1. Checking dependencies...');
try {
  require('csv-parse');
  console.log('   ✅ csv-parse installed');
} catch (e) {
  console.log('   ❌ csv-parse NOT installed - run: npm install csv-parse');
  process.exit(1);
}

// Check 2: Service files
console.log('\n2. Checking service files...');
const fs = require('fs');
const services = ['s4-data-loader.js', 'geodistrict-algorithm.js', 'latlong-division.js'];
for (const service of services) {
  const path = `./services/${service}`;
  if (fs.existsSync(path)) {
    console.log(`   ✅ ${service} exists`);
  } else {
    console.log(`   ❌ ${service} NOT found`);
    process.exit(1);
  }
}

// Check 3: Load services
console.log('\n3. Loading services...');
try {
  require('./services/s4-data-loader');
  const { GeodistrictAlgorithmService } = require('./services/geodistrict-algorithm');
  const latLongDivisionService = require('./services/latlong-division');
  const service = new GeodistrictAlgorithmService(latLongDivisionService);
  console.log('   ✅ All services load correctly');
} catch (e) {
  console.log(`   ❌ Error loading services: ${e.message}`);
  console.log(`   Stack: ${e.stack}`);
  process.exit(1);
}

// Check 4: Routes in index.js
console.log('\n4. Checking route registration...');
const indexContent = fs.readFileSync('./index.js', 'utf8');
if (indexContent.includes('app.post(\'/api/algorithm/:algorithm/execute\'')) {
  console.log('   ✅ Execute endpoint registered');
} else {
  console.log('   ❌ Execute endpoint NOT found in index.js');
  process.exit(1);
}

if (indexContent.includes('app.post(\'/api/algorithm/:algorithm/execute/step-by-step\'')) {
  console.log('   ✅ Step-by-step endpoint registered');
} else {
  console.log('   ❌ Step-by-step endpoint NOT found in index.js');
  process.exit(1);
}

// Check 5: S4 data files
console.log('\n5. Checking S4 data files...');
const s4Files = ['tract_2020.csv', 'nlist_2020.csv'];
for (const file of s4Files) {
  const path = `./data/s4-data/${file}`;
  if (fs.existsSync(path)) {
    const stats = fs.statSync(path);
    console.log(`   ✅ ${file} exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log(`   ⚠️  ${file} NOT found (optional, will load from cache if needed)`);
  }
}

console.log('\n✅ All checks passed! Backend is ready to start.');
console.log('\nTo start the server:');
console.log('  npm start');
console.log('\nOr with auto-reload:');
console.log('  npm run dev\n');

