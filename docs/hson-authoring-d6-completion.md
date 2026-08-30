# Hson authoring D6 completion report

Implemented and verified on 2026-08-28. No commit made.

## 1. Files changed

Shared private authority hooks:

```text
src/api/transform/parsers/tokenize-hson.ts
src/internal/hson-source-provenance/hson-source-provenance.ts
src/api/livemap/livemap.schema.ts
src/api/livemap/livemap.document.schema.ts
```

Private completion and trusted transport:

```text
src/internal/schema-completion/context.ts (new)
src/internal/schema-completion/query.ts (new)
src/internal/trusted-schema-diagnostics/protocol.ts
src/internal/trusted-schema-diagnostics/runtime.ts
src/internal/trusted-schema-diagnostics/README.md
```

Editor:

```text
editors/vscode-hson/src/completion-source.ts (new)
editors/vscode-hson/src/trusted-schema-client.ts
editors/vscode-hson/src/extension.ts
editors/vscode-hson/tests/integration/run.mjs
editors/vscode-hson/tests/integration/suite.ts
editors/vscode-hson/README.md
```

Tests, inventory, report:

```text
tests/hson-completion-context.acceptance.mts (new)
tests/schema-projected-completion.acceptance.mts (new)
tests/schema-document-completion.acceptance.mts (new)
tests/schema-editor-completion.acceptance.mts (new)
tests/schema-completion-performance.acceptance.mts (new)
tests/fixtures/schema-d6-schemas.fixture.mts (new)
tests/fixtures/schema-d6-runtime.fixture.mts (new)
tests/hson-authoring-package.acceptance.mjs
src/_tests/test-launchers.ts
package.json
docs/hson-authoring-d6-completion.md (new)
```

## 2. Cursor-context architecture

The existing tokenizer reports private grammar slots through its optional lexical
collector. Its existing angle-closer classification still decides object versus
element grammar. A request-local stop token captures one slot. Exactly one legal
probe is inserted into an analysis copy, parsed by `parse_hson_with_provenance`,
and resolved through existing data/document logical location authorities.
The probe is identified by exact provenance ranges, not its text. Its generated
name exceeds the entire source length, making collision with an authored decoded
name impossible. The probe and parsed copy are discarded after the query.

The private contexts distinguish member, value, tag, header, child, and attr-value
slots. A header can truthfully admit attrs/flags and a first child; later authored
attrs prevent a child insertion there. Logical paths, existing names, replacement
ranges, opaque substitutions and child counts come from parsed evidence.

## 3. No second tolerant parser

None added. No editor-side AST, grammar imitation, candidate-by-candidate parsing,
or invented closer repair. Invalid surroundings that the one probe cannot repair
return no completion. Normal syntax diagnostics are unchanged.

## 4. Trusted Schema authority

The actual registered Schema object is queried inside the existing supervised
runtime. Data nodes come from the existing defined-Schema WeakMap; document
nodes come from the existing document capability registry. Document attr rules
now retain their already-compiled value node beside the existing validator.

The private runtime advertises `completionVersion: 1`. Completion requires both
trust gates, that capability, an already-loaded current generation, and one
unambiguous D2/D3 source contract. It never starts, restarts or loads the provider.
IPC transports only request evidence and small completion items, never raw Schema
objects, IR or functions. Cancellation, supersession, source versions, provider
retirement and lifecycle currency guard publication.

## 5. Recurse

Traversal uses the existing memoized runtime recurse thunk, only along queried
paths. Listing object members does not eagerly resolve their recursive values.
Completion has an independent cycle guard, 64-level bound and 512-expansion
budget. D1 timeout/process retirement still supervises arbitrary recurse code.

## 6. Constraints

No constraint predicate is invoked by completion, even for filtering. Underlying
declarative structure and finite literals remain available; descriptions remind
authors that constraints still validate. No inverse constraint interpretation or
candidate search is performed.

## 7. Data members

Declared names, requiredness and optionality come from compiled props. Existing
members are excluded using parsed ordered-object entries. Exact/open objects both
offer known declarations; open-object detail explicitly avoids exclusivity.

## 8. Literals

Finite literal/pick alternatives, booleans and null are supported. Existing Hson
serialization preserves negative zero, string escapes and ordered structured
values. Structured values use compact canonical spelling. Broad string/number
Schemas produce no fabricated defaults. Template delimiter characters in
serialized strings/names use equivalent Hson Unicode escapes so insertion cannot
accidentally create JavaScript interpolation or close the template.

## 9. Arrays and tuples

Proven logical item indexes select array-item or tuple-position nodes. Optional
suffix positions work; closed tuples reject positions or insertions beyond their
length. No comma means no guessed array append.

## 10. Tagged/pick behavior

