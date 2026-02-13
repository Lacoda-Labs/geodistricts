# 251030 vibe session

our goal tonight is to debug the geo-graph-traversal.findNextStartingTract tract by tract to find a realiable algorithm for the zig-zag adjacency-based sorting of census tracts along latitude or longitude directions so that when dividing the sorted list of tracts using a given ration, the district group has all adjacent tracts, (i.e. there are no isolated tracts in the group, all tracts are contiguos within the district group)

test case:  
state=AZ  
districts=6  
algorithm=geo-graph (see 251014-brown-s4-adjacency-tracts-algorithm.md and geo-graph-traversal-algorithm-spec.md)  
adjacency: brown-s4 data

iteration 1:  (divide by latitude)
lat sort all the state census tracts
divide the first and only district group (DG) which contains districts 1-6 and is lat sorted.
result is two district groups; group 1 has districts 1-3, group 2 has districts 4-6

iteration 2: (divide by longitude)
sort the census tracts in each DG-1 and DG-2 by longitude
divide DG-1 and DG-2 by 1/ ratio
result is four district groups; DG-1 has district 

## step 1: starting with iteration 1 lat sort

### algorithm testing getting northwestern tract
(sorting by latitude)
using geo-graph algorith, find the most northwestern census tract for the given state.   

### ui changes
update the tract-debug page to default state selection to AZ and sorting algorithm default to geo-graph, and auto-select the first tract on the map

### expected results
tract-debug page has census tract Tract: 950101 (04015950101) selected

#### TEST PASSED

## step 2: find the most northeastern adjacent tract to 950101

### algorithm testing finding the most northeastern adjacent tract to tract 950101
the current alogorth selects Tract: 002000 as the most northeastern adjacent tract.
however, it should calculate tract 950103 as next adjacent tract to 950101 as it is east of 00200. so it seems the bug is that the prompt/spec should be more specific. what should happen is the line 259 `biasedDirection = 'northeast'; // East movement with north bias`
maybe a better way is to start at direct north and move clockwise. thoughts? if this makes sense, go ahead and update the code.

### ui changes
add a button labeled "findExtremeAdjacentTract" which when clicked calls the `findExtremeAdjacentTract` function and displays result. (helps to debug)

### expected results
on tract-debug page, with tract 950101 selected, 
1. clicking findExtremeAdjacentTract button displays tract 950103.
2. clicking "Next Tract →" button, Tract: 950103 is selected.

#### TEST IS FAILING

#### step 2 debug session
tract 950103 is Tract 1643 of 1765 (far from 2 of 1765). 
i suspect biasedDirection = 'northeast' could be a problem. 
what if we rethink the idea of finding the most northeastern adjacent tract as the next tract in the sorting. instead, selecting the next adjacent tract uses the clockwise approach where a line is drawn from selected tract geometric midpoint (not centroid, which is biased by vertex distribution). Starting direction depends on sort direction: for latitude sort start at north (0°) and move clockwise; for longitude sort start at west (270°) and move clockwise. The first adjacent tract encountered as the line sweeps clockwise is returned.
however, first step is to debug the centroid. 
tract 950103:
Centroid:(36.5209, -112.8927)
North Boundary:37.0002
South Boundary:35.7508
East Boundary:-112.5965
West Boundary:-114.0506
why is long so close to the east boundry?

ok, so centroid is the arithmetic mean of all boundary vertices.
let's try using the geometric midpoint (updated above) to update `findExtremeAdjacentTract` to use clockwise approach. note that starting direction may need to changee depending on sort direction, e.g. when sorting by long starting west and sorting adjacent tracts clockwise

#### TEST PASSED
changed to use clockwise line intersection to select next adjacent tract. 

## next session, on to step 3 