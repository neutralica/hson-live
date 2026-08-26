# QUID scope and encoding forensic audit

Date: 2026-08-02

Audit mode: source-only, read-only investigation; no builds, tests, generators, formatters, or repository-mutating commands were run.

> Subsequent executable authority: Units 12P and 12T now give LiveMap owner
> epochs and standalone LiveTree runtimes separate monotonic issued-QUID
> ledgers. Same-runtime terminal QUID reuse rejects; a fresh runtime may admit
> equal bytes. The original forensic observations below remain historical input,
> not the current non-reuse contract.

## 1. Executive conclusion

The proposed eight-character encoding does **not yet match the whole architecture**. It can fit the ephemeral LiveTree identity role, but the repository currently uses the same `quid` field for two materially different contracts:

1. A LiveTree QUID is a runtime routing key. Its concrete uniqueness domain is one `LiveTreeRuntime`; the public default runtime is effectively one loaded `hson-live` module instance/JavaScript realm. LiveTree checks collisions and retries while admitting or minting active QUIDs.
2. A LiveMap/LiveHost QUID is also a persisted document-node key. It is preserved in snapshots, graph operations, commit history, bootstrap, recovery, and persistence, including across a process restart. QUID-addressed history depends on that preservation.

Consequently, the statement “QUID serialization is not a durable application-identity mechanism” is not fully honest today. It accurately describes the intended LiveTree abstraction, but conflicts with implemented LiveHost document recovery and with public raw-QUID APIs.

Current allocation is only partially lazy. Cold HSON/HTML/JSON parsing does not mint QUIDs, and LiveTree admission eagerly mints only the root while preserving supplied descendant claims. However, DOM projection/grafting recursively mints every ordinary element, cloning recursively remints every ordinary element, and construction of each child LiveTree handle mints that child immediately. The observed rule is therefore closer to “a QUID for every handled or projected ordinary element, plus every ordinary clone node” than “a QUID only for independently identity-bearing nodes.”

Eight lowercase base-32 characters provide exactly 40 random bits. With a complete, atomic namespace registry, retry-on-collision, and a defined no-reuse policy, that is mathematically adequate for active runtime routing: even with 10,000,000 already-reserved values, the next draw collides with probability about `9.095e-6` and needs only `1.0000091` expected draws. Without a registry, it is not adequate at large scale: one million random issues have about a 36.5% chance of at least one collision, and ten million are virtually certain to collide.

The safe recommendation is to first separate runtime identity from persisted document identity, make namespace ownership and epoch boundaries explicit, centralize atomic allocation/admission, define no-reuse and rekey policies, and reduce raw-string dependencies. Only then should the runtime QUID width be shortened. Ten characters are a prudent alternative if millions of cumulatively reserved values and registry memory remain uncertain. The existing 16-character format should remain versioned at persisted document boundaries until a deliberate document-identity migration exists.

