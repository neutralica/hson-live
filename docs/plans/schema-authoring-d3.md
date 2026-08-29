> Updated for uppercase `Hson` authoring. Measurements and command results below
> describe the original D3 run; current migration verification is recorded in
> [the authoring migration report](hson-authoring-migration.md).

# Schema authoring D3 — completion report

D3 adds natural LiveMap association without changing the public API or requiring
an extra `schema.validate` call. Like D1, this is trusted-provider tooling:
**source-bound runtime lifecycle captures are required**. Schema-only registration
or an old unbound D1 capture does not prove an arbitrary map relationship.
The editor never automatically imports application files to obtain evidence.

## 1. Files changed

24 files: 15 modified, 9 added. Generated build outputs remain ignored.

Modified:

```text
docs/livemap/schema.md
editors/vscode-hson/README.md
editors/vscode-hson/src/schema-presentation.ts
editors/vscode-hson/src/trusted-schema-client.ts
editors/vscode-hson/tests/integration/run.mjs
editors/vscode-hson/tests/integration/suite.ts
package.json
src/_tests/test-launchers.ts
src/internal/embedded-hson/discover-hson-tagged-templates.ts
src/internal/trusted-schema-diagnostics/README.md
src/internal/trusted-schema-diagnostics/discover-validation-sources.ts
src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts
src/internal/trusted-schema-diagnostics/protocol.ts
src/internal/trusted-schema-diagnostics/runtime.ts
src/internal/trusted-schema-diagnostics/source-binding.ts
```

Added:

```text
docs/plans/schema-authoring-d3.md
src/internal/trusted-schema-diagnostics/instrument-map-sources.ts
src/internal/trusted-schema-diagnostics/source-lifecycle.ts
tests/fixtures/schema-d3-cases.mts
tests/fixtures/schema-d3-runtime.fixture.mts
tests/fixtures/schema-d3-schemas.fixture.mts
tests/schema-d3-discovery.acceptance.mts
tests/schema-d3-runtime.acceptance.mts
tests/schema-d3-editor.acceptance.mts
```

## 2. Static flow forms

Direct local `const` source → local `const` map → standalone `schema.use`,
harmless parentheses, canonical aliases, map aliases, Schema aliases, and inline
substitution-free templates. Relationships stay in one module/function body.
Conditional/expression/return attachment flows, mutable bindings, helper-returned
values, properties/collections, transformations, round trips and interpolations
remain unavailable. Mutations between supported sites are executed by the
trusted diagnostic copy; their safety is never inferred from source shape.

## 3. Official facade identities

Compiler import symbols recognize `Hson` from `hson-live` and `hson-live/hson`,
aggregate `hson` from the root, and `hsonLiveMap` from the root and
`hson-live/livemap`, including renamed imports. Constructor and tag runtime
identities are also checked. `/hson` no longer exports aggregate/subsystem facades.
Wrong packages, local lookalikes, shadowing, namespace imports and extracted
methods do not acquire authority. Dedicated-facade standalone `validate` discovery
uses the same recognition machinery.

## 4. Canonical alias tracing

Reuses D2's bounded, cycle-checked, immutable identifier-only declaration tracing:
32 hops, declaration before use, same statement domain, parentheses stripped.
No canonical value search or equality-based provenance recovery.

## 5. Map alias tracing

The same bounded declaration rules trace immutable map aliases to the specific
official `fromHson` call. Runtime lookup uses the actual map object in a WeakMap.

## 6. Schema alias/import tracing

D2's resolver is reused unchanged for relative named imports, renamed imports,
local immutable bindings and aliases. D1's verified registrations must resolve
the attempted object unambiguously. There is no second Schema resolver,
automatic `schema.define` registration, structural compatibility inference or
handle-name matching.

## 7. Inline disposition

Supported: `const map = hsonLiveMap.fromHson(Hson\`...\`);` followed by
`map.schema.use(Schema)`. It uses the same tag occurrence and construction capture.
Documentation still prefers a separate authored Hson block.

## 8. D1 lifecycle evidence reused

The private provider instrumenter substitutes only discovered tag, construction
and attachment sites in an explicitly chosen diagnostic copy. It does not execute
code or install a loader. The existing trusted provider executes that copy through
D1's existing load path. D1 still owns TemplateStringsArray occurrence identity,
actual map construction, initial revision, pre-success attachment proposals,
Schema object identity and before/after mutation suppression.

Optional source-site metadata connects those existing records to the editor.
The source session checks the actual official tag/constructor and actual map.
The Schema must already be registered through D1/D2. Production source/output,
public methods, exceptions and return types are unchanged. As in D1, the private
diagnostic copy retains attachment errors and can collect further attempts;
this does not assert that application execution reached any use statement.

