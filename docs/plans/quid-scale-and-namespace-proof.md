# Unit 12 — QUID scale and namespace proof

Measured on 2026-08-11 with Node v22.20.0 on darwin-arm64. Timings and heap
figures below are medians of three fresh `node --expose-gc` processes. The
reproducible manual harness is [`benchmarks/quid-scale.mjs`](../../benchmarks/quid-scale.mjs).
It is deliberately not an ordinary CI launcher. Units 12P and 12T remain the
authoritative behavioral tests. Unit 12 itself changed no production behavior;
Unit 13 subsequently selected and implemented the strict 9-character row added
below.

## A. Executive conclusion

Unit 12 found the former 16-character namespace materially overprovisioned for
either defined identity lifetime. It provided 80 bits (`2^80` values). At a highly
aggressive `I = 10,000,000`, the chance that the next checked random candidate
is unavailable is only `8.27e-18`.

All four candidates are operationally safe **when generation is checked against
the complete lifetime-issued ledger**. Twelve characters are extremely
conservative. Ten characters are operationally conservative through tens of
millions of issues. Eight characters are mathematically adequate for checked
allocation even at `I = 10,000,000`: first-draw collision is `9.09e-6`, expected
attempts are `1.0000091`, and 32-attempt exhaustion is about `4.80e-162`.
Eight characters are not conservative for unchecked or independently generated
sets: their unchecked birthday probability is already 36.5% at one million.
That is a rejection/retry or merge concern, not undetected corruption in either
current owner.

The dominant limiting factor is retained `O(I)` memory and, specifically for
LiveMap, immutable-ledger copy cost—not namespace occupancy. In the Unit 12
pre-migration measurement, one million former 16-character entries retained
about 93.0 MB in this proof fixture. A
single LiveMap staged addition at that size took 334 ms because the immutable
ledger is copied; the LiveTree `Set.add` median was 0.038 ms. This is reported
as an implementation observation, not optimized here and not a reason to alter
lifetime semantics.

Unit 13 selected 9 characters as the approved middle point and a hard format
break. The resulting `2^45` namespace remains operationally safe because every
owner checks the complete unavailable domain. At `I=10,000,000`, first-candidate
collision is `2.842e-7`, expected attempts are `1.0000002842`, and 32-attempt
exhaustion is about `3.287e-210`.

## B. Current namespace facts

| Fact | Current value |
|---|---|
| Alphabet | `0123456789abcdefghjkmnpqrstvwxyz` |
| Cardinality | 32 |
| Length | 9 characters |
| Namespace | `32^9 = 2^45 = 35,184,372,088,832` |
| Entropy | Exactly 45 bits |
| Random source | `globalThis.crypto.getRandomValues(new Uint8Array(6))`; absence throws |
| Uniformity | Yes: the first 45 random bits are partitioned directly into nine 5-bit digits; the final 3 random bits are ignored, creating no bias |
| Retry limit | 32 in both LiveMap and LiveTree owner allocators |
| Rejection | Malformed candidates and all unavailable candidates consume an attempt; exhaustion fails atomically |
| Reserved syntax | None. All 32 symbols are valid in every position, including all-zero; no prefix/suffix |
| Case/normalization | Lowercase only; no folding, trimming, normalization, padding, or aliases |
| Malformed accepted variants | None found. Wrong length, uppercase, excluded letters (`i`, `l`, `o`, `u`), non-string values, or misplaced metadata reject |

One strict 9-character validator domain, `is_persisted_quid`, governs relevant syntax ingress.
Generated values, Hson `@...`, HTML/SVG `hson:quid`, canonical
`$_meta.quid`, JSON/fromNode, LiveHost protocol targets/witnesses/ensure ops,
snapshot restoration, LiveMap operations, LiveTree admission, CSS QUID access,
and both allocators converge on it either directly or through
`assign_hson_node_quid`/`read_hson_node_quid`. Generated and supplied strings
therefore have exactly the same syntactic domain. Eligibility and collision
checks are additional, owner-specific admission rules.

