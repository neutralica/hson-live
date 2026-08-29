# Reflect API reference

Reflect projects LiveMap-owned state into LiveTree while keeping LiveMap as the
only canonical authority. It does not make the DOM authoritative and does not
observe arbitrary DOM mutation.

## Public surface

```ts
import {
  hsonReflect,
  reflect_document,
  reflect_collection,
} from "hson-live/reflect";
import type {
  DocumentReflect,
  CollectionReflect,
  CollectionReflectOptions,
} from "hson-live/reflect";
```

The root package exports the same `hsonReflect`, `reflect_document`, and
`reflect_collection` functions. The browser umbrella exposes `hson.reflect` as
the same callable object.

```ts
const documentBinding = hsonReflect(elementMap);
const sameDocumentBinding = reflect_document(elementMap);

const collectionBinding = hsonReflect.collection(options);
const sameCollectionBinding = reflect_collection(options);
```

The callable facade accepts an `ElementLiveMap`, not a fragment or data map.
The `.collection(...)` member accepts a keyed array projection configuration.

## Document reflection

```ts
const map = hson.liveMap.fromHson(`<main <p "hello"/>/>`);

if (map.mode === "element") {
  const reflected = hson.reflect(map);
  reflected.tree;           // LiveTree projection
  reflected.status;         // "active"
  reflected.sourceRevision; // map revision already applied
  reflected.failure;        // undefined while healthy

  reflected.dispose();
}
```

Construction captures the current canonical element and revision, builds a
fresh LiveTree projection, establishes path/QUID correspondence, registers its
identity participant, then subscribes to LiveMap commit observations. If the
map changes during that initialization window, construction fails instead of
publishing a binding that skipped a revision. Only one active document Reflect
may own a given exact map object.

The returned object has live getters:

```ts
type DocumentReflectStatus =
  | "initializing"
  | "active"
  | "replacing"
  | "failed"
  | "disposed";

type DocumentReflect = Readonly<{
  readonly tree: LiveTree;
  readonly status: DocumentReflectStatus;
  readonly sourceRevision: number;
  readonly failure: DocumentReflectError | undefined;
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

LiveMap remains canonical. Reflect consumes exact accepted-state evidence and
ordered commit revisions; it never infers canonical state from the projected
tree or DOM.

Document Reflect handles the public document graph operations currently
produced by LiveMap:

- `set-attr`, `remove-attr`, and `replace-attrs`;
- `insert-content`, `remove-content`, `move-content`, and `replace-content`;
- `ensure-quid` identity registration;
- a sole `replace-root` operation; and
- snapshot observations produced by restore.

Incremental operations preserve surviving LiveTree/DOM correspondence. A
complete-root transition either converges compatible same-epoch material or
creates a fresh projection lineage for a new owner epoch. The binding tracks
the exact source revision after each successful projection update.

### Mutating a bound LiveTree

Supported bound mutations delegate to LiveMap rather than editing a second
authority:

- ordinary attribute `set`, `setMany`, `drop`, `dropMany`, `clear`, and
  complete replacement;
- simple text `set`, `add`, and `insert` when the canonical content has a
  single exact operation lowering;
- `empty()` when the canonical content can be removed by one exact operation;
- removing a non-root bound element; and
- root removal as terminal teardown of the borrowed projection.

Direct structural LiveTree operations that cannot be expressed as one
supported canonical map operation are rejected with
`DOCUMENT_REFLECT_UNSUPPORTED_OPERATION` or
`DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED`. In particular, Reflect does not
pretend that arbitrary `append`, text overwrite, reparenting, or direct graph
editing is bidirectional synchronization. View-local listeners and styling do
not become LiveMap data.

### Failure and disposal

Initialization failures throw a classified `DocumentReflectError` and unwind
the partial binding. An error while consuming an already accepted map
observation moves the binding to `failed`, records the first failure, and
unsubscribes both commit observation and identity participation. The
authoritative LiveMap commit has already happened; Reflect failure does not
roll it back.

`dispose()` is idempotent. It unsubscribes and releases correspondence
ownership, marks the binding `disposed`, and allows a later new binding for the
same map. It does not dispose the returned LiveTree; the caller may retain or
remove that projection separately. `diagnostics()` throws after disposal.

## Collection reflection

Collection Reflect maintains one dedicated empty LiveTree host from an
array-valued LiveMap path handle:

```ts
const reflected = hsonReflect.collection({
  source: state.at(["items"]),
  host,
  key: (item) => item.id,
  render(item, context) {
    const tree = hson.liveTree.create.li();
    tree.text.set(item.at(["label"]).snap());
    return {
      tree,
      update(next) {
        tree.text.set(next.at(["label"]).snap());
      },
    };
  },
});
```

The key must be a unique string or number. The renderer must return one active
detached LiveTree branch, optionally with synchronous `update` and `dispose`
hooks. Surviving keys retain their LiveTree, DOM element, listeners, CSS,
bindings, and browser state through reorder and source replacement. Removed
keys are terminally disposed; new keys are rendered once.

`replaceSource(nextHandle)` validates and switches to a new mirror while
preserving surviving application keys. `synchronize()` explicitly rereads the
current source and is the recovery surface after a failed renderer update.
`subscribe(listener)` observes immutable reflector snapshots; listener errors
are isolated and counted. `dispose()` unsubscribes, removes all reflector-owned
branches, clears listeners/mappings, and leaves the application-owned host in
place.

For the complete renderer, key, source-replacement, cleanup, diagnostics, and
known-limitations contract, see
[Experimental Collection Reflect](../contracts/reflect-collection-experimental.md).

## What Reflect does not do

Current Reflect provides no:

- adoption or hydration of existing DOM;
- arbitrary DOM observation or DOM-to-Hson diffing;
- DOM-as-authority mode;
- fragment-document reflector;
- universal recursive data renderer;
- virtual DOM or component framework;
- transport, session, history, recovery, or persistence authority; or
- server-side projection runtime.

Locus owns remote authority and recovery. LiveHost owns application/runtime
routing. LiveTree remains usable independently of all three.
