# D4c implementation and validation

2026-11-04. Original implementation record on `main`. The frozen-tree recovery record below supersedes its earlier validation and inventory claims. The owner-staged candidate is preserved; recovery changes remain unstaged and no commit is created.

## Result and review checkpoints

| Checkpoint | Result | Independent evidence |
| --- | --- | --- |
| A — Data carrier, ingress, consumers, declarations and tooling | Implemented and functionally validated. The unchanged authoring bundle-size check has a demonstrated D4b baseline failure. | Data/source consumer Node/Worker cases; setter and submission ownership suites; Part composition; action/Echo/interaction tests; compiler, declaration, editor and native-browser checks below. |
| B — Document `CssMap` stylesheet admission | Implemented and validated for construction, dynamic admission, Locus admission/resumption, SSR, and local root/relative styles. Local `@:name` correspondence completed in the correction pass below. | `flat-library-definitions.acceptance.mts` compiles declarations in both optional-property modes and runs the complete fixtures in Node and a real Worker; native Chrome verifies first-paint CSS without JavaScript. |

The owner-authorized correction extends the existing local initializer contract with required `quads` evidence and optional existing `scopes` evidence. Empty `quads` explicitly declares no flat names; missing evidence is rejected. Graph qualification, canonical fingerprinting, initial Echo composition and later installation now preserve correspondence. Scoped Part occurrences remain separate; no Q1/Q2 API or generated-QUID persistence is introduced. D4d retained graph authority remains outside scope.

## Baseline and repository protection

- Branch and HEAD: `main`, `dc0fd0b11ac518f6a7322b3f820882c96660c447` (committed D4b).
- The index was empty at entry and remains byte-identical. No locks or active Git/hook processes were found in the initial or final checks. No worktree, staging, reset, commit or push was performed.
- The five pre-existing owner appearance changes are listed separately below. Their bytes, README bytes and index bytes match the entry SHA-256 capture.
- No tracked distribution, Deck or Scout files changed. README was not edited. No full repository gate was run.
- Source/declaration/package validation used controlled outputs in `/private/tmp/hson-d4c-package`. Its final source copies match the repository source byte-for-byte. D4b source was separately emitted from a read-only archive to `/private/tmp/hson-d4c-baseline` for comparisons.
- One editor build followed the existing installed-package symlink and regenerated the pre-existing **ignored** files `editors/vscode-hson/typescript-plugin/dist/index.cjs` and `index.cjs.map`. Their prior bytes were not captured. Subsequent editor build destinations were isolated. These two generated outputs are an additional filesystem side effect, outside the Git inventory below.

## Public Data contract before and after

Before, the authoring facade exposed these signatures and returned primitive serialized text:

```ts
Hson.data(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonData;
Hson.data.from(value: unknown): HsonData;
Hson.data.fromHson(source: HsonCanonical): HsonData;
Hson.data.materialize(value: HsonData): JsonValue;
Hson.data.entries(value: HsonData): readonly (readonly [string, HsonData])[] | undefined;
```

`Substitution` remains `string | number | boolean | null`. The former internal `ExactDataCarrier` is now the sole public `HsonDataValue` class. There is no alias or second wrapper. The emitted signatures are:

```ts
class HsonDataValue<
  TSchema extends HsonSchema<unknown, "data"> = HsonSchema<unknown, "data">
> {
  private readonly hsonDataNominal;
  private constructor();
  static from<TSchema extends HsonSchema<unknown, "data">>(
    input: HsonDataValue<TSchema>
  ): HsonDataValue<TSchema>;
  static from<const T>(input: T & NoInfer<HsonDataInputCheck<T>>): HsonDataValue;
  static fromSource(source: string): HsonDataValue;
  get kind(): "string" | "number" | "boolean" | "null" | "array" | "object";
  scalar(): string | number | boolean | null | undefined;
  items(): readonly HsonDataValue[] | undefined;
  entries(): readonly (readonly [string, HsonDataValue])[] | undefined;
  materialize(): JsonValue & JsonFromSchema<TSchema>;
  toHson(): HsonData<TSchema>;
  equals(other: HsonDataValue): boolean;
}
```

The frozen callable facade is now:

```ts
Hson.data(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonDataValue;
Hson.data.from: typeof HsonDataValue.from;
Hson.data.fromSource: typeof HsonDataValue.fromSource;
```

`HsonDataInput` is supported recursive ordinary Data or a top-level authenticated carrier. `HsonDataInputCheck` is the existing-boundary structural check used for generic interface/readonly inference; its exact definition is in `src/api/data/hson-data.ts`. It rejects unsupported fields and nested carriers rather than admitting arbitrary `object` or `unknown`. Runtime admission remains authoritative for prototypes, descriptors, names and resource limits.

