# LiveMap API reference

LiveMap owns a canonical HSON graph and exposes either projected JSON-path state
(`data-object`, `data-array`) or canonical document operations (`element`,
`fragment`). LiveMap owns canonical state; public observations are detached or
mediated and public mutation passes through LiveMap admission.

```ts
import { hson } from "hson-live";
import { hsonLiveMap, link_livemap } from "hson-live/livemap";
import type { LiveMap, LiveMapCommit, LivePath } from "hson-live/livemap";
```

`hson-live/livemap` is the supported subsystem entrypoint for LiveMap values,
helpers, structured errors, and types. The root remains the umbrella entrypoint,
and `hson-live/types` remains a broad type barrel rather than the owner of the
LiveMap vocabulary.

## Stability boundary

- **Public:** `hson.liveMap.*`, `make_livemap_core`, `link_livemap`, path/feed/
  proxy helpers exported by the package root, and exported LiveMap types.
- **Experimental:** document-mode LiveMaps, capture/install/replay, graph commit
  observation, links, and schema-derived typing.
- **Internal:** editor functions, path guards, transition controllers, identity
  indexes, canonical inspection, and direct graph preparation functions not
  package-exported.
- **Deferred:** primitive projected roots and transparent parity between proxy,
  projected paths, document paths, and physical HSON paths.

## Construction

### Projected data

```ts
const map = hson.liveMap.fromJson({
  user: { name: "Ada", active: true },
  tags: ["math"],
});

const sameShape = hson.liveMap.fromJson(
  '{"user":{"name":"Ada","active":true},"tags":["math"]}',
);
```

`fromJson` accepts a JSON value or JSON string and returns a data LiveMap.
Current canonical roots must be objects or arrays; primitive roots are not a
public data-map mode. Initial construction starts at revision `0` and emits no
commit.

`fromHson(string)` and `fromNode(HsonNode)` return `ClassifiedLiveMap`, whose
`mode` discriminates data from document APIs. The input node is prepared as
owned canonical state; `root()` returns detached clones.

```ts
const authored = `<'display name' "Ada" 'preferred pronoun' "she">`;
const classified = hson.liveMap.fromHson(authored);
```

Quoted property names use apostrophe delimiters in authored HSON. JavaScript
template-literal backticks belong to JavaScript and do not need per-name
escaping.

### Projected-value boundary

The canonical HSON graph is the authority for a data LiveMap. Internally,
LiveMap admits projected values into a private immutable ordered carrier while
it plans mutations, validates schemas, compares candidates, and prepares exact
transport. That carrier is transient machinery, not a second synchronized
state model or a public type.

JavaScript-value ingress accepts only:

- primitive strings, booleans, `null`, and finite primitive numbers;
- ordinary objects whose prototype is exactly `Object.prototype` or `null`;
- dense ordinary arrays whose prototype is exactly `Array.prototype`.

Objects must contain only enumerable own string-keyed data properties.
Accessors, nonenumerable properties, symbol keys, custom prototypes, class
instances, boxed primitives, and exotic built-ins are rejected. Arrays may
contain only a data property for every index plus their built-in `length`; holes,
explicit `undefined`, accessor indexes, symbol keys, and extra named properties
are rejected. Cycles reject. Repeated acyclic references are copied
structurally, so reference identity is not part of projected-value semantics.
Caller mutation after admission cannot affect the candidate or committed state.

Ordinary accessors are rejected from their descriptors without calling their
getter or setter. Arbitrary proxies are unsupported: JavaScript has no reliable
general proxy detector, and reflective admission may execute proxy traps.
Callers must not rely on acceptance, rejection, trap count, or side-effect-free
inspection of a proxy.

`__proto__`, `constructor`, and `prototype` are ordinary own data keys. Public
objects are freshly materialized with `Object.prototype`, and their properties
are defined rather than assigned, so those names cannot alter the result's
prototype. Every nested object and array is detached from the graph and from
other public materializations.

Canonical object-property order is explicit in the graph and private carrier.
Object-handle `keys()`, `values()`, and `entries()` read that order directly;
`root()` exposes it through a detached canonical graph. A public plain-object
snapshot follows JavaScript's own-key enumeration rules, which reorder
integer-index keys. It is therefore not an exact ordered persistence format,
and re-ingressing it may adopt that JavaScript-visible integer-key order.

### Documents

`fromTrustedHtml(string)` and `fromUntrustedHtml(string)` are public and return
an `element` or `fragment` LiveMap. Trusted input is unsanitized; untrusted input
is sanitized. String parsing is DOM-free. These factories do not accept an
`Element`, unlike the transformer/LiveTree HTML factories.

### Schema and proxy

