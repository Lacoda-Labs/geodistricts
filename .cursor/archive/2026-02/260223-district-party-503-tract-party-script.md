# 260223

## 1200 district-party 503 and tract-party script

### Prompt

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/2.txt:7-10 zone.js:2182 
 POST http://localhost:8080/api/algorithm/district-party-for-group/AZ 503 (Service Unavailable)

Follow-up: isn't there a script to run party/tract calc

### Response / actions

- **Cause:** 503 is returned when tract-level party data (VEST) for the state is missing. Handler in `backend/index.js` calls `tractPartyPersistence.loadTractPartyForState(state, DEFAULT_VEST_YEAR)` and returns 503 with message "Tract party data not found. Run POST /api/algorithm/tract-party-persistence first."
- ✅ **IMPLEMENTED:** Added `backend/scripts/run-tract-party-persistence.js` to run the tract-party persistence job from the CLI (same logic as POST /api/algorithm/tract-party-persistence). Accepts optional `[year]` or `VEST_YEAR` env (default 2020). Added backend npm script `tract-party`: run with `cd backend && npm run tract-party` or `cd backend && node scripts/run-tract-party-persistence.js [year]`. Documented that VEST download remains `./scripts/run-vest-download.sh`; run tract-party after (or when cache exists) so district-party-for-group has data.