### Generation and ingress audit

- The only production entropy source is `mint_hson_node_quid`. Bare
  `ensure_hson_node_quid` can call it but has no production call site; its use is
  core tests. LiveTree's `mint_quid` delegates to it and every live allocation
  goes through `mint_available_quid`, checking reserved graph claims, active,
  pending, and lifetime-issued values.
- LiveMap data/document acquisition share
  `allocate_livemap_quid`. Their unavailable predicates include the owner
  epoch's issued ledger and active overlay; document registration additionally
  owns pending/reserved claims. Linked Reflection delegates canonical minting
  to that LiveMap authority and preflights runtime active, pending, issued, and
  batch-reserved claims before publication.
- Supplied values enter through Hson tokenization/parsing, browser and string
  HTML parsing, SVG conversion, `fromNode`/universal transform scanning,
  canonical graph metadata, LiveMap insert/replace/replay/restore/install,
  LiveTree graph/DOM/graft admission, LiveHost graph-content and protocol
  decoding, snapshots, checkpoints, and persistence recovery.
- Parser/serializer transport validates but does not own an identity lifetime.
  Cold parsing may retain duplicate valid claims for lossless diagnosis; unique
  owner admission later rejects duplicates atomically.
- Replay never invokes randomness. It preserves supplied canonical bytes and
  applies the established active/reuse/provenance checks.
- Test-only candidate-source seams exist for both owners. No production live
  call site was found bypassing its issued ledger or collision retry. The bare
  core mint is namespace-free by design, but is not used to publish a live
  claim.

## C. Identity population model

`Q` is the currently active identity overlay. `I` is every validated QUID
issued or admitted during the current lifetime. Always `Q <= I`.

For a LiveMap, the lifetime is exactly one owner epoch. A durable/root
replacement creates a fresh epoch and seeds `I` from active canonical claims.
Same-epoch capture/restore cannot roll `I` back. For standalone LiveTree, the
lifetime is one `LiveTreeRuntime`; terminal destruction removes `Q` but retains
the string in `I` until runtime disposal. Linked LiveTree is subordinate to the
LiveMap canonical authority and also must satisfy its local runtime registry.

Representative planning bands (budgets, not hard product limits):

| Band | LiveMap owner epoch | Standalone LiveTreeRuntime |
|---|---:|---:|
| Realistic | `I = 10^2–10^5`: ordinary state, dashboards/editors, bounded sessions and transient lists | `I = 10^2–10^5`: page/SPA activity, identified DOM subjects, animation/visualization reuse |
| Aggressive | `I = 10^5–10^6`: long server-authoritative epoch, collaborative/high-churn lists, identity-heavy recovery epoch | `I = 10^5–10^6`: long-lived SPA, game/visualization churn, continuous demos/tests |
| Pathological but feasible | `I = 10^6–10^7`: deliberately supplied identity-heavy graphs or prolonged server churn | `I = 10^6–10^7`: synthetic or adversarial continuous create/destroy workload |
| Adversarial | Up to resource exhaustion by valid supplied values; application authority controls admission | Up to process memory/runtime limits through admitted graphs or repeated construction |

These are lifetime-issued counts, not simultaneous graph nodes. A million
nodes with no continuity demand consumes zero QUIDs. Conversely, a one-slot
workload can keep `Q <= 1` while `I` grows without bound until the epoch ends.

## D. Scale measurements

### QUID-free graph proof

| Nodes | Graph build | QUID traversal | LiveMap admission | Graph heap | Owner heap | Q | I |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 5.30 ms | 17.84 ms | 94.94 ms | 8.81 MB | 8.24 MB | 0 | 0 |
| 1,000,000 | 54.05 ms | 178.24 ms | 810.49 ms | 88.01 MB | 80.24 MB | 0 | 0 |

Construction was deterministic: one canonical element carrier, one element,
one content carrier, and the remaining ordinary leaf nodes. Admission and
traversal allocated no metadata and both the active overlay and issued ledger
remained empty. This proves architecturally and empirically that graph size
alone does not consume the QUID namespace.

