# Materialized authored-Hson conformance corpus candidate

The materialized authored-Hson conformance corpus candidate is the executable source of truth for the
settled authored language and its graph, structural JSON, and structural HTML
transport boundaries. It is a finite contract inventory, not a fuzz suite or a
second implementation of the parser.

Run the executable suite with:

```sh
npm run test:certified-authored-hson-corpus
```

Regenerate the review artifact with `npm run corpus:review`. The committed
artifact is `docs/contracts/certified-authored-hson-corpus.review.txt`; the
suite rejects stale or nondeterministic regeneration.

## Descriptor architecture

`tests/certified-corpus/corpus-types.mts` separates literal accepted and
rejected authored-Hson cases, transparent family definitions and their
materialized cases, accepted and rejected graph ingress, structural JSON,
structural HTML, diagnostic-circuit regressions, and specialized-test
cross-references. Every materialized case has a stable ID, explicit taxonomy,
hand-authored expected graph or structured rejection, and exact applicable
wire output. The inventory contains no callback-driven fixture logic.

`corpus-manifest.mts` materializes and sorts the descriptors.
`corpus-runner.mts` owns executable semantic assertions.
`corpus-integrity.mts` owns inventory and review-artifact integrity. Expected
graphs and outputs are constructed explicitly; neither the parser nor the
serializer under test generates them.

## Coverage boundaries

The candidate covers the full finite quoted-string and single-quoted-name escape
families, including all raw C0 rejection cases for each token role. It checks
object, array, and element grammar; mode-sensitive scalar admission;
negative-zero identity; exact structural JSON order and decoded duplicate-key
evidence; and structural HTML totality for detached scalars, explicit string
segmentation, controls, Unicode, and raw `style`/`script` text.

Negative zero is checked with `Object.is` after authored admission and reparse,
all three graph transport routes, repeated structural JSON cycles, structural
HTML admission and reparse, and diagnostic witness rendering.

## Specialized ownership

The corpus cross-references but does not absorb tokenizer token arrays,
exhaustive coordinate mechanics, malformed graph admission, serializer-option
matrices, QUID mechanics, Worker/browser wiring, scale/performance cases,
oracle self-tests, or ordered JSON parser internals. The 12,000-property late
duplicate remains in the JSON ingress suite.

`transform/legacy/html::html__largeFormat.html_wikipedia` remains the
long-standing real-world closure and performance regression in the specialized
legacy HTML suite. It is not an authored-Hson semantic descriptor.

No parser, serializer, invariant, equality, normalization, transport,
diagnostic-circuit, or public-facade behavior was changed to introduce this
corpus.

## Test authority

Executable suites and their suite-owned metadata are authoritative. Reports
count the actual emitted case terminals; this corpus does not participate in a
launcher manifest, duplicate catalog, or historical inventory reconciliation.

The completed human worksheet remains immutable historical input. Current
membership records are amendment-aware. The next authored-Hson decisions are
`.5` admission, element-closer trivia, comment syntax, and mixed-root design
reservation.
