# 260302

## 1500 TX party data missing and district party totals wrong

### Prompt

TX party data is wrong or missing (table cell shows "—"). Later: district party totals (D/R %) look wrong (e.g. D 15.6% · R 33.5% don't sum to 100%). User asked to confirm tract party from VEST and the calculation to total party for tracts in the final geodistrict (denominator).

### Response / actions

Plan: [.cursor/plans/tx_party_data_fix_80fdc09c.plan.md](.cursor/plans/tx_party_data_fix_80fdc09c.plan.md)

- **TX party "—" (plan implemented):** Backend had rejected district-party for step 0 (`finalStepNumber >= 1`). Frontend only showed party when `isFinalStepActive` (every group single-district). ✅ **FIXED**: Backend now allows `finalStepNumber === 0` for POST district-party and district-party-for-group. Frontend `getGroupPartyDisplayText` shows D/R % whenever `districtPartyByGroupKey` has data for the group (removed `isFinalStepActive` guard).
- **District party totals wrong:** Percentages used `totalVotes` as denominator. When tract data comes from county allocation, `total_votes_pres` was total ballots (not two-party), so D+R did not sum to 100%. ✅ **FIXED**: District aggregation in `runDistrictPartyJob` and district-party-for-group now uses two-party total as denominator: `twoPartyTotal = votesDem + votesRep`; `pctDem = votesDem / twoPartyTotal`, `pctRep = votesRep / twoPartyTotal`. County-allocated tracts in `vest-data-loader.buildTractDataFromCountyVEST` now set `total_votes_pres = dem + rep` so stored tract data is two-party consistent.
- **VEST confirmed:** Tract-level `processVESTData` already uses `totalPres = votesDemPres + votesRepPres`; county path was the source of inflated total. User should re-run "Calc Party %" for TX to refresh district-party cache; optionally re-run tract party persistence for 2024 to refresh tract cache with two-party county allocation.
