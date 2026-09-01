# Hson Language for VS Code

This extension provides syntax highlighting and authoritative parser diagnostics
for standalone `.hson` files, supported `Hson` tagged templates, and statically
recoverable strings passed to official `fromHson` boundaries in TypeScript and
TSX. In trusted Schema mode, `Hson` templates also support bounded structural
completion.

Highlighting and diagnostics share TypeScript binding-aware discovery of named
`Hson` imports from `hson-live` and `hson-live/hson`, including renamed imports.
Local/shadowed names, wrong packages, copied functions and wrappers are excluded.
The existing Hson TextMate grammar supplies the template tokens, published through
VS Code semantic tokens with Hson scope fallbacks. A spelling-only injection is
not contributed. Invalid Hson and literal segments around interpolation are still
highlighted. Neither highlighting nor secure diagnostics requires Schema, a
trusted provider, Workspace Trust, completion, or application execution.

Literal usage references to the official `hson` facade carry strong blue, yellow,
pink, and green family colors; literal usage references to official `Hson` use
the same hues with softer opacity. This includes bare references, member roots,
validation calls, and `Hson` tagged templates. The first member-access period
after an official lowercase `hson` root is violet; later periods are ordinary.
Import/export declarations and renamed imports retain ordinary host-theme
presentation. Local, shadowed, wrong-package, property-name, and otherwise
unrelated lookalikes receive no marker. Standalone `.hson` files do not invent
one. All ordinary Hson body syntax remains controlled by the active syntax theme.

## Settings

Run **Hson: Open Settings** or search Settings for `@ext:terminal-gothic.hson-language`.
The initial user-facing surface is deliberately compact:

- **Hson › Appearance: Library Marker Strength**
  (`hson.appearance.libraryMarkerStrength`, default `1.0`) controls the presence
  of official literal `hson` markers.
- **Hson › Appearance: Authoring Marker Strength**
  (`hson.appearance.authoringMarkerStrength`, default `0.70`) keeps official
  literal `Hson` markers visibly quieter.
- **Hson › Appearance: Blue / Yellow / Pink / Green**
  (`hson.appearance.blue`, `.yellow`, `.pink`, `.green`) are hexadecimal colors
  shared by the corresponding `hson` and `Hson` letters. Their shipped defaults
  are `#00adf6`, `#c9d100`, `#ff4a8c`, and `#39a500`. The fields accept `#RGB`,
  `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`.
- **Hson › Appearance: Color Library hson**
  (`hson.appearance.colorLibraryMarker`, default `true`) controls only the
  lowercase official library marker and its violet separator. Uppercase `Hson`,
  Hson bodies, imports, diagnostics, and trusted runtime behavior are unaffected.
- **Hson › Appearance: Library Separator Color**
  (`hson.appearance.librarySeparatorColor`, default `#7247d4`) controls the first
  member-access period immediately after an official lowercase `hson` root.
- **Hson › Schema Diagnostics: Trusted Execution**
  (`hson.trustedSchemaDiagnostics.enabled`, default `false`, resource scope)
  permits project code execution only when Workspace Trust and separate Hson
  consent are also present.
- **Hson › Runtime / Provider** contains the existing resource-scoped Provider
  Entry, Hson Runtime Module, optional Runtime Entry, and Node Arguments needed
  by the current D1–D6 trusted runtime. Paths are relative to the containing
  workspace folder. These execution-sensitive settings are restricted in
  Restricted Mode.

Changing a strength, shared color, lowercase toggle, or separator color recreates
the presentation decorations and refreshes visible editors immediately; no
rebuild, reinstall, window reload, or runtime restart is required. Trusted-runtime
configuration changes retire the old generation and invalidate consent for the
previous configuration. The 150 ms validation
debounce, request/startup timeouts, restart budget, queue limits, and log bounds
remain implementation-owned safeguards. Schema completion stays on whenever a
current authorized trusted runtime is available; it has no separate toggle.

When no non-empty user/workspace Appearance color override is configured, each
marker uses its contributed theme color identity. `workbench.colorCustomizations`
therefore remains the advanced override path:

```json
{
  "workbench.colorCustomizations": {
    "hson.libraryMarker.h": "#00adf6",
    "hson.libraryMarker.s": "#c9d100",
    "hson.libraryMarker.o": "#ff4a8c",
    "hson.libraryMarker.n": "#39a500",
    "hson.authoringMarker.h": "#00adf6",
    "hson.authoringMarker.s": "#c9d100",
    "hson.authoringMarker.o": "#ff4a8c",
    "hson.authoringMarker.n": "#39a500",
    "hson.libraryMarker.separator": "#7247d4"
  }
}
```

