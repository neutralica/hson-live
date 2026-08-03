# QUID responsibility, path authority, and sparse live identity refactor plan

Status: Units 0 through 7, Unit 2, reflected prerequisites 10R-A/10R-B, and public Unit 10 implemented and executable; later-unit architecture remains a plan.

This plan corrects the architectural recommendation in the earlier [QUID scope and encoding forensic audit](./quid-scope-and-encoding-audit.md). In particular, it does **not** introduce `DocumentNodeId`, a hidden permanent UUID, or a renamed equivalent. One QUID concept remains the optional HSON Live identity affordance. Durable LiveMap structure is addressed by revisioned paths and operation semantics, while application identity remains user data.

Unit 0 settles one additional point that supersedes the earlier draft below: QUID metadata is canonical graph state. A QUID-only mutation of a LiveMap-owned graph uses the ordinary LiveMap revision and commit stream. No `identityGeneration` is introduced, and strict canonical equality remains QUID-sensitive. Later units may derive sparse lookup updates from accepted canonical commits, but they must not create a silent identity mutation stream or allow same-revision canonical graphs to differ only by QUID metadata.

Unit 1 supersedes the inspection-baseline statements below that say mutation commits preserve the caller's request-target form. `LiveMapDocumentRequestTarget` remains path-or-QUID for active compatibility calls, while every newly constructed `LiveMapGraphOp` uses `LiveMapDocumentCommitTarget`, a validated path plus optional non-routing witness. The Unit 3 sparse overlay now performs bounded synchronous QUID-request lowering; replay retains one named legacy QUID adapter, and the old LiveHost wire decoder remains a compatibility input pending Unit 8. The inventory below remains useful as historical migration evidence, not as the post-Unit-1 operation contract.

Unit 3 replaced the retained QUID-to-node index with one immutable, bidirectional QUID/path overlay per document map. The overlay is derived and nonserialized, retains no graph pointers, and stores entries only for present QUIDs. Root, revision, and overlay are installed as one controller state after candidate validation. `document.byQuid`, request lowering, witness checks, and narrow reflection correspondence consume overlay paths. Its initial correctness strategy rebuilt from each candidate graph; Unit 4 now supersedes that ordinary-operation seam.

Unit 4 replaces that ordinary-operation rebuild seam with the shared document operation reducer. Attribute operations preserve the exact overlay; content insert/replace scan only admitted incoming subtrees and reconcile surviving sparse claims; remove/move transform sparse paths through Unit 1 semantics. Replay consumes each staged overlay from the same reducer. Derived identity effects remain internal, noncanonical, and nonserialized. Complete-root construction, install, restore, and replacement retain one bounded admission scan.

Unit 5 completes the request/canonical split across the remaining authority surfaces. Active LiveMap and LiveHost action requests may still use QUIDs, but resolution occurs inside the accepting staged transaction. Canonical LiveMap and LiveHost types, current protocol decoding, history, recovery, client application, and new persistence appends are path-only with an optional witness. Named internal compatibility readers lower old QUID-only commits from the exact checkpoint/base graph and normalize them immediately; no protocol version or persistence rewrite was required for new-format correctness.

Unit 6 makes document Reflection path-first. The exact accepted commit privately carries Unit 4 identity effects to the binding; paths route, witnesses validate, moves retain exact projected subtrees, and compatible same-QUID replacements remain conservative continuity cases. Ordinary local operations update binding correspondence through the shared Unit 1 transform without a whole-domain rebuild. Initialization, snapshots, and compatible root replacement retain the legitimate complete-build boundary. LiveTree runtime registries and public semantics remain unchanged.

Unit 7 classifies capture and admission without introducing a second graph or persisted identifier. Existing `capture()` remains a durable exact-metadata capture. Additive `identity` options select same-epoch, preserve-metadata, strip, or strict external rejection. Same-epoch proof is an opaque exact capture-object capability held in a `WeakMap`; copied or decoded bytes cannot recreate it, and changed durable root replacement invalidates it. All preserved document QUIDs still satisfy Unit 3 by becoming validated fresh map-local overlay claims. That lookup continuity is explicitly distinct from old map or browser handle continuity. Existing view-state, graph-content, LiveHost snapshot/bootstrap/recovery, and persistence formats remain unchanged durable structural formats.

## Inspection baseline

The source was inspected without builds, tests, generators, package installation, or other executable repository scripts. The baseline was:

- `hson-live`: commit `d984de72ba92494e6766f1d03960d4fd8fa0ce6c` on `main`. Pre-existing changes were `package.json`, `src/_tests/test-launchers.ts`, and `src/diagnostics/index.ts`; pre-existing untracked files were `docs/plans/quid-scope-and-encoding-audit.md`, `src/diagnostics/verify-universal-circuit.ts`, and `tests/universal-circuit-verification.acceptance.mts`.
- `hson-demo2`: commit `bcc8fd753fe64f0e640ca7296c128961518d05ce` on `main`. Pre-existing changes were `package.json`, `tests/harness/runtimes/node/livehost-node-executor.ts`, and `tests/harness/runtimes/node/server/hosted-test-server.ts`; pre-existing untracked files were `tests/harness/hosted/circuit-verification-contract.ts`, `tests/harness/hosted/circuit-verification-livehost.ts`, `tests/harness/runtimes/node/circuit-verification-service.ts`, `tests/harness/runtimes/node/circuit-verification-worker.mjs`, and `tests/harness/runtimes/node/server/node-circuit-verification-application.ts`.

All of those changes are treated as concurrent user work and are outside this plan.

The refactor continued concurrently during the audit without changing either inspected commit. At final observation, `hson-live` also showed modified `tests/diagnostics-inventory.acceptance.mts` and `tests/entrypoints/transform-worker.ts`, while `src/diagnostics/index.ts` was no longer modified. `hson-demo2` also showed modified `dist/index.html`, `tests/harness/hosted/test-surface-catalog.ts`, and `tests/runners/harness/run-stage-5a-corpus.node.mts`, plus new `tests/runners/livehost/measure-circuit-worker.node.mts`, `tests/suites/livehost/circuit-livehost-integration-suite.ts`, `tests/suites/livehost/circuit-worker-parity-suite.ts`, and `tests/suites/livehost/circuit-worker-service-suite.ts`. The audit neither read as evidence nor altered those moving files. Its sole filesystem change is this new plan document.

## 1. Executive architecture

The final identity model should be:

```text
LiveTreeRuntime
  QUID-authoritative for active LiveTree identity
  exact-node handles, DOM, CSS, events, animation, resources, lifecycle

Document LiveMap
  revision + canonical document path + staged operation semantics
    = durable structural authority
  sparse QUID/path overlay
    = optional live identity and current-location routing

LiveHost
  persists and replays path-authoritative structural commits
  may carry QUID metadata or witnesses for controlled continuity
  never needs a QUID as the sole durable target

Application
  owns ids, keys, schema fields, HTML id, and domain references
  never receives a replacement infrastructure identity system
```

