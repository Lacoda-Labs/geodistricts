# 260212

## 2045 GCP maps page no party data

### Prompt

User asked why the /maps page on deployed GCP has no party data.

### Response / actions

- **Cause**: The backend Docker image is built from `backend/` only, so repo-root `data/congress-119-party.json` was never included. The API’s 119th-only fallback for `GET /api/maps/state-comparison` could not load that file and returned empty party data.
- ✅ **FIXED**: Added `backend/data/congress-119-party.json` (copy of root `data/congress-119-party.json`) so the image bundles 119th data. Path resolution in `congress-119-party.js` already checks `../data/` (backend/data/). Updated `backend/README.md` with a “Data files (deployment)” note to keep the backend copy in sync when the root file is updated.
- **Next step**: Rebuild and redeploy the backend to GCP for the fix to take effect.
