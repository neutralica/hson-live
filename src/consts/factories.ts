// factories.ts


import { HsonNode } from "../types/node.types.js";
import {  ArraySymbol, CloseKind, RawAttr, Position, TokenOpen, TokenClose, TokenArrayOpen, TokenArrayClose, TokenText, TokenEmptyObj, TOKEN_KIND } from "../types/token.types.js";

/**
 * Construct a fresh `HsonNode` using a partial override.
 *
 * The tokenizer and parser never assemble node shapes inline;
 * all node creation routes through this factory so that:
 *
 *   • every node begins with `{_tag, _content, _attrs, _meta}`
 *   • missing fields default to stable empty values
 *   • structural expectations remain uniform across the pipeline
 *
 * Only structural fields are accepted here. Higher-level helpers
 * (e.g. for element nodes, object properties, array entries)
 * should wrap this factory rather than re-implementing shape logic.
 */
export const CREATE_NODE = (partial: Partial<HsonNode> = {}): HsonNode => ({
  _tag: partial._tag ?? '', 
  _content: partial._content ?? [],
  _attrs: partial._attrs ?? {},
  _meta:  partial._meta ?? {},
});

/**
 * Create an opening-tag token.
 *
 * Used exclusively by the tokenizer; never synthesized later.
 * The token preserves:
 *   • the raw tag name
 *   • the raw attribute list (already lexed, not interpreted)
 *   • the source position for diagnostics
 *
 * Downstream stages (parser → node builder) resolve actual
 * attributes and structural meaning.
 */
export const CREATE_OPEN_TOKEN = (tag: string, rawAttrs: RawAttr[], pos: Position): TokenOpen =>
  ({ kind: TOKEN_KIND.OPEN, tag, rawAttrs, pos });

/**
 * Create a closing-tag token.
 *
 * Encodes the logical close operation (`</tag>` or short-form
 * close depending on `CloseKind`). Carries only the source
 * position; the parser enforces structural correctness.
 */
export const CREATE_END_TOKEN = (close: CloseKind, pos: Position): TokenClose =>
  ({ kind: TOKEN_KIND.CLOSE, close, pos });

/**
 * Create an array-open token (`[` or `⟦` depending on variant).
 *
 * Array symbols are distinct in HSON (textual vs semantic forms).
 * This token preserves which symbol was used so the parser can
 * enforce round-trippable fidelity.
 */
export const CREATE_ARR_OPEN_TOKEN = (variant: ArraySymbol, pos: Position): TokenArrayOpen =>
  ({ kind: TOKEN_KIND.ARR_OPEN, symbol: variant, pos });

/**
 * Create an array-close token (`]` or `⟧` corresponding to the
 * matching open variant).
 *
 * Token carries only the symbol and source position; the parser
 * matches it against the open token to guarantee balanced array
 * segments and meaningful error messages.
 */
export const CREATE_ARR_CLOSE_TOKEN = (variant: ArraySymbol, pos: Position): TokenArrayClose =>
  ({ kind: TOKEN_KIND.ARR_CLOSE, symbol: variant, pos });

/**
 * Create a text token representing raw character data.
 *
 * `raw` is the literal substring from source.
 * `quoted` indicates whether the text originated inside explicit
 * quotes; this distinction affects primitive vs. string-literal
 * interpretation during node construction.
 *
 * No normalization occurs here—preserve exactly what appeared
 * in the input for later transforms to interpret.
 */
export const CREATE_TEXT_TOKEN = (raw: string, quoted: boolean | undefined, pos: Position): TokenText =>
  (quoted ? { kind: TOKEN_KIND.TEXT, raw, quoted: true, pos } : { kind: TOKEN_KIND.TEXT, raw, pos });

/**
 * Create a token representing an empty object literal `{}` in HSON.
 *
 * This is *not* the same as an object with no properties inside a
 * normal element/object context. Tokenizing `{}` distinctly allows:
 *   • precise round-tripping,
 *   • distinguishing empty-object syntax from missing structures,
 *   • preserving quoted vs. unquoted `{}` for downstream phases.
 */
export const CREATE_EMPTY_OBJ_TOKEN = (raw: string, quoted: boolean | undefined, pos: Position): TokenEmptyObj =>
  (quoted ? { kind: TOKEN_KIND.EMPTY_OBJ, raw, quoted: true, pos } : { kind: TOKEN_KIND.EMPTY_OBJ, raw, pos });


