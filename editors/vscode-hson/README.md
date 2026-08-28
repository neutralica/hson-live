# HSON Language for VS Code

This extension provides syntax highlighting and authoritative parser diagnostics
for standalone `.hson` files and supported `HSON` tagged templates in
TypeScript and TSX.

The tagged-template injection intentionally recognizes only the exact direct tag
spelling `HSON`. Import aliases and facade/property forms are left to the
semantic diagnostics layer. Highlighting is lexical presentation, not HSON
validation: an official aliased import can receive parser diagnostics while
retaining ordinary TypeScript template coloring.

Syntax diagnostics analyze only open in-memory documents. In the default secure
mode the extension does not load a project or execute workspace code. It does
not write helper files or modify user source.
Substitution-free templates receive authoritative whole-HSON diagnostics.
Interpolated templates are discovered, but receive no speculative whole-source
syntax diagnostic because their primitive values are known only at runtime.

## Trusted Schema diagnostics (D2, opt in)

Both VS Code Workspace Trust and `hson.trustedSchemaDiagnostics.enabled: true`
are required. Workspace Trust alone never enables project execution. Restricted
Mode retains highlighting and secure syntax diagnostics. This is trusted Node
execution, not a sandbox.

Configure a Schema-only registration module, **not the application entrypoint**:

```js
// schema.js — compiled project module using this project's hson-live instance
import { hson } from "hson-live";
export { hson }; // explicit runtime-origin evidence
export const UserSchema = hson.liveMap.schema.define(s =>
  s.object({ user: s.object({ age: s.number }) }));
export const trustedSchemas = { userContract: UserSchema };
```

```ts
import { HSON } from "hson-live/hson";
import { UserSchema } from "./schema.js";
const user = HSON`<user <age "37">>`;
HSON.validate(UserSchema, user);
```

The existing `hsonLiveMap.schema.validate` and `hson.liveMap.schema.validate`
entrances also remain supported, using their official subsystem/root imports.

The earlier `"37"` receives: “Expected `age` to be a number, but this value is
an HSON string.” Fixing it to `37` updates the diagnostics while still unsaved.
The application entrypoint and its `validate` statement need not execute.
The editor independently asks the actual registered Schema about this candidate.
Arbitrary stateful predicates may give different answers later.

Example workspace settings (paths relative to the workspace folder):

```json
{
  "hson.trustedSchemaDiagnostics.enabled": true,
  "hson.trustedSchemaDiagnostics.module": "schema.js",
  "hson.trustedSchemaDiagnostics.hsonModule": "node_modules/hson-live/dist/hson.js"
}
```

`runtimeEntry` defaults to the private D1 entry beside that `hson.js`, under
`internal/trusted-schema-diagnostics/node-runtime-entry.js`. Both must belong to
the same runtime instance as the registered Schemas. `execArgv` optionally
configures an explicit Node loader for development TypeScript modules. No
runtime entry, registry, or protocol is added to package exports.

The source import must resolve to the registered module URL. Initial discovery
supports relative named imports, renamed official `HSON` imports, local `const`
Schema bindings with explicit private registration metadata, parentheses, and
acyclic identifier-only `const` aliases (at most 32 hops). Canonical declarations
must precede their use in the same module/function-body statement domain.
No namespace imports, re-export/path-alias inference, extracted validators,
mutable aliases, helper transformations, or interpolation capture are attempted.
Multiple validation statements run independently, including stateful predicates.

The status bar distinguishes off, waiting, valid, invalid, stale, ambiguous,
unavailable, and runtime failure. No squiggle is not a claim of validity.
The output channel contains stage timings, not candidate source. Edits clear
old Schema diagnostics immediately; validation is debounced by 150 ms.
Provider changes retire the runtime; unsaved provider changes outside recognized
template bodies remain stale until saved. Reloads use D1's finite replacement
budget (one replacement); after exhaustion, reload the extension window or
explicitly reconfigure to create a new owner. This is not hot module reload.

`map.schema.use` backward association remains a follow-up. It will require real
lifecycle evidence, not an assumption that the map was not mutated.

## Development

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
   import { HSON, HSON as markup } from "hson-live/hson";

   const direct = HSON`
     <main
       <broken
   `;

   const alias = markup`
     <main
       <broken
   `;
   ```

6. Replace either body with valid HSON and confirm its squiggle clears:

   ```ts
   const page = HSON`
     <main
       <h1 "Hello">
     >
   `;
   ```

The direct `HSON` form receives the Pass 3 TextMate injection coloring.
The alias may retain ordinary TypeScript template coloring, but both receive the
same semantic diagnostics because import identity is resolved by the bundled
TypeScript scanner.

Use **Developer: Inspect Editor Tokens and Scopes** in the Command Palette to
inspect the emitted TextMate scopes.

### Natural LiveMap Schema governance (D3)

With a trusted provider supplying source-bound D1 lifecycle evidence, ordinary
map-owning code needs no extra standalone validation call:

```ts
import { HSON } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import { UserSchema } from "./schema.js";

const source = HSON`<user <age "37">>`;
const map = hsonLiveMap.fromHson(source);
map.schema.use(UserSchema);
```

The original template receives the current candidate's Schema diagnostics,
including when initial attachment rejects. Related information identifies the
use site. Both the dedicated facade above and `hson.liveMap.fromHson` work;
local immutable aliases and inline templates are supported, but the standalone
HSON block is the preferred style. Multiple maps retain independent contracts.
Actual mutation, including mutation followed by restoration, suppresses source
attribution for that map.

Workspace Trust and explicit enablement are still both required. A Schema-only
provider does not establish map correspondence: D3 needs the existing D1
capture path bound to the source sites. The private provider instrumenter and
its limits are documented in
[`src/internal/trusted-schema-diagnostics/README.md`](../../src/internal/trusted-schema-diagnostics/README.md#d3-natural-map-association).
There is no automatic application import, public provenance API, or new
validation API. The editor makes no claim that application execution reached
`schema.use`.
