# Schema editor compiler view — Phase 2

> Historical design record. The current supported workflow is described in
> [Schema compiler workflow](../contracts/hson-schema-compiler-project-phase-4.md).
> Retired layouts and generation labels below are not current supported behavior.


> Historical phase contract. The supported default commands and publishing contract
> are now described in [Phase 4](./hson-schema-compiler-project-phase-4.md).


The TypeScript server plugin now supplies the Schema compiler view in memory.
The authored module keeps its filename and editor text. No producer, sidecar,
manifest, or `.hson/compiler-input` project is written by this integration.
The Phase 1 experimental compiler project remains independent. Default CLI
commands, external Schema Watch, and extension commands/status are unchanged.

## Shared semantics and current revisions

`schema_source_plan` in `source-transformation.ts` owns generated alias allocation,
annotations, assertions, and imports for both the compiler project and editor.
`schema_association_edits` also remains the legacy writer's transformation.
The tag itself is a copied interval; prefix/suffix edits preserve its exact text.
`generate_hson_schema_evidence` supplies the existing value, mode, identity,
refinement, document, recursion, and mutation-candidate types without an editor
type generator. Existing official binding and top-level const restrictions apply.

`install_live_schema_view` captures the original language-service host and uses
an authored analysis service to resolve official Hson imports. Its snapshots come
from that host, so open unsaved buffers take precedence over disk. A changed
authored Program refreshes the overlay; unchanged evidence reuses its snapshot.
There is no workspace module execution or CLI subprocess in this path.

Each producer's stable virtual evidence path is:

```text
<producer directory>/.hson/editor-evidence/<full producer filename>/
  <declaration name>.hson-schema.generated.ts  (or .mts/.cts)
```

These paths are in-memory module identifiers, not generated disk files. Full
producer filenames distinguish same-stem `.ts`, `.mts`, and `.cts` files. One
module owns the unique symbol for each declaration. Schema body edits change
that module's contents rather than introducing a new version-named identity.
Imports from different consumers resolve to the same evidence origin. Identical
Schema text in separate declarations remains nominally distinct.

Malformed, unsupported, or unterminated current Schema text supplies no precise
evidence. Previously generated legacy associations are reduced to broad
`HsonSchema` in the internal view when they cannot be proven from current text.
Repair regenerates evidence immediately. This changes neither disk evidence
freshness nor external watcher recovery.

## TypeScript server integration

The original language service consumes the snapshot overlay. Its internal
lifecycle methods, including `getCurrentProgram`, remain attached to that service.
The plugin registers only virtual evidence as mixed-content `ScriptInfo` records
through the TypeScript server API. This is required by tsserver's shared document
registry; an ordinary standalone language-service host does not require it.
Removed virtual modules detach from their project. Authored ScriptInfo text is
never replaced with generated text.

The previous contributed name `../typescript-plugin` was rejected by stock
TypeScript 5.9.3 before activation. The contribution now uses the existing package
name `hson-schema-typescript-plugin`, a local bundled production dependency.
Extension packaging includes that dependency; runtime plugin loading is tested
through the actual contribution and tsserver protocol, not just Node `require`.

## Coordinate and edit boundary

`SchemaSourceMapping` stores copied UTF-16 intervals computed from the actual
edits. Insertions/replacements form generated gaps. It does not search strings
to infer source positions. BOMs and line endings are interpreted exactly as
provided by the language-service snapshot; byte comparisons independently check
that disk contents remain unchanged.

- Authored positions translate before semantic requests. Mapped results use
  authored offsets and authored SourceFiles for diagnostic line conversion.
- Diagnostics entirely in copied text map exactly. A diagnostic spanning a
  generated boundary maps to the covered authored text. Generated-only spans and
  virtual evidence diagnostics are not presented as authored-source errors.
- Diagnostic related locations are mapped too. Internal evidence paths are
  labeled by authored module/declaration; real application errors remain.
- Definitions, references, rename locations, hover ranges, signature ranges,
  highlights, semantic classifications, and completion replacement spans are
  mapped. Generated-only navigation targets are omitted.
- Rename and completion edits must fit wholly within copied intervals. An unsafe
  generated edit is omitted; generated coordinates are never returned as an
  authored-file write.
- Formatting, organize imports, refactor/code-fix generation, syntax outlines,
  and other source-editing APIs use the authored analysis service. They cannot
  propose injecting the compiler-view imports or assertions. These APIs do not
  yet receive the precise transformed Schema view; adding richer Schema-aware
  refactors/inlay presentation is outside this phase.

The existing static Schema-assignment diagnostic proof filter remains in place,
but verifies the current virtual evidence with the shared evidence generator.
It continues to reject invalid candidates and wrong Schema associations.

## Validation and later boundaries

After a library build, run:

```sh
npm run test:schema-editor-view
npm run test:schema-editor-tsserver
npm run test:schema-editor-proof
npm run test:hson-schema-compiler-project
npm --prefix editors/vscode-hson run check
```

The editor-view suite uses stock TypeScript 5.9.3, current unsaved snapshots,
the complete Phase 1 precision fixture, positive and negative type probes,
position assertions, and exact disk-byte comparisons. The tsserver suite tests
activation, diagnostics, definitions, references, rename, completion, identity,
unsaved valid/invalid/repair sequences, and disk integrity using protocol requests
over process pipes. It starts no browser or Schema Watch process.

The broad repository `check` and default pre-commit hook invoke the external
Schema Watch acceptance test. They are not the safe Phase 2 validation entrypoint.
The unrelated extension unit case `direct LiveMap fromHson literal receives
secure syntax diagnostics` fails on the baseline after 36 passing cases; Phase 2
does not alter that behavior. Structural editing tests are independently runnable.

Phase 3 still owns external watch triggers, stale disk artifact cleanup, retries,
and transactional publication. Phase 4 still owns the default CLI cutover,
legacy writer removal, declaration emission and publishing closure. This phase
does not make ordinary `tsc` consume editor-only snapshots: stock CLI checking
continues to use the explicit Phase 1 generated project.
