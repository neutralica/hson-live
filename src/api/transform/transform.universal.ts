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
import { scan_ingested_hson_node_quids } from "./utils/hson-utils/quid-ingress.js";
import { normalize_detached_hson_semantic_value } from "../../core/normalize-hson-semantic-value.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { parse_binary } from "./binary/binary-codec.js";

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
  const raw = typeof input === "string" ? input : JSON.stringify(input);
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
    toNode: () => getFrame().node,
    toBinary: () => getOutput().toBinary(),
    toHson: () => getOutput().toHson(),
    toJson: () => getOutput().toJson(),
    toHtml: () => getOutput().toHtml(),
    sanitizeBEWARE: () => getOutput().sanitizeBEWARE(),
  };
}

export function transform_from_binary(
  input: Uint8Array,
  options: BinaryDecodeOptions = {},
  unsafe = true,
): TransformOutput {
  const node = parse_binary(input, options);
  scan_ingested_hson_node_quids(node, "fromBinary");
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
  const node = normalize_detached_hson_semantic_value(input, "fromNode");
  scan_ingested_hson_node_quids(node, "fromNode");
  assert_invariants(node, "fromNode");
  const frame: TransformFrame = {
    input: JSON.stringify(node),
    node,
    meta: {
      ...frame_meta("node", unsafe),
      // Binary validates and emits this exact source graph. Other projections
      // retain the established permissive fromNode normalization above.
      binaryNode: input,
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
