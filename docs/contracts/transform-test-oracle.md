# Canonical Transform test oracle

The maintained Transform semantic oracle is test-only and browser/Worker-safe.
Its final decision is strict canonical graph equality after the operation under
test has completed its own documented admission or projection. Comparison does
not normalize, detach roots, coerce values, sort content, rebuild indexes,
remove metadata, or retry through another ingress.

## Operation boundaries

Closure observes these concrete boundaries independently where applicable:

1. Hson source tokenization and parsing;
2. exact root detachment;
3. canonical invariant admission;
4. serializer admission and serialization;
5. Hson reparse and exact detachment;
6. strict canonical comparison;
7. input nonmutation and repeated-cycle convergence;
8. runtime-local semantic projection.

Exact token streams, formatting, source positions, and human-readable prose
remain specialized assertions. They do not replace semantic closure.

## Difference and failure identity

The strict comparison traversal returns the first deterministic canonical
difference. Paths identify fields and content positions; classifications cover
root leakage, VSN/name/mode differences, scalar type and value differences,
`0` versus `-0`, attribute and metadata presence/value, QUIDs, array indexes,
content length, and content ordering.

Transform-owned errors carry ordinary readable `operation`, `code`, optional
`stage`, one-based `source.line` and `source.column`, zero-based
`source.index`, optional canonical `path`, and the original `cause`. Existing
formatted messages remain available for people, but tests use the structured
fields as identity.

Oracle failures are classified as expected rejection, unexpected acceptance,
unexpected rejection, unexpected error class, canonical divergence, input
mutation, nonconvergent cycle, or cross-runtime divergence. The deterministic
witness body contains only named case and launcher identity plus available
source/fixture, options, first difference, and structured error facts. It omits
timestamps, process IDs, temporary paths, IPC paths, and random seeds.

## Regression promotion

A fixed failure is promoted by assigning a stable case name and choosing one of
five descriptors: valid source closure, invalid source rejection, valid graph
serialization closure, invalid graph serialization rejection, or cross-runtime
parity. Promotion does not require a generator, shrinker, mutation operator, or
persistent failure artifact.
