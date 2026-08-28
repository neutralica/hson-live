# Uppercase HSON authoring migration

Implemented on top of the uncommitted D3 work. No commit was created.

## Public contract

- `HSON` is the frozen callable authoring facade, exported from the root and
  `hson-live/hson` as the same object. It accepts the established primitive
  substitutions and returns the existing `HsonCanonical` branded string.
- `HSON.validate(schema, canonical)` is synchronous and returns that unchanged
  string on success. Failures retain the existing error class and structured
  issues. It creates neither a map nor a Schema certificate.
- `hson` is the frozen, noncallable aggregate. Its existing properties remain.
  There is no lowercase tagged-template compatibility alias.
- `hson.liveMap.schema.validate` and `hsonLiveMap.schema.validate` remain valid
  public entrances. All three entrances reference one private function object.
- `/hson` is an authoring boundary, not an aggregate barrel. It exports `HSON`,
  the same `HsonCanonical` type as `/transform`, and existing Transform error
  helpers/types. It no longer exports aggregate/subsystem facades or binary types.
- Root convenience exports now include `hsonTransform`, `hsonLiveMap`,
  `hsonLiveTree`, and `hsonInspect`, alongside existing `hsonLocus`, `hsonReflect`,
  and `hsonCalc`. Existing dedicated subpaths retain their facades. No additional
  subpath was invented. The historical `hsonLiveHost` facade was not resurrected;
  current `/livehost` and `/livehost/node` APIs remain unchanged.
- The canonical type's brand is not duplicated or added to the package root.

The aggregate LiveMap facade retains its browser compatibility superset. Its
object intentionally differs from the dedicated LiveMap object, while their
construction functions and Schema namespace retain shared identities.

## Implementation boundaries

`src/hson-authoring.ts` imports the existing admission leaf and the new private
`internal/schema-hson-validation/validate-canonical-hson.ts`. That private wrapper
contains the former LiveMap facade validation body and calls the existing shared
ordered graph-level authority. It does not materialize a projected JavaScript
object before authoritative validation. Projected/document Schema registries,
classifiers, error classes and validators have not been duplicated.

`src/hson.ts` remains the internal aggregate module. The package export map points
`/hson` at `dist/hson-authoring.js`; root re-exports that same authoring object.
There are no new runtime dependencies or global `sideEffects` declarations.

## D2/D3 integration

Binding-aware discovery now distinguishes three official import identities:

| Binding | Public sources |
| --- | --- |
| `HSON` | root, `/hson` |
| `hson` | root |
| `hsonLiveMap` | root, `/livemap` |

Renamed imports retain symbol identity. Lowercase tags, wrong packages,
shadowing, local lookalikes, and retired `/hson` aggregate exports are rejected.
D2 recognizes `HSON.validate` and both retained LiveMap validation entrances.
Independent intentional validation calls are not ranked or collapsed.

D3 keeps direct const flow, parentheses, bounded canonical/map/Schema aliases,
inline authoring, and separate contracts for multiple maps. It still consumes
D1 construction/revision/attachment evidence rather than inferring runtime truth
from syntax. The two runtime authoring references now use the actual `HSON`
object. D1 aggregate-origin registration remains on the same `hson` object.

Mechanical runtime/editor tests retain proof of failed initial attachment,
actual mutation and mutate/revert suppression, independent map invalidation,
idempotent attachment, rejected replacement, ordered keys, current unsaved
candidates, stale generations/sites/bindings, and projected/document root context.
Text fragments continue to use construction context; standalone validation does
not silently adopt that interpretation. C1/C2 exact, anchor, and unresolved
presentation and related use-site information remain unchanged.

Both trust gates remain required. Disabled combinations do not start the trusted
runtime or import the project. Interpolation capture and broad dataflow remain
unsupported. No D1/D2 architecture, map method, Schema method, lifecycle export,
or tooling export was added.

The TextMate grammar recognizes uppercase `HSON` only. Semantic alias support
remains binding-aware. Tests prove lowercase retired syntax gets no injection.
Root smoke fixtures and current docs use the new imports. Historical reports are
explicitly marked as superseded where their former public surface is described.

## Package measurements

Built-package esbuild 0.25.9 probes: browser, ES2022, ESM, tree shaking, minified
and unminified output, gzip level 9. Outputs stay in memory. Sizes are bytes.

| Consumer | Raw | Minified | Gzip | Retained modules |
| --- | ---: | ---: | ---: | ---: |
| `/hson` tag only | 185393 | 98950 | 27383 | 51 |
| `/hson` tag plus validation | 185434 | 98981 | 27399 | 51 |
| Root aggregate | 1582261 | 836487 | 242789 | 244 |
| `/transform` facade | 433278 | 274698 | 92104 | 79 |
| `/livemap` facade | 772023 | 430470 | 133949 | 127 |

