# QUID scale and namespace proof

## Prerequisite status

Unit 12 stopped before the million-node and namespace proof after deterministic
tests found same-owner-epoch QUID reuse: a retired document or projected handle
could reactivate when its byte string was allocated to an unrelated node.

The LiveMap portion of Unit 12P establishes one-QUID-per-identity-lifetime
within an exact owner epoch.
The active sparse overlay retains current claims `Q`; a monotonic issued ledger
retains all admitted or allocated values `I`, including retired claims. Thus
`Q <= I`, active storage remains `O(Q)`, and the additional retained namespace
state is `O(I)`. A fresh owner epoch fences old handles and seeds a new issued
ledger from its admitted active graph.

The standalone LiveTreeRuntime audit reached the specified stop condition.
Terminal restoration deliberately re-admits serialized QUID bytes after
disposal, while the current public input carries no provenance that can
distinguish restoration from unrelated same-runtime reuse. A narrow runtime
ledger breaks supported consumer behavior, so Unit 12P is not complete and Unit
12 remains blocked pending a separate LiveTree provenance/restoration design.

Any resumed Unit 12 proof must use `I`, not `Q`, as allocator occupancy and must
measure its retained strings across acquire/retire workloads. Unit 12P includes
only bounded deterministic lifecycle evidence; it does not perform the
million-node benchmark, choose a shorter encoding, or make a namespace
recommendation.
