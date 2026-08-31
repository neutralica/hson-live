# LiveMap API reference

LiveMap owns a canonical Hson graph and exposes either data JSON-path state (`data-object`, `data-array`) or canonical document operations (`document`). A document authority owns ordered content beneath one internal `_hson_root`, whether that content has zero, one, or many top-level nodes. LiveMap owns canonical state; public observations are detached or mediated and public mutation passes through LiveMap admission.

```ts
import { hson } from "hson-live";
import { hsonLiveMap, link_livemap } from "hson-live/livemap";
import type { LiveMap, LiveMapCommit, LivePath } from "hson-live/livemap";
```

`hson-live/livemap` is the supported DOM-free subsystem entrypoint for LiveMap
values, helpers, structured errors, and types. The root remains the browser
umbrella entrypoint, and `hson-live/types` remains a broad type barrel rather
than the owner of the LiveMap vocabulary.

## Stability boundary

- **Public:** `hsonLiveMap`, `hson.liveMap`, `make_classified_livemap`,
  `make_livemap_core`, `make_livemap_store_api`, `link_livemap`, the exported
  path/feed/proxy/binding helpers, structured errors, and LiveMap types.
- **Experimental:** document-mode LiveMaps, capture/install/replay, graph commit
  observation, links, and schema-derived typing.
- **Internal:** editor functions other than the exported `snap_live_path`, path
  guards, transition controllers, identity indexes, canonical inspection, and
  direct graph preparation functions not package-exported.
- **Deferred:** primitive data roots and transparent parity between proxy, data
  paths, document paths, and physical Hson paths.

The subsystem entrypoint is the complete LiveMap barrel. The root re-exports
the established common helpers but not every narrow path utility. In
particular, `append_live_path`, `clone_live_path`, `parent_live_path`,
`relative_live_path`, and `paths_equal` are imported from
`hson-live/livemap`; do not assume every subsystem export is duplicated at the
root.

## Construction

### data

```ts
const map = hson.liveMap.fromJson({
  user: { name: "Ada", active: true },
  tags: ["math"],
});

const sameShape = hson.liveMap.fromJson(
  '{"user":{"name":"Ada","active":true},"tags":["math"]}',
);
```

`fromJson` accepts a JSON value or JSON string and returns a data LiveMap. Current canonical roots must be objects or arrays; primitive roots are not a public data-map mode. Initial construction starts at revision `0` and emits no commit.

`fromHson(string)` and `fromNode(HsonNode)` return `ClassifiedLiveMap`, whose `mode` discriminates data from document APIs. The input node is prepared as owned canonical state; `root()` returns detached clones.

```ts
const authored = `<'display name' "Ada" 'preferred pronoun' "she">`;
const classified = hson.liveMap.fromHson(authored);
```

Quoted property names use apostrophe delimiters in authored Hson. JavaScript template-literal backticks belong to JavaScript and do not need per-name escaping.

### data value boundary

The canonical Hson graph is the authority for a data LiveMap. Internally, LiveMap admits data values into a private immutable ordered carrier while it plans mutations, validates schemas, compares candidates, and prepares exact transport. That carrier is transient machinery, not a second synchronized state model or a public type.

JavaScript-value ingress accepts only:

- primitive strings, booleans, `null`, and finite primitive numbers;
- ordinary objects whose prototype is exactly `Object.prototype` or `null`;
- dense ordinary arrays whose prototype is exactly `Array.prototype`.

Objects must contain only enumerable own string-keyed data properties. Accessors, nonenumerable properties, symbol keys, custom prototypes, class instances, boxed primitives, and exotic built-ins are rejected. Arrays may contain only a data property for every index plus their built-in `length`; holes, explicit `undefined`, accessor indexes, symbol keys, and extra named properties are rejected. Cycles reject. Repeated acyclic references are copied structurally, so reference identity is not part of data value semantics. Caller mutation after admission cannot affect the candidate or committed state.

Ordinary accessors are rejected from their descriptors without calling their getter or setter. Arbitrary proxies are unsupported: JavaScript has no reliable general proxy detector, and reflective admission may execute proxy traps. Callers must not rely on acceptance, rejection, trap count, or side-effect-free inspection of a proxy.