`HsonData` remains canonical serialized Hson text. The removed facade `materialize`/`entries` operations are carrier methods. `.fromHson()` was removed from Data authoring without a compatibility alias; Document and Schema source APIs retain their respective `.fromHson()` contracts.

Every value-oriented Data position treats `"42"`, `"true"`, `"null"`, `"{}"` and Hson-looking strings literally, including branded serialized strings. JSON/Hson source enters explicitly through `Hson.data.fromSource(source)` using established D3 bilingual admission. Nested ordinary strings stay literal. Arbitrarily embedded carriers are rejected. Existing explicit argument collections, such as Part's named Data arguments, admit their individual values.

The tag still uses the established Hson interpolation grammar. Carriers cannot be interpolated as objects; authored source interpolation requires explicit `.toHson()`. No source detector, TypeScript brand test, implicit string conversion or new parser determines runtime value meaning.

## Authentication, certification and consumers

Authentication uses the original private WeakMap and construction authority. Instances remain frozen, with methods/getters on the prototype. `from(genuine)` preserves object identity; constructor/prototype/structural forgeries cannot acquire private value authority. Public inspection/factory methods do not govern internal admissions: regression cases replace those methods while Library, Part, Schema, transport and action boundaries continue using private authenticated values.

| Consumer | Result |
| --- | --- |
| Data Library construction and `addLibraries`/`locus.admit` | Shared value admission, literal strings, exact carrier values, existing ownership and atomicity. |
| LiveMap Data setters and collections | Authentication precedes ordinary reflection. Whole carriers work in exact setters and applicable bulk collections; arbitrary nested carrier substitution is rejected. D4a exact capture remains in force. |
| Part `.write()` | Admits each declared Data argument, then serializes into the existing authored attribute representation. Composition explicitly decodes that representation and preserves exact forwarding. Document/scalar arguments keep their contracts. |
| Data Schema `.certify()` | Validates the private ordered value and returns the same genuine carrier with the specific Schema proof. Document certification still qualifies Document source and returns Document text. |
| Locus | Requests accept values/carriers. Validators, decoders, authorizers, handlers and normalized handler messages receive carriers. Decoder output and handler results are re-admitted; acknowledgments/status results are carriers. |
| Echo | Public requests accept values/carriers; retained request payloads and acknowledgment/status results are normalized carriers. Retry capture and ownership remain stable. |
| Interactions | Descriptor Data inputs follow the same rule. Dispatch supplies authenticated Data values; canonical storage/fingerprinting avoids public text serialization/reparsing. |

Schema certification retains its exact conditional signature:

```ts
certify<TSchema extends HsonSchema, const TCandidate>(
  this: TSchema,
  candidate: TCandidate & (
    [TSchema] extends [HsonSchema<unknown, "document">]
      ? HsonCanonical | HsonAuthored
      : NoInfer<HsonDataInputCheck<TCandidate>>
  )
): Certified<TSchema, TCandidate>;

type Certified<S extends HsonSchema, C> =
  S extends HsonSchema<unknown, "data">
    ? HsonDataValue<Extract<S, HsonSchema<unknown, "data">>>
    : S extends HsonSchema<unknown, "document">
      ? HsonDocument<Extract<S, HsonSchema<unknown, "document">>>
      : C extends string ? HsonDataValue | HsonDocument : HsonDataValue;
```

`HsonFromSchema<S>` chooses the corresponding typed Data carrier or Document text. Distinct Schema definition identities remain incompatible even when projected shapes match. `materialize()` supplies the corresponding structural `JsonFromSchema` view. Root and `/hson` export the same carrier definition; package overlap/runtime identity, packed consumers and dedicated declaration checks pass. Existing `CssMap` exports remain at their owning entrypoints.

## Static authoring and editor evidence

Schema and Part tooling use TypeScript binding identity and the canonical admission/evaluation machinery. Literal strings, official `fromSource`, known `from`/Data-tag producers and unknown expressions have distinct evidence. Mutable ordinary aliases retain conservative treatment. Reusable known carrier producers retain their immutable evidence.

Part authored attributes follow evidence through an explicit zero-argument `.toHson()` only when the checker resolves the method to the official carrier declaration. Direct carrier interpolation and same-spelled serializers establish no authored transport proof. `.write()` remains a value boundary, so serialized text passed there is string Data. Existing C2a scope is retained; deferred C2b inference was not added.

Editor proof filtering handles carrier generic variance and transparent proof aliases only within verified official assignment ranges. Wrong-family, unverified, unrelated-property and ordinary TypeScript errors remain visible. Maintained fixtures now expect the actual missing-carrier-member diagnostic where the old string API produced a string assignment error.

