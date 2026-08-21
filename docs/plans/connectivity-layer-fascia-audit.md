# Connectivity layer / fascia audit

Date: 2026-08-14

Primary repository: `hson-live`

Supporting evidence: `hson-demo2`

Scope: architecture audit only; no production behavior or public API changes

## 1. Executive conclusion

Meaningful repeated reconciliation logic exists, but it does **not** justify a new shared kernel now.

The repeated logic is concentrated in three places:

1. Document paths and projected-data paths both implement move/index-shift, replacement retirement, and descendant-path preservation. They do so over different path domains and different authoritative operation vocabularies. Document paths are numeric logical HSON content paths; projected paths mix object keys and array indexes and include rename/splice semantics.
2. LiveMap's document planner and Reflection's shadow planner both execute document graph operations. LiveMap decides canonical state. Reflection uses the already accepted operation plus the resulting canonical graph and exact runtime state to decide reuse, DOM work, and terminal cleanup. Their common-looking switch statements do not have the same output or policy boundary.
3. Reflection folds the shared document path transition over operations in both identity preflight and correspondence publication. The primitive is already shared with LiveMap; only the sequencing is repeated inside one subsystem.

The document side already has the small, pure, policy-free kernel the audit was looking for: [`document_path_effect_for_graph_operation`](../../src/api/livemap/livemap.document.path.ts) plus [`transform_document_path`](../../src/api/livemap/livemap.document.path.ts). LiveMap's document QUID overlay and Reflection both consume it. There is no third independent document path-transform algorithm.

A broader cross-domain endpoint kernel fails the extraction threshold. It would need either a parallel universal operation vocabulary or generic adapters for two materially different path models. It would not delete enough code to offset the type and runtime complexity. LiveHost, feeds, bindings, selectors, and resource managers mostly delegate, re-resolve fixed locations, or implement their own policy rather than duplicate subject reconciliation.

The semantic-graph idea should therefore remain descriptive: distributed, subsystem-owned `Map`, `WeakMap`, `Set`, arrays, and exact object references around the canonical graph. No global registry, central event bus, serialized relation graph, fourth Live subsystem, or public API is warranted.

One hidden partial-publication seam is real: canonical root, revision, owner epoch, and QUID/path overlay are installed together, but document watches run before ordinary commit observers, including Reflection. A document watch callback can therefore observe revision `n + 1` canonical state while a Reflection binding still reports revision `n`. Reflection failure after acceptance also leaves canonical state committed and fails the binding rather than rolling canonical state back. This is consistent with existing failure policy, but the cross-observer ordering is not directly characterized by a focused test.

**Public API decision required:** none. This audit proposes no public surface or semantic change.

## Source key

The reconciliation matrices use these source keys. Each key identifies the nontrivial production interpretation named in its cells.