`__proto__`, `constructor`, and `prototype` are ordinary own data keys. Public objects are freshly materialized with `Object.prototype`, and their properties are defined rather than assigned, so those names cannot alter the result's prototype. Every nested object and array is detached from the graph and from other public materializations.

Canonical object-property order is explicit in the graph and private carrier. Object-handle `keys()`, `values()`, and `entries()` read that order directly; `root()` exposes it through a detached canonical graph. A public plain-object snapshot follows JavaScript's own-key enumeration rules, which reorder integer-index keys. It is therefore not an exact ordered persistence format, and re-ingressing it may adopt that JavaScript-visible integer-key order.

### Documents and HTML import boundaries

The narrow `hsonLiveMap` facade has exactly `fromJson`, `fromHson`, `fromNode`,
and `schema`; it has no HTML factories. The browser umbrella adds HTML
construction only at `hson.liveMap`:

```ts
import { hson } from "hson-live";

const trusted = hson.liveMap.fromTrustedHtml("<main></main>");
const safe = hson.liveMap.fromUntrustedHtml(userHtml);
```

Both accept strings and return a `document` LiveMap. Trusted
input is unsanitized; untrusted input is sanitized. These browser factories do
not accept an `Element`, unlike the root Transform and LiveTree HTML factories.
Use `hsonLiveMap.fromHson(...)` or `.fromNode(...)` when a DOM-free document
construction path is required.

### Schema and proxy

Attach a defined schema with `map.schema.use(schema)`. It returns the same runtime map with a schema-derived TypeScript view. Create a proxy at any data path with `map.proxy(path?)`.

## data paths

```ts
type LivePath = readonly (string | number)[];
```

Strings address object keys and numbers address array indexes. Paths address the JSON projection, not wrapper/content locations in physical Hson. `[]` is the data root. Inputs are validated and copied; handles return defensive path copies.

Object keys are exact strings. Array path segments must be valid existing indexes for strict writes. Invalid segment types, unresolved paths, wrong container kinds, and out-of-range indexes produce path-aware errors. Paths are not auto-normalized from dotted strings or numeric strings.

There is no public raw-node or graph-owner getter. Use `snap(path)` for detached data values, `root()` for a detached canonical graph, and document APIs for document attributes/content. The former `map.debug.node(...)` escape hatch has been removed and has no public raw-node replacement.

Document structural targets use a separate type:
`{ kind: "path"; path: readonly number[] } | { kind: "quid"; quid: string }`.
Those numbers traverse canonical `$_content`, not data arrays.

## Reads and revision

```ts
map.snap();                    // cloned root value
map.snap(["user", "name"]);   // cloned value or undefined
map.at(["tags"]).snap();      // cloned value
map.rev;                      // current revision
map.root();                   // detached HsonNode clone
map.capture();                // { rev, format, payload } plus non-enumerable root
```

`snap(path?)` never returns a live object/array reference. A missing data path returns `undefined`; wrong path syntax throws. `at(path)` always creates a stable path handle, even if the path is currently missing; `handle.snap()` then returns `undefined`. There is no map-level `get`/`has` method. Use `snap`, object handle `hasKey`, schema `has`, or a proxy handle as appropriate.

`capture()` returns the exact revision, a detached canonical `root`, and the
current structural-JSON envelope (`format`, `payload`). The payload preserves
ordered object entries and `-0`. `restore`, `apply`, and `replay` require this
current structural representation. A `value` field, `formatVersion`, malformed
transport, or an old value/op-only form rejects; there is no compatibility
fallback.

The data and document capture shapes, identity policies, installation rules,
and revision effects are specified mechanically in
[Capture, restore, and replay](capture-replay.md).

## Core data writes

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

The path must already resolve. At an object-valued endpoint, `set` is a shallow sibling-preserving write: supplied keys become child `set` operations. Arrays/primitives are endpoint values. `set([])` is invalid.

### `setMany(path, values)`

The endpoint must be an existing object. Each supplied property is written as a child; missing child keys are created, while unspecified siblings remain.

### `replace(path?, value)`

