# Hson Schema generated-project watch (Phase 3)

Opt in using:

```sh
hson-schema experimental-project --project ./tsconfig.json --watch
tsc --project .hson/compiler-input/tsconfig.json/tsconfig.json
```

The first `tsconfig.json` directory component is the authored configuration's filename.
The second is the stable generated project selector. The legacy default commands
(`generate`, `verify`, `check`, `build`, `watch`) remain unchanged. Phase 2's
unsaved editor/compiler view remains independent of this disk watcher.

## Publication and ownership

```text
.hson/compiler-input/tsconfig.json/
  tsconfig.json                 stable selector, atomically replaced
  revisions/
    revision-<unique name>/
      tsconfig.json             frozen compiler options and explicit roots
      manifest.json             owned paths, digests, source revision, diagnostics
      sources/                  complete mirrored local input graph
      evidence/                 current precise declarations and metadata
```

`create_schema_compiler_project_watch` uses the existing compiler-project
materializer, Schema compiler, evidence generator, association edits and static
proof overlays. It creates a fresh candidate directory, materializes the entire
project, verifies its module graph, checks ownership and input freshness, then
renames a prepared selector file over the stable selector. No generated source,
evidence, or manifest file in a published revision is subsequently rewritten.
The selector contains the selected relative configuration path, an ownership
marker, authored project path, manifest digest and input fingerprint. That one
file is the authority boundary. A candidate is never authoritative just because
its files exist.

Compiler options are frozen from TypeScript's parsed configuration, with public
enum serialization checked by a round trip. The selected configuration does not
extend the mutable authored configuration. Package scopes inside the mirrored
project are copied. As in Phase 1, external declaration/package dependencies
remain external; this is not a snapshot of the dependency installation.
Authored TypeScript errors remain TypeScript errors. Candidate structural
validation does not require the current application to pass type checking.

Only unchanged manifest-owned generated files can be replaced or removed.
Before switching the selector, the selected revision and its manifest are
verified. Edited generated files, an unowned selector, symlink destinations,
unsupported Phase 1 layouts, and internal invariant failures fail clearly.
Unlisted neighbors are never recursively removed. An obsolete unpublished
candidate's manifest-owned files are removed; empty nested directories and
pre-manifest failed preparations may remain. An incomplete preparation never
becomes current, and a new attempt uses a fresh directory.

**Retired published revisions are retained indefinitely and are non-authoritative.**
There is no timer, lease, reader lock or garbage collection API. Readers that
already parsed an old selector can finish reading its revision. New readers of
the stable entry select the newly published revision. Disk accumulation is an
accepted experimental limitation; explicit cleanup is deferred.

Finite Phase 1 generation retains its existing layout and behavior. Watch can
adopt an unchanged manifest-owned Phase 1 project by replacing its selector;
the former project files are then retained but not selected. Once adopted, use
Watch to maintain that generated project. Finite Phase 1 generation refuses to
overwrite the watch-owned selector. Phase 4 will unify the default workflow.

## Input revisions and discovery

`SchemaProjectSnapshot` memoizes compiler filesystem observations: exact source
bytes, configs (including extended and missing configs), imported declarations,
package scopes, failed file/module lookups, real paths, directory existence,
directory lists and TypeScript include/exclude glob results. Generated `.hson`
trees are excluded from wildcard discovery. A SHA-256 fingerprint covers the
sorted observation set, using byte hashes for file contents. Freshness checks
never advance the snapshot baseline or depend on modification times.

One sequential cycle runs at a time. Polling every 250 ms compares the recorded
queries to current filesystem state; unchanged success or error states are
silent. No successful Schema analysis is required to establish observations.
New include matches, removed files, missing dependencies appearing, and config
changes therefore wake recovery. Captured compiler-host text supplies the AST;
the same captured bytes supply the manifest and source copies. A changed input
before publication discards the obsolete candidate. Later edits are coalesced
into the next current snapshot. The final input check immediately precedes the
selector rename; subsequent edits are new observations for the next cycle.

## Invalid and recovering projects

A complete but invalid Schema owns no precise generated association. Other
independently valid declarations retain their evidence. Unterminated tags and
ambiguous duplicate declarations likewise have no precise evidence. Legacy
synthetic annotations are broadened only in the generated representation.
Ordinary authored annotations remain authored. An unterminated template can
consume the rest of its module under TypeScript's parser; declarations absent
from that AST cannot retain independent evidence.

Invalid configurations publish an unproved current view using TypeScript's
available recovery/discovery result; they do not keep the previous precise
project current. Empty membership publishes a generated empty module. Syntax,
Schema, config and missing-import diagnostics refer to authored locations.
Expected errors are reported in the current event and immutable manifest;
repair publishes a new current event with cleared diagnostics. Invalid states
never stop ordinary edit observation. Fatal ownership/infrastructure failures
terminate rather than masquerading as authoring errors.

Evidence filenames use the full producer-relative filename and export name.
The existing `source-relative-path#export` identity locator and per-evidence
unique symbol remain unchanged. Moves and renames produce only the new paths
and identities in the selected revision; no durable identity across moves is
promised. Authored files are never written, formatted, normalized or executed.

## Validation and remaining work

`npm run test:hson-schema-compiler-watch` uses controlled repo-local temporary
projects, stock TypeScript 5.9.3, observable publication events, and an
acceptance-only IPC barrier (`HSON_SCHEMA_WATCH_TEST_BARRIER=1` with IPC) to
force an edit after preparation. No arbitrary long sleep establishes correctness.
Processes and disposable fixtures are cleaned up. Tests check retained immutable
bytes as well as authored bytes throughout lifecycle transitions.

Phase 4 still owns the default CLI cutover and removal of the legacy source
writer. Declaration/publishing closure, package reexport policy, explicit
revision garbage collection, extension status UI and application runner retry
behavior remain out of scope.
