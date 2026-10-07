# Hson Language for VS Code

The Hson extension recognizes official `Hson.canonical`, `Hson.data`, `Hson.document`, and `Hson.schema` tagged templates by TypeScript import binding, including aliases. It uses the existing Hson grammar for highlighting and syntax diagnostics, and preserves the established formatter, structural editing, format-on-save, Markdown `hson` fences, and local application runner.

Intentional negative fixtures in `.ts` and `.tsx` can assert a normal Hson document diagnostic with a standalone host comment:

```ts
// @ts-expect-error Tagged substitutions exclude objects.
// @hson-expect-error HSON_INTERPOLATION_CANONICAL_STATIC_TYPE
Hson.canonical`${{}}`;
```

The exact code is required, with no trailing explanation. The comment targets the unique discovered Hson member template in the immediately following variable, expression, return, or throw statement; whitespace and comments may intervene. Function/class bodies are excluded from target selection; multiple regions reachable in ordinary expression structure fail the expectation. Each directive consumes one matching diagnostic owned by that template, leaving diagnostics owned by nested authored regions and other diagnostics visible. Repeated directives require distinct occurrences. Missing expectations report `HSON_EXPECT_ERROR_UNUSED`; malformed directives report `HSON_EXPECT_ERROR_INVALID`, both as Errors on the comment, including orphan comments before closing tokens. Uncoded and generic `TRANSFORM_ERROR` diagnostics remain visible. Whole-file diagnostic ignore does not disable expectation failures. This mechanism does not cover either separate Schema diagnostic pipeline, other host languages, or command-line checks.

Schema authoring is centered on a direct, substitution-free `Hson.schema` declaration. The packaged `hson-schema` tool keeps private compiler evidence in the current `.hson/` project; the extension uses an equivalent in-memory view for unsaved text. Application code uses `HsonFromSchema<typeof Schema>` for canonical strings proven against either Schema family, and `JsonFromSchema<typeof DataSchema>` for a data Schema's readonly JS/JSON-shaped value projection. The lower-level `HsonData<S>` and `HsonDocument<S>` remain available. Direct authored assignments are validated by the Schema analyzer.

Schema-aware diagnostics, completion, definitions, references, rename, and hover use the shared Schema compiler and local source facts. Schema Watch and Check call the workspace's installed `hson-schema` executable; they do not execute application code in the extension host. Dynamic certification is `schema.certify(candidate)`. A LiveMap library may establish its governing Schema at construction or tighten a family-top contract with a direct `map.lib("name").schema.use(Schema)` statement. The shared compiler/editor view inserts a type-only flow proof after supported direct calls, so subsequent getter, path, endpoint, and mutation types update immediately without changing emitted JavaScript.

See the [extension README](../editors/vscode-hson/README.md) for commands and setup, and the [Schema contract](contracts/hson-schema-mvp.md) for authoring and proof.
