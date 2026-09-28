# Hson Language for VS Code

Hson Language adds Hson authoring, Schema tooling, and local Hson application support to VS Code.

- syntax highlighting, definitions, completion, and contextual diagnostics for `.hson` files and semantic `Hson.canonical`, `Hson.data`, `Hson.document`, and `Hson.schema` tags;
- context-sensitive angle auto-close, newline indentation, and whitespace-only formatting for recognized semantic Hson templates and Markdown `hson` fences;
- Schema-aware editing, including semantic references and path-backed completion;
- generated TypeScript types from Hson Schema declarations;
- Schema check/watch workflows for editor and CI use;
- a local application runner using the workspace's own Node and `hson-live`.

Highlighting and diagnostics use TypeScript binding identity for official `hson-live` imports, including renamed imports. Hson authored through semantic Hson tags and supported literal `fromHson(...)` inputs receives the same grammar-aware presentation.

## Structural editing

Inside binding-recognized semantic Hson templates, typing `<` inserts `>` or `/>` only when the Hson parser proves one structural mode. An initially ambiguous template is left unchanged. Enter follows Hson nesting and the editor's tabs/spaces settings. Canonical Markdown fences such as ```` ```hson ```` use the same structural behavior.

Use **Hson: Format Document** to run the normal host formatter and then format recognized Hson regions, or **Hson: Format Selection** for selected regions. Markdown Format Document/Selection also formats canonical `hson` fences directly. Formatting adjusts indentation, normalizes horizontal trivia between Hson tokens, and places the first member of an already-multiline data object below its opening `<`. It preserves token contents and authored blank lines; it does not serialize, reorder, or generally reflow authored Hson.

`fromHson(...)` literals remain highlighting and diagnostic surfaces only. Structural editing and formatting do not activate there.

## Schema authoring

Schemas are authored directly in canonical Hson:

```ts
import { Hson, type HsonData, type SchemaType } from "hson-live/hson";

export const UserSchema = Hson.schema`
  <type "data" content <
    user <content <
      age "number"
    >>
  >>
`;
```

The extension uses current `Hson.schema` editor text and an in-memory compiler view for diagnostics, precise typing, completion, hover, definitions, references, and rename support. Unsaved edits do not require colocated evidence files or saved `.hson` output.

Normal Schema workflows use direct `Hson.schema` source and current `.hson/` or virtual evidence. Stale owned state requires regeneration. Unsupported generated artifacts must be removed before regeneration. Watch integration uses the current JSON protocol from the workspace CLI.

For example, `<ref "…">` completion is scoped to the current Schema declaration's `defs`, and navigation follows those semantic references rather than matching text alone.

Schema types can be generated and checked from VS Code or the package CLI:

```sh
hson-schema generate --project tsconfig.json
hson-schema watch --project tsconfig.json
hson-schema check --project tsconfig.json
```

Available editor commands include:

- **Hson: Generate Schema Types**
- **Hson: Start Schema Watch**
- **Hson: Stop Schema Watch**
- **Hson: Check Schemas**

Direct `Hson.data` and `Hson.document` assignments to `HsonData<typeof Schema>` or `HsonDocument<typeof Schema>` gain proof after Schema-aware validation. Dynamic values can be certified with `schema.certify(...)`, while named LiveMap state can be governed through `map.lib("name").schema.use(...)`.

Direct certification and construction attachments also report definite static Schema mismatches in Problems and at authored candidate ranges. Complete literal Hson, immutable string aliases, and bounded alternatives are supported; all alternatives must fail before a diagnostic is issued. Data attachments support literal JSON material and unaliased, single-use literal objects. Post-hoc attachment checks require an immediately preceding direct construction. Calls, awaited values, mutations, escaped objects, and uncertain contents remain runtime-owned. Runtime validation is unchanged.

## Local applications

The extension can run a real Hson application locally using the workspace's own Node runtime and installed `hson-live`.

Application code runs in a separate workspace child process under LiveHost Node; it does not execute inside the VS Code extension host.

Configure a built application entry in workspace settings:

```json
{
  "hson.localHost.entry": "dist/local-app.js",
  "hson.localHost.applicationExport": "application",
  "hson.localHost.nodeExecutable": "node",
  "hson.localHost.port": 8787,
  "hson.localHost.buildCommand": "npm run build",
  "hson.localHost.restartOnSave": true,
  "hson.localHost.sourceDirectory": "src"
}
```

The exported value may be a `LiveHostApplication`, an array of applications, or a zero-argument factory returning either.

Use:

- **Hson: Run All** (Schema Watch and the configured Local App)
- **Hson: Run Local App**
- **Hson: Run & Open Local App**
- **Hson: Open Local App**
- **Hson: Copy Local App URL**
- **Hson: Restart Local App**
- **Hson: Stop Local App**
- **Hson: Stop All**
- **Hson: Show Local App Output**

The runner uses loopback networking. Port 8787 is the default stable URL; set `hson.localHost.port` to `0` for an ephemeral port. A busy configured port produces an error. Local application execution requires Workspace Trust and is currently limited to local desktop workspaces.

The single Hson status item shows Schema and Local App state. Hover it for context-sensitive Run, Run + Open, Copy URL, Open, Restart, Stop, Schema Watch, and Stop All links. The URL and Copy URL action use the current child-reported endpoint.

Local application hosting is development infrastructure, not an authentication boundary. The extension binds LiveHost Node to loopback and requires Workspace Trust, while the application remains responsible for its own authentication, authorization, and security policy. The extension supervises its local runner and LiveHost resources; additional processes created by application code remain application-owned and are not generically supervised by the extension.

Build/watch remains project-owned. Set `buildCommand` to the project's existing build command to run it before Local App launch or restart. When `restartOnSave` is enabled, an explicit Save or Save All under `sourceDirectory` waits for that command to finish successfully before restarting the app. Hson formatting also runs only on explicit saves; after-delay, focus-out, and window-change auto-save can update diagnostics without formatting or restarting. A failed build leaves the current app running and marks the latest generation failed. A failed import/startup keeps automatic retry enabled for the next manual save; Stop disables retry. Full failures remain in Hson Local App Output, with concise notifications and red status instead of stack-trace popups. Output opens only when requested. The extension does not provide its own TypeScript executor, bundler, Vite process, or alternate Hson runtime. Browser opening uses VS Code's external URI handling and the system browser preference.

## Install the local development build

From the `hson-live` repository:

```sh
npm run vscode:install
```

Package without installing:

```sh
npm run vscode:package
```

Inspect source/package/installed-build status:

```sh
npm run vscode:status
```

After updating the installed extension, run **Developer: Reload Window** when required.

## Development

Extension implementation, packaging, integration-test, appearance-authority, and regression-suite documentation is maintained with the extension source.

Schema Generate and Watch now maintain one current compiler repository per project under `.hson/`; they never inject imports or annotations into authored TypeScript. The TypeScript plugin continues to use current unsaved in-memory views. For current ownership, freshness and publishing see the library’s [Phase 4 contract](../../docs/contracts/hson-schema-compiler-project-phase-4.md).
