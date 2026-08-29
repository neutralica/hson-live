// this audit reflects the current state of the human-reviewed/authored corpus step. this is not a TODO; this is where we were as of 01AUG2026. Do not use it as a goal.

> Historical snapshot: the detailed provenance accounting below applies to the
> original 339-descriptor candidate. The targeted completeness amendment adds
> 27 explicitly attributed cases, producing 366 descriptors and 269 authored
> sources. New-case provenance, novelty, and review priority are materialized in
> `authored-completeness-basis.mts` and the regenerated review artifact; the
> broad pre-amendment audit has not been silently reclassified.
>
> Current delimiter amendment: the active corpus uses single-quoted names and
> has 370 descriptors / 273 authored sources. The immutable provenance audit
> and human worksheet retain their historical backtick-name IDs. Current IDs
> and their historical mappings are recorded in
> `02-authored-source-verdict-ledger.json` and
> `05-quoted-name-delimiter-amendment.md`.

## Executive conclusion

The 339-descriptor materialized authored-Hson conformance corpus candidate is mechanically complete and reviewable, but it is not yet sufficiently independent for human certification.

The decisive finding is that 175 descriptors are primarily implementation-derived. Production behavior influenced exact serializer output or rejection evidence before those expectations were materialized. This does not make the cases wrong; it means green execution cannot independently validate those expectations.

The deterministic, per-case audit is here:

[authored-hson-corpus-provenance-audit.txt](/Users/philliphanson/.codex/visualizations/2026/08/01/019fbda0-fa75-71c3-9abc-97f3b395b8d8/authored-hson-corpus-provenance-audit.txt)

- 339 records, all unique
- 6,412 lines
- SHA-256: `41b2d0ba4f539eae8d12fb4ccafaafba2aa6cf69427ceba3b9ca4b2163111b09`
- Two regenerations were byte-identical
- Its high/critical index lists every one of the 264 corresponding case IDs

## Exact provenance counts

### Primary input origin

| Classification | Count |
|---|---:|
| `existing-exact` | 59 |
| `existing-adapted` | 17 |
| `specification-transcription` | 0 |
| `transparent-family-expansion` | 41 |
| `new-boundary-case` | 47 |
| `implementation-derived` | 175 |
| `unknown` | 0 |
| **Total** | **339** |

The primary classification gives implementation-derived provenance precedence. Looking solely at raw predecessors:

| Raw input relationship | Count |
|---|---:|
| Exact pre-existing fixture input | 121 |
| Adapted pre-existing input | 40 |
| Newly created source/graph | 178 |
| **Total** | **339** |

The 175 implementation-derived cases comprise 62 exact predecessors, 23 adapted predecessors, and 90 newly created inputs.

### Expected graphs

Applicable population: 151 accepted descriptors.

| Origin | Count |
|---|---:|
| Exact existing graph object | 6 |
| Mechanically adapted/re-expressed existing expectation | 53 |
| Production-checked during drafting, with independent cross-support | 3 |
| Newly reasoned by Codex | 89 |
| Explicit specification graph literal | 0 |
| Invariant-calibrated | 0 |
| Solely production-derived | 0 documented |
| Unknown | 0 |
| **Total** | **151** |

Therefore six expected graphs existed exactly beforehand. The other 145 were materialized by Codex; three of those were explicitly checked against production parsing during drafting:

- `hson.accept.literal.primitive.true`
- `hson.accept.literal.object.empty-decoded-key`
- `hson.accept.literal.array.trailing-comma-bracket`

No evidence was found of a graph being repeatedly reshaped merely until invariant admission accepted it.

### Exact outputs

Applicable population: 169 Hson/JSON/HTML output fields.

| Origin | Count |
|---|---:|
| Copied pre-existing expected literal | 32 |
| Production serializer output printed and retained | 19 |
| Newly written by Codex from the specification | 118 |
| Otherwise calibrated/generated/unknown | 0 |
| **Total** | **169** |

There is also one newly written diagnostic witness output.

The 19 production-retained Hson outputs are:

