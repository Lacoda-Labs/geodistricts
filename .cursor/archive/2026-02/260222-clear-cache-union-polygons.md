# 260222

## 1500 clear cache union polygons fix

### Prompt

clear cache is not deleting union polygons

### Response / actions

✅ **FIXED**: Clear-cache was not deleting union polygon cache entries because the union-polygon key prefix used the raw `state` (e.g. `union_polygon_ca_`). Stored keys use uppercase state (e.g. `union_polygon_CA_0_1_52`), so `listCacheDocIds('union_polygon_ca_')` matched nothing.

**Changes in [backend/index.js](backend/index.js):**
- **deleteAlgorithmCacheForState** (trash/clear-cache): Normalize state with `stateNorm = (state || '').toUpperCase().trim()` and use it for all cache key operations—step keys, run-all keys, algorithm state key, union polygon prefix `union_polygon_${stateNorm}_`, and Cloud Storage list/delete.
- **deleteAlgorithmCacheFromStep1ForState** (restart): Same normalization and use of `stateNorm` for step keys, state key, union polygon prefix, and Cloud Storage.

Union polygons are now removed on clear-cache and restart regardless of whether the client sends state as `"ca"` or `"CA"`.
