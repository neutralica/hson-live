> Historical D2 implementation record. The subsequent uppercase authoring
> migration changes the tag to `Hson` and makes `/hson` narrow. `Hson.validate`
> joins both retained LiveMap validation entrances; D2 architecture is unchanged.
> See [current authoring contract](../transform/api-transform.md).

# Schema authoring D2

## Public-surface review (recorded before public source edits)

1. Current surface: `hson.liveMap.schema.define`; compatible Schema objects
   expose existing validation and inspection capabilities (`validateRoot`,
   `validateValue`, rules/path inspection). The facade has no standalone
   whole-Hson Schema validator.
2. Approved change: add only `hson.liveMap.schema.validate(schema, canonical)`.
3. Rationale: authoritative validation of existing canonical Hson without a
   LiveMap allocation; a runtime boundary for fixtures, configuration, tests and
   build tooling; and a clean source-level association for D2.
4. Alternatives already reviewed: a method on every Schema, `map.schema` only,
   Transform ownership, wrapping the `hson` tag, and a certificate type. These
   are not being reopened.
5. Compatibility: additive API, no aliases, no migrations. The tag continues to
   return primitive `HsonCanonical`; success returns the unchanged spelling.
6. Approval: explicitly approved by the implementation task. No additional
   public surface is authorized.

## Completion report

### D2 API cleanup census

Immediately before this approved hard rename, the retired public spelling had
91 exact textual occurrences across 19 files. They covered the facade, D2
binding recognition, fixtures, tests, plans, documentation and two older
test-local helper names. The migration renamed every one; the final exact-name
census is zero in tracked source, tests, documentation, and generated output.

### 1. Public-surface review

The six points above were recorded before editing public source. Implementation
required no additional public surface and did not reopen any approved decision.

### 2. Exact files changed

40 files: 22 existing files modified and 18 new files. Generated `dist` artifacts
were rebuilt but remain ignored by Git.

Modified:

```text
docs/livemap/schema.md
editors/vscode-hson/README.md
editors/vscode-hson/package.json
editors/vscode-hson/scripts/build.mjs
editors/vscode-hson/src/document-diagnostics.ts
editors/vscode-hson/src/extension.ts
editors/vscode-hson/tests/integration/run.mjs
editors/vscode-hson/tests/integration/suite.ts
editors/vscode-hson/tests/validate-artifact.mjs
package.json
src/_tests/test-launchers.ts
src/api/livemap/livemap.document.schema.ts
src/api/livemap/livemap.facade.ts
src/api/livemap/livemap.schema.ts
src/internal/embedded-hson/discover-hson-tagged-templates.ts
src/internal/trusted-schema-diagnostics/README.md
src/internal/trusted-schema-diagnostics/dev-registration.ts
src/internal/trusted-schema-diagnostics/node-supervisor.ts
src/internal/trusted-schema-diagnostics/protocol.ts
src/internal/trusted-schema-diagnostics/runtime.ts
tests/entrypoints/public-entrypoints.ts
tests/livemap-document-schema-construction.acceptance.mts
```

Added:

```text
docs/plans/schema-authoring-d2.md
editors/vscode-hson/src/package.json
editors/vscode-hson/src/schema-diagnostics.ts
editors/vscode-hson/src/schema-presentation.ts
editors/vscode-hson/src/schema-source-revision.ts
editors/vscode-hson/src/trusted-schema-client.ts
src/internal/schema-hson-validation/validate-schema-hson-graph.ts
src/internal/trusted-schema-diagnostics/discover-validation-sources.ts
src/internal/trusted-schema-diagnostics/issue-presentation.ts
src/internal/trusted-schema-diagnostics/source-binding.ts
tests/fixtures/schema-d2-runtime.fixture.mts
tests/fixtures/schema-hson-graph.fixture.mts
tests/schema-d2-discovery.acceptance.mts
tests/schema-d2-editor.acceptance.mts
tests/schema-d2-presentation.acceptance.mts
tests/schema-d2-runtime.acceptance.mts
tests/schema-hson-graph.acceptance.mts
tests/schema-hson-public.acceptance.mts
```

### 3. Shared private graph validator

