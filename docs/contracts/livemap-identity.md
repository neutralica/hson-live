# QUID, path, and revision contract

## Status

This document defines the executable Unit 0 identity contract, Unit 1 canonical document-path contract, Unit 2 projected movement-intent contract, Unit 3 sparse QUID/path overlay contract, Unit 4 operation-derived reconciliation contract, Unit 5 QUID-request lowering boundary, Unit 6 path-first Reflection contract, and Unit 7 capture/provenance contract shared by canonical HSON graphs, LiveMap, LiveTree, and controlled LiveHost persistence. Later units must preserve these rules unless an explicit architectural revision replaces them.

## One QUID concept

HSON Live has one QUID concept. A QUID is an optional opaque identity token used when the live system needs to retain, reconcile, or route an eligible HSON node independently of its current structural path.

A QUID is not:

- application identity;
- a hidden permanent node UUID;
- a second document-node identifier;
- a path or substitute for path semantics;
- authorization, authentication, a capability, or a security token; or
- proof that serialized bytes belong to an active live epoch.

Only ordinary elements are currently QUID-eligible. Expanding eligibility, changing the encoding, or defining a retained-identity API is outside Unit 0.

## Canonical graph state and revisions

`$_meta.quid` is canonical graph state. Adding, replacing, or removing it changes the exact canonical graph.

When a LiveMap-owned canonical graph changes only by QUID metadata, that change:

- advances the ordinary LiveMap revision;
- appears in the ordinary commit stream;
- may enter history and synchronization;
- may be captured and persisted; and
- participates in ordinary stale-base and no-op decisions.

There is no separate `identityGeneration`, silent QUID overlay mutation stream, or QUID-insensitive revision clock. A future registration operation may be path-addressed, but it must use the ordinary canonical revision contract.

## Strict canonical equality

`canonical_hson_graph_equal` and `canonical_hson_graph_difference` remain strict. QUID metadata is significant, and otherwise identical graphs carrying different QUIDs are not exact-equal.

An explicitly named identity-stripping projection may compare or serialize a different purpose-built view. It must not be substituted for strict canonical equality when LiveMap decides whether an owned canonical mutation is a no-op or deserves a revision.

## LiveTree QUID authority

LiveTree is the originating and primary active-identity consumer. One `LiveTreeRuntime` owns its active QUID namespace.

LiveTree preserves these semantics:

- whole-graph admission is preflighted before claims are published;
- minting checks the owning runtime and retries collisions;
- handles remain anchored to the exact node, not merely a raw QUID lookup;
- query materialization may establish identity for the returned exact node;
- detach and same-runtime movement preserve identity and owned resources;
- terminal disposal invalidates the node and cleans QUID-owned CSS, events, animation, resources, reflection, and lifecycle state;
- clones receive fresh identity; and
- malformed or duplicate active claims reject without partial admission.

LiveTree does not become path-authoritative, and its identity does not depend on LiveMap revisions.

## LiveMap path and QUID roles

A `LiveMapDocumentPath` is a nominal, readonly array of finite, non-negative safe-integer indexes. It traverses only canonical `$_content` ownership and is distinct from projected `LivePath`; string keys are never document-path segments. Validation detaches and freezes the runtime array before it enters a commit.

Path origin is mode-specific but uses one language:

- in element mode, `[]` addresses the one public top-level ordinary element;
- in fragment mode, `[]` addresses the owned `_hson_elem` content cluster;
- subsequent indexes descend through the current endpoint's canonical `$_content` array, including structural carriers and legal primitive leaves; and
- a path through a primitive or beyond owned content rejects rather than coercing, scanning, or rebasing.

A path identifies a structural location in a named graph revision. It is not timeless identity. Operation ordinal zero is interpreted against `commit.prevRev`; ordinal `i` is interpreted against the staged graph produced by ordinals `0..i-1`. Callers supply each ordinal's path and indexes in that staged coordinate system.

LiveMap paths remain the planned durable language for structural operation targets:

```text
revision + canonical path + operation semantics
  -> authoritative structural target

QUID
  -> registration data, current live lookup, continuity aid,
     or optional stale-intent witness
```

Active document APIs accept `LiveMapDocumentRequestTarget`, which retains path-or-QUID compatibility. Canonical graph operations store `LiveMapDocumentCommitTarget`, whose discriminator is always `kind: "path"`. A QUID request is synchronously resolved through the current validated document identity overlay and lowered to the exact current path before the new operation is constructed. No newly produced LiveMap graph commit stores a QUID as its sole target.

