# HSON Language for VS Code

This extension provides syntax highlighting and authoritative parser diagnostics
for standalone `.hson` files, supported `HSON` tagged templates, and statically
recoverable strings passed to official `fromHson` boundaries in TypeScript and
TSX. In trusted Schema mode, `HSON` templates also support bounded structural
completion.

Highlighting and diagnostics share TypeScript binding-aware discovery of named
`HSON` imports from `hson-live` and `hson-live/hson`, including renamed imports.
Local/shadowed names, wrong packages, copied functions and wrappers are excluded.
The existing HSON TextMate grammar supplies the template tokens, published through
VS Code semantic tokens with HSON scope fallbacks. A spelling-only injection is
not contributed. Invalid HSON and literal segments around interpolation are still
highlighted. Neither highlighting nor secure diagnostics requires Schema, a
trusted provider, Workspace Trust, completion, or application execution.

At the JavaScript/TypeScript authoring boundary, a binding-recognized literal
`HSON` tag carries a four-letter marker: H is blue, S is yellow, O is pink, and
N is green. Renamed official imports retain normal recognized-tag presentation;
the extension does not map arbitrary alias letters onto that marker. Local,
shadowed, wrong-package, copied, and otherwise unrelated names receive no marker.
Standalone `.hson` files do not invent one. All ordinary HSON body syntax remains
controlled by the active syntax theme.

The marker uses appearance-aware editor color IDs. Users may override them in
`workbench.colorCustomizations` without editing the extension:

```json
{
  "workbench.colorCustomizations": {
    "hson.authoringMarker.h": "#74A7D8",
    "hson.authoringMarker.s": "#D2B45F",
    "hson.authoringMarker.o": "#D789AE",
    "hson.authoringMarker.n": "#78B996"
  }
}
```

Dark defaults are `#74A7D8`, `#D2B45F`, `#D789AE`, and `#78B996`;
light defaults are `#356A9A`, `#786422`, `#8E4768`, and `#3E7256`.
They are deliberately softer than strong syntax foregrounds so the marker stays
subordinate to the authored HSON body. High-contrast themes use brighter variants.

Syntax diagnostics analyze only open in-memory documents. In the default secure
mode the extension does not load a project or execute workspace code. It does
not write helper files or modify user source.
Substitution-free templates receive authoritative whole-HSON tag admission
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

## Trusted Schema completion (D6)

Use **Trigger Suggest** inside `HSON` template literal segments for declared
members, finite literals, document tags, attrs, flags, and known child positions.
Completions come from the **actual current runtime Schema**, require Workspace
Trust plus trusted Schema diagnostics enablement, and become available after
that runtime has warmed up. Completion never starts or reloads the provider.
Required declarations sort first; missing values use blank snippet placeholders,
not invented defaults. Arbitrary constraints remain validation-only.

Multiple governing contracts, stale runtime-dependent values, ambiguous branches,
or syntax that cannot establish a cursor slot may temporarily give no completion.
`${...}` remains ordinary TypeScript expression editing. D6 is manual-invocation
only and deliberately does **not** provide Schema completion in ordinary
`fromHson(...)` strings/templates: use `HSON` for rich interactive authoring,
and `fromHson` when you already have HSON source.

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
mutable aliases or helper transformations are attempted. Interpolation requires
actual trusted provider capture as described below.
Multiple validation statements run independently, including stateful predicates.

The status bar distinguishes off, waiting, valid, invalid, stale, ambiguous,
unavailable, and runtime failure. No squiggle is not a claim of validity.

### Evaluated HSON substitutions (D5)

`HSON` preserves JavaScript primitive types: strings become quoted HSON strings,
numbers remain numbers (including `-0`), booleans remain booleans, and `null`
remains null. Substitutions are values, not structural source splices.

When your explicitly configured trusted provider evaluates an instrumented
diagnostic copy, Schema errors can underline the expression inside `${...}`.
For example: “This expression evaluated to an HSON string, but the Schema
requires number here.” The underline identifies the code that **produced** the
invalid value; it does not imply those JavaScript characters are an HSON token.
This works with standalone `HSON.validate` and natural map/schema attachment.
Runtime HSON admission errors can also appear without a later Schema call.

Expression or literal edits immediately retire runtime-derived diagnostics.
Unsaved changes wait for fresh provider evaluation; old values are never combined
with newly edited source. Save/reload through the existing provider lifecycle
to obtain new evidence. Repeated evaluations without a unique association are
ambiguous, not “last value wins.” Secure mode never executes expressions and
does not claim an interpolated template is valid. A Schema-only provider that
does not evaluate the template cannot supply its runtime values.
The output channel contains stage timings, not candidate source. Edits clear
old Schema diagnostics immediately; validation is debounced by 150 ms.
Provider changes retire the runtime; unsaved provider changes outside recognized
template bodies remain stale until saved. Reloads use D1's finite replacement
budget (one replacement); after exhaustion, reload the extension window or
explicitly reconfigure to create a new owner. This is not hot module reload.

`map.schema.use` backward association is provided by the D3/D4 lifecycle path
below and requires real construction/revision evidence, not an assumption that
the map was not mutated.

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

Direct and renamed official imports receive the same grammar-backed highlighting
and admission diagnostics because both use the same TypeScript binding identity.

Ordinary strings and templates inside `fromHson(...)` intentionally retain
ordinary TypeScript coloring. D4 adds semantic diagnostics, not spelling-based
TextMate injection. `HSON\`...\`` remains the preferred embedded authoring form
with first-class HSON presentation.

Use **Developer: Inspect Editor Tokens and Scopes** in the Command Palette to
inspect the emitted HSON semantic tokens and their TextMate scope fallbacks.

### Zero-Schema regression verification

`npm run test:baseline` runs 24 focused recognition, grammar, admission, mapping
and stale-publication checks. `npm run test:baseline:integration` runs the unsaved
edit journey in trusted and genuinely restricted workspaces. Set
`HSON_VSCODE_EXECUTABLE` to select a VS Code binary (the runner defaults to the
ordinary macOS installation). `npm run test:baseline:installed` builds the actual
VSIX and runs the same journey from a clean installed-extension directory, using
an empty test-driver extension rather than a development override for HSON.

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
