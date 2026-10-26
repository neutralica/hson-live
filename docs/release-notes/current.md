# Hson release notes - vX

- Locus uses flat keyed definitions with `access` metadata and separate configuration; dynamic admission is `await locus.admit(definitions)`.
- LiveMap, Locus, Echo replicas, read contexts, and writers select `data`, `doc`, and `parts`; the former `.lib(...)` selector is removed.
- Local `addLibraries()` returns `{ commit, libraries }`; shape commands use `.object` and `.array`.
- Part definitions require the valueless `hson:part` flag on their single root; governed realization removes it before publication. Definitions without it are invalid.
- Part members require `kind: "document"`, authored `document`, optional structured `css: CssMap`, and separate textual `stylesheet`; protected CSS fields require whole definitions.
- `part.write(args?)` authors a deferred receiver-relative invocation; `Hson.document` returns `HsonAuthored`. Quoted interpolation supports prefixes, suffixes, and multiple scalar slots.
- Authorized hosted scoped SSR, continuation, and recovery are supported. Public local capture/cut and full-authority `locus.cut()` still reject scoped documents.

- Reworked Hson interpolation around grammar context: whole quoted "${value}" interpolation became string substitution, while unquoted ${value} became structural document content or exactly one HsonData value. The temporary #${...} syntax was removed.
- Tightened HsonDocument special-tag rules: <style> is empty or exactly one nonempty string leaf; <script> requires src and does not permit an inline body.
- Removed older transform transport markers such as _hson_str / _hson_elem from ordinary Hson-facing structure, keeping transport evidence reserved to the transform layer.
- Hardened the editor/compiler grammar model for incomplete Hson: added compiler-owned completion/introspection for HsonData members and Schema positions, grammar fallback behavior, interpolation-aware completion boundaries, and static HsonData-versus-HsonDocument mismatch diagnostics.
- Refactored LiveMap around a fixed named-library registry rather than a solo-map model. The old solo LiveMap/one-library architectural path was progressively retired rather than retained as a compatibility facade.
- Separated fixed application-library topology from transactional/system state and converged LiveMap on one map-global transition authority.
- Introduced the explicit `private | shared | local` ownership catalog: private/shared current state belongs to Locus, while validated local initializers remain outside authority state.
- Introduced authorized per-session projections so each hosted client receives only the libraries and capabilities granted to that session.
- Retired the historical one-map hosted Locus protocol; even one-library hosted applications now use the registry-based Locus/projection architecture.
- Made generated QUID identity runtime-local rather than durable application identity. Hosted client commits, snapshots, replay and synchronization became QUID-free; client runtimes establish their own local node identity.
- Moved hosted continuity toward portable path/replacement lineage rather than relying on exact QUID continuity across authority, persistence and replicas.
- Separated the client replica’s composed `echo.rev` from `echo.sync.appliedRev`, the contiguous authority revision Echo processed. Local state coexists with authority replay/reconcile without conflating the two clocks.
- Reworked hosted synchronization around projected commits, authority-progress events and projected reconcile, while preserving client-owned local libraries in place.
- Hardened hosted egress so private and unselected state cannot escape through bootstrap, live traffic, replay, fallback or cuts; wire-size limits are applied after per-session projection.
- Reworked hosted SSR/current-state materialization around session projections. `session.now(...)` packages coherent shared authority state, authorized local initializers and any explicitly selected shared rendered document.
- Moved local rendering to document-library render(), and added coherent selective map.cut({ data?, documents?, html? }) returning libs with optional HTML.
- Completed the registry-only LiveMap construction model, including zero-library hsonLiveMap.create(), fromLibraries(...), broad ANY data/document modes, and primitive data roots.
- Added dynamic library admission as a real LiveMap topology mutation. The final public surface became map.addLibraries(...), returning a LiveMapCommit; earlier factory/map.lib.add variants were removed.
- Extended dynamic library admission through hosted authority, persistence, checkpoint/restart, replay and projection so topology changes use the same local/hosted model rather than a local-only escape hatch.
- Tightened restore semantics so restoring prior state cannot invalidate library topology that the current LiveMap type/runtime guarantees.
- Fixed broad document path typing so unknown/broad document structure no longer collapses .at(...) and related path APIs to never, while precisely known Schema paths still reject invalid addresses.
- Added document-library-owned portable CSS state. Document roots gained .css.stylesheet(...); complete stylesheets are parsed into canonical PortableDocumentStylesheet state rather than treated as opaque DOM-side strings.
- Unified stylesheet parsing for document CSS and LiveTree global CSS through the CSS-tree parser, preserving authored order, scopes/resources, declarations, !important, keyframes/property definitions and deterministic stylesheet identity.
- Integrated document-owned CSS with LiveMap revisioning, capture/restore/replay and SSR rendering, while keeping QUID/node/runtime styling owned by LiveTree.
- Kept document CSS root-only: child document/path handles do not acquire independent portable stylesheet state, and data libraries reject document-CSS operations with explicit mode errors.
- Reworked Schema tooling so authored TypeScript is no longer rewritten to attach generated Schema evidence. Schema precision now comes from a generated .hson compiler-input project and editor/compiler virtual evidence.
- Added live Schema precision to the TypeScript/editor path for unsaved source, with diagnostics and navigation mapped back onto authored files rather than generated source.
- Made compiler projects the default Schema build model, separating ordinary runtime JavaScript output from precise generated declarations and moving generated Schema evidence to package-owned locations.
- Simplified generated Schema state to one current .hson repository instead of retaining revision history as normal operational state.
- Hard-cut legacy Schema compatibility from normal generate/watch/verify/check/build paths. Old injected wrappers, proof masks, colocated evidence, old Watch protocol forms and other legacy layouts now require explicit migration.
- Moved old .hson/revisions adoption completely behind explicit migration. Normal tooling no longer silently adopts or prunes historical generated layouts; migration performs guarded ownership/digest/symlink validation before cleanup.
- Added post-hoc map.lib(...).schema.use(...) for local LiveMaps. Attachment is tightening-only from ANY to one specific same-family Schema, is atomic, revisions/publishes once, and has portable replay/capture/restore semantics.
- Extended schema.use(...) into compiler/editor flow refinement so code after a supported direct attachment receives the same precise Schema-derived library/path typing as construction-time Schema attachment.
- Hardened Schema declaration emission and discovery around refined maps: duplicate Schema discovery now withdraws precision consistently, refined library handles can escape through declarations safely, and proof insertion respects unbraced control-flow structure.
- Unified LiveMap observer delivery so one failing observer no longer prevents delivery to the rest; observer failures are isolated and surfaced through the runtime error-reporting path.
- Removed a large body of retired library machinery, including historical solo-Locus evidence, obsolete LiveMap bridge/replay/store/feed/watch modules, predecessor Schema pipelines, stale utilities and dead fixtures.
- Data-only hosted replication remains independent of document, HTML, SSR, LiveTree, and Mirror. The current client path is `hsonLiveMap.echo.create({ now, credential, transport })`, which performs initial synchronization before resolving.
- Fixed endpoint-only Echo hosted framing. Public endpoint-only Echo now configures the same hosted aggregate wire format already used by composed Echo, allowing normal public Locus session creation replies to decode correctly.
- Added real public Echo-to-Locus socket integration coverage and malformed hosted-reply coverage so endpoint session establishment is now tested through the actual wire encoder/decoder boundary rather than only semantic/internal fixtures.
- Fixed Locus semantic no-op acceptance under active projections. Same-value and other idempotent LiveMap operations now remain successful no-ops without fabricating authority revisions, projected progress, history entries, wire events or commit notifications.
- Added hosted no-op coverage across attached, retained, empty-projection and non-resumable projection cases, including equal replacement, absent-attribute drop, private-library changes, subsequent real mutations, replay, reconcile and action completion semantics.
- Expanded the effective external integration coverage substantially through the LiveDemo migration, which exercised current public named-library, Schema, Locus, Echo, projection, synchronization, Node and Worker paths and resulted in the library fixes above rather than application-level compatibility workarounds.
- Retained authorized sessions now use `locus.session.create/get/debug/onChange/dispose` and capability `now/update/revoke`. `now()` carries shared authority state and authorized local initializers, optionally with explicitly selected shared HTML. Credentials remain separate; session HTML defaults and the hosted rendering wrapper have been removed.
- Established distinct Mirror, Echo, and Locus roles for hosted live applications, including pessimistic authoritative authoring and revision-based completion.
- Consolidated Locus lifecycle and authority APIs around creation, durable resume, persistence, and explicit client-public/server-private library admission.
- Simplified LiveMap and Locus write surfaces with path-owned mutation, atomic batching, and staged authoritative writes.
- Added object-owned SSR cut/render primitives and strengthened non-destructive LiveTree DOM graft/continuation workflows.
- Added Scout, a declarative browser ignition mechanism supporting progressive enhancement from inert server-rendered HTML.
- Added Schema configured relational uniqueness for finite projected-key constraints.
- Expanded Schema unions to n-ary ordered unions with bounded distinguishability analysis.
- Reworked Schema admission to tolerate presentation differences while preserving semantic validity.
- Replaced source-byte Schema identity with deterministic ordered-definition Schema identity.
- Added full physical multiline Hson string support with normalized framing, dedent semantics, and readable/no-break serialization.
- Extended static Hson proof analysis through TypeScript aliases, imports, chains, and transparent generic wrappers.
- Introduced HsonFromSchema<S> and data-only JsonFromSchema<S>, retiring the ambiguous public SchemaType<S> model while retaining document graph evidence internally.
- Repaired ESM subsystem boundaries and tree-shaking, allowing lean LiveMap/Echo imports without dragging unrelated authority/compiler/runtime code into client bundles.
- Expanded VS Code Hson tooling with structural indentation, embedded delimiter-depth highlighting, and standalone .hson formatting support.
- Advanced Deck as an integration application, exercising governed data, Schema-derived types, live authority, SSR/continuation, and Hson-native rendering patterns.

