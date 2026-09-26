# Schema compiler workflow and publishing

Normal Schema commands never write authored TypeScript. They use the shared Schema
analysis and transformation in tool-owned compiler inputs. The editor uses the same
model in memory, including current unsaved text and authored source mappings.

| Command | Responsibility |
| --- | --- |
| `generate --project tsconfig.json` | Capture source/config/dependencies, prepare and validate a complete immutable revision, then atomically advance the stable selector. Invalid Schemas publish current unproved state and return failure. |
| `verify --project tsconfig.json` | Read-only verification of ownership, tooling compatibility and every captured filesystem observation. Missing, stale, edited or invalid state fails. No repair occurs. |
| `check --project tsconfig.json` | Verify current generated state, then run precise TypeScript checking. Generation includes Schema semantic and static Hson validation. |
| `build --project tsconfig.json` | Verify/check; emit configured runtime JavaScript from captured authored inputs and configured declarations from the precise compiler view. Both graphs must still match the same captured revision before writing output. |
| `watch --project tsconfig.json` | Continuously publish coherent immutable revisions, recovering from ordinary authoring errors. Infrastructure and ownership failures terminate. |
| `migrate --project tsconfig.json` | Preview explicit legacy cleanup. `--write` applies recognized syntax removal and digest-verified colocated artifact removal. Ambiguity refuses the operation before any write. |

`experimental-project` is a compatibility alias for `generate`; its `--watch`
option delegates to normal `watch`. There is no separate experimental writer.
Run `generate` before `verify`, `check` or `build` after editing saved inputs.
Stock `tsc -p .hson/compiler-input/tsconfig.json/tsconfig.json` also checks the
selected view, but cannot independently verify its freshness.

## Generated ownership

`.hson/compiler-input/<config filename>/tsconfig.json` is a small stable selector.
It selects one complete `revisions/revision-*/` project containing frozen config,
transformed sources, evidence, metadata and an ownership manifest. The manifest
records source edits, exact byte digests, dependency/discovery observations and
compatibility. The selector alone determines current authority. Retired revisions
remain physically present and immutable for readers already using them. No automatic
collection, timeout deletion or reader coordination is provided.

New, deleted, renamed, moved and excluded files change project membership. Invalid
Schemas withdraw current precise evidence; old retained files are not authoritative.
Unowned neighbors are never deleted. `.hson/` is ignored development state and need
not be committed or published. CI must generate it before verifying/checking.

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
Phase 1/2/3 suites continue to cover compiler, editor and immutable watcher behavior.
The pre-commit hook still runs `npm run check`; normal build/check scripts now use
the generated workflow, so the hook no longer invokes the legacy writer.

Retired revision garbage collection, extension UX, broader reexport policy and
bundler redesign remain separate work.
