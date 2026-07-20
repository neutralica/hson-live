#### hson-live / hson.terminalgothic.com


<!-- 
LiveMap is the local state and mutation layer of hson-live. It projects an underlying HSON graph into mutable structured state addressed by canonical paths, while preserving the physical HSON graph needed for representation, serialization, and projection.

Projected mutations do not directly edit arbitrary JavaScript objects or DOM nodes. They pass through LiveMap’s graph mutation pipeline and return explicit commits. A commit records whether state changed, the previous and resulting revisions, and semantic operations such as set, replace, delete, and splice. These commits are detached data records suitable for replay, debugging, subscriptions, transport, and hosted authority.

LiveMap schema attaches TypeScript-compatible structure to the projected graph. Each projected mutation validates a complete candidate root before the live graph is changed. If the proposed mutation violates the expected shape, value type, node kind, array behavior, or document constraint, LiveMap rejects the operation before mutation, consumes no revision, and emits no feed event.

LiveMap also provides feeds, store-style subscriptions, path handles, object and array helpers, proxies, capture/apply/replay operations, and binding primitives. Together these features allow the graph to behave as a reactive state substrate for local views, LiveTree DOM projection, debugging tools, and LiveHost replication.
 -->
# LiveMap API
Updated: 2026-07-19

This document is the reference for the current implemented LiveMap surface.
LiveMap projects an HSON graph as mutable JSON-path state with explicit commits,
revisions, feeds, schemas, handles, proxies, and replay operations.

For the architecture and completed design direction, see `hson-livemap.md`.
This reference describes current behavior, including implementation
limitations that differ from that idealized model.

---

## Construction

The preferred facade is `hson.liveMap`:

```ts
const fromJson = hson.liveMap.fromJson({ count: 0 });
const fromJsonText = hson.liveMap.fromJson('{"count":0}');
const fromHson = hson.liveMap.fromHson('<count 0>');
const fromNode = hson.liveMap.fromNode(node);
const trustedDocument = hson.liveMap.fromTrustedHtml("<main>Trusted</main>");
const safeDocument = hson.liveMap.fromUntrustedHtml(userHtml);
```

### `hson.liveMap.fromJson(input)`

Accepts a JSON string or `JsonValue` and returns `LiveMap`.

- A JSON string is parsed with `JSON.parse`.
- Object and array roots are transformed directly into initial owned state.
- Every normal constructor begins at revision 0 and emits no commit.
- Although the TypeScript signature accepts every `JsonValue`, the current
  transform invariant rejects top-level string, number, boolean, and `null`
  roots. Use an object or array root until scalar-root construction is fixed.

### `hson.liveMap.fromHson(input)`

Parses validated HSON text, clones the canonical graph, and classifies it as
`data-object`, `data-array`, `element`, or `fragment`. Data roots return the
existing mutable data LiveMap. Document roots return the shape-specific
document façade described below. Construction begins at revision 0.

### `hson.liveMap.fromNode(node)`

Deep-clones and validates the supplied canonical `HsonNode`, then returns the
shape-specific façade selected by its canonical root structure. The map retains
no mutable node, attrs, structured-style, metadata, or content-array reference
from the caller. Valid persisted document QUIDs are preserved.

### HTML document constructors

```ts
hson.liveMap.fromTrustedHtml(source)
hson.liveMap.fromUntrustedHtml(source)
```

Both accept an HTML string and return `ElementLiveMap | FragmentLiveMap`.
`fromTrustedHtml` uses the existing unsanitized trusted parser route.
`fromUntrustedHtml` uses the existing DOMPurify-backed sanitizer route. Storage
and capture are inert graph operations; later DOM materialization is a separate
security boundary.

There is no `liveMap.element` or `liveMap.fragment` constructor namespace.
`element` and `fragment` are shape-specific capabilities on constructed map
instances.

The lower-level equivalent is exported from the package root:

```ts
const map = make_livemap_core(rootNode);
```

`make_livemap_core` remains a lower-level projected Core surface, but now also
takes detached ownership by deep-cloning and validating its input. Prefer the
classified `hson.liveMap` constructors for document roots.

### Root modes and document façade

```ts
type LiveMapRootMode =
  | "data-object"
  | "data-array"
  | "element"
  | "fragment";
```

An `_hson_elem` root cluster containing exactly one ordinary top-level element
is `element`. Empty, text-only, mixed, or multiple-item document content is
`fragment`. Classification uses canonical HSON structure, not projected JSON.

Document maps expose detached canonical reads, capture, local atomic install,
exact-revision restoration, canonical graph replay, shared commit observation,
revision, and the explicitly unsafe debug escape hatch:

```ts
if (map.mode === "element") {
  const element = map.element.node();
  const content = map.document.content();
}

if (map.mode === "fragment") {
  const content = map.document.content();
}

map.root();
const capture = map.capture();
map.install(capture, { expectedRev: map.rev });
map.restore(capture, { expectedRev: map.rev });
map.replay(graphCommit);
const stop = map.commits.observe((event) => {
  if (event.kind === "commit") {
    // event.origin is "authoritative" or "replay"
  } else {
    // snapshot installation metadata; never a replayable commit
  }
});
map.debug.node([]);
```

Document maps do not expose `snap`, Proxy/path handles, projected mutations,
data schemas, projected feeds/subscriptions, or projected `apply`. Canonical
graph `replay` is a document-domain operation and does not coerce graph commits
into projected path/previous/next shapes.

