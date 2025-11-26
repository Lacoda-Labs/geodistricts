# 251125-251126

continuing from .cursor/commands/251125.md

## 00:05
now add a button to run all steps, where in one POST to /api/algorithm/execute  all steps are run including resolving isolation (which first detects isolation tracts, then detects bridge tracts, then moves any bridge tracts, then moves any remaining isolated tracts). caching should be updated after each steps (just like UI stepping through each step/stage).
preserve existing manual step (prev/next) functionality. this will require changes to both FE/BE and maybe caching logic. key changes to BE are making sure the sequence to resolve isolated tracts are as stated above. confirm that that isolation flow makes sense.