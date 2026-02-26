/**
 * Run the algorithm for each state that does not have the final step completed.
 * For each state: clear cache, run all steps, move isolated then balance to completion,
 * then trigger polygon and party jobs. Errors are caught, logged, and the script
 * continues to the next state.
 *
 * Usage: node backend/scripts/run-incomplete-states-algorithm.js [baseUrl]
 * Example: node backend/scripts/run-incomplete-states-algorithm.js http://localhost:8080
 *
 * Environment: API_URL overrides baseUrl. Timeouts: EXECUTE_TIMEOUT_MS (default 600000),
 * MOVE_BALANCE_TIMEOUT_MS (default 120000), REQUEST_TIMEOUT_MS (default 60000).
 */

const axios = require('axios');
const { CONGRESSIONAL_DISTRICTS_BY_STATE } = require('../services/geodistrict-algorithm');

const baseUrl = process.argv[2] || process.env.API_URL || 'http://localhost:8080';
const maxIterations = 100;
const executeTimeout = parseInt(process.env.EXECUTE_TIMEOUT_MS || '600000', 10);
const moveBalanceTimeout = parseInt(process.env.MOVE_BALANCE_TIMEOUT_MS || '120000', 10);
const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '60000', 10);
const maxMoveIterations = 20;
const maxBalanceIterations = 10;

const allStateCodes = Object.keys(CONGRESSIONAL_DISTRICTS_BY_STATE || {}).sort();

async function getFinalStepStates() {
  const { data } = await axios.get(`${baseUrl}/api/algorithm/final-step-states`, {
    timeout: requestTimeout,
    headers: { 'Content-Type': 'application/json' },
  });
  return data.stateCodes || [];
}