A fresh standalone runtime itself has `Q=0, I=0` (covered by Unit 12T). Public
standalone LiveTree construction is an explicit continuity boundary and ensures
identity for its root, so admitting a QUID-free graph as a LiveTree correctly
changes the result to at least `Q=1, I=1`; claiming `0,0` after that operation
would misstate current behavior. Preflight/passive canonical traversal does not
mint.

### Sparse active overlay over 100,000 structural nodes

| Owner / Q | Build/admit | Retained heap delta | 100k lookups | Move reconcile | Delete/retire |
|---|---:|---:|---:|---:|---:|
| LiveMap / 10 | 25.30 ms | 0.05 MB | 27.96 ms | 0.40 ms | 0.09 ms |
| LiveMap / 100 | 25.60 ms | 0.07 MB | 29.03 ms | 0.53 ms | 0.11 ms |
| LiveMap / 1,000 | 26.20 ms | 0.22 MB | 28.99 ms | 1.39 ms | 0.96 ms |
| LiveMap / 10,000 | 33.13 ms | 2.10 MB | 30.73 ms | 9.17 ms | 6.20 ms |
| LiveTree / 10 | 71.47 ms | 8.45 MB | 27.75 ms | n/a | 74.92 ms |
| LiveTree / 100 | 72.07 ms | 8.47 MB | 28.78 ms | n/a | 77.81 ms |
| LiveTree / 1,000 | 74.90 ms | 8.45 MB | 29.78 ms | n/a | 83.36 ms |
| LiveTree / 10,000 | 88.13 ms | 8.57 MB | 30.67 ms | n/a | 106.47 ms |

LiveMap overlay growth is visibly `O(Q)` and lookup stays effectively flat;
path-changing reconciliation visits active entries and is `O(Q)`. The
LiveTree heap column includes exact-object runtime routing for the full admitted
graph, so it must not be divided by Q as pure identity cost. Holding graph size
constant shows only about 0.12 MB additional retained heap from Q=10 to Q=10k;
admission/destruction still traverse graph structure. After LiveTree terminal
destruction, measured `Q=0` and `I` remained exactly the prior Q.

### High-I, low-Q ledger proof

The harness retained deterministic validated strings, with `Q=0`; lookups are
successful membership checks. Heap includes the strings, the input reference
array, and the ledger, so it is an intentionally conservative retained-process
figure rather than a Set-only object-size claim.

| Owner / I | Build | Retained heap | Bytes/I | Lookup operations | Lookup time | One new issued insertion |
|---|---:|---:|---:|---:|---:|---:|
| LiveMap / 1k | 1.61 ms | 0.12 MB | 117.9 | 100k | 1.70 ms | 0.23 ms |
| LiveMap / 10k | 7.92 ms | 1.07 MB | 107.1 | 100k | 2.02 ms | 1.76 ms |
| LiveMap / 100k | 72.44 ms | 9.73 MB | 97.3 | 100k | 3.92 ms | 19.14 ms |
| LiveMap / 1m | 881.35 ms | 93.00 MB | 93.0 | 1m | 92.84 ms | 333.90 ms |
| LiveTree / 1k | 1.30 ms | 0.11 MB | 111.4 | 100k | 1.65 ms | 0.012 ms |
| LiveTree / 10k | 7.31 ms | 1.07 MB | 107.0 | 100k | 2.16 ms | 0.014 ms |
| LiveTree / 100k | 57.09 ms | 9.77 MB | 97.7 | 100k | 3.70 ms | 0.027 ms |
| LiveTree / 1m | 748.40 ms | 92.99 MB | 93.0 | 1m | 93.06 ms | 0.038 ms |

The table above is the former 16-character Unit 12 baseline. Unit 13 reran the
one-million-entry production ledger paths three times with canonical
9-character values:

| Owner / I | Median build | Retained heap | Bytes/I | Median lookup | Median new insertion |
|---|---:|---:|---:|---:|---:|
| LiveMap / 1m | 473.69 ms | 61.00 MB | 61.0 | 52.11 ms / 1m | 186.03 ms |
| LiveTree / 1m | 378.93 ms | 60.99 MB | 61.0 | 52.83 ms / 1m | 0.033 ms |

In this same conservative harness the selected width retained about 32 MB less
per million entries than the former-width baseline. This is an empirical V8
result, not a guaranteed per-string saving; the issued ledger remains the
practical scaling constraint and a separate future optimization candidate.

Both ledgers contain only strings. LiveMap's hidden Set is exposed only through
`size`/`has`; LiveTree's Set also contains only validated strings. Neither
ledger retains nodes, handles, paths, DOM objects, CSS/resources, or provenance
records. Active lookup structures remain separate, so increasing I does not
change Q lookup complexity. Allocator membership checks use the same hash-set
behavior.

## E. Collision and retry model

Assumptions: independent uniform draws from `M=32^length`; occupancy is the
lifetime-issued/unavailable population; the checked owner rejects collisions.
Birthday probability uses a numerically stable log expansion of the exact
product. Expected pairs are `I(I-1)/(2M)`. First-candidate collision is `I/M`,
expected attempts are `1/(1-I/M)`, and 32-attempt exhaustion is `(I/M)^32`
with fixed occupancy. Pending/reserved values add to unavailable occupancy; at
ordinary scale their small count does not change displayed digits.

| Chars | Bits | Namespace |
|---:|---:|---:|
| 8 | 40 | 1,099,511,627,776 |
| 9 | 45 | 35,184,372,088,832 |
| 10 | 50 | 1,125,899,906,842,624 |
| 12 | 60 | 1,152,921,504,606,846,976 |
| 16 | 80 | 1,208,925,819,614,629,174,706,176 |

| Chars | I | P(any birthday collision) | Expected pairs | P(first retry) | Expected attempts | P(exhaust 32) |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 1k | 4.543e-7 | 4.543e-7 | 9.095e-10 | 1.00000000091 | 4.804e-290 |
| 8 | 100k | 4.537e-3 | 4.547e-3 | 9.095e-8 | 1.00000009095 | 4.804e-226 |
| 8 | 1m | 3.654e-1 | 4.547e-1 | 9.095e-7 | 1.00000090950 | 4.804e-194 |
| 8 | 10m | ~1.0 | 45.47 | 9.095e-6 | 1.00000909503 | 4.804e-162 |
| 9 | 1k | 1.420e-8 | 1.420e-8 | 2.842e-11 | 1.00000000003 | <4.94e-324 |
| 9 | 100k | 1.421e-4 | 1.421e-4 | 2.842e-9 | 1.00000000284 | 3.287e-274 |
| 9 | 1m | 1.411e-2 | 1.421e-2 | 2.842e-8 | 1.00000002842 | 3.287e-242 |
| 9 | 10m | 7.585e-1 | 1.421 | 2.842e-7 | 1.00000028422 | 3.287e-210 |
| 10 | 1k | 4.436e-10 | 4.436e-10 | 8.882e-13 | 1.00000000000 | <4.94e-324 |
| 10 | 100k | 4.441e-6 | 4.441e-6 | 8.882e-11 | 1.00000000009 | 2.273e-322 |
| 10 | 1m | 4.440e-4 | 4.441e-4 | 8.882e-10 | 1.00000000089 | 2.249e-290 |
| 10 | 10m | 4.344e-2 | 4.441e-2 | 8.882e-9 | 1.00000000888 | 2.249e-258 |
| 12 | 1k | 4.332e-13 | 4.332e-13 | 8.674e-16 | 1.00000000000 | <4.94e-324 |
| 12 | 100k | 4.337e-9 | 4.337e-9 | 8.674e-14 | 1.00000000000 | <4.94e-324 |
| 12 | 1m | 4.337e-7 | 4.337e-7 | 8.674e-13 | 1.00000000000 | <4.94e-324 |
| 12 | 10m | 4.337e-5 | 4.337e-5 | 8.674e-12 | 1.00000000001 | <4.94e-324 |
| 16 | 1k | 4.132e-19 | 4.132e-19 | 8.272e-22 | 1.00000000000 | <4.94e-324 |
| 16 | 100k | 4.136e-15 | 4.136e-15 | 8.272e-20 | 1.00000000000 | <4.94e-324 |
| 16 | 1m | 4.136e-13 | 4.136e-13 | 8.272e-19 | 1.00000000000 | <4.94e-324 |
| 16 | 10m | 4.136e-11 | 4.136e-11 | 8.272e-18 | 1.00000000000 | <4.94e-324 |