`commits.observe` is shared by projected and document maps. Each successful
logical mutation emits exactly one event containing the exact canonical commit
returned by the mutation. Rejected mutations and unchanged no-ops emit none.
Replay emits `origin: "replay"`; ordinary mutations emit
`origin: "authoritative"`. `restore` emits the separate snapshot event
`{ kind: "snapshot", origin: "snapshot", revision }`, so observers cannot
mistake state installation for an operation sequence. Existing projected
`feed(path, listener)` behavior is unchanged.

Document replay validates and plans every graph operation against detached
candidates before one atomic root, identity-index, and revision swap. It
preserves element versus fragment mode, applies the supplied revision exactly,
and emits no second authoritative commit. `restore` performs the analogous
atomic snapshot install without incrementing revision or publishing a commit.

Persisted `data-_quid` identity is sparse. A present QUID is exactly 16
characters from the lowercase Crockford-style alphabet
`0123456789abcdefghjkmnpqrstvwxyz` and is stored in
`_meta["data-_quid"]`. Ordinary elements may remain
unquidded; construction, reads, capture, and installation preserve the identity
state they receive and never mint identity. Replay and restoration also
preserve valid QUIDs exactly. Present QUIDs are indexed per map, and duplicates
are rejected. A future durable handle or binding may
explicitly promote a node as a committed graph mutation; no promotion API exists
yet.

---

## Live paths

```ts
type LivePathPart = string | number;
type LivePath = readonly LivePathPart[];
```

Runtime path validation requires:

- an array;
- string object-key parts; or
- non-negative integer numeric parts.

The empty path `[]` identifies the projected root. Negative indexes are not
valid path parts, even though several array helper methods accept negative
method arguments.

Paths are defensively copied by public handles, subscriptions, and operation
records. Mutating the array originally supplied by the caller does not move an
existing handle or subscription.

Package-root path helpers:

```ts
format_live_path(path)
path_is_prefix(prefix, path)
paths_overlap(a, b)
```

`path_is_prefix` uses strict segment equality and treats a path as its own
prefix. `paths_overlap` is symmetric and returns true when either path is an
ancestor-or-self prefix of the other.

---

## Core reads

```ts
map.root(): HsonNode
map.snap(): JsonValue | undefined
map.snap(path): JsonValue | undefined
map.rev: number
```

`snap()` returns the complete projected value. `snap(path)` returns the value at
one projected path, or `undefined` when it does not resolve. Objects and arrays
are reconstructed from the graph, so snapshot mutation does not mutate the
LiveMap.

`root()` returns a detached structural clone of the complete canonical HSON
root. It preserves tags, content, attrs, metadata, QUIDs, and primitive values
without sharing node, content-array, attrs-object, or metadata-object identity
with the graph owned by the map.

Use `map.debug.node(path)` only when intentionally accessing the live owned
graph.

The package root also exports:

```ts
snap_live_path(root, path)
```

This is the lower-level projected reader used by Core.

---

## Core mutations

```ts
map.set(path, value)
map.setMany(path, values)
map.replace(value)
map.replace(path, value)
map.delete(path)
map.splice(path, start, deleteCount, ...items)
map.batch(fn)
```

Every method returns a `LiveMapCommit`. Values must be finite, JSON-compatible
data: string, finite number, boolean, `null`, plain object, or array recursively
containing those values. `undefined`, functions, symbols, bigint, non-finite
numbers, class instances, Maps, Sets, Dates, and other non-plain objects are
rejected.

### `set(path, value)`

`set` requires `path` to resolve. It does not create a missing endpoint or
missing parent path.

```ts
map.set(["count"], 1);
map.set(["items", 0], { id: "a" }); // existing index only
```

Primitive, array, and null values assign the endpoint. A plain object set has
two modes:

- at an existing object endpoint, it becomes shallow child writes and
  preserves unspecified siblings;
- at an existing non-object endpoint, it replaces that endpoint with the
  supplied object through a set-shaped operation.

It is not a recursive deep merge. Setting `{}` at an object endpoint performs
no child writes and does not clear the object. Use `replace(path, {})` or
`handle.object.clear()` to clear it.

`set([])` is not a root replacement operation and currently fails in the
editor. Use `replace(value)`.

### `setMany(path, values)`

Requires `path` to resolve to a plain object. Each own enumerable input key
becomes a child-path set:

```ts
map.setMany(["user"], {
  name: "Ada",
  role: "author",
});
```

Missing child keys can be created, but the parent object must already exist.
Unspecified siblings survive. An empty values object returns a no-op commit.

### `replace(value)` and `replace(path, value)`

Performs exact replacement:

```ts
map.replace({ ready: true });
map.replace(["user"], { name: "Ada" });
```

The one-argument form replaces the projected root. Core overwrites the owned
root node object in place so existing Core and path-handle closures remain
attached.

The two-argument form requires the endpoint to exist and removes any
unspecified data inside the replaced endpoint.

### `delete(path)`

Deletes an existing projected object property. A missing path throws. The empty
root path and direct array-index deletion are unsupported by the current
editor. Use array helpers or `splice` for arrays.

### `splice(path, start, deleteCount, ...items)`

Requires an array at `path` and emits one semantic splice operation.

- `start` must be an integer.
- Negative `start` counts back from the array length and clamps at zero.
- A positive start beyond the end clamps to the end.
- `deleteCount` must be a non-negative integer and clamps to the available
  suffix.
- Inserted items must be JSON values.

