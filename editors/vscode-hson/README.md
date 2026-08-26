# HSON Language for VS Code

This extension provides syntax highlighting and authoritative parser diagnostics
for standalone `.hson` files and supported `hson` tagged templates in
TypeScript and TSX.

The tagged-template injection intentionally recognizes only the exact direct tag
spelling `hson`. Import aliases and facade/property forms are left to the
semantic diagnostics layer. Highlighting is lexical presentation, not HSON
validation: an official aliased import can receive parser diagnostics while
retaining ordinary TypeScript template coloring.

Diagnostics analyze only open in-memory documents. The extension does not load a
project, execute workspace code, write helper files, or modify user source.
Substitution-free templates receive authoritative whole-HSON diagnostics.
Interpolated templates are discovered, but receive no speculative whole-source
syntax diagnostic because their primitive values are known only at runtime.

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
   import { hson, hson as markup } from "hson-live";

   const direct = hson`
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
   const page = hson`
     <main
       <h1 "Hello">
     >
   `;
   ```

The direct `hson` form receives the Pass 3 TextMate injection coloring.
The alias may retain ordinary TypeScript template coloring, but both receive the
same semantic diagnostics because import identity is resolved by the bundled
TypeScript scanner.

Use **Developer: Inspect Editor Tokens and Scopes** in the Command Palette to
inspect the emitted TextMate scopes.
