# Handles and Proxies
`LiveMap` provides several ways to navigate and manipulate a live graph.
They are intentionally different abstractions rather than alternate spellings of the same API.
- **Path APIs** are explicit, deterministic, and ideal for reusable library code.
- **Handles** represent stable references to specific graph locations and expose richer structural operations.
- **Proxies** provide an ergonomic JavaScript view for application code while remaining backed by the same canonical graph.
All three operate on the same authoritative `LiveMap`. Choosing one affects only how application code expresses mutations—not how the underlying graph behaves.
---
# Design goals
The navigation APIs were designed around several principles.
A navigation model should:
- avoid duplicating application state;
- preserve one canonical graph;
- expose structural identity when needed;
- support deterministic mutation;
- remain usable with TypeScript;
- scale from simple application code to low-level graph manipulation.
No single API satisfies all of those goals equally well.
Instead, LiveMap provides complementary interfaces.
---
# Path APIs
The fundamental LiveMap interface is path-based.
```ts
map.get(["users", 0, "name"]);
map.set(
    ["users", 0, "name"],
    "Alice",
);
map.delete([
    "users",
    0,
    "name",
]);
```
Paths are arrays consisting of:
- object keys;
- array indexes.
Projected-data paths intentionally resemble JSON navigation.
For document maps, specialized document APIs generally provide a clearer interface than manually navigating structural paths.
Path operations are:
- explicit;
- serializable;
- deterministic;
- stable across transports;
- appropriate for reusable libraries.
Nearly every higher-level LiveMap feature ultimately delegates to path operations.
---
# Handles
A handle represents a stable logical location inside a LiveMap.
Unlike a path array, a handle provides behavior.
Conceptually:
```text
LiveMap
    ↓
Handle
    ↓
graph location
```
Handles expose convenience operations for the represented location.
Typical examples include:
- reading values;
- setting values;
- structural insertion;
- deletion;
- movement;
- attribute access;
- child traversal;
- subscriptions.
Rather than repeatedly writing:
```ts
map.set(
    ["settings", "theme"],
    "dark",
);
```
a handle may represent:
```text
["settings"]
```
allowing:
```ts
settingsHandle.set(
    "theme",
    "dark",
);
```
The underlying mutation semantics remain identical.
---
# Handle lifetime
Handles are logical graph references.
They survive unrelated mutations elsewhere in the graph.
Operations that replace or remove the represented location affect subsequent handle behavior according to the documented API contract.
Handles should generally be preferred whenever application code repeatedly operates on the same graph location.
---
# Document handles
Document maps expose richer handles representing HSON nodes.
These provide document-oriented operations rather than projected-data operations.
Examples include:
- attributes;
- ordered content;
- insertion;
- replacement;
- movement;
- element creation;
- text operations;
- structural traversal.
Document handles intentionally resemble DOM manipulation while remaining independent of browser APIs.
---
# Proxies
LiveMap proxies provide an ergonomic JavaScript view over the same graph.
Conceptually:
```text
proxy.user.name = "Alice"
```
becomes:
```text
LiveMap
    ↓
canonical mutation
    ↓
revision
    ↓
subscriptions
```
The proxy itself owns no state.
Every property access ultimately delegates to the authoritative LiveMap.
---
# Why proxies exist
Many applications naturally prefer JavaScript object syntax.
For example:
```ts
proxy.settings.theme = "dark";
proxy.todos.push({
    title: "Write docs",
});
```
is often clearer than repeated explicit path operations.
Proxies therefore improve readability without introducing a second state model.
---
# Mutation behavior
Proxy mutation is never local.
Assignments, deletion, array operations, and helper methods perform ordinary LiveMap mutations.
They therefore participate in:
- schema validation;
- commit generation;
- revisions;
- feeds;
- subscriptions;
- links.
A proxy assignment is not a cached JavaScript property write.
It is a graph mutation.
---
# Structural identity
A proxy represents a view over a graph location.
It does not become the underlying object.
JavaScript identity therefore should not be interpreted as graph identity.
Applications should avoid treating proxies as detached data structures.
Instead, think of them as live windows into the graph.
---
# Proxy helper methods
Because JavaScript property syntax cannot conveniently express every graph operation, proxies expose helper methods.
Examples include:
- batch mutation;
- subscriptions;
- refresh;
- metadata;
- structural operations.
These helper methods intentionally use reserved names beginning with:
```text
$_
```
For example:
```ts
proxy.$_handle();
proxy.$_subscribe(...);
proxy.$_path();
```
Ordinary graph properties therefore remain available without colliding with proxy infrastructure.
---
# Paths, handles, and proxies together
The three interfaces complement one another.
Use path APIs when:
- writing reusable utilities;
- serializing operations;
- implementing transports;
- expressing deterministic algorithms.
Use handles when:
- repeatedly manipulating one graph location;
- performing structural operations;
- interacting with document nodes;
- writing reusable graph components.
Use proxies when:
- writing application logic;
- expressing UI behavior;
- reading and writing nested properties naturally;
- exploring state interactively.
All three ultimately operate on the same graph.
---
# Revisions
Every mutation—regardless of interface—produces the same underlying LiveMap behavior.
The following operations are equivalent:
```ts
map.set(["count"], 5);
countHandle.set(5);
proxy.count = 5;
```
Each performs:
```text
validation
→ staged mutation
→ accepted transition
→ commit
→ revision
→ feeds
→ subscriptions
```
The navigation API affects only developer ergonomics.
It does not change mutation semantics.
---
# Relationship to LiveHost
Handles and proxies are local LiveMap interfaces.
When a LiveMap is managed by an exclusive LiveHost, public mutation routes become dynamically fenced.
Existing handles and proxies continue to reference the graph, but mutation operations are rejected because authoritative changes must pass through the owning LiveHost.
Read operations continue to function normally.
This allows application code to retain graph references without bypassing host authority.
---
# TypeScript
The three interfaces provide different strengths for static typing.
Path APIs expose deterministic library behavior.
Handles expose richer graph-specific methods.
Proxies expose property inference that closely resembles ordinary JavaScript while remaining backed by LiveMap.
Applications are free to mix the interfaces as appropriate.
---
# Summary
LiveMap intentionally provides three navigation models rather than one universal interface.
```text
Path API
    deterministic graph operations
Handle
    stable graph reference with behavior
Proxy
    ergonomic JavaScript view
```
Each presents a different programming model over the same canonical graph.
Choosing between them changes only how application code expresses navigation—not how the underlying LiveMap stores state, validates mutations, generates revisions, or interacts with subscriptions, schemas, links, or LiveHost authority.
