# QUID, path, and revision contract

## Status

This document defines the executable Unit 0 identity contract shared by canonical HSON graphs, LiveMap, LiveTree, and controlled LiveHost persistence. Later units may change document operation formats, but they must preserve these rules unless an explicit architectural revision replaces them.

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

A path identifies a structural location in a named graph revision. It is not timeless identity. For ordered commits, each operation is interpreted against the staged graph produced by preceding operations.

LiveMap paths remain the planned durable language for structural operation targets:

```text
revision + canonical path + operation semantics
  -> authoritative structural target

QUID
  -> registration data, current live lookup, continuity aid,
     or optional stale-intent witness
```

Current compatibility APIs still permit QUID-targeted document operations and history. Lowering those requests to path-authoritative commits belongs to Unit 1 and later work; Unit 0 does not change their format.

`LiveMapPathHandle` follows a projected location. It may observe a different value after movement, splice, replacement, deletion, or replay. It does not silently become an identity handle.

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

`map.debug.node(...)` is explicitly unsafe graph access. References returned through that surface can mutate owned graph objects without commits, revisions, identity-index reconciliation, feeds, or subscriptions. Such mutation is not a supported QUID registration mechanism and does not weaken the ordinary revision contract. A future path-authoritative registration operation belongs at the canonical document mutation/transition seam.

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
