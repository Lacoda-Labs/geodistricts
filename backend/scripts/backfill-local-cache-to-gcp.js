/**
 * Backfill local cache to GCP (Firestore / Cloud Storage).
 * Reads from existing local file cache (data/census-cache/) and optionally from
 * data/maps-state-comparison.json, then uploads to Firestore or GCS so production
 * has the same data. One-time use after GCP-as-source-of-truth; run with
 * GOOGLE_APPLICATION_CREDENTIALS set. After backfill, run sync-maps-to-gcs.js
 * so GCS has data/maps_landing.json.
 *
 * Usage (from repo root):
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *   node backend/scripts/backfill-local-cache-to-gcp.js
 *   node backend/scripts/backfill-local-cache-to-gcp.js --maps-comparison
 *   node backend/scripts/backfill-local-cache-to-gcp.js --dry-run
 *   node backend/scripts/backfill-local-cache-to-gcp.js --prefix ""
 */

const path = require('path');
const fs = require('fs');

const localCache = require('../local-cache');
const { Firestore } = require('@google-cloud/firestore');
const cloudStorageCache = require('../services/cloud-storage-cache');

const DEFAULT_PREFIX = 'district_party_';
const FIRESTORE_INDEX_ERROR = 'too many index entries';
const COMPARISON_FILENAME = 'maps-state-comparison.json';

function parseArgs() {
  const args = process.argv.slice(2);
  let prefix = DEFAULT_PREFIX;
  let mapsComparison = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prefix') {
      prefix = args[i + 1] ?? '';
      i++;
    } else if (args[i] === '--maps-comparison') {
      mapsComparison = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { prefix, mapsComparison, dryRun };
}

function getComparisonDataPath() {
  const fromData = path.join(__dirname, '..', '..', 'data', COMPARISON_FILENAME);
  if (fs.existsSync(path.join(__dirname, '..', '..', 'data'))) return fromData;
  return path.join(__dirname, '..', 'data', COMPARISON_FILENAME);
}

async function writeDocToGcp(key, data, firestore, dryRun) {
  const sizeBytes = JSON.stringify(data).length;
  if (dryRun) {
    console.log(`  [dry-run] ${key} (${(sizeBytes / 1024).toFixed(1)} KB)`);
    return { firestore: true };
  }
  try {
    await firestore.collection('census_cache').doc(key).set(data);
    console.log(`  ✅ ${key} → Firestore`);
    return { firestore: true };
  } catch (err) {
    const isIndexError = err.message && err.message.includes(FIRESTORE_INDEX_ERROR);
    const isInvalidArg = err.code === 3 || (err.message && err.message.includes('INVALID_ARGUMENT'));
    if (!isIndexError && !isInvalidArg) throw err;
  }
  await cloudStorageCache.initialize();
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`  📦 ${key} too large for Firestore (${sizeMB} MB) → GCS`);
  const cloudStoragePath = await cloudStorageCache.set(key, data, {
    source: 'backfill-local-cache-to-gcp',
    key
  });
  const metadataEntry = {
    cloudStoragePath,
    cloudStorage: true,
    timestamp: data.timestamp != null ? data.timestamp : Date.now(),
    ttl: data.ttl != null ? data.ttl : null
  };
  await firestore.collection('census_cache').doc(key).set(metadataEntry);
  console.log(`  ✅ ${key} → GCS + Firestore metadata`);
  return { gcs: true };
}

async function main() {
  const { prefix, mapsComparison, dryRun } = parseArgs();

  console.log('Backfill local cache → GCP');
  console.log('  prefix:', prefix === '' ? '(all keys)' : prefix);
  console.log('  maps-comparison:', mapsComparison);
  console.log('  dry-run:', dryRun);
  if (dryRun) console.log('  (no writes will be performed)\n');

  const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts'
  });

  let firestoreCount = 0;
  let gcsCount = 0;
  let errorCount = 0;

  // 1. Local cache keys by prefix
  const info = await localCache.getCacheInfo();
  let keys = info.map((i) => i.key);
  if (prefix !== '') {
    keys = keys.filter((k) => k.startsWith(prefix));
  }
  console.log(`\nLocal cache keys to backfill: ${keys.length}\n`);

  const infoByKey = new Map(info.map((i) => [i.key, i]));

  for (const key of keys) {
    try {
      if (dryRun) {
        const meta = infoByKey.get(key);
        const sizeKb = meta && meta.size ? (meta.size / 1024).toFixed(1) : '?';
        console.log(`  [dry-run] ${key} (${sizeKb} KB)`);
        continue;
      }
      const data = await localCache.getFromCache(key);
      if (data == null) {
        console.warn(`  ⚠️ Skip ${key}: could not load from cache`);
        errorCount++;
        continue;
      }
      const result = await writeDocToGcp(key, data, firestore, false);
      if (result.firestore && !result.gcs) firestoreCount++;
      if (result.gcs) gcsCount++;
    } catch (err) {
      console.error(`  ❌ ${key}:`, err.message);
      errorCount++;
    }
  }

  // 2. maps_state_comparison from file (when --maps-comparison)
  if (mapsComparison) {
    const dataPath = getComparisonDataPath();
    if (!fs.existsSync(dataPath)) {
      console.warn(`\n⚠️ Maps comparison file not found: ${dataPath}`);
    } else {
      try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        const payload = JSON.parse(raw);
        if (!payload.us || !payload.states) {
          console.warn('  ⚠️ maps_state_comparison: invalid payload (us/states missing)');
          errorCount++;
        } else {
          if (dryRun) {
            console.log(`  [dry-run] maps_state_comparison (from ${dataPath})`);
          } else {
            await writeDocToGcp('maps_state_comparison', payload, firestore, false);
            await cloudStorageCache.initialize();
            await cloudStorageCache.set('maps_state_comparison', payload, {
              source: 'backfill-local-cache-to-gcp'
            });
            console.log('  ✅ maps_state_comparison → Firestore + GCS');
            firestoreCount++;
          }
        }
      } catch (err) {
        console.error('  ❌ maps_state_comparison:', err.message);
        errorCount++;
      }
    }
  }

  console.log('\n---');
  if (dryRun) {
    console.log('Dry run complete. Run without --dry-run to upload.');
  } else {
    console.log(`Done. Firestore docs: ${firestoreCount}, GCS (large) docs: ${gcsCount}, errors: ${errorCount}`);
    console.log('Next: run node backend/scripts/sync-maps-to-gcs.js so GCS has data/maps_landing.json');
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
