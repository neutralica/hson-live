# Historical solo recovery probes

The `locus-client-recovery.legacy.mjs` and `locus-document-recovery.legacy.mjs` files record the earlier solo Locus/Echo recovery contract. They are archived, excluded from active acceptance scripts, and are not executable from this directory. They include public generated-QUID replay and portable node claims that current admission correctly rejects. Hosted aggregate bootstrap and recovery are covered by `locus-bootstrap-recovery-6d.acceptance.mts`, the Step 6A–6C suites, and the hosted document suites.

The `solo-locus/` files preserve tests, type probes, and a browser fixture for the
retired one-map hosted Locus protocol. They are excluded from current typecheck,
package checks, and public entrypoints. Current acceptance uses a fixed library
registry (including one-library registries) with session projection; the Step 6A–6E
and hosted continuation suites cover bootstrap, live updates, recovery, SSR, and
DOM adoption. These archived files are evidence of the former contract only.

The archived `phase4c-hosted-identity.legacy.mjs`, `echo-replica-capability.legacy.mts`, and `livemap-projected-intent-propagation.legacy.mts` files retain old solo cases. Current portable identity, registry capability, projection, recovery, and hosted cut suites replace their supported behavior. The retired runtime source is catalogued in `tests/historical/solo-locus/source/README.md` and is excluded from the production build.