## Templating & QUADs v0.1
A major push into templating patterns as a first-class operation. Developed composable markup templates, a `Collection` library type for template `Parts`, and QUADS, Quantum Unique Addresses - the authorable, portable, external analogue to QUIDs. 
- Governed Part collections: Reusable, validated document definitions with optional CSS, stored as inert data Libraries.
- Automatic Part composition: `<hson-part>` connectors expand recursively during document admission and supported mutations, without a separate templating API.
- Inline parameters: `%{name}` placeholders support type-preserving scalar initialization and partial string substitution.
- Occurrence-scoped CSS: Part styles automatically scope to each instance, including root and nested selectors, without requiring authored QUADs.
- Automatic CSS lifecycle: Instance-owned styles are installed and removed atomically with their corresponding document subjects.
- Public document `.q(name)`: Identity-following QUAD locations support ordinary document reads and edits, movement, and safe handle retirement.
- QUAD/QUID identity improvements: Sparse identity issuance, explicit receiving QUAD promotion, stronger replacement continuity, and authority-lifetime protections.
- Portable document CSS: Subject identities and styles survive capture, restoration, SSR, and browser grafting with fresh runtime identities.
- LiveTree/Mirror improvements: Existing DOM Elements retain identity and receive updated CSS identity carriers without replacement.
- Expanded validation: Additional Node, Worker, and real-Chrome acceptance coverage for composition, CSS, identity, mutation atomicity, and no-JavaScript rendering.

