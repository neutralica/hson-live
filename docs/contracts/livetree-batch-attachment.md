# LiveTree atomic batch attachment contract

The internal atomic forest attachment primitive exists so generic projection engines can commit many already-constructed `LiveTree` branches without repeating a full target-tree validation and DOM insertion for every row. It is exported only from `hson-live/diagnostics` under an underscore-prefixed name for deterministic contract tests; ordinary applications should use public `LiveTree` and projection APIs.

## Ownership

The target and every incoming branch must be active and namespace-compatible. Incoming roots must be detached, uniquely owned, absent from the target subtree, and free of node or QUID conflicts. Validation scans the target once and each incoming subtree once. A successful commit inserts roots in caller order at the normalized index, transfers graph ownership to the target content container, adopts the target host root for every branch, and preserves each branch's managed listeners, CSS, QUIDs, DOM identity, and terminal disposal behavior.

Detaching and reinserting a successfully attached branch continues to reuse its physical projection. The primitive does not clone rows, create alternate DOM authority, or weaken single-parent ownership.

## Atomicity and failure

All validation completes before mutation. When a target has a live DOM projection, incoming DOM is projected into a detached `DocumentFragment` before graph ownership changes and is committed with one host insertion. Validation failure throws `LiveTreeBatchError` with `LIVETREE_BATCH_VALIDATION_ERROR_CODE`; projection or commit failure uses `LIVETREE_BATCH_ATTACHMENT_ERROR_CODE`.

On failure, the operation removes any DOM inserted by the attempt, releases graph claims, restores the target's prior HSON content, and removes mappings created by the failed projection. The incoming branches therefore remain detached and reusable, and the target retains its prior children and ordering. Attachment is synchronous: there is no partial scheduled registration, stale work, cancellation window, or source-replacement interleaving point.
