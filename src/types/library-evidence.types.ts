import type { JsonValue, HsonNode } from "../core/types.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import type { DataSchemaValue, DocumentSchemaGraph } from "../internal/hson-schema/schema-evidence.types.js";
import type { LiveMapPartCollection, LiveMapLibraryDefinition } from "./livemap.types.js";

/** Possible literal names and certain membership are separate inventory facts. */
export type LibraryLiteralDefinitions<T> = {
  readonly [K in keyof T as string extends K ? never : K]: T[K];
};
export type LibraryCertainNames<T> = Extract<{
  [K in keyof T]-?: {} extends Pick<T, K> ? never : undefined extends T[K] ? never : K;
}[keyof T], string>;

type IsUnion<T, Whole = T> = T extends unknown ? [Whole] extends [T] ? false : true : never;
type CertainTupleNames<T> = [T] extends [readonly [infer Entry extends { name: string }, ...infer Rest]]
  ? (string extends Entry["name"] ? never : true extends IsUnion<Entry["name"]> ? never : Entry["name"])
    | CertainTupleNames<Rest>
  : never;
type GroupEntries<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly (infer Entry)[] ? Extract<Entry, { name: string; definition: LiveMapLibraryDefinition }> : never;
}[keyof T];
type CertainGroupNames<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : CertainTupleNames<T[K]>;
}[keyof T];
type EntryDefinitions<T> = {
  readonly [Entry in GroupEntries<T> as Entry["name"]]: Entry["definition"];
};

/** Internal named-entry catalogs retain conservative tuple membership evidence.
 * Required suffixes after variadic or optional entries remain a tracked inference limitation.
 * Flat public construction uses LibraryLiteralDefinitions instead. */
export type LibraryGroupDefinitions<T> = {
  readonly [K in keyof EntryDefinitions<T> as K extends CertainGroupNames<T> ? K : never]: Extract<EntryDefinitions<T>[K], LiveMapLibraryDefinition>;
} & {
  readonly [K in keyof EntryDefinitions<T> as K extends CertainGroupNames<T> ? never : K]?: Extract<EntryDefinitions<T>[K], LiveMapLibraryDefinition>;
};

/** Only the root category is stable without a Schema; initial members are not evidence. */
type DataRoot<T> = T extends readonly unknown[] ? readonly JsonValue[]
  : T extends object ? Readonly<Record<string, JsonValue>> : JsonValue;
type DefinitionSchema<T, F extends "data" | "document"> = T extends { schema: infer S extends HsonSchema } ? S
  : "schema" extends keyof T ? HsonSchema<unknown, F>
    : F extends "data" ? typeof import("../api/schema/hson-schema.js").ANY_DATA
      : typeof import("../api/schema/hson-schema.js").ANY_DOCUMENT;

/** Family, governing Schema identity and governed value are derived once, independently of membership. */
export type LibraryDefinitionEvidence<T> = T extends { parts: unknown }
  ? { family: "parts"; value: LiveMapPartCollection; schema: typeof import("../api/schema/hson-schema.js").ANY_DATA }
  : T extends { data: infer Initial }
    ? { family: "data"; value: T extends { schema: infer S extends HsonSchema } ? DataSchemaValue<S> : DataRoot<Initial>; schema: DefinitionSchema<T, "data"> }
    : T extends { document: unknown }
      ? { family: "document"; value: T extends { schema: infer S extends HsonSchema } ? DocumentSchemaGraph<S> : HsonNode; schema: DefinitionSchema<T, "document"> }
      : never;

/** A transient shape check cannot remove future absence or another permitted shape. */
export type LibraryRefinedValue<T, Branch> = Branch | ([T] extends [Branch] ? never : undefined);