Geometric retry tails are `p`, `p^2`, and `p^3` for needing at least 2, 3,
and 4 attempts. For the worst displayed case (8 chars, I=10m), those are
`9.095e-6`, `8.272e-11`, and `7.523e-16`. Random collision is therefore an
ordinary detected retry. Undetected collision is prevented by complete atomic
owner admission. Exhaustion is not credible at measured populations.

Approximate populations at which the unchecked birthday probability first
reaches a threshold:

| Chars | 1e-6 | 1e-9 | 1e-12 | 1e-15 |
|---:|---:|---:|---:|---:|
| 8 | 1,484 | 48 | 3 | 2 |
| 9 | 8,390 | 266 | 9 | 2 |
| 10 | 47,454 | 1,502 | 48 | 3 |
| 12 | 1,518,502 | 48,020 | 1,520 | 49 |
| 16 | 1,554,944,646 | 49,171,656 | 1,554,945 | 49,173 |

These thresholds describe **unchecked sets**, not operational failure of the
current checked allocators.

## F. Issued-ledger cost and adversarial supply

The measured former-width planning figure was roughly 93 MB per million
retained items in this conservative harness; the Unit 13 production-ledger
rerun measured roughly 61 MB per million at 9 characters. A separate flat-string Set model
at one million entries measured 53.0 bytes/item for 8 characters and about
61.0 bytes/item for 9, 10, 12, and 16 characters. V8 allocation buckets erased the
difference among 9/10/12/16 in that model; 8 saved about 8 MB/million. These are
engine-specific measurements, not ABI guarantees. Shorter strings reduce raw
bytes but Set/hash/array overhead dominates in-memory savings.

A caller can deliberately supply any syntactically valid unused QUID. Once an
owner admits it, it reserves the value for the whole epoch/runtime; admitting
and retiring distinct supplied values grows I with Q small. This is bounded
only by normal graph/application admission authority and process resources.
Meaningfully increasing random retry probability requires occupying a material
fraction of the namespace: for 8 characters, even `I=10m` occupies only
`9.095e-6`. At the measured memory rate, memory or LiveMap copy time fails far
earlier than random allocation degrades.

This is resource pressure, not an identity-semantic reason to add limits or
change lifetimes. Rate limits, graph-size quotas, session rotation, and trusted
snapshot policy belong to LiveHost/application authority. Unit 12 adds none.

## G. Payload and persistence savings

The deterministic payload model uses 1,000 structural nodes and random-looking
QUIDs. Every shorter character saves exactly one raw byte per occurrence. The
table reports savings from 16 characters; percentages vary because surrounding
syntax remains fixed.