## Transport and exactness

No wire format or protocol fields changed. Requests still carry canonical exact JSON in `payloadData`; successful acknowledgments and retained status use `resultData`. Strict canonical decoding, authentication, replay, deduplication, resource bounds and durable acceptance remain unchanged.

A direct comparison of separately compiled D4b and D4c encoders passed **42 byte-equality assertions**: request, acknowledgment and retained-status output for 14 semantic values, including literal-looking strings, signed zero, nested/escaped values and authored integer-like member ordering. Source must be admitted explicitly under D4c to represent the same non-string value.

Obsolete public-value text projections and their reparsing helpers were removed. Legitimate encodings remain: canonical JSON/Hson transport, authored Part attributes, explicit `.hson()`/`.toHson()` output, Schema definition source, Document source/certification and generic Transform conversion. Portable identity rejection and generated-QUID restart rules are unchanged.

## Document stylesheet contract and Checkpoint B boundary

```ts
stylesheet?: string | CssMap;
```

The existing public `CssMap` and `normalize_css_map()` are reused. Opaque CSS strings are preserved byte-for-byte and never silently parsed. Structured input uses the existing lowering helper, with a Document root selector of `:root`; its Part default remains `:scope`, preserving occurrence scoping.

Root declarations and relative selectors target the complete receiving Document. Local `@:name` selectors resolve through canonical authored QUAD names and the existing correspondence machinery. Declaration order, aliases/collisions, custom properties, units, pseudos, relative selectors, media rules and undefined omission/deletion semantics use existing validators.

Caller CssMap objects are normalized before queued authority work and before durable local-seed loading. Document-dependent names are resolved after canonical Document admission. Local outer stylesheet overrides preserve precedence for frozen initializer objects and preserve ordinary configuration getter behavior. Revocable-proxy tests cover both local stylesheet placements across delayed loading and dynamic admission across delayed durable append.

Invalid structures, declarations, aliases, media/selectors and unresolved targets reject without changing revisions, snapshots, identity ledgers or observations. Capture/install, restart/checkpoint, SSR carriers and no-JavaScript Chrome rendering pass for the supported subset. Local named targets now pass graph-qualified initializer transport and both receiving paths. No aesthetic restrictions or new stylesheet representation were introduced.

## Focused validation evidence

No repository-wide gate was run. TypeScript source was emitted only to the controlled package directory. The public test configuration mapped package declarations there rather than rebuilding tracked distribution.

| Focused validation | Result |
| --- | --- |
| Source emit, public test types, Schema tooling types, editor/plugin source checks | Pass. |
| `data-source-consumers.acceptance.mts` | Seven consumer groups in Node and real Worker, plus parity: pass. |
| `livemap-setter-exact-order.acceptance.mts` | 29 Node/Worker cases plus parity: pass. |
| `locus-submission-ownership.acceptance.mts` | 36 Node/Worker cases plus parity: pass. |
| `livemap-document-composition.acceptance.mts` | 106 Node and 106 real Worker groups: pass. |
| `livemap-scoped-composition.acceptance.mts` | 72 Node and 72 Worker groups: pass. |
| `flat-library-definitions.acceptance.mts` | Full constructor/admission/CssMap/local/durable fixture in Node and Worker; declarations in both strict optional modes: pass. |
| Data, bilingual source, reserved names, root/definition identity, interpolation and attribute transport suites | Pass. |
| Data/Document Schema, relational uniqueness, any-Worker, composition/recursion and LiveMap convergence suites | Pass. |
| Canonical interactions, interaction ownership, Echo core, hosted action pipeline/admission/H5 | Pass; includes replay, duplicate actions, durable restart and failure atomicity. |
| Document and hosted continuation, Document/Library SSR Workers, Part optional arguments | Pass. |
| Part source facts, completion, reference diagnostics, editor introspection/forwarding Node and Worker | Pass. |
| Schema analyzer, compiler Project, compiler Watch, cutover | 31 / 24 / 29 / 12 acceptance checks: pass. |
| Schema public declarations, packed VS Code tooling/watch, type-query provenance | Pass. |
| Curated public entrypoint runtime/surface, refined examples, partial quoted package | Pass. |
| Schema editor proof, live compiler view, stock tsserver | Pass; 45 view checks and 23 tsserver checks. |
| Focused editor runtime/lifecycle and delimiter depth | 74 and 13 checks: pass. |
| Native Chrome canonical interactions | Pass against the controlled D4c build. |
| Native Chrome CSS/SSR, JavaScript disabled | Opaque text and structured Document styles: pass. |
| Inventory preflight, protected-byte integrity, index/lock/process checks, `git diff --check` | Pass. Inventory reports 461 maintained suites and existing legacy metadata notices. |
| Maintained authoring package size cap | **Fails at baseline and D4c.** D4b: 116,284 gzip bytes; D4c: 116,277; unchanged cap: below 115,000. No cap/dependency assertion was weakened. |

