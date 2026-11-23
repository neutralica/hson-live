import type { EventSourceRole } from "../../../src/internal/event-authoring-source.js";
import catalog from "./appearance-catalog.json";
/** Grammar and semantic classification contracts; appearance values live in palettes/house.json. */
export const hsonGrammarScopes = {
  "structuralName": "entity.name.type.hson",
  "authoredName": "entity.name.type.quoted.hson",
  "directive": "keyword.other.directive.hson",
  "receiving": "entity.other.attribute-name.receiving.hson",
  "sending": "entity.other.attribute-name.sending.hson",
  "iteration": "keyword.control.iteration.hson",
  "colon": "punctuation.separator.attribute.hson",
  "partSystemAttribute": "entity.other.attribute-name.system.hson",
  "partSelectorLibrary": "meta.part.selector.library.hson",
  "partSelectorMember": "meta.part.selector.member.hson",
  "partSelectorSeparator": "punctuation.separator.part-selector.hson",
  "attributeName": "entity.other.attribute-name.hson",
  "flag": "constant.language.flag.hson",
  "partDeclaration": "keyword.declaration.part.hson",
  "quotedString": "string.quoted.double.hson",
  "unquotedAttributeValue": "string.unquoted.attribute-value.hson",
  "quoteBegin": "punctuation.definition.string.begin.hson",
  "quoteEnd": "punctuation.definition.string.end.hson",
  "number": "constant.numeric.hson",
  "boolean": "constant.language.boolean.hson",
  "null": "constant.language.null.hson",
  "identityFallback": "variable.other.constant.hson",
  "colonFallback": "keyword.operator.hson",
  "quid": "constant.other.quid.hson",
  "quad": "constant.other.quad.hson",
  "identityValue": "constant.other.identity.hson",
  "identitySigil": "punctuation.definition.identity.hson",
  "identitySeparator": "punctuation.separator.identity.hson",
  "comment": "comment.line.double-slash.hson",
  "commentDelimiter": "punctuation.definition.comment.hson",
  "tagBegin": "punctuation.definition.tag.begin.hson",
  "tagEnd": "punctuation.definition.tag.end.hson",
  "selfClosingSlash": "punctuation.definition.tag.self-closing.hson",
  "arrayBegin": "punctuation.section.array.begin.hson",
  "arrayEnd": "punctuation.section.array.end.hson",
  "sequenceSeparator": "punctuation.separator.sequence.hson",
  "assignment": "keyword.operator.assignment.hson",
  "interpolationDollar": "keyword.operator.interpolation.dollar.hson",
  "interpolationPercent": "keyword.operator.interpolation.percent.hson",
  "interpolationCaret": "keyword.operator.interpolation.caret.hson",
  "interpolationBegin": "punctuation.definition.template-expression.begin.hson",
  "interpolationEnd": "punctuation.definition.template-expression.end.hson",
  "incomingReferenceName": "variable.parameter.incoming.hson",
  "referencePath": "variable.other.property.hson",
  "attributeQualifier": "meta.attribute.qualifier.hson",
  "attributeLocalName": "meta.attribute.local-name.hson",
  "referenceMember": "meta.reference.member.hson",
  "referenceSeparator": "punctuation.accessor.hson",
  "selectorBegin": "punctuation.section.selector.begin.hson",
  "selectorEnd": "punctuation.section.selector.end.hson",
  "escape": "constant.character.escape.hson",
  "invalid": "invalid.illegal.hson"
} as const;

export const hsonNativeBrackets = {
  "colorizedBracketPairs": [
    [
      "[",
      "]"
    ],
    [
      "«",
      "»"
    ],
    [
      "<",
      ">"
    ]
  ]
} as const;

const scope = hsonGrammarScopes;

/** Maps grammar scopes to semantic-token classifications and stable role names,
 * with TextMate fallbacks for other themes. This is syntax plumbing, so palette
 * tuning belongs in the appearance catalog instead. The adapter favors specific
 * leaf scopes; generated language-qualified mappings handle TS/TSX fallbacks. */
export const hsonTokenDefinitions = catalog.tokens;
export const hsonTokenModifierDefinitions = catalog.modifiers;