| Scenario (Q/1,000) | Candidate | Raw bytes saved | Canonical Hson | Structural JSON | Structural HTML | Snapshot/LiveHost |
|---|---:|---:|---:|---:|---:|---:|
| Sparse (10) | 8 | 80 | 1.54% | 0.27% | 1.10% | 0.27% |
|  | **9 selected** | 70 | 1.35% | 0.24% | 0.96% | 0.24% |
|  | 10 | 60 | 1.16% | 0.20% | 0.82% | 0.20% |
|  | 12 | 40 | 0.77% | 0.14% | 0.55% | 0.14% |
| Moderate (100) | 8 | 800 | 11.75% | 2.44% | 8.07% | 2.44% |
|  | **9 selected** | 700 | 10.28% | 2.14% | 7.06% | 2.14% |
|  | 10 | 600 | 8.81% | 1.83% | 6.05% | 1.83% |
|  | 12 | 400 | 5.88% | 1.22% | 4.04% | 1.22% |
| Identity-heavy (1,000) | 8 | 8,000 | 34.77% | 12.12% | 22.21% | 12.10% |
|  | **9 selected** | 7,000 | 30.43% | 10.60% | 19.44% | 10.59% |
|  | 10 | 6,000 | 26.08% | 9.09% | 16.66% | 9.08% |
|  | 12 | 4,000 | 17.39% | 6.06% | 11.11% | 6.05% |

Canonical readable Hson differs only in whitespace, so absolute savings are
the same and percentages slightly lower. Compact and canonical Hson are equal
for this fixture. Structural JSON represents the current explicit
`$_meta.quid` graph shape; snapshot/persistence and representative LiveHost
envelopes wrap that same graph, so their absolute savings are also identical.
Messages containing individual QUID targets save 8, 6, or 4 bytes per target.

Random-looking QUIDs remain poorly compressible, so shortening still mattered
after compression. Across the moderate fixture, 16→8 reduced gzip by 35–42%
and Brotli by 41–47% for the measured formats; 16→10 reduced gzip by 27–31%
and Brotli by 29–32%; 16→12 reduced both by roughly 18–22%. The selected 16→9
change saved 462 gzip / 465 Brotli bytes in moderate canonical Hson, 472 / 460
in structural JSON, and 458 / 464 in structural HTML. Sparse compressed
percentages look large because the absolute payload is tiny (for example,
canonical Hson gzip saved 56 bytes for 16→8). Compression is transport policy,
not part of QUID semantics.

Fresh durable captures serialize active canonical QUID metadata. They do not
serialize the retired issued ledger merely to extend non-reuse across a new
epoch. Fresh restore/install starts a new owner epoch and seeds I from admitted
active canonical claims; retired prior-epoch history disappears. Same-epoch
restore retains the living ledger. Standalone LiveTree has no equivalent
persistence mechanism: a fresh runtime may admit equal bytes. Shortening thus
changes snapshot size only in proportion to active persisted QUID occurrences,
not historical I.

## H. Fixed-length dependency inventory

### Historical Unit 12 semantic production inventory

- Before Unit 13, `src/core/hson-node-quid.ts` held the sole `16`, 80-bit comments, exact-length
  validator, 10-byte encoder contract, entropy buffer, and alphabet.
- `src/core/persisted-quid.ts`: compatibility re-export of that domain.
- Before Unit 13, `src/api/livetree/quid/data-quid.ts` held a descriptive 80-bit contract; it delegates
  generation/validation rather than duplicating length logic.
- Every parser, serializer, protocol decoder, LiveMap/LiveTree admission path,
  CSS manager, metadata registry, and target validator depends semantically on
  `is_persisted_quid`, but no second production fixed-length regex was found.
  They will change behavior automatically if that single validator changes and
  therefore require compatibility review, not blind edits.

### Formatting, protocol, persistence, and fixtures

- Hson `@quid`, structural HTML `hson:quid`, structural JSON
  `$_meta.quid`, canonical equality, DOM attributes/CSS selectors, graph
  content, view-state, LiveHost ensure/witness/target operations, bootstrap,
  history, checkpoint, recovery, snapshots, and persistence all preserve exact
  bytes. Their syntax has no separate width field, so old/new readability is a
  validator/version decision.
- Ten test files contain explicit length/entropy assertions or `{16}` regexes:
  `hson-node-quid`, `hson-node-quid-egress`, `hson-serializer`,
  `hson-tokenizer`, `livemap-document-identity-acquisition`,
  `livemap-linked-identity-closure`, `livemap-projected-identity-acquisition`,
  `livetree-quid-eligibility`, `livetree-quid-runtime-closure`, and certified
  corpus integrity.