- Eight object cases: one property, multiple properties, nested, array value, typed keywords, colon/dot names, empty decoded key, and comments.
- Five array cases: primitives, bracket trailing comma, nested, object item, and negative zero.
- Six element cases: nested, keyword flags, adjacent strings, three empty strings, QUID, and mixed content.

The exact literals are visible in [authored-accepted.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/authored-accepted.mts:34).

### Rejection evidence

Applicable population: 178 rejected descriptors.

| Field | Provenance |
|---|---|
| Operation | 16 settled, 6 copied, 156 observed |
| Stage | 16 settled, 6 copied, 149 observed, 7 absent |
| Code | 16 settled, 6 copied, 154 observed, 2 calibrated |
| Coordinates | 6 copied authored-Hson, 3 copied JSON, 4 inferred adapted JSON, 146 observed, 2 calibrated; 17 absent |
| Path | 3 copied, 4 inferred; 171 absent |
| Related evidence | 5 copied, 4 inferred, 1 observed; 168 absent |

The seven direct HTML typed-value rejections retain only operation and code; omitted stage/source/path/related fields are optional under the current contract, but the omission weakens their evidentiary independence. Their declarations are at [html-transports.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/html-transports.mts:102).

## Calibration findings

The two explicitly calibrated descriptors are:

1. `hson.reject.family.quoted-name.unicode-interrupted-apostrophe`

   Historical ID: `hson.reject.family.backtick-name.unicode-interrupted-backtick`.

   - Proposed: `invalid-name-escape`, index 2, line 1, column 3.
   - Observed: `HSON_NAME_UNTERMINATED`, index 8, line 1, column 9.
   - Final: observed evidence retained.

2. `hson.reject.family.quoted-name.trailing-backslash`

   Historical ID: `hson.reject.family.backtick-name.trailing-backslash`.

   - Proposed: `HSON_NAME_UNTERMINATED`, index 1, line 1, column 2.
   - Observed after corpus failure: `invalid-name-escape`, index 6, line 1, column 7.
   - Final: observed evidence retained.

The settled language contract requires both spellings to reject, but does not choose these diagnostic codes or coordinates. Neither diagnostic expectation is independently authoritative yet. A human must ratify tokenizer diagnostic precedence and the coordinate owner. The retained declarations appear at [authored-families.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/authored-families.mts:145).

## All implementation-derived cases

The complete 175-case list is in the external audit. It can also be defined exactly as:

- All 117 `hson.reject.family.*` descriptors.
- All 37 `hson.reject.literal.*` descriptors except these six independently structured predecessors:

  - `hson.reject.literal.source.empty`
  - `hson.reject.literal.root.multiple-values`
  - `hson.reject.literal.root.mixed-modes`
  - `hson.reject.literal.object.duplicate`
  - `hson.reject.literal.element.duplicate-attribute`
  - `hson.reject.literal.object.legacy-doubled`

- All eight `html.reject.*` descriptors.
- The 19 accepted cases whose canonical Hson output was printed from production and retained, enumerated above.

The production probing included every literal rejection and all malformed/raw-control family sources before their expected evidence was finalized. Consequently, literal storage in [authored-rejected.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/authored-rejected.mts:35) does not establish independent authorship.

## Novelty

Among the 47 primary `new-boundary-case` descriptors:

| Distinct contribution | Count |
|---|---:|
| Genuinely new independently established semantic/rejection boundary | 0 |
| New container replay | 3 |
| New transport route | 33 |
| New exact output expectation | 7 |
| New diagnostic-evidence expectation | 4 |
| Duplicate-only/unclear novelty | 0 |
| **Total** | **47** |

Some implementation-derived cases add valuable semantic coverage, but that coverage is not counted as independently established novelty until its expectations are human-ratified.

## Human-review priority

| Priority | Count |
|---|---:|
| Low | 34 |
| Medium | 41 |
| High | 85 |
| Critical | 179 |
| **Total** | **339** |

Critical comprises all 175 implementation-derived cases plus four diagnostic-circuit cases. High covers newly reasoned, contract-sensitive graph/output cases. Every high and critical ID is listed individually in the external audit’s `HIGH-AND-CRITICAL INDEX`.