The authoring package suite stops at that size assertion. A clearly marked temporary diagnostic continuation exercised all remaining assertions, including dependency isolation, the relative core-size bound and browser-targeted authoring/action bundles in Node and real Workers: all passed. This continuation is not reported as a passing maintained size-cap suite.

Representative execution commands were `node --import=tsx tests/<suite>.acceptance.mts`, the focused TypeScript commands, `npm run check:editor`, `npm run check:inventory`, `node --import=tsx scripts/run-document-css-browser.mjs`, and the canonical-interaction Chrome runner against the temporary package. Schema/package/compiler tests ran in the isolated package with copied source/tooling inputs. Editor integration used a copied extension and isolated build destinations after the symlink issue noted above. Detailed logs are retained under `/private/tmp/hson-d4c-focused`, `/private/tmp/hson-d4c-package-logs` and `/private/tmp/hson-d4c-*.log`.

## Documentation and remaining work

Maintained API, Schema, Part, interaction, extension and release documentation is updated. README remains owner-controlled. Its import example at line 382 still shows the former Data import trio and does not explain `HsonDataValue`/explicit source admission; this is owner follow-up.

Local named-subject CSS correspondence is implemented. The unrelated pre-existing bundle-size cap failure remains. The two regenerated ignored editor bundle files must be included when reviewing filesystem side effects; no prior-byte restoration is claimed. Tracked distribution remains intentionally unchanged, so the owner must use the normal release build when adopting the implementation.

## Targeted correction pass — 2026-11-04

Checkpoint A corrections are confined to `library-evidence.types.ts`, the existing Data input type check, `data-values.types.ts`, the Locus reconstruction helper, and Part/type documentation. Carrier evidence uses semantic Schema parameters and the existing root-category policy; uncertified contents remain conservative. A seed certificate does not install a governing Schema, so member precision still requires an explicit governing Schema. Opaque `object` is rejected while structured interfaces, readonly arrays, optional members, unions, primitives and carriers remain supported. The fixture now forwards literal strings without JSON encoding. Adjacent helper searches found no further demonstrated obsolete string encoding.

Checkpoint B corrections are in `locus.projection.types.ts`, `locus.local-initializer.ts`, `echo.projection.ts`, the flat-definition fixtures, browser runner and maintained Library/Locus documentation. Required `quads` uses the existing portable name/path array (empty is explicit absence); optional `scopes` uses the existing scoped codec. Nonempty flat correspondence and scopes conflict. Creation captures existing Library associations; admission checks paths/names/CSS before identity issuance, includes correspondence in the canonical fingerprint, and forwards it at both installation points. No separate initializer version mechanism existed; strict required-field admission provides the authorized pre-epoch break. Action formats are unchanged.

Focused correction validation:

- Source emit only into `/private/tmp/hson-d4c-corrected/dist`; complete source/test types pass using that controlled package.
- Public Data and flat-definition compile fixtures pass with exact optional properties both false and true, importing root and dedicated package declarations. Added negative opaque-object cases and semantic carrier root-category cases; explicit governing Schema precision retained.
- Full flat-definition fixture passes in Node and an actual Worker, including local named CSS, distinct mappings on identical graphs, fingerprints, old-record rejection, forged/duplicate/out-of-scope evidence, caller detachment, initial/later installation, fresh identities, repeated internal Part names, portable restore and SSR. Scoped render equality uses the existing semantic comparison, since fresh runtime labels intentionally differ.
- Data/source consumer Node/Worker, submission ownership Node/Worker, Echo endpoint and hosted action pipeline suites pass; replay, authorization, lifecycle and retained results remain covered.
- Native Chrome with JavaScript disabled passes for textual CSS and structured local initializer CSS. Direct and local-round-tripped named Document rendering agree before computed-style checks.
- 42 request/acknowledgment/retained-status exact-byte comparisons against D4b pass.
- Inventory preflight passes (461 maintained suites). No full gate, tracked distribution generation, staging or commit.
- In-memory maintained-size measurement: esbuild 0.25.9, minified browser ESM/es2022, gzip level 9; D4b 116,284 bytes, corrected D4c 116,277 bytes. The unchanged `<115,000` cap remains a baseline failure.

The five owner appearance files and README remain protected. The earlier ignored editor build side effects are historical; this correction pass does not regenerate those bundles. Checkpoint A and B remain separately identifiable by the path groups above; shared report and flat fixture changes require hunk-level separation.

