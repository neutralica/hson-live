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

Literal usage references to the official `hson` facade carry strong blue, yellow,
pink, and green family colors; literal usage references to official `HSON` use
the same hues with softer opacity. This includes bare references, member roots,
validation calls, and `HSON` tagged templates. Import/export declarations and
renamed imports retain ordinary host-theme presentation. Local, shadowed,
wrong-package, property-name, and otherwise unrelated lookalikes receive no
marker. Standalone `.hson` files do not invent one. All ordinary HSON body syntax
remains controlled by the active syntax theme.

## Settings

Run **HSON: Open Settings** or search Settings for `@ext:terminal-gothic.hson-language`.
The initial user-facing surface is deliberately compact:

- **HSON › Appearance: Library Marker Strength**
  (`hson.appearance.libraryMarkerStrength`, default `1.0`) controls the presence
  of official literal `hson` markers.
- **HSON › Appearance: Authoring Marker Strength**
  (`hson.appearance.authoringMarkerStrength`, default `0.60`) keeps official
  literal `HSON` markers visibly quieter.
- **HSON › Appearance: Blue / Yellow / Orange / Green**
  (`hson.appearance.blue`, `.yellow`, `.orange`, `.green`, default empty) are
  optional hexadecimal colors shared by the corresponding `hson` and `HSON`
  letters. The Settings UI presents discoverable text fields accepting `#RGB`,
  `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`.
- **HSON › Schema Diagnostics: Trusted Execution**
  (`hson.trustedSchemaDiagnostics.enabled`, default `false`, resource scope)
  permits project code execution only when Workspace Trust and separate HSON
  consent are also present.
- **HSON › Runtime / Provider** contains the existing resource-scoped Provider
  Entry, HSON Runtime Module, optional Runtime Entry, and Node Arguments needed
  by the current D1–D6 trusted runtime. Paths are relative to the containing
  workspace folder. These execution-sensitive settings are restricted in
  Restricted Mode.

Changing a strength or shared color recreates the marker decorations and refreshes
visible editors immediately; no rebuild, reinstall, window reload, or runtime
restart is required. Trusted-runtime configuration changes retire the old generation and
invalidate consent for the previous configuration. The 150 ms validation
debounce, request/startup timeouts, restart budget, queue limits, and log bounds
remain implementation-owned safeguards. Schema completion stays on whenever a
current authorized trusted runtime is available; it has no separate toggle.

When a shared color is empty, each marker uses its independently tuned contributed
light, dark, high-contrast, or high-contrast-light color. The existing color IDs
remain the advanced theme-specific override path through
`workbench.colorCustomizations`:

```json
{
  "workbench.colorCustomizations": {
    "hson.libraryMarker.h": "#69B8EE",
    "hson.libraryMarker.s": "#F2D064",
    "hson.libraryMarker.o": "#F18BA8",
    "hson.libraryMarker.n": "#6CCA96",
    "hson.authoringMarker.h": "#69B8EE",
    "hson.authoringMarker.s": "#F2D064",
    "hson.authoringMarker.o": "#F18BA8",
    "hson.authoringMarker.n": "#6CCA96"
  }
}
```

Dark strong defaults are `#69B8EE`, `#F2D064`, `#F18BA8`, and `#6CCA96`;
light strong defaults are `#2A86C0`, `#AD8200`, `#D45179`, and `#31945E`.
High-contrast strong defaults are `#6CB8F0`, `#F5D35D`, `#F58AA8`, and
`#6BD092`; high-contrast-light strong defaults are `#005F9E`, `#6F5C00`,
`#A51F50`, and `#096A36`. The authoring IDs use the same theme-specific RGB
defaults; the Authoring Marker Strength setting supplies the default `0.60`
opacity. An explicit shared Appearance color overrides that hue for both marker
families; library and authoring strength still apply independently. A supplied
alpha channel is respected and multiplied by strength.

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

VS Code Workspace Trust, `hson.trustedSchemaDiagnostics.enabled: true`, and a
separate HSON consent receipt for the containing workspace folder and exact
provider/runtime configuration are all required. Workspace Trust alone never
enables project execution. A checked-in workspace setting can express preference
but cannot create the consent receipt, so it remains inert until the user accepts
the HSON execution warning or runs **HSON: Enable Trusted Schema Diagnostics**.
Changing a provider path, runtime path, runtime entry, or Node argument invalidates
the receipt and requires consent for the new configuration. Restricted Mode
retains highlighting and secure syntax diagnostics. This is trusted Node
execution with the user's permissions in a supervised separate process, not a
security sandbox.

The status-bar item reports `off`, `waiting`, `current-valid`, `current-invalid`,
`stale`, `ambiguous`, `unavailable`, or `runtime-failed`; its tooltip explains
the active document's state and never treats “no diagnostic” as proof of
validity. Use **HSON: Disable Trusted Schema Diagnostics** to stop new trusted
work, clear trusted diagnostics, and dispose the runtime. Use **HSON: Restart
Trusted Schema Runtime** after an external provider repair; restart is available
only while the exact configuration is trusted and authorized.

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
