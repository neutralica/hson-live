# Hson Language for VS Code

The Hson extension recognizes official `Hson.canonical`, `Hson.data`, `Hson.document`, and `Hson.schema` tagged templates by TypeScript import binding, including aliases. It uses the existing Hson grammar for highlighting and syntax diagnostics, and preserves the established formatter, structural editing, format-on-save, Markdown `hson` fences, and local application runner.

Schema authoring is centered on a direct, substitution-free `Hson.schema` declaration. The packaged `hson-schema` tool keeps private compiler evidence in the current `.hson/` project; the extension uses an equivalent in-memory view for unsaved text. Application code uses `SchemaType<typeof Schema>` for a readonly value projection and `HsonData<typeof Schema>` or `HsonDocument<typeof Schema>` for canonical strings proven against the Schema. Direct authored assignments are validated by the Schema analyzer.

Schema-aware diagnostics, completion, definitions, references, rename, and hover use the shared Schema compiler and local source facts. Schema Watch and Check call the workspace's installed `hson-schema` executable; they do not execute application code in the extension host. Dynamic certification is `schema.certify(candidate)`. A LiveMap library may establish its governing Schema at construction or tighten a family-top contract with a direct `map.lib("name").schema.use(Schema)` statement. The shared compiler/editor view inserts a type-only flow proof after supported direct calls, so subsequent getter, path, endpoint, and mutation types update immediately without changing emitted JavaScript.

See the [extension README](../editors/vscode-hson/README.md) for commands and setup, and the [Schema contract](contracts/hson-schema-mvp.md) for authoring and proof.
