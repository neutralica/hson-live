# Private D1 trusted Schema diagnostics

This is an explicitly enabled, trusted-project Node runtime, not a sandbox or
automatic discovery system. None of these modules is a package entrypoint.

## Direct lifecycle evidence

The private `capture_trusted_schema_template` tag accepts only substitution-free
authored Hson. A WeakMap keys occurrence identity by the JavaScript
`TemplateStringsArray`, never by canonical text. `construct_trusted_schema_application`
constructs the actual LiveMap itself and captures its initial `rev` in private
weak storage. It cannot attest to an arbitrary pre-existing map.

`attempt_trusted_schema_attachment` records the proposed Schema reference before
calling the existing `map.schema.use`. Successful and rejected attempts retain
separate association handles. Revision changes before or during attachment make
correspondence unavailable, including mutate-then-revert. No caller-supplied
mutation verdict is accepted by the wire protocol. Attachments do not change
public LiveMap behavior. The helper reports an attachment exception in its
private result rather than replacing the library's validator.

## Runtime compatibility

The configured `hson` facade must be the exact facade loaded beside D1's
validators. Exported `trustedSchemas` require the matching project `hson` export;
non-exported Schema registrations carry the actual origin facade instead.
Each Schema must also be present in the validator's existing private data
or document capability registry. A matching facade or package version alone is
insufficient. No Schema is cloned or reconstructed. Other runtime instances are
unsupported and fail closed. Each generation allows one project load attempt;
loading again requires a replacement generation (no hot reload).

## Owned process and restart budget

Both trust flags are checked before spawn or project import. The initial launch
does not consume a restart. Every later launch attempt consumes one slot before
spawn, including failed startup attempts. The default lifetime budget is one
replacement. Successful handshake/validation does not reset the counter.
Exhaustion throws the private infrastructure error
`RESTART_BUDGET_EXHAUSTED`, never a Schema mismatch, and does not spawn.

A request deadline retires the child, rejects all its pending requests, removes
their message listeners, and sends SIGKILL. Retirement makes the active generation
unavailable immediately. Acceptance requires the captured process, active
generation, response generation, request ID, and protocol version to match.
`terminate` permits a budgeted replacement; `dispose` permanently closes the owner.
The private process-factory seam enables deterministic stale-response and
execution-boundary tests without exposing a public test hook.

## Acceptance

`npm run test:trusted-schema-d1` contains the end-to-end fixtures, deterministic
process-boundary checks, public export graph checks, and executed timing probes.
Negative type imports also live in `tests/entrypoints/public-entrypoints.ts`.
The D2 VS Code client reuses this process supervisor and protocol. Arbitrary
provenance tracing and automatic Schema instrumentation remain out of scope.
Source-bound interpolation capture is described under D5 below.

## D2 direct-source association

`associate-source` is separate from `associate`: it records a static relationship
between a template occurrence and a later `validate` call, not execution of
the application statement and not a map attachment. It includes template/call
identities, document/template/association revisions, source binding and Schema
handle; the protocol envelope binds it to one runtime generation. Validation
requires every identity to match. Disposal removes only that site's association.

Exported `trustedSchemas` gain source mappings only where an actual module export
is the identical registered object. Handles need not equal variable names. A
private optional `trustedSchemaBindings` array can connect a registration handle
to another module's named export:

```js
export const trustedSchemaBindings = [
  { schemaId: "userContract", binding: { moduleUrl: new URL("./schema.js", import.meta.url).href, exportName: "UserSchema" } }
];
```

Each export mapping is checked against the actual exported object. Private
development registration accepts an optional fourth argument for a non-exported
source declaration: `{ moduleUrl, localName, declarationStart }`, where the
offset is its TypeScript VariableDeclaration start in the source module. This
is explicit trusted development metadata, not inferred name equality. The hook
remains private and is imported by filesystem path only in development tooling.

