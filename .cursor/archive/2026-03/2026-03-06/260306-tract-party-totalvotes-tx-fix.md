# 260306

## 1400 tract party totalVotes storage, TX fix

### Prompt

where is party per tract data stored, is it currently stored, what needs to be done to store if not done

(later) confirm totalVotes is for county not tract in TX json file. will running POST /api/algorithm/tract-party-persistence with year (e.g. 2024). update totalVotes to be for tract? or is it ok to leave as county? where is totalVotes used?

(run POST) run POST /api/algorithm/tract-party-persistence

(TX not updated) TX json not updated

(totalVotes still county) @data/census-cache/tract_party_TX_2024.json see TX json, totalVotes still county

### Response / actions

- **Where stored:** Tract party is stored under cache key `tract_party_{STATE}_{YEAR}`. Local: `data/census-cache/tract_party_{STATE}_{YEAR}.json` (and `.meta.json`). Production: Firestore `census_cache` + Cloud Storage for large docs. Stored only after running the persistence job (POST or script).
- **totalVotes in TX:** Confirmed TX file had county-level (and full-ballot) totalVotes repeated per tract; percentages already used two-party (votesDem+votesRep) in backend.
- **Persistence fix:** In `backend/services/tract-party-persistence.js`, when building payload, set `totalVotes = votesDem + votesRep` for every tract so stored data is always two-party regardless of source.
- **In-place fix:** Added `backend/scripts/fix-tract-party-totalvotes.js` to read a tract_party JSON, set `totalVotes = votesDem + votesRep` per geoid, and write back. Ran for TX 2024: fixed 6,883 tracts; `tract_party_TX_2024.json` now has two-party totalVotes (e.g. 33475 instead of 64289 for that county).
- **Usage:** totalVotes is summed for district/group and used for display (e.g. tooltip “D xx% · R yy% · N votes”); percentages use two-party total only.

✅ **FIXED**: TX tract party file now has tract-level two-party totalVotes. Other states/years can be fixed with `node backend/scripts/fix-tract-party-totalvotes.js <STATE> <YEAR>`.