This is compatible with the important existing boundary: `LiveTreeRuntime` already owns `quidToNode` and `nodeToQuid` and prevents one exact graph from being active in a second runtime ([`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L12), [`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L88)). LiveTree admission preflights a whole graph and collision-checks minting before publishing claims ([`data-quid.ts`](../../src/api/livetree/quid/data-quid.ts#L60), [`data-quid.ts`](../../src/api/livetree/quid/data-quid.ts#L98)). That model is protected, not replaced by paths.

The repair belongs primarily in LiveMap and LiveHost. Today a document target is publicly either a numeric content path or a QUID ([`livemap.types.ts`](../../src/types/livemap.types.ts#L304)); mutation commits preserve whichever target the caller supplied ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L201)); LiveHost then copies that unresolved target into canonical history ([`livehost.history.ts`](../../src/api/livehost/livehost.history.ts#L166)). A QUID-targeted historical operation is therefore uninterpretable when the old QUID is missing or changed. That is the improper durable dependency to remove.

The target does not require a permanent hidden node ID. The existing document operations are deterministic through paths once two rules are made explicit:

1. a commit's first operation is interpreted against `prevRev`; and
2. each later operation is interpreted against the staged result of the preceding operation.

Replay already follows that order by applying every operation to the successively replaced candidate root ([`livemap.document.replay.ts`](../../src/api/livemap/livemap.document.replay.ts#L34)). The missing step is to lower live QUID requests to paths before commit construction and persistence.

The proposed sparse overlay is one per active document LiveMap identity epoch. It contains entries only for quidded nodes and does not own LiveTree's runtime maps. An empty-QUID million-node map has an empty overlay. Graph mutation, path transforms, metadata reconciliation, duplicate checks, and overlay installation must be one transaction.

QUID shortening remains the last unit. Eight checked characters are still provisionally viable, but this plan deliberately makes encoding independent of the correctness work.

### Protected LiveTree effect

| LiveTree behavior | Planned effect |
|---|---|
| Construction and root admission | No semantic change; root identity is still established when a LiveTree handle requires it. |
| DOM projection | No semantic change; ordinary projected elements still receive QUIDs because DOM mapping and ownership need them ([`project-live-tree.ts`](../../src/api/livetree/creation/project-live-tree.ts#L129)). |
| Grafting and same-runtime movement | No semantic change; retained projections and identities remain reusable in the same runtime. |
| Query and retained handles | No semantic change; `LiveTreeNodeRef` continues to hold the exact node, with `q` as routing metadata rather than resolving solely from the string ([`livetree.ts`](../../src/api/livetree/livetree.ts#L77)). |
| Detach and disposal | No semantic change; detach preserves identity, while terminal disposal drains owned resources before destroying it ([`public-lifecycle.ts`](../../src/api/livetree/lifecycle/public-lifecycle.ts#L66), [`dispose-node.ts`](../../src/api/livetree/utils/dispose-node.ts#L29)). |
| Clone | No semantic change; clones strip source QUIDs and mint fresh ones ([`clone.ts`](../../src/api/livetree/methods/clone.ts#L30)). |
| CSS, events, animation, resources | No semantic change; their LiveTree-runtime QUID ownership remains authoritative. |
| LiveMap reflection | Commit routing becomes path-first; same-epoch QUID continuity and LiveTree resource ownership remain available as derived reconciliation evidence. |

## 2. Corrected definitions

### Path

A path is a structural address in a named graph revision, not timeless identity.

There are currently two path domains and they must remain nominally distinct:

- `LivePath` is a projected JSON path of string keys and array indexes; it explicitly is not a raw HSON path ([`livemap.types.ts`](../../src/types/livemap.types.ts#L12)).
- `LiveMapDocumentPath` is a numeric traversal through canonical document `$_content` arrays ([`livemap.types.ts`](../../src/types/livemap.types.ts#L304)). Element mode starts at the one top-level element; fragment mode starts at the `_hson_elem` cluster ([`livemap.document.target.ts`](../../src/api/livemap/livemap.document.target.ts#L81)).

The durable meaning of either path is:

```text
(authority/incarnation, prevRev, operation ordinal, path, operation semantics)
```

For a multi-operation commit, ordinal `0` sees `prevRev`; ordinal `i` sees the staged result after ordinals `0..i-1`. The current replay loop already implements this staging. It must become documented type-level contract, not an inference from implementation.

### QUID

A QUID is an optional opaque live identity token for an eligible HSON node. It is sparse, system-managed, epoch-scoped, and useful when a live subsystem must retain, reconcile, route, style, observe, or own resources for the same node independently of its current path.

A QUID is not:

- application identity;
- authorization, a capability secret, or a security token;
- a timeless path;
- proof that serialized content belongs to the current epoch; or
- the sole durable address of a LiveMap/LiveHost operation.

The core currently calls this type `PersistedQuid` and stores it in `$_meta.quid` ([`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L6)). Renaming the internal term may be useful, but changing the field is not required. “Persisted” should describe a codec behavior, not the lifetime guarantee of the identity.

### QUID/path overlay

The overlay is a sparse, derived live index:

```text
QUID -> current canonical path
canonical path -> QUID
```

It is owned by one active document LiveMap epoch. It reinforces the owned graph but is not a second canonical state graph and is not the LiveTree runtime registry. Every active overlay claim must agree with exactly one QUID annotation in the owned graph.

### Handle

A location handle follows a path. Current `LiveMapPathHandle` objects cache a projected path and resolve that current location; they deliberately do not follow a moved value ([`livemap.types.ts`](../../src/types/livemap.types.ts#L805), [`docs/contracts/livemap-identity.md`](../contracts/livemap-identity.md#L32)).

An identity handle follows an exact node or an internal identity record and may use a QUID to route. It becomes absent or invalid when that live identity is retired. The established LiveTree handle is the model: its reference stores an exact node plus QUID, not only a raw QUID lookup.

### Application identity

Application identity is user-owned data: schema keys, object keys, an HTML `id`, database keys, or explicit fields. This refactor introduces no HSON Live substitute for it.

### Identity epoch and provenance

An identity epoch is the lifetime during which one owner promises that a QUID claim denotes the same live node. A raw serialized QUID is not epoch provenance. Same-epoch transfer needs an out-of-band, non-node provenance token or an internal exact-object handoff. The token is not application identity and must not authorize an operation.

Canonical graph equality is exact and includes QUID metadata. Adding, replacing, or removing a QUID changes the canonical graph and is revision-worthy when the graph is LiveMap-owned. `canonical_hson_graph_equal` and `canonical_hson_graph_difference` remain the strict authorities for ordinary LiveMap no-op and stale-base decisions.

An explicitly named projection such as HSON `noQuid` may remove QUID metadata for a particular serialization purpose. That projection is not a second broadly applicable comparator, is not exact-equal to its QUID-bearing source, and does not redefine ordinary revision semantics.

## 3. Durable QUID dependency inventory

| Current use | Source and symbol | Classification | Survives originating synchronous mutation? | What fails if QUID changes or is removed? |
|---|---|---|---|---|
| Document target union | `LiveMapDocumentTarget` ([`livemap.types.ts`](../../src/types/livemap.types.ts#L307)) | Compatibility surface and live lookup | Potentially | A `{kind:"quid"}` operation cannot resolve. |
| QUID target resolution | `resolve_document_target` rebuilds a graph index and selects the node ([`livemap.document.target.ts`](../../src/api/livemap/livemap.document.target.ts#L42)) | Lookup convenience for current state | No by itself | The synchronous request fails; this is legitimate if not persisted unresolved. |
| Document mutations | `prepare_*` functions clone the root, resolve the target, but place the normalized original target in the operation ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L201), [`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L308)) | **Improper sole durable address** when target is QUID | Yes, in the returned commit | Replay requires the old QUID. |
| Document replay | `replay_livemap_document_commit` sequentially re-applies stored targets ([`livemap.document.replay.ts`](../../src/api/livemap/livemap.document.replay.ts#L34)) | Durable replay | Yes | Any QUID-targeted op conflicts if the QUID is absent/rekeyed. |
| Document `capture`, `install`, `restore` | `DocumentLiveMapCapture` and façade methods ([`livemap.types.ts`](../../src/types/livemap.types.ts#L408), [`livemap.document.ts`](../../src/api/livemap/livemap.document.ts#L181)) | Serialization preservation; same-epoch-capable but category is ambiguous | Yes | Structural install can work without QUIDs, but current exact identity and QUID-target history/continuity change. |
| Per-map identity index | `LiveMapDocumentIdentityIndex = ReadonlyMap<string,HsonNode>` ([`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts#L7)) | Sparse lookup convenience | For map lifetime | Lookup and QUID target resolution fail; graph remains structurally usable. |
| `document.byQuid` | detached lookup from the current index ([`livemap.document.ts`](../../src/api/livemap/livemap.document.ts#L159)) | Intentional live-epoch/compatibility API | Only while caller retains string | Lookup fails or can suffer string-reuse ABA; no structural state is lost. |
| Projected path handles | `LiveMapPathHandle` ([`livemap.types.ts`](../../src/types/livemap.types.ts#L805)) | Path location API | Yes | Nothing; these handles do not use QUIDs and remain positional. |
| Reflection registration | path, path target, optional persisted QUID, and exact projected node ([`document-binding-state.ts`](../../src/api/livetree/lifecycle/document-binding-state.ts#L22)) | Legitimate live-epoch identity plus path correspondence | Yes, for binding lifetime | Same-node continuity checks and QUID-target commit resolution degrade; path delegation already remains available. |
| Reflection structural replacement | reuses an existing projected node only for a compatible same-QUID replacement ([`reflect.document.structure.ts`](../../src/api/reflect/reflect.document.structure.ts#L251)) | Legitimate same-epoch continuity witness | Yes, within binding | Replacement uses a fresh live node and loses its old owned live behavior. |
| LiveHost document actions | public action payload target aliases `LiveMapDocumentTarget` ([`livehost.types.ts`](../../src/types/livehost.types.ts#L394)); action execution forwards it to the map ([`livehost.document-actions.ts`](../../src/api/livehost/livehost.document-actions.ts#L39)) | Live request/compatibility surface | Request may cross transport | Safe if resolved on the authority before commit; unsafe only when copied into history. |
| LiveHost canonical graph commit | `canonical_graph_op` copies path or raw QUID unchanged ([`livehost.history.ts`](../../src/api/livehost/livehost.history.ts#L166)) | **Improper sole durable address** | Yes: history, network, storage | Historical QUID targets cannot replay without matching metadata. |
| Protocol decoder | `decode_document_target` accepts raw QUID targets in canonical ops and actions ([`livehost.protocol.ts`](../../src/api/livehost/livehost.protocol.ts#L182), [`livehost.protocol.ts`](../../src/api/livehost/livehost.protocol.ts#L223)) | Compatibility/protocol surface | Yes | Old and new peers disagree without versioning. |
| Graph-content codec | exact HSON value codec preserves metadata and validates duplicate QUIDs ([`livehost.graph-content-codec.ts`](../../src/api/livehost/livehost.graph-content-codec.ts#L34)) | Serialization preservation / external admission | Yes | Content remains structurally meaningful without QUIDs; continuity/adoption differs. |
| View-state snapshot | exact codec serializes both `$_attrs` and `$_meta` ([`livemap.document.view-state-codec.ts`](../../src/api/livemap/livemap.document.view-state-codec.ts#L282)) | Same-epoch-capable and durable structural capture; currently ambiguous | Yes | Structural root/revision survive stripping; exact live metadata does not. |
| Recovery history | retained canonical commits are returned for replay ([`livehost.recovery.ts`](../../src/api/livehost/livehost.recovery.ts#L330)) | Durable replay | Yes | Any retained QUID-only target requires old QUIDs. |
| Recovery snapshot/mirror | document snapshots are decoded and `map.restore` is called ([`livehost.client.ts`](../../src/api/livehost/livehost.client.ts#L483)) | Durable structural recovery plus optional continuity | Yes | Snapshot installation is structural; current later QUID history and lookup assume preservation. |
| Bootstrap | HSON snapshot is parsed, made into a map, and restored ([`livehost.bootstrap.ts`](../../src/api/livehost/livehost.bootstrap.ts#L223), [`livehost.bootstrap.ts`](../../src/api/livehost/livehost.bootstrap.ts#L491)) | Durable structural bootstrap plus serialization preservation | Yes | Structure is installable without QUID; exact continuity and old QUID commits are not. |
| Persistence checkpoint/tail | view-state checkpoint plus canonical commits are decoded and replayed on load ([`livehost.persistence.ts`](../../src/api/livehost/livehost.persistence.ts#L280)) | **Improper durable dependency** for QUID-targeted tail | Across process restart | A QUID-targeted tail cannot be reconstructed from a stripped/rekeyed checkpoint. |
| LiveTree handle/router/resource uses | runtime maps and exact-node `LiveTreeNodeRef` ([`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts#L12), [`livetree.ts`](../../src/api/livetree/livetree.ts#L77)) | Legitimate live-epoch identity | Yes, for runtime/node lifetime | Active handle, DOM, CSS/event/resource ownership semantics are lost; this is allowed only on explicit identity loss/disposal. |
| Demo raw-QUID use | pointer de-duplicates with `.quid` ([`point.ts`](../../../hson-demo2/src/app/demos/pointer/point.ts#L124)); hosted test UI reads `hson:quid` then calls `find.byQuid` ([`hosted-test-case-list.ts`](../../../hson-demo2/src/app/demos/tests/panel/hosted-test-case-list.ts#L315)) | Compatibility surface | Local asynchronous UI work | Observable on API narrowing/encoding change, though not durable application state. |

The durable records that cannot currently be interpreted after QUID removal are precisely graph commits whose target is `{kind:"quid"}` and any LiveHost history/persistence record containing them. A QUID-bearing snapshot or inserted graph is still structurally interpretable after identity stripping; it loses live continuity, not structure. This distinction must be preserved in tests and documentation.

## 4. Document operation and path matrix

> Historical audit snapshot: this matrix records the pre-refactor state used to
> derive Units 1–5 and 11. The completed-unit sections below are authoritative
> for current projected move, rename, and sparse identity behavior.

### Current staging contract

Document paths are canonical numeric `$_content` paths, not `LivePath`. Local public document mutations currently emit only one operation, but replay accepts a multi-operation commit. During replay, later targets resolve against the staged graph produced by earlier operations ([`livemap.document.replay.ts`](../../src/api/livemap/livemap.document.replay.ts#L44)). `replace-root` must be the sole operation.

Data-mode batches have the same sequential principle: `plan_write_ops` updates one candidate after each operation ([`livemap.core.ts`](../../src/api/livemap/livemap.core.ts#L1262)), and replay validates `prev` and `next` at each staged step ([`livemap.core.ts`](../../src/api/livemap/livemap.core.ts#L892)).

### Authority matrix

| Operation | Current authoritative target | Revision/stage | Current QUID role | Path-only equivalent | Ambiguity or repair |
|---|---|---|---|---|---|
| projected `set` | `LivePath` | `prevRev`, sequential staged candidate | None | Already path-only, with `prev`/`next` witnesses | Future object/array QUID identity effect is undefined. |
| projected `replace` | `LivePath` | Same | None | Already path-only | Explicit replacement; must retire endpoint identity unless same-node semantics are separately declared. |
| projected `delete` | `LivePath` | Same | None | Already path-only | Retire deleted subtree; shift array locations where applicable. |
| projected `splice` / append / insert / remove | array endpoint `LivePath` plus `start` and values | Same; `start` is evaluated in the staged array | None | Already path-only | Define path shifts and identity adoption/retirement. |
| projected array `move` | Whole-array `set` today ([`livemap.handle-array.ts`](../../src/api/livemap/livemap.handle-array.ts#L136)) | Same | None | Needs a semantic `move` op or internal intent | Current commit loses the fact that one live item moved. |
| projected object `rename` | Whole-object `replace` today ([`livemap.handle-object.ts`](../../src/api/livemap/livemap.handle-object.ts#L100)) | Same | None | Needs a semantic `rename` op or internal intent | Current commit loses the fact that one subtree moved from one key to another. |
| set attribute | document target union | Target resolves at its operation's staged graph | Can be sole target | Parent element path | Lower QUID request to path before commit. Attr changes do not transform paths. |
| delete attribute | document target union | Same | Can be sole target | Parent element path | Same repair. |
| replace attribute bag | document target union | Same | Can be sole target | Parent element path | Same repair. |
| insert content | parent document target plus raw slot index | Index applies to the staged parent's current `$_content` | Can be sole parent target; inserted graph may contain QUIDs | Parent path plus index | Define admission provenance and shift paths at/after index. |
| replace content | parent target plus existing slot index | Index applies to staged parent | Can be sole target; matching QUID currently aids reflection continuity | Parent path plus index | Replacement is new identity unless explicit same-epoch same-node intent is present; structural equality is insufficient. |
| delete content | parent target plus existing slot index | Same | Can be sole parent target | Parent path plus index | Retire subtree QUIDs and shift following siblings. |
| move content | parent target, `from`, `to` | Both checked against pre-move staged length; implementation removes `from` then inserts at `to` ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L428)) | Can be sole parent target; descendants retain metadata | Parent path, `from`, `to` | Document the current final-position semantics and rewrite the moved subtree plus affected siblings. |
| whole-root install | capture plus optional `expectedRev` | Current map revision | Preserves all supplied QUIDs | Path-free `replace-root` payload | Admission category decides adopt/strip/rekey; no old QUID is needed for structure. |
| exact restore/snapshot install | capture revision replaces current revision | Capture's named revision | Preserves all supplied QUIDs | Root plus revision | Must declare same-epoch versus durable/external category. |
| replay batch | commit `prevRev` and ordered ops | Later ops see earlier staged results | QUID targets resolve anew at each stage | All canonical targets become paths | This is deterministic after target lowering. |

No current document path utility module centralizes numeric-path normalization, keys, prefix tests, or transforms. `livemap.path.ts` centralizes only projected `LivePath` helpers ([`livemap.path.ts`](../../src/api/livemap/livemap.path.ts#L5)). Unit 1 should add a document-path module with nominal types and pure, exhaustive transforms rather than reuse mixed string/number projected helpers accidentally.

### Canonical target shape

Keep the public request union for compatibility, but split it from history:

```ts
type LiveMapDocumentRequestTarget =
  | { kind: "path"; path: LiveMapDocumentPath }
  | { kind: "quid"; quid: string };

type LiveMapDocumentCommitTarget = {
  kind: "path";
  path: LiveMapDocumentPath;
  witness?: { quid: string };
};
```

The commit envelope supplies `prevRev`; operation ordinal supplies staging. A witness never routes. During replay:

- if its QUID is active in the current overlay, it must resolve to the operation path;
- if the active node at the path has a different QUID, report a structured stale-identity conflict;
- if the witness QUID is absent because the replay is identity-free or in a different epoch, continue using the path and record only diagnostic evidence.

Thus QUID can detect stale intent without becoming required structural state.

## 5. Identity-effect matrix

The following is the desired final semantic matrix. “Supplied” means QUID metadata in new content. It is adopted only with explicit same-epoch provenance; ordinary/external content is stripped, rekeyed if a live API explicitly requests new identity, or left unquidded.

| Operation | Existing endpoint/subtree identity | Descendant path effect | Incoming QUID policy | Same-node versus replacement rule |
|---|---|---|---|---|
| projected `set` of a new property | No prior endpoint | Other object paths unchanged | Default unquidded; same-epoch adoption only | Creates a new value. |
| projected `set` of an existing primitive | No eligible identity | None | N/A | Value mutation/replacement distinction is irrelevant for primitives. |
| projected `set` of existing object/array | **Deferred decision before eligibility** | Paths below endpoint may retire/rebuild | Default unquidded; same-epoch only | Do not infer preservation from equal shape; operation must declare update versus replace. |
| projected exact `replace` | Retire endpoint and descendants | New subtree occupies same path | Same-epoch adoption or default unquidded | Always replacement unless a future explicit identity-preserving operation says otherwise. |
| projected `delete` | Retire endpoint and descendants | Object siblings unchanged; array siblings shift down | N/A | Deletion invalidates identity handles. |
| array append/insert | Preserve existing nodes | Paths at/after insertion shift up | Default inserted subtree unquidded; adopt proven same-epoch values | New nodes. |
| array splice | Preserve retained prefix/suffix; retire removed range | Shift retained suffix by inserted-minus-removed count | Same policy for inserted items | Replacing equal items is still replacement. |
| array move | Preserve moved subtree and all descendant QUIDs | Rewrite moved prefix; shift the intervening range | No incoming value | Same live node moves. Requires semantic move intent. |
| object rename | Preserve renamed subtree and descendants | Rewrite old-key prefix to new-key prefix | No incoming value | Same live node moves. Requires semantic rename intent. |
| set/delete/replace attributes | Preserve target element QUID | No path change | Metadata QUID is protected from ordinary attr mutation ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L580)) | Same live node. |
| insert content | Preserve parent and existing children | Shift siblings at/after index; add inserted relative paths | Adopt only proven same epoch; otherwise strip, rekey on explicit live need, or leave unquidded | Inserted content is new to this ownership domain. |
| replace content | Retire removed subtree by default | Existing descendants retire; new relative paths added | Same-epoch adoption only | Preserve the old root only for an explicit compatible same-node replacement; equal structure is insufficient. |
| delete content | Retire removed subtree | Shift following siblings down | N/A | Deleted handles invalidate; QUID becomes retired for this epoch policy. |
| move content | Preserve moved subtree and descendants | Reparent/reindex moved prefix and shift intervening siblings | N/A | Same live node moves. |
| whole-root install | Retire prior overlay unless explicitly same-epoch convergence | Rebuild all active paths | Category policy: adopt, strip, or rekey | Ordinary install is replacement; same-epoch capture may reconcile. |
| snapshot restore | Same as root install, but exact revision is installed | Rebuild | Same-epoch token may preserve; durable/external restore cannot assume it | Structural restore works without old identities. |
| QUID ensure/request | Add canonical identity metadata to one eligible existing node | No structural path change | Mint through owning live namespace and reject collision | Canonical registration transition; advances the ordinary revision and commit stream. |
| terminal identity retirement | Remove overlay claim and active metadata | No structural path change unless paired with deletion | Never reuse during that epoch if final allocator policy requires it | Invalidates identity handles and ownership. |

Identity preservation must follow operation intent and exact live ownership, not canonical equality. Current reflection already embodies the correct conservative rule for content replacement: it reuses an exact projected node only when both sides have the same QUID and compatible ordinary-element tag ([`reflect.document.structure.ts`](../../src/api/reflect/reflect.document.structure.ts#L251)).

## 6. Sparse overlay design

### Smallest coherent ownership

One active document LiveMap instance owns one `SparseDocumentIdentityOverlay`. Independent maps may contain the same QUID because they are separate epochs. When a map is reflected, its overlay is evidence for correspondence, while the target `LiveTreeRuntime` separately validates/adopts/mints its own active claims. The overlay never writes `LiveTreeRuntime.quidToNode` directly.

Conceptual interface:

```ts
type SparseDocumentIdentityOverlay = Readonly<{
  byQuid: ReadonlyMap<string, OverlayEntry>;
  quidAt(path: LiveMapDocumentPath): string | undefined;
  pathFor(quid: string): LiveMapDocumentPath | undefined;
  epoch: LiveIdentityEpoch;
}>;
```

Recommended representation:

- `quidToPath` is required conceptually for QUID request resolution.
- `pathToQuid` is required conceptually for exact agreement checks, witnesses, and identity effects.
- `quidToNode` is unnecessary in LiveMap. Resolve the current node by path from the owned root; a node pointer becomes stale whenever the immutable candidate root is replaced.
- `nodeToQuid` is unnecessary in LiveMap. Read the node's canonical live metadata at the path. LiveTree keeps its own weak reverse map because it owns exact live node objects.

Hide representation behind the interface. A first correct implementation may use `Map<quid,frozenPath>` plus `Map<encodedPath,quid>`, with `JSON.stringify` path keys. A scale-oriented implementation should use a sparse path trie whose terminal entries are referenced by `byQuid`. The trie stores only prefixes that lead to a quidded node; moving a subtree can reparent a branch instead of rewriting every descendant path. Array index shifts relabel affected sparse child branches, not unquidded graph nodes.

### Invariants

At every publication boundary:

1. every eligible owned graph node with an active `$_meta.quid` has exactly one overlay entry;
2. every overlay entry resolves to one graph node carrying that same QUID;
3. no two paths claim one QUID and no path claims two QUIDs;
4. an identity-free graph has an empty overlay;
5. construction, traversal, and ordinary mutation never mint;
6. malformed or duplicate claims reject before state publication;
7. a detached decoded graph can carry QUID bytes, but those bytes are not active claims until an admission policy accepts them.

### Evolution from the current index

The current index is sparse in storage but not sufficient: it maps QUID to cloned node object, stores no path, and is rebuilt by a full graph scan ([`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts#L24)). Worse, each QUID target resolution scans and rebuilds again instead of using the controller's existing map ([`livemap.document.target.ts`](../../src/api/livemap/livemap.document.target.ts#L48)).

Replace the index behind the existing controller ownership rather than grow a second side table. The scanner can evolve to collect `(quid,path)` during canonical validation. Storage stays `O(Q)` where `Q` is the number of quidded nodes; initial validation may remain `O(N)` because the graph itself must be validated, but no per-node identity object may be retained for the `N-Q` unquidded nodes.

### QUID metadata changes

Explicit QUID ensure, replacement, or retirement changes canonical graph metadata. For a LiveMap-owned graph, that transition advances the ordinary revision, publishes through the ordinary commit stream, may enter history and persistence, and updates any sparse lookup representation atomically with the graph. There is no separate `identityGeneration`, silent overlay mutation, or preferred identity-only delta outside the normal commit stream.

A future path-authoritative registration operation may express that canonical change, but its public shape belongs to a later unit. Unit 0 freezes only the revision semantics: two owned canonical graphs that differ by QUID metadata cannot share a revision as if they were exact-equal.

## 7. Reconciliation ownership

### One owner

Create one document transition planner/reducer, conceptually:

```ts
plan_document_transition(
  root,
  overlay,
  prevRev,
  requestOrCanonicalOps,
  admissionContext,
): {
  root,
  overlay,
  canonicalCommit,
  identityEffects,
}
```

Production ownership should be a new focused module under `src/api/livemap/`, called by `livemap.document.mutation.ts`, `livemap.document.replay.ts`, document install/restore, and the staged authority in `livemap.core.ts`. LiveHost and reflection must consume its result, never maintain a competing overlay reducer.

The operation reducer owns graph semantics. The overlay reducer is a pure consequence function over `(before graph, before overlay, path operation, after graph, admission context)`. It cannot accept independent user commands. That prevents derived identity effects from becoming a second command language that can disagree with the canonical operation.

### Transaction order

1. Capture `prevRev`, current root, and overlay.
2. Normalize a request target. If it is a QUID, resolve it through the active overlay to a path now and attach an optional witness.
3. Clone/copy-on-write the graph candidate and overlay candidate.
4. For each operation in order, resolve its path in the current staged graph, apply structural semantics, and derive its overlay transform.
5. Validate local input, canonical graph invariants, mode, duplicate claims, overlay/metadata agreement, and optional witnesses.
6. Compute strict canonical equality, including QUID metadata. Only an exact-equal request is unchanged.
7. Construct the path-authoritative canonical commit and its derived overlay/reflection effects.
8. Use the existing transition controller's stale-base check and install root, overlay, and revision in one synchronous swap. The current controller already validates its internal transition generation and installs before notification ([`livemap.authority.ts`](../../src/api/livemap/livemap.authority.ts#L102), [`livemap.authority.ts`](../../src/api/livemap/livemap.authority.ts#L141)); that concurrency guard is not a second public identity clock.
9. Publish the ordinary canonical commit, then notify reflection of its derived identity effects. Observer exceptions do not roll back already-installed state; they are reported as post-commit observer failures, matching current LiveHost recovery handling ([`livehost.client.ts`](../../src/api/livehost/livehost.client.ts#L458)).

Validation or planning failure publishes nothing. Install failure discards the transition. Notification failure never attempts rollback because consumers may already have observed the committed state.

### Replay and no-op behavior

Authoritative mutation and replay must share the same path operation reducer. Current document replay calls mutation preparers, which is a useful starting seam, but both paths repeatedly clone/reindex ([`livemap.document.replay.ts`](../../src/api/livemap/livemap.document.replay.ts#L44), [`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L468)). The refactor should plan one candidate transaction and validate once.

An exact canonical no-op has no revision, history, persistence append, or feed. A QUID-only canonical change is not such a no-op: it uses the ordinary revision and commit path. Any sparse routing update is derived from that accepted commit and cannot be published as an independent mutation command.

### Reflection timing

Reflection receives a commit after canonical map installation, validates the commit-keyed derived identity evidence, plans a path-routed shadow result, applies graph/DOM changes, disposes removed LiveTree nodes, and then publishes correspondence. Ordinary local operations transform existing registrations and walk only introduced final subtrees; initialization, snapshots, and compatible root convergence may rebuild the complete correspondence domain. Observer failure never rolls back the already-installed LiveMap state. Reflection does not modify the LiveMap overlay and LiveTree identity remains runtime/QUID-authoritative.

## 8. QUID-targeted API migration

| Surface | Decision | Migration |
|---|---|---|
| `LiveTree.quid` | Remain live-epoch API | Keep semantics; document opacity/epoch. Encoding change remains observable. |
| `LiveTree.find.byQuid` | Remain live-epoch API | Keep subtree and runtime checks ([`find.ts`](../../src/api/livetree/methods/find.ts#L356)); discourage persisted inputs. |
| `NodeRef.q` | Compatibility/semi-public live metadata | Do not turn the reference into raw-string resolution; consider deprecating direct `q` only after handle alternatives exist. |
| `CssManager` QUID methods and selectors | Remain internal/semi-public LiveTree ownership surface | Preserve now; later narrow direct raw methods only with wrappers for existing CSS APIs. |
| `document.byQuid` | Remain lookup convenience for the active map epoch | Resolve overlay QUID to path, then clone the current node. Document absence after restore/restart/rekey. |
| LiveMap `{kind:"quid"}` read targets | Remain live request API | Resolve at current map revision; never serialize as unresolved canonical target. |
| LiveMap `{kind:"quid"}` mutation targets | Remain compatibility/live request API | Lower to `LiveMapDocumentCommitTarget` before commit creation. |
| LiveHost document action QUID targets | Remain request compatibility surface | Decoder accepts them; authority resolves them inside its staged mutation base revision. Returned/persisted commit contains a path. |
| LiveHost canonical commit QUID targets | Version and remove from new format | Decode only as legacy v1 for migration/replay with a base graph. New v2 canonical graph ops are path-only with optional witness. |
| Reflection `byQuid` correspondence | Remain derived live-epoch index | No longer needed to route canonical commits; retain for continuity validation and diagnostics. |
| Diagnostics/direct metadata | Mark diagnostic/unsafe | Do not use as application reference. Keep enough access for invariant verification. |

The intended lowering is:

```text
incoming QUID request
  + active map revision R
  + active overlay
  -> current document path P
  -> canonical operation (prevRev R, target P, optional QUID witness)
  -> history / replay / persistence
```

Resolution must happen inside the same staged-authority transaction that accepts the mutation. Resolving before an asynchronous queue wait would create a stale path. The LiveHost mutation draft is explicitly ephemeral and host-owned ([`livehost.types.ts`](../../src/types/livehost.types.ts#L862)); use that boundary.

Raw QUID APIs are observable in `hson-demo2`: the pointer demo and hosted test panel use them for live UI behavior, and the browser selector test asserts the current 16-character form ([`quid-selector.spec.ts`](../../../hson-demo2/tests/integration/browser/quid-selector.spec.ts#L46)). Do not remove them as part of path authority. Narrowing them is optional later compatibility work.

## 9. Capture and serialization categories

| Existing path/format | Current behavior | Target category | Required rule |
|---|---|---|---|
| `DocumentLiveMap.capture()` v2 | Exact root/revision including QUID metadata | **Ambiguous today**; split into same-epoch and durable structural intent | Preserve existing exact capture for compatibility, add explicit category/provenance rather than infer from bytes. |
| `install` / `restore` | Preserves and indexes all QUIDs | Admission boundary | Same-epoch proof may adopt; external/durable input strips, rekeys on explicit need, or stays unquidded before ownership. |
| view-state v2 | Deterministic exact attrs/meta graph ([`livemap.document.view-state-codec.ts`](../../src/api/livemap/livemap.document.view-state-codec.ts#L90)) | Durable structural capture that may carry identity metadata; also same-epoch-capable only with external proof | Structural decode/replay cannot depend on QUID; raw payload alone is not proof. Likely new format version for explicit category. |
| authored HSON / `HsonString` | Preserves `@quid` by default | General serialization / external graph admission | QUID bytes are untrusted identity metadata on re-admission. |
| HSON `noQuid` | Omits QUID without mutating the source | **Identity-free projection** | Explicitly loses retained continuity, handles, reflection association, and QUID-owned behavior. It is not behaviorally equivalent. |
| HSON compact / no-break | Layout-only; preserves QUID unless `noQuid` | Same category as surrounding serialization | Never imply identity semantics from formatting. |
| structural HTML | Preserves `hson:quid` | External graph admission or diagnostic | Validate syntax; do not adopt into current epoch from bytes alone. |
| ordinary managed DOM / `outerHTML` | Projection exposes `hson:quid` | Live diagnostic/compatibility representation | DOM belonging to the exact runtime may have provenance; copied markup does not. |
| structural graph JSON | Preserves `$_meta.quid` | External graph admission/diagnostic | Same rule as HSON. |
| ordinary application JSON | Generally omits element metadata | Identity-free application projection | No live continuity promise. |
| graph-content codec v2 | Exact node/primitive including QUID metadata | External graph admission over LiveHost | Decode detached; action admission chooses adopt/strip/rekey using provenance. Current raw content must not silently join an epoch. |
| LiveHost HSON snapshot | Preserves QUIDs ([`livehost.document-snapshot.ts`](../../src/api/livehost/livehost.document-snapshot.ts#L118)) | Durable structural recovery; optionally same-epoch with explicit negotiated provenance | Snapshot installs structure without requiring QUID continuity. |
| LiveHost view-state snapshot | Preserves exact QUID metadata | Durable structural recovery/checkpoint | Same; persistence restart begins a new live epoch unless explicitly proven otherwise. |
| LiveHost bootstrap v1 | HSON state plus logical map/incarnation/revision ([`livehost.bootstrap.ts`](../../src/api/livehost/livehost.bootstrap.ts#L448)) | Durable structural bootstrap | Logical map/incarnation is history provenance, not by itself node-QUID epoch proof. |
| LiveHost canonical history | May retain raw QUID targets today | Durable structural operation stream | New history path-only; optional witnesses never route. |
| debug output/diagnostics | May preserve or print QUID | Diagnostic | Clearly label epoch and non-application meaning. |
| strict canonical equality | Includes QUID today | Canonical graph contract | Remains QUID-sensitive and governs ordinary LiveMap no-op and revision decisions. |

Same-epoch provenance must not be encoded only as the QUID itself. A local capture can carry an internal, nonserializable epoch object. A remote controlled mirror may use a negotiated ephemeral authority epoch in its transport envelope, but that token must reset on authority runtime restart and must not serve authorization. If no proof is present, detached serialized QUIDs are hints to strip/rekey or leave inactive before admission.

## 10. LiveHost migration implications

### Unit 5 audit result

`LiveHostCanonicalCommit` still has no document-commit format version, but `LiveHostEncodedGraphOp` now embeds only path-authoritative `LiveMapDocumentCommitTarget` values. Strict current decoding rejects raw QUID targets. Recovery, clients, and new persistence appends therefore consume or produce only paths plus optional witnesses.

Retained pre-Unit-5 QUID-targeted history remains compatibility input. Internal client and persistence readers admit that old shape only where an exact base graph is available, translate its contiguous operations in ordinal-staged order, and immediately expose the normalized path commit. This closes current correctness without adding a canonical v2 field or rewriting persistence. Durable migration tooling remains relevant only if deployments need old records rewritten rather than bounded read compatibility.

### Conditional future canonical format

Unit 5 proved that the existing envelope can enforce numeric document paths with optional non-routing witnesses without a version field. A future `canonicalFormatVersion: 2` is therefore conditional on negotiation, provenance, or storage requirements introduced by later units; it is not required merely to eliminate newly produced QUID-only targets. Graph content remains exact structural content; its codec version need change only if admission/category bytes change.

At action execution:

1. decode request target as today;
2. enter the authority's staged mutation transaction;
3. resolve QUID to path at that draft's base revision/overlay if needed;
4. apply the path operation;
5. publish/store only the path canonical operation.

Snapshots are structurally sufficient for install. They may retain QUID metadata for same-epoch continuity or diagnostics, but a post-snapshot tail must replay through paths even when the snapshot has been identity-stripped.

### Legacy-history translation

An isolated QUID-targeted commit cannot be translated without its exact base graph. Migration must process a checkpoint and its contiguous tail together:

1. decode the legacy checkpoint while its QUID metadata is still available;
2. construct a detached migration map at the checkpoint revision;
3. for each legacy commit in order, resolve each QUID target against that operation's staged graph, emit a v2 path target plus optional witness, and apply the legacy operation to advance the migration graph;
4. verify final graph, revision, mode, logical map, and incarnation;
5. atomically replace the checkpoint/history records with versioned v2 data, or write a new generation and switch a pointer;
6. retain a rollback copy until the new runtime has completed verification.

If a target is absent, duplicated, malformed, or the tail has a gap, stop. Require a fresh authoritative checkpoint while an old runtime can still interpret the data. Do not guess a path or discard the tail.

### Protocol and deployment compatibility

- New servers should accept v1 actions but emit v2 canonical commits.
- During a bounded compatibility window, servers may decode v1 canonical history only in a migration context with the base graph.
- Clients must negotiate commit-format versions before recovery. A v1-only client cannot safely consume v2 witness semantics; a v2-only client cannot infer the staging of an unknown legacy record.
- Persistence types need explicit checkpoint/history format versions. Current exact-key validation means an additive field is already a wire/storage change.
- `logicalMapId` and `incarnationId` remain host-history identifiers. Persistence intentionally preserves incarnation across restart ([`docs/livehost/overview.md`](../livehost/overview.md#L180)); that must not silently imply the same active QUID epoch after restart.
- `hson-demo2` LiveHost harnesses should add compatibility fixtures and migration cases, but its application/session/authorization transport should not be redesigned.

## 11. QUID eligibility and minting implications

> Historical expansion gate, now satisfied by Unit 11. Current eligibility is
> ordinary document elements plus semantic projected `_hson_obj` and
> `_hson_arr` containers; LiveTree remains ordinary-element-only.

### Current hard-coded element eligibility

- Core QUID eligibility is `is_ordinary_element_node` ([`hson-node-quid.ts`](../../src/core/hson-node-quid.ts#L83)).
- The metadata registry permits QUID only on `ordinary-element` ([`hson-metadata.ts`](../../src/core/hson-metadata.ts#L31)).
- LiveMap's index and errors are explicitly document-element-oriented ([`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts#L24)).
- QUID document targets resolve any indexed element, while ordinary attrs further require an ordinary element ([`livemap.document.target.ts`](../../src/api/livemap/livemap.document.target.ts#L71)).
- Reflection registers only ordinary elements and expects DOM `hson:quid` agreement ([`reflect.document.ts`](../../src/api/reflect/reflect.document.ts#L289), [`reflect.document.ts`](../../src/api/reflect/reflect.document.ts#L650)).
- DOM/CSS consumers assume a QUID-bearing node can own a real element selector. Non-DOM structural nodes must not enter those code paths.

The exact view-state codec already serializes arbitrary node metadata bags, but canonical validation rejects QUIDs on structural VSNs. Serialization capability is therefore not proof of eligibility.

### Expansion gate satisfied by Unit 11

Object and array nodes may become independently identity-bearing only after:

1. projected `move`, `rename`, `set`, `replace`, and splice identity semantics are explicit;
2. the metadata registry can represent object/array eligibility without making wrappers or primitives eligible accidentally;
3. parsers/serializers have canonical syntax/transport rules for such metadata;
4. the LiveMap overlay addresses those nodes without DOM assumptions;
5. LiveTree projection, selectors, CSS, and resource APIs guard ordinary-element-only behavior;
6. explicit retained-handle APIs are defined as the mint trigger; and
7. construction, parsing, traversal, capture, and ordinary mutation remain non-minting.

Primitive carriers should remain ineligible: they are values, not independently owned `HsonNode` objects, and cannot carry exact-node live resources. Wrapper eligibility should be a separate proof, not a side effect of object/array work.

### Minting discipline

LiveMap mints only through explicit owner-authorized acquisition. The resolved public APIs are `document.ensureIdentity(...)` and projected `map.ensureIdentity(path)`; ordinary admission, reads, traversal, move, rename, and mutation remain non-minting. They must:

- run through the active map overlay owner;
- use collision-aware generation and no-reuse policy for that epoch;
- update annotation plus overlay atomically;
- return a handle/capability, not encourage raw string persistence; and
- not claim or mutate LiveTree runtime identity unless reflection explicitly coordinates adoption.

Do not change LiveTree projection allocation merely to make LiveMap sparse. Projection currently genuinely requires element identity for DOM and owned resources. Unit 10 adds regression fences around LiveTree rather than a “laziness” rewrite.

## 12. Large-map complexity analysis

Let `N` be total graph nodes, `Q` quidded nodes, `D` average path depth, and `A` the number of overlay entries whose paths are affected by an operation.

| Case | Expected graph cost | Expected overlay cost | Required proof |
|---|---|---|---|
| 1,000,000 nodes, zero QUIDs | Initial canonical parse/validation `O(N)`; overlay empty | `O(1)` storage after construction | No identity objects, strings, map slots, or prefix entries for unquidded nodes; no minting. |
| 1,000,000 nodes, 100 QUIDs | Graph `O(N)` | `O(Q)` entries, or `O(Q*D)` sparse trie nodes with shared prefixes | Lookup/path update depends on `Q`, not `N`. |
| 1,000,000 nodes, 100,000 QUIDs | Graph `O(N)` | `O(Q)`/`O(Q*D)` | Measure map/trie/string overhead and GC, not just payload bytes. |
| Ordinary QUID-free mutation | Path resolution and graph update should scale with depth/changed subtree | No overlay allocation; `O(1)` or sparse-prefix traversal | Zero calls to mint and zero persistent identity allocations. |
| Path replay without QUIDs | Sequential operation cost | Empty overlay remains empty | Full recovery succeeds from identity-free checkpoint and path history. |
| Move/rename/splice | Changed path-spine/subtree work | `O(A)` for dual maps; trie can reparent prefixes and relabel sparse siblings | Must not scan all `N` nodes. |
| Same-epoch sparse capture | Serialization necessarily visits `N` | Exact identity material `O(Q)` | QUIDs round-trip only with epoch provenance. |
| Identity-free serialization | Serialization visits `N` | Omits all `Q` identity bytes | Explicit continuity-loss assertions. |

### Existing whole-graph costs

The current document mutation implementation deep-clones the entire root before every operation ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L201)), then scans the complete candidate to rebuild identity ([`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts#L468)). The transition controller also clones the current root for its stale-base comparison ([`livemap.core.ts`](../../src/api/livemap/livemap.core.ts#L1195)). Thus a million-node one-attribute mutation is already `O(N)` independent of overlay design.

The sparse overlay must not add another full scan per target or operation. After correctness units land, replace whole-root transaction cloning with path-spine copy-on-write, a persistent owned graph, or a preflighted reversible journal. That is a separate graph-performance unit and must preserve current atomic rollback. Do not use structural sharing unless graph ownership prevents later unsafe mutation through `debug.node` and detached aliases.

### Prefix indexing

A dual-map implementation updates materialized absolute paths in `O(A*D)`. A sparse trie can:

- enumerate and retire QUIDs under a deleted/replaced prefix;
- detach/reparent a moved or renamed prefix without touching every descendant entry;
- shift only sparse sibling branches after splice/content insertion; and
- resolve exact `path -> QUID` by depth.

Start behind an abstraction so correctness can land with dual maps. Require a benchmark threshold before committing to trie complexity.

### Measurements before encoding choice

Measure on supported Node and browser engines:

- heap delta for graph alone, empty overlay, 100-entry overlay, and 100,000-entry overlay;
- bytes per QUID entry for 8, 10, and 16 characters, including map/trie overhead;
- construction and capture latency;
- path lookup, QUID lookup, insert, delete, move, rename, and large splice latency;
- GC pause and retained memory after retirement/disposal;
- issued-ever/no-reuse registry growth at 1,000,000 and 10,000,000 cumulative identities; and
- worker/mirror allocator reset behavior.

The string-width saving may be small relative to JavaScript map overhead. Eight versus ten characters should be selected only after those measurements and the namespace/no-reuse policy are final.

## 13. Ordered implementation units

There are fourteen units, numbered 0 through 13. Each is one coherent architectural change; later optional units may be deferred without weakening path authority.

### Unit 0 — Executable identity and revision contract

- **Goal:** Freeze the definitions in section 2, certify strict QUID-sensitive canonical equality, ordinary revision semantics for QUID metadata changes, QUID-free LiveMap behavior, controlled persistence, `noQuid` continuity loss, and protected LiveTree identity before changing operation records.
- **Production ownership:** Narrow types/comments/contracts plus authoritative acceptance suites; no path-target or protocol behavioral switch.
- **Public/API effect:** Documentation/type terminology only; no removal.
- **Compatibility effect:** None yet, but exposes contradictions in current QUID-bearing no-op behavior.
- **Tests:** QUID-free construction/mutation/replay; otherwise equal graphs with different QUID metadata; QUID addition/replacement/removal through ordinary revision paths; exact capture/restore/replay; controlled persistence and `noQuid`; protected LiveTree regression suite.
- **Stop conditions:** Strict equality cannot remain QUID-sensitive, ordinary behavior unexpectedly mints, or QUID metadata cannot participate in the ordinary canonical revision stream.
- **Dependency:** None.
- **Suggested commit direction:** `test(livemap): define path authority and live identity epochs`.

### Unit 1 — Path-authoritative document operation model

- **Status:** Complete. Canonical paths, pure transforms, ordinal staging, request/commit target separation, witness conflicts, and bounded legacy QUID lowering are executable contracts.
- **Goal:** Add nominal document path utilities, request-target versus commit-target types, sequential staging prose/tests, structured conflicts, and optional non-routing witness semantics.
- **Production ownership:** `livemap.types.ts`, a new document-path module, mutation/replay normalizers.
- **Public/API effect:** Additive request/commit types; existing request union remains.
- **Compatibility effect:** New LiveMap commits and new LiveHost history entries are path-authoritative. Pre-Unit-1 QUID-target replay and old LiveHost wire decoding remain isolated compatibility inputs and normalize during replay; LiveHost protocol versioning remains Unit 8.
- **Tests:** Every graph op through paths; multi-op staged path shifts; move final-position semantics; witness present/absent/mismatch.
- **Stop conditions:** Any document operation lacks deterministic revision/path semantics.
- **Dependency:** Unit 0.
- **Suggested commit direction:** `refactor(livemap): make document commits path-authoritative`.

### Unit 2 — Preserve projected move and rename intent

- **Status:** Implemented and executable.
- **Goal:** Add explicit semantic move/rename operations or equivalent internal intent before object/array QUID eligibility.
- **Production ownership:** projected operation types, handle array/object helpers, planning/replay/transport.
- **Public/API effect:** Existing helper behavior retained; commit operation family may grow.
- **Compatibility effect:** Structural JSON and LiveHost projected commit format may require an additive version.
- **Tests:** move versus delete+insert; rename versus replace; staged batches; exact replay.
- **Stop conditions:** Same-node movement can only be inferred from equal values or a permanent node ID.
- **Dependency:** Unit 0; can proceed parallel to document-only Units 1–6 but must precede Unit 11.
- **Suggested commit direction:** `feat(livemap): retain move and rename operation intent`.
- **Implemented boundary:** Projected helpers now emit carrier-native `rename` and `move` operations with exact ordered before/after witnesses. Rename rejects a missing source, retains its position, and replaces an existing destination. Move accepts only nonnegative safe staged-array indexes and interprets `to` as the final post-removal index.
- **Propagation result:** Exact structural-json replay, bounded legacy replay, feeds, links, stores, LiveHost canonical history, sync, recovery, and client replay retain the semantic kind. Existing transport and LiveHost versions remain sufficient and unchanged.
- **Identity result:** The operation fields provide the future sparse projected overlay with explicit prefix movement and sibling-shift evidence. Object/array QUID eligibility, projected overlays, registration, and minting remain absent.

### Unit 3 — Central sparse document identity overlay

- **Status:** Implemented and executable.
- **Goal:** Replace the QUID-to-node index with the `SparseDocumentIdentityOverlay` abstraction and path scanner.
- **Production ownership:** Replace `livemap.document.identity.ts`; controller owns root plus overlay.
- **Public/API effect:** `document.byQuid` behavior remains, implementation becomes QUID-to-path.
- **Compatibility effect:** Internal only.
- **Tests:** zero/100/duplicate claims; two independent maps; rebuild agreement; no mint; path/QUID round trips.
- **Stop conditions:** Empty-QUID maps allocate identity state proportional to `N`, or overlay attempts to own LiveTree runtime maps.
- **Dependency:** Unit 1 path utilities.
- **Suggested commit direction:** `refactor(livemap): add sparse document identity overlay`.
- **Implemented boundary:** One scanner validates syntax, placement, uniqueness, and both directions; retained storage is `O(Q)` with no node pointers; captures omit the derived overlay; reflection reads a narrow internal facade; no LiveTree or LiveHost wire semantics changed.
- **Completed follow-up:** Unit 4 replaced ordinary mutation/replay full-overlay reconstruction with operation-derived reconciliation. Complete-root construction/install/restore/replacement scans remain intentional admission boundaries.

### Unit 4 — Atomic operation-to-overlay reconciliation

- **Status:** Implemented and executable.
- **Goal:** One reducer plans graph plus overlay plus derived identity effects from the ordinary canonical commit and installs them atomically.
- **Production ownership:** central document transition planner, mutation/replay/install/core transition boundary.
- **Public/API effect:** No intended surface change.
- **Compatibility effect:** Corrects operation identity behavior; may expose previously accepted inconsistent QUID metadata.
- **Tests:** exhaustive matrix from section 5; rollback; no-op; observer failure after install; move/splice path transforms; malicious duplicates.
- **Stop conditions:** Helpers must independently patch overlay, rollback cannot be proved, or derived identity effects become independent commands.
- **Dependency:** Units 0, 1, 3.
- **Suggested commit direction:** `refactor(livemap): reconcile graph and live identity atomically`.
- **Implemented boundary:** Ordinary mutation and replay share one graph-operation reducer and one copy-on-write sparse overlay reconciler. Incoming identity admission is subtree-local, witnesses consume ordinal-staged overlays, exact no-ops discard derived effects, and controller publication remains one root/revision/overlay swap.
- **Complexity evidence:** Deterministic counters distinguish whole-root builds, sparse entries visited/changed, and incoming nodes visited. Ordinary operations perform no full overlay rebuild; full scans remain at complete-root admission boundaries. Whole-root graph cloning and canonical invariant validation are not represented as solved by this identity unit.
- **Completed follow-up:** Unit 5 closes queued/stale request lowering and the LiveHost canonical boundary without changing the operation reducer.

### Unit 5 — Lower QUID requests before commit

- **Status:** Implemented and executable.
- **Goal:** Keep QUID reads/mutations as live request APIs while ensuring all returned document commits are path-authoritative.
- **Production ownership:** document target normalization, attrs/content APIs, staged authority, LiveHost canonical types/decoders/client/persistence compatibility, and reflection registration typing.
- **Public/API effect:** Existing target requests remain; canonical LiveMap and LiveHost operation types expose only a path plus optional witness.
- **Compatibility effect:** Current canonical decoding is strict. Named internal client/persistence readers retain bounded old QUID-only input, require its exact base, and immediately normalize it; no wire version or persistence-format rewrite is introduced.
- **Tests:** QUID request at revision R; queued and deduplicated authority; witness mismatch; deletion, replacement, and sibling movement; multi-operation staging; history/recovery/persistence path closure; exact-base legacy translation.
- **Stop conditions:** Resolution occurs outside the accepting transaction or a raw QUID remains the sole canonical target.
- **Dependency:** Unit 4.
- **Suggested commit direction:** `refactor(livemap): lower QUID requests to canonical paths`.
- **Implemented boundary:** All active request families resolve through the installed ordinal-staged overlay. Current canonical decoders reject QUID-only targets. LiveHost actions, history, recovery, and new persistence records carry only path targets; reflection QUIDs remain continuity evidence; `document.byQuid` remains read-only; unsafe debug mutation remains explicitly outside the contract.
- **Legacy limit:** Compatibility lowering is possible only with the exact base graph and matching mode. Persistence load supplies that base and normalizes in memory. Isolated or unresolved legacy history remains a hard rejection/recheckpoint case; any future durable record rewrite belongs to Unit 9, not this unit.

### Unit 6 — Path-first reflection with derived identity effects

- **Status:** Implemented and executable.
- **Goal:** Remove reflection's need to route canonical commits by QUID while preserving same-QUID exact-node continuity and all LiveTree ownership.
- **Production ownership:** `reflect.document.ts`, structural planner, the shared document path helper, and one private commit/effect adapter in LiveMap identity ownership.
- **Public/API effect:** The reflection facade is unchanged; deterministic diagnostics add whole-build, incremental-update, correspondence-change, and consumed-effect counts.
- **Compatibility effect:** Current canonical commits are path-only. Legacy QUID-only input is translated against its exact staged base before Reflection observes it. No LiveTree semantic, LiveHost protocol, or persistence format change.
- **Tests:** 62 focused checks cover path-only attrs/content, carrier paths, QUID-free routing, matching/absent/conflicting witnesses, shifted correspondence, same-QUID compatible replacement, move CSS/event/resource continuity, failure isolation, fresh-binding recovery, and complete-build accounting.
- **Stop conditions:** Repair requires path-authoritative LiveTree handles or weakens runtime collision/lifecycle rules.
- **Dependency:** Units 4 and 5.
- **Suggested commit direction:** `refactor(reflect): apply document commits by canonical path`.
- **Implemented boundary:** Path is the sole canonical route. Identity effects are derived, private, and validated against the final overlay. Local structural correspondence is incremental; root/snapshot convergence is the only complete-build boundary. The structural planner retains conservative full result validation, so Unit 6 does not claim to solve whole-graph cloning or validation cost.
- **QUID-only mutation limit:** No supported public canonical metadata registration/rekey operation exists. Unit 6 does not invent one; QUID changes remain structural replacement/root admission cases until a separately designed path-authoritative registration and LiveTree rekey contract exists.
- **Direct LiveTree audit:** Attributes and representable text/empty/remove operations delegate to canonical mutations. Append/create/detach/remove-children and ambiguous destructive cases reject before local mutation. Unsafe raw graph/DOM bypass can drift; validation fails the binding, and recovery is disposal plus fresh reflection rather than silent repair.

### Unit 7 — Explicit capture and epoch provenance

- **Status:** Implemented and executable.
- **Goal:** Define same-epoch, durable structural, identity-free, and external admission categories; add provenance/admission policy.
- **Production ownership:** document capture/install/restore, HSON/view-state/graph-content boundary adapters.
- **Public/API effect:** Add explicit capture/admission options or new methods; preserve old exact capture under a documented compatibility mode.
- **Compatibility effect:** External QUID-bearing input no longer silently proves active membership; format version may change.
- **Tests:** all four categories, `noQuid` continuity loss, same-epoch restoration, external strip/rekey/reject, restart epoch reset.
- **Stop conditions:** Same-epoch identity cannot be distinguished from copied serialized metadata.
- **Dependency:** Units 0, 3, 4.
- **Suggested commit direction:** `feat(livemap): classify live and structural captures`.
- **Implemented boundary:** `capture()` retains exact durable compatibility semantics. `capture({ identity })` adds `same-epoch`, `preserve-metadata`, and `strip`; install/restore additionally accept `reject`. Same-epoch admission validates the exact owner, current local epoch, unchanged capture graph/envelope, and exact capability object before candidate preparation. Durable and external preserved claims are active only as fresh local overlay identity. Strip removes metadata on a detached candidate before ownership and never mutates the source.
- **Provenance ownership:** One document-map closure owns an object capability and local counter. The capability is nonenumerable because it is not stored on the capture at all, is neither authentication nor authorization, and is replaced by changed durable install/restore including accepted staged-authority install. LiveTree retains its independent runtime epoch and collision-aware exact-node ownership.
- **Compatibility result:** No capture, HSON, HTML, JSON, view-state, graph-content, bootstrap, recovery, canonical commit, or persistence format changed. No protocol field, remote token, migration, rekey, registration API, or passive shadow graph was added.
- **Executable result:** Three focused launchers provide 22 capture-category, 23 provenance/admission, and 23 LiveHost/Reflection closure checks. They cover opacity, stale/foreign/raw-byte rejection, duplicate/atomic admission, identity-free path replay, bootstrap/checkpoint restart semantics, and new-mirror versus exact-runtime continuity.

### Unit 8 — LiveHost path-authoritative canonical commit v2

- **Status:** Deferred and conditional. The Unit 5 audit found no existing new-format correctness defect that requires a v2 field.
- **Goal:** Version document canonical commits and emit only path targets with optional witnesses; negotiate recovery format.
- **Production ownership:** LiveHost types, history, protocol, actions, recovery, client.
- **Public/API effect:** New canonical commit/protocol version; action request targets remain compatible.
- **Compatibility effect:** Wire and history format change; mixed-peer negotiation required.
- **Tests:** QUID action -> path history; identity-free snapshot plus tail; v1/v2 negotiation; bootstrap/recovery/mirror parity.
- **Stop conditions:** History cannot be versioned or clients must route by old QUID after snapshot.
- **Dependency:** Units 5 and 7.
- **Suggested commit direction:** `feat(livehost): version path-authoritative document commits`.

### Unit 9 — Legacy history and persistence migration bridge

- **Status:** Deferred and conditional. Unit 5 supplies bounded exact-base read compatibility and in-memory normalization without rewriting records.
- **Goal:** Translate checkpoint-plus-v1-tail to v2 atomically and retain read compatibility for bounded migration.
- **Production ownership:** persistence decoder/store migration and deployment tooling; `hson-demo2` integration fixtures.
- **Public/API effect:** Persistence adapter records gain explicit versions/migration outcome.
- **Compatibility effect:** Storage migration; no isolated-commit conversion guarantee.
- **Tests:** successful QUID-target tail conversion; gaps, missing/duplicate QUIDs, rollback, idempotency, old checkpoint recovery, cross-restart verification.
- **Stop conditions:** Existing retained history lacks an exact base graph, has unresolved targets, or cannot be atomically rewritten. Require recheckpoint, do not guess.
- **Dependency:** Unit 8.
- **Suggested commit direction:** `feat(livehost): migrate legacy QUID-targeted history`.

### Unit 10 — Explicit LiveMap identity request and compatibility fences

- **Status:** Complete. `document.ensureIdentity({ kind: "path", path })` is the sole public acquisition name. It returns an opaque active-epoch handle with `active`, `path()`, `snap()`, and `dispose()` and never exposes raw-QUID reconstruction.
- **Goal:** If demanded by retained LiveMap handles, add one explicit mint/request API; mark raw QUID surfaces live-epoch/diagnostic; preserve LiveTree behavior.
- **Production ownership:** LiveMap identity handle/overlay API, diagnostics, documentation; LiveTree only regression tests and wording.
- **Public/API effect:** Additive retained-identity API; possible deprecations for raw map strings, not removals.
- **Compatibility effect:** Demo consumers can migrate from DOM-string round trips to handles where useful.
- **Tests:** explicit-only minting, handle invalidation, ABA/no-reuse, two maps, LiveTree construction/projection/graft/detach/clone/CSS/events/resources unchanged.
- **Stop conditions:** API encourages application persistence, bypasses collision owner, or requires weakening LiveTree.
- **Dependency:** Units 3, 4, 7.
- **Suggested commit direction:** `feat(livemap): add explicit sparse identity handles`.
- **Completed prerequisite 10R-A:** Linked construction/projection preserves canonical QUID absence, exact-node/DOM correspondence is QUID-free, and supplied claims are admitted without private minting.
- **Completed prerequisite 10R-B:** Existing linked QUID demand delegates through one exact binding; LiveMap owns secure collision-aware allocation and the path-authoritative `ensure-quid` canonical operation; Reflection owns local preflight and rollback-safe supplied claim; replay/LiveHost transport use the recorded QUID without allocation.
- **Implemented boundary:** Public path-only acquisition reuses the 10R-B authority seam on reflected maps and commits locally on unreflected maps. Existing claims are no-ops. Handles resolve through the Unit 3 overlay, follow Unit 4 path effects, and fence removal, replacement, disposal, and owner-epoch replacement. Raw QUID lookup/mutation/LiveTree/diagnostic surfaces remain available only as active-epoch compatibility APIs; no setter, `fromQuid`, global registry, public LiveHost action, replacement/retirement, object/array eligibility, or rekeying is added.
- **Executable result:** Three focused launchers add 23 acquisition, 24 handle-lifecycle, and 23 compatibility/Reflection checks. A deterministic 1,000-node fixture proves zero-QUID overlay storage remains empty and one request adds one entry; the full encoding remains 16 characters.

### Unit 11 — Optional object/array QUID eligibility

- **Status:** Complete. Semantic projected `_hson_obj` and `_hson_arr` values are eligible only through explicit `map.ensureIdentity(path)` acquisition. Primitive/scalar carriers, property wrappers, and array-item wrappers remain ineligible.
- **Goal:** Expand the single QUID concept only for independently retained object/array nodes after semantics are proven.
- **Production ownership:** metadata registry, core validators, transforms, overlay, handle API, DOM guards.
- **Public/API effect:** New valid metadata placements; potentially observable canonical format expansion.
- **Compatibility effect:** Parser/serializer/validator behavior change; primitives remain ineligible.
- **Tests:** object/array retain/move/rename/splice/replace, no DOM selector assumption, serialization categories, ordinary zero-mint maps.
- **Stop conditions:** Canonical graph shape changes unexpectedly, wrappers/primitives become eligible accidentally, or operation identity remains ambiguous.
- **Dependency:** Units 2, 4, 7, 10.
- **Suggested commit direction:** `feat(identity): admit retained object and array nodes`.
- **Implemented boundary:** Projected maps own a mode-specific sparse QUID/path overlay with no node pointers. The Unit 2 rename/move operations, splice, delete, set, and replace derive overlay effects without structural-equality inference or ordinary-operation minting. A parallel `LiveMapProjectedIdentityHandle` preserves the document handle lifecycle while returning detached projected values. Document and projected registration share `ensure-quid` and one collision-aware map allocator; replay uses recorded bytes.
- **Transport closure:** Durable projected captures include the exact canonical root. Additive anonymous HSON object/array QUID headers preserve metadata through LiveHost snapshot, bootstrap, recovery, and client restore without changing the QUID encoding or protocol version. Projected feeds, links, selectors, stores, and schemas continue to observe only the user value.
- **Executable result:** Three focused launchers add 22 acquisition, 23 rename/move/lifecycle, and 25 closure/propagation checks. A 2,000-row QUID-free fixture retains zero claims, and sparse reconciliation visits only the one registered entry in the focused accounting proof.

### Unit 12 — Million-node and namespace proof

- **Goal:** Prove sparse memory/time, eliminate per-operation full scans where required, and finalize allocator/no-reuse/worker policy.
- **Production ownership:** path-local candidate performance work, overlay implementation, benchmark/diagnostic suites.
- **Public/API effect:** None intended.
- **Compatibility effect:** Internal performance only.
- **Tests:** all conceptual cases in section 12 across Node/browser/worker where practical; deterministic allocator injection only for tests.
- **Stop conditions:** Any identity structure is `O(N)` for zero-QUID maps, ordinary mutation mints, or allocator reset can revive stale handles in one epoch.
- **Dependency:** Units 3–5 and the completed Unit 11 projected-container cases.
- **Suggested commit direction:** `perf(livemap): prove sparse identity at million-node scale`.

### Unit 13 — Encoding selection and migration

- **Goal:** Choose 8 versus 10 characters from measured namespace behavior, then version and shorten only the runtime/live QUID encoding.
- **Production ownership:** core codec, allocator owners, validators, transforms, fixtures, docs, demo selectors.
- **Public/API effect:** Observable string/serialization change.
- **Compatibility effect:** Major or explicitly versioned compatibility change; fixture/fingerprint migration.
- **Tests:** collision retry/no-reuse, old/new decode policy, browser selectors, workers, mirrors, all exact widths/alphabet.
- **Stop conditions:** Any unchecked live allocator remains, retained persisted v1 history is not migrated, or namespace/no-reuse ownership is ambiguous.
- **Dependency:** Units 0–12, including completed Unit 11 eligibility.
- **Suggested commit direction:** `refactor(identity): shorten checked epoch-scoped QUIDs`.

The first implementation target is Unit 0, followed by Unit 1. Encoding work must not be combined with them.

## 14. Compatibility and versioning analysis

| Change class | Expected impact | Versioning recommendation |
|---|---|---|
| Internal-only | Overlay representation, path trie, graph/overlay reducer, QUID-to-path lookup | No public version if behavior remains exact. |
| Public types | Split request and commit targets; new witness/category/epoch types; possible new projected move/rename ops | Additive types first. Changing existing returned commit types is likely major unless a versioned commit surface is introduced. |
| Public behavior | QUID requests return path-targeted commits in later units; external serialized QUID alone does not prove active provenance; QUID-only canonical changes remain revision-worthy | Document and stage path/admission changes behind version/compatibility mode. Likely major for direct commit assertions/admission behavior. |
| Serialized HSON/HTML/JSON | Bytes may still carry QUID; admission semantics change | Encoding width requires explicit version/migration. Category metadata should be versioned where encoded. |
| LiveMap capture/view-state | Exact v2 currently preserves QUID and revision | Add a new version/category rather than silently reinterpret v2 persistence. |
| LiveHost canonical commit | Raw QUID targets removed from new history | Existing envelope is path-closed in Unit 5; version only if later semantics require negotiation. |
| LiveHost protocol | Exact-key decoders and recovery messages carry canonical commits | Strict current decode plus isolated bounded compatibility decode; version only for a future format change. |
| Persistence | Old checkpoint plus exact canonical tail may contain QUID targets | Unit 5 lowers on exact-base load; add an atomic rewrite tool only when durable migration is required. |
| Bootstrap/recovery | Snapshot can preserve QUID but tail becomes path-only | Version snapshot category/provenance separately from structural correctness. |
| Fixtures/fingerprints | Exact 16-character values, selectors, payloads, canonical hashes | Migrate only in Unit 13, after protocol/persistence conversion. |
| `hson-demo2` | Live raw-QUID UI and browser shape assertions are observable | Preserve behavior until compatibility unit; migrate tests with public package APIs, not dist-internal imports. |

### Public entrypoint proof

These are real compatibility surfaces. `package.json` publishes root, `./livetree`, `./livemap`, `./livehost`, `./reflect`, and `./types` ([`package.json`](../../package.json#L24)). `./livemap` exports all LiveMap types ([`src/api/livemap/index.ts`](../../src/api/livemap/index.ts#L38)); `./livehost` exports canonical stream, recovery, persistence, protocol, graph-content codecs, and all LiveHost types ([`src/api/livehost/index.ts`](../../src/api/livehost/index.ts#L35)); `./livetree` exports `LiveTree`, `CssManager`, and QUID-bearing types ([`src/api/livetree/index.ts`](../../src/api/livetree/index.ts#L1)); `./reflect` exports document reflection ([`src/api/reflect/index.ts`](../../src/api/reflect/index.ts#L1)); and `./types` re-exports LiveMap targets and LiveHost canonical/persistence types ([`src/types/index.ts`](../../src/types/index.ts#L24)). The root entrypoint also explicitly exports `LiveMapDocumentTarget`, `LiveHostDocumentTargetPayload`, and persistence types ([`src/index.ts`](../../src/index.ts#L130), [`src/index.ts`](../../src/index.ts#L230), [`src/index.ts`](../../src/index.ts#L370)).

### Major-version boundary

Unit 5 closes the canonical target type and current decoder while preserving the path-or-QUID action request union and bounded exact-base compatibility readers. It does not add or rewrite a serialized format. A major-version boundary is still appropriate if a later unit adds negotiated commit fields, changes capture provenance, or removes the compatibility reader; do not force LiveTree API changes into that major solely for convenience.

## 15. Executable final invariants

The completed architecture is acceptable only when automated tests prove all of the following:

1. A QUID-free map supports every ordinary mutation, capture, install, durable replay, recovery, bootstrap, and persistence route.
2. No ordinary LiveMap construction, parse, traversal, read, mutation, capture, replay, or restore implicitly mints a QUID.
3. Only an explicit live identity API or a LiveTree operation that genuinely needs identity may mint.
4. Every quidded node in an active document map has exactly one current path in its overlay.
5. Every overlay entry resolves to exactly one owned graph node carrying the same QUID, and every active graph QUID has an overlay entry.
6. Empty-QUID graphs retain no per-node identity state.
7. Every canonical document operation has deterministic revision, operation-ordinal, path, index, and path-transform semantics.
8. Multi-operation commits interpret later paths against the staged result of earlier operations.
9. QUID-targeted live requests become path-authoritative before commit return, history publication, transport, or persistence.
10. A QUID witness can detect active same-epoch mismatch but its absence never prevents an otherwise valid path replay.
11. Durable structural snapshots and path histories recover correctly after every QUID is stripped.
12. Same-epoch capture can preserve live identity only with explicit epoch provenance.
13. Identity-free serialization explicitly gives up handles, live continuity, QUID-owned CSS/events/resources, and reflection association; it does not claim behavioral equivalence.
14. External serialized QUID bytes do not establish active epoch membership.
15. Move and rename preserve identity only from explicit operation intent; structural equality never implies it.
16. Replacement retires prior identity unless an explicit compatible same-epoch same-node rule applies.
17. Graph plus overlay plus ordinary revision install atomically; failed validation publishes neither.
18. Overlay/reflection identity effects are derived from accepted canonical commits and cannot be replayed as independent commands.
19. Observer failure after install does not roll back committed state and is reported distinctly from replay conflict.
20. Multiple LiveMaps and multiple LiveTrees may coexist; each owner checks its own complete namespace and cross-owner admission never overwrites.
21. LiveTree handles remain exact-node anchored; detach, disposal, clone, graft, projection, collision, CSS, event, animation, resource, and reflection ownership semantics remain unchanged unless separately approved.
22. The LiveMap overlay never becomes the LiveTree runtime registry, and LiveTree identity never becomes dependent on LiveMap paths.
23. No QUID is used for authorization or accepted as a security token.
24. No hidden permanent node ID, `DocumentNodeId`, UUID, or renamed equivalent is introduced.
25. A million-node zero-QUID map has `O(1)` retained overlay state, and sparse operations never scan `N` merely to update identity.
26. Encoding shortening cannot land until collision enforcement, epoch reset/no-reuse, persistence migration, and compatibility tests pass.

## 16. Unresolved decisions and stop conditions

### Decisions that must be made in Unit 0 or Unit 1

1. **Witness conflict rule:** confirm that an active different QUID at a witnessed path is a structured conflict, while a completely absent witness is diagnostic-only.
2. **Same-epoch provenance representation:** choose internal exact-object token for local captures and a negotiated ephemeral authority token, if remote continuity is required. Raw QUID, logical map ID, and incarnation alone are insufficient.
3. **External admission default:** choose strip versus leave unquidded after decode; rekey only when an explicit live identity need exists. Never silently adopt raw bytes.
4. **Public commit migration:** decide dual v1/v2 public commit APIs versus a major-version switch.
5. **Graph candidate performance:** choose path-spine copy-on-write, persistent ownership, or reversible journal after correctness; account for unsafe debug aliases.
6. **No-reuse scope:** decide whether no-reuse is required for every active map/LiveTree epoch and measure issued-ever storage before shortening.
7. **Retained LiveMap handle API:** decide whether a public explicit identity handle is needed at all before designing its mint trigger.
8. **Object/array `set` semantics:** define update versus replacement before QUID eligibility expands.

### Mandatory stop conditions

Stop implementation and report the conflict if:

- any operation cannot be interpreted deterministically as revision plus path plus staging semantics;
- move, rename, batch staging, or replay requires a permanent hidden node ID;
- path transformation cannot be centralized behind one reducer;
- same-epoch provenance cannot be distinguished from copied serialized metadata;
- LiveHost v1 history cannot be migrated without an explicit format/protocol version;
- a legacy QUID target cannot resolve against its exact checkpoint/staged base graph;
- object/array eligibility changes canonical structure or parser meaning unexpectedly;
- a million-node zero-QUID map requires identity storage proportional to total nodes;
- the sparse overlay starts owning or mutating LiveTree runtime registries;
- path authority would make LiveTree handles, DOM identity, CSS, events, animation, resources, or disposal depend on LiveMap revision paths;
- collision checks can be bypassed by an active mint/admission path;
- allocator reset can make a stale live handle resolve to a different node in the same epoch;
- external/malicious duplicate QUIDs could overwrite an existing entry;
- worker, thread, process, or mirror concurrency has no complete owning namespace or admission boundary;
- QUID is found to authorize access or act as a bearer secret; or
- the proposed solution is a renamed node UUID.

### Final conclusions

- **Concise identity model:** LiveTree is QUID-authoritative for active exact-node identity; LiveMap is revision/path-authoritative for durable structure and uses a sparse QUID/path live overlay; LiveHost persists path operations and treats QUID as optional continuity metadata/witness; applications own their own IDs.
- **Hidden permanent ID:** none was found to be unavoidable. Current path and staging semantics are sufficient once QUID requests are lowered before history.
- **Largest risk:** translating retained QUID-targeted LiveHost checkpoint tails without losing or misaddressing user state.
- **Encoding:** eight checked characters remain provisionally viable, but only after Units 0–12 establish ownership, collision/no-reuse, migration, and measured scale.