`src/internal/schema-hson-validation/validate-schema-hson-graph.ts` exports only
internally `validate_schema_hson_graph(schema: unknown, graph: HsonNode)`.
The graph must already be an admitted detached canonical graph. It returns
existing `LiveMapSchemaValidation`, recognizes capabilities through their owned
registries, and dispatches to the existing data or document authority.
It neither parses nor materializes an outer JavaScript object, constructs a map,
reserializes, retries interpretations, nor catches constraint exceptions.

### 4. Ordered-key defect: before/after

For `s.literal({ "1": "a", "2": "b" })`, the authored candidate
`<'2' "b" '1' "a">` retains canonical order `2,1`.

| Path | Result |
| --- | --- |
| Old outer materialize → public `validateRoot` | Incorrect acceptance |
| Existing ordered-carrier validator | Rejection |
| Migrated D1 lifecycle association | Rejection |
| D2 direct-source association | Rejection |
| Public `validate` | Rejection |

The regression mechanically executes all five paths, including an actual rejected
D1 map-attachment proposal. Ordinary and nested structured-literal ordering,
positive/negative zero, constraints, recurse, exact/open objects and documents
are also covered.

### 5. Final public signature

```ts
hson.liveMap.schema.validate(
  schema: LiveMapSchema,
  canonical: HsonCanonical,
): HsonCanonical
```

The existing opaque public Schema type is used. Complete root capability is
checked accurately at runtime; no internal capability taxonomy is newly exposed.
There is no arbitrary-string overload.

### 6. Public facade paths

Mechanical built-package checks prove identical method identity through:

- `hson` from `hson-live` → `.liveMap.schema.validate`;
- `hson` from `hson-live/hson` → `.liveMap.schema.validate`;
- `hsonLiveMap` from `hson-live/hson` → `.schema.validate`;
- `hsonLiveMap` from `hson-live/livemap` → `.schema.validate`.

No new top-level export or subpath was introduced. Declaration fixtures reject
plain strings, aliases, public graph-validator imports and direct-source types.

### 7. Data behavior

String, number, boolean, null, object and array roots go through ordered data
carriers. Existing literal equality, object exactness, tuple/pick/tagged choice,
constraints and recurse semantics remain authoritative. JavaScript values are
still materialized *inside* constraints. Existing nullability semantics are
preserved: for example, an unmodified `unknown` is not silently made nullable.

### 8. Document/root behavior

Actual element and fragment roots use existing document classification and
validation, including tag, attrs, flags, content/layout and repeat/count rules.
Combined data/document capabilities work in their actual root domains.
Ordinary `"text"` remains a data scalar; neither text-to-fragment nor
element-to-fragment coercion is attempted. Attrs-only and item-only expressions
without complete root capability are rejected.

### 9. Runtime failures

- Schema mismatch: `LiveMapSchemaError`, retaining structured issues.
- Unsupported/unrecognized/incomplete Schema: root `INVALID_SCHEMA` issue.
- Incompatible actual root: root `TYPE_MISMATCH` issue.
- Malformed untyped string: authoritative Transform error, unchanged.
- Non-string runtime misuse: `TypeError`.
- Data constraint exception: original exception propagates.
- Document attribute constraint exception: existing adapter still yields its
  established mismatch behavior; it is not changed to propagate.
- D1 timeout/crash/load/compatibility/staleness failures remain tooling outcomes,
  not errors thrown by public `validate` for authored content.

### 10. Success identity

Success returns the input primitive string unchanged, with type `HsonCanonical`.
Tests also defensively pass a non-normalized spelling from untyped JavaScript and
prove exact return spelling. No wrapper, metadata, certificate, mutation of the
Schema, output normalization, or ceremonial LiveMap allocation is added.

### 11. D1 migration

D1 still parses with Phase-B provenance and lowers with C1/C2 using the same graph
and sidecar. Only its erroneous outer materialization/validation round trip was
replaced by shared graph authority. Its lifecycle fragment parse context remains
explicit; direct D2 candidates use ordinary canonical interpretation. Existing
D1 ownership, generation, timeout, recovery, bounded output and instrumentation
remain in place; all 16 D1 checks pass.

### 12. Direct-source protocol/runtime

