import type { HsonNode, JsonValue } from "../../core/types.js";
import { parse_hson } from "./parsers/parse-hson.js";
import { parse_html_string } from "./parsers/parse-html-string.js";
import { parse_json } from "./parsers/parse-json.js";
import { construct_output_2 } from "./constructors/construct-output-2.js";
import type {
  BinaryDecodeOptions,
  HsonTransformSource,
  TransformFrame,
  TransformOutput,
} from "./transform.types.js";
import { admit_exact_portable_node } from "./node-exact.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { parse_binary } from "./binary/binary-codec.js";
import { _throw_transform_err } from "./utils/sys-utils/throw-transform-err.utils.js";
import { is_transform_error } from "../../core/errors.js";

function frame_meta(origin: string, unsafe: boolean): Record<string, unknown> {
  return {
    origin,
    unsafePipeline: unsafe,
    sanitized: false,
  };
}

export function transform_from_json(
  input: string | JsonValue,
  unsafe = true,
): TransformOutput {
  const node = parse_json(input);
  const raw = typeof input === "string" ? input : "[JSON value]";
  const frame: TransformFrame = {
    input: raw,
    node,
    meta: frame_meta("json", unsafe),
  };
  return construct_output_2(frame);
}

export function transform_from_hson(
  input: string,
  unsafe = true,
): HsonTransformSource {
  let frame: TransformFrame | undefined;

  const getFrame = (): TransformFrame => {
    if (frame) return frame;
    const parserRoot = parse_hson(input);
    frame = {
      input,
      node: detach_hson_root_value(parserRoot),
      meta: frame_meta("hson-text", unsafe),
    };
    return frame;
  };

  const getOutput = (): TransformOutput => construct_output_2(getFrame());
  return {
    toNode: () => getOutput().toNode(),
    toBinary: () => getOutput().toBinary(),
    toHson: () => getOutput().toHson(),
    toJson: () => getOutput().toJson(),
    toHtml: () => getOutput().toHtml(),
  };
}

export function transform_from_binary(
  input: Uint8Array,
  options: BinaryDecodeOptions = {},
  unsafe = true,
): TransformOutput {
  let node: HsonNode;
  try { node = parse_binary(input, options); }
  catch (cause) {
    if (is_transform_error(cause)) throw cause;
    _throw_transform_err(cause instanceof Error ? cause.message : "Binary decode failed", "fromBinary", undefined, cause,
      { code: "HSON_BINARY_WIRE_INVALID", stage: "source-decoding", path: "$" });
  }
  const frame: TransformFrame = {
    input: "[Binary Hson]",
    node,
    meta: frame_meta("binary", unsafe),
  };
  return construct_output_2(frame);
}

export function transform_from_node(
  input: HsonNode,
  unsafe = true,
): TransformOutput {
  const node = admit_exact_portable_node(input, "fromNode");
  const frame: TransformFrame = {
    input: "[HsonNode]",
    node,
    meta: {
      ...frame_meta("node", unsafe),
    },
  };
  return construct_output_2(frame);
}

export function transform_from_trusted_html(
  input: string,
): TransformOutput {
  const frame: TransformFrame = {
    input,
    node: parse_html_string(input, false),
    meta: {
      ...frame_meta("html", true),
      rawInput: input,
    },
  };
  return construct_output_2(frame);
}

export function transform_from_untrusted_html(
  input: string,
): TransformOutput {
  const frame: TransformFrame = {
    input,
    node: parse_html_string(input, true),
    meta: {
      origin: "html",
      unsafePipeline: false,
      sanitized: true,
      rawInput: input,
    },
  };
  return construct_output_2(frame);
}
