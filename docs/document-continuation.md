# Document continuation

Document continuation attaches hson-live to an existing browser realization of
an already-canonical document. It is continuation, not hydration: the canonical
document at revision N and the server-rendered DOM supplied by the caller must
already describe exactly the same document. Construction does not rebuild,
normalize, repair, or replace that DOM.

The package root exports two orchestration functions:

```ts
import { continue_document, continue_hosted_document } from "hson-live";
```

Both require an explicit `Element`. Pass the element that realizes the one
ordinary root in the selected document map, such as an application `<main>` or,
when it is the canonical root, `document.documentElement`. Selectors, selector
strings, implicit global-document lookup, and `TreeSelector` are intentionally
not part of this API.

## Local continuation

```ts
const continuation = continue_document({
  map,
  root: document.querySelector("main")!,
});

continuation.tree.attrs.set("data-ready", "yes");
continuation.dispose();
```

`map` may be a document `LiveMap`, or an aggregate public-library map. With one
public document library the aggregate selection is inferred. With two or more,
pass its stable public document-library handle as `document`. Hidden canonical
interaction storage is not a selectable document library. The returned `map`
is always the selected document-facing map/library to which `tree` and
`reflect` correspond, not the aggregate.

Canonical interactions are opt-in and assume their topology was enabled before
ordinary application transitions:

```ts
const continuation = continue_document({
  map: aggregate,
  root,
  interactions: {
    local: { reveal: () => showPanel() },
    dispatch: async (actionKey, payload) => dispatchDomainAction(actionKey, payload),
    onFailure: reportInteractionFailure,
  },
});
```

Continuation calls `activate_interactions`; it does not call
`enable_interactions`.

## Hosted continuation

```ts
const continuation = await continue_hosted_document({
  echo,
  root: document.querySelector("main")!,
});

await continuation.tree.async.attrs.set("data-state", "accepted");
```

The caller supplies a replica-bearing `Echo` whose exact map already contains
the selected document. Continuation first admits the existing DOM at its
captured revision and binds `Reflect`, then awaits ordinary Echo recovery. It
resolves only when Echo is caught up and `Reflect` is active at the current map
revision. Compatible replay therefore advances the already-adopted nodes in
place. An incompatible root epoch fails closed through existing `Reflect`
continuity rules.

Hosted interactions are activated once, after that readiness boundary. Their
authoritative dispatcher is derived from the supplied Echo; callers provide
only local capabilities and an optional failure observer:

```ts
const continuation = await continue_hosted_document({
  echo,
  root,
  interactions: {
    local: { reveal: () => showPanel() },
    onFailure: reportInteractionFailure,
  },
});
```

The ordinary `continuation.tree.async` remains the hosted authoring interface.
Its existing pessimistic authority, completion-revision, and convergence
semantics are unchanged. `continuation.reflect` remains visible because
authority success does not imply that every later DOM realization succeeds.

## Exact admission and ownership

Before publishing any runtime links, continuation verifies the canonical root,
document mode, namespace and tag names, exact attributes, QUID
presence/absence/value, child order, text node count and boundaries, text
values, virtual-node lowering, owner document, and runtime identity claims.
The established existing-document `Reflect` admission then verifies the full
canonical graph, mappings, ownership, and revision fence again.

For corresponding input, admission writes nothing to the DOM. It preserves the
actual `Element` and `Text` objects, attributes, text boundaries, focus,
selection, and browser dirty form properties. It neither mints QUIDs nor writes
`hson:quid`; nodes without canonical QUIDs remain without them. Comments,
separator whitespace, or any other unrepresented child are mismatches rather
than tolerated decoration.

Any construction failure releases provisional mappings, identity claims,
`Reflect`, interaction activation, and the active-root reservation. It leaves
the DOM and canonical map untouched. A root can have only one active high-level
continuation. `dispose()` is idempotent and removes continuation-owned
interactions and `Reflect` propagation, but does not dispose the normal
`LiveTree`, mutate the map or DOM, or remove browser-owned roots.

Hosted continuation borrows Echo. Disposal never disconnects or disposes Echo,
ends its session, or owns its later recovery. Echo, its credentials, connection
policy, and session lifecycle remain caller-owned.

## Boundaries

These functions contain no server/session or connection construction.
Bootstrap decoding and installation, Echo construction, and session preparation
remain separate caller operations. The local implementation
is independently tree-shakeable from hosted authority machinery.

Server-rendered HTML remains useful without JavaScript; continuation adds a live
runtime only when called. A production helper for safely embedding bootstrap
state inline is deliberately deferred: applications must use their own
CSP/XSS-safe channel and must not interpolate untrusted state into script text.
No server-side rendering convenience or bootstrap-from-document wrapper is
provided in this release.
