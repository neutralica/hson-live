# LiveTree lifecycle foundations

LiveTree 3.0 Patch 1 defines internal lifecycle primitives without changing
the public behavior of `empty()`, `removeSelf()`, or `removeChildren()`.

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

`LiveTree.isDisposed` reads the shared node state. The central active-node guard
and `LiveTreeDisposedError` exist for later rollout, but Patch 1 does not broadly
guard existing LiveTree methods. Public detach/removal vocabulary is deferred to
Patch 2.
