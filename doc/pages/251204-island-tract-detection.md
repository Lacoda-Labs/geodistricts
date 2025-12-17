As part of Step 0, detect isolated tracts, which at this step 0 should be considered island tracts and excluded from isolation tract detection. for states such as HI with many real geographic islands, make sure the tracts with the largets reachable tracts are not considered an island tract grouping/component.

Here are isolated CA tracts after step 0. these should be considered island tracts.
Isolated Tracts (5)
Tract ID	Group
06037599000
Districts 1-52
06037599100
Districts 1-52
06075980401
Districts 1-52
06083980100
Districts 1-52
06111980000
Districts 1-52

After detecting island tracts, a DG polygon needs to be a set of polygons with the main (largest adjacency), and 0 or more island polygons. 