## Templating & Quads Part 2

- Added governed Part collections and recursive document composition. Introduced reusable document definitions, `<hson-part>` connectors, scalar placeholder substitution, nested composition, and atomic realization during document admission.

- Implemented authored QUAD addressing and scoped Part namespaces. Added semantic `@:name` declarations, connector-to-occurrence bindings, independent namespaces for repeated Parts, and sparse runtime QUID ownership.

- Added occurrence-owned CSS and scoped subject identities. Part stylesheets are scoped to their realized occurrences, with identity-aware ownership, retirement, and cleanup.

- Completed scoped document capture, reconstruction, and Echo reconciliation. Preserved authored associations, occurrence topology, CSS ownership, and distinct receiving identities across snapshots and state restoration.

- Extended durable scoped-state persistence. Added scoped checkpoint capture/restoration, durable effect tails, replay, and fresh-process authority recovery.

- Expanded scoped transaction coverage. Supported CSS-only mutations, whole-document replacement, ordered mixed graph/data/CSS operations, and atomic rejection.

- Preserved scoped topology during dynamic Library admission. Dynamically admitted Part-composed documents retain their namespaces, occurrence lifetimes, subject associations, and CSS ownership across subsequent operations and recovery.

- Corrected staged document-path addressing. Direct, batched, and Locus-staged document operations now resolve consistent logical paths against progressively updated transaction candidates.