- Exact 16-character fixture values occur across 80 repository test/corpus
  files. The affected families are canonical equality; Hson tokenizer,
  parser, serializer, tagged-template, JSON/HTML/attribute ingress/egress;
  transform worker/oracle; all LiveMap identity, overlay, capture, install,
  replay, request and staging cases; LiveTree eligibility/runtime/reuse cases;
  Reflection identity/snapshot/collision cases; LiveHost authority, protocol,
  snapshot, recovery and persistence probes; entrypoint declarations; and the
  certified authored corpus and its checked evidence. These are fixture-only
  unless listed above as an explicit semantic assertion.
- Documentation dependencies are `docs/transform/api-transform.md`,
  `docs/contracts/livemap-identity.md`, the prior scope/encoding and path
  authority audits, plus this proof. Canonical-digest and certified-corpus
  artifacts may change if fixture bytes are migrated and must be regenerated
  only through their owned process.
- `hson-demo2` has no independent validator. Meaningful formatting/fixture
  dependencies occur in its QUID-selector and sanitizer fixtures/specs,
  Hson metadata helpers/oracle, LiveMap proxy tests, LiveTree suites, unit
  suites, pointer demo, hosted-test display, and downstream metadata doc.
  Large HTML fixtures containing `hson:quid` must be reviewed as fixture data.
  CSS selectors are width-agnostic string interpolation, but expected literal
  values will migrate if generated fixtures change.
- No public declaration contains a nominal fixed-length string type; QUIDs are
  typed as strings. Declaration compatibility is behavioral/serialized, not a
  TypeScript shape change.

## I. Public API / format decisions required for Unit 13

### Resolved Unit 13 decision: legacy 16-character admission

1. **Current contract:** all generated and supplied QUIDs share one exact
   16-character validator domain across Hson, HTML, JSON, DOM, LiveMap,
   LiveTree, LiveHost, snapshots, and persistence.
2. **Approved change:** generate and accept only the 9-character current form.
3. **Rationale:** preserves old documents/snapshots/protocol payloads while
   gaining savings for newly generated identity.
4. **Alternatives:** hard break to one shorter domain; versioned decode/migrate
   followed by strict current encoding; keep 16 indefinitely.
5. **Implications:** a multi-length window means generated and supplied domains
   are no longer identical unless the generator is described as drawing from a
   strict subset. Collision arithmetic and canonical equality remain byte based;
   old and new strings coexist safely but fixtures and validation claims change.
6. **Resolution:** hard break approved; no compatibility window or migration.

### Resolved Unit 13 decision: persisted and protocol readability

1. **Current contract:** old snapshots, checkpoints, Hson/HTML/JSON graphs,
   LiveHost messages, and retained history are readable only because one
   unversioned 16-character domain governs node claims and QUID targets.
2. **Approved change:** strict 9-character decode and a hard format break.
3. **Rationale:** a strict shorter validator makes old persisted state
   unreadable; accepting old claims but not old target operations is internally
   inconsistent.
4. **Alternatives:** keep 16 for persisted identities while shortening only a
   separately named runtime identity (out of scope here); compatibility decode;
   offline migration; hard reset.
5. **Implications:** migrations must translate metadata, QUID targets,
   witnesses, history and fingerprints together. No partial rekey is safe.
6. **Resolution:** old 16-character state rejects at the ordinary validation
   boundary; no shim or automatic rewrite exists.

## J. Recommendation matrix