Unlike whole-array transformations, the resulting commit retains `removed` and
`inserted` intent.

---

## Commits and operations

```ts
type LiveMapCommit = Readonly<{
  changed: boolean;
  rev: number;
  prevRev: number;
  ops: readonly LiveMapOp[];
}>;
```

A changed commit has one or more operations and advances the revision exactly
once. A no-op commit has `changed: false`, no operations, and equal `rev` and
`prevRev`.

### Set operation

```ts
type LiveMapSetOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;
```

Object-valued constructive sets and `setMany` normally emit one set operation
per changed child. Unchanged child writes are omitted.

### Replace operation

```ts
type LiveMapReplaceOp = Readonly<{
  kind: "replace";
  path: LivePath;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;
```

### Delete operation

```ts
type LiveMapDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: JsonValue | undefined;
  next: undefined;
}>;
```

### Splice operation

```ts
type LiveMapSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly JsonValue[];
  inserted: readonly JsonValue[];
  prev: JsonValue;
  next: JsonValue;
}>;
```

Operation paths and values are detached from caller input and map state. The
types are readonly, but callers should treat commit records as immutable data;
the complete nested commit structure is not uniformly deep-frozen at runtime.

---

## Batches

```ts
const commit = map.batch((tx) => {
  tx.set(["user", "name"], "Ada");
  tx.setMany(["settings"], { theme: "dark" });
  tx.replace(["summary"], { ready: true });
  tx.splice(["items"], 0, 1, replacement);
  tx.delete(["obsolete"]);
});
```

Transaction methods return the same `tx` for chaining. Each staged operation
sees the candidate produced by earlier staged operations. The complete
candidate is schema-validated and editor-preflighted before the live root is
changed.

The callback is synchronous. It is not awaited. The transaction closes when
the callback returns or throws; calling a captured `tx` later throws. If the
callback or preflight throws, no staged write is applied. A successful batch
returns one commit and advances the revision at most once.

---

## Path handles

```ts
const handle = map.at(["user", "name"]);
```

Surface:

```ts
handle.quid
handle.path()
handle.snap()
handle.set(value)
handle.replace(value)
handle.setMany(values)
handle.delete()
handle.update(updater)
handle.array
handle.object
handle.feed(listener)
handle.linkTo(target)
```

Core caches path handles by canonical path. Repeated `map.at()` calls for equal
paths return the same handle object. The handle follows that location as state
changes.

`path()` returns a defensive copy. `snap()` reads the current projected value.
Mutation methods delegate to Core with the handle's path and retain the same
strict path rules.

`update(fn)` synchronously reads the current value, calls the updater, and
passes its JSON result through `set`. It is not compare-and-swap, async, or a
separate transaction. Object results use constructive set semantics.

`quid` is lazily assigned to the handle object. It does not identify the HSON
node currently occupying the handle path and is not stored in projected JSON.

---

## Object handle

Available at `handle.object`:

```ts
object.is()
object.toObject()
object.pick(keys)
object.omit(keys)
object.hasKey(key)
object.getKey(key)
object.keys()
object.isEmpty()
object.size()
object.values()
object.entries()
object.setKey(key, value)
object.setMany(values)
object.clear()
object.deleteKey(key)
object.deleteMany(keys)
object.renameKey(fromKey, toKey)
```

`is()` is a non-throwing kind check. Other reads and mutations require the
handle path to resolve to a plain object and throw otherwise.

Read methods return projected values/copies rather than mutable access to the
map. `pick` emits keys in the requested order when present; `omit` retains the
source object's enumeration order.

`setKey` and `setMany` can create child keys under the existing object and
preserve unspecified siblings. `clear` exactly replaces the object with `{}`.

`deleteKey` returns a no-op commit if the key is absent. `deleteMany` deduplicates
the requested keys, deletes only existing keys, and returns one batch commit.

`renameKey` performs whole-object replacement. It returns a no-op when the
source key is absent or both names are equal. If the destination key already
exists, the moved source value replaces it.

---

## Array handle

Available at `handle.array`:

```ts
array.is()
array.toArray()
array.slice(start?, end?)
array.take(count)
array.drop(count)
array.takeLast(count)
array.dropLast(count)
array.length()
array.isEmpty()
array.at(index)
array.first()
array.last()
array.includes(value)
array.indexOf(value)

array.push(value)
array.pushMany(values)
array.unshift(value)
array.unshiftMany(values)
array.pop()
array.shift()
array.clear()
array.reverse()
array.sortNumbers(direction?)
array.sortStrings(direction?)
array.splice(start, deleteCount?, ...items)
array.insert(index, value)
array.remove(index)
array.replace(index, value)
array.move(fromIndex, toIndex)
array.unique()
array.removeValue(value)
array.removeAll(value)
```

`is()` is the non-throwing kind check. Every other method requires an array.
`toArray` and slicing helpers return detached arrays.

### Index rules

`at`, `remove`, `replace`, `first`, and `last` require an existing item.
Negative indexes count from the end. Empty-array `first`, `last`, `pop`, and
`shift` throw rather than returning `undefined` or a no-op commit.

`insert` also accepts negative indexes, resolved against the current length;
the final index may equal the length. It rejects positions outside that range.

`slice` follows JavaScript slice index behavior but requires integer indexes.
`take`, `drop`, `takeLast`, and `dropLast` require non-negative integer counts.

### Mutation operation shapes

The following preserve semantic splice operations:

- `push`, `pushMany`, `unshift`, `unshiftMany`;
- `pop`, `shift`, and `splice`;
- `insert`, `remove`, and indexed `replace`.

The following compute a complete next array and emit a set-shaped operation:

- `clear`, `reverse`, `sortNumbers`, and `sortStrings`;
- `move`, `unique`, `removeValue`, and `removeAll`.

`move` resolves the destination after removing the source item. `sortNumbers`
and `sortStrings` validate every item and accept `"asc"` (default) or `"desc"`.

`includes`, `indexOf`, `unique`, `removeValue`, and `removeAll` use structural
JSON equality. Object key order is ignored; array order is significant.
`removeValue` removes the first match; `removeAll` removes every match.

---

## Proxy paths

```ts
const state = map.proxy();
const user = map.proxy(["user"]);

state.user.name.$_.snap();
state.user.name.$_.set("Ada");
state.items[0].$_.replace({ id: "a" });
```

`$_` returns the cached path handle for the proxy's current path. All other
ordinary property reads extend the path. Canonical non-negative safe-integer
property names become numeric array indexes; other names remain string keys.

Child proxies are cached, so repeated access is identity-stable:

```ts
state.user === state.user // true
```

Direct assignment, deletion, property definition, prototype mutation, and
extensibility mutation throw. The Proxy has a null prototype and intentionally
ignores implicit runtime probes such as `then`, `toJSON`, `toString`,
`constructor`, and `__proto__`. Data with a reserved name remains accessible
through an object handle:

```ts
state.$_.object.getKey("then")
```

The package root also exports `make_livemap_proxy(core, path?)`.

---

## Feeds

```ts
const dispose = map.feed(["user"], (event) => {
  event.path;
  event.op;
  event.ops;
  event.value;
  event.commit;
});

dispose();
dispose(); // harmless
```

A feed fires when an operation path overlaps the subscription path in either
direction. Siblings do not overlap. Each subscriber fires at most once per
changed commit.

```ts
type LiveMapFeedEvent = Readonly<{
  op: LiveMapOp;
  ops: readonly LiveMapOp[];
  path: LivePath;
  value: JsonValue | undefined;
  commit: LiveMapCommit;
}>;
```

`op` is the first matching operation; `ops` contains all matches. `value` is a
fresh read of the subscriber's path after the complete commit, so a parent feed
receives the complete updated parent value.

Feeds are not immediate: registration does not call the listener with current
state. Emission is synchronous after the graph and revision have committed.
Listener exceptions are not caught. A thrown listener escapes the mutation call
after the state change and can prevent later feed entries from running in that
emission pass.

No-op and rejected mutations do not emit.

---

## Store-style subscriptions

`map.sub` is callable and also has named methods:

```ts
map.sub(listener)
map.sub.diff(listener)
map.sub.sel(selector, listener, options?)
map.sub.path(path, listener, options?)
```

All return idempotent disposer functions and are non-immediate.

### `map.sub(listener)`

Subscribes at root and calls `listener(nextRoot)` for every changed commit. It
does not compare with the previous root.

### `map.sub.diff(listener)`

Calls `listener(nextRoot, previousRoot)` only when JSON string signatures
differ. Snapshots are cloned before delivery.

### `map.sub.sel(selector, listener, options?)`

Runs the selector against cloned root state after every changed root event and
calls:

```ts
listener(nextSelected, previousSelected, currentRoot)
```

Default equality is `Object.is`. Because snapshots are cloned, selectors that
return new object/array references normally notify on every changed commit.
Supply `{ equal(next, prev) }` for structural or domain equality.

### `map.sub.path(path, listener, options?)`

Subscribes to overlapping operations and calls:

```ts
listener(nextValue, previousValue, feedEvent)
```

Default path equality compares JSON string signatures. A custom `equal`
function receives cloned values.

The package root exports `make_livemap_store_api(map)`, which returns the same
surface under the names `snapshot`, `subscribe`, `subscribeDiff`,
`subscribeSel`, and `subscribePath`.

---

## Schema construction

`hson.liveMap.schema` combines the schema builder with `define` and `make`:

```ts
const schema = hson.liveMap.schema.define((s) => ({
  id: s.string,
  count: s.number,
}));

const equivalent = hson.liveMap.schema.make({
  id: hson.liveMap.schema.string,
  count: hson.liveMap.schema.number,
});
```

Package-root equivalents:

```ts
define_livemap_schema(makeShape)
make_livemap_schema(input)
LIVEMAP_SCHEMA
```

Allowing `define` to infer the schema variable preserves its static value type.
Avoid widening it to bare `LiveMapSchema`, which intentionally means
`LiveMapSchema<unknown>`.

### Primitive and literal tokens

```ts
s.unknown
s.string
s.number
s.boolean
s.null
s.literal("draft", "published", 1)
```

`unknown` means any JSON value; it does not admit JavaScript `undefined` unless
made optional in an object position.

### Choices and tagged choices

```ts
s.pick(s.string, s.number, null)

s.tagged("kind", {
  text: { value: s.string },
  count: { value: s.number },
})
```

`pick` accepts schema inputs and literal JSON choices. `tagged` constructs an
object choice for each variant with a literal discriminator.

### Collections and objects

```ts
s.array(s.string)
s.string.array
s.tuple(s.string, s.number)
s.record(s.boolean)
s.object({ name: s.string })
s.exact({ name: s.string })
s.partial({ name: s.string, age: s.number })
s.deepPartial({ profile: { name: s.string } })
```

