# Hson Language for VS Code

Hson Language v0.1

• syntax highlighting, definitions, and contextual diagnostics for `.hson` files
• schema-aware editing for `Hson`\`\` tagged templates including path-backed auto-completion
• auto-generated TypeScript types from HsonSchema declarations for a reliable coupling of schema and type to a single source
• `check` and `watch` modes to generate types one time or debounced on Schema revision

Highlighting and diagnostics share TypeScript binding-aware discovery of named `Hson` imports from `hson-live` and `hson-live/hson`, including renamed imports. 
 

## HsonSchema authoring and diagnostics

Declare the Schema as canonical Hson and use `Hson.certify` for dynamic
certification or `map.schema.use` for LiveMap governance:

```ts
import { Hson, type HsonSchema } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

export const UserSchema: HsonSchema = Hson`
  <type "data" 
   content 
    <user 
     <content 
      <age 
       "number"
      >
     >
    >
  >
`;

const user = Hson`<user <age 37>>`;
Hson.certify(UserSchema, user);
hsonLiveMap.fromHson(user).schema.use(UserSchema);
```

The extension discovers static `HsonSchema` declarations and generated evidence. It provides Schema-aware diagnostics and completion without executing callback validators.

Local Schema definitions are editor symbols and also offer semantic auto-complete. Inside `<ref "…">` tags, for example, completion always offers the current declaration's `defs`; **Go to Definition**, **Find References**, **Rename Symbol**, and hover follow only those semantic local references. Use Schema Watch or Check afterward to reconcile generated evidence.

For headless development and CI, the package remains authoritative:

```sh
hson-schema generate --project tsconfig.json
hson-schema watch --project tsconfig.json
```

**Hson: Generate Schema Types**, **Hson: Start Schema Watch**, **Hson: Stop Schema Watch**, and **Hson: Check Schemas** do not execute automatically on startup. Schema-generated type declarations are ordinary TypeScript files.

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

`toolkit:update` is the one-command local update path. The extension build
bundles its required compiler/runtime source directly from this repository, so
a separate root `npm run build` is not a VSIX prerequisite. The install step
itself checks extension source, builds, validates, packages once, installs that
exact VSIX, and verifies the installed payload. Workspace Schema commands still
run each consumer project's own installed `hson-live` executable.

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
Changing Hson Appearance settings does not require a reinstall; use the normal
VS Code settings lifecycle. Reinstall only after extension source or build inputs
change.

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

Direct and renamed official imports receive the same grammar-backed highlighting and admission diagnostics because both use the same TypeScript binding identity.

Ordinary strings and templates inside `fromHson(...)` intentionally retain ordinary TypeScript coloring. Schema tooling adds semantic diagnostics, not spelling-based TextMate injection. `Hson\`...\`` remains the preferred embedded authoring form with first-class Hson presentation.

Use **Developer: Inspect Editor Tokens and Scopes** in the Command Palette to inspect the emitted Hson semantic tokens and their TextMate scope fallbacks.

### Zero-Schema regression verification

`npm run test:baseline` runs 24 focused recognition, grammar, admission, mapping and stale-publication checks. `npm run test:baseline:integration` runs the unsaved edit journey in trusted and genuinely restricted workspaces. Set `HSON_VSCODE_EXECUTABLE` to select a VS Code binary (the runner defaults to the ordinary macOS installation). `npm run test:baseline:installed` builds the actual VSIX and runs the same journey from a clean installed-extension directory, using an empty test-driver extension rather than a development override for Hson.
