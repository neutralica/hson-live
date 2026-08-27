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
No VS Code client, arbitrary provenance tracing, automatic Schema instrumentation,
or interpolated template capture is provided.