Attach a defined schema with `map.schema.use(schema)`. It returns the same
runtime map with a schema-derived TypeScript view. Create a
proxy at any projected path with `map.proxy(path?)`.

## Projected paths

```ts
type LivePath = readonly (string | number)[];
```

Strings address object keys and numbers address array indexes. Paths address the
JSON projection, not wrapper/content locations in physical HSON. `[]` is the
projected root. Inputs are validated and copied; handles return defensive path
copies.

Object keys are exact strings. Array path segments must be valid existing
indexes for strict writes. Invalid segment types, unresolved paths, wrong
container kinds, and out-of-range indexes produce path-aware errors. Paths are
not auto-normalized from dotted strings or numeric strings.

There is no public raw-node or graph-owner getter. Use `snap(path)` for detached
projected values, `root()` for a detached canonical graph, and document APIs for
document attributes/content. The former `map.debug.node(...)` escape hatch has
been removed and has no public raw-node replacement.

Document structural targets use a separate type:
`{ kind: "path"; path: readonly number[] } | { kind: "quid"; quid: string }`.
Those numbers traverse canonical `$_content`, not projected arrays.

## Reads and revision

```ts
map.snap();                    // cloned root value
map.snap(["user", "name"]);   // cloned value or undefined
map.at(["tags"]).snap();      // cloned value
map.rev;                      // current revision
map.root();                   // detached HsonNode clone
map.capture();                // { rev, value }
```

`snap(path?)` never returns a live object/array reference. A missing projected
path returns `undefined`; wrong path syntax throws. `at(path)` always creates a
stable path handle, even if the path is currently missing; `handle.snap()` then
returns `undefined`. There is no map-level `get`/`has` method. Use `snap`, object
handle `hasKey`, schema `has`, or a proxy handle as appropriate.

`capture()` returns a detached compatibility `value`, its exact revision, and a
versioned structural-JSON envelope (`format`, `formatVersion`, `payload`). The
payload preserves ordered object entries and `-0`; the plain JavaScript `value`
does not preserve arbitrary integer-key order. `restore`, `apply`, and `replay`
prefer exact fields whenever any exact transport field is present. Malformed or
unsupported exact data rejects and never falls back to the compatibility value.
Legacy value/op-only inputs remain readable but are lossy; no release is
currently assigned for their removal.

## Core projected writes

Every write returns:

```ts
type LiveMapCommit = Readonly<{
  changed: boolean;
  rev: number;
  prevRev: number;
  ops: readonly LiveMapDataOp[];
}>;
```

### `set(path, value)`

The path must already resolve. At an object-valued endpoint, `set` is a shallow
sibling-preserving write: supplied keys become child `set` operations.
Arrays/primitives are endpoint values. `set([])` is invalid.

### `setMany(path, values)`

The endpoint must be an existing object. Each supplied property is written as a
child; missing child keys are created, while unspecified siblings remain.

### `replace(path?, value)`

`replace(value)` replaces the root. `replace(path, value)` destructively
replaces one existing endpoint, including an object. Use it when exact
replacement rather than an object patch is intended.

### `delete(path)`

Deletes an existing object property or array item. A missing endpoint is a
no-op. Root deletion is invalid.

### `splice(path, start, deleteCount, ...items)`

Splices an existing array. The normalized commit records removed and inserted
values and full before/after endpoint values.

### `update`

`update` is a path-handle method:

```ts
const commit = map.at(["user", "active"]).update((active) => !active);
```

The updater reads the current cloned value, returns a `set` value, and commits
synchronously. It is not a compare-and-swap primitive.

Before application, writes are normalized and previewed on a clone. An attached
schema validates the prospective final root atomically. On failure the live
graph, revision, feeds, and subscribers are unchanged.

```ts
map.set(["user", "name"], "Grace");
map.setMany(["user"], { name: "Katherine", active: false });
map.at(["tags"]).array.push("computing");
map.at(["tags"]).array.move(1, 0);
```

No-op commits have `changed: false`, no ops, and `rev === prevRev`. Changed
commits advance exactly once.

## Path handles

`map.at(path)` returns a `LiveMapPathHandle` with:

- `path()`, `snap()`, and `rev`;
- `at(relativePath)`;
- `set`, `setMany`, `replace`, `delete`, and `update`;
- `.object` and `.array` helper namespaces;
- `feed(listener)`;
- `linkTo(target)`.

Handles retain path identity, not a frozen node/value. Reads and writes resolve
against the map's current graph. Handles are interned by canonical path within
one map and expose no persistent or process-global identifier.

## Object helpers

`handle.object` provides `is`, `toObject`, `pick`, `omit`, `hasKey`, `getKey`,
`keys`, `values`, `entries`, `size`, and `isEmpty`, plus:

