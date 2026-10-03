# Document continuation

Document continuation attaches hson-live to an existing browser realization of
an already-canonical document. It is continuation, not hydration: the canonical
document at revision N and the server-rendered DOM supplied by the caller must
already describe exactly the same document. Construction does not rebuild,
normalize, repair, or replace that DOM.

For a full HTML document with portable `page.css`, exact adoption verifies the
single marked managed style in the head and its CSS text against the selected
document Library. It retains the parsed style element without an initial write.
Authored `<style>` nodes remain ordinary document nodes. Local `page.css` and
the continued `tree.css.global` read and write one semantic stylesheet; later
commits update the same browser realization. QUID CSS remains runtime-local in
a separate later style host. Disposal stops the stylesheet observer and leaves
the document Library and caller-owned DOM in place. Hosted cuts project CSS
with the selected document, and Echo applies live, replayed, and fallback CSS
through LiveMap before the adopted style is updated. Synchronous hosted global
writes are rejected; `tree.async.css.global` uses the document authority path.

The required DOM is defined by hson-live's browser-realization contract, not by
public `.toHtml()`. The latter remains Hson transport HTML and may contain
`_hson_*` carriers. The plan and serializer remain private. Hosted HTML and
its matching projected state come from an explicit `session.now({ html })`;
`hson-live/ssr` supplies the independent state-carrier codec.

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
`mirror` correspond, not the aggregate.

After installing a local aggregate cut, select the document named by that cut
before continuation:

```ts
const cut = aggregate.cut({ documents: ["page"], html: "page" });
const installed = install_libraries_snapshot(cut.libs);
const selected = installed.map.lib(cut.document);
continue_document({ map: installed.map, document: selected, root });
```

Standalone canonical interactions are opt-in and enable their topology before
ordinary application transitions. An Echo-composed map can also gain local
interaction capability after a local document initializer arrives:

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

For hosted continuation, deliver the explicit `session.now({ html: "page" })`
result and its credential separately. If a text carrier is needed, decode the
projected state and place it back in the cut's `libs` field. Pass the cut,
credential, transport, and existing root Element to `continue_hosted_document`.
The document name is explicit in the HTML-bearing cut; a separate `document`
name can select among multiple projected documents.

```ts
const continuation = await continue_hosted_document({
  now,
  credential,
  transport,
  document: selectedDocumentName,
  root: document.querySelector("main")!,
});

await continuation.tree.async.attrs.set("data-state", "accepted");
await continuation.tree.async.css.global.sel("body").setProp("color", "navy");
continuation.dispose();
continuation.echo.dispose();
```

Continuation internally reserves the exact root and prepares an unsynchronized
Echo replica and projected document before reading the application's DOM. Its
one-shot start then admits the existing DOM at the captured revision and binds
Mirror before attaching and synchronizing Echo. Abandoning the internal
preparation releases the root reservation and prepared Echo; the caller still
owns the supplied transport. The public `continue_hosted_document` call composes
these same stages without exposing the preparation controller. It
resolves only when Echo is caught up and Mirror is active at the current map
revision. Compatible replay therefore advances the already-adopted nodes in
place. An incompatible root epoch fails closed through existing Mirror
continuity rules.

Hosted interactions are activated once, after that readiness boundary. Their
authoritative dispatcher is derived from the prepared Echo; callers provide
only local capabilities and an optional failure observer:

```ts
const continuation = await continue_hosted_document({
  now,
  credential,
  transport,
  root,
  interactions: {
    local: { reveal: () => showPanel() },
    onFailure: reportInteractionFailure,
  },
});
```

The ordinary `continuation.tree.async` remains the hosted authoring interface.

Its existing pessimistic authority, completion-revision, and convergence
semantics are unchanged. `continuation.mirror` remains visible because
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
`Text` objects through plan-bound `hson-boundary` comments. An empty
canonical leaf is evidence-only: its Hson boundary marker maps the canonical
leaf without pretending an empty native `Text` exists. These comments are
inert and layout-free in the supported browser contract, but remain observable
through raw `childNodes`. They are reproducible realization scaffolding, never
canonical Hson/LiveMap nodes, never transport `_hson_*` carriers, and never
QUID-bearing identity.