A commit target may carry `witness: { quid }`. The path always routes. A matching active endpoint QUID validates same-epoch intent; an active different endpoint QUID reports a structured witness conflict; no endpoint QUID leaves identity-free replay available. A witness elsewhere cannot repair or reroute an invalid path, and raw bytes remain insufficient epoch provenance.

Pre-Unit-1 QUID-targeted replay is retained behind explicitly named compatibility adapters. Successful compatibility replay lowers each operation against its exact staged base and immediately normalizes it to path plus witness. Current canonical LiveHost decoding rejects QUID-only targets; only internal client and persistence compatibility readers admit the old shape. New authoritative history is produced from path-authoritative LiveMap commits.

`LiveMapPathHandle` follows a projected location. It may observe a different value after movement, splice, replacement, deletion, or replay. It does not silently become an identity handle.

## Sparse document identity overlay

Each active document LiveMap owns one derived `QUID -> canonical path` and `canonical path -> QUID` overlay. Construction performs one deterministic scan of the owned canonical root, validates QUID syntax, eligibility, and uniqueness, and stores entries only for QUID-bearing ordinary elements. Returned paths are detached and frozen. The overlay stores no graph-node pointers and is empty for a QUID-free graph, so retained identity storage is `O(Q)` rather than `O(N)`.

`document.byQuid` first reads the current overlay path, resolves that path against the current owned root, and returns a detached clone. QUID request lowering uses the same forward lookup. Optional commit witnesses use the reverse path lookup; they never route or repair an invalid path. Repeated reads do not rebuild or rescan the graph.

The controller owns root, ordinary revision, and overlay as one coherent state. Construction and complete-root admission build an overlay; ordinary mutation and replay derive one through operation reconciliation before state publication. Failed duplicate or malformed candidates publish neither root, revision, overlay, history, nor observations. Exact captures serialize the canonical graph and QUID metadata, not the derived overlay.

Ordinary attribute and content operations reconcile this overlay from the same canonical path operation that changes the detached graph candidate. Attribute operations retain the exact overlay. Insert and replacement scan only incoming content for QUID claims, then transform sparse existing paths. Removal and movement transform sparse existing paths without rediscovering nodes in the graph. Derived `preserved`, `moved`, `retired`, and `introduced` effects are internal evidence, never caller commands or separately serialized history.

Replay uses the same operation reducer and the staged overlay from each prior ordinal, so witnesses observe the exact staged identity correspondence. Exact no-ops publish neither root, revision, overlay, nor identity effects. A failed ordinal discards every detached graph, overlay, and effect candidate. Successful publication installs root, revision, and overlay before observers run.

Whole-root external admission remains deliberately different: construction, install, restore, decoded snapshot admission, and `replace-root` replay perform one complete validation scan because the complete ownership domain changes. Capture serializes only canonical graph metadata and revision. Ordinary operation reconciliation retains `O(Q)` overlay storage, visits sparse entries rather than graph nodes, and scans only incoming subtrees; whole-root graph cloning and invariant validation remain separate later performance seams.

The overlay never mints QUIDs, owns LiveTree claims, retains DOM nodes, or manages LiveTree CSS, event, animation, resource, handle, or lifecycle records. Reflection may read the current path/QUID correspondence through an internal read-only facade, while `LiveTreeRuntime` remains the sole owner of active LiveTree identity.

## Request lowering and canonical closure

Path-or-QUID unions are request surfaces only. Document attribute and content APIs, LiveHost built-in document actions, and custom LiveHost handlers operating on their staged draft may accept a QUID request. Resolution occurs inside the accepting mutation or replay transaction against that ordinal's current owned graph and sparse overlay. Queue delay therefore cannot freeze an earlier path, and a deduplicated retry joins or reuses one action execution rather than resolving again against a later base.

Every newly produced `LiveMapGraphOp`, `LiveHostEncodedGraphOp`, history entry, recovery body or tail, client-applied canonical commit, and persistence append uses a validated path target. A QUID may remain only as an optional non-routing witness. No current canonical encoder or public current-format decoder accepts a QUID as the operation's sole address.

Legacy QUID-only canonical input is bounded compatibility data, not a second canonical model. Translation requires the exact checkpoint/base graph and matching map mode, resolves operations in ordinal order through the staged overlay, rejects missing, malformed, duplicate, or conflicting identity, and publishes only the normalized path commit. The persistence reader performs this normalization in memory without rewriting stored records. An isolated legacy operation without its exact base cannot be translated and must not be guessed, discarded, or resolved against a final graph.

Reflection registrations retain path-authoritative commit targets; their QUID correspondence remains live continuity evidence only. `document.byQuid` is a read-only current-epoch lookup and never creates a commit. `map.debug.node(...)` remains an explicitly unsafe bypass and is not part of the lowering guarantee.

