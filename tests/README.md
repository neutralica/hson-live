# Test project policy

`tests/tsconfig.json` strictly type-checks the maintained TypeScript acceptance
tests (`.mts` and `.ts`) together with current library source.

The former solo Locus `.mjs` protocol probes are under `tests/historical/solo-locus/runtime-probes/`.
They record retired wire behavior and are excluded from current acceptance.

Executable suites are the test authority. Each suite keeps its literal
`suiteMetadata` beside the executable cases and emits real case begin/end
events plus exactly one final terminal event through `test-events.mjs`.
Command-backed cases use `command-test-case.mjs` so child-process failures stay
visible and are represented by a failing case and terminal record. Consumers
must report the events actually observed; there is no separate launcher
inventory, expected aggregate, or publication/certification gate to maintain.

Validation has three gates:

- `npm run check` builds and runs the practical pre-commit gate, including current
  metadata and test-event checks.
- `npm run check:full` runs `check` plus every remaining current deterministic
  `test:*` script, the Echo browser packaging measure, and the root Schema
  check, including the near-limit SSR memory case. Run this before an
  architecture freeze or release.
- `npm run check:extended` runs the current native Chrome suites and Node hosting
  suites. It requires Chrome or Chromium (`HSON_CHROME_BIN` can select one) and
  permission to bind a loopback listener. Run it after `check:full` where those
  facilities are available.

The full-gate runner derives membership from `package.json` and rejects an
unscripted current top-level acceptance file or browser HTML fixture. Focused `npm run test:<name>`
commands remain available. `tests/historical/` is archaeological evidence and
is excluded from current gates, typechecks, and suite-metadata scanning.
Production source must not import repository-root test modules.
