import type { HsonNode, JsonValue } from "../../core/types.js";
import { parse_hson } from "./parsers/parse-hson.js";
import { parse_html_string } from "./parsers/parse-html-string.js";
import { parse_json } from "./parsers/parse-json.js";
import { construct_output_2 } from "./constructors/construct-output-2.js";
import type {
  HsonTransformSource,
  TransformFrame,
  TransformOutput,
} from "./transform.types.js";

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
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  const frame: TransformFrame = {
    input: raw,
    node: parse_json(raw),
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
    frame = {
      input,
      node: parse_hson(input),
      meta: frame_meta("hson-text", unsafe),
    };
    return frame;
  };

  const getOutput = (): TransformOutput => construct_output_2(getFrame());
  return {
    toNode: () => getFrame().node,
    toHson: () => getOutput().toHson(),
    toJson: () => getOutput().toJson(),
    toHtml: () => getOutput().toHtml(),
    sanitizeBEWARE: () => getOutput().sanitizeBEWARE(),
  };
}

export function transform_from_node(
  input: HsonNode,
  unsafe = true,
): TransformOutput {
  const frame: TransformFrame = {
    input: JSON.stringify(input),
    node: input,
    meta: frame_meta("node", unsafe),
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