## Final targeted corrections — 2026-11-04

Checkpoint A: the re-review's carrier-inference and opaque-object corrections remain intact. Library factories and dynamic admission now infer structural Data candidates through the existing `HsonDataInputCheck`, accepting interfaces without requiring an index signature. Established overloads preserve union/contextual inference; admitted type evidence preserves governing Schemas and conservative carrier categories. Runtime admission is unchanged. Root and dedicated declaration fixtures cover interfaces, optional members, readonly arrays, unions, opaque objects, Date instances and functions in both optional-property modes.

The remaining primitive-Data test assumptions were corrected in `parts-members.acceptance.mts`, `direct-data-admission-cases.mts`, and `schema-hson-public.acceptance.mts`. Semantic carrier equality and same-carrier certification identity are tested separately; authored attribute transport is compared with explicit `.toHson()` output. The public Schema suite also checks materialization, signed zero, literal strings, forged carrier rejection and the actual public HsonDataValue export. Adjacent searches found no further demonstrated occurrence requiring correction.

Checkpoint B: public Echo creation now synchronously admits and detaches complete session-now evidence, including initializer graphs, quads, scopes, CSS and fingerprints, before returning the creation promise. Existing admission performs graph/fingerprint validation. Capture failures remain promise rejections and release the transport claim; attachment, synchronization and execution-time authority resolution remain deferred. Transport and runtime capabilities retain reference identity. Portable admission is necessarily loaded eagerly at this boundary; replica execution remains dynamically loaded. No format, codec, QUID lifetime, or namespace contract changed.

New Echo regression coverage checks immediate nested QUAD/CSS/fingerprint mutation, revocation of a supported Proxy after submission, asynchronous invalid-admission rejection with transport reuse, and scoped correspondence/CSS mutation before attachment. The scoped case deliberately fails at transport after proving the original evidence reached attachment. Existing initial/later local installation, fresh identity, fingerprint and atomicity cases remain passing. The complete Echo initialization suite, including the new cases, was also executed in an actual Worker.

Validation for this pass uses `/private/tmp/hson-d4c-final-qrfwmgfq`, with source copies and emitted artifacts isolated from tracked distribution. Source compilation and complete test type checks pass. Parts members, public Schema, flat Library definitions (both optional modes, Node/Worker), Echo initialization, Data consumers, submission ownership, hosted action pipeline and Echo endpoint regressions pass. Inventory preflight and scoped whitespace checks pass. Existing browser/SSR evidence from independent re-review remains applicable to unchanged CSS realization code; no browser rerun or full repository gate was performed in this correction pass.

The independent comparison was rerun: all 42 action request/acknowledgment/status byte comparisons against D4b pass. Gzip remains D4b 116,284 and D4c 116,277 bytes (esbuild 0.25.9, gzip level 9), above the unchanged `<115,000` budget. The size suite belongs to `full`, not the normal frozen-tree `check` hook. This is a separate inherited budget issue, not a D4c regression; no gate or dependency assertion was weakened.

The final inventory below supersedes the earlier 140-path checkpoint. README and the five owner appearance files remain untouched, as do tracked distribution, Deck and Scout. No staging, commit, push, reset or worktree creation occurred. README's stale example remains owner follow-up. No further semantic decision is required for these targeted corrections; the broader size budget remains a separate owner issue.

## Complete changed inventory

146 task paths (2 new files); 5 excluded owner paths.

### Source

```text
src/api/continuation/continue-hosted-document.ts
src/api/data/hson-data-hson.ts
src/api/data/hson-data.ts
src/api/echo/echo.endpoint.ts
src/api/echo/echo.projection.ts
src/api/echo/echo.request.ts
src/api/echo/echo.semantic-codec.internal.ts
src/api/echo/echo.ts
src/api/interactions/interactions.ts
src/api/livemap/livemap.document.composition.ts
src/api/livemap/livemap.facade.ts
src/api/livemap/livemap.guard.ts
src/api/livemap/livemap.libraries.ts
src/api/locus/locus.action-authorization.ts
src/api/locus/locus.action-validation.ts
src/api/locus/locus.actions.ts
src/api/locus/locus.aggregate.action-admission.ts
src/api/locus/locus.aggregate.authority.ts
src/api/locus/locus.aggregate.ts
src/api/locus/locus.local-initializer.ts
src/api/locus/locus.protocol.ts
src/api/locus/locus.public.ts
src/api/locus/locus.registry.ts
src/api/locus/locus.semantic-codec.internal.ts
src/api/schema/hson-schema.ts
src/api/transform/transform.types.ts
src/hson-authoring.ts
src/index.ts
src/internal/css/structured-css.ts
src/internal/embedded-hson/discover-hson-tagged-templates.ts
src/internal/hson-schema/candidate-diagnostics.ts
src/internal/hson-schema/candidate-evaluation.ts
src/internal/hson-schema/part-source.ts
src/internal/hson-schema/schema-annotation.ts
src/internal/hson-schema/source-candidates.ts
src/internal/part-write.ts
src/types/interaction.descriptor.types.ts
src/types/interaction.types.ts
src/types/library-evidence.types.ts
src/types/livemap.types.ts
src/types/locus.core.types.ts
src/types/locus.projection.types.ts
src/types/locus.protocol.types.ts
src/types/parts-library.types.ts
```

