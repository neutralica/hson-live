# Experimental Schema compiler inputs — Phase 1

This is an opt-in, checking-only foundation. It does not switch `generate`,
`verify`, `check`, `build`, or `watch` to a new workflow, and does not change the
VS Code extension. Those commands temporarily retain the legacy source writer.

After building/installing the package:

```sh
hson-schema experimental-project --project ./tsconfig.json
tsc --project ./.hson/compiler-input/tsconfig.json/tsconfig.json
```

In this repository, the equivalent commands are:

```sh
node dist/hson-schema.mjs experimental-project --project /path/to/app/tsconfig.json
node node_modules/typescript/bin/tsc --project /path/to/app/.hson/compiler-input/tsconfig.json/tsconfig.json
```

`experimental-project` is an experimental CLI mode, not a permanent public API
commitment. It prints the generated project and manifest paths. Generation must
succeed before checking; stock TypeScript does not run the Schema generator or
verify the freshness of previously generated inputs.

## Ownership and layout

For a configuration named `tsconfig.json`:

```text
.hson/compiler-input/tsconfig.json/
  tsconfig.json
  manifest.json
  sources/
    schema.ts
    consumer.ts
    package.json
  evidence/
    schema.ts/
      slideSchema.hson-schema.generated.ts
      slideSchema.hson-schema.generated.json
```

The configuration filename separates configurations in the same directory.
`sources/` preserves project-relative source filenames and directory structure.
Each evidence directory includes the producer's **full filename**, including its
extension, so `foo.ts`, `foo.mts`, `foo.cts`, and `other/foo.ts` cannot share an
evidence module accidentally. Evidence for `.mts` and `.cts` uses matching
extensions and `.mjs`/`.cjs` import specifiers. Each declaration gets its own
unique-symbol identity; identical Schema text is not deduplicated.

The manifest identifies generated files by path and digest. A repeat invocation
can replace or remove only unchanged, manifest-owned files. Unowned neighbors
are left alone; an occupied unowned destination or edited generated file causes
an error before publication. Output paths cannot escape the boundary or traverse
symlinks. No recursive directory deletion or dependency symlink is used.
An interrupted first publication can require explicit user cleanup of incomplete
output; crash recovery and concurrent publication belong to the later lifecycle
phase. `.hson/` is ignored project state, not authored or published source.

## Transformation and checking

The existing Schema discovery, compiler, evidence generator, and static Hson
validation are reused. Both the legacy writer and compiler-project generator use
the same source-association edit model. Only the destination differs.

Authored files are never written, formatted, normalized, or temporarily rewritten.
The generated representation contains annotations, assertions, and type-only
imports linking the runtime `Hson.schema` expression to the existing
`Evidence["value"]`, `Evidence["mode"]`, and `Evidence["identity"]`. Private
refinement proofs and mutation-candidate associations are unchanged. Generated
local aliases avoid collisions with identifiers in the authored module.

Non-Schema project inputs are mirrored too. The generated configuration extends
the original configuration to preserve checking options, rebases local `baseUrl`,
`paths`, `rootDirs`, and type roots, and uses an explicit generated file list.
Local declaration files and package scopes are copied; external declaration and
package dependencies retain their original identity. The generator checks module
resolution and rejects a changed dependency target or an original application
source leaking into the generated graph.

The configuration forces `noEmit` and disables declaration/incremental output.
It does not write the original project's output or build-info files. Runtime emit,
assets, bundling, declaration closure, and package publishing are not supported
by this phase. In particular, the known declaration-emission limitations involving
inferred exported return types and private proof symbols are not addressed here.

## Current boundaries and later phases

- Project references and non-declaration application inputs outside the
  configuration's directory are explicitly rejected. External declaration
  dependencies are supported.
- Schema producers must be TypeScript files. Non-Schema JavaScript inputs can be
  mirrored when enabled by the original project's checking options.
- Resolution layouts that change under mirroring (for example, some nested
  dependency installations or external relative imports) fail rather than
  silently compiling a different graph. No custom resolver is installed in `tsc`.
- Existing Schema discovery restrictions and named Schema reexport restrictions
  remain in effect.
- Diagnostics point at generated files. The manifest records original/generated
  paths, exact authored byte digests, Schema declaration ranges, and edits in
  UTF-16 offsets of TypeScript's decoded `SourceFile.text`. Phase 2 must map these
  snapshots, including BOMs, generated headers/imports, and unsaved editor text.
- The editor still sees authored files through its existing integration. This
  phase does not supply editor snapshots or suppress diagnostics there.
- The path is finite generation, not a watcher. Source revisions, directory
  watching, invalidation of stale evidence, retry UX, transactional publication,
  and crash recovery remain later work.

Run `npm run test:hson-schema-compiler-project` for the stock TypeScript 5.9.3
acceptance fixture. It checks exact authored bytes (including CRLF, BOM, comments,
annotations, blank lines, and trailing-newline state), the single application
graph, unchanged runtime tag expressions, evidence equivalence, type precision,
nominal identity, filename collisions, and bounded file ownership.
