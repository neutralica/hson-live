# Canonical Schema Phase 2 — shadow authority

Phase 2 uses closed-data finalization. Existing builder operations construct the
current immutable semantic nodes exactly once. At the end of `schema.define`, a
private compatibility bridge lowers those already-produced nodes, verifies the
result, and records exactly one immutable state in a `WeakMap`:

- `SHADOW_GRAPH_COMPLETE` with the whole verified graph; or
- `SHADOW_GRAPH_NON_LOWERABLE` with structured reasons.

No definition callback, constraint predicate, or unresolved recurse thunk is
executed by shadow acquisition. A constrained child prevents a complete parent
graph. A recurse target memoized by ordinary current validation can be lowered
when that resolved node is later composed into a newly finalized Schema; an
already-finalized classification does not mutate.

The source census remains 548 definitions: 255 static declarative, 53
constraint-bearing, 11 conservatively recursive, 229 dynamic acquisition or
frontend definitions, and zero unexpected cases. The 229 dynamic definitions
are no longer rejected merely for dynamic source syntax: at runtime, any
completed result made entirely of declarative nodes becomes complete.

The private census counts observed constructed Schema objects by complete/non-
lowerable status, blocker family, and projected/document/attrs/multi-capability
class. The private differential hook is disabled by default. When enabled, it
compares acceptance plus ordered issue code, path, expected, received, and attr
evidence, and throws with graph/node evidence on a mismatch. It never chooses an
authority; the current validator remains the production result.

## Deterministic resource semantics

The provisional version-1 format limit is 100,000 graph nodes. Evaluator safety
defaults are 1,000,000 node steps, 10,000 accumulated issues, depth 512, 100,000
union-branch units, and 100,000 content items. Tests may supply lower limits for
adversarial cases. Resource exhaustion is a deterministic canonical evaluator
issue and has no effect on current production validation while shadow mode is
disabled.

## Refinements and digest

Canonical string length deliberately counts Unicode code points. UTF-16 code
units are easy to reproduce in JavaScript but encode surrogate-pair artifacts;
grapheme clusters are user-facing but require a versioned segmentation table.
Code points are portable and precisely specifiable across implementations.

Pattern refinement remains the internal `literal-string-v1` dialect with only
full, prefix, suffix, and contains modes. JavaScript `RegExp` is not canonical
authority and arbitrary regex migration remains deferred.

An internal semantic digest is deferred. Canonical encoding is deterministic,
but adding synchronous hashing at Schema finalization would either introduce a
host-specific crypto dependency or prematurely select a non-cryptographic
identity. Encoding equality is used as Phase-2 evidence; no runtime attachment
or `map.schema.use` identity behavior changes.
