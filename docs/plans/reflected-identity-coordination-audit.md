# Reflected identity coordination audit

Date: 2026-08-03

Scope: corrected production/test audit plus Unit 10R-A and Unit 10R-B implementation record for `hson-live`

Decision status: Units 10R-A and 10R-B implemented; public active-epoch LiveMap handles remain deferred

Unit 12T subsequently adds runtime-lifetime issued-QUID accounting. Linked
canonical acquisition preflights that shared runtime ledger and retries retired
runtime candidates before LiveMap commits. Reflection still preserves absence,
never mints, and performs no runtime rekey. Independent test cases that require
equal bytes use independent runtime lifetimes; active same-runtime collision
proofs remain unchanged.

## Audit baseline

The audit started from clean, committed worktrees:

| Repository | Commit | Branch state | Verified inventory |
| --- | --- | --- | --- |
| `hson-live` | `27dfb6d3ec23a24411393d00ad0b2b2b75637a0b` | `main...origin/main`, clean | 2,062 checks in 87 launchers |
| `hson-demo2` | `aaba84c6582cfe1b365a7e610d31ae06b3327861` | `main...origin/main`, clean | 2,545 Node cases; 1,422 Worker-portable cases |

The combined verified total was 4,607. The `hson-demo2` catalog fingerprints were:

```text
Node:   fnv1a32-6e48d683
Worker: fnv1a32-400fb5be
```

The 87th `hson-live` launcher is the committed tagged-template launcher introduced by the current `hson-live` commit. No additional or unexplained baseline difference was present. This table records the pre-implementation audit baseline; Unit 10R-A production, test, and documentation changes were made afterward without staging or committing them.

The audit treats completed executable units as authoritative. In particular, the sparse document overlay from Units 3–5 already exists. The missing facility is not a QUID/path index; it is authority-correct internal acquisition and propagation into a linked projection.

## Unit 10R-A implementation result

The ownership leak described below was corrected without adding acquisition. Reflection now uses linked construction and projection paths that bind exact nodes, preserve supplied canonical claims, and preserve absence. Linked wrapping and reverse DOM lookup use exact-object maps. Diagnostics and inline style no longer force private identity. QUID-dependent APIs return an existing supplied claim or reject with `LIVETREE_LINKED_IDENTITY_REQUIRED`; they never mint for a linked node.

Standalone construction, projection, find, graft, `.quid`, CSS, and event ownership keep their established QUID behavior. No public map identity API, allocator, registration operation, runtime rekey, protocol change, or expanded eligibility was added.

## Unit 10R-B implementation result

Linked `.quid` and existing QUID-owned CSS, event, animation, binding, canvas, and resource paths now delegate through the exact active document registration. The internal map authority resolves its current canonical path, reuses an existing claim without publication, or securely allocates one candidate with bounded canonical/runtime collision retry. Reflection supplies the sole local preflight participant, reserves without publishing, and atomically claims the recorded value on the same exact projected Hson and DOM objects after canonical acceptance.

The new `ensure-quid` graph operation is path-authoritative and ordinary revisioned canonical state. The sparse overlay derives one introduced claim, replay never allocates, and current LiveHost history/protocol/recovery/persistence shapes carry the operation additively without a version change. Multi-operation replay proves registration before/after move, registration before removal, multiple registrations, and failed-later-operation atomicity.

QUID-free rendering, wrapping, traversal, diagnostics, inline style, and ordinary mutation remain QUID-free. Multi-result selector manager broadcasters are now lazy prototype getters so constructing a traversal result does not accidentally instantiate CSS identity ownership. No public identity-acquisition method, handle capability, raw setter, rekey, object/array eligibility, remote consensus, or cross-runtime identity coordination was added.

Sections 1–13 below retain the original Unit 10R-A audit and prerequisite reasoning as historical evidence. Statements there phrased as “future Unit 10R-B” or “until Unit 10R-B” are resolved by the implementation result above; the ownership analysis and stop-condition rationale remain authoritative.

## 1. Executive verdict

**Yes. Standalone LiveTree graph-ownership behavior has leaked into the reflected LiveMap-owned projection path.**

