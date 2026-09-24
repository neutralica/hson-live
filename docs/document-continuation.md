# Document continuation

Document continuation attaches hson-live to an existing browser realization of
an already-canonical document. It is continuation, not hydration: the canonical
document at revision N and the server-rendered DOM supplied by the caller must
already describe exactly the same document. Construction does not rebuild,
normalize, repair, or replace that DOM.

The required DOM is defined by hson-live's browser-realization contract, not by
public `.toHtml()`. The latter remains Hson transport HTML and may contain
`_hson_*` carriers. The plan and serializer remain private; `hson-live/ssr`
exposes only the semantic `{ html, bootstrap }` composition boundary.

The structural names have distinct authorities: `_hson_*` names belong to
canonical Hson and its transport representation; `hson-boundary` names derived
browser-realization evidence. Server SSR emits no generated `hson:quid`
attributes. A running browser may later add local `hson:quid` metadata when a
feature requests identity. Boundary markers derive from portable structure and
parser evidence, never runtime identity.

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

The local SSR bootstrap carries document state and revision, without generated
server QUIDs. Admit the decoded local document root through ordinary portable node
admission, then restore its revision with `identity: "strip"`; this gives the
browser a fresh runtime identity context. `map` may be a document `LiveMap`, or an aggregate public-library map. With one
public document library the aggregate selection is inferred. With two or more,
pass its stable public document-library handle as `document`. Hidden canonical
interaction storage is not a selectable document library. The returned `map`
is always the selected document-facing map/library to which `tree` and
`reflect` correspond, not the aggregate.

After aggregate SSR installation, resolve the stable public name returned with
the atomic SSR triple before continuation:

```ts
const installed = install_libraries_snapshot(ssr.bootstrap);
const selected = installed.map.lib(ssr.document);
continue_document({ map: installed.map, document: selected, root });
```

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

For hosted Libraries, install with `install_locus_libraries_snapshot`, pass the
returned complete map and recovery cursor to the existing `create_echo`, then
resolve `echo.map.lib(ssr.document)` as the continuation's `document`. Recovery
converges the whole aggregate even though continuation realizes only that one
selected document.

```ts
const continuation = await continue_hosted_document({
  echo,
  root: document.querySelector("main")!,
});

await continuation.tree.async.attrs.set("data-state", "accepted");
```

The caller supplies a replica-bearing `Echo` whose exact map already contains
the selected document. Continuation first admits the existing DOM at its
captured revision and binds Mirror, then awaits ordinary Echo recovery. It
resolves only when Echo is caught up and Mirror is active at the current map
revision. Compatible replay therefore advances the already-adopted nodes in
place. An incompatible root epoch fails closed through existing Mirror
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

Before publishing any runtime links, continuation derives one immutable browser
realization plan and verifies the canonical root,
document mode, namespace and tag names, exact authored attributes,
child order, text node count and boundaries, text
values, virtual-node lowering, derived table wrappers, template content,
Hson boundary markers, owner document, and runtime identity claims.
The established existing-document Mirror admission then verifies the full
canonical graph, mappings, ownership, and revision fence again.
Canonical paths and the plan's ordered positions pair each canonical node with
its existing DOM node. Generated QUID equality across server and browser
runtimes is not part of this correspondence: structurally identical siblings
are paired by current ordered position, including when their historical DOM
subjects were swapped. The proof does not establish historical runtime
provenance.

For corresponding input, admission writes nothing anywhere in the containing
`Document`. It preserves the
actual `Element` and `Text` objects, attributes, text boundaries, focus,
selection, and browser dirty form properties. It neither mints QUIDs nor writes
`hson:quid`. A pre-existing `hson:quid` in unbound SSR DOM rejects admission;
markup cannot claim browser runtime identity. Later local QUID demand may
create browser-owned DOM metadata. Mirror checks the browser graph, runtime
registry, and established local DOM QUID metadata. Arbitrary
comments, separator whitespace, malformed or wrong-plan Hson boundary markers,
and any other unplanned child are mismatches rather than tolerated decoration.

In ordinary content, adjacent non-empty canonical leaves retain separate native
`Text` objects through versioned, plan-bound `hson-boundary` comments. An empty
canonical leaf is evidence-only: its Hson boundary marker maps the canonical
leaf without pretending an empty native `Text` exists. These comments are
inert and layout-free in the supported browser contract, but remain observable
through raw `childNodes`. They are reproducible realization scaffolding, never
canonical Hson/LiveMap nodes, never transport `_hson_*` carriers, and never
QUID-bearing identity.

`textarea`, `title`, `style`, and `script` are parser-atomic in version one.
They support zero canonical leaves or one compatible non-empty text leaf.
Explicit empty leaves, multiple leaves, textarea-leading LF, RAWTEXT CR, parser
closing sentinels, NUL, and lone surrogates reject deterministically before SSR
emission. Canonical state remains valid Hson; only browser realization is
incompatible.

SSR planning is closed under native HTML parsing: a plan may reach the internal
serializer only when parsing its emitted HTML preserves the same Elements,
namespaces, attributes, children, text boundaries, derived wrappers, template
content, and Hson boundary evidence. Void children, implied-end-tag nesting,
unstable table/select/document insertion contexts, nested parser-special
elements, and HTML tokens that escape SVG foreign content reject during
planning. This capability check does not narrow ordinary direct DOM projection;
a canonical document can remain valid and directly realizable even when no
lossless HTML-source realization exists.

Any construction failure releases provisional mappings, identity claims,
Mirror, interaction activation, and the active-root reservation. It leaves
the DOM and canonical map untouched. A root can have only one active high-level
continuation. `dispose()` is idempotent and removes continuation-owned
interactions and Mirror propagation, but does not dispose the normal
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
Server-side composition is provided separately by `hson-live/ssr`; this
continuation API still performs no rendering or bootstrap capture itself.

Runtime-document registration is silent and rollback-capable during exact
continuation. Runtime managers are notified only after the continuation object
has been returned or its hosted Promise has resolved. Their owned support DOM,
including CssManager's style host, is noncanonical infrastructure and may appear
after that publication boundary; a later manager failure does not retroactively
reject or roll back the successful continuation.