The private `associate-source` request is distinct from lifecycle `associate`.
Evidence includes template ID, validation-call ID, document/template revisions,
association revision, source binding and actual registered Schema handle, with
runtime generation in the envelope. Association does not assert that application
validation ran. Each site is validated separately and disposed after its request.

Exported registrations map source bindings by exact exported-object identity,
not handle spelling. Optional private `trustedSchemaBindings` metadata can name
another module export, whose actual runtime identity is verified. Private
development registration supports `{ moduleUrl, localName, declarationStart }`.

### 13. Duplicate private registrations

All registrations are retained until consumption. Repeating an ID with the same
object is idempotent. Reusing it for another object fails load with
`AMBIGUOUS_REGISTRATION`; nothing overwrites the conflicting evidence. Different
IDs mapping one binding to different objects fail association as ambiguous.

### 14. Workspace Trust

The manifest declares limited Restricted Mode support and restricts execution
configuration. The client checks `vscode.workspace.isTrusted` and listens for
the standard trust-grant event. Secure syntax diagnostics remain active. This
uses [VS Code's standard Workspace Trust facilities](https://code.visualstudio.com/api/extension-guides/workspace-trust),
not a separate trust mechanism.

### 15. Explicit enablement

`hson.trustedSchemaDiagnostics.enabled` defaults to `false`. Workspace Trust alone
does not execute project code. Both gates guard client creation and D1 launch;
disabled combinations mechanically prove zero process launches. Configuring
modules without enabling this setting is insufficient. No recurring prompts.

### 16. Discovery/binding rules

Compiler symbols establish named root `hson` imports from `hson-live` or
`hson-live/hson`, including renamed imports. Only the exact facade chain
`.liveMap.schema.validate` is recognized. Extracted/destructured validators,
namespace imports, shadowed roots, wrong packages, coincidental local names and
arbitrary wrappers are excluded. Syntax discovery is unchanged in secure mode.

### 17. Canonical tracing

Recognized substitution-free templates, harmless parentheses and local immutable
identifier-only `const` chains are supported. Declarations precede use within
one module/function-body statement domain. Depth is bounded to 32 hops and
symbols are cycle-checked. Mutable bindings, parameters, helpers/returns,
properties, collection lookups, conditionals, concatenation, transformations and
interprocedural flows do not acquire inferred correspondence.

### 18. Schema tracing

Local immutable Schema bindings, named relative imports (including renamed
imports) and immutable identifier-only aliases resolve to explicit source-binding
metadata. No structural TypeScript compatibility is used. Initial support does
not guess TS path aliases, package Schema imports or re-export traversals; source
module URLs must correspond to the registered metadata.

### 19. Multiple validations

Two calls produce two associations and two executions, even for an identical
Schema object. Tests prove stateful constraints execute independently and that
two diagnostics at one template retain different related call-site locations.
Multiple contracts alone are not ambiguity. A per-site validation exception
does not stop other sites while the runtime remains available.

### 20. Asynchronous lifecycle

The editor controller clears old diagnostics immediately, debounces 150 ms,
tracks publication tickets plus document version/text and delegates process,
request-ID and generation checks to D1. Template/call/binding/revision identities
are checked before and after asynchronous work. Close/reopen, supersession,
disable, disposal and generation retirement cannot republish old results.
Known provider changes retire the generation; unsaved provider edits outside
template bodies remain stale until saved. Replacements use D1's finite budget,
not hot reload. Runtime ownership is one persistent client per configured
workspace-folder project.

### 21. Diagnostic locations

C1/C2 exact ranges map into the original template body. Anchors remain explicitly
described as anchors to existing source. Unresolved or invalid offsets become
explicit template-level diagnostics, never fabricated member ranges. The
validation call is related information, not a duplicate primary squiggle.

### 22. Representative messages

- `[UserSchema] Expected \`age\` to be a number, but this value is an Hson string.`
- `Required \`age\` is missing. (Anchored to existing source; required structure is absent.)`
- `\`extra\` is not allowed by this exact Schema.`
- `Expected \`status\` to equal "draft"; found "pending".`
- `\`age\` does not satisfy constraint “positive age”.`
- `Expected element tag "button"; found "span".`
- `Expected attribute \`count\` to be a number, but this value is an Hson string.`
- `Required flag \`disabled\` is missing.`

Private WeakMap evidence distinguishes tag/flag/constraint labels without parsing
arbitrary English messages or changing the public issue taxonomy. Unlabeled
constraints receive neutral failure wording, not speculative repair advice.

### 23. Availability/infrastructure UX

Status distinguishes `off`, `waiting`, `current-valid`, `current-invalid`,
`stale`, `ambiguous`, `unavailable`, and `runtime-failed`. Tooltip text explains
that the current editor candidate was checked against the current mapped Schema,
not that the application's validation statement ran. Timeout/load/constraint
execution failures do not produce authored-Hson error squiggles. No diagnostics
is never presented as equivalent to validity without a successful current check.

### 24. Focused suites and visible check counts

| New suite | Checks |
| --- | ---: |
| `schema-hson-graph` | 25 |
| `schema-hson-public` | 21 |
| `schema-d2-discovery` | 25 |
| `schema-d2-runtime` | 27 |
| `schema-d2-editor` | 22 |
| `schema-d2-presentation` | 20 |
| Total new focused checks | 140 |

All are wired into package scripts and the launcher inventory. Existing D1 has
16 checks and secure VS Code runtime/lifecycle has 22. Actual VS Code extension
host integration also passed: default off, exact `"37"` diagnostic, unsaved
correction, revalidation, and disabling/clearing. It uses an isolated temporary
workspace and settings, not the user's normal VS Code profile.

### 25. Measured performance

Seven warmed data D2 requests on this machine, milliseconds:

| Stage | Median | Maximum |
| --- | ---: | ---: |
| Source discovery/association discovery | 0.891 | 0.995 |
| Client/runtime associate + validate round trip | 0.497 | 2.514 |
| Parse/provenance | 0.213 | 0.344 |
| Schema validation | 0.080 | 0.112 |
| C1 lowering | 0.016 | 0.081 |
| Editor publication preparation | 0.009 | 0.059 |
| End-to-end excluding debounce | 1.416 | 3.596 |

An actual warmed editor-controller request measured 154.17 ms including the
configured 150 ms debounce (diagnostic operation 1.91 ms). D1 document/C2 probe:
parse 0.18 ms, validate 0.08 ms, lower 0.30 ms, end-to-end 0.62 ms. D1 cold load
was 1121.6 ms, constrained warm median 0.15 ms; the deliberate timeout retired
at 122.66 ms and recovered validation took 0.43 ms. No ordinary warmed operation
was multi-second. The extension output channel records these stages and flags
requests reaching two seconds; cold load is distinguished in its warning.

### 26. Regression commands/outcomes

All final commands below passed:

```text
npm run check:source
npm run check:tests
npm run build
npm run check:entrypoints
npm run test:diagnostics-inventory
npm run test:schema-hson-graph
npm run test:schema-hson-public
npm run test:schema-d2-discovery
npm run test:schema-d2-runtime
npm run test:schema-d2-editor
npm run test:schema-d2-presentation
npm run test:trusted-schema-d1
npm run test:livemap-schema-value-boundary
npm run test:livemap-schema-composition
npm run test:livemap-schema-owner-contract
npm run test:livemap-schema-counted-repeat
npm run test:livemap-document-schema-construction
npm run test:livemap-document-schema-enforcement
npm run test:livemap-document-attrs-schema
npm run test:hson-source-provenance-core
npm run test:hson-source-provenance-parser
npm run test:hson-source-provenance-boundary
npm run test:livemap-projected-schema-source-lowering
npm run test:livemap-document-schema-source-lowering
npm run test:hson-tagged-template-discovery
npm run test:hson-tagged-template
npm run test:hson-root-boundary
npm run test:root-compatibility
npm run test:public-boundaries
npm --prefix editors/vscode-hson run check
npm --prefix editors/vscode-hson run build
npm --prefix editors/vscode-hson run test:grammar
npm --prefix editors/vscode-hson run test:unit
HSON_VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm --prefix editors/vscode-hson run test:integration
git diff --check
```

The construction suite's previous exact `['define']` expectation was updated to
the approved additive surface. An initial GUI attempt used the obsolete
`Electron` executable name; retrying the installed `Code` executable passed.
Development fixture spellings were corrected while tests were being added;
runtime grammar/attribute/nullability semantics were not changed to accommodate
them. No unrelated hosted/certification execution was required or performed.

### 27. Map-flow disposition

`map.schema.use` backward association remains deferred. Existing D1 lifecycle
evidence is retained for the immediate follow-up; D2 does not infer non-mutation
from source and does not require redundant validation for that future flow.

### 28. No Schema-specific Hson type

No `HsonAssociated`, `HsonTyped`, `HsonCertified`, wrapper or certificate type was
added. `hson` stays tag-only and returns primitive `HsonCanonical`.

### 29. No unintended public API

Only `.schema.validate` is additive. No aliases, public helper, registry,
runtime handle, protocol, provenance, C1/C2 or direct-source association export
was added. Runtime and declaration tests verify this.

### 30. Git status

40 task files changed (22 modified, 18 new), all unstaged. The starting worktree
was clean. No commits were created. `git diff --check` passes. Generated build
outputs and temporary test artifacts are not included in the tracked changes.

### 31. Commit suggestion

`feat(schema): add authoritative validate and trusted VS Code diagnostics`

Suggestion only; no commit was made.

## D2 API cleanup — hard rename report

### 1. Pre-edit census

The retired public spelling had 91 exact occurrences across 19 files before this
rename. This included all operational API, discovery and VS Code references, the
public/docs/fixture suites, and two pre-existing test-local parsing helpers.

### 2. Files changed by the rename

```text
docs/livemap/schema.md
docs/plans/schema-authoring-d2.md
editors/vscode-hson/README.md
editors/vscode-hson/src/schema-presentation.ts
editors/vscode-hson/tests/integration/run.mjs
editors/vscode-hson/tests/integration/suite.ts
src/api/livemap/livemap.facade.ts
src/internal/trusted-schema-diagnostics/README.md
src/internal/trusted-schema-diagnostics/discover-validation-sources.ts
tests/embedded-hson-diagnostic-mapping.acceptance.mts
tests/entrypoints/public-entrypoints.ts
tests/hson-tagged-template-discovery.acceptance.mts
tests/livemap-document-schema-construction.acceptance.mts
tests/fixtures/schema-d2-runtime.fixture.mts
tests/schema-d2-discovery.acceptance.mts
tests/schema-d2-presentation.acceptance.mts
tests/schema-d2-runtime.acceptance.mts
tests/schema-hson-graph.acceptance.mts
tests/schema-hson-public.acceptance.mts
```

### 3. Final signature

```ts
hson.liveMap.schema.validate(
  schema: LiveMapSchema,
  canonical: HsonCanonical,
): HsonCanonical
```

The shared graph validator, input contract, return identity, structured
`LiveMapSchemaError`, Transform behavior, and constraint behavior are unchanged.

### 4. Entrypoints

Built-package tests prove `.schema.validate` through the root facade, the `hson`
subpath facade, and both intended `hsonLiveMap` subpath paths. The generated
declaration contains the signature above. The schema namespace has exactly
`define` and `validate`; public module checks prove there is no top-level
`validate` export.

### 5. D2 discovery

Binding-aware discovery now walks `hson.liveMap.schema.validate` specifically.
It continues to reject extracted functions and lookalikes, and continues to map
the later call back to the earlier substitution-free template.

### 6. Retired-name confirmation

The final exact-name census is zero across source, tests, documentation and
rebuilt `dist` declarations. No compatibility alias exists.

### 7. Focused verification

Passed: source and test TypeScript checks; public entrypoint checks; build;
Schema graph (25); public facade (21); D2 discovery (25); D2 trusted runtime
(27); D2 editor lifecycle (22); D2 presentation (20); VS Code check/build/unit
(22); real isolated VS Code integration; root compatibility (109); public
boundaries (6); and `git diff --check`.

### 8. Git status

The original uncommitted D2 implementation remains unstaged: 24 modified and
18 untracked paths (42 total). No commit was created.

### 9. Commit suggestion

`feat(schema): rename Schema validation operation`
