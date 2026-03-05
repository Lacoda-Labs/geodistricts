# how to create union polygons
using sorted tracts of DG
- start with first tract
- using s4 get adjacent tracts, merge in order of s4 adjacency
    - as tracts are merge they are added to Set of merged tracts
    - if merge fails, a new subset of union polygon is started, continuing same s4 merge sequence. 
    - if no more adjacent tracts left to merge, then continue by selecting next unmerged tract from sort DG tracts.
    - repeat process until no more single tracts have been attempted to be merged.
- once all single tracts from sorted DG tract list have been attempted to be merged, the result should be a list of the main merged union polygon and zero or more subset union polygons. attempt to merge subset polygons with each other and finally to the main polygon.
- the final result is one of more union polygons for the given DG. the ability to support multiple union polygons per DG is required as islands and other geographically isolated tract groups can exist.
- sequential-union fallback (when dissolve is not used): when a tract fails to merge (turf.union returns null or throws), do not drop the tract. treat the current union as a completed part, then start a new part with the failed tract. the result is multiple parts and must be output as a MultiPolygon (or an array of features for the caller to combine).