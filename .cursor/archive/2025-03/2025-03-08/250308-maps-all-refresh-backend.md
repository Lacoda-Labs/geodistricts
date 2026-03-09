# 250308

## 1400 maps All refresh backend behavior

### Prompt

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/4.txt:7-1013 what's going on here on the backend? just did a page refresh on /dev/maps with All selected

### Response / actions

Explained what the backend is doing on a maps page refresh with "All" selected:

- **Trigger**: Frontend requests `GET /api/algorithm/final-step/FL`, `GET /api/algorithm/district-party/FL/5`, and `GET /api/algorithm/map-polygons/:state` for every state. For Florida, cached `algorithm_state_FL_100` was missing, so the backend **reconstructs** algorithm state from the final step doc (step 5) plus the state tract cache (~57 MB from Cloud Storage).
- **Reconstruction**: Rebuilds 28 district groups, enriches with party data, updates DG properties from division lines, runs enclosed-tract detection (S4 adjacency sometimes missing for FL so first run skips; when present, 3 enclosed tracts found). Group 28 has 40 tracts without geometry (water/special Census IDs); they are excluded.
- **Union polygons**: For each group the backend loads union polygon from Cloud Storage. For groups 3-3, 8-8, 12-12, 14-14 the cached file is empty or tiny (e.g. "Retrieved 0.00 MB"). It then builds the union from tracts: `turf.dissolve` is tried first; for those groups the result is rejected as "too small" (e.g. 218 points for 177 tracts), so the code falls back to **sequential union** of hundreds of polygons (~45–100 s per group). Responses (200 for final-step and district-party) are sent once state and cached unions are ready; slow union creation can continue afterward or from concurrent requests.
- **Other states**: Map-polygons and district-party for other states are served from cache (state boundary or `map_polygons_*` blob, local cache hits) and complete quickly.

No code changes; analysis only.
