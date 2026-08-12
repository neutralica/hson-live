# LiveMap paths, handles, and proxies

Projected-data LiveMaps expose one canonical state through three related access
styles. Explicit map methods perform path-based reads and writes, `at(path)`
returns a stable path handle, and `proxy(path?)` provides property/index syntax
for building a path. None of these surfaces owns a second copy of state.

## Explicit paths

A projected path is a readonly array of string object keys and numeric array
indexes:

```ts
map.snap(["users", 0, "name"]);
map.set(["users", 0, "name"], "Alice");
map.delete(["users", 0, "name"]);
```

The empty path is the projected root. `snap()` reads that root, while
`snap(path)` reads one location. Composite results are detached from canonical
state. Mutations use the normal admission, schema, revision, commit, feed, and
authority rules.

There is no map-level `get(path)` or `has(path)` API. Use `snap`, a path handle,
or `handle.object.hasKey(key)` as appropriate.

## Path handles

`map.at(path)` returns a cached `LiveMapPathHandle` for that exact location:

```ts
const settings = map.at(["settings"]);

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

A path handle exposes:

- `rev`, `path()`, `snap()`, and relative `at(path)`;
- `set`, `setMany`, `replace`, `delete`, and `update`;
- `object` and `array` helper namespaces;
- `feed(listener)` and `watch(listener)`; and
- one-way `linkTo(target)`.

The handle follows its stored location. It is not a document-node identity
handle and does not silently follow a value that moves elsewhere. Removal or
replacement changes what subsequent reads at that location observe.

Document maps use their separate `document`, `element`, or `fragment`
capabilities. They do not expose the projected path-handle surface.

## Watching current values

Projected path handles and passive logical document locations expose
`watch(listener)`. Registration captures the current coordinate as its internal
comparison baseline but does not call the listener immediately:

```ts
const location = map.at(["profile", "name"]);
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

`map.proxy()` creates a path-building proxy:

```ts
const state = map.proxy();

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
the proxy is not the projected object itself.

## Reserved property behavior

Promise/debugger/Object probe names such as `then`, `toJSON`, `constructor`, and
`__proto__` are inert proxy reads. Canonical non-negative integer property names
become numeric path segments. When data uses one of those spellings as an object
key, address it through explicit paths or the parent handle's object helpers.

## Hosted maps

When LiveHost manages a map, reads through existing handles and proxies continue
to resolve current state. Mutation methods remain subject to the same authority
fencing as direct map writes; retaining a handle or proxy does not bypass the
host.

## Choosing a surface

Use explicit paths for reusable algorithms and transport-adjacent code. Use a
path handle when several operations share one location. Use a proxy when
property/index traversal makes application code clearer, then use `$_` for the
actual read or mutation.
