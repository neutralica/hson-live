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

Patch 3 makes the lifecycle registry the canonical owner of continuing runtime
resources created for a LiveTree QUID:

- LiveMap bindings are registered as one logical owned resource. Manual
  unsubscribe unregisters that ownership and is idempotent. Detach keeps the
  subscription active; terminal removal unsubscribes before identity is
  destroyed.
- Element, document, and window listeners are registered individually. Native
  removal, manual `off()`, `once`, target cleanup, and terminal cleanup all
  update the same `ListenerSub` state and unregister the same ownership record.
- TreeEvents subscriptions are owned individually. Detach preserves them;
  removal clears them. Manual `off()` and `once` unregister ownership.
- Canvas `ResizeObserver` watches remain lifecycle-owned and are classified as
  resize observers for diagnostics.

The registry exposes immutable diagnostic counts by resource category; it does
not expose callbacks or mutable registry state.

Resource audit decisions:

- `createMutationGate()` is currently dormant: it has no LiveTree integration
  or call sites. It remains a manually scoped utility in this patch rather than
  gaining a speculative owner parameter.
- CssManager's requestAnimationFrame is one finite, coalesced manager-level
  stylesheet flush. It does not retain or call a LiveTree. QUID cleanup removes
  the disposed tree's rules before that flush runs, and manager reset/sync paths
  cancel pending work.
- LiveMap feeds, links, stores, and LiveHost transport subscriptions that are
  not created on behalf of a LiveTree remain explicitly manual and are owned by
  their map, link, store, or host session.
- No LiveTree-owned intervals, timeouts, AbortControllers, WebSockets, or
  library-owned animation controllers are currently created.