async function runState(state) {
  const stateUpper = state.toUpperCase();

  // 0. Prime state tract cache (and step 0). step-by-step writes state_tracts_* in async cacheStep0(); wait until step 0 is loadable.
  await axios.post(
    `${baseUrl}/api/algorithm/execute/step-by-step`,
    { state: stateUpper, maxIterations, options: {} },
    { timeout: executeTimeout, headers: { 'Content-Type': 'application/json' } }
  );
  await new Promise((r) => setTimeout(r, 15000)); // give cacheStep0() time to write state_tracts_*
  const step0Url = `${baseUrl}/api/algorithm/step/${stateUpper}/0?maxIterations=${maxIterations}`;
  const poll0MaxMs = 120000;
  const poll0IntervalMs = 2000;
  const poll0Start = Date.now();
  while (Date.now() - poll0Start < poll0MaxMs) {
    try {
      const r0 = await axios.get(step0Url, { timeout: requestTimeout, validateStatus: () => true });
      if (r0.status === 200) break;
    } catch (_) { /* ignore */ }
    await new Promise((r) => setTimeout(r, poll0IntervalMs));
  }

  // 1. Clear cache (removes steps and algorithm state; keeps state_tracts_*)
  await axios.post(`${baseUrl}/api/algorithm/clear-cache`, { state: stateUpper, maxIterations }, {
    timeout: requestTimeout,
    headers: { 'Content-Type': 'application/json' },
  });

  // 2. Run all steps
  const executeRes = await axios.post(
    `${baseUrl}/api/algorithm/execute`,
    { state: stateUpper, maxIterations, options: {}, resolveIsolation: true },
    { timeout: executeTimeout, headers: { 'Content-Type': 'application/json' } }
  );
  const result = executeRes.data?.result;
  if (!result || !Array.isArray(result.steps) || result.steps.length === 0) {
    throw new Error(`Execute returned no steps for ${stateUpper}`);
  }
  const finalStepNumber = result.steps.length - 1;

  // For multi-district, wait until final step is loadable (backend writes state tract cache async in cacheAlgorithmResult after execute).
  if (finalStepNumber >= 1) {
    await new Promise((r) => setTimeout(r, 15000)); // give cacheAlgorithmResult a head start
    const stepUrl = `${baseUrl}/api/algorithm/step/${stateUpper}/${finalStepNumber}?maxIterations=${maxIterations}`;
    const pollMaxMs = 300000;
    const pollIntervalMs = 3000;
    const pollStart = Date.now();
    while (Date.now() - pollStart < pollMaxMs) {
      try {
        const r = await axios.get(stepUrl, { timeout: requestTimeout, validateStatus: () => true });
        if (r.status === 200) break;
      } catch (_) { /* ignore */ }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  } else {
    await new Promise((r) => setTimeout(r, 5000)); // allow async cache write before step-by-step
  }

  if (finalStepNumber === 0) {
    // Single-district state: run-all does not cache step 0. Cache it via step-by-step.
    // build-all-union-polygons and district-party require finalStepNumber >= 1; skip them for step 0.
    await axios.post(
      `${baseUrl}/api/algorithm/execute/step-by-step`,
      { state: stateUpper, maxIterations, options: {} },
      { timeout: requestTimeout, headers: { 'Content-Type': 'application/json' } }
    );
  } else {
    // 3. Move isolated (loop until 0)
    let moveIter = 0;
    while (moveIter < maxMoveIterations) {
      moveIter++;
      const moveRes = await axios.post(
        `${baseUrl}/api/algorithm/move-all-isolated-tracts`,
        { state: stateUpper, step: finalStepNumber, maxIterations },
        { timeout: moveBalanceTimeout, headers: { 'Content-Type': 'application/json' } }
      );
      const totalIsolated = moveRes.data?.isolationResult?.totalIsolated ?? 0;
      if (totalIsolated === 0) break;
    }
    if (moveIter >= maxMoveIterations) {
      console.warn(`  ⚠️ ${stateUpper}: move-isolated hit max iterations (${maxMoveIterations})`);
    }

    // 4. Load full step for balance (GET step returns { step, data, isComplete }; data has districtGroups, divisionLines)
    const stepRes = await axios.get(
      `${baseUrl}/api/algorithm/step/${stateUpper}/${finalStepNumber}?maxIterations=${maxIterations}`,
      { timeout: requestTimeout, headers: { 'Content-Type': 'application/json' } }
    );
    const stepData = stepRes.data?.data;
    const districtGroups = stepData?.districtGroups;
    const divisionLines = stepData?.divisionLines || [];
    if (!Array.isArray(districtGroups) || districtGroups.length === 0) {
      throw new Error(`Step ${finalStepNumber} has no districtGroups for ${stateUpper}`);
    }

    // 5. Balance (loop until noMoreBalancingPossible)
    let currentGroups = districtGroups;
    let balanceIter = 0;
    while (balanceIter < maxBalanceIterations) {
      balanceIter++;
      const balanceRes = await axios.post(
        `${baseUrl}/api/algorithm/balance-after-isolated`,
        {
          state: stateUpper,
          step: finalStepNumber,
          districtGroups: currentGroups,
          divisionLines,
          maxIterations,
        },
        { timeout: moveBalanceTimeout, headers: { 'Content-Type': 'application/json' } }
      );
      const nextGroups = balanceRes.data?.districtGroups;
      if (Array.isArray(nextGroups) && nextGroups.length > 0) {
        currentGroups = nextGroups;
      }
      if (balanceRes.data?.noMoreBalancingPossible === true) break;
    }
    if (balanceIter >= maxBalanceIterations) {
      console.warn(`  ⚠️ ${stateUpper}: balance hit max iterations (${maxBalanceIterations})`);
    }
  }

  // 6. Trigger polygon and party jobs (backend requires finalStepNumber >= 1; skip for single-district)
  if (finalStepNumber >= 1) {
    const buildAllUrl = `${baseUrl}/api/algorithm/build-all-union-polygons/${stateUpper}?finalStepNumber=${finalStepNumber}&maxIterations=${maxIterations}`;
    const districtPartyUrl = `${baseUrl}/api/algorithm/district-party/${stateUpper}?finalStepNumber=${finalStepNumber}&maxIterations=${maxIterations}`;
    await axios.post(buildAllUrl, {}, { timeout: requestTimeout, headers: { 'Content-Type': 'application/json' } });
    await axios.post(districtPartyUrl, {}, { timeout: requestTimeout, headers: { 'Content-Type': 'application/json' } });
  }

  return { finalStepNumber, stepsCount: result.steps.length };
}

async function main() {
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Fetching states with final step completed...`);
  let finalStepStateCodes = [];
  try {
    finalStepStateCodes = await getFinalStepStates();
  } catch (err) {
    console.error('Failed to get final-step-states:', err.response?.data || err.message);
    process.exit(1);
  }
  const completedSet = new Set(finalStepStateCodes || []);
  const toRun = allStateCodes.filter((s) => !completedSet.has(s.toUpperCase()));
  console.log(`States with final step: ${finalStepStateCodes.length}`);
  console.log(`States to run: ${toRun.length} (${toRun.join(', ') || 'none'})\n`);

  if (toRun.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const succeeded = [];
  const failed = [];

  for (const state of toRun) {
    const stateUpper = state.toUpperCase();
    console.log(`\n--- ${stateUpper} ---`);
    try {
      const summary = await runState(state);
      console.log(`  ✅ Done: ${summary.stepsCount} steps, final step ${summary.finalStepNumber}`);
      succeeded.push(stateUpper);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error(`  ❌ Error: ${msg}`);
      failed.push({ state: stateUpper, message: msg });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Succeeded: ${succeeded.length} (${succeeded.join(', ') || 'none'})`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length}`);
    failed.forEach(({ state, message }) => console.log(`  ${state}: ${message}`));
  }
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
