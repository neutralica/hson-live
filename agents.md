# agents.md

This repository contains the hson-live library.
Agents must preserve API stability and runtime identity.

## 1. Public API stability

- Do NOT remove or rename public exports without explicit instruction.
- Getter-based APIs (e.g. LiveTree.id, LiveTree.classlist) are intentional.
- Avoid breaking changes unless the task explicitly targets a major version.

## 2. Prototype and identity rules

- LiveTree methods and getters MUST live on the prototype.
- Do NOT convert instance methods to closures or arrow properties.
- Avoid patterns that duplicate class definitions across build outputs.

## 3. Build and distribution

- Ensure compiled outputs match source semantics.
- Avoid multiple entrypoints exporting divergent LiveTree definitions.
- Be cautious when adding new subpath exports (e.g. /types).

## 4. TypeScript design rules

- Prefer external type guards over method-attached predicates.
- Avoid `as` assertions when a type annotation or narrowing is possible.
- Public types should align with runtime behavior (no phantom APIs).

## 5. Error handling

- LiveTree methods should not throw in normal usage.
- Failure should be representable via return values or explicit helpers.
- Do not introduce Outcome semantics here unless explicitly requested.

## 6. Scope discipline

- This is a core library, not a demo.
- Do not add UI, logging, or app-level glue.
- Do not import Intrastructure unless explicitly directed.