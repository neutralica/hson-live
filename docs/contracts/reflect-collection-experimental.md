# Experimental Collection Reflect

Reflect exposes one deliberately narrow collection surface:

```ts
import { hsonReflect } from "hson-live/reflect";

hsonReflect.collection(options);
```

It maintains a dedicated LiveTree host from an array-valued LiveMap path
handle. LiveMap remains the sole authority for state and commits. The LiveTree
owns only view identity and lifecycle, while the reflector owns correspondence,
ordering, subscriptions, and renderer-owned cleanup.

This contract is experimental. It is not a universal renderer, component
framework, template language, custom-element system, virtual DOM,
bidirectional DOM observer, server-adoption layer, or declarative UI model.

## Identity policy

Collection Reflect requires an application `key` selector. Keys are strings or numbers,
and duplicates fail with `COLLECTION_REFLECT_DUPLICATE_KEY` before predictable
LiveTree mutation.

LiveMap path handles are positional and have no persistent identifier. They do
not prove that an array value survived an array rewrite or movement, so the
reflector does not misrepresent them as stable item identities. `sourceQuid`
therefore remains `undefined` in item contexts and mapping diagnostics unless a
future source explicitly supplies canonical node identity. Application keys
provide continuity for local commits, replay, and replacement mirrors.

A key mutation removes the old reflected record and inserts a new one. No
record remains indexed under both keys.

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
movement, explicit synchronization, or source replacement. Use
`itemHandle.at(relativePath)` to read a field. `context.own(cleanup)` registers
callback-owned resources under the projected branch lifecycle. Explicit
`dispose`, registered cleanup, LiveTree listeners, CSS, and bindings are
drained exactly once by terminal branch removal.

The renderer must return one active detached branch. An attached branch is
rejected; the reflector never steals it. Reusing one branch for two source
records is a mapping conflict.

## Commit and synchronization behavior

The reflector subscribes to the supplied source path and consumes complete
semantic LiveMap commits:

- nested operations update only their owning reflector record;
- a key-changing nested operation runs keyed synchronization;
- splice, insertion, deletion, replacement, reorder, and collection-level set
  update the final ordered keys;
- batches validate once and publish one reflector notification;
- commits outside the source path do no reflector work;
- initial reflection, source replacement, explicit `synchronize()`, and
  structural fallback increment full-synchronization diagnostics.

Keyed synchronization reuses surviving records, terminally removes absent
records, renders only new keys, and detaches/reappends moved branches. LiveTree
QUIDs, mapped DOM elements, listeners, scoped CSS, bindings, focus, and browser
state naturally retained by the element survive movement. A genuine removal
uses terminal `LiveTree.remove()` exactly once.

Structural synchronization performs an O(n) key read. Nested field commits use
targeted item reads and do not flatten or rebuild the collection.

## Source replacement and recovery

`reflector.replaceSource(nextHandle)` validates the replacement collection
before changing the source subscription. Surviving application keys reuse
their LiveTree branches even when a fresh mirror has different LiveMap path
handles and QUIDs. Removed keys are disposed, new keys are rendered once, and
order is synchronized.

Invalid shape, unreadable input, duplicate keys, or renderer creation failure
raises `COLLECTION_REFLECT_SOURCE_REPLACEMENT_FAILED`; the prior source and valid
reflection remains active where no renderer update has begun. Replay commits
and snapshot replacement converge through the same semantic commit and keyed
synchronization paths.

`synchronize()` explicitly reads the current source collection and synchronizes it.
It is the recovery surface after a reflector has entered `failed` state.

## Ownership, failure, and diagnostics

The supplied host is application-owned and must be a dedicated empty
container. The reflector owns every branch returned by its renderer. `dispose()`
unsubscribes, terminally removes those branches, clears mappings, ignores later
commits, and is idempotent; it does not remove the host.

Predictable validation happens before document mutation. A renderer update can
perform arbitrary user code and is not transactionally reversible; if it
throws, the reflector retains the first classified failure, stops consuming
later commits, and requires `synchronize()` or disposal. Observer failures are
counted separately and cannot fail authoritative LiveMap state.

`diagnostics()` returns immutable counters and status. `debugMappings()`
returns detached immutable summaries containing application key, current
source path, optional source QUID, view QUID, and ordinal. Neither surface
exposes mutable records or source values.

## Example

```ts
const schema = hson.liveMap.schema.define((s) => s.exact({
  items: s.array(s.exact({ id: s.string, label: s.string })),
}));

const state = hson.liveMap
  .fromJson({ items: [{ id: "a", label: "Alpha" }] })
  .schema.use(schema);

const host = hson.liveTree.queryDom("#items").graft();

const reflector = hson.reflect.collection({
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
reflector.replaceSource(nextMirror.at(["items"]));
reflector.dispose();
```

## Known limitations

Collection Reflect supports keyed array collections only, requires a dedicated
empty host, uses synchronous render/update hooks, and has no stable LiveMap value-node
QUID proof across array rewrites. Structural commits may perform O(n) key
synchronization even though unaffected LiveTree/DOM branches are preserved.

A universal data renderer can build on this engine with recursive
object/array/primitive visualization, expandable state, schema-selected editors,
and conversion/copy affordances. It should consume this reflector rather than
introducing a competing correspondence or lifecycle engine.
