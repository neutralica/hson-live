# Schema compiler workflow and publishing

Normal Schema commands never write authored TypeScript. They use the shared Schema
analysis and transformation in tool-owned compiler inputs. The editor uses the same
model in memory, including current unsaved text and authored source mappings.

| Command | Responsibility |
| --- | --- |
| `generate --project tsconfig.json` | Reuse unchanged input or capture source/config/dependencies and publish one complete current compiler repository. Invalid Schemas publish current unproved state and return failure. |
| `verify --project tsconfig.json` | Read-only verification of ownership, tooling compatibility and every captured filesystem observation. Missing, stale, edited or invalid state fails. No repair occurs. |
| `check --project tsconfig.json` | Verify current generated state, then run precise TypeScript checking. Generation includes Schema semantic and static Hson validation. |
| `build --project tsconfig.json` | Verify/check; emit configured runtime JavaScript from captured authored inputs and configured declarations from the precise compiler view. Both graphs must still match the same captured revision before writing output. |
| `watch --project tsconfig.json` | Continuously replace current generated state, recovering from ordinary authoring errors. Infrastructure and ownership failures terminate. |
| `migrate --project tsconfig.json` | Preview explicit legacy cleanup. `--write` applies recognized syntax removal and digest-verified colocated artifact removal. Ambiguity refuses the operation before any write. |

Run `generate` before `verify`, `check` or `build` after editing saved inputs.
Stock `tsc -p .hson/compiler-input/tsconfig.json/tsconfig.json` also checks the
current view, but cannot independently verify its freshness.

Normal workflows accept current direct `Hson.schema` authored source only. Recognized
legacy annotations, assertions, generated import/marker blocks, or colocated evidence
produce a migration-required error and receive no generated or virtual proof. Run
`hson-schema migrate` to preview cleanup, then `hson-schema migrate --write` to apply
it. Normal commands never clean up authored source automatically.

Watch emits the current JSON protocol. The extension expects the current workspace
CLI; plain-text Watch output and mixed-version interoperability are unsupported.
Compiler-project compatibility is version 6; regenerate state from earlier tooling.

## Generated ownership

`.hson/compiler-input/<config filename>/` contains `sources/`, `evidence/`,
`manifest.json` and `tsconfig.json`. It is current generated state, not history.
The manifest records owned paths and digests, source mappings, input observations,
diagnostics, tooling compatibility and a publication identity. An unchanged valid
or invalid project reuses its publication without generated filesystem churn.

Candidates are prepared in transient staging, with final-path compiler validation.
During replacement `.publishing.json` marks the repository unavailable. Candidate
files are installed before the final manifest; removing the marker completes
publication. An interrupted replacement is refused, never accepted as precise proof.
Preparation failure preserves the previous complete payload, but changed authored
inputs make that payload stale. See [publication and recovery details](./hson-schema-compiler-project-phase-3.md).

Hson verify/check/build capture all manifest-owned compiler bytes and membership,
validate digests and recheck the publication boundary. Races fail clearly. Checking
and declaration generation read that frozen capture, not changing generated files.
Final checks still bind authored runtime inputs to the same publication. Stock
`tsc` may read quiescent output; arbitrary external readers are not guaranteed
survival across concurrent Watch updates. No reader leases or reference counting
are required.

Changed membership removes obsolete owned sources, evidence and metadata. Invalid
Schemas withdraw current precision, and repair restores it. Unowned neighbors,
edited files and symlink destinations are protected. Obsolete immutable revision
layouts require explicit `hson-schema migrate` preview and `migrate --write` cleanup,
followed by `generate` (or `watch`) to regenerate current state from authored inputs.
Normal generate/watch/verify/check/build report migration-required without adopting
or deleting old state. Cleanup validates project identity, selector and manifest
ownership, digests and symlinks; ambiguous or edited state is refused before any
write. Unowned neighbors are preserved. Normal operation retains no old revisions.
`.hson/` is ignored development state, not committed or published; CI generates it.

The extension's live compiler view requires neither colocated evidence nor saved
`.hson` output. Legacy missing/stale disk-evidence diagnostics and their quick fixes
are removed. Actual Schema and TypeScript diagnostics and explicit Generate, Check
and Watch commands remain independent of saved-project evidence status.

## Build and package output

JavaScript follows the existing authored module graph and compiler destinations.
No evidence JavaScript or second transformed runtime graph is emitted. Declaration
emission uses generated typing and names inferred public Schema helpers/containers
through the existing evidence origin. It does not introduce a second nominal brand.
Runtime and declaration outputs are prepared before the final revision check.
External bundlers can continue consuming authored runtime inputs independently;
this CLI does not redesign their runtime pipeline.

Declarations retain normal configured destinations. Referenced Schema proof
modules are emitted beneath `internal/hson-schema/` in the declaration output.
Ship that declaration dependency closure with the package; do not expose it through
new public entrypoints. Consumers use stock TypeScript and need no generator or
producer `.hson/` directory. Declaration references and maps are relocated;
declaration maps compose compiler-view edits back to authored coordinates.
Evidence maps embed their tool-owned source content. Copied local declaration dependencies also ship in the private declaration closure;
obsolete map links on those input declarations are omitted. Runtime source maps are the
ordinary authored-input maps. No development compiler revision paths are published.

Existing named Schema reexport rejection remains. Supported star reexports,
imported aliases, returning helpers and object members retain one identity origin.
`emitDeclarationOnly` suppresses runtime output; otherwise `build` retains the
previous command's emission contract even when authored config has `noEmit`.
Project references, source inputs outside the project directory and resolution
layouts that change under mirroring remain unsupported. Split emission rejects
`outFile` bundles. A missing declaration dependency closure fails rather than
publishing a reference to development files.

## Legacy migration

Normal generation/check/watch can read recognized old associations into the compiler
view but never update or remove them in authored files. The explicit migration
command removes only structurally recognized annotations, assertions and marked
imports, preserving all other bytes. It cannot recover formatting or local type
annotations already overwritten by older tooling. Comments inside removed syntax,
edited/unrecognized blocks, remaining alias uses, UTF-16 cleanup and edited artifact
digests require manual review. Such cases fail without changing files.

The repository retains explicit legacy fixtures for compatibility regression.
Colocated evidence is otherwise obsolete and is excluded from current checking and runtime emission. Source-write helper/lifecycle machinery
is removed; only explicit migration can edit legacy authored syntax.

## Validation and deferred work

The cutover suite checks normal command source bytes, stock checking, freshness,
separate runtime output, declaration helpers/objects, package consumers, private
proofs and nominal identity, map paths, legacy refusal/cleanup and default watch.
Phase 1/2/3 suites continue to cover compiler, editor and current-state watcher behavior.
The pre-commit hook still runs `npm run check`; normal build/check scripts now use
the generated workflow, so the hook no longer invokes the legacy writer.

Extension runner UX, broader reexport policy and bundler redesign remain separate work.
