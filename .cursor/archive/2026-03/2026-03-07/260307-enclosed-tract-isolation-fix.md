# 260307

## 1200 enclosed tract isolation fix (TX 48409011100)

### Prompt

see screenshot. tract 48409011100 should be excluded from isolation because it is an enclosed tract. in fact, step 0 is supposed to group enclosed tracts with its enclosing tract and hide it (i.e. not include) from sorting or division, and instead follow its enclosing tract. identify root cause of bug where this enclosed tract is showing in list of isolated tracts TX step 1 and fix.
also review update to GDIP-004 3.3 covering isolated tracts and verify it makes sense and is consistent with prior chats and implementation.

### Response / actions

Plan: enclosed tract isolation fix (created this session; see `.cursor/plans/` or project plans for `enclosed_tract_isolation_fix_4134c20e.plan.md`).

- **Root cause:** `detectIsolatedTracts` in backend excludes only `step0IslandTractIds` at steps 1+; it does not exclude tracts with `ENCLOSED_BY`. Enclosed (donut-hole) tracts often have no S4 adjacency to their enclosing tract, so they form a 1-tract component and are reported as isolated.
- **Fix (planned):** In `backend/services/geodistrict-algorithm.js` `detectIsolatedTracts`, build a set of enclosed tract IDs from current step (tracts with `ENCLOSED_BY`), and at steps > 0 remove those IDs from `groupIsolatedTractIds` after removing island IDs. No API or frontend change.
- **GDIP-004:** §3.1.1 and §3.2 require enclosed tracts to be “allowed” and excluded from isolation; §3.3 (resolution) is consistent. Optional doc update to TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md to mention excluding ENCLOSED_BY tracts.

No code changes made (plan mode). User may approve plan to implement.
