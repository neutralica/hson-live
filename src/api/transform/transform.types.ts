import type { $RENDER } from "../../core/constants.js";
import type { HsonNode, JsonValue } from "../../core/types.js";

export interface BinaryDecodeOptions {
  readonly maxBytes?: number;
  readonly maxGraphDepth?: number;
  readonly maxGraphNodes?: number;
}

declare const HSON_STRING_BRAND: unique symbol;

/**
 * A primitive string produced by an official HSON serializer after successful
 * canonical graph validation and serialization.
 *
 * This TypeScript-only brand has no runtime marker and is not a trust or
 * security guarantee.
 */
export type HsonString = string & {
  readonly [HSON_STRING_BRAND]: true;
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
  serialize(): HsonString;
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
 * use the structural HSON/JSON/node transforms without invoking that method.
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