## 9. Direct unchanged-map proof

The runtime suite executes the ordinary source flow, checks equal construction
and attempt revisions, and validates a new editor candidate. The editor suite
and real VS Code host locate the exact earlier `"37"` span without a standalone
validation call.

## 10. Actual mutation suppression

Executed data `map.set` and document attribute mutations suppress source
association. No content diagnostic is emitted for that map.

## 11. Mutate-then-revert suppression

Both data and document mutations followed by restoration still lose
correspondence. Revision evidence wins over equality. A real mutation after
association also invalidates the pending lifecycle at validation time.

## 12. Failed initial attachment

D1 records the attempt before attachment succeeds. Rejected initial proposals
remain directly correspondent when revisions did not change, so current editor
source receives authoritative diagnostics and can be corrected without changing
the saved original template. The real editor test exercises this failure case.

## 13. Multiple maps/Schemas

One template feeding two maps creates separate application and association IDs.
Both current contracts validate independently and retain different related use
sites. Mutating one suppresses only that relationship. Separate byte-identical
templates keep different occurrence IDs. Repeated executions of the same static
relationship are conservatively ambiguous when multiple runtime applications
match; both the client and runtime reject that ambiguity.

## 14. Multiple attachment attempts

Actual `schema.get()` state before each attempt distinguishes graph-validating
initial attempts from same-object idempotence and rejected replacement. Neither
idempotence nor replacement creates fresh authoring authority. A different
Schema attempted after an initial failure can independently validate, because
that map has not yet acquired governance. There is no last-Schema-wins rule.

## 15. Data diagnostics

The shared ordered graph validator remains authoritative, then C1 lowers issues
against the current candidate's provenance. Exact type mismatch and missing-key
anchor checks pass. Reordered integer-looking keys still fail the ordered literal
Schema; no outer JavaScript-object materialization was introduced.

## 16. Document diagnostics

C2 handles actual element and fragment roots, including exact attribute values,
missing-flag anchors, tag mismatch and fragment layout. Document ownership and
attribute/enforcement regressions pass. No `schema.document` surface was added.

## 17. Boundary context and root interpretation

D3 explicitly preserves `fromHson` parsing with `allowTopLevelTextFragment: true`.
Current parsed graph classification selects C1/C2, and shared graph validation
decides root compatibility. A quoted text root stays a document fragment at this
map boundary. A data string Schema is not allowed to reinterpret it.
Standalone `schema.validate` retains ordinary canonical parsing. No retries or
Schema-driven coercions occur.

## 18. Exact/anchor/unresolved presentation

D2 presentation is reused. Exact ranges and anchors map into the original Hson
body. Unresolved results remain explicitly template-level rather than fabricated
member ranges. The use call is related information, not another primary error.
Independent maps receive separate related use-site locations.

## 19. Stale-result invalidation

Each flow includes module/template/construction/use identities and a SHA-256
context revision covering all bytes outside that candidate body, including other
template bodies. Normalized site offsets survive body-length changes. Every edit
gets a new document/template/association revision; only the new candidate can
publish. Non-body source edits, binding changes, missing captures and duplicate
runtime applications prevent old lifecycle matching.

Runtime generations, actual Schema bindings and live map revisions are checked.
Evidence metadata is copied/frozen. Lifecycle source modules join D2's provider
watch/invalidation set. D2's unchanged controller clears on edits, supersession,
close, retirement and disable, with publication tickets guarding asynchronous
responses. A new source range alone cannot recover retired authority.

## 20. Trust gates

All three disabled combinations of Workspace Trust and explicit enablement prove
zero process generations and no project execution. D3 adds no client-side source
execution or process launcher. Syntax diagnostics remain available. Real VS Code
checks default-off behavior and disabling/clearing; existing D1/D2 trust and
controller tests also pass.

## 21. Standalone regression

All D2 discovery/runtime/editor/presentation suites pass. A source with both a
standalone validation and a map attachment produces two independent intentional
contracts. The standalone boundary and its canonical interpretation are unchanged.

## 22. Import/facade dependency note

A small textual census across D3 discovery tests, D3 fixture modules, and the real
editor fixture generator finds 22 `hson.liveMap` and 17 `hsonLiveMap` occurrences.
This includes definitions/negative examples and is not a bundle-size measurement.
The fixtures exercise umbrella construction, dedicated construction, dedicated
inline/aliases, and a real-editor dedicated-facade flow. Documentation contains
both styles and keeps standalone Hson authoring preferred.