Repeated IDs retain all registrations. Identical objects are idempotent;
different objects fail load as `AMBIGUOUS_REGISTRATION`. Different IDs mapping
one source binding to different objects fail association as ambiguous. Multiple
validation sites referencing one object are not ambiguous and execute separately.

Both D1 and the public boundary use
`internal/schema-hson-validation/validate-schema-hson-graph.ts`. Data graphs
remain ordered carriers all the way into the authoritative validator; only
constraint callbacks materialize JavaScript values. Direct D2 candidates use
ordinary canonical parsing. D1 lifecycle inputs retain their explicit parse
context. Neither path retries interpretations to find one a Schema accepts.

## D3 natural map association

D3 discovers the bounded `Hson` → `fromHson` → `map.schema.use` relationship.
Discovery alone is **not** authority. The existing trusted registration provider
must supply source-bound D1 lifecycle captures; an old unbound D1 capture or a
Schema-only registration cannot attest to an arbitrary application's map.
Without matching lifecycle evidence the editor reports association unavailable.
It does not import an open application file to try to obtain that evidence.

`instrument_trusted_schema_map_sources(fileName, source, helperModuleUrl)` is a
private, explicit provider build step. It returns a diagnostic copy of the
original source, replacing only recognized tag, constructor, and attachment
call sites with `source-lifecycle.ts` calls. It does not execute code, install a
loader, register Schemas, rewrite `schema.define`, or alter production output.
The configured provider chooses which copy to execute through the existing D1
load path. Keep that provider focused on safe diagnostic setup: copied code,
including mutations and other statements, really executes with project trust.
Preserve the source module's import resolution when building the copy. The
integration fixture in `editors/vscode-hson/tests/integration/run.mjs` demonstrates
an explicit provider using a separate Schema module and original source text.
These helpers have no package exports and are not a new public validation API.

The private session checks the actual official tag and constructor identities,
uses D1's exact `TemplateStringsArray` capture, and constructs the actual map via
D1. The canonical equality guard only checks the already-selected occurrence;
it never searches for an occurrence by text. A WeakMap connects the actual map
to its D1 application. The original intervening mutations execute on that map.
D1 records each attempt before attachment can reject. As in the original D1
helper, the diagnostic copy retains rejection evidence and can collect further
independent attempts; it is not an assertion about application control flow.

Supported relationships are local `const` declarations in one module/function
body, parentheses, bounded identifier-only canonical/map/Schema aliases,
named relative Schema imports, and inline templates inside
`fromHson`. Attachment uses are standalone expression statements in that same
body. Conditional/return/expression attachment flow, arbitrary helpers,
transformations and equality recovery remain unsupported. Interpolated tags
add D5's exact evaluated-source requirement below.
Both `hson.liveMap` and the dedicated `hsonLiveMap` facade are recognized by
compiler binding identity on their actual public entrypoints.

Each relationship has module, template, construction and use-site identities,
plus a hash of **all source outside that candidate's body**. Other template
bodies still participate in that relationship's context. A candidate-body edit
creates a fresh revision-bound request and validates its new source; changing
construction, use, binding, surrounding code, or another template invalidates
old lifecycle matching. Normalized offsets keep use/construction identities
stable when only the candidate body grows. Runtime generations and the D2
publication tickets continue to guard every asynchronous stage. Source modules
with lifecycle evidence join the existing provider-change invalidation set.

The runtime resolves the attempted Schema object through D2's existing verified
bindings. It requires a unique matching proposal, actual direct correspondence,
and a validating initial attempt. Same-object idempotence and rejected Schema
replacement do not revalidate the graph, so they add no authoring authority.
A rejected initial attempt does validate and remains diagnosable. Later attempts
after an initial failure can independently validate other registered Schemas.
Map revisions are checked at association and before/after candidate validation.
Mutate-then-revert cannot restore attribution. Each map remains independent.