## Path-first document reflection

Document Reflection resolves every current canonical operation from its validated path. An optional QUID witness is checked only after that path resolves; a QUID found elsewhere cannot redirect the operation. The accepted commit carries its Unit 4 `preserved`, `moved`, `retired`, and `introduced` evidence through a private commit-keyed adapter, without adding public commit fields or a second serialized stream. Reflection validates that evidence against its prior projected correspondence and the already-installed final LiveMap overlay, but never mutates the overlay.

Ordinary local structural commits transform projected registration paths through the same Unit 1 path-effect helper used by LiveMap reconciliation. Surviving moved registrations are rebound to their new paths, retired registrations are removed, and only introduced final subtrees are walked for new registrations. Attribute commits do not rebuild correspondence. Complete initialization, snapshot convergence, and compatible `replace-root` convergence may perform a whole-correspondence build because the complete projected domain is being admitted. The structural planner still performs conservative complete graph/result validation; Unit 6 removes whole-domain correspondence and QUID rediscovery from ordinary local commits, not the separately documented graph-cloning/validation performance seam.

A move retains the exact projected subtree and therefore its LiveTree handles, DOM, CSS, events, animation, and lifecycle resources. Replacement is conservative: only a compatible ordinary-element root with the same persisted QUID and tag may reuse the exact root node; differing-QUID or incompatible replacements retire the old subtree. QUID-free documents use the same path routing and require no identity evidence.

LiveMap and LiveTree registries remain separate. The sparse LiveMap overlay owns canonical QUID/path lookup; `LiveTreeRuntime` owns exact active nodes and their resources. Reflection's `byQuid` table is binding-local validation evidence, not a canonical router and not a replacement runtime registry.

While a tree is reflected, public LiveTree attribute mutations and the representable `text.set`/`text.add`/`text.insert`, `empty`, and nested `remove` cases delegate to canonical LiveMap operations. Append, create, detach, detached-content append, `removeChildren`, and ambiguous/destructive text cases reject before local structural mutation. The guard prevents ordinary public API drift. Explicit unsafe raw-node or raw-DOM mutation can bypass it; the next delegation or canonical observation validates path, attrs, QUID, node/DOM links, and fails the binding on divergence. There is no in-place drift repair. Disposal followed by a fresh reflection binding rebuilds correspondence from canonical state.

## LiveMap does not mint implicitly

A QUID-free LiveMap is complete and fully functional. LiveMap does not mint merely because a graph is:

- constructed or parsed;
- traversed or read by path;
- mutated through ordinary attributes or content operations;
- moved, deleted, or replaced;
- captured, installed, restored, or replayed; or
- installed from a LiveHost-compatible snapshot.

Supplied valid sparse QUID metadata is preserved where exact graph contracts require it. Untouched unquidded nodes remain unquidded. A later explicit retained-identity API may request minting, but no such API is defined here.

## Capture categories and provenance

Every controlled boundary has one of four meanings:

1. **Same-epoch live capture** preserves canonical QUID metadata and carries an opaque exact-object capability issued by the same active document map epoch. `capture({ identity: "same-epoch" })` creates that local capability. `install` or `restore` must explicitly request `identity: "same-epoch"`; copied, spread, JSON-round-tripped, view-state-decoded, stale, mutated, or foreign captures reject. The capability is held out of band in a `WeakMap`, has no enumerable or serialized field, authorizes nothing, and becomes stale when a changed durable install or durable restore replaces the map epoch.
2. **Durable structural capture** preserves the exact canonical graph, QUID metadata, and revision. Existing `capture()` retains this compatibility meaning; `capture({ identity: "preserve-metadata" })` is its explicit form. View-state, graph-content, LiveHost snapshots, bootstrap, recovery, and persistence checkpoints use this category. Installation validates all claims and admits preserved strings as fresh map-local active overlay claims. It does not prove continuity with handles from the source map, process, mirror, or LiveTree runtime.
3. **Identity-free projection** intentionally removes QUID metadata. `capture({ identity: "strip" })`, install/restore with `identity: "strip"`, HSON `noQuid`, and ordinary application JSON are examples. The source is unchanged, the installed overlay is empty or reduced to remaining claims, and exact canonical equality is lost when metadata was removed. This is valid projection, not corruption.
4. **External graph admission** covers every graph without trusted same-epoch provenance, including syntactically valid serialized QUIDs. Document install/restore make the policy explicit: `preserve-metadata` validates and admits claims as fresh local identity, `strip` removes them before ownership, and `reject` refuses QUID-bearing input. Rekey is intentionally absent because no public registration/minting API exists. Construction, authored transforms, graph-content insertion, LiveTree import, and graft retain their existing collision-aware admission rules and never treat the bytes as proof of prior handle continuity.

