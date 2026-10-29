/** Grammar and semantic classification contracts; appearance values live in appearance.ts. */
export const hsonGrammarScopes = {
  "structuralName": "entity.name.type.hson",
  "authoredName": "entity.name.type.quoted.hson",
  "directive": "keyword.other.directive.hson",
  "receiving": "entity.other.attribute-name.receiving.hson",
  "sending": "entity.other.attribute-name.sending.hson",
  "iteration": "keyword.control.iteration.hson",
  "colon": "punctuation.separator.attribute.hson",
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
export const hsonTokenDefinitions = {
  hsonType: { role: "element", superType: "type", scopes: [scope.structuralName, scope.authoredName] },
  hsonProperty: { role: "attribute", superType: "property", scopes: [scope.attributeName] },
  hsonFlag: { role: "flag", scopes: [scope.flag] },
  hsonDirective: { role: "directive", scopes: [scope.directive] },
  hsonReceiving: { role: "receiving", scopes: [scope.receiving] },
  hsonSending: { role: "sending", scopes: [scope.sending] },
  hsonIteration: { role: "iteration", scopes: [scope.iteration] },
  hsonLocalReferenceSigil: { role: "localReference", scopes: [scope.interpolationCaret] },
  hsonIncomingReferenceSigil: { role: "incomingReference", scopes: [scope.interpolationPercent] },
  hsonString: { role: "text", superType: "string", scopes: [scope.quotedString, scope.unquotedAttributeValue] },
  hsonNumber: { role: "number", superType: "number", scopes: [scope.number] },
  hsonKeyword: { role: "primitive", superType: "keyword", scopes: [scope.boolean, scope.null] },
  hsonDeclaration: { role: "directive", scopes: [scope.partDeclaration] },
  hsonQuid: { role: "quad", scopes: [scope.quid], fallbackScopes: [scope.identityFallback] },
  hsonQuad: { role: "quad", scopes: [scope.quad], fallbackScopes: [scope.identityFallback] },
  hsonIdentityMarker: { role: "quad", scopes: [scope.identitySigil], fallbackScopes: [scope.identityFallback] },
  hsonComment: { role: "comment", superType: "comment", scopes: [scope.comment, scope.commentDelimiter] },
  hsonDelimiter: { role: "structure", scopes: [scope.tagBegin, scope.tagEnd, scope.selfClosingSlash,
    scope.arrayBegin, scope.arrayEnd, scope.sequenceSeparator] },
  hsonOperator: { role: "assignment", scopes: [scope.assignment, scope.interpolationDollar] },
  hsonColon: { role: "colon", scopes: [scope.colon, scope.identitySeparator], fallbackScopes: [scope.colonFallback] },
  hsonEscape: { role: "escape", scopes: [scope.escape] },
  hsonInvalid: { role: "invalid", scopes: [scope.invalid] },
  hsonReference: { role: "referencePath", scopes: [scope.referencePath, scope.referenceSeparator, scope.selectorBegin, scope.selectorEnd] },
  hsonInterpolationDelimiter: { role: "structure", scopes: [scope.interpolationBegin, scope.interpolationEnd] },
  hsonQuote: { role: "quote", scopes: [scope.quoteBegin, scope.quoteEnd], fallbackScopes: [scope.quotedString] },
} as const satisfies Record<string, {
  role: string; superType?: string; scopes: readonly string[]; fallbackScopes?: readonly string[];
}>;

/** Orthogonal syntax refinements: retain the semantic role and its default color.
 * Existing types remain valid customization selectors, including with modifiers.
 * Punctuation modifiers expose scopes that previously collapsed in the adapter. */
const qualifiedAttributeTypes = ["hsonProperty", "hsonFlag", "hsonDirective", "hsonReceiving", "hsonSending", "hsonIteration", "hsonDeclaration"];
export const hsonTokenModifierDefinitions = {
  hsonQualifier: { scopes: [scope.attributeQualifier], types: qualifiedAttributeTypes, description: "Qualifier before the first attribute colon" },
  hsonLocalName: { scopes: [scope.attributeLocalName], types: qualifiedAttributeTypes, description: "Attribute segment following a colon" },
  hsonTagOpen: { scopes: [scope.tagBegin], description: "Opening Hson element delimiter" },
  hsonTagClose: { scopes: [scope.tagEnd], description: "Closing Hson element delimiter" },
  hsonSelfClosing: { scopes: [scope.selfClosingSlash], description: "Self-closing slash" },
  hsonArrayOpen: { scopes: [scope.arrayBegin], description: "Opening Hson array delimiter" },
  hsonArrayClose: { scopes: [scope.arrayEnd], description: "Closing Hson array delimiter" },
  hsonSequenceSeparator: { scopes: [scope.sequenceSeparator], description: "Hson sequence separator" },
  hsonAssignment: { scopes: [scope.assignment], description: "Attribute assignment operator" },
  hsonInterpolationSigil: { scopes: [scope.interpolationDollar], description: "Hson interpolation dollar sigil" },
  hsonInterpolationOpen: { scopes: [scope.interpolationBegin], description: "Opening reference/interpolation brace" },
  hsonInterpolationClose: { scopes: [scope.interpolationEnd], description: "Closing reference/interpolation brace" },
  hsonMember: { scopes: [scope.referenceMember], types: ["hsonReference"], description: "Dotted Part reference member" },
  hsonReferenceSeparator: { scopes: [scope.referenceSeparator], description: "Part reference member separator" },
  hsonSelectorOpen: { scopes: [scope.selectorBegin], description: "Opening Part selector bracket" },
  hsonSelectorClose: { scopes: [scope.selectorEnd], description: "Closing Part selector bracket" },
} satisfies Record<string, { scopes: readonly string[]; types?: readonly string[]; description: string }>;

export function hsonModifiersForScopes(scopes: readonly string[]): string[] {
  // Structural fallback sometimes encloses `/` in a tag-end scope. The leaf
  // punctuation, not that enclosing fallback, owns the modifier.
  const leaf = scopes.at(-1);
  return Object.entries(hsonTokenModifierDefinitions)
    .filter(([, definition]) => definition.scopes.some(scope => scope === leaf))
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