No public narrow LiveMap or editor path now imports the complete `hson` aggregate.
The private runtime capture adapter checks the new `Hson` authoring identity;
D1 lifecycle/origin registration retains the existing aggregate identity; it is not imported by the editor client
or the public LiveMap facade. No import architecture redesign or full bundle
size audit was performed.

## 23. New suites/check counts

| Suite | Reported checks |
| --- | ---: |
| `schema-d3-discovery` | 25 |
| `schema-d3-runtime` | 25 |
| `schema-d3-editor` | 25 |
| Total | 75 |

All are visible package scripts and launcher-inventory entries. The actual VS
Code integration journey now covers D3 as well as D2; unchanged D2 controller
checks retain stale-publication coverage.

## 24. Performance

Nine warmed samples per flow, milliseconds, excluding the existing 150 ms editor
debounce. Representative measured medians after the final document mutation checks:

| Flow | Discovery | Lifecycle lookup | Associate/validate round trip | End to end |
| --- | ---: | ---: | ---: | ---: |
| Data | 0.725 | 0.0018 | 0.218 | 1.047 |
| Document | 0.625 | 0.0015 | 0.225 | 0.909 |
| One template / two maps / two Schemas | 0.725 | 0.0032 | 0.343 | 1.180 |

Maximum end-to-end samples in that run were 2.12, 1.04 and 3.03 ms respectively.
No ordinary warmed path approached seconds. The suite prints fresh measurements
on each run; cold provider loading is distinct. No speculative optimization was
needed.

## 25. Regression commands/results

All commands below passed. The final batch contains 39 commands, plus the real
VS Code host integration command. D3 runtime/editor and test TypeScript checks
were additionally rerun after extending document mutation coverage.

```text
npm run check:source
npm run check:tests
npm run build
npm run check:entrypoints
npm run test:diagnostics-inventory
npm run test:trusted-schema-d1
npm run test:schema-hson-graph
npm run test:schema-hson-public
npm run test:schema-d2-discovery
npm run test:schema-d2-runtime
npm run test:schema-d2-editor
npm run test:schema-d2-presentation
npm run test:schema-d3-discovery
npm run test:schema-d3-runtime
npm run test:schema-d3-editor
npm run test:livemap-schema-owner-contract
npm run test:livemap-schema-value-boundary
npm run test:livemap-schema-composition
npm run test:livemap-document-schema-construction
npm run test:livemap-document-schema-enforcement
npm run test:livemap-document-attrs-schema
npm run test:livemap-projected-schema-source-lowering
npm run test:livemap-document-schema-source-lowering
npm run test:hson-source-provenance-core
npm run test:hson-source-provenance-parser
npm run test:hson-source-provenance-boundary
npm run test:livemap-path-handle
npm run test:livemap-document-path-contract
npm run test:livemap-document-location-mutation
npm run test:livemap-projected-identity-lifecycle
npm run test:livemap-document-identity-overlay-lifecycle
npm run test:hson-tagged-template-discovery
npm run test:root-compatibility
npm run test:public-boundaries
npm --prefix editors/vscode-hson run check
npm --prefix editors/vscode-hson run build
npm --prefix editors/vscode-hson run test:grammar
npm --prefix editors/vscode-hson run test:unit
HSON_VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm --prefix editors/vscode-hson run test:integration
git diff --check
```

An initial malformed launcher insertion was corrected. The first GUI run passed
D2 but failed closed for D3 because macOS's temporary workspace had different
`/var` and `/private/var` spellings in provider/editor source identities. The test
runner now resolves its temporary root before constructing either identity;
production matching was not weakened. The corrected real host journey passes.
No unrelated hosted certification was run.

## 26. Public API confirmation

No public API changes: no new map or Schema methods, Hson types, validation API,
entrypoints, tooling exports or provenance APIs. No public runtime source files
were modified. LiveTree prototype/getter and runtime-identity contracts are
untouched. Build, entrypoint, root and public-boundary checks pass.

## 27. Git status

The starting worktree was clean. All 24 task files are unstaged (15 modified,
9 untracked); no commits were created. Generated outputs and temporary regression
logs are not tracked. `git diff --check` passes.

## 28. Recommended next phase

Exercise the explicit source-bound provider in a real application and improve
its packaging/setup guidance before widening source-flow analysis. Keep runtime
identity, exact source module paths and lifecycle evidence as the authority;
interpolation and interprocedural flow remain separate work.

## 29. Commit suggestion

`feat(schema): associate authored Hson with trusted LiveMap attachments`

Suggestion only. No commit was made.