The core distinction is:

```text
same QUID string preserved
  -> exact metadata and possible fresh local lookup continuity

same live identity preserved
  -> requires current local-map capability or independent exact LiveTree-runtime ownership
```

One document LiveMap epoch and one `LiveTreeRuntime` epoch are separate owners. Reconstructing a map or mirror creates a new map epoch even when every QUID byte is identical. Reflecting that new map creates or admits nodes in its target LiveTree runtime; it does not recover old browser objects. Within an already active binding, exact runtime objects and collision-checked registrations provide independent LiveTree provenance, so Unit 6 continuity remains valid without conflating the two epoch types.

### Boundary inventory

| Boundary | Unit 7 category and QUID behavior | Active identity and provenance | Compatibility impact |
|---|---|---|---|
| `DocumentLiveMap.capture()` | Durable structural by default; exact QUID metadata and revision | No transferable active identity; explicit same-epoch form is an exact-object capability | Existing bytes and call meaning unchanged; options are additive |
| document `install` | External/durable by default; explicit preserve, strip, reject, or same-epoch | Preserved metadata becomes fresh local overlay identity; exact continuity only with valid capability | Default behavior retained; explicit tightening is opt-in |
| document `restore` | Same policies as install, with captured revision installed | Durable restore replaces the map epoch; same-epoch restore retains it | Default bytes/revision behavior retained |
| document replay | Current-epoch canonical transition; path-first operations may preserve QUID metadata/witnesses | Uses the target map's staged overlay; no capture provenance is inferred | No change |
| HSON parse/serialize | Durable metadata or external input; `@quid` preserved | Detached metadata only until a live owner admits it | No format change |
| HSON `noQuid` | Identity-free projection | No identity is adopted or minted | No change |
| structural HTML | External/durable metadata in `hson:quid` | Copied markup has no epoch proof | No format change |
| ordinary HTML / managed DOM | LiveTree diagnostic/runtime representation; copied markup is external | Exact mounted nodes belong to the current LiveTree runtime; strings alone prove nothing | No change |
| structural JSON | External/durable metadata in `$_meta.quid` | Detached until admitted | No format change |
| ordinary application JSON | Identity-free application projection; a user `quid` key remains user data | No system identity | No change |
| view-state codec v2 | Durable exact structural capture preserving QUID metadata | Decoding never recreates a same-epoch capability | No version change |
| graph-content codec v2 | Durable/external detached content preserving QUID metadata | Insert admission validates fresh local claims; no source-handle continuity | No version change |
| LiveHost snapshot | Durable structural capture, HSON or view-state | A receiving mirror admits a new local map epoch | No protocol change |
| LiveHost bootstrap | Durable structural bootstrap preserving useful metadata | `logicalMapId` and `incarnationId` are history identity, not node-epoch proof | No protocol change |
| LiveHost recovery | Durable snapshot plus path-authoritative tail | Snapshot creates/replaces the mirror epoch; tail needs no QUID routing | No protocol change |
| persistence checkpoint | Durable exact view-state capture | Authority restart creates a new local map epoch | No storage change |
| persistence tail | Durable path-authoritative commits; graph content may preserve QUIDs | Replayed against the reconstructed local overlay; QUID is never the sole target | No storage change |
| Reflect initial binding | External/current-map claims are collision-checked into a LiveTree runtime | Exact binding/runtime objects provide LiveTree provenance | No semantic change |
| Reflect rebuild/root convergence | Complete correspondence admission; same-QUID reuse remains conservative | A fresh binding does not inherit old browser handles; an active binding retains runtime evidence | No semantic change |
| LiveTree graft/import | External admission with existing syntax, duplicate, runtime-owner, and collision checks | Admitted values are fresh/current-runtime claims unless the exact runtime already owns the graph | No semantic change |
| debug/diagnostic serialization | Diagnostic metadata preservation | Never provenance, authorization, or a persistence promise | Documentation clarification |

Stable failures distinguish unsupported categories, missing same-epoch provenance, stale and foreign epochs, identity-policy mismatch, malformed envelopes, and duplicate preserved claims. Every failure occurs before root, overlay, revision, history, feed, Reflection, or persistence publication.

## `noQuid` is identity-stripping

HSON `noQuid` output deliberately removes QUID metadata without mutating the source graph. Reparsing that output produces an identity-stripped graph that is not exact-equal to a QUID-bearing source.

