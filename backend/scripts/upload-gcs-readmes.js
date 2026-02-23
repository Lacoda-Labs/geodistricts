/**
 * Upload README.md files from backend/scripts/gcs-readmes/ to the GeoDistricts
 * GCS bucket so each "folder" (prefix) has a README describing its data and usage.
 *
 * Usage (from repo root or backend):
 *   node backend/scripts/upload-gcs-readmes.js
 *
 * Requires: GOOGLE_CLOUD_PROJECT (or default), CENSUS_DATA_BUCKET (or default).
 */

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const BUCKET_NAME = process.env.CENSUS_DATA_BUCKET || 'geodistricts-census-data';

// Paths to upload: GCS object name -> local path relative to this script
const README_PATHS = [
  ['README.md', 'gcs-readmes/README.md'],
  ['boundaries/README.md', 'gcs-readmes/boundaries/README.md'],
  ['state-tracts/README.md', 'gcs-readmes/state-tracts/README.md'],
  ['demographics/README.md', 'gcs-readmes/demographics/README.md'],
  ['voter-registration/README.md', 'gcs-readmes/voter-registration/README.md'],
  ['union-polygons/README.md', 'gcs-readmes/union-polygons/README.md'],
  ['congressional-boundaries/README.md', 'gcs-readmes/congressional-boundaries/README.md'],
  ['tract-party/README.md', 'gcs-readmes/tract-party/README.md'],
];

async function main() {
  const scriptDir = __dirname;
  const storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'geodistricts',
  });
  const bucket = storage.bucket(BUCKET_NAME);

  const [exists] = await bucket.exists();
  if (!exists) {
    console.error(`Bucket gs://${BUCKET_NAME} does not exist. Create it or set CENSUS_DATA_BUCKET.`);
    process.exit(1);
  }

  for (const [gcsPath, localRel] of README_PATHS) {
    const localPath = path.join(scriptDir, localRel);
    if (!fs.existsSync(localPath)) {
      console.warn(`⚠️  Skip ${gcsPath}: file not found at ${localPath}`);
      continue;
    }
    const content = fs.readFileSync(localPath, 'utf8');
    const file = bucket.file(gcsPath);
    await file.save(content, {
      metadata: {
        contentType: 'text/markdown',
        cacheControl: 'public, max-age=3600',
      },
    });
    console.log(`✅ Uploaded gs://${BUCKET_NAME}/${gcsPath}`);
  }

  console.log(`\nDone. ${README_PATHS.length} README(s) uploaded to gs://${BUCKET_NAME}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
