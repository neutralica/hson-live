export const HSON_TAGGED_TEMPLATE_DISCOVERY_PROPOSITIONS = Object.freeze([
  "official root and hson entrypoints are recognized in source order",
  "direct imports and aliases use the exact ImportSpecifier binding",
  "function parameter and nested-scope shadowing are excluded",
  "local, block, loop, and catch bindings shadow only their lexical regions",
  "unrelated and relative imports never establish official provenance",
  "namespace, default, type-only, re-export, CommonJS, alias, and wrapper forms are excluded",
  "facade, element, parenthesized, non-null, optional, and generic tag forms are excluded",
  "empty, one-line, multiline, indented, escaped, and terminal templates preserve exact bodies",
  "physical CRLF is retained in exact template and body ranges",
  "TSX with adjacent JSX is supported while non-TS extensions fail closed",
  "compiler-host filename identity supports editor-shaped TS and TSX paths",
  "one and multiple substitutions are classified without becoming Hson sources",
  "nested, multiline, and complex substitution expressions remain opaque exact ranges",
  "an unrelated recoverable parser error does not suppress a valid later template",
  "parser damage overlapping imports or tagged templates is omitted",
  "LF integration discovers, parses, and maps primary plus related declaration evidence",
  "CRLF integration maps multiple original-host templates independently",
  "substituted discoveries remain segregated from authoritative Hson parsing",
] as const);

export type HsonTaggedTemplateDiscoveryProposition =
  typeof HSON_TAGGED_TEMPLATE_DISCOVERY_PROPOSITIONS[number];