`replace(value)` replaces the root. `replace(path, value)` destructively replaces one existing endpoint, including an object. Use it when exact replacement rather than an object patch is intended.

### `delete(path)`

Deletes an existing object property or array item. A missing endpoint is a no-op. Root deletion is invalid.

### `splice(path, start, deleteCount, ...items)`

Splices an existing array. The normalized commit records removed and inserted values and full before/after endpoint values.

### `update`

`update` is a path-handle method:

```ts
const commit = map.at(["user", "active"]).update((active) => !active);
```

The updater reads the current cloned value, returns a `set` value, and commits synchronously. It is not a compare-and-swap primitive.

Before application, writes are normalized and previewed on a clone. An attached schema validates the prospective final root atomically. On failure the live graph, revision, feeds, and subscribers are unchanged.

```ts
map.set(["user", "name"], "Grace");
map.setMany(["user"], { name: "Katherine", active: false });
map.at(["tags"]).array.push("computing");
map.at(["tags"]).array.move(1, 0);
```

No-op commits have `changed: false`, no ops, and `rev === prevRev`. Changed commits advance exactly once.

## Path handles

`map.at(path)` returns a `LiveMapPathHandle` with:

- `path()`, `snap()`, and `rev`;
- `at(relativePath)`;
- `set`, `setMany`, `replace`, `delete`, and `update`;
- `.object` and `.array` helper namespaces;
- `feed(listener)`;
- `linkTo(target)`.

Handles retain path identity, not a frozen node/value. Reads and writes resolve against the map's current graph. Handles are interned by canonical path within one map and expose no persistent or process-global identifier.

## Object helpers

`handle.object` provides `is`, `toObject`, `pick`, `omit`, `hasKey`, `getKey`,
`keys`, `values`, `entries`, `size`, and `isEmpty`, plus:

- `setKey(key, value)`: creates a missing key under an existing object;
- `setMany(values)`: shallow child writes;
- `deleteKey(key)`: missing key is a no-op;
- `deleteMany(keys)`: one normalized commit;
- `renameKey(from, to)`: moves the source entry in place; a missing source rejects,   an existing destination is replaced, and `from === to` is a no-op after source   validation;
- `clear()`: removes all keys in one commit.

These methods reject a non-object or missing handle endpoint. They do not replace the containing object unless their documented final state happens to be empty.

## Array helpers

Read helpers include `is`, `toArray`, `slice`, `take`, `drop`, `takeLast`,
`dropLast`, `length`, `isEmpty`, `at`, `first`, `last`, `includes`, and
`indexOf`.

Writes include `push`, `pushMany`, `unshift`, `unshiftMany`, `pop`, `shift`,
`clear`, `reverse`, `sortNumbers`, `sortStrings`, `splice`, `insert`, `remove`,
`replace`, `move`, `unique`, `removeValue`, and `removeAll`.

Helpers require an existing array endpoint and write through the normal pipeline. `move(from, to)` is a semantic operation whose indexes must be nonnegative safe integers resolving in the staged array. Negative-index convenience does not apply to move. The destination is the final index after removal, and each intervening sibling shifts exactly once. Empty pop/shift and transformations that produce an equal array return no-op commits.

## Commit pipeline and observation

Data ops are normalized semantic operations:
`set`, `delete`, `replace`, `splice`, `rename`, and `move`.
Rename and move retain movement intent plus exact before/after witnesses for deterministic replay. Multi-key and batch writes may produce many ops in one envelope. The pipeline is:

1. validate and normalize intent;
2. clone/preflight the entire operation sequence;
3. validate the prospective root schema;
4. apply atomically;
5. advance the revision once if changed;
6. publish commit observers, overlapping feeds, then store subscribers.

`map.commits.observe(observer)` receives successful authoritative/replay
commits and snapshot restoration observations. Listener failures are isolated.
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

`batch` is synchronous and explicit. The transaction supports `set`, `setMany`, `replace`, `splice`, and `delete`. Writes are staged; reads through the original map during the callback continue to see pre-batch state. After the callback, the whole sequence is preflighted and applied as one commit/revision/publication.