| Length | Collision safety | Retry / 32-attempt safety | Payload benefit | Measured memory benefit | Compatibility complexity | Recommendation |
|---:|---|---|---|---|---|---|
| 8 | Safe with complete checked ledger; unchecked million-item sets collide often | Excellent through 10m; `4.8e-162` exhaustion at 10m | Maximum: 8 bytes/occurrence | Best measured bucket: ~8 MB/million vs 10–16 | Highest perceived margin/transition concern, same migration mechanics | Mathematically safe and viable; choose only with explicit reliance on checked admission |
| **9** | **Safe with complete checked ledger; selected 45-bit namespace** | **Expected 1.000000284 attempts and `3.3e-210` exhaustion at 10m** | **7 bytes/occurrence** | **Same measured V8 bucket as 10–16** | **Approved hard break** | **Selected and implemented by Unit 13** |
| 10 | Strong accidental/independent-set margin; 0.0444% birthday at 1m | Effectively one attempt; exhaustion negligible | 6 bytes/occurrence | No gain vs 12/16 in one V8 flat-string bucket; raw storage still smaller | Same format migration as 8 | Preferred operationally conservative tradeoff |
| 12 | Extremely conservative; 4.34e-7 birthday at 1m | Effectively one attempt | 4 bytes/occurrence | No measurable bucket gain in this runtime | Same migration for less benefit | Safe conservative fallback |
| 16 | Vastly overprovisioned | Effectively one attempt | None | Baseline | No compatibility work | Keep only if avoiding migration outweighs all size benefit |

Namespace safety alone did not distinguish these candidates because the ledger
turns collision into retry. Unit 13 approved 9 characters and accepted the
hard-break compatibility cost.

## K. Unit 13 readiness

If shortening is explicitly approved, Unit 13 must:

1. choose the compatibility policy first: hard break, dual-length window, or
   versioned decode/migration; define whether generated and supplied domains
   remain identical;
2. change the byte count/encoder, `PERSISTED_QUID_LENGTH`, comments and
   validator together while retaining the same alphabet and secure uniform
   source;
3. keep both owner allocators, 32 retries, issued ledgers, pending/reserved
   checks, atomic preflight, lifetime boundaries, provenance, and error
   distinctions unchanged;
4. update Hson/HTML/JSON ingress and egress expectations, DOM metadata and CSS
   selector fixtures, canonical equality vectors, parser/serializer snapshots,
   public transform documentation, and declarations/entrypoint assertions;
5. migrate or compatibly decode snapshots, LiveHost graph content, target and
   witness operations, bootstrap/history/checkpoints/persistence, and protocol
   tests as one format change;
6. update LiveMap, standalone LiveTree, linked Reflection collision and
   registration suites without changing authority or minting behavior;
7. migrate the 80 repository fixture/corpus files and the enumerated
   `hson-demo2` demos/tests, regenerate owned catalogs/fingerprints only after
   their actual bytes change, and rerun full Node/Worker integrated accounting;
8. document the selected risk posture and legacy retirement window.

Unit 13 implements the selected row. The generator and validator emit and
accept only the current 9-character representation; legacy 16-character input
is outside the canonical domain.

## Validation record

- Proof harness: namespace/retry model and raw/gzip/Brotli payload model passed;
  QUID-free 100k and 1m graphs passed three fresh-process runs each; LiveMap and
  LiveTree ledger sizes 1k/10k/100k/1m passed three runs each; sparse overlay
  Q=10/100/1k/10k over 100k-node graphs passed three runs each; candidate
  flat-string memory at 1m passed three runs for 8/9/10/12/16 characters.
- Identity-focused validation: 40 launchers, 791/791 checks. This includes the
  Unit 12P/12T issued/reuse/ABA/provenance suites, LiveMap capture and overlay
  suites, standalone LiveTree lifetime suites, and linked Reflection
  registration/collision/no-mint suites.
- `npm run check`: source and test TypeScript checks passed.
- `npm run build`: passed.
- `npm run check:entrypoints`: public declarations and all configured public,
  worker, Node, LiveMap, LiveHost, and LiveTree entrypoints passed.
- `git diff --check`: passed.
- Full integrated verification: 4,998/4,998 passed, 105 external launchers,
  zero failed canonical cases and zero failed external suites. The first
  integrated attempt hit an unrelated timing-sensitive
  `livehost/circuit-worker-service` cancellation assertion; one clean rerun
  passed the complete baseline. No new integrated total is claimed.