The projection does not promise to preserve retained handles, active continuity, QUID-backed CSS, events, animation, resources, reflection associations, lifecycle state, or exact canonical graph identity.

The certified route is: a QUID-bearing source remains unchanged; serialized output omits QUID metadata; reparsing produces a valid canonical graph; strict equality reports inequality when metadata was removed; and identity-free installation creates an empty sparse overlay without minting.

## Mutation boundaries

Ordinary LiveMap document APIs protect system metadata and currently expose no supported operation that directly adds, replaces, or removes `$_meta.quid`.

`map.debug.node(...)` is explicitly unsafe graph access. References returned through that surface can mutate owned graph objects without commits, revisions, identity-overlay reconciliation, feeds, or subscriptions. Such mutation is not a supported QUID registration mechanism and does not weaken the ordinary revision contract. A future path-authoritative registration operation belongs at the canonical document mutation/transition seam.

## Required invariants

Automated acceptance coverage must continue to establish:

1. QUID metadata is strict canonical graph state.
2. A QUID-only LiveMap canonical change is revision-worthy.
3. No second identity clock or permanent hidden node ID exists.
4. A QUID-free LiveMap remains functional and ordinary behavior never implicitly mints.
5. Controlled exact capture and persistence may preserve QUIDs.
6. `noQuid` explicitly abandons exact identity continuity.
7. Serialized QUID bytes alone establish neither provenance nor authority.
8. LiveTree remains QUID-authoritative for active exact-node identity.
9. LiveMap paths remain the planned authoritative target for durable structural operations.
10. Every installed document QUID has exactly one overlay path, and every overlay path resolves to the same graph QUID.
11. QUID-free graphs retain an empty overlay, and no overlay retains graph-node pointers.
12. Root, revision, and overlay install coherently only after candidate validation.
13. Overlay construction and lookup never mint QUIDs or mutate LiveTree runtime ownership.
14. Ordinary document operations derive overlay changes from their canonical path effects without rebuilding the whole overlay from the candidate graph.
15. Incoming content admission visits only the incoming subtree for new QUID claims and rejects collisions with surviving sparse claims before publication.
16. Derived identity effects cannot be submitted, replayed, persisted, or published independently of the accepted canonical commit.
17. Replay validates witnesses against the overlay produced by prior staged ordinals and installs only the final coherent root/revision/overlay state.
18. Path-or-QUID targets remain active request data; canonical LiveMap and LiveHost operation types admit only paths plus optional witnesses.
19. QUID requests lower inside the accepting staged transaction and never before authority queue admission.
20. Changed LiveHost actions publish path targets; no-op and failed actions publish no canonical commit.
21. New history, recovery tails, client canonical application, and persistence appends contain no QUID-only targets.
22. Current canonical protocol decoding rejects QUID-only targets, while named compatibility readers remain isolated from public current-format output.
23. Legacy translation requires the exact base and lowers each ordinal against its current staged overlay; it never guesses or resolves against the final graph.
24. Reflection QUIDs are correspondence evidence rather than canonical routing authority.
25. Read-only QUID lookup and unsafe debug access do not redefine canonical mutation guarantees.
26. Ordinary local Reflection operations transform correspondence through the shared canonical path effect and never rebuild the whole correspondence domain.
27. Reflection consumes derived identity evidence from the accepted commit without adding a public field or mutating the LiveMap overlay.
28. Move preserves exact projected subtree identity; replacement reuse requires compatible same-QUID evidence.
29. Public reflected-tree structural mutation either delegates one exact canonical operation or rejects before local drift; unsafe bypass drift fails validation and requires a fresh binding to rebuild.
30. Existing `capture()` is durable exact-metadata capture; explicit same-epoch capture requires a nonserialized exact-object capability.
31. Copied QUID-bearing bytes can be admitted as fresh map-local claims but can never prove source-map or source-runtime handle continuity.
32. Durable install/restore replaces the local map epoch only when it replaces authoritative state; valid same-epoch installation retains it.
33. View-state, graph-content, LiveHost snapshot/bootstrap/recovery, and persistence formats remain durable structural formats and carry no persisted epoch capability.
34. Identity stripping happens before ownership/admission, never as a silent mutation of a LiveMap-owned graph.
35. Projected object rename and array move remain explicit canonical operation intent; equality never infers movement.
36. Rename retains the source position and subtree, retires an existing destination, and rejects a missing source.
37. Projected move uses nonnegative safe final indexes and shifts each intervening sibling exactly once.
38. Projected rename/move preserve exact transport, replay, feed, link, store, and LiveHost history intent without minting QUIDs or enabling object/array QUID eligibility.
