# Experimental Document LiveMap → LiveTree binding

This internal proof binds one `ElementLiveMap` to one separately owned,
detached `LiveTree`. The Document LiveMap remains the only canonical document
authority. Canonical attribute and raw structural-content commits project
synchronously into the LiveTree graph and its mounted DOM; public attribute
mutations on registered projected nodes delegate back to the map before
projection.

Canonical raw document paths are the complete operational correspondence key.
Persisted QUIDs are preserved and asserted when present, but remain optional.
Projection uses a narrow internal final-state attrs writer and never calls the
public delegating `tree.attrs` surface.

The proof supports `set-attr`, `remove-attr`, `replace-attrs`, `insert-content`,
`remove-content`, `move-content`, and `replace-content`. Structural operations
use physical `$_content` slots rather than LiveTree's effective-child view.
Moves preserve projected node and mounted DOM identity. Compatible same-QUID
replacement roots are reused locally; this is deliberately bounded and is not
a generalized reconciliation algorithm.

Selected public mutations delegate only where their existing semantics map to
one exact canonical operation. The binding performs no optimistic projected
write; the normal commit projector remains the sole graph/DOM update path.

| LiveTree method/category | Bound behavior | Canonical mapping | Limitation |
| --- | --- | --- | --- |
| `attrs.*`, `id`, `classlist`, `data` | delegated | existing document attrs operation | ordinary attrs only |
| `text.set` | conditionally delegated | one `insert-content` or `replace-content` | requires empty content or one `_hson_elem` bucket with at most one text leaf |
| `text.add` | conditionally delegated | one `insert-content` | requires empty content or one `_hson_elem` bucket |
| `text.insert` | conditionally delegated | one raw-index `insert-content` | requires empty content or one `_hson_elem` bucket |
| `empty` | conditionally delegated | zero operations when empty, otherwise one `remove-content` | requires at most one physical content slot |
| nested `remove` / `removeSelf` | delegated | one parent-path `remove-content` | document root removal is forbidden |
| `text.overwrite` | rejected | none | complete destructive replacement has no exact one-call mapping |
| `removeChildren` | rejected | none | effective-child selection and detach lifecycle differ from canonical removal |
| `detach`, `detachContents` | rejected | none | reusable identity-preserving results conflict with canonical deletion |
| `append`, batch append, `create.*` | rejected | none | creation/effective placement occurs before a single canonical equivalent exists |
| move/reparent | rejected | none | no exact cross-parent map operation exists |
| local/runtime APIs | local | none | do not represent canonical document state |

Compatible authoritative and replayed `replace-root` commits are also
supported when the ordinary root tag, namespace, and canonical persisted-QUID
state remain unchanged. The binding retains the same `LiveTree`, projected root
object, mounted root element, and projection-local root QUID. Complete root
attrs and content converge through internal projection machinery, followed by
one correspondence rebuild. Compatible same-QUID descendant reuse remains
bounded to cases proven by the structural replacement planner.

Root tag or namespace changes and persisted root-QUID introduction, removal,
or change intentionally fail closed. The binding does not replace its root
façade or physical root DOM element.

Snapshot restore observations synchronously recapture exactly one complete
`map.capture()`. The captured revision must equal the observed snapshot
revision; the binding never retries, captures a later state, or skips an
intervening revision. Compatible snapshots use the same root planner and
application transaction as `replace-root`. Capture, revision, compatibility,
or projection failure remains observer-isolated and fails the binding.

Rejected delegation attempts do not fail an otherwise healthy binding.
Incompatible root replacement, incompatible snapshots, and unsupported changed graph
commits do fail the binding, stop commit consumption, and leave canonical state authoritative.
Disposal removes the subscription and node registrations while leaving the
projected tree and DOM intact; ordinary unbound mutation behavior then resumes.

The binding is not exported as a stable public API. It does not support
fragments, incompatible physical root replacement, DOM adoption, SSR, hydration,
or reconciliation of external DOM mutations.