- `setKey(key, value)`: creates a missing key under an existing object;
- `setMany(values)`: shallow child writes;
- `deleteKey(key)`: missing key is a no-op;
- `deleteMany(keys)`: one normalized commit;
- `renameKey(from, to)`: moves the source entry in place; a missing source rejects,
  an existing destination is replaced, and `from === to` is a no-op after source
  validation;
- `clear()`: removes all keys in one commit.

These methods reject a non-object or missing handle endpoint. They do not replace
the containing object unless their documented final state happens to be empty.

## Array helpers

Read helpers include `is`, `toArray`, `slice`, `take`, `drop`, `takeLast`,
`dropLast`, `length`, `isEmpty`, `at`, `first`, `last`, `includes`, and
`indexOf`.

Writes include `push`, `pushMany`, `unshift`, `unshiftMany`, `pop`, `shift`,
`clear`, `reverse`, `sortNumbers`, `sortStrings`, `splice`, `insert`, `remove`,
`replace`, `move`, `unique`, `removeValue`, and `removeAll`.

Helpers require an existing array endpoint and write through the normal pipeline.
`move(from, to)` is a semantic operation whose indexes must be nonnegative safe
integers resolving in the staged array. Negative-index convenience does not apply
to move. The destination is the final index after removal, and each intervening
sibling shifts exactly once. Empty pop/shift and transformations
that produce an equal array return no-op commits.

## Commit pipeline and observation

Data ops are normalized semantic operations:
`set`, `delete`, `replace`, `splice`, `rename`, and `move`. Rename and move retain
movement intent plus exact before/after witnesses for deterministic replay.
Multi-key and batch writes may produce
many ops in one envelope. The pipeline is:

1. validate and normalize intent;
2. clone/preflight the entire operation sequence;
3. validate the prospective root schema;
4. apply atomically;
5. advance the revision once if changed;
6. publish commit observers, overlapping feeds, then store subscribers.

`map.commits.observe(observer)` receives successful authoritative/replay commits
and snapshot restoration observations. Listener failures are isolated.
`map.feed(path, listener)` receives only commits with overlapping data ops; its
event contains the first matching `op`, all matching `ops`, the current cloned
`value`, subscriber `path`, and full commit.

## Batching

```ts
const commit = map.batch((tx) => {
  tx.set(["user", "name"], "Dorothy");
  tx.splice(["tags"], 1, 0, "compiler");
  tx.setMany(["user"], { active: true });
});
```

`batch` is synchronous and explicit. The transaction supports `set`, `setMany`,
`replace`, `splice`, and `delete`. Writes are staged; reads through the original
map during the callback continue to see pre-batch state. After the callback, the
whole sequence is preflighted and applied as one commit/revision/publication.

If the callback throws or any staged operation/schema check fails, nothing is
applied. Nested `map.batch` calls are not part of the transaction API; only use
the provided `tx` inside the callback.

## Schema

```ts
const userSchema = hson.liveMap.schema.define((s) =>
  s.object.exact({
    user: s.object({
      name: s.string,
      age: s.number.optional,
      role: s.literal("admin", "reader"),
    }),
    tags: s.array(s.string),
  }),
);

const typed = hson.liveMap
  .fromJson({ user: { name: "Ada", role: "admin" }, tags: [] })
  .schema.use(userSchema);

typed.at(["user", "name"]).set("Grace");
```

The direct `s` toolkit includes:

- primitives: `unknown`, `string`, `number`, `boolean`, `null`;
- modifiers: `.optional`, `.nullable`, and
  `.constrain(predicate)` / `.constrain(label, predicate)` on compatible
  projected schema values;
- choices: `literal(...values)`, `pick(...choices)`, and tagged variants;
- structure: `array()`, `array(item)`, `tuple(...items)`, `object(shape)`,
  `object.exact(shape)`, `partial(objectSchema)`, `deepPartial(objectSchema)`, and
  `record(value)`;
- recursion: `recurse(factory)`.

Every `define` call returns a distinct immutable schema. Defined schemas retain
their exact evidence and can be used anywhere a compatible inline expression
can be used:

```ts
const Seat = hson.liveMap.schema.define((s) => s.object.exact({ connected: s.boolean }));
const State = hson.liveMap.schema.define((s) => s.object.exact({ left: Seat, right: Seat }));
```