The contributed defaults use the approved blue `#00adf6`, yellow `#c9d100`, pink
`#ff4a8c`, green `#39a500`, and separator violet `#7247d4` identities across
dark, light, and high-contrast variants. Precedence is: a non-empty explicitly
configured Hson Appearance color, then the corresponding theme color identity
(including `workbench.colorCustomizations`), then its contributed default. An
empty explicit field also falls back to the theme identity. The authoring IDs use
the same hues; Authoring Marker Strength supplies the default `0.70` opacity.
Library Marker Strength applies equally to lowercase letters and the violet
separator. A supplied alpha channel is respected and multiplied by strength.

Syntax diagnostics cover configured TS/TSX source and standalone `.hson` files
across every workspace folder, including files that have never been opened.
TS/TSX membership follows TypeScript project configuration (`include`,
`exclude`, `extends`, and project references); declarations, generated Schema
artifacts, dependencies, and configured output directories are excluded. An
open editor's in-memory text is authoritative, while closing it restores the
saved-file result instead of removing its Problems. In the default secure mode
the extension parses project configuration but does not execute workspace code.
It does not write helper files or modify user source, and this static scan is
independent of Schema Generate, Schema Watch, trusted diagnostics, and
Workspace Trust.
Substitution-free templates receive authoritative whole-Hson tag admission
diagnostics, including raw-template newline normalization and UTF-16 mapping.
Readable noncanonical formatting is accepted when the actual tag accepts it.
Interpolated templates are discovered, but receive no speculative whole-source
syntax diagnostic because their primitive values are known only at runtime.
Irrevocable tokenizer failures before the first interpolation can still be
reported securely; incomplete prefixes and unknown completed candidates cannot.

Official Transform, LiveMap, and LiveTree `fromHson` calls also receive secure
syntax checking when their argument is a direct string/no-substitution template
literal or a finite local `const` identifier-only alias of one. JavaScript's
cooked string value is checked, and escape-produced characters map back to the
complete authored escape. Dynamic templates, concatenation, helper results,
imports, properties, `let`/`var`, and runtime file/network input remain
runtime-only. Recognition follows official import binding identity; unrelated
methods that merely share the name `fromHson` are ignored.

## HsonSchema authoring and diagnostics

Declare the Schema as canonical Hson and use `Hson.certify` for dynamic
certification or `map.schema.use` for LiveMap governance:

```ts
import { Hson, type HsonSchema } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

export const UserSchema: HsonSchema = Hson`
  <type "data" content <user <content <age "number">>>>
`;

const user = Hson`<user <age 37>>`;
Hson.certify(UserSchema, user);
hsonLiveMap.fromHson(user).schema.use(UserSchema);
```

The extension discovers static `HsonSchema` declarations and generated evidence.
It provides Schema-aware diagnostics and completion without executing callback
validators.

Local Schema definitions are editor symbols: inside `<ref "…">`, completion
offers the current declaration's `defs`; **Go to Definition**, **Find
References**, **Rename Symbol**, and hover follow only those semantic local
references. Rename changes the authored Schema declaration and its resolved ref
strings as one editor edit; it never edits generated files. Use Schema Watch or
**Hson: Generate Schema Types** afterward to reconcile generated evidence (the
usual stale-evidence quick fixes remain available).

For headless development and CI, the package remains authoritative:

```sh
hson-schema generate --project tsconfig.json
hson-schema watch --project tsconfig.json
```

In VS Code, use **Hson: Generate Schema Types**, **Hson: Start Schema Watch**,
and **Hson: Stop Schema Watch**. The extension resolves and runs only the
selected workspace's installed `hson-live` `hson-schema` executable; it never
downloads or supplies a generator. Watch automatically regenerates after
relevant saved edits, and the status item reports only extension-managed watch
state. Missing or stale local evidence offers Generate and Start Watch quick
fixes. Commands are explicit trusted-workspace operations; opening a project
does not start them. Generated declarations are ordinary TypeScript files, so
their updates do not require a window reload.

Interpolations remain ordinary TypeScript expressions; runtime values can be
certified explicitly with `Hson.certify`.

## Development

### Install the current local extension

From the `hson-live` repository root, use the local install authority:

```sh
npm run vscode:install
```

The install command discovers the normal Stable VS Code CLI, checks and builds
the extension, packages current source into a new temporary VSIX, validates that
archive, atomically promotes it to `editors/vscode-hson/hson-language.vsix`, and
force-installs that exact artifact. It then verifies the installed extension ID,
version, and payload when the current VS Code CLI can locate it.

