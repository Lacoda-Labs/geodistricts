# GDIP-001: Purpose and Guidelines

**Status**: Living  
**Type**: Meta  
**Created**: 2026-01-29  
**Updated**: 2026-01-29

## Summary

This document describes what a GeoDistricts Improvement Proposal (GDIP) is, how the process works, and how to submit, discuss, and adopt GDIPs. It is the single source of truth for the protocol improvement process. GDIP-001 is a **Meta** GDIP: it defines the process, not the protocol itself.

## What is a GDIP?

A **GDIP** (GeoDistricts Improvement Proposal) is a numbered, versioned document that defines or extends part of the GeoDistricts protocol—or, as in this document, the process surrounding the protocol. GDIPs are the primary mechanism for proposing new features, collecting technical input, and documenting design decisions for objective, geography-based U.S. congressional redistricting.

For implementers, GDIPs are a convenient way to track which parts of the protocol an implementation supports. The protocol is specified so that multiple implementations can achieve the same goals: objective redistricting and a defined anti-gerrymandering outcome.

## GDIP Types

- **Meta**: Describes the process surrounding GeoDistricts or a change to that process. Meta GDIPs do not specify the algorithm or data model; they define how GDIPs are written, submitted, and adopted. Example: this document (GDIP-001).
- **Standards Track**: Describes a change or addition to the GeoDistricts protocol that implementations may or must conform to. Standards Track GDIPs are classified as:
  - **Required**: All conforming implementations MUST implement these (e.g. data model, required data sources, core algorithm).
  - **Optional**: Implementations MAY implement these; interoperability is preserved without them (e.g. demographics, comparison metrics).

A single GDIP should contain a single key proposal. The more focused the GDIP, the more successful it tends to be.

## GDIP Workflow

| Step    | Action |
|---------|--------|
| Draft   | Author creates GDIP file and PR; status = Draft |
| Review  | Community/maintainers comment; author revises |
| Accepted | Maintainer merges; status = Accepted; index updated |
| (Optional) | Protocol release tag created (see [GOVERNANCE](../process/GOVERNANCE.md)) |

- **Draft**: First formally tracked stage. The GDIP is merged into the GDIP repository when properly formatted.
- **Review**: Author marks the GDIP as ready for peer review; feedback is addressed.
- **Accepted**: A maintainer merges after a comment period (e.g. at least 7 days for required GDIPs, or as documented in GOVERNANCE). The index is updated.
- **Living**: A special status for GDIPs that are designed to be continually updated (e.g. GDIP-001). They do not reach a state of finality.

## What Belongs in a Successful GDIP

Each Standards Track GDIP should include:

- **Summary**: One or two sentences describing the proposal.
- **Motivation**: Why the change is needed; what problem it solves or what capability it adds.
- **Specification**: Technical specification detailed enough for interoperable implementations.
- **Required vs Optional**: Whether all conforming implementations MUST implement it or MAY implement it.
- **Backward Compatibility**: Whether the change is backward compatible; migration path if not.
- **Reference Implementation**: Link to the reference implementation (geodistricts repo) or files/PRs that implement the proposal.
- **References**: Links to related GDIPs, docs, or external references (e.g. Census API, TIGER/Line).

Meta GDIPs (like this one) may use a structure that fits the process being described.

## Submitting a GDIP

1. **Copy the template**: Use [process/GDIP-TEMPLATE.md](../process/GDIP-TEMPLATE.md) as the starting point.
2. **Assign a number**: Check the [GDIP index](README.md) for the next available number (e.g. GDIP-007). Open an issue to reserve the number if the repo uses issues for tracking.
3. **Create a draft**: Create a new file in `GDIPs/` named e.g. `gdip-NNN-short-title.md`. Fill in Summary, Motivation, Specification, Required vs Optional, Backward Compatibility, Reference Implementation, References.
4. **Open a pull request**: Submit a PR that adds the new GDIP file and updates the GDIP index (README in `GDIPs/`). Link to the reference implementation (geodistricts repo) or specific commits/tags where applicable.
5. **Discussion**: Maintainers and community review the PR. Address feedback; iterate. Building the protocol is iterative—each GDIP will need review and revision.
6. **Adoption**: A maintainer merges the PR after the comment period. The GDIP status is set to **Accepted** and the index is updated.

## Protocol Releases

A **protocol release** is a named set of GDIP versions (e.g. "Protocol 1.0" = GDIP-002 v1, GDIP-003 v1, GDIP-004 v1). Releases are tagged in the protocol repo (e.g. `protocol-v1.0`). The reference implementation documents which protocol version or GDIP set it follows. See [GOVERNANCE.md](../process/GOVERNANCE.md) for versioning and tagging.

## Template and Index

- **Template**: [process/GDIP-TEMPLATE.md](../process/GDIP-TEMPLATE.md)
- **Index**: [GDIPs/README.md](README.md) — lists all GDIPs with number, title, type, status, and short description.

## Reference Implementation

The [GeoDistricts reference implementation](https://github.com/Lacoda-Labs/geodistricts) implements the protocol. When submitting a GDIP, link to the implementation (file, PR, or tag) that demonstrates or will implement the proposal. The protocol repo contains specification and process; application code lives in the reference implementation.

## Versioning Note

This GDIP-001 v1 establishes the initial GDIP process and types. As a **Living** document, substantive updates (e.g., new workflow steps or types) will be made directly here and versioned. Minor clarifications (e.g., formatting fixes) do not change the version. See [GOVERNANCE](../process/GOVERNANCE.md) for versioning rules.

## References

- [Nostr NIPs](https://nips.nostr.com/), [Ethereum EIPs](https://eips.ethereum.org/) — inspiration for open protocol improvement processes (not copied verbatim).
- [GOVERNANCE.md](../process/GOVERNANCE.md) — versioning, releases, maintainers.