| Key | Source and symbol | Role |
|---|---|---|
| **LM-P** | [`livemap.core.ts`](../../src/api/livemap/livemap.core.ts): `plan_write_ops`, `plan_write_ops_with_identity`, `prepare_projected_transition`, `apply_replay_ops` | Projected-data canonical planning, ordered carrier semantics, replay |
| **LM-D** | [`livemap.document.mutation.ts`](../../src/api/livemap/livemap.document.mutation.ts): `prepare_*`, `prepare_finished_mutation`, `prepare_document_graph_operation` | Document canonical mutation and replay planning |
| **LM-A** | [`livemap.authority.ts`](../../src/api/livemap/livemap.authority.ts): `make_livemap_transition_controller`; [`livemap.core.ts`](../../src/api/livemap/livemap.core.ts): `publishCommitWithWatch`, `restore`, `applyMutation`, `applyReplay` | Atomic install and publication |
| **DP** | [`livemap.document.path.ts`](../../src/api/livemap/livemap.document.path.ts): `document_path_effect_for_graph_operation`, `transform_document_path` | Shared document path effect and transition |
| **DI** | [`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts): `reconcile_livemap_document_identity_overlay`, `replace_livemap_document_identity_overlay_effects` | Sparse document QUID/path index and derived effects |
| **PI** | [`livemap.projected.identity.ts`](../../src/api/livemap/livemap.projected.identity.ts): `reconcile_livemap_projected_identity_overlay`, `transform_path`, `transform_rename`, `transform_move`, `transform_splice` | Sparse projected-data identity reconciliation |
| **IE** | [`livemap.identity-epoch.ts`](../../src/api/livemap/livemap.identity-epoch.ts): `stage_livemap_identity_epoch`, `retain_livemap_identity_epoch`; [`livemap.document.capture.ts`](../../src/api/livemap/livemap.document.capture.ts): `validate_livemap_document_admission` | Same-owner-epoch lifetime and exact capture provenance |
| **LOC** | [`livemap.document.location.ts`](../../src/api/livemap/livemap.document.location.ts); [`livemap.watch.ts`](../../src/api/livemap/livemap.watch.ts): `make_livemap_watch_hub`; [`livemap.feed.ts`](../../src/api/livemap/livemap.feed.ts): `make_livemap_feed_hub` | Fixed-location handles, watches, and feeds |
| **LINK** | [`livemap.link.ts`](../../src/api/livemap/livemap.link.ts): `apply_projected_link_event`, `apply_link_event` | Propagation and conflict/fallback policy |
| **RD** | [`reflect.document.ts`](../../src/api/reflect/reflect.document.ts): `preflight_identity_operations`, `consume_identity_effects`, `reconcile_correspondence_incrementally`, `apply_observation` | Linked document correspondence and revision tracking |
| **RS** | [`reflect.document.structure.ts`](../../src/api/reflect/reflect.document.structure.ts): `plan_document_structural_transaction`, `plan_document_root_structural_transaction`, `plan_replacement`, `apply_document_structural_transaction` | Exact projection continuity, shadow planning, DOM application, cleanup |
| **RC** | [`reflect.collection.ts`](../../src/api/reflect/reflect.collection.ts): `onCommit`, `applyNested`, `update`, `shouldUpdateSurvivor` | Application-keyed collection projection |
| **LT-B** | [`document-binding-state.ts`](../../src/api/livetree/lifecycle/document-binding-state.ts); [`reflect.document.ts`](../../src/api/reflect/reflect.document.ts) | Linked LiveTree delegation and structural mutation rejection |
| **LT-S** | [`livetree.ts`](../../src/api/livetree/livetree.ts): `detach`, `detachContents`, `remove`, `empty`; [`appends.ts`](../../src/api/livetree/methods/appends.ts) | Standalone exact-tree mutation and reattachment |
| **LT-Q** | [`tree-selector.ts`](../../src/api/livetree/creation/tree-selector.ts); [`search.ts`](../../src/api/livetree/methods/search.ts) | Snapshot selections and current-graph queries |
| **BIND** | [`livetree.bind.ts`](../../src/api/livetree/methods/livetree.bind.ts); [`livemap.bridge-bindings.ts`](../../src/api/livemap/livemap.bridge-bindings.ts) | Location-bound value bindings and owner-scoped disposal |
| **RES** | [`dispose-node.ts`](../../src/api/livetree/utils/dispose-node.ts): `dispose_node_deep`; [`runtime-detach.ts`](../../src/api/livetree/lifecycle/runtime-detach.ts): `unmount_node_preserving_runtime`; [`lifecycle-registry.ts`](../../src/api/livetree/managers/lifecycle-registry.ts); [`livetree-runtime.ts`](../../src/api/livetree/runtime/livetree-runtime.ts) | Exact runtime lifecycle, resources, listener/CSS ownership |
| **HH** | [`livehost.authority.ts`](../../src/api/livehost/livehost.authority.ts): `make_livehost_exclusive_authority`; [`livehost.history.ts`](../../src/api/livehost/livehost.history.ts): `ingest` | Host staging, acceptance, history ordering |
| **HC** | [`livehost.client.ts`](../../src/api/livehost/livehost.client.ts): `apply_commit`, `install_snapshot`; [`livehost.protocol.ts`](../../src/api/livehost/livehost.protocol.ts): `replay_livehost_document_commit_compat` | Client mirror revision and application |
| **HR** | [`livehost.recovery.ts`](../../src/api/livehost/livehost.recovery.ts): `make_livehost_recovery_planner_internal`; [`livehost.persistence.ts`](../../src/api/livehost/livehost.persistence.ts): `validate_persisted_state` | Recovery selection and persisted-chain validation |
| **DG** | [`livemap.document.identity.ts`](../../src/api/livemap/livemap.document.identity.ts): identity accounting/fresh-scan checks; [`reflect.document.ts`](../../src/api/reflect/reflect.document.ts): `validate_registration`, `diagnostics`; LiveHost `debug` methods | Read-only validation and counters |

## 2. Current authority map

| Concern | Owner | Authority and available evidence |
|---|---|---|
| Canonical projected-data mutation | LiveMap | **LM-P** applies the requested semantic operation to the previous ordered projected carrier and constructs the resulting canonical HSON graph. Rename preserves the source position while replacing an existing destination; array move uses the final post-removal destination index. |
| Canonical document mutation | LiveMap | **LM-D** clones the previous root, resolves path/QUID requests to canonical path targets, applies the graph operation, validates the result, and hands the detached candidate to **LM-A**. |
| Commit construction | LiveMap | **LM-P** and **LM-D** retain semantic intent (`rename`, `move`, `splice`, graph operations) in ordered commits. History and transport do not reconstruct it from snapshots. |
| Document path transformation | Shared internal LiveMap module | **DP** classifies insert, remove, replace, move, and root replacement. It is consumed by **DI** and **RD**. Move destination is final post-removal index and moved descendant suffixes are preserved. |
| Projected-data path transformation | LiveMap projected identity | **PI** privately handles mixed string/number paths, rename destination retirement, array move shifts, and splice windows. No other subsystem consumes this exact operation/path vocabulary for identity continuity. |
| QUID/path continuity | LiveMap | **DI** and **PI** own sparse derived indexes. **IE** owns the monotonic issued ledger and exact same-epoch capture capability. Canonical QUID metadata remains in the HSON graph. |
| Path/location continuity | LiveMap handles and publishers | **LOC** deliberately retains the requested coordinate and re-resolves the current occupant from the installed result. It does not follow a moved subject. |
| Projection continuity | Reflection | **RD/RS** decide whether exact projected HSON/DOM objects move, patch, rebuild, or retire. They use the accepted commit, resulting canonical graph, map-derived identity evidence, and runtime-local exact objects. |
| Linked LiveTree mutation authority | LiveMap through Reflection | **LT-B** delegates linked attribute/text/QUID activity and rejects direct linked structural mutation. The linked tree does not independently reduce the commit. |
| Standalone runtime object lifecycle | LiveTree | **LT-S/RES** own exact node, DOM, QUID, resource, event, and style lifetimes. Detach is nonterminal; remove/empty and Reflection deletion/replacement are terminal. |
| Query and selector membership | LiveTree | **LT-Q** queries the current exact graph when invoked. `TreeSelector` holds a snapshot array of exact handles; it is not a commit-following membership index. |
| Binding lifecycle | Binding instance plus LiveTree owner registry | **BIND/RES** keep fixed source coordinates, read resulting values, and register teardown under the exact destination owner. They do not transform subject paths. |
| Resource cleanup | LiveTree runtime | **RES** is the common terminal cleanup path for listeners, bindings, tree events, observers, CSS ownership, DOM mappings, and disposed exact nodes. |
| Host canonical acceptance | LiveHost exclusive authority around LiveMap | **HH** stages a detached LiveMap transition, optionally gates persistence, accepts it, and then ingests the already canonical commit. It does not own structural operation semantics. |
| Client mirror revision | LiveHost client | **HC** owns `lastAppliedRev`, gap/overlap/deduplication checks, and notification. It delegates structural application to LiveMap replay before advancing the cursor. |
| Recovery policy | LiveHost | **HR** selects current, contiguous replay, snapshot, or reject from incarnation/revision/history bounds. It does not classify moved/replaced subjects. |
| Diagnostics | Each subsystem locally | **DG** exposes local counters/invariant checks. There is no authoritative cross-subsystem diagnostic registry. |

### Attachment semantics actually present

| Category | Existing mechanisms | Replacement | Move/rename | Termination |
|---|---|---|---|---|
| Location-attached | `map.at(path)`, document logical locations, feeds/watches, stores, bridge bindings | Relationship survives at the coordinate and observes the new occupant/value | Relationship remains at the old coordinate; it does not follow the subject | Explicit disposer or owning LiveTree disposal |
| Subject-attached | Sparse projected/document identity handles; Reflection QUID correspondence when present | Fresh/no-QUID replacement retires; deliberate active same-QUID replacement may preserve the one active lifetime | Path is rewritten and lifetime remains active | Delete/replacement or owner-epoch fence retires permanently |
| Exact-runtime-attached | LiveTree/HSON node, DOM node, selector member handle, listener/CSS/resource owner | Reflection may reuse only an already active compatible same-QUID/tag projection; otherwise disposes and replaces | Ordinary same-subject move preserves exact objects/resources | `dispose_node_deep`, runtime disposal, or binding disposal; equal bytes cannot reconstruct it |
| Application-key-attached | `reflect_collection` record selected by caller key | Same key reuses a rendered branch and calls update; key change removes/creates | Reordering moves the rendered branch | Projection/source disposal or key removal |
| Revision/session-attached | LiveHost cursor, recovery attempt, connection/session records | Not structural-subject semantics | Not structural-subject semantics | Gap/failure/disconnect/dispose policies |

### Inputs used by each reconciliation path

| Consumer | Commit | Previous state | Resulting graph/value | Exact runtime state | Classification |
|---|---:|---:|---:|---:|---|
| **LM-P / LM-D** canonical planning | yes | yes | constructs it | no | Authoritative reducer |
| **DI** document overlay | yes | sparse prior index | incoming operation subtree; diagnostic scan checks result | no | Derived index/effects |
| **PI** projected overlay | yes | sparse prior index | candidate projected graph receives reconciled metadata | no | Derived index |
| **LOC** watches/feeds | overlap only | prior published value | yes, re-read after install | no | Fixed-location re-resolution |
| **LINK** | yes | target previous state | source event's resulting value | no | Propagation policy; semantic intent matters |
| **RD / RS** | yes | prior correspondence/projected tree | yes, used as canonical convergence proof | yes | Runtime relation and lifecycle policy |
| **RC** | yes for targeting | keyed prior records | yes, re-read source items | exact view branches | Application-keyed projection policy |
| **LT-Q** | no | current exact graph only | current graph | yes | Snapshot selection/current query |
| **BIND** | overlap/watch trigger only | prior binding value | yes | exact destination owner | Location binding |
| **HC** | yes | current cursor/map | LiveMap constructs it | map observers may own runtime state | Mirror policy plus delegated replay |
| **HR** | revision/history envelopes | cursor/history bounds | snapshot only when selected | connection attempt state | Recovery policy |

No production path was found that performs an expensive before/after structural diff to rediscover a known rename or move. Reflection directly consumes graph operations and validates against the resulting canonical root. `reflect_collection` intentionally re-reads values because application keys, not canonical operation identity, determine its policy.

## 3. Reconciliation matrix

Legend: **owns** = owns canonical semantics; **independent** = independently interprets the accepted commit for a different output; **delegates** = hands the operation to the authority named; **derives** = derives from the accepted result or normalized effect; **location** = fixed-coordinate re-resolution; **runtime** = runtime-only lifecycle; **N/A** = no relevant interpretation.

### 3A. Canonical state, indexes, subscriptions, and projection

| Operation | LiveMap canonical reducer | QUID/path overlay | Path subscriptions | Reflection | Linked LiveTree |
|---|---|---|---|---|---|
| Object member set | **LM-P owns** ordered set | **PI derives**; ancestor identity survives, replaced endpoint retires | **LOC location**; overlap then result read | **RC derives** nested item update when in collection scope; document Reflection N/A | **BIND delegates/location** |
| Object member replacement | **LM-P owns** explicit replacement, including structurally equal replacement intent | **PI derives retirement** at/below endpoint | **LOC location** observes new occupant/value | **RC derives** from new keyed value | **BIND delegates/location** |
| Object rename | **LM-P owns** source-position preservation and destination replacement | **PI independent path transform**: source descendants rewrite, prior destination retires | **LOC location**; old path invalidates, new path is a different coordinate | **RC re-reads/keys**; no QUID transform | **BIND remains at old location** |
| Object member delete | **LM-P owns** | **PI derives retirement** at/below deleted path | **LOC location** reads missing/new parent result | **RC removes/updates** by resulting key set | **BIND remains at path and receives missing policy** |
| Array item set | **LM-P owns** set semantics | **PI retires identity** at/below exact item when the item is replaced | **LOC location** | **RC updates or rebuilds** by application key | **BIND location** |
| Array item replacement | **LM-P owns** explicit replacement | **PI retires endpoint subtree** | **LOC location** | **RC same-key reuse or remove/create** from result | **BIND location** |
| Array insert | **LM-P owns** through splice/array helpers | **PI independent shift** after insertion | **LOC location** changes occupant after index | **RC keyed reconciliation** moves/reuses exact view branches | **BIND location**, not subject |
| Array delete | **LM-P owns** through delete/splice | **PI retires deleted window and shifts later indexes** | **LOC location** | **RC removes missing keys and reorders survivors** | **BIND location** |
| Array splice | **LM-P owns** removed/inserted witnesses and ordered result | **PI independent window transform** | **LOC location** | **RC independently interprets exact root splice only for targeted accounting, then keyed result reconciliation** | **BIND location** |
| Array move | **LM-P owns** final post-removal destination | **PI independent move transform**, including intervening siblings and descendant suffix | **LOC location** does not follow subject | **RC keyed reconciliation** moves exact branch by key | **BIND location** |
| Subtree replacement (document) | **LM-D owns** `replace-content` | **DP + DI derive** retirement/introduction and shifts | **LOC location** | **RD/RS independently plan projection**; compatible active same-QUID/tag may reuse exact root, otherwise replace/dispose | **LT-B delegates to Reflection** |
| Subtree deletion (document) | **LM-D owns** `remove-content` | **DP + DI derive** subtree retirement and sibling shifts | **LOC location** | **RD/RS independently remove**, reindex correspondence, terminally dispose projected subtree | **LT-B delegates** |
| Subtree detachment | No canonical detach operation | No overlay transition | N/A | N/A for canonical document | **LT-B rejects direct linked detach** |
| Subtree reattachment | No canonical reattach operation | No overlay transition | N/A | N/A for canonical document | **LT-B rejects direct linked append** |
| Root replacement | **LM-P/LM-D owns** complete-root replacement/install | **DI/PI rebuild** active sparse overlay; **IE** usually starts new epoch | **LOC snapshot/location** re-resolves; snapshot publication always emits | **RD/RS independent compatible-root convergence**, whole correspondence rebuild | **LT-B delegates** |
| Canonical QUID assignment | **LM-D** or projected registration owns `ensure-quid`; path target is authority | **DI/PI registers claim**, **IE** extends ledger | Location values may be structurally unchanged; commit observer sees metadata change | **RD preflights claim**, consumes map-derived effect, refreshes correspondence | Linked `.q` delegates; passive traversal does not mint |
| Canonical QUID removal | No ordinary public attr operation; occurs via structural replacement/delete or stripped/root install | **DI/PI derives retirement**; issued ledger does not shrink | Location re-reads result | **RD/RS** retire or rebuild corresponding exact projection according to structural cause | Delegates |
| Snapshot installation | **LM-A owns** mode/schema/admission and exact revision install | Full overlay admission; **IE** same-epoch only with exact capture capability, otherwise new epoch | Snapshot publication re-resolves every watch | **RD/RS captures resulting canonical root and converges/rebuilds** | Delegates |
| Replay | **LM-P/LM-D owns** using the same planners as local mutation | Same **PI** or **DP/DI** reconciliation, staged over ordered ops | Published once after full install | **RD/RS** consumes accepted final commit; multi-op correspondence publishes final state only | Delegates |
| Recovery after revision gap | LiveMap rejects noncontiguous replay input | No partial update | No partial publication on rejected replay | **RD fails binding** on its own revision gap; snapshot observation can rebuild | No independent policy |
| Owner-epoch replacement | **LM-A/IE owns** fence during durable/root replacement | New overlay seeds new issued ledger; old handles cannot reactivate | Fixed locations remain usable against result | Reflection rebuild/replacement may allocate new exact projections; equal bytes alone give no authority | Linked old exact handles retire when projection is disposed |
| Standalone LiveTree terminal destruction | N/A | N/A | Source subscriptions may be disposed by owner cleanup | N/A unless destruction is Reflection's consequence of accepted delete/replace | N/A |
| Client mirror commit application | **HC delegates to LiveMap replay** | LiveMap performs normal overlay/epoch update | Local mirror publishers run during replay | A local Reflection binding is an ordinary map observer and applies synchronously or fails | Delegates through local Reflection/bindings |

### 3B. Runtime, query, binding, resource, host, and diagnostic consumers

| Operation | Standalone LiveTree | TreeSelector/query | Bindings | Resources/events | LiveHost mirror/recovery | Diagnostics / duplicate note |
|---|---|---|---|---|---|---|
| Object set/replace/delete | N/A as projected-data reducer | Current runtime query only | **BIND location** result update | Destination owner unchanged unless binding rerenders/removes it | **HC delegates** commit; **HR** revision-only | **PI** is the only subject transform in this vocabulary |
| Object rename | N/A | Snapshot members do not follow canonical subjects | Old source path remains old coordinate | No transfer decision | **HC delegates**; semantic rename preserved on wire/history | Concept overlaps **DP**, but mixed-key and destination semantics differ |
| Array set/replace | N/A | Current query/snapshot exact handles | Fixed index | Renderer/Reflection decides cleanup | **HC delegates** | No duplicate canonical reducer |
| Array insert/delete/splice | Local append/remove APIs are unrelated canonical authority | Existing selector handles remain exact; membership snapshot does not update | Fixed indexes re-resolve | **RES** only when a runtime consumer removes exact output | **HC delegates**; **HR** does not classify indexes | **PI**, **RC**, and **LINK** all use operations for different outputs/policy |
| Array move | Local detach+append can preserve exact runtime object, but it is runtime-only | Exact selector member survives if same node | Fixed index does not follow | Resources remain on exact node in standalone/Reflection move | **HC delegates** | Move math appears in **PI** and **DP**; **RS** moves shadow object rather than returning a path |
| Document subtree replacement | Standalone replacement is local append/empty policy, not a commit consumer | Old exact handle becomes disposed if Reflection terminally replaces it | Owner-bound cleanups fire with disposed tree | **RS/RES** preserve only active compatible reuse; otherwise drain old subtree | **HC delegates**; persisted/recovery codecs preserve graph payload only | **LM-D** and **RS** both execute operation shape but with different state/output |
| Document subtree deletion | `remove` is terminal; `detach` is distinct | Deleted exact member handle becomes disposed | Owner-bound bindings dispose | **RES terminal cleanup** | **HC delegates** | **DP/DI** path effect shared with **RD**; no duplicate path algorithm |
| Subtree detachment | **LT-S runtime** unlinks and unmounts while retaining node/QUID/resources for reuse | Existing exact handles stay active | Owner bindings remain | **RES preserve path** (`unmount_node_preserving_runtime`) | N/A | Runtime lifecycle, not a canonical effect |
| Subtree reattachment | **LT-S runtime** validates same runtime/cycle/QUID and reuses retained DOM mapping when possible | Existing exact handles stay active | Owner bindings remain | Same owner/resources continue | N/A | Runtime lifecycle, not recovery |
| Root replacement | Standalone root construction is a new runtime graph | Old selectors remain snapshots of old/disposed handles | Old owner disposal runs if tree terminally replaced | **RES** drains old graph; compatible Reflection root preserves root object but may replace descendants | **HC snapshot/replay delegates**; **HR** selects snapshot vs replay | Whole rebuild is explicit exception, not hidden incremental diff |
| QUID assignment/removal | Standalone `.q` uses runtime-local issuance; linked delegates | Queries can discover current metadata but do not become subject-following | Owner registry keys require active exact runtime QUID | Runtime maps/owner sets register or retire exact lifetime | Transport carries canonical assignment; no issued-ledger serialization | Equal QUID bytes are not exact-object provenance |
| Snapshot installation | No standalone analogue | Existing selectors are not rebuilt automatically | Location bindings see snapshot publication; exact projected owners depend on Reflection result | Reflection convergence performs cleanup | **HC installs in same map**, then advances mirror cursor; **HR** selected snapshot | Fresh-scan diagnostics are appropriate at boundary |
| Replay | No standalone analogue | No direct commit subscription | Location bindings publish after result | Reflection determines preservation/cleanup | **HC delegates** then advances cursor | Replay equivalence tests compare end state and projection |
| Revision gap recovery | N/A | N/A | Binding remains local unless its source fails/replaces | No resource transfer from gap classification itself | **HC/HR own** gap detection and replay/snapshot/reject policy | No path/subject reconciliation duplication |
| Owner-epoch replacement | Fresh standalone runtime is a separate identity scope | Old exact selector handles do not retarget | Old exact owners eventually dispose with their runtime/projection | **RES** never rebinds equal bytes to a retired exact object | Snapshot/persistence create fresh local identity epoch | Local epoch maps are correctly distributed |
| Terminal destruction | **LT-S owns** `remove`/`empty`; old handles permanently disposed | Snapshot handle remains disposed, never retargets | Owner disposables drain | **RES owns** fixed-point cleanup of listeners/bindings/events/CSS/DOM/QUID maps | Connection/session cleanup is separate host lifecycle | Common cleanup already exists; no canonical commit should be invented |
| Client mirror commit | N/A | Local query sees the mirror only after map install | Local binding/watch runs during map publication | Local Reflection/LiveTree policy applies | **HC owns cursor/gap policy, delegates structure** | Client does not claim new cursor before LiveMap application succeeds |

## 4. Duplicate implementations

### 4.1 Document and projected-data path transforms

**Files and symbols:** **DP** versus **PI**.

Equivalent behavior:

- Preserve descendant suffixes beneath a moved subject.
- Shift intervening array siblings exactly once.
- Treat move destination as the final post-removal index.
- Retire identities at/below a deleted or replaced endpoint.
- Keep unrelated paths unchanged.

Meaningful differences:

- **DP** accepts only numeric logical document content paths and graph operations (`insert-content`, `remove-content`, `replace-content`, `move-content`, `replace-root`).
- **PI** accepts mixed projected paths and data operations. It must handle object rename, replacement of a prior destination key, and splice deletion/insertion windows.
- **DP** returns a richer document transition (`unchanged`, `moved`, `retired`, `invalid`) plus operation effect. **PI** needs only a rewritten path or retirement while rebuilding its sparse overlay.
- **DP** has two production consumers (**DI** and **RD**). **PI** has one identity consumer.

Likely extraction boundary: only the small final-index interval arithmetic for array move is mathematically common. Extracting that arithmetic alone would not materially reduce interpretation logic, while a universal path operation would introduce a parallel vocabulary. Thresholds 3, 4, and 8 are not met.

### 4.2 Canonical document planner and Reflection shadow planner

**Files and symbols:** **LM-D** versus **RS**.

Equivalent-looking behavior:

- Resolve operation targets.
- Insert/remove/move/replace ordered content.
- Apply attributes and QUID assignment.
- Process an ordered multi-operation commit.

Meaningful differences:

- **LM-D** starts from canonical previous state, owns validation and canonical result, and constructs the commit.
- **RS** starts from the already accepted commit, prior projected exact objects, and the resulting canonical root. It plans exact object reuse, DOM movement, runtime QUID admission, resource cleanup, and then proves its planned shadow equals canonical truth.
- Replacement is intentionally different: canonical replacement replaces graph material; Reflection may keep the already active exact projected root for a compatible same-QUID/same-tag transition.
- LiveMap planning is fully detached and can reject before publication. Reflection DOM application cannot be rolled back into LiveMap and fails the binding after canonical acceptance.

Subsystem policy is inseparable from most of **RS**. A generic mutation visitor would need model adapters, exact-object hooks, failure phases, and content normalization rules. It would be more complex than the explicit switches and would not establish a new authoritative result. No extraction is recommended.

### 4.3 Reflection preflight and correspondence publication

**File and symbols:** **RD** `preflight_identity_operations` and `reconcile_correspondence_incrementally`.

Both fold an ordered graph-operation sequence over registered paths using **DP**. Preflight transforms pending identity claims without mutating the projection. Publication transforms every live registration and installs final indexes after the shadow transaction succeeds.

The shared policy-free part is already **DP**. The remaining repetition is a sequence loop around different state and failure policy inside one production subsystem, so extraction threshold 1 is not met. A tiny local helper could reduce lines but would not be an architectural kernel.

### 4.4 Commit-aware facilities that are not equivalent reconcilers

- **LINK** independently inspects rename/move/delete/splice to choose propagation or whole-scope replacement fallback. It consumes the source's resulting value and the target's prior value. It does not maintain identity continuity.
- **RC** uses path overlap for targeting, then reconciles by caller-supplied application keys and exact rendered branches. Its “same subject” is an application key, not a QUID or canonical node.
- **LOC/BIND** use the commit only to decide whether to re-read a fixed coordinate. They intentionally discard subject motion.
- **HC/HR** classify revision/order/recovery, then delegate structural meaning to LiveMap.
- **DG** validates resulting state or counts work; it does not direct mutation.

These should not be folded into a shared structural effect classifier because the apparent similarity is at the policy layer, not the structural output layer.

## 5. Contradictions and ambiguity

### 5.1 Same-QUID replacement: intentional semantic difference with terminology risk

Three observations coexist:

1. **DI** records operation-local effects as retirement of the displaced subtree followed by introduction of the incoming subtree, even when the same QUID is supplied.
2. The final overlay and a document identity handle retain the one active same-epoch subject when replacement deliberately carries the same QUID.
3. **RS** may preserve the exact projected root and DOM object when the old active projection and incoming ordinary element have the same QUID and tag.

This is not evidence that equal bytes reconstruct identity. The old subject/projection is still active inside one accepted transition, the owner epoch does not end, and the runtime object has not been terminally disposed. Copied/serialized captures, later same-epoch reuse, changed tags, different QUIDs, and retired runtime objects are all rejected or replaced.

Classification: **intentional semantic difference plus terminology mismatch**, not a demonstrated bug. “Retired/introduced effects” describe structural operation edges, whereas handle/projection continuity describes the final active lifetime. The contract would be easier to audit if an internal comment or future characterization case named this distinction explicitly. No public semantic change is proposed.

### 5.2 Fixed location versus moving subject

`map.at(path)`, document locations, watches, and bindings remain at their original path. QUID handles and Reflection correspondence follow a move/rename. After replacement, the fixed location survives while the old subject usually retires.

Classification: **intentional semantic difference**, directly tested. It should not be unified.

### 5.3 Reflection failure after canonical acceptance

Canonical root/revision/overlay remain accepted if Reflection's shadow/DOM application fails. The binding enters a failed state and a fresh binding can rebuild from canonical recovery state.

Classification: **intentional failure boundary**, not a canonical atomicity bug. DOM mutation is not part of the reversible LiveMap transaction. The observable watch-before-Reflection ordering described in section 8 remains a focused test gap.

### 5.4 Deprecated `removeChildren` terminology

Standalone `empty()` is terminal for children, while deprecated specialized `removeChildren()` follows the older detach-like path and is not the canonical document removal operation. Linked document bindings reject both structural forms.

Classification: **legacy terminology mismatch / low-priority evidence gap**. It is outside the shared-kernel question and should not be changed without a separate public-compatibility decision.

### 5.5 Root object preservation versus owner-epoch replacement

Some implementations preserve a carrier/root object while replacing its canonical contents, but root replacement or durable restore fences subject handles through a new owner epoch unless exact same-epoch provenance is explicitly proven.

Classification: **intentional distinction between implementation carrier identity and canonical subject lifetime**.

No genuine cross-consumer correctness contradiction was found in move, rename, splice, delete, replay, or recovery semantics.

## 6. Candidate shared kernel

No new shared kernel is justified.

The viable document kernel already exists as **DP**:

- Inputs: one validated numeric document path and one normalized document operation effect.
- Outputs: unchanged, moved path, retired path, or invalid effect.
- Invariants: pure/deterministic; final destination indexing; descendant suffix preservation; no DOM/socket/resource/application policy.
- Consumers: **DI** and **RD**.
- Ownership it does not acquire: canonical graph, QUID registry, exact runtime objects, cleanup, publication, or recovery.

It should remain internal and document-specific.

A broader candidate would have to accept both document graph operations and projected data operations or invent an intermediate operation algebra. It would replace little beyond **PI**'s four small transform functions, while **RS**, **RC**, **LINK**, **LOC**, and **HC** would still need their current policy. The extraction thresholds fail as follows:

| Threshold | Result |
|---|---|
| Two equivalent production consumers | Met only for document paths, already served by **DP**; not met for projected-data identity vocabulary |
| Policy-free separation | Possible for arithmetic, not for Reflection/collection/link decisions |
| One authoritative vocabulary | Not met across document graph and projected data operations |
| Deletes existing interpretation | Too little deletion; most switches remain |
| Cross-consumer identical tests | Existing document tests already prove **DP** consumers; cross-domain outputs are intentionally different |
| No global owner/registry | Could be met |
| No public API change | Could be met |
| Lower type/runtime complexity | Not met |

## 7. Non-candidates

- **Global semantic registry:** ownership is correctly distributed among LiveMap overlays, Reflection correspondence maps, LiveTree runtime maps, binding disposers, and LiveHost session/cursor maps. Exact objects and owner epochs have different scopes.
- **Public semantic graph:** would turn descriptive runtime relations into a new authority and expose unstable internal lifetimes.
- **Serialized relation graph:** runtime connectivity includes `WeakMap` keys, DOM objects, closures, disposers, and exact capture capabilities. Serialization would create misleading identity and stale authority.
- **Central event bus:** current publication order and ownership are explicit. A bus would obscure authority and failure precedence without eliminating structural interpretation.
- **Universal endpoint class:** location, subject, exact-runtime, application-key, and revision/session attachment have incompatible survival rules.
- **Generic reducer adapter shared by LiveMap and Reflection:** canonical construction and exact projection application have different inputs, outputs, rollback, and cleanup.
- **Reflection-owned QUID/path authority:** Reflection should continue consuming/verifying LiveMap-derived identity effects and retaining path correspondence for QUID-less exact nodes.
- **LiveHost structural reconciler:** mirror and persistence must keep delegating to the same LiveMap replay planners.
- **Canonical commits for runtime detach, listener disposal, DOM mount, or socket close:** these are runtime or network lifecycle events, not canonical graph facts.
- **Fourth Live subsystem:** no unowned authority was found.

## 8. Atomicity and lifecycle findings

### Canonical LiveMap transaction

**LM-A** stages detached candidates. On acceptance, `install()` synchronously installs canonical root/projected carrier, sparse overlay, owner-epoch ledger, and revision before `notify()` runs. Failed planning or installation publishes nothing. Multi-operation replay publishes only the completed candidate. These fields cannot externally straddle revisions through the normal API.

Watch entries update their stored previous value before invoking each listener. Failures are isolated until all watch entries have been visited, ordinary commit observers are still called, and the first observer failure retains precedence. This produces coherent map state, but publication itself is not one reversible transaction.

### Hidden document projection publication seam

The document order is:

1. install canonical root + overlay + epoch + revision;
2. emit document watches;
3. emit ordinary commit observers, one of which is Reflection;
4. return or throw an observer/watch failure.

Therefore a watch callback can synchronously read map revision `n + 1` and a Reflection binding still at `n`. A commit observer registered before Reflection can do the same. This is temporarily permitted by the implementation but not explicitly documented or characterized as a cross-subsystem publication guarantee.

Reflection plans before changing the projected graph, then applies HSON/runtime changes and DOM changes. Planning failure leaves DOM untouched. Apply failure may leave a partially changed projection; Reflection prunes removed registrations, fails closed, and canonical state remains committed. A fresh binding rebuilds from canonical state.

### LiveHost authority and persistence

**HH** serializes mutations. A persistence gate appends durable content before LiveMap acceptance. Gate failure discards the staged transition. A post-append realization failure terminally fences the host; durable reload can realize the committed lineage. After LiveMap acceptance, history ingestion occurs; an ingestion failure is terminal because accepted canonical state cannot be rolled back.

Notification failures are isolated from canonical acceptance and are reported diagnostically. Host history receives the canonical commit even if a map observer (including Reflection) failed.

### Client mirror

**HC** validates stream, incarnation, revision delta, gap/overlap, and mode before applying. It calls LiveMap replay first and advances `lastAppliedRev` only after the map advanced exactly once. If a map observer throws after canonical installation, the client detects the advanced map revision, advances its cursor to the received revision, records an observer failure, and fails recovery rather than replaying the already applied commit.

Snapshot installation restores into the existing map, validates the new map state, then updates incarnation/cursor and notifies. A malformed snapshot leaves mirror state and cursor unchanged.

### Runtime lifecycle

- Projection creation registers exact node/runtime/DOM correspondence locally.
- `detach`/`detachContents` unlink and unmount while preserving exact node, QUID, resources, and reuse authority.
- `remove`/`empty`, Reflection delete, incompatible replacement, and runtime disposal use **RES** terminal cleanup.
- Owner disposables share one fixed-point drain for bindings, listeners, tree events, resize observers, and other resources. CSS/QUID/DOM maps are released in the same terminal traversal.
- Selectors are snapshots and need no subscription disposal; their exact handles naturally become disposed with the nodes.
- Connection open/close, recovery attempts, and session records are LiveHost-local lifecycle, not canonical commits.

No evidence supports transferring a resource merely because equal canonical material later appears. Preservation always depends on the same active exact runtime object or an explicitly admitted active transition.

### Diagnostic opportunity

Existing local diagnostics are useful but fragmented: overlay build/reconciliation accounting, Reflection correspondence counters/validation, LiveTree resource counts/runtime ownership checks, and LiveHost history/recovery/client debug snapshots.

A future **internal, read-only, on-demand** diagnostic projection could materially help correlate:

- map revision versus Reflection source revision;
- canonical QUID claims versus overlay paths;
- Reflection paths/QUIDs versus exact projected nodes and mounted DOM mappings;
- disposed QUID owners versus remaining resource counts;
- host head revision versus client mirror cursor.

It should assemble a temporary report from subsystem diagnostics, use ephemeral aliases for exact objects, and never become a registry, mutation authority, public identity, or serialized live relation graph. It is not required to answer this audit and is not implemented here.

## 9. Test findings

### Existing focused coverage

All named library suites below are present in the public launcher inventory at [`src/_tests/test-launchers.ts`](../../src/_tests/test-launchers.ts).

| Behavior | Principal evidence |
|---|---|
| Projected rename/move/splice path transformation, source position, destination retirement, descendant paths | [`livemap-projected-identity-lifecycle.acceptance.mts`](../../tests/livemap-projected-identity-lifecycle.acceptance.mts), [`livemap-projected-rename-intent.acceptance.mts`](../../tests/livemap-projected-rename-intent.acceptance.mts), [`livemap-projected-array-move-intent.acceptance.mts`](../../tests/livemap-projected-array-move-intent.acceptance.mts) |
| Document insert/remove/replace/move effects and overlay/fresh-scan agreement | [`livemap-document-operation-identity-effects.acceptance.mts`](../../tests/livemap-document-operation-identity-effects.acceptance.mts) |
| Location attachment through reindex, move, replace, replay, and restore | [`livemap-document-location.acceptance.mts`](../../tests/livemap-document-location.acceptance.mts), [`livemap-path-handle.acceptance.mts`](../../tests/livemap-path-handle.acceptance.mts) |
| Subject attachment through move/rename; retirement through delete/replace; same-epoch ABA prevention | [`livemap-identity-aba-prevention.acceptance.mts`](../../tests/livemap-identity-aba-prevention.acceptance.mts), [`livemap-document-identity-handle.acceptance.mts`](../../tests/livemap-document-identity-handle.acceptance.mts) |
| Atomic root/revision/overlay install and failure isolation | [`livemap-document-atomic-reconciliation.acceptance.mts`](../../tests/livemap-document-atomic-reconciliation.acceptance.mts) |
| Exact projected HSON/DOM/resource preservation through move and cleanup through replacement/delete | [`reflect-document-continuity.acceptance.mts`](../../tests/reflect-document-continuity.acceptance.mts), [`reflect-document-structure.acceptance.mts`](../../tests/reflect-document-structure.acceptance.mts) |
| Incremental Reflection correspondence, planning failure, postcommit failure, replay equivalence, root rebuild | [`reflect-document-correspondence.acceptance.mts`](../../tests/reflect-document-correspondence.acceptance.mts) |
| Replay equivalence and snapshot rebuild | [`livemap-document-replay.acceptance.mts`](../../tests/livemap-document-replay.acceptance.mts), [`reflect-document-snapshot.acceptance.mts`](../../tests/reflect-document-snapshot.acceptance.mts) |
| Revision-gap recovery, snapshot/replay selection, client cursor application | [`locus-recovery.acceptance.mjs`](../../tests/runtime-probes/locus-recovery.acceptance.mjs), [`locus-client-recovery.acceptance.mjs`](../../tests/runtime-probes/locus-client-recovery.acceptance.mjs), [`locus-bootstrap.acceptance.mts`](../../tests/locus-bootstrap.acceptance.mts) |
| Persistence ordering and durable failure boundaries | [`locus-persistence.acceptance.mjs`](../../tests/runtime-probes/locus-persistence.acceptance.mjs) |
| Cross-runtime isolation and standalone non-reuse | [`livetree-runtime-scope.acceptance.mts`](../../tests/livetree-runtime-scope.acceptance.mts), [`livetree-terminal-reuse-boundaries.acceptance.mts`](../../tests/livetree-terminal-reuse-boundaries.acceptance.mts) |
| Integrated consumer/transport evidence | `hson-demo2` hosted LiveMap/LiveHost/LiveTree suites and external-library launcher registry, especially `tests/suites/livemap/*`, `tests/suites/livehost/*`, `tests/suites/livetree/livetree-26..30-*`, and `tests/runners/harness/run-external-library-launchers.node.mts` |

### Coverage repeated across consumers

- Final-index move semantics are proven in canonical projected mutation, projected identity, document identity effects, Reflection continuity, replay, and integrated demo suites.
- Replacement retirement is proven independently for projected handles, document handles, Reflection exact objects/resources, and terminal standalone handles.
- Replay/snapshot boundaries are proven in LiveMap, Reflection, LiveHost client recovery, and persistence suites.
- Same-epoch/same-runtime non-reuse is proven at both canonical and exact-runtime layers.

This repetition is appropriate integration evidence; it does not imply the consumers have the same policy.

### Gaps and cautionary names

1. **Cross-observer publication order:** no focused test creates a document watch and Reflection binding together and asserts the temporary `map.rev === n + 1` / `binding.sourceRevision === n` window. Existing atomic tests prove map overlay installation before observer failure, not projection atomicity.
2. **Same-QUID vocabulary:** existing suites separately prove retired+introduced operation effects, active canonical handle continuity, and exact Reflection reuse. A single internal characterization case would make the distinction explicit if this area is changed later.
3. **Deprecated `removeChildren`:** linked rejection is tested, but its standalone nonterminal legacy behavior is not a central lifecycle contract suite and its name can suggest terminal semantics.
4. **`reflect_collection`:** tests prove keyed reuse and targeted/full synchronization, but it should not be cited as QUID/subject continuity; `sourceQuid` is currently not the active matching authority in `reflect.collection.ts`.
5. **“Atomic reconciliation” naming:** the suite accurately proves atomic LiveMap canonical root/revision/overlay installation. It does not prove atomicity between LiveMap and DOM/Reflection; the postcommit-failure suites correctly establish the opposite boundary.

No new tests were added for this audit because the extraction decision is supported by existing focused evidence. If production publication order or same-QUID replacement policy is changed later, the first step should be characterization tests for gaps 1 and 2, wired into the existing launcher inventory.

### Audit verification run

The following focused suites passed during this audit:

- `livemap.document-operation-identity-effects`: 22/22
- `livemap.projected-identity-lifecycle`: 23/23
- `livemap.identity-aba-prevention`: 22/22
- `livemap.document-atomic-reconciliation`: 23/23
- `livemap.document-location`: 33/33
- `livemap.document-replay`: 16/16
- `reflect.document-continuity`: 20/20
- `reflect.document-correspondence`: 21/21
- `livetree.terminal-reuse-boundaries`: 20/20
- `livehost.persistence`: 17/17
- `livehost.recovery`: 11/11
- `livehost.client-recovery`: 30/30, including the real WebSocket reconnect case

The first sandboxed `livehost.client-recovery` attempt passed its first 29 checks and then could not bind loopback (`EPERM`). It passed all 30 checks when rerun with loopback permission; this was an environment restriction, not a test failure.

## 10. Recommended next step

**Choose: no extraction; keep concept architectural only.**

Specifically:

1. Retain **DP** as the document-specific internal shared path-transition kernel for **DI** and **RD**.
2. Keep **PI** private to projected identity unless a second production consumer needs the same mixed-key rename/move/splice classification.
3. Keep Reflection shadow planning, collection key reconciliation, link propagation, bindings, LiveTree cleanup, and LiveHost recovery policy in their current owning subsystems.
4. Do not introduce a semantic graph object, registry, bus, serialized relation store, universal endpoint, or fourth subsystem.
5. Before any future change to publication ordering or same-QUID replacement, add the two focused characterization cases identified above. Do not treat those tests as authorization to alter public semantics.

No code-change commit suggestion is appropriate because this audit changed documentation only.