`define` callbacks return one explicit schema expression; a raw callback object
is not an implicit object schema. `object` validates declared properties but
allows extra string keys. Declared properties retain their precise types, while
undeclared keys are typed as recursively projected primitive/readonly
array/readonly object values plus `undefined` for absence. `object.exact`
rejects extra keys and has no open index signature. `.exact` is family-local to
the open named-keyspace families `object` and `attrs`; it is not a universal
modifier. `array()` admits zero or more legal projected values of any projected
type, while `array(item)` remains homogeneous. Broad arrays still reject
projected-invalid values such as `undefined`, sparse holes, non-finite numbers,
bigint, executable/symbol values, exotic or cyclic objects, and document-only
values. `tuple()` is the exact zero-position tuple, and other tuple
indexes are bounded. `Schema.constrain(...)` runs custom validation after its
base succeeds and only narrows validity; it does not transform or coerce values.
The diagnostic label is optional. Defined projected schemas retain this
modifier, so a durable `Range` may be narrowed with `Range.constrain(...)`
without mutating `Range`. Document-only elements/layouts, attrs-schema values,
and contextual `s.flag` do not expose it. `recurse` exists for self-recursion,
mutual recursion, and forward schema references.

`partial` and `deepPartial` accept an explicit object expression or compatible
defined object schema and preserve whether the operand is open or exact. Tagged
variant tables likewise contain explicit object schema expressions:

```ts
const Event = hson.liveMap.schema.define((s) => s.tagged("kind", {
  changed: s.object.exact({ value: s.string }),
  cleared: s.object({}),
}));
```

Schema values use the same admission domain as mutations. `optional` means the
property may be missing; a present property whose value is `undefined` is
invalid. Literal values are admitted and detached when the schema is defined,
then compared using ordered SameValue semantics. Constraint callbacks receive
fresh detached JavaScript materializations, so mutating one callback's input
cannot alter the candidate or another constraint.

Schema objects expose `validateRoot(value)`, `validateValue(path, value)`,
`rules`, `match(path)`, `resolve(path)`, `has(path)`, and throwing `must.resolve`
inspection. Attached maps mirror lookup through `map.schema`; `get()` returns
the attached schema.

The first successful `map.schema.use(A)` validates current canonical state and
permanently records exact schema object `A` as that owner's contract. Calling
`use(A)` again, including through an ordinary alias to the same object, is an
idempotent no-op. Calling `use(B)` with `B !== A` rejects even when B is
structurally equivalent or accepts the current state. There is no detach, reset,
or replacement operation. Attachment changes no value or revision and emits no
commit, feed, or watch notification. One immutable schema object may govern any
number of independent map owners.

Validation returns structured issues with codes including `TYPE_MISMATCH`,
`MISSING_REQUIRED`, `UNKNOWN_PATH`, `UNKNOWN_KEY`, `INVALID_LITERAL`,
`INVALID_CONSTRAINT`, `INVALID_SCHEMA`, and `TUPLE_INDEX_OUT_OF_RANGE`.
Issue paths are projected paths. Multi-operation validation reports the relevant
operation/headline path while retaining detailed issue paths.

### Document schemas in the unified toolkit

Mutable element and fragment maps can install a document-specific legal-state
contract. Authored HSON still describes only initial state; it never becomes a
schema implicitly.

```ts
const Label = hson.liveMap.schema.define((s) => s.span(s.string));
const ButtonAttrs = hson.liveMap.schema.define((s) => s.attrs({
  id: s.string,
  tabindex: s.number.constrain((value) => Number.isInteger(value) && value >= -1),
  selected: s.flag.optional,
  style: s.unknown.optional,
}));
const ButtonDocument = hson.liveMap.schema.define((s) =>
  s.button(ButtonAttrs, Label),
);

const map = hson.liveMap.fromHson(`<button "Save"/>`);
if (map.mode === "element") map.schema.use(ButtonDocument);
```

Known HTML and SVG tags are direct builders on the same `s` toolkit and derive
from the canonical `LiveTree.create` tag catalog. `s.string` is logical text;
`s.unknown` is one arbitrary legal document item; `s.empty` is exactly zero
document items; `s.tuple(...)` is a closed ordered layout;
`s.repeat(item)` is a whole zero-or-more sibling layout;
`s.repeat(count, item)` is a homogeneous exact-count layout; and
`s.pick(...)` combines compatible items or compatible layouts. Shared
`string`, `unknown`, `tuple`, and `pick` expressions retain projected and
document capabilities until their enclosing expression selects one.

A first `s.attrs({...})` operand declares required and optional attrs while
leaving undeclared canonical attrs open; `s.attrs.exact({...})` rejects
undeclared attrs, `s.attrs({})` permits arbitrary canonical attrs, and
`s.attrs.exact({})` permits no attrs. Attr schemas are
immutable reusable values, valid only as the first tag operand. `s.flag` is
contextual: the containing attr must equal its canonical name, while
`s.flag.optional` permits absence. `s.unknown` in attr context admits any
canonical value legal for that particular name, including structured canonical
style for the exact `style` key.

