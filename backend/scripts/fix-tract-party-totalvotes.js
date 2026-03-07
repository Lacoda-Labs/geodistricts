#!/usr/bin/env node

/**
 * One-time fix: read tract_party_{state}_{year}.json from local cache,
 * set totalVotes = votesDem + votesRep for every tract, write back.
 * Use when existing files have county-level or full-ballot totalVotes.
 *
 * Usage: node backend/scripts/fix-tract-party-totalvotes.js [state] [year]
 * Example: node backend/scripts/fix-tract-party-totalvotes.js TX 2024
 */

const path = require('path');
const fs = require('fs').promises;

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'census-cache');

async function main() {
  const state = (process.argv[2] || 'TX').toUpperCase();
  const year = process.argv[3] || '2024';
  const key = `tract_party_${state}_${year}`;
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dataPath = path.join(CACHE_DIR, `${safeKey}.json`);
  const metaPath = path.join(CACHE_DIR, `${safeKey}.meta.json`);

  let data;
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read:', dataPath, err.message);
    process.exit(1);
  }

  const geoids = data.geoids;
  if (!geoids || typeof geoids !== 'object') {
    console.error('No geoids in file');
    process.exit(1);
  }

  let fixed = 0;
  for (const geoid of Object.keys(geoids)) {
    const row = geoids[geoid];
    const votesDem = row.votesDem ?? 0;
    const votesRep = row.votesRep ?? 0;
    const twoParty = votesDem + votesRep;
    if (row.totalVotes !== twoParty) {
      row.totalVotes = twoParty;
      fixed++;
    }
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');
  const meta = { timestamp: Date.now(), ttl: null, version: '1.0', dataSize: Buffer.byteLength(JSON.stringify(data), 'utf8') };
  try {
    const existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    Object.assign(meta, existingMeta);
    meta.timestamp = Date.now();
  } catch (_) {}
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  console.log(`Fixed ${fixed} tracts in ${key}; totalVotes = votesDem + votesRep. Wrote ${dataPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
