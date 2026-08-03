# QUID, path, and revision contract

## Status

This document defines the executable Unit 0 identity contract, Unit 1 canonical document-path contract, Unit 3 sparse QUID/path overlay contract, and Unit 4 operation-derived reconciliation contract shared by canonical HSON graphs, LiveMap, LiveTree, and controlled LiveHost persistence. Later units must preserve these rules unless an explicit architectural revision replaces them.

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

Pre-Unit-1 QUID-targeted replay is retained behind one explicitly named legacy adapter. Successful legacy replay immediately normalizes the operation to path plus witness. LiveHost's existing decoder may still admit the old wire shape until its separately versioned protocol unit, but new authoritative history is produced from path-authoritative LiveMap commits.

`LiveMapPathHandle` follows a projected location. It may observe a different value after movement, splice, replacement, deletion, or replay. It does not silently become an identity handle.

## Sparse document identity overlay

Each active document LiveMap owns one derived `QUID -> canonical path` and `canonical path -> QUID` overlay. Construction performs one deterministic scan of the owned canonical root, validates QUID syntax, eligibility, and uniqueness, and stores entries only for QUID-bearing ordinary elements. Returned paths are detached and frozen. The overlay stores no graph-node pointers and is empty for a QUID-free graph, so retained identity storage is `O(Q)` rather than `O(N)`.

`document.byQuid` first reads the current overlay path, resolves that path against the current owned root, and returns a detached clone. QUID request lowering uses the same forward lookup. Optional commit witnesses use the reverse path lookup; they never route or repair an invalid path. Repeated reads do not rebuild or rescan the graph.

The controller owns root, ordinary revision, and overlay as one coherent state. Construction and complete-root admission build an overlay; ordinary mutation and replay derive one through operation reconciliation before state publication. Failed duplicate or malformed candidates publish neither root, revision, overlay, history, nor observations. Exact captures serialize the canonical graph and QUID metadata, not the derived overlay.

Ordinary attribute and content operations reconcile this overlay from the same canonical path operation that changes the detached graph candidate. Attribute operations retain the exact overlay. Insert and replacement scan only incoming content for QUID claims, then transform sparse existing paths. Removal and movement transform sparse existing paths without rediscovering nodes in the graph. Derived `preserved`, `moved`, `retired`, and `introduced` effects are internal evidence, never caller commands or separately serialized history.

Replay uses the same operation reducer and the staged overlay from each prior ordinal, so witnesses observe the exact staged identity correspondence. Exact no-ops publish neither root, revision, overlay, nor identity effects. A failed ordinal discards every detached graph, overlay, and effect candidate. Successful publication installs root, revision, and overlay before observers run.

Whole-root external admission remains deliberately different: construction, install, restore, decoded snapshot admission, and `replace-root` replay perform one complete validation scan because the complete ownership domain changes. Capture serializes only canonical graph metadata and revision. Ordinary operation reconciliation retains `O(Q)` overlay storage, visits sparse entries rather than graph nodes, and scans only incoming subtrees; whole-root graph cloning and invariant validation remain separate later performance seams.

The overlay never mints QUIDs, owns LiveTree claims, retains DOM nodes, or manages LiveTree CSS, event, animation, resource, handle, or lifecycle records. Reflection may read the current path/QUID correspondence through an internal read-only facade, while `LiveTreeRuntime` remains the sole owner of active LiveTree identity.

## LiveMap does not mint implicitly

A QUID-free LiveMap is complete and fully functional. LiveMap does not mint merely because a graph is:

- constructed or parsed;
- traversed or read by path;
- mutated through ordinary attributes or content operations;
- moved, deleted, or replaced;
- captured, installed, restored, or replayed; or
- installed from a LiveHost-compatible snapshot.

Supplied valid sparse QUID metadata is preserved where exact graph contracts require it. Untouched unquidded nodes remain unquidded. A later explicit retained-identity API may request minting, but no such API is defined here.

## Capture, persistence, and provenance

Exact capture, view-state encoding, controlled synchronization, recovery, and persistence may preserve QUID metadata. Preservation is useful for continuity inside a controlled application lifecycle and is not forbidden.

Serialized QUID bytes alone do not prove membership in the current active epoch. Uncontrolled or external re-admission must not infer ownership, authorization, or same-node provenance from the string by itself. Future admission categories may add explicit provenance without creating a second identity system.

## `noQuid` is identity-stripping

HSON `noQuid` output deliberately removes QUID metadata without mutating the source graph. Reparsing that output produces an identity-stripped graph that is not exact-equal to a QUID-bearing source.

The projection does not promise to preserve retained handles, active continuity, QUID-backed CSS, events, animation, resources, reflection associations, lifecycle state, or exact canonical graph identity.

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