A known-tag call with no children, such as `s.div()`, leaves descendants broad.
Explicit child items close the complete direct content. One layout argument
supplies the complete layout. Prefer `s.div(s.empty)` for an exact-empty element
and return `s.empty` for an exact-empty fragment. `s.tuple()` remains the valid
zero-position document layout and, in projected composition, the exact empty
tuple `[]`. `s.repeat(0, item)` is document-semantically equivalent to
`s.empty`. A top-level nonempty `s.tuple(...)` is a fragment/multi-root
contract. Omitting an attrs operand leaves attributes broad.

Counted repeat accepts primitive finite nonnegative safe integers only. Negative,
fractional, nonfinite, unsafe, boxed, bigint, boolean, and string counts reject.
A dynamic `number` is supported: its exact value is captured when `define`
evaluates, while TypeScript conservatively treats its coordinates as possibly
absent and preserves the item evidence. Literal counts expose exact positions,
so `repeat(3, Item)` has positions 0–2 and statically rejects direct path 3.

Arbitrary tags use the callable tag family with the same child grammar:

```ts
const AnyElement = hson.liveMap.schema.define((s) => s.tag());
const AnyTextElement = hson.liveMap.schema.define((s) => s.tag(s.string));
const Widget = hson.liveMap.schema.define((s) => s.tag.widget(s.string));
const Hyphenated = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.string));

const name: string = getRuntimeTagName();
const Dynamic = hson.liveMap.schema.define((s) => s.tag[name](s.string));
```

Property and bracket forms record the exact runtime tag, and a dynamic name is
captured while `define` evaluates. TypeScript retains exact child/layout
evidence but conservatively represents an arbitrary or unregistered custom tag
name as `string`. Known direct builders such as `s.div(...)` retain literal tag
evidence. The former string-taking `s.tag("my-widget", ...)` form is not part of
the public surface.

`map.schema.use(schema)` validates the current canonical document synchronously
and returns the same map object. A successful first attachment is permanent for
the owner: reusing the identical schema object is idempotent, while replacing or
removing it is unsupported. All aliases, local mutations, installs, restores,
replays, and staged authoritative candidates are governed by the same owner
contract. Attachment itself changes neither graph, revision, nor observations.

Canonical graph ownership is private before and after attachment, so attachment
only validates current state and records governance; it does not clone or
reconcile the graph.

The returned schema-bound map uses that permanent evidence for top-level logical
`at(...)` reads:

```ts
if (map.mode === "element") {
  const typed = map.schema.use(ButtonDocument);

  typed.at([0]).snap();       // string
  typed.at([0]).watch((next) => {
    next.toUpperCase();       // next is string
  });

  tree.bind.text(typed.at([0])); // no formatter needed
  // typed.at([1]);             // compile-time error: impossible exact path
}
```

Exact fixed coordinates, including literal counted-repeat coordinates, resolve
from the schema. Text endpoints are `string`;
structured endpoints remain `HsonNode`. Repeated positions and dynamic numeric
indexes include `undefined` because the requested coordinate may be absent.
Layout picks combine the endpoints of branches that contain a coordinate and
add `undefined` for legal branches that do not. Descendants of a broad tag
whose content was deliberately omitted widen to
`string | HsonNode | undefined`.

A completely dynamic schema-aware path also has that schema-derived broad
domain. A map without a document schema retains the historical
`HsonNode | Primitive | undefined` location domain for compatibility.

Relative `location.at(...)` consumes the descriptor retained by its base
location. Direct and relative paths therefore infer the same endpoint:

```ts
const root = nestedTyped.at([]);
const container = root.at([0]);
const label = container.at([0]);

label.snap();              // string
label.replace("Save");
tree.bind.text(label);     // no formatter needed

root.at([0, 0]).snap();    // also string
// container.at([1]);      // compile-time error when locally impossible
```

An absent repeated or union ancestor propagates `undefined` to its relative
descendants. A dynamic relative index resolves against the local sequence or
repeat evidence; a fully broad relative path stops at the same
`string | HsonNode | undefined` performance boundary. Entering a deliberately
broad element subtree widens locally and cannot recover precision later.

The same retained descriptor rejects obviously incompatible authoring values:

```ts
const text = typed.at([0]);
text.replace("Save");       // accepted
// text.replace(node);      // type error: this slot is text

const TextList = hson.liveMap.schema.define((s) => s.repeat(s.string));
const list = fragmentMap.schema.use(TextList);
list.at([]).insert(0, "item");
// list.at([]).insert(0, node); // type error: repeated text accepts strings
```

Text positions accept `string`, element positions accept `HsonNode`, and item
unions accept their corresponding union. `undefined` in a repeated or layout
read describes absence; it is not a writable document value. Broad
schema-aware content accepts `string | HsonNode`, while schema-less maps keep
their historical broad mutation inputs.

