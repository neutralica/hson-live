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
