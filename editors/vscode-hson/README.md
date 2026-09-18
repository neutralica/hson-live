# Hson Language for VS Code

Hson Language adds Hson authoring, Schema tooling, and local Hson application support to VS Code.

- syntax highlighting, definitions, completion, and contextual diagnostics for `.hson` files and `Hson`` tagged templates;
- Schema-aware editing, including semantic references and path-backed completion;
- generated TypeScript types from Hson Schema declarations;
- Schema check/watch workflows for editor and CI use;
- a local application runner using the workspace's own Node and `hson-live`.

Highlighting and diagnostics use TypeScript binding identity for official `hson-live` imports, including renamed imports. Hson authored through `Hson`` and supported literal `fromHson(...)` inputs receives the same grammar-aware presentation.

## Schema authoring

Schemas are authored directly in canonical Hson:

```ts
import { Hson, type HsonSchema } from "hson-live/hson";

export const UserSchema: HsonSchema = Hson`
  <type "data" content <
    user <content <
      age "number"
    >>
  >>
`;
```

The extension discovers static `HsonSchema` declarations and generated evidence to provide diagnostics, completion, hover, definitions, references, and rename support.

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

Runtime values can be certified explicitly with `Hson.certify(...)`, while LiveMap state can be governed through `map.schema.use(...)`.

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
