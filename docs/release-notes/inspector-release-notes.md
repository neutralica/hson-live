Patch 7C completes the "Inspector" projection refactor begun across the preceding six stages. Inspector rows now form a retained keyed projection rather than a repeatedly reconstructed view. Compatible updates preserve row QUIDs, expansion state, selection, keyed array identity, and renderer-local state while limiting work to the affected structural region.

The source traversal path was also tightened. Collection adapters now pass immediately available values through the materialization step, collapsed interiors remain lazy, ordinary commits avoid serialization, and diagnostics expose source reads and projection record activity. Large keyed arrays and large property maps now have explicit regression and performance coverage.

The patch also closes lifecycle and typing gaps: schema-bound LiveMaps are accepted through a read-oriented inspector source contract; observer and renderer failures remain non-fatal; source replacement preserves compatible branches and reports classified failures; and disposal consistently releases owned view and listener resources.

⸻