If the callback throws or any staged operation/schema check fails, nothing is applied. Nested `map.batch` calls are not part of the transaction API; only use the provided `tx` inside the callback.

## Schema

HsonSchema is the only Schema authoring and authority system.

```ts
import { Hson, type HsonSchema } from "hson-live";

const UserSchema: HsonSchema = Hson`
  <type "data" content <user <content <
    name "string"
    age <optional "number">
  >>>>
`;

const map = hson.liveMap.fromJson({ user: { name: "Ada", age: 37 } });
map.schema.use(UserSchema);
```

`map.schema.get()` returns the attached HsonSchema and `map.schema.use(schema)`
attaches it once to that owner. Attachment validates the current root; later
mutations, restore, and replay validate before publication. Generic dynamic Hson
certification is `Hson.certify`; LiveMap exposes no separate authoring or
certification facade.

See [Schema](./schema.md) for authored data/document forms, generated TypeScript
evidence, and tooling.
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
- `map.sub.sel(selector, listener, { equal? })`: selected next/previous values   plus current root; selector results use their separate `Object.is` default or   the supplied comparator, not data value equality.
- `map.sub.path(path, listener, { equal? })`: path next/previous plus feed event.

Registration does **not** call listeners immediately; obtain initial state with `snap()`/`sub.snapshot` semantics (the public shorthand exposes subscriptions, while `make_livemap_store_api` exposes `snapshot`). Values are detached clones. Disposers are idempotent. One batch produces at most one subscriber publication.

Link-applied writes use normal commits and therefore notify target subscribers. Feeds, path subscriptions, links, stores, and applicable Locus routes carry current exact data carriers; callbacks receive detached JavaScript materializations. A rejected link write is atomic for the target, but source and target are not one distributed transaction.

## Proxy API

```ts
const proxy = typed.proxy();

proxy.user.name.$_.snap();
proxy.user.name.$_.set("Evelyn");
proxy.tags[0].$_.replace("systems");
```

Ordinary property/index access extends the data path. `$_` exits proxy traversal and returns the real path handle, whose methods perform reads/writes. There are no direct value-coercion or assignment traps: `proxy.user.name` is another proxy, and `proxy.user.name = "x"` is not a supported write.

Missing traversal is allowed until `$_`; reads return `undefined`, while strict writes still enforce endpoint rules. Array numeric property names become numeric path segments. Schema-bound proxies type known properties and array indexes, but runtime dynamic properties remain possible. Repeated access to the same child from one proxy is identity-stable because child proxies are cached; independently created root proxies are distinct. Symbols and reserved `$_` are special and should not be used as data traversal.

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

Link creation does **not** perform initial mirroring; initialize the target explicitly when required. Later overlapping source `set`, `replace`, and delete effects are translated and applied as ordinary target commits. A missing target child can be created through a translated object-key set, but its containing object must satisfy the normal write contract. Current link propagation does not replay splice ops.

Links are one-way and the disposer stops propagation. There is no general bidirectional loop-prevention contract, so do not connect contradictory links in both directions. Target schema validation can reject propagation atomically.

## Data container identity

Data object and array containers never carry canonical QUID metadata because
all `_hson_*` nodes are QUID-ineligible. Data maps expose no public
identity-acquisition method. Internal owner-authorized continuity facilities
may ensure one path-authoritative claim in the map-local sparse overlay,
producing the established `ensure-quid` commit and revision behavior without
mutating the canonical graph. Application code cannot request a claim or
provide its QUID.

Internally retained overlay identity follows object-key rename, array move, ancestor movement, and insertion/removal shifts. Nested leaf mutation preserves it; deletion, replacement, or owner-epoch replacement retires it. Semantic data objects and arrays are eligible map-local targets, while primitives and property/scalar carriers remain ineligible. This target rule is not canonical QUID eligibility.

Within the current owner epoch, retired QUID bytes remain reserved in an internal issued ledger. Allocation retries those bytes, so an unrelated container cannot reactivate a stale handle. A new owner epoch starts a fresh ledger seeded from active claims carried by an exact capture capability; old handles remain fenced even if that epoch later uses equal bytes. Exact same-epoch restoration preserves the living ledger rather than rolling it back to capture time.