Two exact paths cause the leak:

1. Reflection constructs its root through the ordinary LiveTree constructor. That constructor admits the graph and ensures a QUID for the handle root.
2. DOM projection calls `ensure_quid()` for every rendered ordinary element and writes that value to `hson:quid`.

Consequently, the audited pre-10R-A behavior created the misleading state:

```text
canonical LiveMap node: QUID absent
projected Hson node:     privately minted QUID B
DOM element:             hson:quid B
canonical sparse overlay: no entry
```

That state is an implementation artifact, not the intended reflected identity model.

The corrected invariant is:

```text
canonical QUID absent
→ Reflection preserves absence
→ linked LiveTree and DOM remain unquidded

canonical QUID q present
→ Reflection preserves q
→ the local runtime registers the exact projected node under q
→ mounted DOM carries hson:quid q

linked operation requires retained identity during Unit 10R-A
→ reject explicitly without minting

future Unit 10R-B acquisition
→ delegate to LiveMap
→ LiveMap allocates and commits q
→ sparse overlay records q ↔ canonical path
→ Reflection installs q in the linked runtime and DOM
```

No runtime rekey is required after that correction. A later canonical QUID is the projected node's **first** QUID claim, not a change from private `B` to canonical `q`.

Do not resume the public Unit 10 handle API directly on the audited construction behavior. The prerequisite is split deliberately:

> **Unit 10R-A — reflected no-mint projection**
>
> **Unit 10R-B — authority-owned registration and linked acquisition**

Unit 10R-A removes private projection minting, lets linked handles retain exact nodes without a claim, preserves supplied canonical claims, and explicitly rejects QUID-dependent linked facilities while no claim exists. This is an honest bounded state: rendering, correspondence, ordinary delegated mutation, lookup, and lifecycle management do not require a QUID. Unit 10R-B must add the narrow local preflight/delegation seam, internal map-owned allocator, and path-authoritative registration operation with complete commit/replay/persistence handling before linked QUID demand can succeed. Neither unit adds the public map identity-handle API, a rekey transaction, cross-runtime correspondence IDs, or LiveHost-wide QUID coordination.

## 2. Standalone versus reflected graph ownership

### Standalone LiveTree

A standalone LiveTree is graph authority for the Hson graph it admits. It may:

- adopt supplied valid QUID metadata;
- mint a root QUID when a stable LiveTree handle is created;
- mint QUIDs for identity-bearing runtime facilities;
- mutate its owned Hson graph locally;
- project those owned claims into DOM metadata.

