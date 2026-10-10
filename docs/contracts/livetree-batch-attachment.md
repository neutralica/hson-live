# LiveTree atomic batch attachment contract

The internal atomic forest attachment primitive exists so generic projection engines can commit many already-constructed `LiveTree` branches without repeating a full target-tree validation and DOM insertion for every row. It is exported only from `hson-live/diagnostics` under an underscore-prefixed name for deterministic contract tests; ordinary applications should use public `LiveTree` and projection APIs.

## Ownership

The target and every incoming branch must be active and namespace-compatible. Incoming roots must be detached, uniquely owned, absent from the target subtree, and free of node or QUID conflicts. Validation scans the target once and each incoming subtree once. A successful commit inserts roots in caller order at the normalized index, transfers graph ownership to the target content container, adopts the target host root for every branch, and preserves each branch's managed listeners, CSS, QUIDs, DOM identity, and terminal disposal behavior.

Detaching and reinserting a successfully attached branch continues to reuse its physical projection. The primitive does not clone rows, create alternate DOM authority, or weaken single-parent ownership.

## Atomicity and failure

All validation completes before mutation. When a target has a live DOM projection, incoming DOM is projected into a detached `DocumentFragment` before graph ownership changes and the complete prospective receiver is checked by the native realization planner.
Native reconciliation precedes final identity and historic-context publication. The single-branch and batch paths use the same structural and placement checks.
Element insertion cannot reinterpret an existing data relationship or place a
data-mode branch under ELEM. Repeated subjects and overlapping incoming forests
reject; fresh source value sharing is materialized independently before ownership.

Batch validation failure throws `LiveTreeBatchError` with `LIVETREE_BATCH_VALIDATION_ERROR_CODE`; projection or commit failure uses `LIVETREE_BATCH_ATTACHMENT_ERROR_CODE`.

On failure, the operation removes any DOM inserted by the attempt, releases graph claims, restores the target's prior Hson content, and removes mappings created by the failed projection. The incoming branches therefore remain detached and reusable, and the target retains its prior children and ordering. Attachment is synchronous: there is no partial scheduled registration, stale work, cancellation window, or source-replacement interleaving point.

Factory batches use privately routed candidates. Native reconciliation precedes
identity publication, and new QUID attributes are installed only after internal
claim publication succeeds. Failure retires rejected candidates without notifying
realization observers. Existing incoming identities, off-document native parentage
and pinned historic context survive rejected attachment.

Operation-local identity plans release new active claims on rejection, preserving
prior active claims and routing. Genuinely unobservable provisional issuance may
be retracted. Before native identity publication can expose the completed graph
to callbacks or MutationObserver records, the complete plan's issued history is
made permanent for that runtime, even if a later native write fails. Exposed
values cannot be reused for another subject; retaining history does not retain
active ownership of rejected candidates. After all
identity and handle-context publication succeeds, realization listeners receive
one post-commit notification. Their errors are separately reported and cannot
turn successful attachment or factory completion into rejection.

A private publication guard protects the receiver and incoming subjects before
native staging, through publication and rollback. Conflicting synchronous writes
through aliases, descendants or ancestors reject before effects; independent
ownership regions remain usable. The guard releases before post-commit observers.
Acquiring an absent QUID is a write, while existing identity and graph/DOM reads
remain available. No rejected nested operation is queued or reported successful.
