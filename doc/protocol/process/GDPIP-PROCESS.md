# GeoDistricts Protocol Improvement Proposal (GDPIP) Process

This document describes how to submit, discuss, and adopt **GeoDistricts Protocol Improvement Proposals (GDPIPs)**. The process is inspired by [Nostr NIPs](https://nips.nostr.com/), [Ethereum EIPs](https://eips.ethereum.org/), and similar open protocol improvement processes.

## Overview

- **GDPIP**: A numbered, versioned specification document that defines or extends part of the GeoDistricts protocol (e.g. data model, required data sources, core algorithm, optional demographics, comparison metrics).
- **Required vs Optional**: Each GDPIP is classified as **Required** (all conforming implementations MUST implement it) or **Optional** (implementations MAY implement it).
- **Protocol releases**: A protocol "release" is defined by a set of GDPIP versions (e.g. "Protocol 1.0" = GDPIP-001 v1, GDPIP-002 v1, GDPIP-003 v1). See [GOVERNANCE.md](GOVERNANCE.md) for versioning and tagging.

## Submitting a GDPIP

1. **Copy the template**: Use [GDPIP-TEMPLATE.md](GDPIP-TEMPLATE.md) as the starting point.
2. **Assign a number**: Check the [GDPIP index](../GDPIPs/README.md) for the next available number (e.g. GDPIP-004). Open an issue to reserve the number if the repo uses issues for tracking.
3. **Create a draft**: Create a new file in `GDPIPs/` named e.g. `gdpip-NNN-short-title.md`. Fill in Summary, Motivation, Specification, Required vs Optional, Backward Compatibility, Reference Implementation, References.
4. **Open a pull request**: Submit a PR that adds the new GDPIP file and updates the GDPIP index (README in `GDPIPs/`). Link to the reference implementation (geodistricts repo) or specific commits/tags where applicable.
5. **Discussion**: Maintainers and community review the PR. Address feedback; iterate on the draft. Building and executing the protocol plan is **iterative**—each GDPIP will need review, revision, and edits.
6. **Adoption**: A maintainer merges the PR after a comment period (e.g. at least 7 days for required GDPIPs, or as documented in GOVERNANCE.md). The GDPIP status is set to **Accepted** and the index is updated.

## Process Summary

| Step | Action |
|------|--------|
| Draft | Author creates GDPIP file and PR; status = Draft |
| Review | Community/maintainers comment; author revises |
| Accepted | Maintainer merges; status = Accepted; index updated |
| (Optional) | Protocol release tag created (see GOVERNANCE.md) |

## Template and Index

- **Template**: [GDPIP-TEMPLATE.md](GDPIP-TEMPLATE.md)
- **Index**: [GDPIPs/README.md](../GDPIPs/README.md) — lists all GDPIPs, status, required/optional, and short description.

## Reference Implementation

The [GeoDistricts reference implementation](https://github.com/Lacoda-Labs/geodistricts) (or project URL) implements the protocol. When submitting a GDPIP, link to the implementation (file, PR, or tag) that demonstrates or will implement the proposal. This repo (protocol repo) contains only specification and process; no application code.