The existing `LiveTree` constructor is designed for this mode. It calls `admit_livetree_quid_graph()`, which validates supplied claims, mints a root claim if absent, writes metadata and runtime indexes, and binds exact nodes to the runtime ([`livetree.ts`](../../src/api/livetree/livetree.ts#L211-L227), [`data-quid.ts`](../../src/api/livetree/quid/data-quid.ts#L109-L140)).

### LiveMap-linked LiveTree

For one reflected `map.document`, the authority split is different:

| Concern | Owner |
| --- | --- |
| Canonical Hson graph and `$_meta` | LiveMap |
| Revision, commit, history, replay, recovery | LiveMap |
| Sparse canonical `QUID ↔ current path` overlay | LiveMap |
| Canonical-to-data correspondence | Reflection |
| Exact projected JavaScript and DOM objects | LiveTree runtime |
| CSS, events, animation, resources, lifecycle state | LiveTree runtime |

The LiveTree runtime may register a canonical QUID and use it to own runtime resources. It must not originate a different QUID by mutating the projected copy of LiveMap-owned graph state.

The statement that LiveTree is authoritative for active runtime identity remains valid only in this authority-sensitive sense: LiveTree owns exact runtime objects and validates runtime claims. It is not permission for a linked projection to mint canonical graph metadata privately.

## 3. Exact source of the observed projected QUID

### Root at the audited baseline: Reflection invoked standalone admission

At the audited baseline, initial document binding captured the canonical element and called `create_livetree_in_runtime(sourceElement, runtime)`. Unit 10R-A replaces that call with linked construction, which selects the runtime while marking the admission as authority-preserving.

The constructor then:

```text
admit_livetree_quid_graph(inputNode, runtime)
→ existing root QUID, or mint_available_quid(...)
→ assign_hson_node_quid(root, rootQuid)
→ publish runtime maps
```

([`livetree.ts`](../../src/api/livetree/livetree.ts#L211-L227), [`data-quid.ts`](../../src/api/livetree/quid/data-quid.ts#L115-L140)).

The handle reference independently enforces the same assumption: `LiveTreeNodeRef.q` is a required string, and `makeRef()` calls `ensure_quid()` when admission did not supply one ([`livetree.ts`](../../src/api/livetree/livetree.ts#L77-L95)).

Reflection does not directly call the random generator. It invokes a shared creation path whose semantics are standalone admission and mandatory handle identity. That is the first ownership leak.

### Descendants at the audited baseline: DOM projection ensured every element

The audited DOM projector linked the exact Hson node and DOM element, then unconditionally called `ensure_quid(n, ..., runtime)` and wrote the result to `hson:quid`. Unit 10R-A makes this helper authority-sensitive: linked projection registers only supplied claims and writes markup only when a claim exists.

This affects:

- descendants rendered during initial graft/projection;
- newly inserted or replaced descendants rendered through Reflection's structural projector;
- any ordinary element rendered through the same shared projector.

Thus the root is minted even while detached, and each rendered descendant is minted during DOM materialization. Unmounted descendants without supplied metadata can remain unquidded until wrapping or projection reaches them, which is why current behavior can appear inconsistent by traversal history.

## 4. Can Reflection preserve QUID absence?

**Yes. Unit 10R-A now uses the lower-level runtime architecture that already supported it.**

Three independent exact-object mechanisms do not require a QUID:

1. Runtime routing uses `WeakMap<HsonNode, LiveTreeRuntime>` and can bind a complete graph with `bind_graph_runtime()` without assigning metadata ([`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L38-L42), [`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L88-L107)).
2. DOM correspondence uses bidirectional weak maps between exact Hson nodes and exact DOM elements ([`node-map-helpers.ts`](../../src/api/livetree/utils/node-map-helpers.ts#L20-L44)).
3. Reflection's document registration already associates an exact projected node with its canonical path and owner ([`document-binding-state.ts`](../../src/api/livetree/lifecycle/document-binding-state.ts#L22-L50)).

An authority-correct linked projection can therefore:

```text
bind exact projected graph to runtime
create a linked LiveTree handle retaining the exact node
render and link DOM objects
omit $_meta.quid and hson:quid while canonical identity is absent
```

The required construction change is not to make QUIDs optional everywhere. It is to split behavior by authority:

- standalone construction keeps eager graph admission and current public semantics;
- linked construction binds runtime/exact-node ownership without ensuring a QUID;
- a linked handle resolves an existing supplied identity on demand and explicitly rejects missing canonical identity until Unit 10R-B can delegate acquisition through the binding.

The current reverse DOM helper is another shared standalone assumption: it reads `hson:quid`, looks up the runtime node by QUID, and creates another eager LiveTree handle ([`dom-api.ts`](../../src/api/livetree/managers/dom-api.ts#L14-L27)). Linked mode can instead recover the exact Hson node from the existing element-to-node weak map and wrap it through the linked, QUID-lazy path.

Deletion and disposal already conditionally release QUID-owned artifacts only when a claim exists. Nothing in exact graph or DOM ownership makes a QUID mandatory for every rendered element.

## 5. Existing canonical QUID behavior

When a canonical node already contains valid QUID `q`, initial graph admission scans supplied claims, validates collision freedom, and publishes the same `q` in runtime indexes. It does not remint that node. The current acceptance suite proves root preservation and local collision rejection ([`locus-capture-identity-closure.acceptance.mts`](../../tests/locus-capture-identity-closure.acceptance.mts#L174-L185)). Separate runtimes may admit equal bytes without sharing exact object identity.

Unit 10R-A preserves that useful behavior without the trailing root-mint rule:

```text
canonical supplied q
→ validate q and runtime availability
→ register exact projected node under q
→ preserve projected $_meta.quid q
→ write DOM hson:quid q when mounted

canonical q absent
→ bind exact projected node only
→ do not mint
→ omit DOM hson:quid
```

Initial canonical collisions remain hard binding failures. The correction does not weaken runtime uniqueness, QUID validation, or supplied-claim collision evidence.

Root and descendants follow the same rule. The root is special today only because returning `binding.tree` invokes the eager constructor; it is not conceptually entitled to projection-local identity.

## 6. Identity-demand triggers and authority classification

The audited code conflated “has a LiveTree handle” or “has a DOM element” with “needs QUID-owned retained identity.” Unit 10R-A now classifies paths explicitly.

| Path or API | Current behavior | Correct authority-sensitive behavior |
| --- | --- | --- |
| `new LiveTree`, `create_livetree` | Standalone admission; ensures root QUID | Keep for standalone authority |
| Reflection root construction | Reuses standalone constructor; ensures root QUID | Linked construction; bind exact graph, preserve supplied claims, do not mint |
| `project_livetree` / DOM materialization | Ensures every ordinary element | Shared helper must preserve absence in linked mode; standalone mode may ensure according to standalone contract |
| Public standalone `graft` | Admits root and requires a QUID for DOM root | Keep as standalone authority ([`graft.ts`](../../src/api/livetree/creation/graft.ts#L109-L125)) |
| `find`, `findAll`, parent/closest wrapping | Shared wrapper constructs an eager handle | Linked wrapper should retain exact node without mint; standalone wrapper may retain present semantics |
| `.quid` | Returned a constructor-captured string | Returns supplied canonical q; rejects missing linked identity in 10R-A; Unit 10R-B will delegate acquisition |
| `.css` | Reads `this.quid` when manager is created | QUID-owned facility; supplied-q linked nodes work, while unquidded linked access rejects until 10R-B ([`livetree.ts`](../../src/api/livetree/livetree.ts)) |
| `.events` | Reads `this.quid` when registry is created | QUID-owned lifecycle facility; supplied-q linked nodes work, while unquidded linked access rejects until 10R-B ([`livetree.ts`](../../src/api/livetree/livetree.ts)) |
| `.listen`, `.bind`, animation, canvas/resource lifecycle | Eventually uses QUID as lifecycle owner | Exact-object setup may proceed, but first QUID-dependent registration rejects without a supplied canonical claim until 10R-B |
| `find.byQuid` | Runtime lookup only | Never mint; active-runtime compatibility lookup only |
| DOM `hson:quid` | Written during all materialization | Write only when canonical q exists or has just been acquired |
| DOM reads/layout and node↔element lookup | Conceptually exact-object based | No QUID demand |
| attrs, text, content, id, class, data | Ordinary graph operations | Standalone mutates locally; linked mode delegates/rejects through Unit 6; no implicit identity |
| inline `.style` | Mutates data graph/DOM directly | Treat as canonical attribute mutation in linked mode; delegate, do not mint |
| append/create/detach/remove | Standalone local; linked paths already delegate or reject in part | Preserve authority split; structural mutation does not imply retained identity |
| `cloneBranch` | Fresh-mints ordinary nodes in the detached clone | Output is a new standalone graph and may receive fresh identities; cloning must not mint on the linked source ([`clone.ts`](../../src/api/livetree/methods/clone.ts#L22-L56)) |
| dispose/removal | Releases QUID resources when present | Must continue to tolerate unquidded linked nodes |

Two secondary leaks require attention in the prerequisite:

- inline style is an attribute-level canonical mutation; Unit 10R-A now delegates it through document attributes rather than drifting the projection;
- some diagnostic/error construction reads `tree.quid`, which can accidentally mint merely to format an error. Linked diagnostics must use an existing optional claim or non-QUID context; error reporting is not identity demand.

Runtime-oriented LiveTree APIs remain useful in linked mode. Exact-object DOM, traversal, correspondence, and ordinary delegated mutation work without QUIDs. QUID-owned CSS, event, animation, resource, and lifecycle facilities work for supplied canonical claims and reject explicitly for unquidded linked nodes until Unit 10R-B.

## 7. Required linked-mode delegation and preflight seam — Unit 10R-B

Unit 10R-A intentionally does not implement this seam. The following remains the bounded next prerequisite before authority-owned internal acquisition.

Unit 6 already provides the correct ownership boundary. `document-binding-state.ts` stores an exact-node registration with:

- binding owner;
- canonical target and current path;
- persisted canonical QUID when present;
- delegated attributes, text, empty, and remove operations;
- structural rejection.

([`document-binding-state.ts`](../../src/api/livetree/lifecycle/document-binding-state.ts#L22-L32)).

Extend that registration with one narrow synchronous capability, conceptually:

```text
requireCanonicalIdentity(exactProjectedNode)
→ resolve current canonical path in this binding
→ invoke authority-owned LiveMap acquisition
→ return the canonical QUID after the commit is reflected
```

This is not a public raw-QUID setter and must accept no caller-supplied QUID.

The map must own allocation. Unit 10R-B needs this internal canonical operation so linked LiveTree identity-demand APIs can progress beyond Unit 10R-A's explicit rejection. The safe local sequence is:

```text
1. resolve and validate the current canonical path/node
2. reuse existing canonical q as an exact no-op, or generate candidate q
3. check map overlay and staged reservations
4. ask the active local Reflection participant whether q can be claimed
   by this exact projected node in this runtime
5. retry allocation on a local runtime collision
6. accept one path-authoritative canonical ensure operation
7. install graph + overlay + revision atomically
8. synchronously notify Reflection
9. Reflection publishes q in projected metadata/runtime indexes/DOM
10. return q to the linked LiveTree caller
```

Current Reflection allows only one active document binding for a map, so this is a bounded local participant, not distributed consensus ([`reflect.document.ts`](../../src/api/reflect/reflect.document.ts#L110-L121)). Direct `map.document` acquisition while that binding is active must use the same preflight participant, not only the LiveTree-facing delegate.

The runtime side needs a small “claim this supplied QUID for this exact unquidded node” primitive with preflight and rollback-safe publication. It must not call the generator and must reject a different existing claim. Reflection's observer applies the recorded value; replay never mints.

The commit observer runs after canonical acceptance and rejects unrecognized graph operation kinds ([`reflect.document.ts`](../../src/api/reflect/reflect.document.ts)). Unit 10R-B must add the registration operation to that observer and close commit, replay, capture, history, recovery, and persistence before any linked identity-demand path can produce it. Replay uses the recorded q and never invokes the allocator.

Unexpected DOM or projection failure after a successful preflight remains a binding failure under the existing Reflection model; it is not a QUID rekey divergence. The canonical claim remains valid, and a fresh binding can register the same q. The apply step should still be locally rollback-safe so a failed DOM publication does not leave partial runtime indexes.

## 8. Explicit LiveMap minting remains sparse and authoritative — deferred to Unit 10R-B

“LiveMap does not implicitly mint” should mean:

```text
admission, rendering, traversal, ordinary reads, ordinary writes, and moves
→ no new QUID
```

It does not prohibit the canonical owner from allocating identity in direct response to an explicit identity demand.

Unit 10R-B should add the single **internal** map-owned collision-aware allocator and path-authoritative registration operation described by the larger Unit 10 plan. Unit 10R-A adds neither. The later public-handle unit exposes application acquisition without exposing the allocator or accepting raw q values. Identity-specific state remains:

```text
N = all canonical nodes
Q = canonically quidded nodes
H = explicit map identity handles

overlay: O(Q)
handles: O(H)
QUID-free reflected map: Q = 0, H = 0, projection QUID claims = 0
```

A move never creates claims. It only reconciles existing sparse entries. The linked runtime registers only the same canonical claims that already exist or are explicitly acquired.

## 9. Does the stopped Unit 10 conflict disappear?

**Yes.** The observed conflict was caused by ordering the private projection mint before canonical acquisition:

```text
old behavior:
  project unquidded node → private B
  later canonical ensure → q
  Reflection sees B versus q → root conflict or runtime mismatch
```

After Unit 10R-A, the private-`B` half of the conflict is gone. Unit 10R-B can then complete:

```text
correct behavior:
  project unquidded node → still unquidded
  later canonical ensure → q
  local preflight proves q available
  Reflection installs first claim q on same exact projected node
```

Existing JavaScript handles retain the same exact projected node. DOM correspondence remains the same exact element. Attribute, text, layout, and other non-QUID state are untouched. In Unit 10R-A, QUID-owned CSS/events/resources cannot predate the claim because their linked entrypoints reject while the claim is absent; Unit 10R-B will replace that rejection with authority-owned delegation.

The current root-QUID conflict guard accurately detects current private-B behavior, but that behavior should no longer be generated. Unit 10 should support the semantic `ensure-quid` observation directly rather than translating it to root/content replacement.

## 10. Runtime rekey, replacement, and retirement

### Rekey

No runtime rekey is required for the first identity-acquisition unit after no-mint projection is enforced. Existing helpers such as `remint_quid()` are not complete transactions and must not be expanded merely to normalize legacy/private claims.

If a linked projection somehow has a runtime QUID while the corresponding canonical node is unquidded—through unsafe/debug mutation, stale code, or an invariant breach—the corrected path should fail closed or rebuild the binding. It must not silently adopt the private value, overwrite canonical state, or rekey live resources.

### Existing QUID

`ensure identity` on an already canonically quidded node reuses that q without mutation, revision, or feed publication. A linked runtime missing the registration should be treated as an invariant failure, not silently repaired through the public API.

### Replacement/removal

The first public contract can remain strictly ensure-if-absent. It does not need general QUID replacement, removal, or user-selected assignment.

- canonical structural removal/replacement already retires displaced overlay entries;
- Reflection already disposes data runtime state for removed/replaced exact nodes;
- a map identity handle can become inactive by observing epoch and overlay/path resolution;
- disposing one handle must not remove canonical metadata.

Explicit identity retirement and QUID replacement remain deferred lifecycle operations. They are not prerequisites for handle correctness.

## 11. Tests that encoded the ownership leak

Two focused Reflection checks asserted the behavior that Unit 10R-A changed:

1. `reflect-document-root.acceptance.mts` asserts that a QUID-less canonical root receives and retains “projection-local identity” while canonical metadata remains absent ([`reflect-document-root.acceptance.mts`](../../tests/reflect-document-root.acceptance.mts#L86-L98)).
2. `reflect-document-snapshot.acceptance.mts` asserts the same private projected root QUID across a detached snapshot convergence ([`reflect-document-snapshot.acceptance.mts`](../../tests/reflect-document-snapshot.acceptance.mts#L106-L119)).

Those tests were evidence of the leak, not contracts to preserve. They now assert that canonical absence remains absent in the linked projected node across compatible root install and snapshot convergence.

Tests that remain correct include:

- initial Reflection preserves a supplied canonical q exactly;
- a supplied canonical q that collides in the selected active runtime rejects;
- separate runtimes may contain equal QUID bytes without sharing exact identity;
- standalone LiveTree construction/graft continues to ensure identity under its own authority;
- QUID-targeted LiveMap requests lower through the canonical overlay to a path;
- canonical structural removal/replacement retires exact data runtime state;
- QUID-free maps retain empty sparse overlays.

Unit 10R-A checks distinguish root and descendants:

- detached reflected root does not mint;
- mounted root and descendants do not mint merely by rendering;
- `find`/DOM traversal does not mint;
- attrs, text, data, and inline style do not mint;
- supplied root and descendant QUIDs register unchanged;
- `.quid` and first QUID-owned resource reject explicitly on an unquidded linked node;
- removal/disposal works for both quidded and unquidded projected nodes.

Unit 10R-B must add collision preflight, failed-preflight atomicity, exactly-once delegation, and later canonical-q attachment coverage when those mechanisms exist.

## 12. Candidate assessment

### Candidate 1 — correct projection ownership

**Required and sufficient to remove the observed private-B conflict.** Reflection preserves absence and supplied q values; it never calls a minting path merely to construct, wrap, traverse, or render linked nodes.

### Candidate 2 — canonical identity request through LiveMap

**Required for Unit 10.** Linked identity demand delegates through Unit 6's exact-node binding. LiveMap allocates and commits. Reflection preflights and applies the recorded canonical q.

### Candidate 3 — runtime rekey

**Not required for Unit 10.** It becomes relevant only if a supported future API deliberately changes an already active canonical q, which is outside the ensure-if-absent contract. Do not build it as remediation for current private minting.

### Candidate 4 — cross-epoch correspondence

**Not the local reflected-document model.** Independent LiveHost maps/runtimes have separate exact-object epochs, and path-authoritative synchronization does not make raw QUID bytes universal distributed IDs. Any future host/client identity association is a separate problem.

Within one reflected LiveMap–LiveTree ownership system, canonical graph, projected metadata, runtime registration, and DOM annotation use one q.

## 13. Exact prerequisite before public identity handles

Unit 10R-A completed the projection half with this bounded scope:

1. Add an internal linked LiveTree construction/wrapping mode that binds exact runtime and graph ownership without ensuring a root QUID.
2. Refactor the handle reference so standalone handles keep eager identity, while linked handles retain exact nodes and reject missing QUID demand explicitly.
3. Make DOM projection authority-sensitive: preserve supplied canonical q; otherwise omit metadata and `hson:quid`.
4. Replace linked reverse DOM navigation's QUID dependency with the existing exact element↔node map.
5. Audit shared wrapping, diagnostic, style, and lifecycle helpers so non-identity operations do not mint and linked canonical mutations delegate or reject.
6. Preserve supplied canonical claims through a no-mint runtime admission primitive.
7. Route linked `LiveTree.quid` and QUID-owned runtime facilities to an explicit linked-identity-required failure while no claim exists.
8. Update the two incorrect projection-local-QUID tests and add focused root/descendant absence, supplied-q, traversal, collision, standalone-boundary, and disposal coverage.

Unit 10R-B remains the exact next prerequisite:

1. Extend Unit 6's binding registration with an internal `requireCanonicalIdentity` delegation seam and an active-map local candidate-preflight participant.
2. Add the internal map-owned allocator and semantic path-authoritative ensure operation. Close commit, replay, capture, history, recovery, persistence, and malformed/collision rejection; replay must never mint.
3. Add a runtime primitive that preflights and atomically registers a newly recorded canonical q on an exact previously unquidded projected node; it must never mint or rekey.
4. Route existing linked `LiveTree.quid` and QUID-owned runtime facilities through the internal delegate.

Units 10R-A and 10R-B must not add:

- any public identity-acquisition API;
- public identity handles;
- a user-supplied-QUID setter;
- runtime rekeying;
- cross-map or cross-runtime raw-QUID correspondence;
- object/array QUID eligibility;
- LiveHost protocol changes;
- a second permanent node identifier.

After Unit 10R-B passes, the public handle portion of Unit 10 can choose the acquisition name, add the opaque active-epoch map handle and lifecycle suites, and document the raw-QUID compatibility fences on a sound registration/projection core. This is an explicit split of Unit 10, not a second identity system.

## 14. Readiness verdict

Units 10R-A and 10R-B are ready for the public Unit 10 active-epoch handle implementation. Linked construction and rendering do not mutate identity metadata outside LiveMap authority, and exact linked demand now closes allocation, preflight, canonical registration, replay, transport, and supplied runtime publication without a broad LiveTree redesign or rekey.

Unit 10R-B resolves the reflected-map decision gate to safe local coordination:

```text
no private projection QUID
+ map-owned explicit allocation
+ local runtime preflight
+ canonical commit
+ supplied-q Reflection apply
= one canonical q, one exact projected node, no rekey
```

Unit 11 remains deferred. This audit does not begin object/array eligibility, data-mode identity, QUID shortening, hashing/digests, binary Hson, SSR continuation, or broad LiveTree/LiveHost redesign.