## Existing-fixture migration map

These are non-exclusive correspondence scopes: a case may relate to more than one earlier suite. Specialized references remain cross-reference-only ownership.

| Earlier surface | Exact | Adapted | Cross-reference only | New corpus-owned |
|---|---:|---:|---:|---:|
| Tokenizer/authored input | 93 | 17 | 2 | 132 |
| Serializer/accepted Hson and graph | 37 | 17 | 1 | 45 |
| Root-boundary | 31 | 10 | 1 | 5 |
| Structural-mode | 9 | 13 | 1 | 2 |
| JSON ingress | 9 | 4 | 2 | 1 |
| HTML transport | 3 | 7 | 1 | 39 |
| Transform oracle | 0 | 0 | 1 | 4 |
| `hson-demo2` authored fixtures | 7 | 4 | 1 | 0 |
| Legacy HTML/JSON | 0 | 0 | 1 | 0 |
| Documentation examples | 6 | 0 | 0 | 0 |
| Supplied specification/checkpoint | 0 concrete exact | 0 | 10 mandated references | 178 new exact sources/graphs |

The Wikipedia fixture remains cross-reference-only legacy ownership and was not absorbed into the candidate. Specialized references are declared in [diagnostic-and-references.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/diagnostic-and-references.mts:48).

## Assertion and family provenance

The reported 2,637 atomic assertions are weighted accounting, not 2,637 independently authored claims:

- Accepted assertions: 1,011
- Rejected assertions: 1,602, calculated as `178 × 9`
- Integrity assertions: 24

The formulas are explicit in [corpus-manifest.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/corpus-manifest.mts:63).

There are 49 accepted family cases across two families and 117 rejected family cases across five families. The descriptors are statically materialized, but many are created through `.map()` or `Array.from()`. The rejected evidence is inherited through `tokenError()` and was checked against production for every concrete source. Integrity checks prove the absence of callback-driven runtime fixtures; they do not prove historical independence. See [corpus-integrity.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/corpus-integrity.mts:49).

## Graph-helper and review-artifact assessment

The graph helpers make semantic decisions:

- `property()` inserts an `_hson_obj` scalar relationship.
- `arr()` constructs indexed `_hson_ii` nodes.
- `element()` decides attribute/meta presence and inserts `_hson_elem` only for nonempty content.

See [graph-expectations.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/graph-expectations.mts:19).

A reviewer does not need to execute these helpers because the committed review artifact materializes complete graph objects. Nevertheless, that artifact is insufficient for certification because it:

- labels graphs “hand-authored” despite helper construction and production-assisted drafting;
- contains no predecessor link or primary provenance classification;
- omits production-probe history and calibration;
- contains no author/reviewer/sign-off field;
- cannot distinguish independent expectation from current-behavior capture.

Its renderer is at [corpus-review.mts](/Users/philliphanson/Documents/Design/web/hson/hson-live/tests/certified-corpus/corpus-review.mts:45). The external provenance artifact supplies the missing audit layer.

## Minimum human-certification workflow

1. Freeze the candidate commit and fingerprints.
2. Review all 179 critical cases first. For runtime-derived diagnostics and outputs, derive the intended result from the settled contract or explicitly ratify current behavior.
3. Review all 85 high cases independently, comparing complete graphs and exact output code units.
4. Review the 41 medium family cases at both family-definition and concrete-boundary levels.
5. Confirm the 34 low cases against their exact predecessor fixtures.
6. Record reviewer identity, decision, provenance, and rationale per descriptor.
7. Resolve the two malformed-backtick diagnostic choices explicitly.
8. Regenerate the semantic and provenance artifacts, then run the candidate and specialized suites.
9. Only after sign-off should the project describe the corpus as human-reviewed or certified.

## Repository state

This audit created or modified no repository file and did not interfere with the incoming test-side refactor.

Final status observed:

- `hson-live`: only the pre-existing untracked `docs/contracts/canonical-hson-digests-v1-design.md`
- `hson-demo2`: clean

No tests were run because this was a read-only provenance audit, not a behavioral validation unit.
