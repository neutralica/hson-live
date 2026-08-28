# Private D1 trusted Schema diagnostics

This is an explicitly enabled, trusted-project Node runtime, not a sandbox or
automatic discovery system. None of these modules is a package entrypoint.

## Direct lifecycle evidence

The private `capture_trusted_schema_template` tag accepts only substitution-free
authored HSON. A WeakMap keys occurrence identity by the JavaScript
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
Each Schema must also be present in the validator's existing private projected
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
provenance tracing, automatic Schema instrumentation, and interpolated template
capture remain out of scope.

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
`internal/schema-hson-validation/validate-schema-hson-graph.ts`. Projected graphs
remain ordered carriers all the way into the authoritative validator; only
constraint callbacks materialize JavaScript values. Direct D2 candidates use
ordinary canonical parsing. D1 lifecycle fragments retain their explicit parse
context. Neither path retries interpretations to find one a Schema accepts.

## D3 natural map association

D3 discovers the bounded `HSON` → `fromHson` → `map.schema.use` relationship.
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
named relative Schema imports, and inline substitution-free templates inside
`fromHson`. Attachment uses are standalone expression statements in that same
body. Conditional/return/expression attachment flow, arbitrary helpers,
interpolations, transformations and equality recovery remain unsupported.
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

D3 uses the exact `fromHson` parse boundary (`allowTopLevelTextFragment: true`)
for the current candidate. It then uses the same ordered graph validator and
C1/C2 lowering as D1/D2, with actual current root classification. A quoted text
root is therefore a document fragment at this map boundary; standalone
`schema.validate` retains ordinary canonical interpretation. No alternate parse
is attempted to make a Schema succeed.

The VS Code client uses the same supervisor, trust/enablement gates, revisions,
diagnostic collection and presentation. Related information names the relevant
`map.schema.use` call. No primary squiggle is placed there for invalid HSON.

## Uppercase authoring migration

Authoring discovery recognizes `HSON` from the root or `/hson`, including renamed
imports. Standalone associations recognize `HSON.validate` and both existing
LiveMap Schema validation entrances. The narrow authoring entrypoint no longer
exports the lowercase aggregate or subsystem facades. Aggregate construction
uses root `hson`; dedicated construction uses root or `/livemap` `hsonLiveMap`.
D3 captures the exact `HSON` object. D1 runtime origin registration still uses
the existing noncallable aggregate `hson` from the configured `hson.js` module;
this private runtime requirement does not enter the public authoring graph.
