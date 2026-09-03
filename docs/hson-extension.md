// hson-extension.md

# Hson VS Code Extension — Development History

The Hson VS Code extension is now in a fairly robust beta state. Its envisioned role has expanded from a simple IDE authoring widget. Its new capabilities position it as a schema-aware authoring utility that augments TypeScript's compile-time checks with its own finer schema constraints, adding protection against a wider class of errors than merely type errors. 

Schema were rewritten from the ground up to serve this functionality. Schema were transformed from a JS-builder pattern that validated schema at runtime to a declarative HsonSchema expressed as Hson. The promise of schema-generated TypeScript types were thus realized, and a limited type->HsonSchema pipeline established in the other direction for adaptation of existing data sources and usage within LiveMap.


1. **Embedded Hson authoring**  
   Added binding-aware recognition of Hson tagged templates, Hson-specific highlighting, and precise source mapping so parser and semantic diagnostics land inside the authored template.

2. **Contextual diagnostics and completion**  
   Expanded from syntax support into structure-aware editing for Hson data and documents, including contextual completion and provenance-backed diagnostics.

3. **Schema-backed editing becomes central**  
   Added HsonSchema-aware diagnostics and completion, making Schema a primary editor context rather than a separate validation step.

4. **HsonSchema compiler integration**  
   Moved Schema understanding onto the shared editor-neutral HsonSchema compiler. The extension now presents the same Schema semantics used by generation, build, and CI rather than maintaining editor-specific rules.

5. **Schema → TypeScript generation**  
   Added generated `<SchemaName>Type` and `<SchemaName>Hson` symbols as real TypeScript declarations, available to ordinary workspace completion, navigation, imports, declaration emit, and package consumers.

6. **Static Schema-bound Hson authoring**  
   Established the direct authoring pattern where a `SchemaNameHson` annotation associates a Hson literal with its Schema and validates it as it is authored, eliminating the earlier validator-below-the-declaration workflow.

7. **Schema language growth in the editor**  
   Shared compiler support brought data/document Schemas, arrays, tuples, unions, attrs, refinements, `defs`/`ref`, recursion, repeat/count, and other Schema features into editor diagnostics and completion without parallel extension implementations.

8. **Proof-bearing refinement support**  
   Extended generated/editor typing beyond structural shapes to constraints such as integers, numeric bounds, string length/content constraints, and uniqueness, while retaining precise diagnostics on invalid authored Hson.

9. **Declarative composition and recursion tooling**  
   Added editor support around `defs` and `ref`, with compiler-known definition/reference relationships, unresolved-reference diagnostics, and source ranges suitable for navigation and refactoring.

10. **Downstream Schema tooling**  
    Promoted Schema compilation into the packaged `hson-schema` executable so consuming projects can generate, verify, check, build, and watch their own HsonSchema declarations without depending on the `hson-live` source checkout.

11. **Schema generation/watch UX**  
    Added VS Code controls around the workspace-local Schema tooling, including generation, watch lifecycle, status/output, and actionable handling of missing or stale generated evidence.

12. **Schema symbol tooling**  
    Extended the extension from template assistance into compiler-backed Schema symbol handling, using semantic declaration/reference relationships rather than textual search.

13. **LiveMap-aware typed authoring**  
    As LiveMap gained Schema-governed libraries, generated Schema types became part of normal editor-visible LiveMap usage: statically known library names, library-specific value types, typed Handles, and data/document distinctions are available through ordinary TypeScript.

14. **Multi-library LiveMap support**  
    The extension now sits alongside a LiveMap model with named, independently Schema-governed data and document libraries, while preserving typed library selection and Schema-derived authoring throughout local and hosted use.

15. **Current user-facing workflow**  
    Author a `HsonSchema`, generate or watch its declarations, use the generated `SchemaNameType` and `SchemaNameHson` symbols directly in TypeScript, and receive Hson/Schema diagnostics and completion inline while editing.

16. **Overall extension progression**  
    The extension evolved from Hson tagged-template recognition into an integrated Hson/Schema authoring environment with compiler-backed diagnostics, completion, generated types, Schema symbol tooling, and workspace Schema lifecycle controls.