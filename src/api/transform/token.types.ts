// tokens.types.ts

/*******
 * Source position marker produced by the tokenizer.
 *
 * Positions are lightweight and monotonic, intended for:
 * - error reporting,
 * - diagnostics,
 * - future range reconstruction.
 *
 * `index` is the absolute character offset; `line` and `col`
 * are human-facing coordinates.
 *******/
export type Position = { line: number; col: number; index: number };

/*******
 * Raw attribute token as captured by the tokenizer.
 *
 * Represents an attribute exactly as written in source:
 * - `name` is the attribute identifier.
 * - `value`, when present, preserves the original text and
 *   whether it was quoted.
 * - `start` / `end` record the full source span.
 *
 * No semantic normalization occurs at this stage.
 *******/
export type RawAttr = {
  name: string;
  value?: { text: string; quoted: boolean };
  start: Position;
  end: Position;
};

/*******
 * Common structural fields shared by all token variants.
 *
 * Acts as a conceptual base for the tokenizer output, though
 * concrete token types are expressed as tagged unions.
 *
 * Optional fields appear only where meaningful for a given
 * `kind`.
 *******/
export interface BaseToken {
  /** Discriminator */
  kind: TokenKind;
  /** Tag name or JSON key */
  tag?: string;
  /** Parsed key→value attributes */
  rawAttrs?: RawAttr[];
  quoted?: boolean;
  pos?: Position;
}

/*******
 * Discriminant union for all tokenizer output kinds.
 *
 * These values drive the parser state machine and determine
 * which concrete token shape is expected.
 *******/
export type TokenKind =
  | 'OPEN' | 'CLOSE'
  | 'ARR_OPEN' | 'ARR_CLOSE'
  | 'TEXT' | 'EMPTY_OBJ';

/*******
 * Semantic close target for a CLOSE token.
 *
 * Distinguishes whether the close corresponds to:
 * - an object boundary (`obj`), or
 * - an element boundary (`elem`).
 *******/
export type CloseKind = 'obj' | 'elem';

/*******
 * Array delimiter variant used in the source syntax.
 *
 * Preserved at the token level so the parser can distinguish
 * stylistic forms without re-parsing raw text.
 * 
 * guillemet are idiomatic; brackets are accepted but re-serialized as guillemet
 *******/
export type ArraySymbol = 'guillemet' | 'bracket';

/*******
 * Opening tag or object-key token.
 *
 * Emitted for element opens and object property entries.
 * Carries fully tokenized raw attributes but no semantic
 * interpretation beyond structure.
 *******/
export type TokenOpen = {
  kind: typeof TOKEN_KIND.OPEN; 
  tag: string;
  rawAttrs: RawAttr[];
  pos: Position;
};

/*******
 * Closing token for objects or elements.
 *
 * Uses `close` instead of a raw tag name to encode intent,
 * allowing the parser to validate structure independently
 * of textual symmetry.
 *******/
export type TokenClose = {
  kind: typeof TOKEN_KIND.CLOSE;  /* was: 'TAG_END' */
  close: CloseKind;               /* was: 'obj' | 'elem' */
  pos: Position;
};

/*******
 * Opening token for an array construct.
 *
 * The `symbol` records which delimiter style was used so
 * round-tripping and diagnostics can remain faithful to
 * the original source.
 *******/
export type TokenArrayOpen = {
  kind: typeof TOKEN_KIND.ARR_OPEN;
  symbol: ArraySymbol;          /* was: 'guillemet' | 'bracket' */
  pos: Position;
};

/*******
 * Closing token for an array construct.
 *
 * Must match the corresponding `TokenArrayOpen` symbol
 * during parse validation.
 *******/
export type TokenArrayClose = {
  kind: typeof TOKEN_KIND.ARR_CLOSE;
  symbol: ArraySymbol;
  pos: Position;
};

/*******
 * Raw text token.
 *
 * Represents either quoted or unquoted textual content.
 * Quoting information is preserved so later stages can
 * distinguish literals from structural text.
 *******/
export type TokenText = {
  kind: typeof TOKEN_KIND.TEXT;
  raw: string;
  quoted?: boolean;
  pos: Position;
};

/*******
 * Empty object literal token.
 *
 * Captures syntactic empty-object forms as a single token
 * to simplify downstream parsing and invariant checks.
 *******/
export type TokenEmptyObj = {
  kind: typeof TOKEN_KIND.EMPTY_OBJ;
  raw: string;
  quoted?: boolean;
  pos: Position;
};

/*******
 * Union of all concrete tokenizer output types.
 *
 * This is the sole output surface of the tokenizer and the
 * exclusive input surface for the parser.
 *******/
export type Tokens =
  | TokenOpen | TokenClose
  | TokenArrayOpen | TokenArrayClose
  | TokenText | TokenEmptyObj;

/*******
 * Canonical token kind constants.
 *
 * Centralized here to ensure discriminator consistency
 * across tokenizer, parser, and tests.
 *******/
export const TOKEN_KIND = {
  OPEN: 'OPEN',
  CLOSE: 'CLOSE',
  ARR_OPEN: 'ARR_OPEN',
  ARR_CLOSE: 'ARR_CLOSE',
  TEXT: 'TEXT',
  EMPTY_OBJ: 'EMPTY_OBJ',
} as const;

/*******
 * Canonical array symbol constants.
 *
 * Provides a single authoritative mapping for supported
 * array delimiter styles.
 *******/
export const ARR_SYMBOL = {
  guillemet: 'guillemet',
  bracket: 'bracket',
} satisfies Record<ArraySymbol, ArraySymbol>;

/*******
 * Canonical close-kind constants.
 *
 * Used to normalize CLOSE tokens and avoid stringly-typed
 * comparisons in parser logic.
 *******/
export const CLOSE_KIND = {
  obj: 'obj',
  elem: 'elem',
} satisfies Record<CloseKind, CloseKind>;