### Tooling and editor

```text
editors/vscode-hson/src/schema-editor-proof.ts
editors/vscode-hson/src/static-interpolation-diagnostics.ts
editors/vscode-hson/tests/delimiter-depth.test.ts
editors/vscode-hson/tests/fixtures/declarative-schema/candidate.ts
editors/vscode-hson/tests/runtime.test.ts
scripts/hson-schema.mts
scripts/run-document-css-browser.mjs
scripts/validation-config.mjs
```

### Tests and compile fixtures

```text
tests/browser/canonical-interactions.acceptance.html
tests/canonical-interactions.acceptance.mts
tests/data-source-consumers.acceptance.mts
tests/data-values.types.ts
tests/document-continuation.acceptance.mts
tests/echo-endpoint-core.acceptance.mts
tests/echo-init.acceptance.mts
tests/entrypoints/public/public-entrypoints.ts
tests/entrypoints/public/refined-api-examples.ts
tests/entrypoints/worker/hson-worker.ts
tests/fixtures/canonical-interactions.worker.mts
tests/fixtures/data-source-consumers-cases.mts
tests/fixtures/direct-data-admission-cases.mts
tests/fixtures/flat-library-definitions-cases.mts
tests/fixtures/hosted-css-admission-gaps-cases.mts
tests/fixtures/hson-attribute-quoting-cases.mts
tests/fixtures/hson-schema-any.worker.mts
tests/fixtures/hson-schema-compiler-project/consumer.ts
tests/fixtures/hson-schema-mvp/consumer.ts
tests/fixtures/hson-schema-mvp/proof.types.ts
tests/fixtures/hson-schema-mvp/structural.types.ts
tests/fixtures/inline-style-cases.mts
tests/fixtures/livemap-document-composition-cases.mts
tests/fixtures/livemap-scoped-composition-cases.mts
tests/fixtures/livemap-scoped-portable-cases.mts
tests/fixtures/livemap-setter-exact-order-cases.mts
tests/fixtures/locus-scoped-hosted-cases.mts
tests/fixtures/locus-scoped-ssr-cases.mts
tests/fixtures/locus-submission-ownership-cases.mts
tests/fixtures/part-forwarding-cases.mts
tests/fixtures/part-iteration-cases.mts
tests/fixtures/parts-write-cases.mts
tests/fixtures/representation-required-cases.mts
tests/fixtures/schema-diagnostics.fixture.mts
tests/flat-library-definitions.acceptance.mts
tests/flat-library-definitions.types.ts
tests/helpers/locus-definition-fixture.mts
tests/hosted-document-continuation.acceptance.mts
tests/hson-attribute-transport.acceptance.mts
tests/hson-authoring-package.acceptance.mjs
tests/hson-canonical.types.ts
tests/hson-data.acceptance.mts
tests/hson-definition-identity.acceptance.mts
tests/hson-interpolation-boundaries.acceptance.mts
tests/hson-multiline.acceptance.mts
tests/hson-partial-quoted-package.acceptance.mjs
tests/hson-root-boundary.acceptance.mts
tests/hson-schema-analyzer.acceptance.mts
tests/hson-schema-compiler-project.acceptance.mts
tests/hson-schema-compiler-watch.acceptance.mts
tests/hson-schema-composition-recursion.acceptance.mts
tests/hson-schema-cutover.acceptance.mts
tests/hson-schema-document.acceptance.mts
tests/hson-schema-mvp.acceptance.mts
tests/hson-schema-public-declarations.acceptance.mjs
tests/hson-schema-relational-unique.acceptance.mts
tests/hson-semantic-value-model.types.ts
tests/hson-structural-interpolation.acceptance.mts
tests/livemap-document-css.acceptance.mts
tests/livemap-phase-1a.acceptance.mts
tests/locus-construction.acceptance.mts
tests/locus-final-model.acceptance.mts
tests/locus-hosted-multi-library-action-pipeline.acceptance.mts
tests/locus-hosted-multi-library-admission.acceptance.mts
tests/locus-hosted-multi-library-h5.acceptance.mts
tests/part-completion.acceptance.mts
tests/part-optional-parameters.acceptance.mts
tests/part-reference-diagnostics.acceptance.mts
tests/part-source-facts.acceptance.mts
tests/parts-members.acceptance.mts
tests/parts-members.types.ts
tests/public-entrypoint-runtime.acceptance.mts
tests/public-entrypoint-surface.acceptance.mts
tests/refined-public-api-examples.acceptance.mts
tests/reserved-data-names.acceptance.mts
tests/schema-editor-proof.acceptance.mts
tests/schema-editor-tsserver.acceptance.mjs
tests/schema-editor-view.acceptance.mts
tests/schema-hson-public.acceptance.mts
tests/schema-type-query-provenance.acceptance.mts
tests/vscode-schema-tooling.acceptance.mts
```

