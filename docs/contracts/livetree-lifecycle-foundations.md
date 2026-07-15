# LiveTree lifecycle foundations

LiveTree 3.0 Patch 1 defined the internal lifecycle primitives. Patch 2 now
uses them for the public lifecycle contract described below.

- `collect_subtree_nodes(root, order)` is the authoritative graph-derived
  traversal. It includes structural HSON nodes and ignores primitives.
- `detach_node_deep(root)` performs post-order runtime unmount: DOM, listeners,
  QUID-owned CSS/keyframes, lifecycle disposables, and node-element mappings are
  released while graph structure and QUID identity remain.
- `destroy_subtree_quids(root)` removes registry ownership, persisted
  `data-_quid` metadata, and mapped DOM identity attributes recursively.
- `dispose_node_deep(root)` composes runtime teardown, bounded reentrant
  disposable draining, recursive QUID destruction, and shared weak node-keyed
  disposed state. Parent graph unlinking is intentionally a caller concern.

`LiveTree.isDisposed` reads the shared node state. Public cached manager surfaces
and meaningful reads/mutations are guarded by `LiveTreeDisposedError`.

Public Patch 2 vocabulary:

- runtime-preserving `detach()` and `detachContents()` unlink graph/DOM
  ownership while preserving QUIDs, metadata, mappings, and live projections;
- terminal `remove()` disposes the calling subtree;
- terminal `empty()` disposes every content subtree while preserving its caller;
- deprecated `removeSelf()` aliases `remove()`; deprecated `removeChildren()`
  retains only its specialized legacy semantic-element filter.

LiveMap subscriptions are preserved and continue to update detached projections,
but automatic terminal ownership for those subscriptions remains Patch 3 work.