`object` validates declared properties and allows additional keys. `exact`
rejects additional keys. `partial` makes the declared top-level properties
optional. `deepPartial` recursively optionalizes declared object, array, tuple,
and record structures.

Plain schema shapes are normalized as ordinary object schemas.

### Lazy and refined schemas

```ts
const Node = s.lazy(() => ({
  value: s.string,
  children: Node.array.optional,
}));

const Positive = s.refine(
  s.number,
  "positive number",
  (value) => value > 0,
);
```

Lazy inputs are memoized when resolved. Refinement first validates its base and
then calls the supplied predicate.

### Token modifiers

Every token exposes:

```ts
token.optional
token.nullable
token.readonly
token.array
```

`optional` permits a missing/undefined value where the enclosing structure can
omit it. `nullable` additionally permits `null`. `array` wraps the token as an
array item schema.

`readonly` is currently recorded in public schema rules but is not checked by
the LiveMap mutation pipeline. It must not presently be used as write
authorization.

---

## Schema inspection and attachment

Schema object surface:

```ts
schema.root
schema.rules
schema.match(path)
schema.resolve(path)
schema.has(path)
schema.must.resolve(path)
schema.validateRoot(value)
schema.validateValue(path, value)
```

`rules` is the compiled public rule list. Array-item and record-value rules use
`"*"` in their public display paths, while runtime matching distinguishes
numeric array indexes from string record keys.

`match` returns the matching public rule. `resolve` additionally returns the
concrete path, key, parent path, and parent rule when available. `has` is the
boolean form. `must.resolve` throws when no rule exists.

Validation returns:

```ts
type LiveMapSchemaValidation = Readonly<{
  ok: boolean;
  issues: readonly LiveMapSchemaIssue[];
}>;
```

Issue codes include:

```ts
"TYPE_MISMATCH"
"MISSING_REQUIRED"
"UNKNOWN_PATH"
"UNKNOWN_KEY"
"INVALID_LITERAL"
"INVALID_REFINEMENT"
"INVALID_SCHEMA"
"TUPLE_INDEX_OUT_OF_RANGE"
```

Attach a schema through the map:

```ts
const typedMap = map.schema.use(schema);
const typedAlias = map.withSchema(schema);
```

Attachment first validates the current projected root. The returned object is
the same runtime map with a schema-derived TypeScript view. A later `use` call
replaces the attached schema after validating current state; there is no detach
method.

Map inspection mirrors schema inspection:

```ts
map.schema.get()
map.schema.match(path)
map.schema.resolve(path)
map.schema.has(path)
map.schema.must.resolve(path)
```

When no schema is attached, `get`, `match`, and `resolve` return `undefined`,
`has` returns false, and `must.resolve` throws.

Every projected mutation validates the complete candidate root. Schema failure
throws exported `LiveMapSchemaError` with:

```ts
error.code   // "SCHEMA_VALIDATION"
error.path
error.issues
```

Failure occurs before live graph mutation, consumes no revision, and emits no
feed event. Direct `debug.node()` mutation is outside schema enforcement.

---

## Revision synchronization

A revision counts committed state transitions applied to one LiveMap instance.
Normal construction establishes initial state at revision 0 and emits no commit
or feed event. The first changed atomic transition advances revision 0 to 1;
unchanged operations consume no revision.

### Incremental document operations

Element and fragment maps share the `document` operation façade. Attribute
verbs live under `attrs`; content verbs live under the callable `content`
capability:

```ts
const target = { kind: "path", path: [] } as const;

elementMap.document.attrs.get(target, "aria-label");
elementMap.document.attrs.must.get(target, "aria-label");
elementMap.document.attrs.has(target, "aria-label");
elementMap.document.attrs.keys(target);
elementMap.document.attrs.set(target, "aria-label", "Save");
elementMap.document.attrs.setMany(target, { id: "save", hidden: false });
elementMap.document.attrs.drop(target, "aria-label");
elementMap.document.attrs.dropMany(target, ["id", "title"]);
elementMap.document.attrs.clear(target);
elementMap.document.attrs.replace(target, { role: "button", tabindex: 0 });
elementMap.document.content.replace(target, 0, replacement);
elementMap.document.content.insert(target, 1, content);
elementMap.document.content.remove(target, 0);
elementMap.document.content.move(target, 2, 0);

fragmentMap.document.attrs.set(
  { kind: "quid", quid: "persisted-id" },
  "hidden",
  "hidden",
);
fragmentMap.document.content.replace(
  { kind: "path", path: [] },
  1,
  replacement,
);
```

There are deliberately no `setAttr`, `setAttrs`, `removeAttr`, or
`replaceContent` methods.
The existing detached read remains `capability.content()`; the content methods
mutate canonical physical slots without exposing owned content.

All document operations share one exact target union:

```ts
type LiveMapDocumentTarget =
  | Readonly<{ kind: "path"; path: readonly number[] }>
  | Readonly<{ kind: "quid"; quid: string }>;
```

The discriminator is authoritative. Node objects, DOM nodes, detached reads,
and objects containing competing `path` and `quid` fields are rejected.

A document path traverses physical canonical `$_content`, not projected JSON,
DOM children, CSS selectors, or LiveTree rendering. Every segment must be a
finite non-negative integer and counts all physical slots, including HSON text
and structural wrapper nodes. For an element map, `[]` identifies its one
ordinary top-level element. For a fragment map, `[]` identifies the canonical
`_hson_elem` fragment cluster. Paths may end at a node or primitive, but
attribute reads and mutation require an ordinary-element endpoint and content
mutation requires a node endpoint.

