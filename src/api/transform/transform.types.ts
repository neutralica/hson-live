import type { $RENDER } from "../../core/constants.js";
import type { HsonNode, JsonValue } from "../../core/types.js";

export interface BinaryDecodeOptions {
  readonly maxBytes?: number;
  readonly maxGraphDepth?: number;
  readonly maxGraphNodes?: number;
}

declare const HSON_CANONICAL_BRAND: unique symbol;

/**
 * A JavaScript string whose contents are valid canonical serialized Hson.
 * It may represent any valid detached canonical Hson value, including a
 * primitive, object, element, array, or ordered document content.
 *
 * This TypeScript-only brand has no runtime marker and is not a trust or
 * security guarantee.
 */
export type HsonCanonical = string & {
  readonly [HSON_CANONICAL_BRAND]: true;
};

declare const HSON_SCHEMA_SOURCE_DESIGNATION: unique symbol;
declare const HSON_SCHEMA_VALUE_ASSOCIATION: unique symbol;
declare const HSON_SCHEMA_MUTATION_CANDIDATE: unique symbol;

/** Static root domain established by the generated Hson Schema analyzer. */
export type HsonSchemaMode = "data" | "document";

/**
 * Declaration-only candidate association emitted beside generated Schema proof
 * carriers. It is consumed by LiveMap write signatures; callers neither create
 * nor observe it at runtime.
 *
 * This supports generated Hson Schema declarations only.
 */
export type HsonSchemaMutationCandidate<TValue> = Readonly<{
  readonly [HSON_SCHEMA_MUTATION_CANDIDATE]: TValue;
}>;

/**
 * Canonical Hson source designated for authoritative Hson Schema checking.
 * The optional marker deliberately does not certify the source at runtime;
 * certification is established by the supported Schema analyzer/build.
 */
export type HsonSchema<
  TValue = unknown,
  TMode extends HsonSchemaMode = HsonSchemaMode,
> = HsonCanonical & {
  readonly [HSON_SCHEMA_SOURCE_DESIGNATION]?: never;
  /**
   * Declaration-only association installed by the Hson Schema generator.
   * It has no runtime representation and never certifies untrusted input.
   */
  readonly [HSON_SCHEMA_VALUE_ASSOCIATION]?: Readonly<{
    value: TValue;
    mode: TMode;
  }>;
};

export type TransformRenderFormat = (typeof $RENDER)[keyof typeof $RENDER];
export type TransformOutputRenderFormat =
  | (typeof $RENDER)["JSON"]
  | (typeof $RENDER)["HTML"];

export interface TransformFrameOptions {
  noBreak?: boolean;
  noQuid?: boolean;
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
  noQuid(): TransformHsonOptions & TransformHsonSerialize;
}

export type TransformRender<K extends TransformOutputRenderFormat> =
  K extends (typeof $RENDER)["JSON"] ? TransformJsonValue : TransformSerialize;

/**
 * Universal transform pipeline. Its declarations contain no browser globals.
 *
 * `sanitizeBEWARE()` remains available for compatibility. The browser umbrella
 * facade installs its HTML sanitizer; a narrow subsystem-only consumer should
 * use the structural Hson/JSON/node transforms without invoking that method.
 */
export interface TransformOutput {
  toNode(): HsonNode;
  toBinary(): TransformBinarySerialize;
  toJson(): TransformOutputOptions<(typeof $RENDER)["JSON"]> & TransformJsonValue;
  toHson(): TransformHsonOptions & TransformHsonSerialize;
  toHtml(): TransformOutputOptions<(typeof $RENDER)["HTML"]> & TransformSerialize;
  sanitizeBEWARE(): TransformOutput;
}

/** DOM-free transform output constructor retained under the established name. */
export type OutputConstructor_2 = TransformOutput;

export interface HsonTransformSource extends TransformOutput {}
