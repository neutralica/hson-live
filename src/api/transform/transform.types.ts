import type { $RENDER } from "../../core/constants.js";
import type { HsonNode, JsonValue } from "../../core/types.js";

export interface BinaryDecodeOptions {
  readonly maxBytes?: number;
  readonly maxGraphDepth?: number;
  readonly maxGraphNodes?: number;
}

declare const HSON_CANONICAL_BRAND: unique symbol;
declare const HSON_DATA_BRAND: unique symbol;
declare const HSON_DOCUMENT_BRAND: unique symbol;
declare const HSON_SCHEMA_DATA_BRAND: unique symbol;
declare const HSON_SCHEMA_PROOF: unique symbol;

/**
 * A JavaScript string whose contents are valid canonical serialized Hson.
 * It may represent a detached primitive, object, element, or array value, or
 * nonempty ordered document content. Empty source is not canonical Hson;
 * an explicitly quoted empty string is a real string value.
 *
 * This TypeScript-only brand has no runtime marker and is not a trust or
 * security guarantee.
 */
export type HsonCanonical = string & {
  readonly [HSON_CANONICAL_BRAND]: true;
};

/** Static root domain established by the generated Hson Schema analyzer. */
export type HsonSchemaMode = "data" | "document";

export type HsonData<
  TSchema extends HsonSchema<unknown, "data"> = HsonSchema<unknown, "data">,
> = HsonCanonical & {
  readonly [HSON_DATA_BRAND]: true;
  readonly [HSON_SCHEMA_PROOF]: TSchema;
};

/** Serialized document content with at least one item; runtime ROOT[] is graph-only. */
export type HsonDocument<
  TSchema extends HsonSchema<unknown, "document"> = HsonSchema<unknown, "document">,
> = HsonCanonical & {
  readonly [HSON_DOCUMENT_BRAND]: true;
  readonly [HSON_SCHEMA_PROOF]: TSchema;
};

/** Portable canonical data that itself defines a valid Hson Schema. */
export type HsonSchemaData = HsonData & {
  readonly [HSON_SCHEMA_DATA_BRAND]: true;
};

export type { HsonSchema } from "../schema/hson-schema.js";
import type { HsonSchema } from "../schema/hson-schema.js";

/** Canonical Hson proof representation selected by the Schema family. */
export type HsonFromSchema<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<unknown, "data"> ? HsonData<TSchema>
    : TSchema extends HsonSchema<unknown, "document"> ? HsonDocument<TSchema>
      : HsonData | HsonDocument;

/** Readonly structural JS/JSON projection; Schema refinements remain runtime constraints. */
export type JsonFromSchema<TSchema extends HsonSchema<unknown, "data">> =
  TSchema extends HsonSchema<infer TValue, "data"> ? TValue : never;

export type TransformRenderFormat = (typeof $RENDER)[keyof typeof $RENDER];
export type TransformOutputRenderFormat =
  | (typeof $RENDER)["JSON"]
  | (typeof $RENDER)["HTML"];

export interface TransformFrameOptions {
  noBreak?: boolean;
}

export interface TransformFrame {
  input: string;
  node: HsonNode;
  html?: string;
  json?: JsonValue;
  meta?: Record<string, unknown>;
  options?: TransformFrameOptions;
}

export interface TransformFrameRender<K extends TransformRenderFormat> {
  frame: TransformFrame;
  output: K;
}

export interface TransformSerialize {
  serialize(): string;
  sha256(): Promise<string>;
}

export interface TransformBinarySerialize {
  serialize(): Uint8Array;
  sha256(): Promise<string>;
}

export interface TransformHsonSerialize extends TransformSerialize {
  serialize(): HsonCanonical;
}

export interface TransformJsonValue extends TransformSerialize {
  value(): JsonValue;
}

export interface TransformOutputOptions<K extends TransformOutputRenderFormat> {
  withOptions(
    options: Pick<TransformFrameOptions, "noBreak">,
  ): TransformOutputOptions<K> & TransformRender<K>;
  noBreak(): TransformOutputOptions<K> & TransformRender<K>;
}

export interface TransformHsonOptions {
  withOptions(options: TransformFrameOptions): TransformHsonOptions & TransformHsonSerialize;
  noBreak(): TransformHsonOptions & TransformHsonSerialize;
}

export type TransformRender<K extends TransformOutputRenderFormat> =
  K extends (typeof $RENDER)["JSON"] ? TransformJsonValue : TransformSerialize;

/** Universal transform pipeline. Its declarations contain no browser globals. */
export interface TransformOutput {
  toNode(): HsonNode;
  toBinary(): TransformBinarySerialize;
  toJson(): TransformOutputOptions<(typeof $RENDER)["JSON"]> & TransformJsonValue;
  toHson(): TransformHsonOptions & TransformHsonSerialize;
  toHtml(): TransformOutputOptions<(typeof $RENDER)["HTML"]> & TransformSerialize;
}

export interface HsonTransformSource extends TransformOutput {}