The claim is map-local overlay state, not canonical Hson metadata, a data property, array item, enumerable key, or schema field. `snap()`, `root()`, feeds, links, selectors, serializers, and stores see the same canonical graph/data value before and after acquisition. Commit observers still see the identity registration. Exact live capture capabilities privately carry active overlay claims; copied or serialized Hson/HTML/JSON/binary graph representations do not.

`map.at(path)` remains a passive location: it follows whatever currently occupies that path and never mints merely because it is created, read, bound, or subscribed. Data mode adds no `byQuid` or `fromQuid` constructor. Raw QUID bytes cannot recreate a handle or cross an owner/epoch boundary.

## Document LiveMaps

Document modes deliberately do not expose data `snap`/`set` APIs. Common reads are `root()`, `capture()`, `document.content()`, `document.byQuid(quid)`, and document attribute reads.

Mutable logical document locations converge on the existing canonical document operations. A document or element location owns ordered content, so `location.insert(index, value)` and `location.move(from, to)` lower to the same content planners and final-index semantics as `document.content.insert` and `document.content.move`. Existing items remain `location.at([index]).replace(value)` / `.delete()`; there is no duplicate container `replace(index, value)` or `remove(index)`.

Ordinary element locations also expose `location.attrs` with `get`, `has`, `keys`, `must.get`, `set`, `setMany`, `drop`, `dropMany`, `replace`, and `clear`. This is the established `document.attrs` vocabulary with the location supplying the target. It is an operation capability, not structural traversal, and does not add a segment to `location.path()`. The document proxy's existing `$_` escape returns the same location, so `proxy.$_.insert(...)` and `proxy.$_.attrs.set(...)` delegate without proxy-specific mutation logic.

Element locations also expose `location.flags.has(name)`, `location.flags.set(...names)`, and `location.flags.clear(...names)`. The explicit-target equivalents are `map.document.flags.has(target, name)`, `.set(target, ...names)`, and `.clear(target, ...names)`. A flag exists exactly when the complete canonical attr bag owns the key and its value equals the canonical name. Multi-name writes are atomic, and clear preserves a same-key ordinary value. These operations address by path and do not mint QUIDs.

Document maps expose no public identity-acquisition method. Existing QUIDs may still be inspected through the active-epoch `document.byQuid` compatibility surface, and internal linked continuity facilities may request a canonical path-authoritative claim. Only ordinary elements are eligible for that internal document operation.

Handles follow content moves and insertion shifts and survive attribute changes. Removal or replacement without explicit same-QUID continuity makes them inactive. Changed durable install, durable restore, and replayed root replacement fence the old owner epoch; exact same-epoch capture admission may preserve continuity. Multiple handles may share one QUID. Disposing a handle does not remove metadata or create a commit.

Document identity uses the same owner-epoch issued ledger. Removal or an identity-replacing replacement makes `document.byQuid(q)` absent, and the retired bytes cannot be allocated, replayed, or introduced on another element in that epoch. An explicit replacement that preserves the active QUID retains the repository's established canonical continuity. This prevents stored document raw-QUID request targets from silently retargeting. Raw QUIDs still do not survive owner-epoch replacement as identity claims.

The linked LiveTree projection also participates in its runtime's lifetime issued ledger. If LiveMap allocation proposes bytes retired by a prior claim in that runtime, Reflection rejects the local reservation and the map-owned allocator retries before canonical publication. This adds no public acquisition or restoration surface.

`document.byQuid`, path-or-QUID active mutation targets, `LiveTree.quid`, `LiveTree.find.byQuid`, and diagnostic QUID output remain active-epoch compatibility surfaces. Raw QUIDs are not application IDs, authorization, durable references, or handle constructors. There is no `fromQuid`, raw setter, public replacement/retirement operation, or user-selected QUID API.

`document.attrs` provides `get`, `has`, `keys`, `must.get`, `set`, `drop`, `setMany`, `dropMany`, `clear`, and `replace`. `document.content` is callable for top-level detached content and has `replace`, `insert`, `remove`, and `move`. Mutations accept a path/quid document target and return graph-domain commits. Attrs are one complete canonical bag: `setMany` is an atomic overlay, `replace` is complete replacement, and `clear` removes flag-form members too. Style remains whole canonical attr state manipulated through `attrs`; there is no LiveMap style convenience in this phase.

