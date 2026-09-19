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

The extension discovers direct `Hson.schema` declarations and generator-managed evidence to provide diagnostics, completion, hover, definitions, references, and rename support.

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

Direct `Hson.data` and `Hson.document` assignments to `HsonData<typeof Schema>` or `HsonDocument<typeof Schema>` gain proof after Schema-aware validation. Dynamic values can be certified with `schema.certify(...)`, while LiveMap state can be governed through `map.schema.use(...)`.

## Local applications

The extension can run a real Hson application locally using the workspace's own Node runtime and installed `hson-live`.

Application code runs in a separate workspace child process under LiveHost Node; it does not execute inside the VS Code extension host.

Configure a built application entry in workspace settings:

```json
{
  "hson.localHost.entry": "dist/local-app.js",
  "hson.localHost.applicationExport": "application",
  "hson.localHost.nodeExecutable": "node",
  "hson.localHost.port": 0
}
```

The exported value may be a `LiveHostApplication`, an array of applications, or a zero-argument factory returning either.

Use:

- **Hson: Run Local App**
- **Hson: Open Local App**
- **Hson: Restart Local App**
- **Hson: Stop Local App**
- **Hson: Show Local App Output**

The runner uses loopback networking, supports automatically assigned ports, and manages clean application restart and shutdown. Local application execution requires Workspace Trust and is currently limited to local desktop workspaces.

Local application hosting is development infrastructure, not an authentication boundary. The extension binds LiveHost Node to loopback and requires Workspace Trust, while the application remains responsible for its own authentication, authorization, and security policy. The extension supervises its local runner and LiveHost resources; additional processes created by application code remain application-owned and are not generically supervised by the extension.

Build/watch remains project-owned. The extension does not provide its own TypeScript executor, bundler, or alternate Hson runtime.

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