D3 uses the exact `fromHson` parse boundary (`allowTopLevelDocumentText: true`)
for the current candidate. It then uses the same ordered graph validator and
C1/C2 lowering as D1/D2, with actual current root classification. A quoted text
root is therefore ordered document content at this map boundary; standalone
`schema.validate` retains ordinary canonical interpretation. No alternate parse
is attempted to make a Schema succeed.

The VS Code client uses the same supervisor, trust/enablement gates, revisions,
diagnostic collection and presentation. Related information names the relevant
`map.schema.use` call. No primary squiggle is placed there for invalid Hson.

## D4 static `fromHson` sources

D4 adds a secure outer source map for exact JavaScript string values admitted
by official Transform, LiveMap, and LiveTree `fromHson` bindings. TypeScript's
parsed literal text is the cooking authority. A private sidecar maps UTF-16
runtime ranges back to literal-body ranges; complete escapes, CRLF
normalization, line continuations, and surrogate pairs remain indivisible where
required. Canonical Hson graphs receive no JavaScript-source metadata.

Supported inputs are direct quoted literals, no-substitution ordinary template
literals, parentheses, and finite same-domain local `const` identifier aliases.
Interpolated templates, concatenation, mutable/imported values, helpers,
properties, `String.raw`, and interprocedural flow are unavailable rather than
guessed. Syntax checking runs without project execution. Boundary identity
selects ordinary Transform/LiveTree parsing or LiveMap document parsing; no
success-driven alternate interpretation is attempted.

For LiveMap only, the existing D3 provider instrumenter wraps the exact
construction call. The helper verifies the official runtime function identity,
captures one source occurrence independently of its text, constructs the actual
map, and reuses D3 attachment and revision evidence. Failed attachment,
mutation/mutate-revert suppression, independent maps/Schemas, runtime
generations, and stale editor publication therefore retain their existing
authority. Static source equality is never used to locate an occurrence.

## Uppercase authoring migration

Authoring discovery recognizes `Hson` from the root or `/hson`, including renamed
imports. Standalone associations recognize `Hson.certify` and both existing
LiveMap Schema validation entrances. The narrow authoring entrypoint no longer
exports the lowercase aggregate or subsystem facades. Aggregate construction
uses root `hson`; dedicated construction uses root or `/livemap` `hsonLiveMap`.
D3 captures the exact `Hson` object. D1 runtime origin registration still uses
the existing noncallable aggregate `hson` from the configured `hson.js` module;
this private runtime requirement does not enter the public authoring graph.

## D5 trusted evaluated interpolation

The same explicit diagnostic-copy instrumenter now wraps discovered official
interpolated Hson tags, including occurrences without Schema relationships so
admission failures can be reported. It does not wrap arbitrary tags, evaluate
expressions in the editor, install hooks, register Schemas, or modify application
source. The provider must evaluate the original source revision, not a rewritten
preview combining new literals and old values.

The wrapper checks Hson identity and invokes the real tag once with the original
TemplateStringsArray and already evaluated argument values. JavaScript evaluates
each expression once in original order. If an expression throws, the tag never
runs and no template evaluation is claimed. The real tag's primitive return or
original exception is preserved. Afterwards, private capture reuses the exact
pure primitive admission encoder to record scalar source. This re-encodes primitive
values, **not expressions**, and performs no second parse, coercion, property
inspection, or cloning. Ordinary Hson shares only that small encoder function;
it imports none of the provider, registry, trace or source-map code.

One private capture contains an evaluation ID, static occurrence/module URL,
SHA-256 of the complete original host document, template/expression ranges,
literal raw strings and UTF-16 boundary tables, alternating generated literal/
substitution intervals (with primitive kinds), completed pre-serialization Hson,
the actual canonical return, or structured failure and offending substitution
index. Partial source is retained when encoding cannot complete. Exact primitive
values are represented by their authoritative scalar source, including -0;
unsupported objects are never retained. Admission/trace timing is separate.
Generation and request IDs belong to the existing protocol envelope, not to
public values. Captures are reset for a new load, capped at 256 evaluations,
1,000,000 generated UTF-16 units per evaluation and 4,000,000 total; overflow
disables the generation's capture evidence, never silently evicts to a last value.

