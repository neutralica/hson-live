# Test project policy

`tests/tsconfig.json` strictly type-checks the maintained TypeScript acceptance
tests (`.mts` and `.ts`) together with current library source.

The LiveHost `.mjs` files under `runtime-probes/` are deliberately JavaScript runtime protocol
probes. They inject malformed and partial wire envelopes and use lightweight
in-memory socket doubles to exercise rejection, recovery, tracing, session, and
deduplication behavior. They remain runtime-tested by the package scripts but
are not presented to editors as maintainable TypeScript source. This avoids an
inferred TypeScript project while preserving their intentionally dynamic role.