`textarea`, `title`, `style`, and `script` are parser-atomic.
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

Hosted continuation creates and returns its managed Echo replica. Ownership of
that Echo transfers to the caller. `continuation.dispose()` releases continuation,
Mirror, and adoption resources; `continuation.echo.dispose()` separately releases
the replica, retained client credential, session attachment, and map management.

## Boundaries

Local continuation does not construct a session or Echo. Hosted continuation
prepares the Echo replica internally from the caller's cut, credential, and
transport before adopting the existing DOM. The local implementation is
independently tree-shakeable from hosted authority machinery.

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

## Scout: optional declarative browser ignition

Scout is an optional one-shot custom element that starts the same hosted
continuation when the browser imports `hson-live/scout`. Its import registers
`hson-scout` automatically; a page without the element does not continue
automatically. Manual `continue_hosted_document` remains available.

The application supplies ordinary hosted-continuation options through one
provider. The provider can be configured before or after Scout connects and
may load session material asynchronously. Keep credentials and transport
configuration out of the element and canonical document:

```ts
import { configure_scout } from "hson-live/scout";
import { hsonLiveMap } from "hson-live";

const transport = hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
const continuationPromise = configure_scout(async () => {
  const { now, credential } = await loadApplicationSession();
  return {
    now,
    credential,
    transport,
    root: document.documentElement,
  };
});

const continuation = await continuationPromise;
// When the application is finished:
continuation.dispose();
continuation.echo.dispose();
transport.dispose();
```

The example chooses HTTP in application code. The same provider can supply a
WebSocket or other `EchoReplicaTransport`; Scout does not inspect it. Configure
once per browser runtime. A second provider is rejected. The returned Promise
waits for Scout to complete hosted continuation, so it remains pending until a
Scout connects. It resolves to the ordinary `HostedDocumentContinuation` and
rejects on terminal provider, preparation, or start failure. If an active manual
continuation makes Scout redundant, Scout removes itself and the Promise rejects
with the root collision; the manual continuation remains active. Applications
should observe this Promise to handle failures. Continuation, Echo, and transport
disposal retain their ordinary separate ownership rules. One configuration
delivers one page ignition result; Scouts in other Documents do not start a
second unowned continuation after that result settles.

For a full-document response, the application/page envelope appends the fixed
Scout suffix **after** its authored closing `</body>` and before `</html>`:

```html
</body>
<hson-scout hidden></hson-scout>
</html>
```

For fragment SSR, the application first constructs the HTML/body envelope.
Neither the canonical document nor `cut()`, `session.now()`, or generic Hson
serialization contains Scout. The HTML parser places the after-body element
as the final body child. With JavaScript disabled, it remains hidden and inert,
but structural selectors such as `:last-child`, `:nth-child`, and `:empty` can
observe that extra child.

When the browser runtime is present, Scout validates its empty `hidden`
declaration, calls the provider once, and prepares hosted continuation without
adopting the DOM. It then removes itself before the prepared controller starts
exact adoption, Mirror, Echo synchronization, interactions, and CSS binding.
A provider or preparation failure leaves Scout hidden in place and rejects the
configured Promise. After handoff, ordinary continuation cleanup handles start
failure. Scout keeps only a weak document-keyed consumed marker after success;
the application receives and owns the continuation result. Disposing it does
not reset Scout ignition for that Document. A disconnected pre-handoff Scout
releases its claim, and a replacement invokes the same configured provider for
its own attempt. Late results from the abandoned attempt are ignored. A
same-document move preserves the claim; moving a claimed Scout to another
Document cancels it and makes that element inert. The element has no Shadow DOM
or page lifecycle callbacks. A second Scout in the same document is removed
without another provider call. If a manual continuation already owns the exact
root, Scout is redundant and removes itself; distinct manual roots retain their
normal behavior. A restored BFCache page relies on its existing continuation,
not on Scout running again.