The private `captures` request retrieves current evidence, including admission
errors, under a fresh D1 request ID. D2 association binds the selected evaluation
and source hash to the source relationship, registered Schema handle, editor
version, generation and validation request. It does not depend on successful
execution of the application's validate call. D3 additionally requires that
exact evaluation on the actual map application's attachment evidence. Canonical
equality is never a lookup key. Each Schema relationship validates independently.
Repeated evaluation is ambiguous rather than first/last-wins, even for equal
values. Repetition after association is checked again at validation. Existing
map revisions, rejected attempts, mutation and mutate/revert suppression remain
authoritative. A provider import failure retains prior capture/registration
evidence and reports `loadFailure`; the failed statement is not swallowed by
the tag and no subsequent application execution is claimed.

Generated C1/C2 exact/anchor/unresolved evidence is preserved separately from
host origin: `literal-exact`, `substitution-expression`, `anchor`, `composite`,
or `unresolved`. Any interval wholly within a substitution maps to its AST
expression body (excluding `${` and `}`), never generated quote characters.
Cross-origin ranges enclose their contributing host origins and are explicitly
non-exact. Unresolved locations use the complete template. Raw backslashes,
escaped backticks and escaped `${` spellings are preserved; physical CRLF/lone
CR become LF at runtime with physical host boundary maps. Astral characters
use UTF-16 offsets; parser points use the existing Unicode-safe point mapper.
EOF maps immediately before the closing backtick, including an empty tail.

An editor change immediately clears publication and retires that document's
evaluation evidence before debounce. Unsaved expression/literal edits (including
edit/revert) wait; they do not trigger value replay or consume restart budget.
The existing explicit provider reload/save lifecycle supplies a new generation.
Unchanged generated bytes never override host revision evidence. With either
trust gate closed there is no provider start or runtime-derived validity claim.
D4 ordinary JavaScript string interpolation remains separate and unsupported.

## D6 bounded completion

The warm runtime advertises private `completionVersion: 1`. A `complete` request
uses a short-lived D2/D3 source association and the same generation, identity,
timeout and retirement supervision as diagnostics. Completion never loads or
restarts a project. The editor requires exactly one discovered governing contract;
D4 static source descriptors and JavaScript expression ranges are excluded.

`schema-completion/context.ts` observes grammar slots through the existing
tokenizer's optional private collector. It stops at one proven slot, inserts one
legal probe in an analysis copy and reparses with the authoritative parser and
Phase-B provenance. Probe identity is its exact source range, never a string
search. Probe names exceed the entire source length so authored names cannot
collide. Existing C1/data and document logical resolvers supply paths and
duplicate/presence evidence. No tolerant parser or candidate-by-candidate parse
search exists. Unclosed containers, ambiguous text holes and unrecoverable syntax
fail closed. Source is capped at 128,000 UTF-16 units; traversal has a 64-level
guard and Schema queries have a 512-expansion budget.

`schema-completion/query.ts` reads existing compiled Schema registries. The only
additional retained declaration is the compiled value node alongside a document
attr rule's validator. No predicate is called. Recurse uses the existing memoized
thunk only along queried paths, within the trusted child. Common data
members and finite alternatives can survive unresolved picks; literal evidence
can narrow branches. Document item picks offer tags, while ambiguous content-pick
sequences and same-tag element contracts remain unsupported. No public API or
raw Schema/IR/predicate IPC transport is added.

Without current D5 values, substitution placeholders must be proven complete
Data scalar or document attr-value slots by provenance. They remain opaque
to branch selection. Other runtime-dependent contexts require exact fresh capture
evidence, checked before and after querying. Names and literals use Hson
serializers; template delimiters use equivalent Hson Unicode escapes, and snippet
metacharacters are escaped independently. Ordinary authored attrs are strings;
typed boolean/null attr domains do not acquire fictitious source spellings.