QUID targets resolve only through the map-local sparse persisted-identity
index. Only an ordinary element already carrying a valid `data-_quid` can be
resolved. Lookup never mints identity, does not consult the LiveTree or `lmq`
registries, and cannot resolve a foreign map's identity.

`attrs.set()` accepts the existing canonical primitive attribute values and a
structured style map for `style`; structured input is cloned. Assigning a
canonically identical value is a no-op. `attrs.drop()` removes one existing
ordinary attribute; an absent attribute is a no-op. Names beginning `data-_`
are persisted metadata rather than ordinary attributes and cannot be changed
through this namespace, including `data-_quid`.

The four attribute reads inspect canonical HSON state rather than a mounted
DOM. `attrs.get()` returns the canonical value or `undefined` when the valid
public name is absent; `attrs.has()` tests own-key presence; and `attrs.keys()`
returns a fresh, frozen, lexically ordered list of public ordinary names.
Consequently `false`, `0`, `null`, and the empty string are all present values.
The structured `style` attribute is returned as its canonical `CssMap`, not as
serialized CSS. Structured results from `attrs.get()` and
`attrs.must.get()` are recursively detached and frozen, so callers cannot
mutate authority state through a read.

`attrs.must.get()` uses the same target resolution, protected-name policy, and
canonical lookup as `attrs.get()`, but a valid absent name throws exported
`LiveMapDocumentAttributeNotFoundError` with code
`DOCUMENT_ATTRIBUTE_NOT_FOUND`. Attribute keys never include `$_meta`,
persisted QUIDs, or system-owned `data-_` projection. Reads do not create
`$_attrs`, construct graph operations, advance revisions, append history,
publish, or notify subscribers.

All four bulk methods derive a complete final ordinary-attribute bag and apply
it atomically through one `replace-attrs` operation. `attrs.setMany()` preserves
current names not present in its values record and never treats a value as
deletion. `attrs.dropMany()` accepts one readonly string array, ignores valid
absent names and duplicates, and preserves every name not requested.
`attrs.clear()` installs the empty ordinary bag. `attrs.replace()` makes the
complete ordinary bag exactly equal to its values record, removing omitted
names. Every name and value is validated before mutation; malformed or
`data-_*` names reject the whole call. Canonical values are finite HSON
primitives (`string`, `boolean`, `number`, or `null`) plus the existing
structured style map. Empty or canonically equal results are no-ops.

Bulk mutation never changes `$_meta`, persisted QUID lookup, tag, content, or
document mode. An empty final bag compacts away `$_attrs`. A changed call emits
one commit, revision transition, observation, history entry, and publication at
most; failure emits none.

`content.replace()` replaces exactly one existing physical `$_content` slot.
It never inserts, deletes, splices, or replaces the root. A replacement may be
one HSON node or a finite HSON primitive, but the completed candidate must pass
the current canonical invariants and retain the map's element/fragment mode.
The replacement is cloned before ownership. Canonically identical detached
nodes and identical primitives are no-ops.

`content.insert(target, index, content)` inserts exactly one slot. `index` must
be a non-negative integer from `0` through the current content length,
inclusive; the length appends and `0` inserts into empty content. String input
inserted into an `_hson_elem` cluster becomes its canonical `_hson_str` node.
Other primitive or node inputs remain subject to the target's canonical HSON
invariants. Input and operation payload nodes are detached from caller-owned
state.

`content.remove(target, index)` removes exactly one existing slot. Its valid
range is `0` through `content.length - 1`; indexes are never clamped. The
candidate must retain the map's element or fragment mode.

`content.move(target, from, to)` moves exactly one existing slot atomically.
Both indexes use the pre-move range `0` through `content.length - 1`, and `to`
is the final position occupied by the moved item. Thus moving index `1` to `3`
in `[A, B, C, D]` produces `[A, C, D, B]`, while moving `3` to `1` produces
`[A, D, B, C]`. Move is one graph operation, not remove plus insert. Equal
indexes are a complete no-op: no revision, observation, history, or
publication.

Content replacement preflights the complete sparse identity result. Removed
subtree identities disappear, incoming identities are indexed, unquidded nodes
remain unquidded, and a QUID displaced by the same slot may be reused. Invalid,
duplicate, or retained-colliding QUIDs reject atomically. Root, identity index,
revision, and commit output change together only after validation succeeds.

Changed standalone calls advance one local revision and return exactly one of:

```ts
{ domain: "graph", op: "set-attr", target, name, value }
{ domain: "graph", op: "remove-attr", target, name }
{ domain: "graph", op: "replace-attrs", target, attrs }
{ domain: "graph", op: "replace-content", target, index, replacement }
{ domain: "graph", op: "insert-content", target, index, content }
{ domain: "graph", op: "remove-content", target, index }
{ domain: "graph", op: "move-content", target, from, to }
```

No-op calls return `changed: false` with no operations. These operations exist
only on element and fragment capability surfaces; data-object and data-array
maps do not expose them. Canonical graph commits use the existing atomic replay
path and shared commit observer; there is no document batching API.