- Preserved Echo HTML-producer semantics. Document rendering functions retain their HTML-producer metadata when exposed through Echo, including use as LiveHost request handlers.

- Expanded typed Library admission and location inference. Introduced typed admission receipts, more precise Schema-derived paths, validated location refinements, and improved public capability types.

- Unified collection operations under `.array` and `.object`. Restored shape-specific namespaces across LiveMap, Locus, and Echo; added observational array mapping and authority-safe, candidate-relative collection mutations. Removed the former flat collection-method surface.

- Completed governed document capability parity. Expanded attribute, flag, CSS, and authored-QUAD operations and observations across local Libraries, authoritative Locus, staged writers, read-only contexts, and Echo projections.

- Enabled public hosted scoped-state delivery. Authorized Echo sessions can receive scoped document Libraries, live updates, dynamically granted Libraries, ordered replay, and coherent recovery through existing HTTP and WebSocket transports.

- Preserved flat and scoped documents within shared transactions. Introduced per-document scoped preparation, retaining the distinction between never-scoped, actively scoped, and explicitly scoped-empty documents without compromising atomicity.

- Enabled coherent scoped server-side rendering. Hosted sessions can render Part-composed documents with complete scoped CSS and transferable state from one authorized snapshot, supporting native first paint without browser JavaScript.

- Added authenticated receiver-owned identity handoff. Original SSR subject labels can be validated against independently issued Echo QUIDs, with ownership, CSS correspondence, freshness, reconciliation, and transport-lifecycle fencing.

- Enabled non-destructive hosted browser continuation. Existing server-rendered flat and scoped documents can be adopted into LiveTree and Mirror without replacing compatible DOM elements, losing listeners, or duplicating identity ownership.

- Added native CSS and subject-identity handoff during continuation. Portable SSR markers and stylesheets are translated into receiving-owned identities while preserving computed styles and managed stylesheet ownership.

- Extended incremental flat-document replay with authenticated CSS correspondence. Supported subject-owned CSS across authoritative graph, attribute, flag, text, movement, replacement, and styling operations, including newly demanded receiver identities and correct retirement.

- Preserved flat transaction semantics through replay and persistence. Added complete-candidate CSS validation, order-independent graph/CSS cleanup, stable mixed-Library effect ordering, and correct no-op behavior without unnecessary revisions.

- Completed live scoped DOM synchronization. Authoritative changes propagate through Echo and Mirror to adopted document elements, preserving surviving identities, isolating repeated Part occurrences, and retiring removed subjects and their styles.

- Strengthened browser-continuation startup rollback. Added native DOM checkpoint restoration across failed adoption, recovery, and attachment, including failures during cleanup, preservation of original node references and listeners, and safe retry on the same document.

- Completed hosted continuation lifecycle integration. Established coherent reconnection, missed-revision recovery, reconciliation, projection reduction, revocation, disposal, and identity-lifetime behavior across the authoritative state, receiving runtime, and browser DOM.


## Templating & Quads Part 3

### Part definitions and structural composition
- Explicit Part declarations: Added the mandatory `hson:part` flag on the root of every governed Parts Library definition, visibly distinguishing Part source from ordinary Hson Documents.
- Structured Data inputs: Parts can receive complete HsonData values, including nested objects and arrays, through explicit `data:` receiving declarations.
- Authored Document inputs: Added corresponding `doc:` receiving declarations for supplying authored Hson Documents and deferred Part invocations.
- Local binding syntax: Introduced `#{name}` and `#{path.to.value}` for references to locally declared Part data and documents, distinct from incoming `%{name}` parameters.
- Structural Document placeholders: Added `<hson-part #{control}/>` for inserting supplied authored Documents or Part invocations directly into a Part's structure.
- Optional composition: Added `part:optional` for conditionally realizing elements, subtrees, and nested Parts according to the presence of referenced values.
- Nested structural composition: Supports recursively composed Parts with independent occurrence identities, authored QUAD scopes, and managed stylesheet ownership.

