# LiveMap runtime identity contract

Generated QUIDs identify subjects inside one living runtime. A path is the durable
application and system coordinate. A generated QUID is not a portable application
address, network address, or persistence identity. Ordinary portable Hson,
JSON, Binary, HTML, node/graph constructors, and Transform admission reject
incoming generated-QUID claims. Portable serialization omits them.

## Ownership and acquisition

One LiveMap owns the QUID-to-path overlay, identity epoch, and issued ledger for
all of its application Libraries. Document and projected/data overlays are
sparse. An ordinary document element or a semantic data object or array can
acquire identity only on explicit demand. Passive reads, traversal, selection,
Mirror construction, and continuation do not mint QUIDs.

An acquisition is a synchronous, map-owned runtime identity transaction. It
validates the current subject and path, checks map-wide active and issued
collisions, stages the next overlay and issued ledger, preflights attached Mirror
and LiveTree/DOM claims, installs the local claim, and rolls back every
participant on failure. A successful acquisition increments an internal
identity generation. It does not change the canonical application graph,
advance `map.rev`, publish an application commit, fire value or mutation
observers, or require managed authority acceptance. The same transaction
semantics apply to standalone, Locus-local, and Echo-managed LiveMaps.

LiveMap-backed Mirror, LiveTree, and DOM realize that map's local QUID. Browser
DOM may write `hson:quid` after a local demand for CSS selectors, lookup, and
resource ownership. This is local runtime metadata. A standalone LiveTree with
no backing LiveMap retains its independent runtime identity authority.

For hosted composition, Locus and Echo own separate map-local identity. Their
QUIDs may differ for the same path. Echo identity demand stays on the Echo
replica and does not send a Locus request or advance an authority revision.
Locus identity demand likewise creates no authority application revision or
Echo event.

## Graph transitions and stale preparations

Graph changes still advance the graph revision. Moves transform active QUID
paths, including descendants. Deletion and replacement without explicit
continuity retire active claims while retaining their bytes in the issued
ledger. An old handle remains inactive even if a later subject occupies the
same path. Issued QUIDs are not recycled within the same owner epoch.

Prepared graph transitions record the runtime identity generation used during
planning. An intervening local identity acquisition makes a prepared
transition stale, even when its application revision and root are unchanged.
The generation is internal and never substitutes for `map.rev`.

Replacement lineage is operation-relative path correspondence. The receiving
runtime applies its own overlay to that lineage; no receiving-runtime QUID
needs to be embedded in replacement graph metadata. Legacy exact-QUID
material can still provide a consistency oracle. If explicit lineage and
legacy evidence disagree, admission rejects atomically.

Interaction subjects remain path-based. Ordinary graph transitions maintain
interaction movement, replacement, and death together with application state.

## Document and projected storage

The map-owned overlay is authoritative for newly acquired document and data
identity. A new document demand does not add `$_meta.quid` to the canonical
node. Data identity already resides in an overlay and now uses the same
non-revisioned transaction. `document.byQuid`, data identity handles, and
stale-handle checks resolve from the current overlay and epoch without minting.
A detached exact in-memory document view may synthesize QUID metadata from
the overlay. This does not make the view a portable identity source; public
`fromNode` and Transform admission still reject its generated claims.

Strict canonical graph equality remains sensitive to graph metadata. It is
not redefined to ignore QUIDs. Runtime identity comparisons use the graph
plus the overlay and owner epoch, or a synthesized exact view.

## Capture and provenance

Exact same-runtime document capture carries local identity in an exact-object,
out-of-band overlay together with owner and epoch provenance. Copied, foreign,
mutated, or stale capabilities cannot claim same-runtime continuity. The
same-epoch graph can remain QUID-free. Projected/data capture already uses an
out-of-band identity overlay. A detached exact view may expose QUID metadata,
but ordinary portable capture and Transform output do not establish identity.

The compatibility `preserve-metadata` capture and legacy authority persistence
formats remain readable. Phase 4B0 does not change authority restart policy.
Legacy history and snapshots may contain `ensure-quid`, `$_meta.quid`, identity
epochs, issued ledgers, and QUID witnesses. Replay validates those exact
claims, but an ordinary new runtime identity demand produces no `ensure-quid`
graph or authority operation. Generic authority progress still handles old
identity-only revisions and any future effect-free replica revisions.

## Public surfaces

The public identity handles, `LiveTree.quid`, `find.byQuid`,
`document.byQuid`, CSS QUID selectors, and resource ownership remain in place.
There is no public manual identity transaction API. The intentional observable
change is that generated-QUID acquisition no longer increments `map.rev` or
publishes an application commit.
