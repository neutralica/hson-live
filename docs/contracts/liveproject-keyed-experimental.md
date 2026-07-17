# Experimental keyed LiveMap → LiveTree projection

Patch 7A introduces one deliberately narrow projection surface:

```ts
hson.liveProject.keyedCollection(options)
```

It maintains a dedicated LiveTree host from an array-valued LiveMap path
handle. LiveMap remains authoritative for JSON state and commits, LiveTree
remains authoritative for document identity and lifecycle, and the projection
handle owns only correspondence, ordering, subscriptions, and renderer-owned
cleanup.

This contract is experimental. It is not a universal renderer, component
framework, template language, custom-element system, virtual DOM,
bidirectional DOM observer, hydration layer, or declarative UI model.

## Identity policy

Patch 7A requires an application `key` selector. Keys are strings or numbers,
and duplicates fail with `LIVE_PROJECTION_DUPLICATE_KEY` before predictable
LiveTree mutation.

LiveMap path-handle QUIDs currently identify paths. They do not prove that an
array value survived an array rewrite or movement, so the projector does not
misrepresent them as stable item identities. `sourceQuid` is therefore
currently `undefined` in item contexts and mapping diagnostics. Application
keys provide continuity for local commits, replay, and replacement mirrors.
If LiveMap later exposes stable value-node identity across its semantic array
operations, source QUID can take precedence within one source ownership
boundary while application keys continue to provide cross-snapshot continuity.

A key mutation is removal of the old keyed projection plus insertion of a new
one. No projection remains indexed under both keys.

## Renderer contract

`render(itemHandle, context)` creates one detached LiveTree branch. It may
return the tree directly for static or binding-owned content, or return:

```ts
{
  tree,
  update(nextItemHandle, change, nextContext) {},
  dispose() {},
}
```

The `update` hook receives a fresh real LiveMap handle after nested mutation,
movement, reconciliation, resynchronization, or source replacement. Use
`itemHandle.at(relativePath)` to read a field. `context.own(cleanup)` registers
callback-owned resources under the projected branch lifecycle. Explicit
`dispose`, registered cleanup, LiveTree listeners, CSS, and bindings are
drained exactly once by terminal branch removal.

The renderer must return one active detached branch. An attached branch is
rejected; the projector never steals it. Reusing one branch for two source
records is a mapping conflict.

## Commit and reconciliation behavior

The projector subscribes to the supplied source path and consumes complete
semantic LiveMap commits:

- nested operations update only their owning projection record;
- a key-changing nested operation runs keyed reconciliation;
- splice, insertion, deletion, replacement, reorder, and collection-level set
  reconcile the final ordered keys;
- batches validate once and publish one projection notification;
- commits outside the source path do no projection work;
- initial projection, source replacement, explicit `resync()`, and structural
  fallback increment full-reconciliation diagnostics.

Keyed reconciliation reuses surviving records, terminally removes absent
records, renders only new keys, and detaches/reappends moved branches. LiveTree
QUIDs, mapped DOM elements, listeners, scoped CSS, bindings, focus, and browser
state naturally retained by the element survive movement. A genuine removal
uses terminal `LiveTree.remove()` exactly once.

Structural reconciliation performs an O(n) key read. Nested field commits use
targeted item reads and do not flatten or rebuild the collection.

## Source replacement and recovery

`projection.replaceSource(nextHandle)` validates the replacement collection
before changing the source subscription. Surviving application keys reuse
their LiveTree branches even when a fresh mirror has different LiveMap path
handles and QUIDs. Removed keys are disposed, new keys are rendered once, and
order is reconciled.

Invalid shape, unreadable input, duplicate keys, or renderer creation failure
raises `LIVE_PROJECTION_SOURCE_REPLACEMENT_FAILED`; the prior source and valid
projection remain active where no renderer update has begun. Replay commits
and snapshot replacement converge through the same semantic commit and keyed
reconciliation paths.

`resync()` explicitly reads the current source collection and reconciles it.
It is the recovery surface after a projector has entered `failed` state.

## Ownership, failure, and diagnostics

The supplied host is application-owned and must be a dedicated empty
container. The projector owns every branch returned by its renderer. `dispose()`
unsubscribes, terminally removes those branches, clears mappings, ignores later
commits, and is idempotent; it does not remove the host.

Predictable validation happens before document mutation. A renderer update can
perform arbitrary user code and is not transactionally reversible; if it
throws, the projector retains the first classified failure, stops consuming
later commits, and requires `resync()` or disposal. Observer failures are
counted separately and cannot fail authoritative projection state.

`diagnostics()` returns immutable counters and status. `debugMappings()`
returns detached immutable summaries containing application key, current
source path, optional source QUID, view QUID, and ordinal. Neither surface
exposes mutable records or source values.

## Example

```ts
const schema = hson.liveMap.schema.define((s) => ({
  items: s.array({ id: s.string, label: s.string }),
}));

const state = hson.liveMap
  .fromJson({ items: [{ id: "a", label: "Alpha" }] })
  .schema.use(schema);

const host = hson.liveTree.queryDom("#items").graft();

const projection = hson.liveProject.keyedCollection({
  source: state.at(["items"]),
  host,
  key: (item) => item.id,
  render(item) {
    const tree = hson.liveTree.create.li();
    tree.text.set(item.at(["label"]).snap());

    return {
      tree,
      update(nextItem) {
        tree.text.set(nextItem.at(["label"]).snap());
      },
    };
  },
});

// Later, including after a LiveHost snapshot installs a fresh mirror:
projection.replaceSource(nextMirror.at(["items"]));
projection.dispose();
```

## Known limitations and Patch 7B target

Patch 7A supports keyed array collections only, requires a dedicated empty
host, uses synchronous render/update hooks, and has no stable LiveMap value-node
QUID proof across array rewrites. Structural commits may perform O(n) key
reconciliation even though unaffected LiveTree/DOM branches are preserved.

Patch 7B should build the universal data renderer on this engine: recursive
object/array/primitive visualization, expandable state, schema-selected editors,
and conversion/copy affordances. It should consume this projector rather than
introducing a competing correspondence or lifecycle engine.
