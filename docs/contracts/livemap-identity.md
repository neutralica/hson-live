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

Replacement correspondence is internal, operation-relative identity evidence.
Public content replacement accepts only target, index, and replacement content;
public graph instructions and Locus replacement actions reject a `lineage` field.
Ordinary replacement retires displaced identities, even for equal markup.
Automatic reconciliation can derive survival from existing owner-held exact
identity evidence. Hosted client effects carry that correspondence and QUID-free
content; the receiving runtime applies its own overlay, never sender QUIDs.

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

Portable capture and authority persistence transfer application state without
generated identity. Explicit same-epoch capture alone can restore local exact
identity after owner and epoch provenance is verified.

### Disposable portable subject correspondence

The existing document Library `quads` envelope carries sorted, one-to-one
subject associations. An authored association remains exactly `{ name, path }`.
An explicitly disposable association is `{ name, path, disposition:
"disposable" }`, where `name` is one underscore followed by the exact existing
nine-character runtime QUID payload. The own disposition field is the evidence;
an authored `_123456789` name remains authored. No Hson grammar or canonical
document field changes.

The internal aggregate `projectDocumentCorrespondence(library, quids)` operation
resolves requested identities through the current Library-owned overlay. It
keeps all ordinary authored exports and prefers an existing authored name for a
requested subject. Anonymous subjects receive disposable records without
issuance, graph mutation, or registry installation. Complete candidate
validation rejects collisions with authored names, including unrequested
subjects, rather than renaming a payload. Inactive, retired, foreign, and
incoherent subject claims fail. Movement and internally established replacement
correspondence are resolved from the current overlay, not captured old coordinates.
When pairing projected records with a graph capture, an enclosing aggregate
capture fence must cover both operations.

Portable admission validates all associations against eligible ordinary
elements, then stages fresh identities through the receiving owner's existing
allocator and installation fences. Incoming disposable payloads are excluded
from reconstruction issuance within their Library; their spelling conveys no
runtime identity authority. Only authored names enter the receiving QUAD
registry. Ordinary capture exports those authored bindings unchanged and drops
disposable names. A subsequent requested projection uses current receiving
QUIDs, so it cannot resurrect a prior runtime's disposable name.

The internal `restorePortableLibrariesWithCorrespondence(snapshot)` operation
returns a frozen association list qualified by Library identity and Library
name, with incoming name, explicit disposition, receiving QUID, and admitted
path. This detached result is not installed in Library state. Its
`assertCurrent()` fence must pass before an operation-local consumer uses it;
graph, identity, registry, authority changes and publication reentrancy invalidate
it. Standard public restoration also reconstructs fresh subjects but does not
retain or expose disposable addresses. Same-runtime exact capture continues to
use its existing private overlay provenance.

This synchronous translator is only one part of hosted correspondence. Current
flat/scoped hosted effects and continuation add authenticated receiver evidence,
ordering, and invalidation across replay, reconcile, topology changes, retirement,
and new incarnations. They never use sender QUID bytes as receiver authority.
See [CSS correspondence](css-identity-translation.md) and
[continuation](../document-continuation.md). Public local capture/cut still reject
scoped Part documents; the public hosted route is authorized `session.now()`.

Legacy history and snapshots may contain `ensure-quid`, `$_meta.quid`, identity
epochs, issued ledgers, and QUID witnesses. Replay validates those exact
claims internally, but an ordinary new runtime identity demand produces no
`ensure-quid` graph or authority operation. Client snapshots contain no Locus
identity epoch or issued ledger. Generic authority progress handles old
identity-only revisions and any future effect-free replica revisions.

## Public surfaces

The public identity handles, `LiveTree.quid`, `find.byQuid`,
`document.byQuid`, CSS QUID selectors, and resource ownership remain in place.
There is no public manual identity transaction API. The intentional observable
change is that generated-QUID acquisition no longer increments `map.rev` or
publishes an application commit.
