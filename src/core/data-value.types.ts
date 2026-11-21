import type { Primitive } from "./types.js";

/** Ordinary Data candidates are checked at admission. Nested carriers are excluded. */
export type DataValueInput = Primitive | readonly DataValueInput[] | DataObjectInput;
export type DataObjectInput = { readonly [name: string]: DataValueInput };

/** An ordinary object's extra and inherited properties have no JSON read guarantee. */
export type DataObjectRead = { readonly [name: string]: unknown }
  & { readonly [K in keyof Object]?: unknown };

/** Broad materialized Data, including the JavaScript behavior of objects reached through arrays. */
export type DataValueRead = Primitive | DataValueRead[] | DataObjectRead;
