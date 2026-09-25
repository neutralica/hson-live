# Hson Language for VS Code

The Hson extension recognizes official `Hson.canonical`, `Hson.data`, `Hson.document`, and `Hson.schema` tagged templates by TypeScript import binding, including aliases. It uses the existing Hson grammar for highlighting and syntax diagnostics, and preserves the established formatter, structural editing, format-on-save, Markdown `hson` fences, and local application runner.

Schema authoring is centered on a direct, substitution-free `Hson.schema` declaration. The packaged `hson-schema` tool generates private evidence beside that declaration. Application code uses `SchemaType<typeof Schema>` for a readonly value projection and `HsonData<typeof Schema>` or `HsonDocument<typeof Schema>` for canonical strings proven against the Schema. Direct authored assignments are validated by the Schema analyzer. The editor proof bridge filters a TypeScript assignment diagnostic only when current generated evidence and the template's semantic validation support that proof.

Schema-aware diagnostics, completion, definitions, references, rename, and hover use the shared Schema compiler and local source facts. Schema Watch and Check call the workspace's installed `hson-schema` executable; they do not execute application code in the extension host. Dynamic certification is `schema.certify(candidate)`, while a LiveMap library declares its Schema at `fromLibraries` construction and validates future mutations against it.

See the [extension README](../editors/vscode-hson/README.md) for commands and setup, and the [Schema contract](contracts/hson-schema-mvp.md) for authoring and proof.