The narrow graph does not traverse the aggregate, full LiveMap core, LiveTree,
LiveHost, Locus, Reflect, Inspect, browser Transform, DOMPurify, or external HTML
parser dependencies. Its retained output contains the actual Schema validators,
but not mutation/history/session implementations. The approved same-object
validation premium is paid by tag-only imports: roughly 9.4 KB gzip relative to
the audit's bare admission leaf. Root convenience imports remain aggregate-sized.
The existing unrelated LiveTree packaging leak was not refactored.

## Warm diagnostic measurements

D3 p50 milliseconds from the final regression batch (three commands running
concurrently; no ordinary warm path was multi-second):

| Case | Discovery | Lifecycle lookup | Round trip | End to end |
| --- | ---: | ---: | ---: | ---: |
| Projected | 1.371 | 0.0027 | 0.770 | 3.410 |
| Document | 1.597 | 0.0025 | 0.650 | 2.481 |
| One template, two maps | 1.785 | 0.0092 | 1.293 | 3.767 |

An earlier lighter run measured end-to-end p50 of 1.15/0.97/1.79 ms respectively.
These are warmed local diagnostic timings, not startup or debounce promises.

## Verification

- `npm run build`: passed; normal ignored `dist` output regenerated.
- All 33 commands below passed. Semantic suites reported 619 checks in this batch,
  separately from the 8 package checks and 109 root runtime export checks.
- New `hson-authoring-discovery`: 20 checks, registered in the suite inventory.
- New `hson-authoring-package`: 8 checks, recorded as package certification in
  the inventory's explicit non-launcher list.
- Expanded `schema-hson-public`: 25 checks.
- D3 discovery/runtime/editor: 25 checks each.
- Added a DOM-free authoring declaration consumer to `check:entrypoints`.
- VS Code `npm run check`, `npm test` (grammar and 22 unit checks), build, and
  real `npm run test:integration`: passed. The real host verified D2 uppercase
  validation and D3 narrow authoring/dedicated map flow, exact diagnostics,
  rejected initial attachment, related use site, unsaved correction, revalidation,
  default-off behavior and disable clearing.
- No unrelated hosted certification ran. No VSIX deployment was performed.
- `git diff --check`: passed. Existing D3 work remains present and uncommitted.

```sh
npm run check:source
npm run check:tests
npm run check:entrypoints
npm run test:hson-authoring-discovery
npm run test:hson-authoring-package
npm run test:hson-tagged-template
npm run test:hson-tagged-template-discovery
npm run test:embedded-hson-diagnostic-mapping
npm run test:trusted-schema-d1
npm run test:schema-d2-discovery
npm run test:schema-d2-runtime
npm run test:schema-d2-editor
npm run test:schema-d2-presentation
npm run test:schema-d3-discovery
npm run test:schema-d3-runtime
npm run test:schema-d3-editor
npm run test:schema-hson-graph
npm run test:schema-hson-public
npm run test:livemap-schema-owner-contract
npm run test:livemap-schema-value-boundary
npm run test:livemap-document-schema-construction
npm run test:livemap-document-schema-enforcement
npm run test:livemap-document-attrs-schema
npm run test:livemap-projected-schema-source-lowering
npm run test:livemap-document-schema-source-lowering
npm run test:hson-source-provenance-core
npm run test:hson-source-provenance-parser
npm run test:hson-source-provenance-boundary
npm run test:livemap-path-handle
npm run test:livemap-projected-identity-lifecycle
npm run test:public-boundaries
npm run test:root-compatibility
npm run test:diagnostics-inventory
```

## Files and migration guidance

Public implementation: `package.json`, `src/index.ts`, `src/hson.ts`, new
`src/hson-authoring.ts`, admission diagnostics, LiveMap facade, and the shared
private canonical-validation wrapper.

Tooling: embedded import discovery; D2/D3 association discovery; private lifecycle
capture identities; TextMate injection; editor fixtures/tests; root smoke files;
public/type/graph/Schema regression tests and suite inventory.

Documentation: root README, Transform API, LiveMap Schema API, editor/private
runtime READMEs, D3 report, and migration notices on historical D2/release records.
The complete worktree also includes the pre-existing uncommitted D3 implementation.

Consumers must change authored tags/imports to `HSON`. Aggregate users import
`hson` from the root; subsystem users choose their existing dedicated subpaths or
new root facade convenience exports. Existing LiveMap Schema validation calls do
not need migration. Natural map-owning code does not need a redundant validation
call. No compatibility tag alias is provided.

Suggested commit, when separately authorized:
`feat: add narrow HSON authoring facade and integrate D2/D3 diagnostics`