Literal evidence may eliminate incompatible data object branches. A missing
discriminator yields common declared names and finite discriminator alternatives,
not a closest branch. Branch-specific names appear after unambiguous literal
evidence. Opaque interpolation values and the analysis probe never select a
branch. Ambiguous document content-pick sequences remain unsupported.

## 11. Document tags

Fixed/runtime-computed tags and document item-pick alternatives are supported at
proven tag/child slots. Broad arbitrary tags do not enumerate HTML/SVG. Same-tag
alternatives offer the common tag without guessing branch-specific attrs/content;
their nested completion remains unavailable until unambiguous.

## 12. Attributes and flags

Actual attr declarations, required/optional status and separate flag evidence
drive suggestions and duplicate filtering. Required flags insert their complete
name. Ordinary attrs never become flags merely because their Schema is boolean.
Finite string attr values are offered. Authored ordinary attrs preserve strings,
so typed boolean/null/number attr contracts do not acquire fictitious authored
spellings; those richer runtime attr values remain outside this source subset.

## 13. Document content

Document tuple positions, repeats and counted repeats use logical
child indexes/counts. Empty and broad omitted content provide no invented child
choices. Traversal handles preceding text and nested elements. Unconstrained text
does not generate prose; the existing document text node exposes no finite text
literal declaration to enumerate. Skeletons are shallow and preserve required
attrs/flags with placeholders, never recursive document synthesis.

## 14. Interpolated Hson

Literal segments can complete without runtime values when provenance proves each
unknown substitution is a complete data scalar or document attr-value slot.
Those substitutions remain opaque, not assumed nulls. Other contexts require
current D5 capture evidence. Fresh discriminator captures select the actual
branch; stale captures cannot select the old branch. Repeated evaluations fail
closed. Exact capture identity is checked before and after the runtime query.
JavaScript `${...}` expressions receive no Hson completion.

## 15. Explicit fromHson exclusion

Ordinary `fromHson("...")` and untagged template arguments receive no D6 Schema
completion, including proven D4 lifecycle relationships. D4 diagnostics continue.
Documentation directs rich interactive authoring to `Hson`.

## 16. Multiple Schemas

More than one discovered governing contract returns ambiguous/unavailable. No
first/last selection and no approximate union/intersection of contracts. Existing
diagnostics still validate independent contracts separately.

## 17. Insertion/snippets

Unknown values use blank snippet placeholders. A singleton declarative literal
may be inserted directly. Existing name replacements preserve their existing
value/body. Required attr/flag skeleton content is shallow. Hson name/literal
serialization, host-template escaping, snippet escaping and necessary sibling
separators are handled separately. No default `0`, empty string, false or null
is inserted merely to make a primitive type fit.

## 18. Triggers

Real VS Code `CompletionItemProvider`, manual invocation only; no punctuation
triggers registered. TypeScript retains expression completion ownership.

## 19. Ordering/filtering

Sort keys put required declarations first, optional declarations next, and finite
values/tags afterward, preserving Schema order within each group. Existing
members/attrs are filtered by parsed structure, never text search. Repeated
children are not mistaken for duplicate members.

## 20. Incomplete source

Supported examples include `< |>`, `<role |>`, `[true, |]`, `<div id=|/>`,
`<div < |/>/>`, tag/name replacement, and child gaps after text or elements (`|`
denotes the cursor). This is not arbitrary error recovery: missing surrounding
closers, missing array separators, duplicate declarations, unsupported partial
tokens, comments, and broken structural modes may yield no completion.
Analysis never changes the editor document, runtime map, application graph,
Schema definitions or history. Source analysis is bounded at 128,000 UTF-16 units.

## 21. New suites and counts

| Package script | Checks |
| --- | ---: |
| `test:hson-completion-context` | 25 |
| `test:schema-projected-completion` | 26 |
| `test:schema-document-completion` | 26 |
| `test:schema-editor-completion` | 29 |
| `test:schema-completion-performance` | 6 |

106 focused behavioral checks plus 6 measured scenarios passed. The editor suite
includes actual supervised D2, D3 and fresh/stale/repeated D5 cases. Suites are
registered coherently in the existing launcher inventory.

## 22. Real VS Code integration

Passed with VS Code 1.95.3, both trusted and Restricted Mode extension hosts.
Mechanically exercised manual member completion, snippets and ordering, finite
literals, attrs/flags, child/tag choices, incomplete edits, source-update
filtering, expression exclusion, explicit disablement, Restricted Mode absence,
and natural `map.schema.use` completion without `Hson.certify`. A real recurse
thunk signaled entry and paused; retiring its runtime while the request was
pending prevented old completion publication. D2–D5 journeys also passed.

The first development run exposed a missing new fixture binding; that fixture
was corrected, then the journeys passed repeatedly. VS Code emitted unrelated
chat-registry fetch, font, watcher and shutdown logging; test exits were zero.

## 23. Performance

Warm p50 milliseconds, 12 requests per scenario (first two excluded from p50).
These are measurements, not a microsecond SLA.

