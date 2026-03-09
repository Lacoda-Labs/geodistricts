# 260308

## 1200 tract party enrich on next-step (Step 1 all blue fix)

### Prompt

see screenshot. TX Step 1 of 6. the state tract colors are all blue after clicking Next from Step 0 after a clear cache. The, after page refresh the tracts are correctly colored by party. what is the reason? for blue state when step 1 division is completed?

[Follow-up:] ok, so detect this scenario and fix so that result is same after page refresh.

### Response / actions

- **Reason**: After clear cache, Step 1 is returned from `executeNextStep` (cache miss). Those step tracts never get tract-level party (`pctDem` in `tract.properties`). The frontend only gets tract party from the step payload (or from `tractPartyByGeoid`, which the maps page never fetches). So `getPartyFromTract` returns null → map falls back to district-level color; when both DGs are Dem-leaning, the map looks “all blue.” After refresh, Step 1 is served from cache via `reconstructStepFromCache`, which enriches tracts with party, so coloring is correct.
- ✅ **FIXED**: Backend now enriches step tracts with party when returning next-step (cache miss). Added `enrichStepTractsWithParty(step, state)` that loads tract-party for the state and adds `pctDem`, `pctRep`, `votesDem`, `votesRep`, `totalVotes` to each tract’s `properties`. The next-step handler calls it before `res.json({ data: step })` so the client receives the same tract-level party as on cache-hit/reconstruct path. No frontend changes; map shows correct red/blue tract coloring at Step 1 after clear cache + Next.
