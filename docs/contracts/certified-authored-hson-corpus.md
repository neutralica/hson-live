# Certified authored-HSON corpus

The certified authored-HSON corpus is the executable source of truth for the
settled authored language and its graph, structural JSON, and structural HTML
transport boundaries. It is a finite contract inventory, not a fuzz suite or a
second implementation of the parser.

The authoritative launcher is
`transform.certified-authored-hson-corpus`. Run it with:

```sh
npm run test:certified-authored-hson-corpus
```

Regenerate the review artifact with `npm run corpus:review`. The committed
artifact is `docs/contracts/certified-authored-hson-corpus.review.txt`; the
launcher rejects stale or nondeterministic regeneration.

## Descriptor architecture

`tests/certified-corpus/corpus-types.mts` separates literal accepted and
rejected authored-HSON cases, transparent family definitions and their
materialized cases, accepted and rejected graph ingress, structural JSON,
structural HTML, diagnostic-circuit regressions, and specialized-test
cross-references. Every materialized case has a stable ID, explicit taxonomy,
hand-authored expected graph or structured rejection, and exact applicable
wire output. The inventory contains no callback-driven fixture logic.

`corpus-manifest.mts` materializes and sorts the descriptors and derives every
count. `corpus-runner.mts` owns executable semantic assertions.
`corpus-integrity.mts` owns inventory and review-artifact integrity. Expected
graphs and outputs are constructed explicitly; neither the parser nor the
serializer under test generates them.

## Certified totals

| Classification | Concrete descriptors |
| --- | ---: |
| Literal accepted authored-HSON | 39 |
| Transparent accepted authored-HSON | 49 |
| Literal rejected authored-HSON | 37 |
| Transparent rejected authored-HSON | 117 |
| Graph-only accepted transport | 11 |
| Graph-only rejected transport | 9 |
| Structural JSON transport | 14 |
| Structural HTML transport | 49 |
| Diagnostic-circuit regressions | 4 |
| Specialized-test cross-references | 10 |
| **Total concrete descriptors** | **339** |

The authored subset has 242 unique sources and zero declared source reuse.
The runner executes 1,011 accepted assertions, 1,602 rejected assertions, and
24 integrity assertions: 2,637 atomic assertions in total.

## Coverage boundaries

The corpus certifies the full finite quoted-string and backtick-name escape
families, including all 32 raw C0 rejection cases for each token role. It
certifies object, array, and element grammar; mode-sensitive scalar admission;
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
legacy HTML suite. It is not an authored-HSON semantic descriptor.

No parser, serializer, invariant, equality, normalization, transport,
diagnostic-circuit, or public-facade behavior was changed to introduce this
corpus.

## Integrated accounting

The registered hson-live inventory is 1,020 authoritative checks across 43
launchers. The hson-demo2 catalog remains 2,110 cases, for a combined total of
3,130. The launcher manifest fingerprint is
`b1f9c7589b0e911c14df7be7e8e1ad70c49264439dce7e1ff5f97ddd042be319`;
the demo catalog fingerprint remains `fnv1a32-e3a7d185`.

The next target is canonical graph encoding v1 and canonical `HsonString`
digest design, followed by deterministic operators.
