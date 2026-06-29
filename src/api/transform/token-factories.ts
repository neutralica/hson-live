import { TOKEN_KIND } from "./token.types.js";
import type { ArraySymbol, CloseKind, RawAttr, Position, TokenOpen, TokenClose, TokenArrayOpen, TokenArrayClose, TokenText, TokenEmptyObj } from "./token.types.js";

export const CREATE_OPEN_TOKEN = (tag: string, rawAttrs: RawAttr[], pos: Position): TokenOpen =>
  ({ kind: TOKEN_KIND.OPEN, tag, rawAttrs, pos });

export const CREATE_END_TOKEN = (close: CloseKind, pos: Position): TokenClose =>
  ({ kind: TOKEN_KIND.CLOSE, close, pos });

export const CREATE_ARR_OPEN_TOKEN = (variant: ArraySymbol, pos: Position): TokenArrayOpen =>
  ({ kind: TOKEN_KIND.ARR_OPEN, symbol: variant, pos });

export const CREATE_ARR_CLOSE_TOKEN = (variant: ArraySymbol, pos: Position): TokenArrayClose =>
  ({ kind: TOKEN_KIND.ARR_CLOSE, symbol: variant, pos });

export const CREATE_TEXT_TOKEN = (raw: string, quoted: boolean | undefined, pos: Position): TokenText =>
  (quoted ? { kind: TOKEN_KIND.TEXT, raw, quoted: true, pos } : { kind: TOKEN_KIND.TEXT, raw, pos });

export const CREATE_EMPTY_OBJ_TOKEN = (raw: string, quoted: boolean | undefined, pos: Position): TokenEmptyObj =>
  (quoted ? { kind: TOKEN_KIND.EMPTY_OBJ, raw, quoted: true, pos } : { kind: TOKEN_KIND.EMPTY_OBJ, raw, pos });
