#!/usr/bin/env node
/**
 * One-shot: resolve maps_landing.json, run all static maps CDN generators, optionally upload to GCS.
 *
 * Run from repo root:
 *   STATIC_MAPS_CDN_BASE=https://storage.googleapis.com/BUCKET/public-maps \
 *     node backend/scripts/build-static-maps-cdn-assets.js
 *
 * Options:
 *   --out DIR              Output dir (default: data/cdn-maps-static under repo root)
 *   --landing PATH         Use this maps_landing.json
 *   --from-api BASE        Fetch GET {BASE}/api/maps/landing (no trailing /api)
 *   --from-gcs             Copy MAPS_LANDING_GCS_URI to data/maps_landing.json
 *   --upload                 After build, gcloud storage rsync output dir to STATIC_MAPS_GCS_PREFIX (flat; no extra cdn-maps-static segment)
 *   --dry-run              Print steps only
 *
 * Env:
 *   STATIC_MAPS_CDN_BASE     HTTPS origin for state JSON image URLs (required for state static JSON)
 *   GET_MAPS_LANDING_URL     Full URL to GET landing JSON (alternative to --from-api)
 *   MAPS_LANDING_GCS_URI     e.g. gs://geodistricts-census-data/data/maps_landing.json
 *   STATIC_MAPS_GCS_PREFIX   e.g. gs://geodistricts-census-data/public-maps (for --upload)
 *   OUT_DIR                  Same as --out
 *
 * See doc/pages/STATIC_MAPS_CDN.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findRepoRoot() {
  const fromScript = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(fromScript, 'frontend', 'public'))) {
    return fromScript;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'frontend', 'public')) && fs.existsSync(path.join(dir, 'backend', 'scripts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find repo root (need frontend/public). Run from geodistricts repo root.');
}

function parseArgs(argv) {
  const opts = {
    out: null,
    landing: null,
    fromApi: null,
    fromGcs: false,
    upload: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    } else if (a === '--landing' && argv[i + 1]) {
      opts.landing = argv[++i];
    } else if (a === '--from-api' && argv[i + 1]) {
      opts.fromApi = argv[++i].replace(/\/$/, '');
    } else if (a === '--from-gcs') {
      opts.fromGcs = true;
    } else if (a === '--upload') {
      opts.upload = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function validateLandingPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.polygonsByState && Object.keys(data.polygonsByState).length > 0) return true;
  if (data.stateComparison && data.stateComparison.states) return true;
  return false;
}

async function fetchLandingToFile(url, destFile) {
  const axios = require('axios');
  const { data, status } = await axios.get(url, {
    timeout: 300000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });
  if (status !== 200) {
    throw new Error(`GET ${url} failed: HTTP ${status}`);
  }
  if (!validateLandingPayload(data)) {
    throw new Error(`GET ${url} returned JSON without polygonsByState/stateComparison`);
  }
  ensureDir(path.dirname(destFile));
  const tmp = `${destFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, destFile);
  return destFile;
}

function runStep(label, cmd, args, env, repoRoot, dryRun) {
  console.log(`\n── ${label} ──`);
  const e = { ...process.env, ...env };
  if (dryRun) {
    const envStr = Object.keys(env || {}).length
      ? ` ${Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`
      : '';
    console.log(`[dry-run]${envStr} ${cmd} ${args.join(' ')}`);
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, { cwd: repoRoot, env: e, stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
  return r;
}

function copyLandingFromGcs(gsUri, destFile, dryRun) {
  console.log(`\n── Fetch landing from GCS ──`);
  if (dryRun) {
    console.log(`[dry-run] gcloud storage cp ${gsUri || '$MAPS_LANDING_GCS_URI'} ${destFile}`);
    return;
  }
  if (!gsUri) {
    throw new Error('MAPS_LANDING_GCS_URI is required with --from-gcs');
  }
  ensureDir(path.dirname(destFile));
  const r = spawnSync('gcloud', ['storage', 'cp', gsUri, destFile], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error('gcloud storage cp failed (is gcloud installed and authenticated?)');
  }
  const raw = fs.readFileSync(destFile, 'utf8');
  const data = JSON.parse(raw);
  if (!validateLandingPayload(data)) {
    throw new Error('Downloaded maps_landing.json is missing polygonsByState/stateComparison');
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(`
Usage: STATIC_MAPS_CDN_BASE=https://... node backend/scripts/build-static-maps-cdn-assets.js [options]

  --out DIR          Output directory (default data/cdn-maps-static)
  --landing PATH     maps_landing.json path
  --from-api BASE    API origin only (fetches BASE/api/maps/landing)
  --from-gcs         Requires MAPS_LANDING_GCS_URI
  --upload           Requires STATIC_MAPS_GCS_PREFIX; uploads with Cache-Control
  --dry-run
See doc/pages/STATIC_MAPS_CDN.md
`);
    process.exit(0);
  }

  const repoRoot = findRepoRoot();
  const defaultLanding = path.join(repoRoot, 'data', 'maps_landing.json');
  const outDir = path.resolve(repoRoot, opts.out || process.env.OUT_DIR || path.join('data', 'cdn-maps-static'));
  const cdnBase = (process.env.STATIC_MAPS_CDN_BASE || '').replace(/\/$/, '');

  console.log('Repo root:', repoRoot);
  console.log('Output dir:', outDir);

  let landPath = null;

  if (opts.landing) {
    landPath = path.isAbsolute(opts.landing) ? opts.landing : path.join(repoRoot, opts.landing);
    if (!fs.existsSync(landPath)) {
      throw new Error(`--landing file not found: ${landPath}`);
    }
  } else if (fs.existsSync(defaultLanding)) {
    landPath = defaultLanding;
    console.log('Using existing', path.relative(repoRoot, defaultLanding));
  } else if (process.env.GET_MAPS_LANDING_URL) {
    const url = process.env.GET_MAPS_LANDING_URL;
    console.log('Fetching landing from GET_MAPS_LANDING_URL');
    if (opts.dryRun) {
      console.log(`[dry-run] GET ${url} -> ${defaultLanding}`);
      landPath = defaultLanding;
    } else {
      landPath = await fetchLandingToFile(url, defaultLanding);
    }
  } else if (opts.fromApi) {
    const base = opts.fromApi.replace(/\/$/, '');
    const url = `${base}/api/maps/landing`;
    console.log('Fetching landing from', url);
    if (opts.dryRun) {
      console.log(`[dry-run] GET ${url} -> ${defaultLanding}`);
      landPath = defaultLanding;
    } else {
      landPath = await fetchLandingToFile(url, defaultLanding);
    }
  } else if (opts.fromGcs || process.env.MAPS_LANDING_GCS_URI) {
    const uri = process.env.MAPS_LANDING_GCS_URI;
    if (!opts.dryRun && !uri) {
      throw new Error('Set MAPS_LANDING_GCS_URI (e.g. gs://bucket/data/maps_landing.json); use --from-gcs if copying explicitly.');
    }
    copyLandingFromGcs(uri, defaultLanding, opts.dryRun);
    landPath = defaultLanding;
  } else {
    console.error(`
No maps_landing.json found at ${defaultLanding}.

Provide one of:
  • Place data/maps_landing.json locally
  • SET GET_MAPS_LANDING_URL=https://your-api/api/maps/landing
  • node ... --from-api https://your-api-host   (no /api suffix)
  • MAPS_LANDING_GCS_URI=gs://.../data/maps_landing.json node ... --from-gcs

Produce landing on the server first: POST /api/admin/maps-landing/generate (see backend/scripts/sync-maps-to-gcs.js).
`);
    process.exit(1);
  }

  const landArg = path.isAbsolute(landPath) ? landPath : path.join(repoRoot, landPath);
  const landRel = path.relative(repoRoot, landArg) || landArg;

  const effectiveCdnBase = cdnBase || (opts.dryRun ? 'https://storage.googleapis.com/YOUR_BUCKET/public-maps' : '');
  if (!effectiveCdnBase) {
    console.error('STATIC_MAPS_CDN_BASE is required (HTTPS base where uploaded assets will be served, e.g. https://storage.googleapis.com/BUCKET/public-maps)');
    process.exit(1);
  }

  ensureDir(outDir);
  ensureDir(path.join(outDir, 'states'));

  const node = process.execPath;
  const webpOut = path.join(outDir, 'geodistricts-all-119.webp');

  runStep(
    'generate-frontend-maps-summaries',
    node,
    ['backend/scripts/generate-frontend-maps-summaries.js', landRel],
    {},
    repoRoot,
    opts.dryRun
  );

  runStep(
    'generate-geodistricts-all-raster',
    node,
    ['backend/scripts/generate-geodistricts-all-raster.js', landRel, webpOut],
    {},
    repoRoot,
    opts.dryRun
  );

  runStep(
    'generate-state-map-rasters',
    node,
    ['backend/scripts/generate-state-map-rasters.js', landRel, outDir],
    {},
    repoRoot,
    opts.dryRun
  );

  runStep(
    'generate-state-static-json',
    node,
    ['backend/scripts/generate-state-static-json.js', landRel, outDir],
    { CDN_PUBLIC_BASE_URL: effectiveCdnBase },
    repoRoot,
    opts.dryRun
  );

  console.log('\n✅ Build steps finished.');
  console.log('Frontend summaries:', path.join(repoRoot, 'frontend', 'public', 'maps', 'maps-landing-summaries.json'));
  console.log('CDN artifact dir:', outDir);
  console.log('\nSet frontend production env to match upload location:');
  console.log(`  cdnBaseUrl: '${cdnBase || effectiveCdnBase}'`);
  console.log(`  staticAllMapImageUrl: ''  // or full URL; empty uses \${cdnBaseUrl}/geodistricts-all-119.webp`);

  const gcsPrefix = (process.env.STATIC_MAPS_GCS_PREFIX || '').replace(/\/$/, '');
  if (opts.upload) {
    if (!gcsPrefix && !opts.dryRun) {
      console.error('STATIC_MAPS_GCS_PREFIX is required for --upload (e.g. gs://geodistricts-census-data/public-maps)');
      process.exit(1);
    }
    console.log(`\n── Upload to ${gcsPrefix || '$STATIC_MAPS_GCS_PREFIX'} ──`);
    if (opts.dryRun) {
      console.log(
        `[dry-run] gcloud storage rsync --recursive --cache-control="public, max-age=86400" "${outDir}" "${gcsPrefix || 'gs://BUCKET/public-maps'}"`
      );
    } else {
      const r = spawnSync(
        'gcloud',
        [
          'storage',
          'rsync',
          '--recursive',
          '--cache-control=public, max-age=86400',
          outDir,
          gcsPrefix,
        ],
        { cwd: repoRoot, stdio: 'inherit' }
      );
      if (r.status !== 0) {
        console.error('Upload failed. Fix gcloud auth/IAM or upload manually. Public URL shape:', `${cdnBase}/geodistricts-all-119.webp`);
        process.exit(r.status || 1);
      }
      console.log('✅ Upload complete.');
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