export function hsonModifiersForScopes(scopes: readonly string[]): string[] {
  // Structural fallback sometimes encloses `/` in a tag-end scope. The leaf
  // punctuation, not that enclosing fallback, owns the modifier.
  const leaf = scopes.at(-1);
  return Object.entries(hsonTokenModifierDefinitions)
    .filter(([modifier, definition]) => modifier === 'hsonAttribute' || modifier === 'hsonContent'
      ? definition.scopes.some(scope => scopes.includes(scope)) && (leaf === scope.quotedString || leaf === scope.quoteBegin || leaf === scope.quoteEnd)
      : definition.scopes.some(scope => scope === leaf))
    .map(([modifier]) => modifier);
}

export type HsonTokenType = keyof typeof hsonTokenDefinitions;
export const hsonTokenScopes: Record<string, string[]> = Object.fromEntries(Object.entries(hsonTokenDefinitions)
  .map(([type, definition]) => [type, [...definition.scopes, ...("fallbackScopes" in definition ? definition.fallbackScopes : [])]]));

// Exact punctuation fallback scopes keep independent TextMate customizations
// effective when the same grammar is transported as semantic tokens in TS/TSX.
for (const [type, definition] of Object.entries(hsonTokenDefinitions)) {
  for (const syntaxScope of definition.scopes) {
    const modifiers = hsonModifiersForScopes([syntaxScope]);
    if (modifiers.length) hsonTokenScopes[[type, ...modifiers].join(".")] = type === "hsonReference"
      ? [`${scope.referencePath} ${syntaxScope}`, scope.referencePath]
      : [syntaxScope, ...("fallbackScopes" in definition ? definition.fallbackScopes : [])];
  }
}

for (const [modifier, definition] of Object.entries(hsonTokenModifierDefinitions)) {
  if ("types" in definition) for (const type of definition.types) {
    const base = hsonTokenScopes[type]!;
    hsonTokenScopes[`${type}.${modifier}`] = [...definition.scopes.map(scope => `${base[0]} ${scope}`), ...base];
  }
}

// Native themes match scope stacks, including enclosing strings. Preserve that
// context when TextMate classification is transported as semantic tokens.
for (const [type, scopes] of Object.entries(hsonTokenScopes)) {
  const definition = Object.entries(hsonTokenDefinitions).find(([base]) => base === type.split('.')[0])?.[1];
  const parent = definition && 'fallbackContext' in definition ? definition.fallbackContext : undefined;
  if (parent) hsonTokenScopes[type] = [...scopes.map(scope => parent + ' ' + scope), ...scopes];
}

// Attribute/content contexts enclose the string and its punctuation, rather
// than following them. Preserve combined quote modifiers for exact end scopes.
for (const context of ['hsonAttribute', 'hsonContent'] as const) {
  const parent = hsonTokenModifierDefinitions[context].scopes[0];
  for (const type of hsonTokenModifierDefinitions[context].types) {
    hsonTokenScopes[`${type}.${context}`] = hsonTokenScopes[type]!.map(stack => `${parent} ${stack}`);
    if (type === 'hsonQuote') for (const edge of ['hsonQuoteOpen','hsonQuoteClose'])
      hsonTokenScopes[`${type}.${context}.${edge}`] = hsonTokenScopes[`${type}.${edge}`]!.map(stack => `${parent} ${stack}`);
  }
}

const scopeTypes = new Map<string, HsonTokenType>();
for (const type in hsonTokenDefinitions) {
  if (isHsonTokenType(type)) for (const scope of hsonTokenDefinitions[type].scopes) scopeTypes.set(scope, type);
}
function isHsonTokenType(type: string): type is HsonTokenType {
  return Object.hasOwn(hsonTokenDefinitions, type);
}
export function hsonTypeForScope(scope: string): HsonTokenType | undefined {
  return scopeTypes.get(scope);
}

const eventTypes = new Map<string, HsonTokenType>();
for (const { binding } of Object.values(catalog.roles)) {
  if ("eventRole" in binding && isHsonTokenType(binding.selector)) eventTypes.set(binding.eventRole, binding.selector);
}

export function event_token_type(role: EventSourceRole): HsonTokenType | undefined {
  return eventTypes.get(role);
}
