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

Unit 12T resolves the standalone LiveTreeRuntime stop under the explicitly
approved Candidate B contract. Each runtime now retains lifetime-issued `I`;
terminal disposal removes the active claim but ordinary supplied admission and
allocation cannot reuse its bytes. No restoration-provenance exception exists.
Equal bytes are admitted only in a fresh runtime lifetime. Raw runtime lookup is
therefore absent after retirement and cannot retarget in the same runtime.

The resumed Unit 12 proof must use `I`, not `Q`, as allocator occupancy and must
measure its retained strings across acquire/retire workloads. Units 12P and 12T include
only bounded deterministic lifecycle evidence; it does not perform the
million-node benchmark, choose a shorter encoding, or make a namespace
recommendation.