These types only constrain the source value. Exact element tags and content,
fixed-sequence insertion, index validity, delete, and move remain validated by
the permanent runtime schema against the complete candidate. Relative typing
does not change coordinates or allocate wrappers:
`map.at([0, 0]) === map.at([0]).at([0])` under the existing interner.

Schema-aware numeric proxies consume the same retained descriptor:

```ts
const direct = nestedTyped.at([0, 1]);
const relative = nestedTyped.at([0]).at([1]);
const proxied = nestedTyped.proxy()[0][1].$_;

// direct, relative, and proxied expose the same endpoint type
tree.bind.text(nestedTyped.proxy()[0][0].$_);
```

Numeric properties are logical document coordinates. Fixed known positions are
precise; repeated and dynamic positions put possible absence in the escaped
location value, not in the proxy object. That keeps a missing coordinate usable
as a fixed authoring handle. Structured endpoints retain their child descriptor,
so traversal can remain precise beneath a public `HsonNode`. Entering an
broad-tag subtree widens only that subtree to
`string | HsonNode | undefined`.

TypeScript bracket indexing cannot both reject every out-of-range numeric
literal and retain a truthful dynamic-number signature on this existing proxy
shape. Known in-range literals stay precise; other numeric keys use the local
missing-aware dynamic type. Exact `at(...)` and explicit `proxy([path])` calls
continue to reject impossible fixed paths.

The `$_` escape is the existing interned location, so its `snap`, `watch`,
`replace`, content-owner `insert`, relative `at`, attrs, and binding behavior all
use the same evidence. Runtime proxy grammar and behavior are unchanged.
Schema-less proxies keep their historical broad domain. Attributes remain
schema-open.

## Subscriptions

```ts
const stop = map.sub.path(["user", "name"], (next, prev, event) => {
  console.log({ next, prev, rev: event.commit.rev });
});

map.set(["user", "name"], "Margaret");
stop();
```

- `map.sub(listener)`: root snapshot after each changed publication.
- `map.sub.diff(listener)`: `(next, prev)` root snapshots.
- `map.sub.sel(selector, listener, { equal? })`: selected next/previous values
  plus current root; selector results use their separate `Object.is` default or
  the supplied comparator, not projected-value equality.
- `map.sub.path(path, listener, { equal? })`: path next/previous plus feed event.

Registration does **not** call listeners immediately; obtain initial state with
`snap()`/`sub.snapshot` semantics (the public shorthand exposes subscriptions,
while `make_livemap_store_api` exposes `snapshot`). Values are detached clones.
Disposers are idempotent. One batch produces at most one subscriber publication.
Link-applied writes use normal commits and therefore notify target subscribers.
Feeds, path subscriptions, links, stores, and applicable LiveHost routes carry
exact projected carriers or versioned payloads internally; callbacks receive
detached JavaScript materializations. A rejected link write is atomic for the
target, but source and target are not one distributed transaction.

## Proxy API

```ts
const proxy = typed.proxy();

proxy.user.name.$_.snap();
proxy.user.name.$_.set("Evelyn");
proxy.tags[0].$_.replace("systems");
```

Ordinary property/index access extends the projected path. `$_` exits proxy
traversal and returns the real path handle, whose methods perform reads/writes.
There are no direct value-coercion or assignment traps: `proxy.user.name` is
another proxy, and `proxy.user.name = "x"` is not a supported write.

Missing traversal is allowed until `$_`; reads return `undefined`, while strict
writes still enforce endpoint rules. Array numeric property names become numeric
path segments. Schema-bound proxies type known properties and array indexes, but
runtime dynamic properties remain possible. Repeated access to the same child
from one proxy is identity-stable because child proxies are cached;
independently created root proxies are distinct. Symbols and reserved `$_` are
special and should not be used as data traversal.

## Links

```ts
const source = hson.liveMap.fromJson({ profile: { name: "Ada" } });
const target = hson.liveMap.fromJson({ user: { name: "" } });

const unlink = link_livemap(source, target, {
  from: ["profile"],
  to: ["user"],
});

source.set(["profile", "name"], "Grace");
unlink();
```

`link_livemap(source, target, { path })` mirrors the same prefix.
`{ from, to }` translates prefixes. `sourceHandle.linkTo(targetHandle)` is the
handle shorthand.

Link creation does **not** perform initial mirroring; initialize the target
explicitly when required. Later overlapping source `set`, `replace`, and delete
effects are translated and applied as ordinary target commits. A missing target
child can be created through a translated object-key set, but its containing
object must satisfy the normal write contract. Current link propagation does not
replay splice ops.

