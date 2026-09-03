# Test project policy

`tests/tsconfig.json` strictly type-checks the maintained TypeScript acceptance
tests (`.mts` and `.ts`) together with current library source.

The Locus `.mjs` files under `runtime-probes/` are deliberately JavaScript runtime protocol
probes. They inject malformed and partial wire envelopes and use lightweight
in-memory socket doubles to exercise rejection, recovery, tracing, session, and
deduplication behavior. They remain runtime-tested by the package scripts but
are not presented to editors as maintainable TypeScript source. This avoids an
inferred TypeScript project while preserving their intentionally dynamic role.

Executable suites are the test authority. Each suite keeps its literal
`suiteMetadata` beside the executable cases and emits real case begin/end
events plus exactly one final terminal event through `test-events.mjs`.
Command-backed cases use `command-test-case.mjs` so child-process failures stay
visible and are represented by a failing case and terminal record. Consumers
must report the events actually observed; there is no separate launcher
inventory, expected aggregate, or publication/certification gate to maintain.

Run `npm run check` for the maintained validation boundary or an individual
`npm run test:<name>` script for a focused executable suite. Production source
must not import repository-root test modules.