### Part authoring ergonomics
- Prefix-free `.write()` arguments: Part invocations now accept ordinary JavaScript argument names, such as `.write({ payload, control, title })`, with their Data/Document representation determined by the receiving Part definition.
- Deferred Part invocation: `.write()` produces an authored connector rather than eagerly expanding a definition. The receiving admission process resolves and realizes the Part.
- Explicit receiving interfaces: Structured Data and Document arguments are declared at the Part root, providing unambiguous interpretation and validation.
- Presence-based optionality: Optional composition distinguishes missing values from present values such as `null`, `false`, `0`, and empty strings or collections.

## Changed

### Admission, realization, and ownership
- Part definitions now require exactly one valueless `hson:part` declaration on their authored root.
- Missing, malformed, duplicated, valued, misplaced, or incorrectly cased declarations are rejected atomically during governed Part admission, including for definitions that have not yet been invoked.
- Part-specific declaration attributes are retained in authored source but removed during governed realization, never appearing in canonical Documents, rendered HTML, SSR output, or document transport.
- Structured receiving interfaces are validated before realization, including cases where optional content would otherwise be omitted.
- Structural insertions are realized under their appropriate Part occurrence and authority, preserving local QUAD/QUID identity and CSS scoping.
- Placeholder substitutions preserve authoring boundaries rather than recursively interpreting arbitrary inserted content.

### VS Code authoring experience
- Added context-aware Part argument completion, including completion inside `.write({ ... })` calls.
- Added completion support for identifier, quoted, escaped, and hyphenated argument names.
- Added diagnostics for missing or invalid `hson:part` declarations, unsupported bindings, and invalid reference contexts.
- Expanded shared source-fact analysis for Part receiving declarations, local references, structural insertions, and contextual editor assistance.
- Improved structural editing, delimiter insertion, closing-delimiter handling, and associated command-level editing behavior.

## Improved syntax highlighting

Expanded TextMate and semantic-token support to visually distinguish:

- `hson:part` declarations and ordinary flags.
- Tags, attribute names, assignment operators, and quoted values.
- Incoming `%{}` versus local `#{}` placeholders.
- Placeholder sigils, braces, and property paths.
- Structural Document insertion syntax.
- QUAD/QUID identity punctuation and identifiers.
- Escaped property selectors and multiline attributes.

Updated existing theme integration, including the Dark 2026 theme, to provide more differentiated syntax coloring without introducing a separate highlighting system.

## Fixed and hardened

- Corrected Part argument completion in malformed or partially typed TypeScript, preventing unsafe edits to methods, accessors, and recovered shorthand members.
- Corrected TextMate scope leakage involving escaped selectors, keyword-like attribute names, and multiline attribute assignments.
- Strengthened strict validation for malformed structured inputs, structural placeholders, and Part declaration placement.
- Expanded regression coverage for optional composition, nested Parts, identity scoping, CSS ownership, admission atomicity, source retention, and realized output.
- Expanded Node, Worker, hosted, SSR, and browser acceptance coverage for the new Part authoring features.

## Runtime and bundle improvements

- Separated Part-definition validation and receiving-interface processing from the eagerly loaded placeholder parser.
- Deferred definition-processing code outside the initial Echo endpoint bundle.
- Reduced the measured initial Echo bundle from 41,098 to 40,017 gzip bytes, restoring compliance with the existing 40 KiB budget without raising the limit.
- Added a dependency-boundary regression guard that detects accidental eager inclusion of Part-definition processing independently of filename, chunk layout, or compressed size.

## Migration notes

- Breaking authoring change: Every Part definition in a governed Parts Library must now include `hson:part` on its single root element.
- Existing maintained Part definitions and stored-source expectations were migrated; ordinary Documents and `<hson-part>` invocation connectors do not use this declaration.
- Part `.write()` callers use plain argument names; typed receiving declarations determine how values are transported.
- No compatibility path was added for unmarked Part definitions.