`replace-attrs` is the atomic final-state replacement of a target's
complete public ordinary-attribute bag. Its readonly payload contains canonical
primitive values and the existing structured style map, excludes system
metadata (`data-_*` / `$_meta`), and is detached before application. Omitted
ordinary attributes are removed, while an empty bag clears all ordinary
attributes and compacts away `$_attrs`. Canonically equal bags are unchanged,
including differences in key order. Public `setMany`, `dropMany`, `clear`, and
`replace` use this operation exclusively. Existing public single-attribute
`set` and `drop` methods continue to emit `set-attr` and `remove-attr`.

### Document `capture()`

Document maps capture the complete canonical graph rather than projected JSON:

```ts
type DocumentLiveMapCapture = Readonly<{
  kind: "hson-document";
  version: 1;
  mode: "element" | "fragment";
  rev: number;
  root: HsonNode;
}>;
```

The root is recursively detached and preserves tags, ordered mixed content,
attrs, structured style, metadata, QUIDs, text, empty content, and repeated
siblings. Capture does not change the revision. Graph install and replay are not
interchangeable: `install()` is a local state transition, while `replay()`
applies one validated canonical graph commit at its supplied revision.

### Document `install(capture, options?)`

```ts
const commit = target.install(source.capture(), {
  expectedRev: target.rev,
});
```

Installation accepts a canonical `DocumentLiveMapCapture` with optional sparse
persisted identity. It
validates the envelope, clones and validates the canonical root, requires the
declared/root/target modes to agree, and builds a replacement per-map QUID index
before changing owned state. Missing QUIDs are valid absence; empty or duplicate
present QUIDs are rejected. Installation never mints or remaps identity.

The owned root and identity index are replaced atomically. A changed install
increments the target revision exactly once and returns the existing commit
envelope with one graph-domain operation:

```ts
{
  domain: "graph",
  op: "replace-root",
  mode: "element" | "fragment",
  root: detachedCanonicalRoot,
}
```

`capture.rev` describes the source map and is not copied into the target. A
future recovery install may restore an authoritative remote revision; this
local `install()` does not. `expectedRev`, when present, guards the target's
current revision and throws `LiveMapRevError` on mismatch. Invalid input,
identity failure, and mode mismatch leave root, QUID lookup, revision, and
commit state unchanged.

Installing a canonically identical graph follows existing replacement no-op
behavior: it returns `changed: false`, no operations, and consumes no revision.
Document graph commits are not accepted by data `replay()` and are not yet
published through a projected path feed. Incremental document operations use
their own `set-attr`, `remove-attr`, `replace-attrs`, `replace-content`, `insert-content`,
`remove-content`, and `move-content` records; they never masquerade as
`replace-root` installation.

The input capture, installed owned root, later captures, and returned operation
root share no mutable references. `debug.node()` can still damage live graph or
identity assumptions without a revision; a later valid install replaces both
the damaged root and index rather than trusting either one.

### `capture()`

```ts
const capture = map.capture();

type LiveMapCapture<T> = Readonly<{
  rev: number;
  value: T;
}>;
```

This projected data capture belongs to data-object and data-array maps. Its
value is detached from later map mutations. It is not the document snapshot
model and intentionally does not use the transform layer's `_hson_elem` JSON
representation.

### `apply({ prevRev, value })`

Conditionally replaces the root when `prevRev === map.rev`:

```ts
map.apply({ prevRev: capture.rev, value: nextRoot });
```

`prevRev` must be a non-negative integer. `value` must be an actual JSON value;
despite the generic default allowing `undefined` in some type positions,
runtime apply rejects it.

A stale revision throws an error named `LiveMapRevError` with code
`"STALE_REV"`, `expectedRev`, and `actualRev`. That class is currently not
re-exported from the package root.

### `replay({ prevRev, ops })`

Replays normalized public operations atomically:

```ts
map.replay({
  prevRev: commit.prevRev,
  ops: commit.ops,
});
```

Replay validates the envelope and operations, checks the revision, verifies
each declared `prev` against candidate state, applies the semantic intent to
the candidate, and verifies the declared `next`. Schema and editor preflight
then run before live mutation.

Failure categories:

- malformed input: error name `LiveMapReplayInputError`, code
  `"INVALID_REPLAY"`;
- stale revision: `LiveMapRevError`, code `"STALE_REV"`;
- value conflict: `LiveMapReplayError`, code `"REPLAY_CONFLICT"`;
- schema rejection: exported `LiveMapSchemaError`.

Replay/Rev error classes are thrown by the current implementation but are not
currently package-root exports. Callers can inspect `name` and `code`.

---

## One-way links

### Handle link

```ts
const dispose = source.at(["draft"]).linkTo(target.at(["published"]));
```

This subscribes to the source handle path and writes the final scoped value to
the target after later changes. It performs no initial synchronization.

Set-shaped changes use target set semantics; replace-shaped changes use target
replace semantics. Exact/ancestor deletion deletes the target handle. A delete
below the source handle replaces the target with the remaining current source
subtree.

When the target is a missing string-key object child whose parent exists,
internal handle metadata allows link propagation to create that child through
`setMany`. Other missing targets retain normal strict write behavior.

There is no loop protection, transform, conflict resolution, or error
isolation.

### Core link

The package root exports:

```ts
link_livemap(source, target, { path })
link_livemap(source, target, { from, to })
```

The first form keeps paths the same. The second replaces the source `from`
prefix with `to` while preserving the suffix.

This lower-level implementation forwards set, replace, and delete effects but
does not currently handle a standalone semantic splice operation. It also does
not initially synchronize state. Use it only within those current limits.

---

## Raw HSON node handle

```ts
const node = map.debug.node(path);
```