No authorization, capability, authentication, secrecy, or other security-token use of QUIDs was found. The LiveTree contract expressly denies that role in [`docs/hson-livetree.md`](../hson-livetree.md#L90), and LiveHost uses separately generated session credentials in [`livehost.session.ts`](../../src/api/livehost/livehost.session.ts#L83) plus session/action identifiers. QUID generation nevertheless uses a cryptographically strong source; unpredictability is not what supplies uniqueness.

### Repositories and state inspected

- `hson-live` at audit start: commit `22feeb19c1502ce313f5a8a4a95fd631f3e71b26`, branch `main` tracking `origin/main`.
- `hson-demo2` at audit start and completion: commit `bcc8fd753fe64f0e640ca7296c128961518d05ce`, branch `main` tracking `origin/main`, clean.
- At audit start, `hson-live` already had modified `package.json`, `src/_tests/test-launchers.ts`, `src/diagnostics/test-circuit.ts`, and `src/types/diagnostics.types.ts`, plus untracked `src/diagnostics/circuit-engine.ts`, `src/diagnostics/circuit-transform-boundary.ts`, `tests/circuit-failure-control.acceptance.mts`, `tests/circuit-legacy-wrapper.acceptance.mts`, and `tests/circuit-semantic-engine.acceptance.mts`. Those files were treated as an in-progress unrelated refactor and were neither edited nor executed.
- During the audit, `tests/circuit-test-helpers.mts` appeared as another untracked file. The repository then advanced concurrently to commit `d984de72ba92494e6766f1d03960d4fd8fa0ce6c` (`+ deconstructed and hardened the transform circuit`), which committed exactly those ten pre-existing/refactor files. None is a QUID implementation path cited by this audit. At final validation, `hson-live` was clean except for this requested untracked audit document. This audit neither created nor touched the concurrent refactor changes.

## 2. Current QUID contract

A current QUID is a string stored in the `quid` member of an element node's `$_meta` object. The type alias is only `string`, not an opaque or nominal brand. Only ordinary HSON element nodes are eligible; virtual/special nodes and primitive values are not. The authoritative definition and eligibility predicate are in [`src/core/hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L6), and the metadata schema registers the field in [`src/core/hson-metadata.ts`](../../src/core/hson-metadata.ts#L31). The public node shape exposes it through `HsonMeta` in [`src/core/types.ts`](../../src/core/types.ts#L46).

The implementation currently gives QUIDs these overlapping meanings:

- Active LiveTree routing key: QUID resolves a node, DOM element, CSS owner, event/resource owner, or reflection record inside a runtime.
- Canonical metadata: QUID participates in canonical equality and ordinary graph serialization.
- Sparse LiveMap document identity: QUID can target graph operations and be looked up through `document.byQuid`.
- LiveHost transport identity: QUID-bearing graph content and QUID targets survive history, snapshots, bootstrap, recovery, and persistence.
- Diagnostic value: QUIDs appear in errors, debug output, tests, and DOM metadata.

Those meanings are not governed by one namespace or lifetime. “Persisted QUID” is also the name of the core type and constants, reinforcing a contract stronger than ephemeral runtime identity.

## 3. Encoding, generator, and validator inventory

### Authoritative symbols

| Concern | Symbol and source | Finding |
|---|---|---|
| Type | `PersistedQuid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L6) | Alias of `string`; no brand prevents mixing with arbitrary strings. |
| Width | `PERSISTED_QUID_LENGTH` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L9) | Exactly 16 characters. |
| Alphabet | `PERSISTED_QUID_ALPHABET` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L10) | `0123456789abcdefghjkmnpqrstvwxyz`, exactly 32 lowercase symbols. `i`, `l`, `o`, and `u` are excluded. |
| Validation | `is_persisted_quid` / `assert_persisted_quid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L12) | Exact width and alphabet. Uppercase and malformed input are rejected, not normalized or repaired. |
| Encoding | `encode_persisted_quid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L21) | Encodes exactly ten bytes as sixteen 5-bit characters without padding: 80 bits. |
| Generation | `mint_hson_node_quid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L73) | Calls `globalThis.crypto.getRandomValues(new Uint8Array(10))`; explicitly throws if unavailable. There is no weak-random fallback. |
| Eligibility | `assert_hson_node_quid_eligible` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L83) | Uses the ordinary-element guard; other structural nodes are rejected. |
| Metadata read | `read_hson_node_quid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L101) | Rejects invalid placement and malformed strings. |
| Assignment | `assign_hson_node_quid` / `ensure_hson_node_quid` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L125) | Bare core `ensure` preserves an existing value or mints one, with no namespace collision check. |
| Duplicate scan | `collect_hson_node_quid_claims` / `index_unique_hson_node_quid_claims` in [`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L167) | The unique index rejects one QUID claimed by distinct nodes. Cold parsing deliberately invokes format/placement validation without uniqueness. |
| Compatibility export | [`src/core/persisted-quid.ts`](../../src/core/persisted-quid.ts) | Re-exports the authoritative symbols; it is not a second domain. |
| Markup key | `HSON_META_MARKUP_PREFIX` plus `HSON_META_QUID` in [`src/core/constants.ts`](../../src/core/constants.ts#L55) | `hson:quid`; `data-_quid` is not the current identity attribute. |
| Invariants | `assert_invariants` in [`assert-invariants.ts`](../../src/core/assert-invariants.ts#L82) and metadata admission in [`hson-metadata.ts`](../../src/core/hson-metadata.ts#L135) | Use the same validator domain. No divergent QUID alphabet/width validator was found. |

The alphabet is Crockford-style rather than a complete Crockford implementation: its important machine property is simply lowercase base 32. Ambiguous letters are excluded, while the symbol count remains 32, so no entropy is lost. Casing is rejected rather than folded.

Authored HSON ingress shares `assign_ingested_hson_node_quid` and performs a cold scan in [`quid-ingress.ts`](../../src/api/transform/utils/hson-utils/quid-ingress.ts#L27). HTML metadata admission goes through the same registry. Explicit structural JSON can hoist `$_meta` from element objects and then validates invariants in [`parse-json.ts`](../../src/api/transform/from/json/parse-json.ts#L374). Ordinary application JSON does not become QUID-bearing metadata merely because it contains a similarly named property.

Graph normalization shallow-copies `$_meta` in [`normalize-hson-graph.ts`](../../src/core/normalize-hson-graph.ts#L88); it does not fold case, widen/narrow, repair, or regenerate a QUID. Validation at the consuming boundary remains responsible for rejecting a copied malformed value.

The runtime floor is Node 22.12 or newer in [`package.json`](../../package.json#L18). Node 22 exposes Web Crypto and `getRandomValues`; browsers and Web Workers broadly expose the same API, and Cloudflare Workers implements it. See the [Node 22 Web Crypto documentation](https://nodejs.org/download/release/v22.15.0/docs/api/webcrypto.html), [MDN `getRandomValues`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues), and [Cloudflare Workers Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/). Availability is therefore appropriate in the supported environments, but failure is intentional when a host lacks Web Crypto.

Production code centralizes the QUID-specific `16` and `80` assumptions in the authoritative module. Tests and fixtures contain many exact sixteen-character values, `{16}` regular expressions, encoded vectors, and canonical digests. Other occurrences of `16` include unrelated LiveHost credential lengths and policy limits and must not be mechanically changed. Searches for `data-_quid` found compatibility/regression examples of ordinary application attributes; they are not aliases for `hson:quid`. “Crockford” occurs in test/descriptive language, not as a separate implementation.

## 4. Allocation call graph

The two minting layers are materially different:

```text
bare canonical helper
  ensure_hson_node_quid(node)
    preserve valid existing claim, else crypto mint
    no registry or retry

LiveTree runtime
  admit_livetree_quid_graph(runtime, root)
    validate full graph and external claims atomically
    root: preserve or checked mint
    descendants: register supplied claims only
  ensure_quid(runtime, node)
    preserve registered/existing claim or checked mint
    retry against runtime map
  project / graft
    recursively ensure every ordinary element
  clone
    strip source QUIDs and checked-mint every ordinary clone node
```

The runtime allocator and admission path are in [`data-quid.ts`](../../src/api/livetree/quid/data-quid.ts#L60). `mint_available_quid` retries up to 32 times against both reservations and the runtime forward map. `admit_livetree_quid_graph` preflights the whole incoming graph, rejects active duplicates before mutation, ensures the root, preserves supplied descendant QUIDs, and leaves absent passive descendants unquidded. `ensure_quid` then claims individual nodes as needed.

### Allocation-path matrix

| Trigger | Owner | Eager/lazy and reach | Existing claim | Collision/external policy | Avoidable? |
|---|---|---|---|---|---|
| Canonical factory or bare core `ensure_hson_node_quid` | Core node helper | On explicit call; one node | Preserved | No collision check | Yes, if caller does not ensure. |
| Authored HSON parse | Transform ingress | No mint; full cold validation | Preserved | Format/placement checked; cold duplicates allowed | Yes. |
| HTML parse | Transform metadata admission | No mint | Preserved | Format/placement checked; cold duplicates allowed | Yes. |
| Structural JSON parse | JSON transform | No mint | Preserved | Format/placement checked; cold duplicates allowed | Yes. |
| `new LiveTree` / `createLiveTree` | LiveTree runtime | Root eager; descendants sparse | Preserved | Whole graph preflight; active and local duplicate rejection | Root allocation cannot currently be avoided. |
| `find` structural query | Find layer | Search itself does not mint; wrapping each result as LiveTree ensures result root | Preserved | Runtime checked | Only if results are not materialized as LiveTrees. |
| `find.byQuid` | Runtime lookup | Never mints | Required to exist in registry/subtree | Raw external string is looked up | Yes; lookup only. |
| DOM projection | Projection layer | Recursive/eager for every ordinary element | Preserved | Runtime checked | Not on the current projection path. |
| Graft existing DOM | Graft + projection | Root admission, then recursive projection | Preserved if valid | External DOM claim is format-validated and active duplicates rejected | Not on the current graft path. |
| Create/append/insert child | LiveTree mutation | Child handle root eager; mounted projection recursively ensures subtree | Preserved | Same-runtime checked; cross-runtime trees rejected | Recursive mint is avoidable only while unmounted. |
| Direct mutation | Existing LiveTree handle | No new identity beyond handle/root; newly wrapped nodes ensure | Preserved | Runtime checked | Usually. |
| Style, event, animation, binding | CSS/lifecycle/reflection layers | Owner handle is already quidded; no separate node allocation | Preserved | Uses admitted raw QUID | Allocation precedes API call. |
| Clone | Clone layer | Recursive/eager for every eligible ordinary clone node | Source claims are stripped; fresh claims minted | Runtime checked and duplicate-scanned | No on current clone path. |
| LiveMap document creation/import/install/restore/replay | LiveMap document | Never mints; builds sparse index | Preserved | Per-document duplicates rejected | Yes; identity must be supplied. |
| LiveMap document capture from canonical graph | LiveMap document | Never mints | Preserved | Duplicate index checked | Yes. |
| Reflect LiveMap document into LiveTree | Reflection + LiveTree | Canonical supplied claims preserved; projection mints runtime-only claims for absent nodes | Preserved for canonical targets | Must fit active LiveTree runtime; collision rejects | Not while using current projection. |
| LiveHost bootstrap/history/recovery/persistence | LiveHost codecs | Never mints | Preserved | Codec/document validation rejects malformed/duplicate graph claims | Yes; transport only. |

Relevant source paths include the LiveTree constructor and public getter in [`livetree.ts`](../../src/api/livetree/livetree.ts#L211), query wrapping in [`find.ts`](../../src/api/livetree/methods/find.ts#L192), recursive projection in [`project-live-tree.ts`](../../src/api/livetree/creation/project-live-tree.ts#L168), graft admission in [`graft.ts`](../../src/api/livetree/creation/graft.ts#L73), recursive remint in [`clone.ts`](../../src/api/livetree/utils/clone.ts#L22), and append preflight/projection in [`appends.ts`](../../src/api/livetree/mutation/appends.ts#L317). A projection comment saying the phase does not assign QUIDs conflicts with its subsequent `ensure_quid` call and should be corrected when the refactor permits documentation/comment edits.

The implementation does not consistently follow “QUID per independently identity-bearing node.” Cold canonical graphs can be entirely unquidded; admitted passive descendants can remain unquidded; every projected or cloned ordinary element is nevertheless quidded regardless of whether any external handle independently needs it.

## 5. Measured allocation density

No repository program was executed. Counts below are a static census of existing fixture start tags, combined with the deterministic allocation paths above; they are not performance benchmarks.

| Existing case | Eligible ordinary elements | Cold parse | LiveTree root only | Full projection/graft |
|---|---:|---:|---:|---:|
| Small ingress test graph in [`hson-node-quid-ingress.acceptance.mts`](../../tests/hson-node-quid-ingress.acceptance.mts#L851) | 3 | 2 supplied / 3, 0 generated | 2 / 3 after admission; querying the passive child reaches 3 / 3 | 3 / 3 |
| Ordinary demo fixture [`htmlstring.html`](../../../hson-demo2/tests/fixtures/transform/html/htmlstring.html) | 86 start tags, 0 authored QUIDs | 0 / 86 | 1 / 86 | 86 / 86 |
| Large MDN demo fixture [`large/html-mdn-homepage.html`](../../../hson-demo2/tests/fixtures/transform/large/html-mdn-homepage.html) | 7,126 start tags, 0 authored QUIDs | 0 / 7,126 | 1 / 7,126 | 7,126 / 7,126 |
| Browser QUID-selector fixture [`quid-selector-fixture.html`](../../../hson-demo2/tests/fixtures/browser/quid-selector-fixture.html) | 16 managed ordinary nodes created by its two roots and test setup | N/A | 2 / 16 roots | 16 / 16 after its managed trees are projected |

The LiveInspector materialization runner asserts a 1,001-branch graph for 1,000 properties and separately distinguishes one initially materialized UI branch from 1,001 expanded branches in [`run-live-inspector-materialization.node.mts`](../../../hson-demo2/tests/runners/liveinspect/run-live-inspector-materialization.node.mts#L128). It does not check in QUID counts, so this audit does not present those numbers as measured identity density. The code path implies that each materialized LiveTree branch becomes identity-bearing.

For operation-specific density, querying an untouched passive descendant materializes a result handle and allocates that one node; styling or event-binding a node does not add another identity because the receiving LiveTree handle was already allocated; and untouched passive descendants remain unallocated only until recursive projection reaches them. Thus the difference between a queried, styled, event-bound, and passive node is chiefly *when its handle/projection causes allocation*, not a distinct class of QUID.

## 6. Namespace ownership map

`LiveTreeRuntime` owns `quidToNode: Map<string, HsonNode>` and `nodeToQuid: WeakMap<HsonNode, string>` in [`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L12). The forward map strongly retains admitted nodes. A module-level default runtime backs ordinary public construction; isolated runtimes are used by diagnostics. A graph cannot be active in two runtimes, and one physical `Document` cannot be attached to multiple runtimes. Multiple LiveTrees and documents can share one runtime. Thus the active LiveTree namespace is neither one graph nor one tree nor one DOM projection: it is one runtime, with the public default approximating one module instance/realm.

| Resolver | Registry owner and lifetime | Collision behavior | Disposal/staleness | Sharing/meeting behavior |
|---|---|---|---|---|
| QUID → canonical node | `LiveTreeRuntime.quidToNode` | Admission/ensure rejects or retries; no overwrite | Terminal removal drops; detach retains; cleanup omission would strongly retain stale nodes | Shared by all trees in that runtime. |
| Node → QUID | `LiveTreeRuntime.nodeToQuid` WeakMap | Exact object binding | Entry follows object GC, but forward map controls retention | Same runtime. |
| QUID → DOM element | `hson:quid` attribute plus runtime node/element maps | Selector is unique only if runtime/DOM invariants hold | Detach preserves metadata; terminal dispose scrubs | A physical document belongs to at most one runtime. |
| QUID → CSS style/rule | Runtime CSS manager `rulesByQuid` in [`css-manager.ts`](../../src/api/livetree/managers/css-manager.ts#L186) | Keyed map update; relies on runtime uniqueness | Terminal lifecycle drains rules; a missed cleanup plus reuse is ABA-prone | Shared inside runtime. |
| QUID → event/resource cleanup | Runtime lifecycle owner maps in [`lifecycle-registry.ts`](../../src/api/livetree/managers/lifecycle-registry.ts#L32) | Relies on runtime uniqueness | Terminal fixed-point cleanup; detach retains | Shared inside runtime. |
| QUID → reflection registration | Document-binding state in [`document-binding-state.ts`](../../src/api/livetree/lifecycle/document-binding-state.ts#L22) | Registration/preflight rejects conflict | Cleared/reconciled with binding | Canonical and projected graphs meet here. |
| QUID → LiveMap node | Per-LiveMap document identity index in [`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts#L7) | Duplicate graph claims rejected | Index replaced atomically and old index becomes collectible | Separate maps may contain identical QUIDs. |
| QUID target → mutation node | LiveMap document target resolver in [`livemap.document.target.ts`](../../src/api/livemap/livemap.document.target.ts#L14) | Requires canonical valid value and a unique indexed match | Fails after target disappears; a later same-string node can create ABA for raw targets | Applies within the current map document. |
| QUID → LiveHost historical target/content | Commit history, snapshots, persistence codecs | Decode and graph admission validate; no allocator | Retained for history/checkpoint/storage lifetime | Scope is effectively a logical map incarnation, not a JS runtime. |

The smallest correct namespaces consistent with current behavior are plural:

- LiveTree presentation identity: one `LiveTreeRuntime` identity epoch.
- LiveMap document identity: one document/map identity epoch.
- LiveHost persisted identity: one `(logicalMapId, incarnationId)` stream and its retained history/checkpoints.

A single “runtime-local QUID” contract cannot describe all three. The architecture should either introduce distinct branded types and fields or remove QUID-addressed durable document behavior.

## 7. Collision and duplicate behavior

LiveTree does active collision detection. `mint_available_quid` checks reserved preflight claims and `runtime.quidToNode`, retries, and fails after 32 collisions. Whole-graph admission is preflighted so a bad incoming graph does not partially mutate the runtime. Existing external claims are trusted only after syntax, eligibility, local-duplicate, and active-runtime conflict checks; a conflict is rejected rather than silently overwritten.

The bare core `mint_hson_node_quid` and `ensure_hson_node_quid` do not know a namespace and therefore assume probabilistic uniqueness. Cold transform ingress validates format and placement but deliberately permits duplicate claims, allowing lossless inspection/serialization of a malformed-for-live graph. Duplicate detection occurs later when a unique index, LiveTree, or LiveMap document admits it.

Separate LiveTree runtimes and separate LiveMaps can legally contain the same QUID. They collide only if later combined into one identity domain. Current cross-runtime LiveTree append is rejected. LiveMap install/mutation validates the final document. No path found silently overwriting two distinct admitted nodes in a QUID registry.

Cryptographic randomness makes chosen-value prediction difficult and produces a uniform draw, but it is not a correctness guarantee. A registry plus atomic claim is the guarantee within one allocator domain. Across workers, processes, runtimes, or independently created graphs, separate registries provide no joint guarantee.

## 8. Deletion, reuse, and stale-handle behavior

LiveTree distinguishes nonterminal detach from terminal disposal:

- Public detach removes DOM but intentionally preserves QUID mappings, listeners, CSS, and node identity in [`runtime-detach.ts`](../../src/api/livetree/lifecycle/runtime-detach.ts#L5).
- Terminal empty/remove runs resource cleanup, destroys subtree QUID mappings, scrubs metadata/DOM, marks exact node objects disposed, and records former QUIDs in [`dispose-node.ts`](../../src/api/livetree/utils/dispose-node.ts#L29) and [`livetree-state.ts`](../../src/api/livetree/livetree-state.ts#L5).
- A non-default runtime may be disposed only when empty; the default runtime is not disposed through that API in [`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L149).
- DOM rebuild within the same live epoch preserves identity. Clone creates new identities. Graph replacement/LiveMap restore replaces the per-document index atomically.
- LiveHost client snapshot recovery decodes preserved document QUIDs and calls `map.restore(capture)` in [`livehost.client.ts`](../../src/api/livehost/livehost.client.ts#L483). The mirror's root/index is replaced rather than runtime QUIDs being freshly minted; path handles remain map/path based, while a retained raw QUID target is subject to the restored document's reuse semantics.

There is no issued-ever tombstone set. Terminal removal releases the string, and acceptance tests explicitly allow a supplied released value to be admitted again in [`livetree-runtime-scope.acceptance.mts`](../../tests/livetree-runtime-scope.acceptance.mts#L237). LiveMap atomic replacement also permits a displaced QUID to be reused. Therefore “no reuse during one namespace lifetime” is false today.

The internal LiveTree node reference captures both the raw QUID and the exact node object; `resolveNode` returns that object rather than re-looking it up by string in [`livetree.ts`](../../src/api/livetree/livetree.ts#L77). Disposed-object state prevents that stale LiveTree handle from silently becoming a handle to a new node, so the main handle path is closer to:

```text
handle → exact internal node record/object → current runtime routing
```

than to:

```text
handle → captured QUID string → fresh global lookup
```

This is favorable for future rekeying: the user-facing object handle can survive if all routing metadata is updated transactionally. However, `NodeRef.q`, public `.quid`, LiveMap QUID targets, serialized commits, CSS/resource maps, DOM attributes, diagnostic fields, and user-captured strings remain raw-string references. Since released values can be reused, those surfaces have an ABA risk: a stale string may later resolve to a different node. Existing exact-object LiveTree handles avoid that specific failure, but external raw-string users do not.

A strict no-reuse policy requires either an issued-ever set for the whole namespace epoch or a non-resetting allocator. An issued-ever set grows with cumulative allocations even after active nodes disappear. A million JavaScript strings plus set/map overhead can consume substantial memory; the exact cost is engine-dependent and must be measured rather than assumed. Resetting the allocator is safe only when a new epoch also invalidates every old raw reference.

## 9. Graft, merge, and rekey behavior

| Boundary | Current behavior | Recommended future policy |
|---|---|---|
| Detach/reinsert in one LiveTree runtime | Preserve QUID and resources | **Preserve within one identity epoch.** |
| Same-runtime append/insert | Validate and preserve supplied claims; projection mints missing descendants | **Validate and preserve** same-epoch nodes. |
| Cross-runtime LiveTree append | Rejects active graph/runtime mismatch | Continue **reject duplicate/cross-runtime**, or explicitly **rekey on admission** if this feature is added. |
| LiveTree clone | Strips all source QUIDs and recursively remints | **Strip and regenerate**; this is already the clearest ephemeral boundary. |
| Imported canonical node/cold authored HSON/HTML/JSON | Preserves syntactically valid values; cold duplicates allowed until live admission | Default external input should **strip and lazily regenerate**, with an explicit diagnostic/same-epoch mode to **validate and preserve**. |
| DOM graft | Preserves valid `hson:quid`; rejects active collision; then recursively ensures | **Rekey on admission** unless provenance proves the DOM belongs to the same runtime epoch. A raw value alone is not provenance. |
| Reflect one LiveMap document into LiveTree | Preserves sparse canonical claims; projected missing nodes gain runtime-only QUIDs | **Validate and preserve** document IDs within the document epoch, but keep runtime QUID separate. |
| LiveMap capture/install/restore/replay | Preserves QUIDs and rejects document duplicates | **Preserve within one document epoch**. External independent content should rekey or fail explicitly. |
| LiveMap inserted graph content | Preserves supplied claims if final graph is unique; displaced value may be reused | **Rekey on admission** for independent content, or **validate and preserve** only with same-epoch provenance. |
| LiveHost bootstrap/recovery/checkpoint/history | Preserves QUID-bearing document nodes and raw QUID targets | Preserve a distinct **document node ID** within `(logicalMapId, incarnationId)`; do not call it a runtime QUID. |
| Standalone graph-content codec | Round-trips QUID metadata | Mark payload with epoch/type; otherwise **rekey on admission** or require explicit controlled preserve. |
| Debug serialization | Preserves QUID | Preserve with a clear **non-durable diagnostic** label. |

Rekeying changes canonical equality because metadata participates in equality in [`canonical-hson-equal.ts`](../../src/core/canonical-hson-equal.ts#L145). It can therefore change no-op detection, commit contents, history diagnostics, snapshots, and checked-in fingerprints. Rekeying an active LiveTree must atomically update the runtime maps, node metadata, DOM attribute, CSS rules/selectors, lifecycle/resource owner keys, keyframe ownership, and reflection registrations. Rekeying only the node metadata would corrupt runtime routing.

Existing LiveTree handles can conceptually survive rekeying because they hold exact node objects, but their captured/public `q` values and any external raw strings cannot. LiveMap QUID-targeted commits cannot be rekeyed without translating all retained targets.

## 10. Serialization and transport matrix

| Format/path | Current QUID behavior | Identity implication |
|---|---|---|
| Authored HSON parse | Preserved if valid; absent stays absent; malformed rejected; cold duplicate allowed | Admits externally supplied strings into canonical metadata. |
| HSON serialization / `HsonCanonical` | Preserved as `@quid` by default | Observable serialized representation. |
| HSON `noQuid` | Omitted from output | Explicit transient/authoring escape hatch; it does not mutate the graph. |
| HSON compact / no-break modes | Preserved unless `noQuid` | Layout options do not change identity semantics. |
| Structural HTML | Preserved as `hson:quid` | Round-trippable metadata. |
| Ordinary managed DOM / `outerHTML` | Preserved as `hson:quid` after projection | Visible/selectable despite “invisible” intent. |
| Structural JSON element graph | Preserved in `$_meta.quid` | Explicit graph JSON carries identity. |
| Ordinary application JSON value output | Generally omitted because output is data, not the element wrapper graph | No general promise that arbitrary JSON carries identity. |
| Cold graph transform serialization | Preserved, including duplicate cold claims | Inspection is lossless; live admission remains stricter. |
| Debug stringify / diagnostics | Preserved or printed | Diagnostic surface, not inherently durable. |
| Canonical equality | Required as metadata; differing QUIDs compare unequal | Rekeying is semantically observable to canonical operations. |
| LiveMap capture/install/restore/replay | Preserved and indexed; duplicate rejected | Current document identity contract. |
| LiveMap document `byQuid` / QUID target | Required for that operation and rejected if invalid/missing | Raw string is a public address. |
| Graph-content codec | Preserved and validated | Controlled transport can carry identity. |
| LiveHost commit history | Preserved in content and QUID mutation targets | Historical operations depend on stable values. |
| LiveHost document snapshot/view-state | Preserved and validated | Snapshot restore recreates the same document identity. |
| LiveHost bootstrap/recovery | Preserved | Mirrors coordinate using the document's values. |
| LiveHost persistence/checkpoint/restart | Preserved | Explicit cross-runtime and cross-restart durability today. |

HSON filtering and the `noQuid` option live in [`serialize-hson.ts`](../../src/api/transform/serializers/serialize-hson.ts#L81) and [`construct-options-3.ts`](../../src/api/transform/constructors/construct-options-3.ts#L78). HTML attribute emission is in [`build-wire-attrs.ts`](../../src/api/transform/utils/html-utils/build-wire-attrs.ts#L35). Structural JSON metadata output is in [`serialize-json.ts`](../../src/api/transform/serializers/serialize-json.ts#L150).

LiveMap builds and replaces its identity index in [`livemap.document.ts`](../../src/api/livemap/livemap.document.ts#L47), exposes `byQuid`, and captures the root with identity in the same module. LiveHost graph-content encode/decode preserves and validates metadata in [`livehost.graph-content-codec.ts`](../../src/api/livehost/livehost.graph-content-codec.ts#L34). View-state codecs preserve exact node metadata in [`livemap.document.view-state-codec.ts`](../../src/api/livemap/livemap.document.view-state-codec.ts#L282). HSON and view-state snapshots preserve it in [`livehost.document-snapshot.ts`](../../src/api/livehost/livehost.document-snapshot.ts#L118), while persistence restores a checkpoint and replays commits in [`livehost.persistence.ts`](../../src/api/livehost/livehost.persistence.ts#L280).

The proposed non-durable serialization statement can be made honestly only after qualification or redesign:

- Honest now for debugging and uncontrolled reparsing if stated as “the bytes may contain a QUID, but no later resolver is promised.”
- Not honest for LiveHost document snapshots, persisted checkpoints, recovery, and QUID-targeted commit history, which intentionally resolve preserved values later.
- Potentially honest after splitting `RuntimeQuid` from a durable, scoped `DocumentNodeId` and making external authored QUIDs strip/rekey by default.

## 11. Public and semi-public exposure inventory

| Surface | Classification | Width change observable? |
|---|---|---|
| `LiveTree.quid` public getter in [`livetree.ts`](../../src/api/livetree/livetree.ts#L373) | Intentional public API | Yes; direct string value and validation expectations change. |
| `LiveTree.node.$_meta.quid` and exported `HsonMeta` | Accidental/structural public exposure | Yes. |
| `find.byQuid` in [`find.ts`](../../src/api/livetree/methods/find.ts#L356) | Intentional public API | Yes; old saved inputs stop resolving/validating. |
| `NodeRef.q` public type in [`livetree.types.ts`](../../src/types/livetree.types.ts#L36) | Compatibility/semi-public surface | Yes. |
| HSON `@quid`, HTML `hson:quid`, structural JSON `$_meta.quid` | Compatibility surface | Yes; serialized bytes, fixtures, hashes, and old input compatibility change. |
| DOM query such as `[hson\\:quid="…"]` | Accidental but practical public exposure | Yes. |
| Public `CssManager` QUID methods/selectors | Intentional/semi-public API | Yes; raw keys/selectors change. Root and `/livetree` export the manager. |
| Keyframe source strings (`global` or a `quid:<value>` form) | Intentional public type surface | Yes; embedded raw value changes. |
| LiveMap `document.byQuid` and `{kind:"quid", quid:string}` targets in [`livemap.types.ts`](../../src/types/livemap.types.ts#L307) | Intentional public API | Yes; persisted operations and callers break. |
| LiveHost graph actions, commits, snapshots, wire payloads | Necessary current transport/compatibility surface | Yes; requires protocol/data migration. |
| CSS/event/resource owner maps | Necessary internal surface | Indirectly; coordinated internal migration required. |
| `LiveTreeAttributeError.quid` / disposed `formerQuid` in [`livetree.error.ts`](../../src/api/livetree/livetree.error.ts#L17) | Diagnostic public surface | Yes, though weaker compatibility expectations may apply. |
| Diagnostic entrypoint QUID helpers in [`diagnostics/index.ts`](../../src/diagnostics/index.ts#L71) | Intentional diagnostic surface | Yes. |
| Debug/canonical output | Diagnostic and compatibility surface | Yes. |

`hson-demo2` itself demonstrates real downstream raw-string dependence: the pointer demo creates a set from `.quid` in [`point.ts`](../../../hson-demo2/src/app/demos/pointer/point.ts#L124), and the hosted test list reads the DOM attribute and calls `find.byQuid` in [`hosted-test-case-list.ts`](../../../hson-demo2/src/app/demos/tests/panel/hosted-test-case-list.ts#L315). The browser QUID-selector specification also asserts the sixteen-character shape. “Invisible” therefore cannot be treated as “unobservable” for compatibility planning.

The package-entrypoint audit confirms these are reachable contracts rather than source-only accidents. [`package.json`](../../package.json#L23) publishes `.`, `./hson`, `./transform`, `./livetree`, `./livemap`, `./livehost`, `./livehost/node`, `./reflect`, `./diagnostics`, and `./types`. The root [`src/index.ts`](../../src/index.ts#L10) exports `LiveTree`, `CssManager`, LiveMap document target/API types, and LiveHost transport/persistence APIs. The [`./livetree` entrypoint](../../src/api/livetree/index.ts#L1) exports `LiveTree`, `CssManager`, and all LiveTree query/reference types; [`./livemap`](../../src/api/livemap/index.ts#L1) exports all document target/API types; [`./livehost`](../../src/api/livehost/index.ts#L1) exports the QUID-preserving codecs and public wire/history types; and [`./types`](../../src/types/index.ts#L1) exposes `HsonMeta`, LiveMap targets, and LiveHost payload types. `./diagnostics` exports direct QUID ensure/get/lookup helpers. `./hson` and `./transform` expose the parsers and serializers through which QUID metadata is accepted and emitted. The named `PersistedQuid` alias, validator, alphabet, and length constants are **not** directly exported by a package entrypoint; their concrete representation is nevertheless exposed structurally as `string` and through serialized bytes.

## 12. CSS and DOM implications

The DOM representation is `hson:quid="<value>"`. The CSS manager validates the value and emits an escaped attribute-name selector of the form `[hson\\:quid="<value>"]` in [`css-manager.ts`](../../src/api/livetree/managers/css-manager.ts#L98). Runtime maps then key style records by the raw string. Projection writes metadata to ordinary elements and rebuild/update paths rely on that mapping.

The current alphabet is safe without value escaping beyond normal quoting: lowercase ASCII letters and digits do not need CSS identifier or HTML attribute special handling. Its lowercase-only nature avoids case disagreement among validators, logs, transports, and selectors. The omitted ambiguous letters are useful for diagnostics and do not reduce entropy because the alphabet still contains 32 symbols.

Expanding the alphabet would buy bits only by introducing non-base-32 symbols or mixed case. At an eight-character width, base 64 would provide 48 bits, but it would add escaping/casing/logging/cross-runtime complexity and compatibility risk across HSON, HTML, JSON, CSS, and diagnostics. The extra eight bits do not remove the need for a registry or solve merge/epoch semantics. Retaining the current 32-symbol lowercase alphabet is the better tradeoff unless measured registry scale establishes a concrete bit requirement; in that case, ten base-32 characters are simpler than a broader alphabet.

Stale style cleanup is coupled to lifecycle cleanup. Detach intentionally retains styles/events/resources. Terminal dispose drains owner registries and removes QUID routing. If cleanup ever misses an entry and a released string is reused, a style or resource can attach to the wrong future node. A no-reuse set prevents that ABA class during the epoch, while correct fixed-point cleanup remains necessary for memory safety.

## 13. Test and documentation gaps

### Existing coverage

- Generation, exact width/alphabet, secure source, and no random fallback: [`hson-node-quid.acceptance.mts`](../../tests/hson-node-quid.acceptance.mts#L106).
- Cold ingress, supplied claims, sparse allocation, collision retry/exhaustion, and atomic admission: [`hson-node-quid-ingress.acceptance.mts`](../../tests/hson-node-quid-ingress.acceptance.mts#L851).
- HSON/HTML/JSON preservation, `noQuid`, and absent-node non-minting: [`hson-node-quid-egress.acceptance.mts`](../../tests/hson-node-quid-egress.acceptance.mts#L213) and [`hson-serializer.acceptance.mts`](../../tests/hson-serializer.acceptance.mts#L422).
- Runtime separation, graph/document ownership, detach, terminal release/reuse, clone identity, and CSS isolation: [`livetree-runtime-scope.acceptance.mts`](../../tests/livetree-runtime-scope.acceptance.mts#L202).
- Eligibility and clone reminting: [`livetree-quid-eligibility.acceptance.mts`](../../tests/livetree-quid-eligibility.acceptance.mts).
- Canonical equality includes QUID metadata: [`canonical-hson-equality.acceptance.mts`](../../tests/canonical-hson-equality.acceptance.mts#L136).
- LiveMap sparse identity, duplicate rejection, capture/install/mutation/replay, and path handles: LiveMap document acceptance suites, including [`livemap-path-handle.acceptance.mts`](../../tests/livemap-path-handle.acceptance.mts#L93).
- LiveHost codec, snapshot, bootstrap, recovery, and persistence round trips: LiveHost/document acceptance suites.
- Browser DOM selector shape and stability: [`quid-selector.spec.ts`](../../../hson-demo2/tests/integration/browser/quid-selector.spec.ts).

### High-value missing tests before shortening

1. Issued-ever no-reuse and namespace tombstone behavior after terminal deletion.
2. Stale raw-string ABA resolution after deletion/reuse, contrasted with exact-object handles.
3. Explicit allocator epoch reset and proof that old handles/targets cannot cross it.
4. One-million/ten-million cumulative-issue registry memory and latency budgets.
5. Independent worker/process/runtime allocators whose graphs later merge.
6. A policy test for every boundary in section 9: preserve, rekey, strip, or reject.
7. Transactional rekey tests covering DOM, CSS, events, animations, resources, reflection, and handles.
8. Versioned acceptance of legacy sixteen-character persisted inputs and migration to a new document-ID format.
9. Deterministic allocator injection that avoids replacing global crypto in tests.
10. Actual minting in browser Worker and Cloudflare-like environments, not only transport preservation.
11. Malicious repeated externally supplied identifiers across every live admission/restore protocol.
12. An invariant test that QUIDs never authorize actions or act as bearer secrets.

### Documentation contradictions

- [`docs/hson-livetree.md`](../hson-livetree.md#L88) correctly describes internal live identity, detach stability, fresh clone identity, transform output as non-persistence, and QUIDs as non-security values.
- [`docs/hson-livemap.md`](../hson-livemap.md#L365) describes sparse map-local identity and says LiveMap does not mint QUIDs, matching code. Earlier roadmap text still says graph apply/replay/recovery/persistence do not exist even though those paths are implemented.
- [`docs/livemap/overview.md`](../livemap/overview.md#L1125) says QUID identity is stable through capture, restoration, and replay. That is a durable scoped identity promise and conflicts with a blanket ephemeral-only statement.
- [`docs/hson-locus.md`](../hson-locus.md#L262) says snapshots do not preserve graph QUID identity or presents preservation as roadmap work, contradicting the implemented exact metadata codecs, history, recovery, and persistence.
- Transform documentation publicly specifies the persisted 80-bit format. Combined with public parsing/serialization, that makes width and alphabet a compatibility surface even if application authors are discouraged from using the values.

## 14. Probability comparison: 8, 10, and 16 characters

Let `M = 2^b`. For `n` random values, the unchecked probability of at least one collision is approximated by `1 - exp(-n(n-1)/(2M))`. With `n` already reserved values, the next checked draw collides with probability `n/M`, and expected draws are `1/(1-n/M)` under uniform independent draws.

### Eight characters / 40 bits (`M = 1,099,511,627,776`)

| Issued/reserved `n` | Unchecked birthday collision | Next checked draw collides | Expected checked draws |
|---:|---:|---:|---:|
| 100 | `4.502e-9` | `9.095e-11` | `1.00000000009` |
| 1,000 | `4.543e-7` | `9.095e-10` | `1.00000000091` |
| 10,000 | `4.547e-5` | `9.095e-9` | `1.00000000909` |
| 100,000 | `0.0045371` (0.454%) | `9.095e-8` | `1.00000009095` |
| 1,000,000 | `0.365391` (36.5%) | `9.095e-7` | `1.00000090950` |
| 10,000,000 | `1 - 1.781e-20` | `9.095e-6` | `1.00000909503` |

### Ten characters / 50 bits (`M = 1,125,899,906,842,624`)

| Issued/reserved `n` | Unchecked birthday collision | Next checked draw collides | Expected checked draws |
|---:|---:|---:|---:|
| 100 | `4.396e-12` | `8.882e-14` | `1.00000000000009` |
| 1,000 | `4.436e-10` | `8.882e-13` | `1.00000000000089` |
| 10,000 | `4.440e-8` | `8.882e-12` | `1.00000000000888` |
| 100,000 | `4.441e-6` | `8.882e-11` | `1.00000000008882` |
| 1,000,000 | `0.000443990` (0.0444%) | `8.882e-10` | `1.00000000088818` |
| 10,000,000 | `0.0434373` (4.34%) | `8.882e-9` | `1.00000000888178` |

### Sixteen characters / 80 bits (`M = 1,208,925,819,614,629,174,706,176`)

| Issued/reserved `n` | Unchecked birthday collision | Next checked draw collides | Expected checked draws |
|---:|---:|---:|---:|
| 100 | `4.095e-21` | `8.272e-23` | effectively `1` |
| 1,000 | `4.132e-19` | `8.272e-22` | effectively `1` |
| 10,000 | `4.135e-17` | `8.272e-21` | effectively `1` |
| 100,000 | `4.136e-15` | `8.272e-20` | effectively `1` |
| 1,000,000 | `4.136e-13` | `8.272e-19` | effectively `1` |
| 10,000,000 | `4.136e-11` | `8.272e-18` | effectively `1` |

At ten million reservations, a 40-bit namespace is only about `0.0009095%` occupied, so exhaustion is remotely irrelevant and retry remains cheap. The risk is not exhaustion; it is missing, partitioned, reset, or non-atomic registries. Checked generation guarantees uniqueness only in the complete registry being checked. Unchecked generation never becomes a correctness guarantee, even at 80 bits; it only makes failure negligible.

## 15. Candidate-contract classification

| Candidate clause | Status today | Required change |
|---|---|---|
| Fixed 8-character lowercase 32-symbol QUID, 40 random bits | **False today** | Versioned encoding and compatibility migration. |
| High-quality random generation | **Already true** | Retain Web Crypto and explicit failure. |
| Namespace collision check and retry | **Mostly true** | LiveTree has it; bare core minting and independently scoped systems do not share it. Centralize ownership. |
| No reuse during namespace lifetime | **False today** | Issued-ever tombstones or monotonic allocation plus explicit epoch reset. |
| One explicitly owned active runtime identity namespace | **Ambiguous / requires architectural change** | True for each LiveTree runtime, false for the combined LiveMap/LiveHost meaning. Split identities/scopes. |
| Allocated lazily | **False as a blanket claim** | Root, projection, child handles, and clone are eager. Define the desired trigger and prove it. |
| Boundary-specific strip/validate/preserve/rekey | **Partly true** | Policies exist inconsistently; external provenance and rekey transactions need design. |
| Invalid after namespace disposal/restart unless in one shared epoch | **False today** | LiveHost intentionally restores values across restart. Use a distinct document epoch/ID. |
| Users normally use handles/bindings/references/packages | **Mostly true as guidance** | Many normal APIs still expose raw strings. |
| Raw-QUID lookup is not the normal user path | **False/ambiguous** | `find.byQuid`, LiveMap targets, CSS manager methods, demos, and serialized APIs make it supported. Deprecate or scope them. |
| Serialization may preserve for controlled internal/diagnostic use | **Already true in part** | Mark provenance and purpose. |
| Serialization does not promise durable identity | **False today** | Redesign LiveHost/LiveMap identity or qualify this to runtime QUIDs only. |

## 16. Alternative-design comparison

| Design | Correctness and registry | Size/complexity | Merge and concurrency | Stale/compatibility fit |
|---|---|---|---|---|
| **A. 8-character checked random (40-bit)** | Correct within one complete atomic active/issued registry; unsafe unchecked at million scale | Smallest fixed representation; registry and no-reuse memory required | Independent runtimes can collide and must rekey/reject; workers/processes do not share a registry | Excellent for invisible ephemeral runtime routing after API cleanup; largest break from current persisted width. |
| **B. 10-character checked random (50-bit)** | Same correctness requirement; far lower probability if a boundary accidentally remains unchecked | Two extra bytes per occurrence; otherwise same implementation | Same merge semantics; extra bits only reduce accidental collision, not guarantee uniqueness | Safer transitional runtime choice if cumulative scale/registry completeness is uncertain. Still requires persisted-data migration. |
| **C. Variable-length monotonic allocator** | Collision-free under one serialized allocator; no random collision registry needed, though node routing map remains | Initially compact; variable parsing/storage; exposes allocation order | Reset and independent allocators collide; workers need coordination or prefixes; merges rekey | Deterministic tests are easy, but visible order and reset/ABA semantics fit ephemeral identity less cleanly. |
| **D. Namespace prefix plus local random/counter** | Correct if prefixes are truly unique and scoped; local registry may still be needed | Largest and most complex; must define/serialize epoch prefix | Best when independently allocated graphs routinely coexist without rekeying; works across workers/processes only with prefix authority | Risks turning an ephemeral hook into a durable composite ID. Appropriate only if document identity genuinely needs it. |

Option A is provisionally viable for a corrected LiveTree-only contract. Option B buys operational margin for two characters and is preferable if the implementation cannot afford an issued-ever registry or routinely reaches millions of cumulative allocations. Option C is attractive only if revealing order and coordinating/resetting allocators are accepted. Option D solves a different problem—independent durable identity domains—and should be considered for a separately named document identity, not added automatically to runtime QUIDs.

## 17. Recommended architecture

1. **Split the concepts.** Introduce conceptual and eventually nominal separation between `RuntimeQuid` and `DocumentNodeId`. A runtime QUID routes within one `LiveTreeRuntime` epoch. A document ID routes within one LiveMap/LiveHost `(logicalMapId, incarnationId)` epoch and may be persisted.
2. **Make one allocator own each runtime namespace.** Move all runtime mint/ensure/admit behavior behind `LiveTreeRuntime`; avoid bare namespace-free minting in live paths. Generate, validate, reserve, and claim synchronously as one operation.
3. **Define the epoch and no-reuse budget.** If no reuse is required, retain an issued-ever set until runtime disposal, including deleted identities. Measure memory at one million and ten million cumulative issues. If that is unacceptable, use a generation/epoch token in handles and routing rather than claiming no reuse.
4. **Keep handles opaque.** Make exact node/identity records the stable handle anchor. Treat raw QUID getters and QUID lookup as compatibility/diagnostic APIs, with deprecation or explicit unsafe/epoch-scoped naming. Rekeying can then preserve handles.
5. **Make boundary provenance explicit.** A syntactically valid external QUID is not proof of same-epoch ownership. Each ingress must declare same-epoch preserve, external rekey, diagnostic preserve, or duplicate rejection.
6. **Use transactional rekey.** Update runtime maps, metadata, DOM, CSS, lifecycle/event/animation/resource ownership, reflection records, and any current references atomically. Never mutate only the serialized field.
7. **Version persisted formats.** Current 16-character validators reject 8-character data, and a new strict 8-character validator will reject old snapshots. Graph-content, view-state, bootstrap, history, checkpoint, and persistence formats require a migration/version plan. Retained QUID-targeted history must be translated together with node IDs.
8. **Retain the lowercase 32-symbol alphabet.** It is safe across current CSS/DOM/markup/transport uses. Width, not alphabet expansion, is the simpler tuning control.

The target should explicitly say that runtime QUIDs are not security tokens and cannot authorize access. Document IDs should also not become bearer credentials; LiveHost must continue to authorize through its existing security model.

### Required risk disposition

| Risk | Current disposition | Required disposition before shortening |
|---|---|---|
| Collision without registry enforcement | Bare core generation is unchecked; 40-bit birthday risk is high at cumulative million scale | Prevent live minting outside the owning registry. |
| Registry memory growth | Active LiveTree map strongly retains nodes; issued-ever tombstones do not exist | Set and measure an active/cumulative memory budget, especially at one million or more issues. |
| Allocator reset | New runtime/realm/process starts with an empty registry | Give every reset a new epoch and prevent old raw references crossing it. |
| Stale handle resolution | Exact-object LiveTree handles are protected; raw strings can suffer ABA after reuse | Keep handles record/object based and eliminate reuse or add generation awareness. |
| Independent graph merge | Same-runtime input is checked; cross-runtime append rejects; cold graphs can collide | Define admission provenance and rekey/reject atomically. |
| Externally supplied and malicious duplicates | Syntax is checked; cold duplicates are retained; LiveTree/LiveMap admission rejects | Never overwrite; bound preflight work and return a deterministic rejection rather than allowing collision-based denial of service. |
| Worker/thread/process concurrency | One JavaScript runtime claims synchronously, but separate workers/processes have separate registries | Treat each as a distinct epoch or coordinate through an explicit shared authority; randomness alone is insufficient. |
| Multiple LiveTrees in one document | Public default runtime shares one registry; document ownership guard prevents multiple runtimes owning one physical document | Preserve that invariant or make document/runtime ownership explicit in the API. |
| LiveHost mirrors | Snapshot/bootstrap/recovery preserve document QUIDs across mirrors | Scope persisted node IDs by logical map incarnation; do not interpret them as mirror-local RuntimeQUIDs. |
| Persisted document graphs | Current codecs/history require exact identity | Version and migrate a distinct document identity before changing width. |
| Deterministic tests | Tests replace/control randomness at low level; no explicit allocator seam | Inject a deterministic allocator/entropy source into isolated test runtimes. |
| Cryptographic unpredictability | Web Crypto is used | Retain it for uniform safe generation, but document that registry ownership—not secrecy—guarantees uniqueness. |
| Security-token misuse | No authorization/security role found; docs expressly deny one | Keep QUIDs out of authorization decisions and add an invariant/security review test. |

## 18. Migration sequence

### Correctness prerequisites

1. Freeze terminology and specify the LiveTree runtime epoch, LiveMap document epoch, and LiveHost incarnation scope.
2. Decide whether persisted graph identity remains a feature. If yes, split `DocumentNodeId` from `RuntimeQuid`; if no, redesign QUID-targeted history before removing preservation.
3. Centralize runtime allocation/admission and prove atomic collision checking for every active ingress.
4. Define deletion, no-reuse, allocator reset, runtime disposal, and memory limits.
5. Assign an explicit preserve/rekey/strip/reject policy to every boundary in section 9.
6. Implement an opaque handle/identity-record route and a transactional rekey design.

### Changes that may land together

7. Add allocator injection and the missing collision, ABA, merge, rekey, worker, and memory tests.
8. Update CSS/event/resource/reflection ownership together with any rekey implementation.
9. Add versioned legacy-16 decode and current-format encode across all graph/history/snapshot/persistence codecs together; translate retained QUID targets in the same migration.

### Compatibility changes

10. Document raw QUID surfaces as epoch-scoped; deprecate or replace `LiveTree.quid`, `find.byQuid`, public raw CSS methods, raw LiveMap QUID targets, direct metadata access, and demo usage as appropriate. Do not silently change their width while promising compatibility.
11. Update authored HSON/HTML/JSON ingress defaults and provide an explicit controlled-preserve mode if required.
12. Migrate exact fixtures, `{16}` tests, serialization snapshots, canonical digests/fingerprints, demo selectors, and documentation only after the protocol decision.

### Encoding change

13. Select 8 versus 10 characters using measured cumulative namespace size and registry memory, then shorten runtime QUIDs.
14. Keep document identity at its independently selected/versioned width. Do not force both concepts to share an encoding merely because they currently share a field.

### Optional later cleanup

15. Remove legacy-16 decoders only after all supported persisted data and retained history have expired or migrated.
16. Remove compatibility raw-string APIs in a major release after opaque alternatives are established.
17. Correct stale roadmap/comment text and narrow diagnostic exposure.

## 19. Stop conditions and unresolved decisions

Do **not** shorten QUIDs until all of these stop conditions are cleared:

- A single field still means both ephemeral runtime routing and durable document identity.
- Any minting path can bypass the owning collision registry.
- No-reuse is claimed without an issued-ever mechanism or generation-aware handles.
- External HSON/HTML/JSON/DOM provenance and duplicate policy remain implicit.
- LiveHost history/snapshot/persistence compatibility lacks a versioned migration.
- Rekeying cannot update CSS, events, animations, resources, DOM, reflection, and retained targets atomically.
- Public raw-QUID compatibility has not been explicitly accepted, deprecated, or migrated.
- Registry memory at expected cumulative allocation counts is unknown.

Unresolved product/architecture decisions:

1. Is persistent LiveMap/LiveHost node addressing a supported feature? Current code says yes; the proposed prose suggests no for QUIDs.
2. Is “no reuse” required for all issued runtime values or only while active? The former prevents ABA but grows memory.
3. Does the default runtime live for a module instance, a realm, a document, or an explicitly disposable application session?
4. Should independently authored/imported graphs preserve identity only with an authenticated epoch token, or always rekey?
5. Must retained LiveHost history remain replayable across an encoding migration?
6. What cumulative allocation ceiling and memory budget should choose between 8 and 10 characters?
7. Which raw-QUID public surfaces receive a deprecation cycle versus immediate internalization in a major version?

Subject to those decisions, eight characters are provisionally viable for **runtime-only, checked, epoch-scoped identity**. They are not yet a safe drop-in replacement for the repository's current combined runtime-and-persisted QUID contract.