Links are one-way and the disposer stops propagation. There is no general
bidirectional loop-prevention contract, so do not connect contradictory links
in both directions. Target schema validation can reject propagation atomically.

## Projected container identity

Projected object and array containers can carry sparse canonical QUID metadata,
but projected maps expose no public identity-acquisition method. Internal
owner-authorized continuity facilities may ensure one path-authoritative claim,
producing the ordinary `ensure-quid` commit and revision behavior. Application
code cannot request a claim or provide its QUID.

Internally retained identity follows object-key rename, array move, ancestor
movement, and insertion/removal shifts. Nested leaf mutation preserves it;
deletion, replacement, or owner-epoch replacement retires it. Root objects and
arrays are eligible canonical values, while primitives, property wrappers, and
array-item wrappers remain ineligible.

Within the current owner epoch, retired QUID bytes remain reserved in an
internal issued ledger. Allocation retries those bytes, so an unrelated
container cannot reactivate a stale handle. A new owner epoch starts a fresh
ledger seeded from admitted active metadata; old handles remain fenced even if
that epoch later uses equal bytes. Exact same-epoch restoration preserves the
living ledger rather than rolling it back to capture time.

The QUID is canonical HSON metadata but is not a projected property, array item,
enumerable key, or schema field. `snap()`, feeds, links, selectors, and stores see
the same projected value before and after acquisition. Commit observers see the
identity registration. HSON snapshots preserve object/array identity in
anonymous container headers, while identity-stripped capture and `noQuid`
intentionally omit it.

`map.at(path)` remains a passive location: it follows whatever currently
occupies that path and never mints merely because it is created, read, bound, or
subscribed. Projected mode adds no `byQuid` or `fromQuid` constructor. Raw QUID
bytes cannot recreate a handle or cross an owner/epoch boundary.

## Document LiveMaps

Document modes deliberately do not expose projected `snap`/`set` APIs.
Common reads are `root()`, `capture()`, `document.content()`,
`document.byQuid(quid)`, and document attribute reads.

Mutable logical document locations converge on the existing canonical document
operations. An element location or the fragment root owns ordered content, so
`location.insert(index, value)` and `location.move(from, to)` lower to the same
content planners and final-index semantics as `document.content.insert` and
`document.content.move`. Existing items remain
`location.at([index]).replace(value)` / `.delete()`; there is no duplicate
container `replace(index, value)` or `remove(index)`.

Ordinary element locations also expose `location.attrs` with `get`, `has`,
`keys`, `must.get`, `set`, `setMany`, `drop`, `dropMany`, `replace`, and
`clear`. This is the established `document.attrs` vocabulary with the location
supplying the target. It is an operation capability, not structural traversal,
and does not add a segment to `location.path()`. The document proxy's existing
`$_` escape returns the same location, so `proxy.$_.insert(...)` and
`proxy.$_.attrs.set(...)` delegate without proxy-specific mutation logic.

Element locations also expose `location.flags.has(name)`,
`location.flags.set(...names)`, and `location.flags.clear(...names)`. The
explicit-target equivalents are `map.document.flags.has(target, name)`,
`.set(target, ...names)`, and `.clear(target, ...names)`. A flag exists exactly
when the complete canonical attr bag owns the key and its value equals the
canonical name. Multi-name writes are atomic, and clear preserves a same-key
ordinary value. These operations address by path and do not mint QUIDs.

Document maps expose no public identity-acquisition method. Existing QUIDs may
still be inspected through the active-epoch `document.byQuid` compatibility
surface, and internal linked continuity facilities may request a canonical
path-authoritative claim. Only ordinary elements are eligible for that internal
document operation.

Handles follow content moves and insertion shifts and survive attribute
changes. Removal or replacement without explicit same-QUID continuity makes
them inactive. Changed durable install, durable restore, and replayed root
replacement fence the old owner epoch; exact same-epoch capture admission may
preserve continuity. Multiple handles may share one QUID. Disposing a handle
does not remove metadata or create a commit.

Document identity uses the same owner-epoch issued ledger. Removal or an
identity-replacing replacement makes `document.byQuid(q)` absent, and the
retired bytes cannot be allocated, replayed, or introduced on another element
in that epoch. An explicit replacement that preserves the active QUID retains
the repository's established canonical continuity. This prevents stored
document raw-QUID request targets from silently retargeting. Raw QUIDs still do
not survive owner-epoch replacement as identity claims.

The linked LiveTree projection also participates in its runtime's lifetime
issued ledger. If LiveMap allocation proposes bytes retired by a prior claim in
that runtime, Reflection rejects the local reservation and the map-owned
allocator retries before canonical publication. This adds no public acquisition
or restoration surface.