### Maintained documentation

```text
docs/canonical-interactions.md
docs/contracts/d4c-implementation-report.md
docs/contracts/hson-schema-mvp.md
docs/contracts/part-argument-direction.md
docs/contracts/styled-part-composition.md
docs/echo/api-echo.md
docs/hson-extension.md
docs/livemap/api-livemap.md
docs/livemap/schema.md
docs/locus/api-locus.md
docs/public-api.md
docs/release-notes/v3-5.md
docs/transform/api-transform.md
```

### Preserved owner changes

```text
editors/vscode-hson/package.json
editors/vscode-hson/src/appearance-branding.generated.ts
editors/vscode-hson/src/appearance.ts
editors/vscode-hson/themes/hson-house-dark-color-theme.json
editors/vscode-hson/themes/hson-house-light-color-theme.json
```


## Frozen-tree failure recovery — 2026-11-04

Status: targeted corrections implemented; individual validation passes; independent re-review required. The full 134-check gate has not been rerun. Its final proof remains the normal frozen-tree commit hook's responsibility.

### Preserved candidate and evidence

- Branch `main`; HEAD `dc0fd0b11ac518f6a7322b3f820882c96660c447`.
- The 146-path staged candidate remains `4e727b87b2a93af51f46c29ab5b3f40e3028fcf7`; corrections are unstaged against it. No index clearing, staging, reset, worktree, commit, push or cleanup is performed.
- Failed report `.git/validation-reports/2026-11-04T15-08-18.176Z-gbI4HO/` is preserved. It recorded 125 passing and nine failing checks. Root installation, build, declaration/test compilation and inventory preflight succeeded; gate stages did not overlap.
- README, the five owner appearance paths, Deck, Scout and repository distribution outputs are outside this correction. README's previously recorded owner follow-up remains.
- Validation uses a Git archive plus only the correction files at `/private/tmp/hson-d4c-recovery-f4mlq71j/checkout`, with compiled artifacts and logs outside the repository. The old `/private/tmp/hson-d4c-package` source differs from the failed frozen candidate in ten files; its earlier focused passes did not certify that final candidate.

### Corrections and unchanged contracts

Five test fixtures still supplied serialized JSON directly to value-oriented Library admission. Only those source-intended inputs now use `Hson.data.fromSource()`: the array-index JSON serialization, the exact-route registry helper and ordered fixtures, the SSR ordered fixtures, the collection capability's ordered object, and the client composition's server/initial/later/addLibrary inputs. Ordinary-object inputs and intended literal strings retain value semantics. Order, signed zero, graph equality, closure, SSR, capability and Worker assertions remain.

The CSS queue fixture now requires an actual `HsonDataValue`, materializes explicitly, and compares each complete red/blue batch, including all three declaration lists, selectors and media scopes. Existing revision, final-rule identity, no-op, revocation and publication assertions remain. No implicit JSON serialization was added.

Echo now imports the dependency-free `capture_plain_instruction()` helper instead of full local-initializer admission. It owns the portable `options.now` envelope synchronously inside the existing asynchronous rejection boundary. Transport and other execution capabilities retain their original identities. The existing lazy replica-preparation path still performs full session/initializer admission before composition and attachment, including Schema evidence, QUAD correspondence, scopes, CSS, fingerprints and digests. No initializer format, semantic parser, public API or transport encoding changed.

The editor proof test now executes each independent Program inside `with_program()`. The helper disposes both language services in `finally` and removes their proof maps. Callbacks bound Program/AST lifetimes; cross-case stale-evidence testing retains only generated source text. Comparisons that require simultaneous Programs retain them only through their shared assertions. All 73 original assertion call sites are preserved, including nine alias forms, optional-chain repairs, adversarial diagnostics and D4c producer/value cases. No test case, proof condition, default heap limit or production editor implementation was removed or relaxed.

### Individual validation

