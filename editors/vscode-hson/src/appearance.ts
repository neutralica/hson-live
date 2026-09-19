/**
 * Single authority for Hson appearance.
 *
 * `owned` values are applied by extension decorations and mirrored in the
 * manifest so users can customize them. `themeDerived` values are TextMate
 * scopes only: Hson assigns their meaning, while the active VS Code theme (or
 * native bracket-pair colorization) chooses their rendered color.
 */
export const HSON_APPEARANCE = {
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
    documentSelfClosingSlash: {
      color: "#7247d4",
      strength: "soft",
    },
  },
  themeDerived: {
    structuralName: "entity.name.type.hson",
    authoredName: "entity.name.type.quoted.hson",
    attributeName: "entity.other.attribute-name.hson",
    quotedString: "string.quoted.double.hson",
    unquotedAttributeValue: "string.unquoted.attribute-value.hson",
    quoteBegin: "punctuation.definition.string.begin.hson",
    quoteEnd: "punctuation.definition.string.end.hson",
    number: "constant.numeric.hson",
    boolean: "constant.language.boolean.hson",
    null: "constant.language.null.hson",
    quid: "constant.other.quid.hson",
    comment: "comment.line.double-slash.hson",
    commentDelimiter: "punctuation.definition.comment.hson",
    tagBegin: "punctuation.definition.tag.begin.hson",
    tagEnd: "punctuation.definition.tag.end.hson",
    selfClosingSlash: "punctuation.definition.tag.self-closing.hson",
    arrayBegin: "punctuation.section.array.begin.hson",
    arrayEnd: "punctuation.section.array.end.hson",
    sequenceSeparator: "punctuation.separator.sequence.hson",
    assignment: "keyword.operator.assignment.hson",
    escape: "constant.character.escape.hson",
    invalid: "invalid.illegal.hson",
  },
  native: {
    // VS Code owns nesting colors. Hson only declares the structural pairs.
    colorizedBracketPairs: [["[", "]"], ["«", "»"], ["<", ">"]],
  },
} as const;

export type AppearanceColorKey = keyof typeof HSON_APPEARANCE.owned.colors;

export const hsonIdentityMarkers = HSON_APPEARANCE.owned.identityMarkers;
export const HSON_LIBRARY_SEPARATOR_COLOR_ID = HSON_APPEARANCE.owned.librarySeparator.colorId;
export const HSON_DOCUMENT_SELF_CLOSING_SLASH = HSON_APPEARANCE.owned.documentSelfClosingSlash;

const scope = HSON_APPEARANCE.themeDerived;

/** Semantic-token fallbacks for Hson inside TypeScript tagged templates. */
export const hsonTokenScopes = {
  hsonType: [scope.structuralName, scope.authoredName],
  hsonProperty: [scope.attributeName],
  hsonString: [scope.quotedString, scope.unquotedAttributeValue],
  hsonNumber: [scope.number],
  hsonKeyword: [scope.boolean, scope.null],
  hsonQuid: [scope.quid],
  hsonComment: [scope.comment],
  hsonDelimiter: [scope.tagBegin, scope.tagEnd, scope.selfClosingSlash,
    scope.arrayBegin, scope.arrayEnd, scope.sequenceSeparator,
    scope.commentDelimiter, scope.quoteBegin, scope.quoteEnd],
  hsonOperator: [scope.assignment],
  hsonEscape: [scope.escape],
  hsonInvalid: [scope.invalid],
} as const;