`document.byQuid`, path-or-QUID active mutation targets, `LiveTree.quid`,
`LiveTree.find.byQuid`, and diagnostic QUID output remain active-epoch
compatibility surfaces. Raw QUIDs are not application IDs, authorization,
durable references, or handle constructors. There is no `fromQuid`, raw setter,
public replacement/retirement operation, or user-selected QUID API.

`document.attrs` provides `get`, `has`, `keys`, `must.get`, `set`, `drop`,
`setMany`, `dropMany`, `clear`, and `replace`. `document.content` is callable for
top-level detached content and has `replace`, `insert`, `remove`, and `move`.
Mutations accept a path/quid document target and return graph-domain commits.
Attrs are one complete canonical bag: `setMany` is an atomic overlay,
`replace` is complete replacement, and `clear` removes flag-form members too.
Style remains whole canonical attr state manipulated through `attrs`; there is
no LiveMap style convenience in this phase.

`capture()` remains the durable exact-metadata compatibility form. Explicit
capture categories are additive:

```ts
map.capture({ identity: "same-epoch" });
map.capture({ identity: "preserve-metadata" });
map.capture({ identity: "strip" });
```

Same-epoch output is an exact local object capability; copying or serializing it
removes that proof. Preserve-metadata output retains QUID bytes for durable
structure but does not transfer old handles. Strip output removes QUID metadata
from the detached capture without mutating or minting into the source.

`install(capture, { expectedRev?, identity? })` atomically replaces a same-mode
document and advances revision. `restore` installs the exact captured revision
without an ordinary commit. Admission supports `same-epoch`,
`preserve-metadata`, `strip`, and `reject`. The compatibility default is
`preserve-metadata`: claims are validated and become fresh map-local overlay
identity, not proof of the source map's epoch. `replay(commit)` validates
identity witnesses, operation domain, and exact revision continuity.
`commits.observe` is the supported graph publication surface.

## Canonical ownership

LiveMap never exposes a live mutable canonical node or graph through supported
entrypoints. `snap()`, `root()`, captures, document reads, watch payloads, and
feed values are detached observations. Locations and proxies retain only an
owner/path capability and perform writes through governed LiveMap operations.
Schema query results are immutable, owner-independent evidence. Low-level
canonical inspection used by the implementation and tests is private and is not
part of the package surface.

## LiveMap and SSR

Projected and document LiveMaps are DOM-free for JSON, HSON-node, HSON-string,
and HTML-string construction. Reads and writes are synchronous and deterministic
given the same canonical input.

```ts
const requestMap = hson.liveMap.fromJson({
  title: "SSR",
  items: ["one", "two"],
});

const transfer = requestMap.capture();
const serialized = JSON.stringify(transfer);
```

Use `snap()` for a detached rendering value and `capture()` when the revision
must travel with it. Clone/isolate per-request state unless intentional shared
mutation is required. A batch can prepare one deterministic request-scoped
transition and one commit.

LiveMap supplies state to a renderer; it does not render HTML. LiveTree is the
DOM projection API and has different runtime constraints. A server-created data
capture includes exact structural transport, a detached projected compatibility
value, and a detached canonical root so hidden identity metadata can be durably
restored. Document captures likewise contain HSON nodes; LiveHost recovery
serializes durable structural form as HSON or negotiated view-state. Neither
wire format carries the local same-epoch capability.

Passing browser `Element` objects belongs to other hson/LiveTree construction
paths and is unavailable in Node/Worker execution. Synchronization coordination
between a server LiveMap, LiveHost revision, and LiveTree is not yet a public
product contract.

## Errors

Most invalid projected operations throw before mutation. Schema failures use the
internal `LiveMapSchemaError` class (not package-root exported) but expose
structured validation information through schema validation APIs. Revision
conflicts throw a revision error internally. Projected identity acquisition
reports `LiveMapProjectedIdentityError` with a stable reason code and path.
Public document errors include
`LiveMapDocumentInstallError`, `LiveMapDocumentIdentityProvenanceError`,
`LiveMapDocumentMutationError`, and `LiveMapDocumentAttributeNotFoundError`,
with exported provenance, install, and mutation reason codes.

Normal missing reads return `undefined`; missing deletes are no-ops. Normal
write errors do not partially change the graph.

## Known limitations and deferred surfaces

- Data LiveMaps support object/array roots, not primitive root modes.
- Document and projected APIs are intentionally distinct.
- Proxy assignment/value coercion is unsupported; use `$_`.
- Unsafe node handles bypass every normal state guarantee.
- Links are one-way and have no distributed/cross-process transport.
- There is no public `get`, `has`, or `node` method directly on a map.
- Server rendering and LiveTree adoption orchestration remain external.
