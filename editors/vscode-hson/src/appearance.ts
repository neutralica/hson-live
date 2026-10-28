/**
 * Hson appearance starts with grammar scopes. The adapter classifies those
 * scopes as semantic tokens, and House roles assign their colors in the
 * generated Light and Dark themes. Standalone Hson uses the same grammar
 * scopes and House roles directly through TextMate theme rules.
 *
 * Identity decorations (`owned`) have separate branding settings; native VS
 * Code bracket coloring handles nesting using the theme's bracket colors.
 * For palette changes, edit `house` below and regenerate the themes. Theme
 * files and manifest contributions are generated, and `hsonTokenScopes` is
 * derived from the definitions below: do not synchronize them by hand.
 */

/* RUN WITH:

npm --prefix editors/vscode-hson run themes:generate

*/

export const HSON_APPEARANCE = {
  // Extension-owned hson/Hson identity decorations and their color settings;
  // these are branding accents, not ordinary House syntax colors.
  owned: {
    colors: {
      blue: "#00adf6",
      yellow: "#c9d100",
      pink: "#ff4a8c",
      green: "#39a500",
    },
    strength: {
      strong: 1,
      soft: 0.7,
    },
    colorLibraryMarker: true,
    identityMarkers: [
      { publicName: "hson", letter: "h", colorId: "hson.libraryMarker.h", colorSetting: "blue", strength: "strong" },
      { publicName: "hson", letter: "s", colorId: "hson.libraryMarker.s", colorSetting: "yellow", strength: "strong" },
      { publicName: "hson", letter: "o", colorId: "hson.libraryMarker.o", colorSetting: "pink", strength: "strong" },
      { publicName: "hson", letter: "n", colorId: "hson.libraryMarker.n", colorSetting: "green", strength: "strong" },
      { publicName: "Hson", letter: "H", colorId: "hson.authoringMarker.h", colorSetting: "blue", strength: "soft" },
      { publicName: "Hson", letter: "s", colorId: "hson.authoringMarker.s", colorSetting: "yellow", strength: "soft" },
      { publicName: "Hson", letter: "o", colorId: "hson.authoringMarker.o", colorSetting: "pink", strength: "soft" },
      { publicName: "Hson", letter: "n", colorId: "hson.authoringMarker.n", colorSetting: "green", strength: "soft" },
    ],
    librarySeparator: {
      colorId: "hson.libraryMarker.separator",
      colorSetting: "librarySeparatorColor",
      color: "#7247d4",
      strength: "strong",
    },
  },
  // TextMate scope-name vocabulary used by the grammar and token definitions.
  // These names describe syntax; palette tuning normally does not change them.
  themeDerived: {
    structuralName: "entity.name.type.hson",
    authoredName: "entity.name.type.quoted.hson",
    directive: "keyword.other.directive.hson",
    receiving: "entity.other.attribute-name.receiving.hson",
    sending: "entity.other.attribute-name.sending.hson",
    iteration: "keyword.control.iteration.hson",
    colon: "punctuation.separator.attribute.hson",
    attributeName: "entity.other.attribute-name.hson",
    flag: "constant.language.flag.hson",
    partDeclaration: "keyword.declaration.part.hson",
    quotedString: "string.quoted.double.hson",
    unquotedAttributeValue: "string.unquoted.attribute-value.hson",
    quoteBegin: "punctuation.definition.string.begin.hson",
    quoteEnd: "punctuation.definition.string.end.hson",
    number: "constant.numeric.hson",
    boolean: "constant.language.boolean.hson",
    null: "constant.language.null.hson",
    identityFallback: "variable.other.constant.hson",
    colonFallback: "keyword.operator.hson",
    quid: "constant.other.quid.hson",
    quad: "constant.other.quad.hson",
    identityValue: "constant.other.identity.hson",
    identitySigil: "punctuation.definition.identity.hson",
    identitySeparator: "punctuation.separator.identity.hson",
    comment: "comment.line.double-slash.hson",
    commentDelimiter: "punctuation.definition.comment.hson",
    tagBegin: "punctuation.definition.tag.begin.hson",
    tagEnd: "punctuation.definition.tag.end.hson",
    selfClosingSlash: "punctuation.definition.tag.self-closing.hson",
    arrayBegin: "punctuation.section.array.begin.hson",
    arrayEnd: "punctuation.section.array.end.hson",
    sequenceSeparator: "punctuation.separator.sequence.hson",
    assignment: "keyword.operator.assignment.hson",
    interpolationDollar: "keyword.operator.interpolation.dollar.hson",
    interpolationPercent: "keyword.operator.interpolation.percent.hson",
    interpolationCaret: "keyword.operator.interpolation.caret.hson",
    interpolationBegin: "punctuation.definition.template-expression.begin.hson",
    interpolationEnd: "punctuation.definition.template-expression.end.hson",
    referencePath: "variable.other.property.hson",
    attributeQualifier: "meta.attribute.qualifier.hson",
    attributeLocalName: "meta.attribute.local-name.hson",
    referenceMember: "meta.reference.member.hson",
    referenceSeparator: "punctuation.accessor.hson",
    selectorBegin: "punctuation.section.selector.begin.hson",
    selectorEnd: "punctuation.section.selector.end.hson",
    escape: "constant.character.escape.hson",
    invalid: "invalid.illegal.hson",
  },
  // OWNER-EDITABLE HOUSE PALETTE
  // Adjust ui (workbench colors), roles (syntax colors), intensity, and
  // intensityOverrides (per-theme exceptions), then run from the repo root:
  //   npm --prefix editors/vscode-hson run themes:generate
  // An intensity of 1.0 uses the full role color; lower values blend it toward
  // that theme's background. Changing the background therefore also changes
  // generated punctuation and local-reference colors with reduced intensity.
  house: {
    intensity: { assignment: 0.75, colon: 0.75, quote: 0.60, localReference: 0.75 },
    intensityOverrides: { dark: {}, light: {} },
    ui: {
      background: { dark: "#0f141a", light: "#FAF9F6" },
      foreground: { dark: "#D8DEE8", light: "#28313D" },
      surface: { dark: "#1B222C", light: "#F0EFEB" },
      border: { dark: "#34404E", light: "#D2D6DB" },
      selection: { dark: "#30485E", light: "#D8E5EF" },
      accent: { dark: "#8CC7D9", light: "#245C70" },
    },
    roles: {
      // Element names, e.g. `section` in `<section .../>`.
      element: { dark: "#c6caca", light: "#245C70" },
      // Ordinary attribute names, e.g. `class` in `class="deck"`.
      attribute: { dark: "#84a9d6", light: "#465467" },
      // Muted namespace/kind segments, e.g. `data` in both `blocks:data` and
      // `data:block`, plus `for` in `for:item`. Receiving binding names before
      // `:` keep their active receiving color; other local names keep their
      // parent role. The colon retains its separate color and intensity.
      // House themes use `*.hsonQualifier` with receiving-specific overrides.
      qualifier: { dark: "#8792A0", light: "#687482" },
      // Ordinary bare flags, e.g. `disabled`.
      flag: { dark: "#6d9dd8", light: "#566377" },
      // Part directive local names, e.g. `part` and `optional`.
      directive: { dark: "#9989b6", light: "#6F4F8F" },
      // Receiving binding names, e.g. `slide` in `slide:data`.
      receiving: { dark: "#86b7c6", light: "#236A67" },
      // Sending local names, e.g. `slide` in `data:slide`.
      sending: { dark: "#b685af", light: "#405F83" },
      // Iteration local names, e.g. `row` in `for:row` and `item` in `per:item`.
      iteration: { dark: "#ac9f88", light: "#7A602B" },
      // QUAD/QUID names and `@` markers, e.g. `@:deck` (colon separate).
      quad: { dark: "#C4ADE2", light: "#70518F" },
      // Incoming reference sigil `%` in `%{slide}`.
      incomingReference: { dark: "#9b9a85", light: "#7a6d2b" },
      // Local reference sigil `^` in `^{slide.title}`.
      localReference: { dark: "#eee7d8", light: "#3D434B" },
      // Reference contents, e.g. `slide.title`, excluding sigils and braces.
      referencePath: { dark: "#d99db5", light: "#28313D" },
      // Quoted or unquoted string contents, e.g. `deck` in `class="deck"`.
      text: { dark: "#abb0b0", light: "#435B35" },
      // Numbers, e.g. `42` or `-1.5`.
      number: { dark: "#D8B78F", light: "#76552E" },
      // Boolean and null values: `true`, `false`, and `null`.
      primitive: { dark: "#B8B5DD", light: "#5B5486" },
      // Line comments and their `//` marker.
      comment: { dark: "#939DAA", light: "#606B78" },
      // Structural delimiters, e.g. `<`, `/>`, `[`, `»`, `{`, and `}`.
      structure: { dark: "#7f718b", light: "#5B6573" },
      // Assignment `=` and the Hson interpolation `$` sigil.
      assignment: { dark: "#baa9c1", light: "#344154" },
      // Separators in names and identities, e.g. `slide:data` and `@:deck`.
      colon: { dark: "#7495bd", light: "#354967" },
      // String and quoted-name delimiters, e.g. the `"` around `"deck"`.
      quote: { dark: "#BDD0AB", light: "#101820" },
      // Valid string escapes, e.g. `\n`.
      escape: { dark: "#D4BA86", light: "#7A602B" },
      // Invalid syntax, e.g. an illegal string escape.
      invalid: { dark: "#F08B94", light: "#A52A3A" },
    },
    // House roles used for successive VS Code bracket-nesting colors.
    bracketRoles: ["structure", "receiving", "directive"],
  },
  native: {
    // VS Code owns nesting colors. Hson only declares the structural pairs.
    colorizedBracketPairs: [["[", "]"], ["«", "»"], ["<", ">"]],
  },
} as const;

export type AppearanceColorKey = keyof typeof HSON_APPEARANCE.owned.colors;

export const hsonIdentityMarkers = HSON_APPEARANCE.owned.identityMarkers;
export const HSON_LIBRARY_SEPARATOR_COLOR_ID = HSON_APPEARANCE.owned.librarySeparator.colorId;

const scope = HSON_APPEARANCE.themeDerived;

/** Maps grammar scopes to semantic-token classifications and House roles,
 * with TextMate fallbacks for other themes. This is syntax plumbing, so palette
 * tuning normally changes `house.roles` instead. The adapter favors specific
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
  role: keyof typeof HSON_APPEARANCE.house.roles; superType?: string; scopes: readonly string[]; fallbackScopes?: readonly string[];
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