`capture()` remains the durable exact-metadata compatibility form. Explicit capture categories are additive:

```ts
map.capture({ identity: "same-epoch" });
map.capture({ identity: "preserve-metadata" });
map.capture({ identity: "strip" });
```

Same-epoch output is an exact local object capability; copying or serializing it removes that proof. Preserve-metadata output retains QUID bytes for durable structure but does not transfer old handles. Strip output removes QUID metadata from the detached capture without mutating or minting into the source.

`install(capture, { expectedRev?, identity? })` atomically replaces a same-mode document and advances revision. `restore` installs the exact captured revision without an ordinary commit. Admission supports `same-epoch`, `preserve-metadata`, `strip`, and `reject`. The compatibility default is `preserve-metadata`: claims are validated and become fresh map-local overlay identity, not proof of the source map's epoch. `replay(commit)` validates identity witnesses, operation domain, and exact revision continuity. `commits.observe` is the supported graph publication surface.

`DocumentLiveMapCapture` is deliberately unversioned and has exactly four
enumerable fields: `kind`, `mode`, `rev`, and `root`. View-state is a separate
format-discriminated serialization envelope used by Locus
persistence/recovery; it also has no numeric version field and is not a field
on a document capture.

## Canonical ownership

LiveMap never exposes a live mutable canonical node or graph through supported entrypoints. `snap()`, `root()`, captures, document reads, watch payloads, and feed values are detached observations. Locations and proxies retain only an owner/path capability and perform writes through governed LiveMap operations. Schema query results are immutable, owner-independent evidence. Low-level canonical inspection used by the implementation and tests is private and is not part of the package surface.

## LiveMap and SSR

Data and document LiveMaps are DOM-free for JSON, Hson-node, Hson-string, and HTML-string construction. Reads and writes are synchronous and deterministic given the same canonical input.

```ts
const requestMap = hson.liveMap.fromJson({
  title: "SSR",
  items: ["one", "two"],
});

const transfer = requestMap.capture();
const serialized = JSON.stringify(transfer);
```

Use `snap()` for a detached rendering value and `capture()` when the revision must travel with it. Clone/isolate per-request state unless intentional shared mutation is required. A batch can prepare one deterministic request-scoped transition and one commit.

LiveMap supplies state to a renderer; it does not render HTML. LiveTree is the DOM projection API and has different runtime constraints. A server-created data capture includes exact structural transport and a detached canonical root so hidden identity metadata can be durably restored. Document captures likewise contain Hson nodes; Locus recovery serializes durable structural form as the selected current Hson or view-state representation. Neither wire format carries the local same-epoch capability.

Passing browser `Element` objects belongs to other hson/LiveTree construction paths and is unavailable in Node/Worker execution. Synchronization coordination between an authoritative LiveMap/Locus revision and LiveTree remains an explicit application composition.

## Errors

Most invalid data operations throw before mutation. HsonSchema governance failures use the internal `HsonSchemaError` class and carry structured issues. Revision conflicts throw a revision error internally. Data identity acquisition reports `LiveMapProjectedIdentityError` with a stable reason code and path.

Public document errors include `LiveMapDocumentInstallError`, `LiveMapDocumentIdentityProvenanceError`, `LiveMapDocumentMutationError`, and `LiveMapDocumentAttributeNotFoundError`, with exported provenance, install, and mutation reason codes.

Normal missing reads return `undefined`; missing deletes are no-ops. Normal write errors do not partially change the graph.

## Known limitations and deferred surfaces

- Data LiveMaps support object/array roots, not primitive root modes.
- Document and data APIs are intentionally distinct.
- Proxy assignment/value coercion is unsupported; use `$_`.
- Unsafe node handles bypass every normal state guarantee.
- Links are one-way and have no distributed/cross-process transport.
- There is no public `get`, `has`, or `node` method directly on a map.
- Server rendering and LiveTree adoption orchestration remain external.