After `npm run toolkit:update`, run **Developer: Reload Window** in VS Code. The
tooling does not reload or restart VS Code automatically.

Package without installing:

```sh
npm run vscode:package
```

Inspect source/package/installed-build authority:

```sh
npm run vscode:status
```

To select a different compatible VS Code CLI explicitly:

```sh
HSON_VSCODE_CLI=/absolute/path/to/code npm run vscode:install
```

An invalid explicit override fails immediately. The normal command does not
select Insiders, create a profile, or use the isolated integration-test
directories.

Local source updates deliberately use `--force`, so replacing one `0.1.1`
development build with another does not require an extension version bump.
Changing Hson Appearance or trusted-diagnostics settings does not require a
reinstall; use the normal VS Code settings lifecycle. Reinstall only after
extension source or build inputs change.

The multi-step build/development-host sequence below remains useful for extension
debugging, but it is not the ordinary local installation workflow.

1. Run `npm install` in this directory.
2. Run `npm run build` and `npm test`.
3. Start an Extension Development Host:

   ```sh
   code --extensionDevelopmentPath=/absolute/path/to/editors/vscode-hson
   ```

4. In that window, open a `.hson` file containing:

   ```hson
   <main
     <broken
   ```

5. Open a `.ts` file containing the malformed direct and aliased forms:

   ```ts
   import { Hson, Hson as markup } from "hson-live/hson";

   const direct = Hson`
     <main
       <broken
   `;

   const alias = markup`
     <main
       <broken
   `;
   ```

6. Replace either body with valid Hson and confirm its squiggle clears:

   ```ts
   const page = Hson`
     <main
       <h1 "Hello">
     >
   `;
   ```

Direct and renamed official imports receive the same grammar-backed highlighting
and admission diagnostics because both use the same TypeScript binding identity.

Ordinary strings and templates inside `fromHson(...)` intentionally retain
ordinary TypeScript coloring. D4 adds semantic diagnostics, not spelling-based
TextMate injection. `Hson\`...\`` remains the preferred embedded authoring form
with first-class Hson presentation.

Use **Developer: Inspect Editor Tokens and Scopes** in the Command Palette to
inspect the emitted Hson semantic tokens and their TextMate scope fallbacks.

### Zero-Schema regression verification

`npm run test:baseline` runs 24 focused recognition, grammar, admission, mapping
and stale-publication checks. `npm run test:baseline:integration` runs the unsaved
edit journey in trusted and genuinely restricted workspaces. Set
`HSON_VSCODE_EXECUTABLE` to select a VS Code binary (the runner defaults to the
ordinary macOS installation). `npm run test:baseline:installed` builds the actual
VSIX and runs the same journey from a clean installed-extension directory, using
an empty test-driver extension rather than a development override for Hson.

### Natural LiveMap Schema governance (D3)

With a trusted provider supplying source-bound D1 lifecycle evidence, ordinary
map-owning code needs no extra standalone validation call:

```ts
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import { UserSchema } from "./schema.js";

const source = Hson`<user <age "37">>`;
const map = hsonLiveMap.fromHson(source);
map.schema.use(UserSchema);
```

The original template receives the current candidate's Schema diagnostics,
including when initial attachment rejects. Related information identifies the
use site. Both the dedicated facade above and `hson.liveMap.fromHson` work;
local immutable aliases and inline templates are supported, but the standalone
Hson block is the preferred style. Multiple maps retain independent contracts.
Actual mutation, including mutation followed by restoration, suppresses source
attribution for that map.

Workspace Trust and explicit enablement are still both required. A Schema-only
provider does not establish map correspondence: D3 needs the existing D1
capture path bound to the source sites. The private provider instrumenter and
its limits are documented in
`src/internal/trusted-schema-diagnostics/README.md` in the source repository
(D3 natural map association section).
There is no automatic application import, public provenance API, or new
validation API. The editor makes no claim that application execution reached
`schema.use`.

### Static `fromHson` Schema governance (D4)

A statically recoverable raw string can be the source occurrence for the same
D3 lifecycle path:

```ts
const source = `<user <age "37">>`;
const map = hsonLiveMap.fromHson(source);
map.schema.use(UserSchema);
```

Syntax checking is immediate and does not require trust or Schema execution.
When Workspace Trust and trusted diagnostics are both enabled, the private D3
provider can prove that this exact construction produced the actual map and
project the later Schema relationship back into the original literal. Failed
initial attachment remains diagnosable. Actual mutation, including mutation
followed by restoration, suppresses attribution. Multiple maps using one
literal retain separate Schema relationships.
