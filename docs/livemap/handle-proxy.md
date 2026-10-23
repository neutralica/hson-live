# LiveMap paths, handles, and proxies

Select the family first: `map.data.must(name).at(path)`,
`map.doc.must(name).at(path)`, or `map.parts.must(name).at(path)`. Callable
selectors without `.must` permit absence or a wrong family. A one-Library map
uses the same selection; the registry has no default root.
`proxy(path?)` remains optional
property/index syntax for building a path. None of these surfaces owns a second
copy of state.

## Explicit paths

A data path is a readonly array of string object keys and numeric array
indexes:

```ts
const users = map.data.must("state");
users.at(["users", 0, "name"]).snap();
users.at(["users", 0, "name"]).set("Alice");
users.at(["users", 0, "name"]).delete();
```

The empty path is the data root. `snap()` reads that root, while
`snap(path)` reads one location. Composite results are detached from canonical
state. Mutations use the normal admission, schema, revision, commit, feed, and
authority rules.

There is no map-level `get(path)` or `has(path)` API. Use `snap`, a path handle,
or `handle.object.hasKey(key)` on an object-shaped handle as appropriate.

## Path handles

`library.at(path)` returns a path handle for that exact Library-relative
location:

```ts
const settings = map.data.must("state").at(["settings"]);

settings.snap();
settings.at(["theme"]).set("dark");
settings.object.setKey("density", "compact");
const stop = settings.feed((event) => {
  console.log(event.value);
});
const dispose = settings.watch((next) => {
  console.log(next);
});
```

A path handle always exposes coordinate reads, relative `at(path)`, endpoint
replacement, deletion, and runtime refinement. A Schema-proven object or array
endpoint additionally exposes its shape namespace:

- `rev`, `path()`, `snap()`, and relative `at(path)`;
- `set`, `replace`, `delete`, and `update`;
- `.object` operations such as `setKey`, `setMany`, `renameKey`, and `deleteKey`;
- `.array` operations such as `push`, `insert`, `splice`, `move`, and `remove`;
- `kind()`, `present()`, `asObject()`, `asArray()`, and `asScalar()` when
  presence or shape is not statically singular;
- `feed(listener)` and `watch(listener)`; and
- one-way `linkTo(target)`.

The handle follows its stored location. It is not a document-node identity
handle and does not silently follow a value that moves elsewhere. Removal or
replacement changes what subsequent reads at that location observe.

Document Libraries use the same `library.at(path)` entrypoint. Element handles
expose `attrs`, `flags`, insertion, and movement; text handles expose content
replacement/deletion but not element-only capabilities. Dynamic document
locations refine with `asElement()` or `asText()`.

## Watching current values

Data path handles and passive logical document locations expose
`watch(listener)`. Registration captures the current coordinate as its internal
comparison baseline but does not call the listener immediately:

```ts
const location = map.data.must("state").at(["profile", "name"]);
const dispose = location.watch((next) => {
  // next is the current detached value at this fixed coordinate
  console.log(next);
});

dispose();
```

For ordinary changed commits, `watch` re-resolves the fixed coordinate and
invokes once only when its exact canonical value changed. A complete
`restore(...)` is explicit snapshot synchronization, so it invokes every active
watcher once even when the restored value compares equal or both states are
missing. The returned disposer is synchronous and idempotent.

`feed` and `watch` serve different purposes:

- `feed` reports overlapping accepted operation evidence and does not report
  restore;
- `watch` reports meaningful current-value changes and explicit snapshot
  synchronization.

A watcher stays attached to its coordinate. Array or document-content
insertion, removal, and movement may change the occupant, but the watcher does
not follow the previous value or acquire QUID identity. A location returned by
document `id(...)` follows the same rule; call `id(...)` again to rediscover a
moved element.

## Proxies

Selected data and document Libraries expose `proxy()` as path-building sugar:

```ts
const state = map.data.must("state").proxy();

state.user.name.$_.snap();
state.user.name.$_.set("Grace");
state.tags[0].$_.replace("writer");
```

Property and index reads extend the represented path. `$_` is a property, not a
method: it exits proxy traversal and returns the ordinary path handle. All reads
and mutations then use that handle's current API.

Direct JavaScript mutation is rejected:

```ts
state.user.name = "Grace"; // throws
delete state.user.name;    // throws
```

The proxy also rejects direct property definition, prototype changes, and
extensibility changes. It does not implement transparent assignment, array
methods, subscriptions, metadata helpers, `$_handle()`, or `$_subscribe()`.

Repeated access to the same child path returns the same cached proxy, and `$_`
returns the map's cached handle for that path. This is location identity only;
the proxy is not the data object itself.

## Reserved property behavior

Promise/debugger/Object probe names such as `then`, `toJSON`, `constructor`, and
`__proto__` are inert proxy reads. Canonical non-negative integer property names
become numeric path segments. When data uses one of those spellings as an object
key, address it through explicit paths or the parent object handle's direct
helpers.

## Hosted maps

When a Locus governs a map, reads through existing handles and proxies continue
to resolve current state. Mutation methods remain subject to the same authority
fencing as direct map writes; retaining a handle or proxy does not bypass the
host.

## Choosing a surface

Use explicit paths for reusable algorithms and transport-adjacent code. Use a
path handle when several operations share one location. Use a proxy when
property/index traversal makes application code clearer, then use `$_` for the
actual read or mutation.
