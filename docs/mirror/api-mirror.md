# Mirror API reference

Mirror projects LiveMap-owned documents into LiveTree while keeping LiveMap as the
only canonical authority. It does not make the DOM authoritative and does not
observe arbitrary DOM mutation.

## Public surface

```ts
import {
  hsonMirror,
  reflect_document,
} from "hson-live/mirror";
import type {
  DocumentMirror,
} from "hson-live/mirror";
```

The root package exports the normal `hsonMirror` and `reflect_document`
composition surface. The browser umbrella exposes
`hson.mirror` as the same callable object.

```ts
const documentBinding = hsonMirror(elementMap);
const sameDocumentBinding = reflect_document(elementMap);
```

The callable facade accepts a selected document library.

## Document reflection

```ts
const PageSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const map = hson.liveMap.fromLibraries({ page: { document: `<main <p "hello"/>/>`, schema: PageSchema } });
{
  const reflected = hson.mirror(map.doc.must("page"));
  reflected.tree;           // LiveTree projection
  reflected.status;         // "active"
  reflected.sourceRevision; // map revision already applied
  reflected.failure;        // undefined while healthy

  reflected.dispose();
}
```

Construction captures the current canonical document projection and revision, builds a
fresh LiveTree projection, establishes path/QUID correspondence, registers its
identity participant, then subscribes to LiveMap commit observations. If the
map changes during that initialization window, construction fails instead of
publishing a binding that skipped a revision. Only one active document Mirror
may own a given selected document Library.

The returned object has live getters:

```ts
type DocumentMirrorStatus =
  | "initializing"
  | "active"
  | "replacing"
  | "failed"
  | "disposed";

type DocumentMirror = Readonly<{
  readonly tree: LiveTree;
  readonly status: DocumentMirrorStatus;
  readonly sourceRevision: number;
  readonly failure: DocumentMirrorError | undefined;
  diagnostics(): Readonly<{
    updatesApplied: number;
    registeredElements: number;
    wholeCorrespondenceBuilds: number;
    incrementalCorrespondenceUpdates: number;
    correspondenceEntriesChanged: number;
    identityEffectsConsumed: number;
  }>;
  dispose(): void;
}>;
```

### Authority and accepted map operations

LiveMap remains canonical. Mirror consumes exact accepted-state evidence and
ordered commit revisions; it never infers canonical state from the projected
tree or DOM.

With a local authoritative LiveMap, supported ordinary LiveTree requests lower
and commit synchronously. With an Echo-governed map, ordinary synchronous
canonical authoring throws before publishing a request. Callers enter the
explicit `tree.async` context; its exact semantic descriptor is queued by Echo
and lowered only at queue head against the latest accepted replica. No
optimistic LiveTree or DOM mutation occurs. Authorization rejection rejects the
initiating Promise and leaves Mirror active because there is no accepted
evidence to project.

A hosted AsyncLiveTree Promise resolves after Locus terminal success and after
the same logical-map/incarnation Echo reaches the returned `completionRev`.
That revision is authoritative-head evidence used as an exact client barrier,
not a statement that Mirror or DOM realization succeeded. Read projected or
runtime state explicitly through `asyncTree.sync` and inspect Mirror status
separately.

Native form editing remains browser-owned realization state: unrelated accepted
document changes do not reset a dirty control, and denial does not roll native
state back. A bound `form.setValue(...)` or `form.setChecked(...)` performs no
independent property write. When accepted canonical evidence changes that same
field, Mirror explicitly realizes the accepted `.value` or `.checked` property,
including on an already-dirty input, textarea, or select as applicable.

Hosted QUID demand is local to the Echo replica LiveMap. An unquidded bound
node can acquire a client-local QUID without a Locus request, authority
revision, map revision, or application commit. Mirror, LiveTree, and local DOM
realize the same Echo map-local claim.

Document Mirror handles the public document graph operations currently
produced by LiveMap:

- `set-attr`, `remove-attr`, and `replace-attrs`;
- `insert-content`, `remove-content`, `move-content`, and `replace-content`;
- legacy replayed `ensure-quid` registration;
- a sole `replace-root` operation; and
- snapshot observations produced by restore.

Incremental operations preserve surviving LiveTree/DOM correspondence. A
complete-root transition either converges compatible same-epoch material or
creates a fresh projection lineage for a new owner epoch. The binding tracks
the exact source revision after each successful projection update.

Fresh inserted and replaced structural material is copied by occurrence before
becoming active projected subjects. Repeated source references produce separate
subjects and native nodes; position-directed updates stay isolated. Compatible
continuity planning still reuses authenticated existing subjects. Sparse linked
projection remains sparse, including detached/reused subjects after binding release.

Structural projection stages native work before retiring removed subjects or
notifying observers. A failed DOM application restores the prior projected graph,
subjects, native placement and operation-owned identity changes. The already
accepted canonical LiveMap commit remains accepted; the Mirror reports failure.

### Mutating a bound LiveTree

Supported local bound mutations delegate synchronously to LiveMap. The hosted
subset is available through `tree.async` rather than hidden synchronous
enqueueing:

- ordinary attribute `set`, `setMany`, `drop`, `dropMany`, `clear`, and
  complete replacement;
- simple text `set`, `add`, and `insert` when the canonical content has a
  single exact operation lowering;
- `empty()` when the canonical content can be removed by one exact operation;
- removing a non-root bound element; and
- hosted removal of a non-root bound element.

The first AsyncLiveTree surface also includes `flags.set/clear`, `id.set/clear`,
`classlist.set/add/remove/toggle/clear`, and `form.setValue/setChecked`.
The async facade also exposes governed document-global CSS through
`tree.async.css.global`. `text.overwrite`, `form.setSelected`, arbitrary
append/create/reparent/detach, inline-style/data/SVG/canvas convenience parity,
reads, DOM/runtime capabilities, and application/domain actions remain absent.

Direct structural LiveTree operations that cannot be expressed as one
supported canonical map operation are rejected with
`DOCUMENT_MIRROR_UNSUPPORTED_OPERATION` or
`DOCUMENT_MIRROR_DELEGATION_UNSUPPORTED`. In particular, Mirror does not
pretend that arbitrary `append`, text overwrite, reparenting, or direct graph
editing is bidirectional synchronization. View-local listeners and styling do
not become LiveMap data.

### Failure and disposal

Initialization failures throw a classified `DocumentMirrorError` and unwind
the partial binding. An error while consuming an already accepted map
observation moves the binding to `failed`, records the first failure, and
unsubscribes both commit observation and identity participation. The
authoritative LiveMap commit has already happened; Mirror failure does not
roll it back.

`dispose()` is idempotent. It unsubscribes and releases correspondence
ownership, marks the binding `disposed`, and allows a later new binding for the
same map. It does not dispose the returned LiveTree; the caller may retain or
remove that projection separately. `diagnostics()` throws after disposal.

## What Mirror does not do

Current Mirror provides no:

- an existing-DOM option on direct `reflect_document`; use `continue_document` or `continue_hosted_document` for exact adoption;
- arbitrary DOM observation or DOM-to-Hson diffing;
- DOM-as-authority mode;
- separate shape-specific document reflectors;
- universal recursive data renderer;
- virtual DOM or component framework;
- transport, session, history, recovery, or persistence authority; or
- server-side projection runtime.

Locus owns remote authority and recovery. LiveHost owns application/runtime
routing. LiveTree remains usable independently of all three.
