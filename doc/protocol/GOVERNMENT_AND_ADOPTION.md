# GeoDistricts Protocol: Government Research and Adoption

This document outlines considerations for **government research and exploratory use** and for **adoption and codification** of the GeoDistricts Protocol (e.g. state legislation or commission rules). It does not provide legal or policy advice.

## Research and Exploratory Use

- **Academic and pilot use**: Researchers, state agencies, and nonprofits may use the protocol (or the reference implementation) to:
  - Compare algorithmically generated districts with current enacted maps (population variance, contiguity, partisan balance).
  - Study the effect of objective, geography-based redistricting on representation and fairness.
  - Publish results, subject to their institutions’ and funders’ requirements.
- **Data and reproducibility**: Use required data sources (Census population, TIGER/Line boundaries, district counts) per GDPIP-002 so that results are reproducible and comparable across studies.
- **Attribution**: When publishing or presenting, attribute the GeoDistricts Protocol and, if applicable, the reference implementation (e.g. link to the protocol repo and/or [geodistricts.org](https://geodistricts.org)).

## Adoption and Codification

- **State legislation or commission rules**: A state may adopt the GeoDistricts Protocol by reference (e.g. “redistricting shall follow the GeoDistricts Protocol, version X,” or “districts shall be generated using the algorithm specified in GDPIP-003”). Implementers and legislators should:
  - Reference the protocol by **version or release tag** (e.g. “Protocol 1.0” or the set of GDPIPs in effect at adoption) so that updates to the protocol do not automatically change state law unless the state chooses to update the reference.
  - Use the official protocol repository (when it exists) as the canonical source of the spec; the reference implementation (this repo) demonstrates one conforming implementation.
- **Legal and statutory considerations**: GeoDistricts does not opine on the Voting Rights Act (VRA), state constitutions, or other legal constraints. Adopting jurisdictions should ensure that use of the protocol complies with applicable law (e.g. VRA, state equal-population and contiguity requirements). The project’s existing documentation (e.g. [GeoDistrictsProjectOverview](../GeoDistrictsProjectOverview.md)) notes assumptions regarding VRA and census objectivity; those are project assumptions only, not legal advice.
- **Transparency**: Adoption is most credible when the protocol version and data sources are public and when geodistrict boundaries and (if applicable) comparison metrics are published for review.

## Summary

- **Research**: Use the protocol or reference implementation for studies and pilots; cite the protocol and use required data sources for reproducibility.
- **Adoption**: Reference the protocol by version in law or rules; rely on the protocol repo for the canonical spec; ensure compliance with applicable law (VRA, state law).
- **Caveats**: This doc is for consideration only; it is not legal or policy advice.