| Former failure | Preserved failure | Corrected result |
| --- | --- | --- |
| hson-array-index | Schema expected array, received string | Pass: all 14 checks. |
| livemap-exact-route-closure | Schema expected object, received string | Pass: all 24 checks. |
| public-surface | Packed endpoint Echo retained full LiveMap construction | Pass: declarations, packed consumers, graph boundaries and runtime identity. |
| hosted-css-authority-repairs | JSON.stringify exposed an opaque empty payload object | Pass: semantic red/blue batches and full authority/revocation cases in Node and Worker. |
| production-dependency-boundary | Eager Part processing owners in endpoint bundle | Pass: emitted ownership and original graph/size assertions. |
| libraries-ssr | Ordered source graph equality false before cut/bootstrap | Pass: all 29 checks. |
| schema-editor-proof | Default-heap V8 exhaustion, SIGABRT | Pass at the ordinary default limit: final complete run 27.733 seconds, peak RSS 2,169,651,200 bytes versus failed isolated candidate 4,349,706,240 bytes. |
| library-capability | asObject() returned undefined for literal string Data | Pass: declarations in both optional modes, Node and Worker. |
| client-library-composition-6a5 | Source graph equality false after composition | Pass: initial/later composition and five CSS groups each in Node and Worker. |

The resource correction addresses demonstrated cumulative fixture retention: repeated complete authored/live-view and direct compiler Programs shared one broad test lifetime. Bounded scopes plus disposal complete the same assertions with substantial default-heap headroom, without explicit GC or a heap override. The final run reports 517,486,376 bytes of heap used at exit, an unchanged 4,345,298,944-byte heap limit, and no NODE_OPTIONS override. It releases an alias comparison Program before later comparisons, retaining at most the two Programs required by a cross-program assertion. This evidence does not establish a production editor leak or require changing HsonDataValue.

Comparable endpoint initial bundles, using the tests' editor-installed esbuild 0.25.9 and identical options:

| Initial endpoint graph | D4b | Failed D4c | Corrected D4c |
| --- | ---: | ---: | ---: |
| Gzip bytes | 41,536 | 264,410 | 42,093 |
| LiveMap modules | 4 | 54 | 4 |
| Locus modules | 2 | 5 | 2 |
| Part processing owner retained | No | Yes | No |

The corrected delta is the lightweight capture helper, which has no imports. No new size threshold was introduced. The existing public-surface and dependency-boundary suites both pass. Separate D4b/corrected-D4c encoders match all 42 request, acknowledgment and retained-status comparisons for 14 semantic values, including literal-looking strings, ordered keys and signed zero.

Focused regression validation passes for Echo initialization in Node and a real Worker; immediate mutation/revocation of nested correspondence/CSS; scoped evidence capture; malformed admission and transport release; initial/later installation and identity; fingerprint/correspondence forgery rejection; flat definitions in both optional modes and Node/Worker; Data/Part forwarding and strict wire decoding; submission ownership; exact setters; 106 Document composition groups each in Node and Worker; Echo endpoint core; and hosted action publication. Additional external probes cover reflection-cause preservation, accessor/cycle rejection, asynchronous capture failure and absence of attachment effects.

Source, test, tooling and editor/plugin typechecks pass. Inventory preflight passes with the same 134-check ordinary gate; scoped whitespace validation and package entrypoint checks are included in the recovery evidence. An initial test-type failure exposed the broad request payload union; the corrected CSS fixture explicitly narrows to the carrier before materialization.

### Unstaged correction inventory and re-review

The eight requested implementation/test paths are:

- `src/api/echo/echo.ts`
- `tests/hson-array-index.acceptance.mts`
- `tests/livemap-exact-route-closure.acceptance.mts`
- `tests/libraries-ssr.acceptance.mts`
- `tests/fixtures/library-capability-cases.mts`
- `tests/client-library-composition-6a5.acceptance.mts`
- `tests/fixtures/hosted-css-queue-revocation-cases.mts`
- `tests/schema-editor-proof.acceptance.mts`

Two additional paths are necessary: this report, to reconcile prior claims and inventory; and `scripts/validation-config.mjs`, solely to refresh the exact source SHA-256 of the client-composition test's existing reviewed Worker launch. Inventory preflight rejected the stale hash after the fixture migration; the launch route and coverage remain unchanged.

Independent re-review must examine the explicit source migrations, semantic CSS assertions, synchronous capture/lazy qualification boundary and compiler fixture lifetimes, together with the source-pin update. Approved D4c carrier, literal-string, Schema, Part, ordering, submission-ownership, CSS, initializer correspondence and wire contracts remain. D4d graph authority and Locus performance changes are excluded. A commit is not authorized by this correction task.
