import type { PARTS_FACADE_RESERVED } from "../internal/parts-facade.js";
import type { LibraryCertainNames, LibraryLiteralDefinitions } from "./library-evidence.types.js";

type Members<D> = D extends { parts: infer P } ? LibraryLiteralDefinitions<P> : {};
type Reserved = typeof PARTS_FACADE_RESERVED[number] | keyof Object;

/** Names are construction evidence; retained coordinate reads still permit absence. */
export type PartsLibrary<D, H, L> = H & {
  readonly [K in Exclude<LibraryCertainNames<Members<D>>, Reserved | keyof H>]: L;
} & {
  readonly [K in Exclude<Extract<keyof Members<D>, string>, LibraryCertainNames<Members<D>> | Reserved | keyof H>]?: L;
};
