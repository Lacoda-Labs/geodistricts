---
name: ""
overview: ""
todos:
  - id: todo-1771130081881-2d3ojxick
    content: option 4
    status: completed
isProject: false
---

# Bridge Tracts and Move-Isolated Rules (AZ 002104/002105)

## User constraints (latest)

1. **Bridge tract scope**: Bridge tract detection must **only consider tracts from the original parent DG** (the sibling is the other half of the same parent division). Do not look outside the parent DG—that would create problems. Current implementation already uses sibling group from `sibling_DG` / division metadata; document and keep this.
2. **Balancing when swapping**: When isolated tracts or bridge tracts are swapped (move to sibling or move bridge into isolated group), balance by:
  - Building a **sorted list of tracts that have an adjacent tract that borders the sibling_DG** (i.e., boundary tracts in the current group that touch the sibling).
  - From that list, select a tract (or set of adjacent tracts) whose **population closely matches** the population of the tract(s) being swapped.
  - Use that selection as the compensating move (move from target back to source, or when moving a bridge, choose which tract(s) to move from sibling to isolated group for balance).

---

## Current behavior (confirmed)

### Isolation group has no minimum size

- **"Isolation group"** = set of isolated tract IDs for one DG (`isolatedTractsByGroup`: groupIndex → Set of isolated tract IDs). No minimum; 1 or 2 tracts qualify. Bridge detection runs for every such group.

### Bridge tract scope (parent DG only)

- Bridge candidates are **only** from the **sibling group** (other half of the same parent division). Sibling is determined by `tract.properties.sibling_DG` or `divisionLines`. Implementations must not consider tracts from outside the parent DG. See [backend/services/geodistrict-algorithm.js](backend/services/geodistrict-algorithm.js) `detectBridgeTracts` (sibling group lookup and “ONLY looking for bridge tracts in sibling group”).

### Bridge filter (≥10 relaxes only)

- `isLargeIsolation = isolatedCount >= 10` only relaxes which candidates are included; it does not gate whether bridge detection runs. For small isolations (e.g. 2 tracts), candidates need `willHelpConnect` (neighbor in isolated group’s main component + adjacent to ≥1 isolated).

### Move isolated does not yet do compensating move

- Only isolated tracts are moved to sibling; no tract is moved from target back to source. Spec Known gaps (§9) note no rebalancing step.

---

## Recommended plan (spec + implementation)

### 1. Spec: Bridge tract scope and balancing rule

- **[doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md](doc/pages/TRACT_ISOLATION_SPEC_AND_IMPLEMENTATION.md)**
  - **§5 Bridge tract detection**: State explicitly that bridge tracts are **only** considered from the **sibling group of the same parent DG**; do not consider tracts outside the parent DG.
  - **§6 Moving isolated tracts / §7 Moving bridge tracts**: Add requirement for balancing when swapping:
    - When moving isolated tracts to the sibling (or when moving bridge tracts into the isolated group), perform a compensating move to preserve population balance.
    - **Candidate set**: Tracts in the group that **have an adjacent tract that borders the sibling_DG** (boundary tracts). Build a sorted list (e.g. by population or by |population − swapped_tract_population|).
    - **Selection**: Choose a tract, or a set of adjacent tracts, whose combined population **closely matches** the population of the tract(s) being swapped.
    - Move the selected tract(s) in the opposite direction (from sibling to source when we moved isolated to sibling; or from isolated group to sibling when we moved bridge into isolated group—depending on which “swap” is being done). Document that this may be “one tract for one tract” or “multiple adjacent tracts to match one large swapped tract.”

### 2. Implementation: Compensating move with balance selection

- In **move-isolated** path (`_moveTractsToGroup` / `moveIsolatedTractsToOppositeGroup` or move-all-isolated):
  - After moving isolated tract(s) from source group to target (sibling) group:
    - In the **target** group, build the list of tracts that have at least one neighbor in the **source** group (i.e., border the source/sibling_DG from the target’s perspective). Sort by e.g. |population − sum(moved tract populations)|.
    - Select one tract, or a minimal set of adjacent tracts, whose total population closely matches the total population of the moved isolated tract(s), and that would not create new isolation in the target if removed (e.g. still connected to target’s main component).
    - Move the selected tract(s) from target to source; swap `tract_DG` / `sibling_DG`; update group stats.
- In **move-bridge** path (`_moveBridgeTractsToGroup` / `moveBridgeTractsAndRecheck`):
  - When moving bridge tract(s) from sibling into the isolated group, optionally balance by selecting from the **isolated group** a tract (or set of adjacent tracts) that borders the sibling_DG and whose population closely matches the moved bridge tract(s), then move that selection to the sibling. (Same idea: sorted list of boundary tracts, pick by population match.)

### 3. Implementation: Keep bridge detection within parent DG

- No change to scope: `detectBridgeTracts` already restricts to sibling group. Add an assertion or comment that sibling must be from the same parent division; reject or ignore any request to consider tracts outside the parent DG. Document in code and spec that “parent DG” means the two groups that result from one division (e.g. DG6-7 split into DG6-6 and DG7-7); bridge candidates only from the sibling of the isolated group.

### 4. Optional (reverted)

- ~~Prefer bridge move for small isolations when it preserves balance.~~
- ~~Relax bridge filter for very small isolations (e.g. ≤2)~~ — reverted per user request; bridge filter again requires willHelpConnect for all non-large isolations.

---

## Implementation order

1. **Spec**: Document (a) bridge tract scope = parent DG only, (b) balancing rule: sorted list of tracts bordering sibling_DG, select tract(s) with population closely matching swapped tract(s).
2. **Implementation**: Add compensating move in move-isolated path using boundary-tract list and population-match selection; then mirror logic for move-bridge if desired.
3. **Implementation**: Confirm bridge detection never looks outside parent DG (comments/tests only if already correct).