| Scenario | Slot/probe | Parse/provenance | Logical resolve | Schema query | IPC ping | Full client request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| data members | 0.017 | 0.148 | 0.029 | 0.020 | 0.039 | 1.627 |
| Finite literal | 0.019 | 0.039 | 0.008 | 0.022 | 0.029 | 1.134 |
| Document attrs | 0.015 | 0.045 | 0.038 | 0.036 | 0.030 | 1.143 |
| Document child/tag | 0.017 | 0.047 | 0.040 | 0.019 | 0.036 | 0.968 |
| Nested recurse | 0.031 | 0.087 | 0.020 | 0.018 | 0.035 | 1.069 |
| 180-member template | 0.251 | 1.178 | 0.715 | 0.014 | 0.046 | 3.340 |

Client request timing includes association disposal; component medians need not
sum. Source discovery p50 was 0.676–1.131 ms and association/query round-trip p50
was 0.202–2.449 ms. No warmed request approached seconds.

Actual VS Code completion commands: 6 successful measured requests, p50 6.796 ms,
max 24.421 ms. Actual VS Code item construction from its output log: p50 0.01275 ms,
max 0.03542 ms. The deliberately delayed retirement case is a safety test, not a
normal warmed timing sample. The D5 production-tag benchmark also remained in
its prior roughly 0.009 ms range.

## 24. Narrow production Hson bundle

The production `/hson` probe passed all 10 checks. It retains 51 modules, exactly
as before, and parses/retains no completion query, editor, provider, protocol,
lifecycle or interpolation-capture machinery. The pre-existing issue-presentation
sidecar remains the sole trusted-diagnostics-family dependency.

Minified tag bundle: 99,683 bytes; gzip: 27,550 bytes. Against the recorded D5
baseline (98,973 / 27,387), the shared optional tokenizer hooks and attr-node
reference add 710 minified / 163 gzip bytes. No D6 runtime/provider machinery
retention. Existing package thresholds and production execution pass.

## 25. Regression commands/results

Passed:

```text
npm run check:source
npm run check:tests
npm run build
npm run check:entrypoints
npm run test:hson-authoring-package
npm run test:diagnostics-inventory
npm run test:public-boundaries
npm run test:root-compatibility
npm run test:hson-root-boundary
```

Each of these package suites was also run and passed:

```text
test:trusted-schema-d1
test:schema-d2-discovery
test:schema-d2-runtime
test:schema-d2-editor
test:schema-d2-presentation
test:schema-d3-discovery
test:schema-d3-runtime
test:schema-d3-editor
test:schema-d4-editor
test:schema-d4-performance
test:hson-d5-mapping
test:trusted-d5-capture
test:schema-d5-editor
test:schema-d5-performance
test:hson-source-provenance-core
test:hson-source-provenance-parser
test:hson-source-provenance-boundary
test:livemap-projected-schema-source-lowering
test:livemap-document-schema-source-lowering
test:hson-tokenizer
test:hson-tagged-template
test:hson-authoring-discovery
test:hson-tagged-template-discovery
test:embedded-hson-diagnostic-mapping
test:from-hson-static-discovery
test:static-hson-js-literal-mapping
test:hson-structural-mode
test:hson-quoted-name-acceptance
test:hson-quoted-name-rejection
test:livemap-schema-vocabulary
test:livemap-schema-composition
test:livemap-schema-owner-contract
test:livemap-document-schema-construction
test:livemap-document-attrs-schema
test:livemap-schema-counted-repeat
test:livemap-schema-empty
test:schema-hson-graph
test:schema-hson-public
```

Plus all five new suites in section 21. The editor's `check`, `build`,
`test:grammar`, `test:unit` (32 checks), `benchmark`, and real `test:integration`
passed. Inventory reports 169 package test scripts and 161 registered launchers.
An intermediate inventory run caught a not-yet-rebuilt `dist`; rebuilding restored
exact source/built inventory agreement. `git diff --check` passed. No unrelated
hosted certification, clean-install certification, CI work or packaging repair.

## 26. Public API

No package export, public Schema/Hson method, public cursor/completion API,
certificate type or subpath added. The Schema node accessor/type are private
module exports only, absent from public barrels. Root compatibility still checks
109 runtime exports. LiveTree prototypes, identity and packaging were untouched.

## 27. Git/worktree

Started clean. Changes are limited to the 26 files listed above; new files remain
untracked until the user stages them. No commit, staging, reset or application
source mutation. Generated ignored library/editor builds were refreshed by the
requested verification commands.

## 28. Recommended next finishing phase

The deferred diagnostic message-bank/editorial pass. Keep presentation colors,
mutable-let warnings, code actions, CI/distribution certification and LiveTree
packaging work separate; none was folded into D6.

## 29. Suggested commit

`feat(authoring): add bounded trusted Hson Schema completion`

Suggestion only; nothing committed.
