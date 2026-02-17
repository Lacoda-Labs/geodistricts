# 260216

## 1200 two-mode architecture evaluation

### Prompt

one of the challenges with the current architecture is the client reliance on the backend. the client often sits blind waiting for the backend to process requests that break up the algorithm into atomic steps. the caching and initialization of each step adds an addition layer of complexity when trying to execute an already complex algorthm.
originally the client had all the algorithm implementation and it was refactored to move all algorithm logic to the backend. agents agreed this was a better architecture. however, considering that algorithm calculations are only necessary when building state geodistricts, and that once final geodistricts are calculated, the backend just needs to manage state (at the step level and final state) so that users can visualize the steps and final geodistricts maps and party comparisons. algorithms only need to be run while building, and testing the algorithm steps. once the algorithm is complete, executing the algorithm for each state and storing step state will be done only during development of algorithm improvements/enhancements and bug fixes.
in this way, there are really two modes: development and visualization.
the client should support both modes. the visualization client is thinner, calling backend endpoints only to retrieve step state. development mode has the algorithm logic client side and is most often run locally (vs deployed to gcp).
with that, the current maps pages can be used for the visualization mode, and a new /dev/maps page should be created that contains the logic necessary to run the algorithm in the client. dev mode should still use shared endpoints common to both modes, mostly to fetch state/data, e.g. source data (census,tiger, s4, etc), and step data as needed (e.g. in between steps during dev).
algorith steps such as isolation detection, bridge detection, balancing, initial step 0 steps, etc can largely be done client side, saving state to backend as needed.
evaluate this new architecture and provide recommendations based on pros/cons based on complexity, performance, support for both modes, etc. note that was the algorithm development is able to meet the geodistrict goals (equally balanced, contiguous as possible districts), the public marketing campaign to evangelize the protocol can begin and the major server load will be from users visualizing the results, and stepping through division steps to understand/see how it works. the visualization mode be very performant, even on mobile, so smaller payloads (e.g. union polygons) will be important. consider all these things when drafting a plan and providing analysis and recommendations.

### Response / actions

Plan: [.cursor/plans/two-mode_architecture_evaluation_53ac5490.plan.md](.cursor/plans/two-mode_architecture_evaluation_53ac5490.plan.md)

- Evaluated current architecture: backend holds full algorithm (~4.7k LOC), frontend orchestrates via execute/step-by-step/next-step and latlong/divide; "local" next step still calls backend for division.
- Documented two modes (Visualization: GET-only step state; Development: algorithm client-side, shared data endpoints) with pros/cons and shared-endpoint list.
- Recommended formalizing visualization on `/maps` (hide run controls when precomputed data exists; step-through via getStep only); adding `/dev/maps` with Option A (keep backend execution, show per-step progress) to avoid algorithm port; optional `polygonsOnly` and step-list endpoints for mobile.
- Recommended deferring full client-side algorithm port (Option B) unless backend execution becomes a blocker.
