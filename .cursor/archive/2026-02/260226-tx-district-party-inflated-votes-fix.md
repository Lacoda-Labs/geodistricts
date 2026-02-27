# 260226

## 1200 TX district party inflated votes fix

### Prompt

Fix TX (and all states) inflated district party vote counts

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

### Response / actions

Plan: [.cursor/plans/tx_party_data_inflated_votes_fix_054b1f8b.plan.md](.cursor/plans/tx_party_data_inflated_votes_fix_054b1f8b.plan.md)

✅ **IMPLEMENTED**: Inflated district party vote counts (e.g. TX showing 30M–172M votes per district) were caused by summing tract party data for every entry in `censusTractIds`, which can contain duplicate GEOIDs. Fixed by aggregating votes per unique tract ID only.

- Added `uniqueTractGeoids(tractIds)` helper in [backend/index.js](backend/index.js) that returns unique 11-digit GEOIDs from a raw tract ID list.
- Updated `runDistrictPartyJob`: build `uniqueGeoids` from `tractIds` via the helper, then sum `votesDem` / `votesRep` / `totalVotes` only over `uniqueGeoids`.
- Updated POST `district-party-for-group` handler: same logic—derive `tractIds`, then `uniqueGeoids = uniqueTractGeoids(tractIds)`, then sum once per GEOID.

No API or frontend changes. After deploy, re-run the district-party job for TX (and any other state with bad totals) to refresh cached district party data.