This surface is exposed only through `map.debug.node(...)`. It mutates the
owned HSON graph directly. It bypasses projected writes, schema validation,
commits, revisions, feeds, subscriptions, and ordinary LiveMap state
guarantees. It should be avoided in normal application state code.

This surface addresses the HSON wrapper node at a projected path, not the
ordinary projected JSON value:

```ts
node.path()
node.get()
node.must()
node.tag()
node.attrs()
node.attr(name)
node.setAttr(name, value)
node.setAttrs(attrs)
node.removeAttr(name)
node.clearAttrs()
node.meta()
node.content()
node.children()
node.childrenByTag(tag)
node.child(tag)
node.mustChild(tag)
node.append(child)
node.insert.child(index, child)
node.move.child(fromIndex, toIndex)
node.remove.children()
node.remove.child(index)
node.replace.children(children)
node.replace.child(index, child)
```

`get` returns `undefined` when unresolved; `must` throws. JSON wrapper
resolution takes precedence, then the resolver can follow direct tag children
and transparent `_hson_elem` clusters for HTML-shaped graphs.

`attrs()` returns a shallow copy, but attribute mutation is allowed only when
the resolved wrapper is backed by an `_hson_elem` child. JSON property wrappers
cannot acquire attributes merely because their key resembles an HTML tag.

`meta()` and `content()` expose the current node's live objects/array. `children`
returns a new array but its HSON child objects remain live references.

Child indexes count direct `HsonNode` children and ignore primitive content
slots. `replace.children` and `remove.children` preserve existing raw primitive
content. Move destinations are resolved after source removal.

Every mutation here edits the HSON graph directly. It bypasses JSON guards,
schema validation, commits, revisions, feeds, replay records, and invariant
validation. Invalid child input can create an invalid graph. This is an expert
escape hatch, not a substitute for projected mutation.

---

## Generic binding helpers

The package root currently exports UI-agnostic helper primitives:

```ts
make_microtask_scheduler(fn)
stop_all(disposers)
subscribe_paths(subscribePath, paths, listener)
bind_path(options)
bind_paths(options)
derive_from_paths(options)
```

`make_microtask_scheduler` coalesces synchronous requests into at most one run
per microtask. A request made while the callback runs can schedule a later
microtask.

`stop_all` returns one idempotent disposer and runs children in insertion order.
`subscribe_paths` subscribes one listener to several paths and combines their
disposers.

`bind_path` and `bind_paths` call `read()`, pass its result to `render()`, and
subscribe subsequent runs. They run immediately unless `immediate: false`.
Their optional `schedule(run)` hook supplies a scheduling wrapper.

`derive_from_paths` subscribes input paths and invokes `derive`. Unlike bind,
its immediate run occurs only when `immediate: true`.

These functions are exported but described in source as experimental candidates
for later API induction. The more specific current LiveTree bridge is
`tree.bind`, documented in `api-livetree.md`.

---

## Experimental QUID utilities

Package-root exports:

```ts
get_livemap_quid(owner)
get_livemap_owner(quid)
ensure_livemap_quid(owner, quid?)
reindex_livemap_quid(owner, quid)
drop_livemap_quid(owner)
remint_livemap_quid(owner)
debug_livemap_quids()
```

These maintain a process-local object-owner registry using strong QUID-to-owner
and weak owner-to-QUID mappings. Generated identifiers use the `lmq-` prefix and
`globalThis.crypto` randomness.

An owner can have one registered QUID; a QUID cannot belong to two live owners.
`ensure` returns existing identity, `reindex` imports known identity, `drop`
releases it, and `remint` replaces it. `debug_livemap_quids` is diagnostic only.

This registry does not write metadata into HSON or JSON and does not define
cross-process, persistence, snapshot, or host identity. Path-handle `quid` uses
this object-owner mechanism.

---

## Lower-level exported constructors

The package root also exports these implementation-oriented pieces:

```ts
make_livemap_core(root)
make_livemap_store_api(map)
make_livemap_feed_hub()
make_livemap_proxy(core, path?)
snap_live_path(root, path)
link_livemap(source, target, options)
```

`make_livemap_feed_hub()` returns:

```ts
hub.add(path, listener)
hub.emit(commit, snap)
```

The hub is graph-agnostic and performs overlap delivery using the supplied
snapshot reader. Most application code should use `hson.liveMap`, `map.feed`,
`map.sub`, and `map.proxy` rather than assembling these pieces directly.

There is currently no `hson-live/livemap` package subpath export. Public imports
described here are available from the main package entry unless explicitly
identified as methods on `hson.liveMap`.

---

## Current behavioral boundaries

- Reliable `fromJson` roots are objects and arrays; top-level scalars currently
  fail transform invariants.
- Normal object, array, HSON, node, trusted-HTML, and untrusted-HTML construction
  establishes initial state at revision 0 without a commit.
- Projected writes are strict about existing endpoints and parents.
- Root set/delete and direct array-index delete are unsupported; use root
  replace and array splice/helpers.
- Notifications are synchronous and listener exceptions occur after commit.
- Links are live-only and one-way; lower-level links omit standalone splice
  propagation.
- Schema `readonly` is not enforced.
- Raw root/node mutation is outside every projected-state guarantee.
- Experimental QUIDs identify JavaScript owners, not persistent graph nodes.



LiveMap separates projected state paths from physical HSON graph structure, 
allowing callers to mutate meaningful application state while preserving 
the structural wrappers required for HSON representation, serialization, and 
projection.


© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
