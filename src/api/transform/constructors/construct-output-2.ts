// construct-output-2.ts

import { $RENDER } from "../../../core/constants.js";
import { serialize_html } from "../serializers/serialize-html.js";
import { json_value_from_node } from "../serializers/serialize-json.js";
import { construct_hson_options_3, construct_html_options_3, construct_json_options_3 } from "./construct-options-3.js";
import type {
  TransformFrame,
  TransformFrameRender,
  TransformOutput,
} from "../transform.types.js";
import { serialize_binary } from "../binary/binary-codec.js";
import { sha256_bytes } from "../sha256.js";
import { ROOT_TAG } from "../../../core/constants.js";
import { detach_hson_root_value } from "../utils/node-utils/detach-hson-root-value.js";
import { is_Node } from "../../../core/node-guards.js";
import { normalize_empty_hson_metadata } from "../../../core/normalize-hson-graph.js";

type TransformHtmlSanitizer = (html: string) => TransformFrame["node"];
let transformHtmlSanitizer: TransformHtmlSanitizer | undefined;

/** @internal Install the browser sanitizer used by the compatibility pipeline. */
export function set_transform_html_sanitizer(sanitizer: TransformHtmlSanitizer): void {
  transformHtmlSanitizer = sanitizer;
}

/**
 * Hson pipeline, stage 2: choose an output representation.
 *
 * Given a normalized frame from stage 1, this stage materializes one of the
 * supported output forms:
 * - `toHtml()`
 * - `toJson()`
 * - `toHson()`
 * - `sanitizeBEWARE()` for explicit HTML-style sanitization of node content
 *
 * Each `toX()` call stores the chosen representation on the frame and returns
 * the merged stage-3 / stage-4 surface. Hson is serialization-only at that
 * stage; canonical graph access is the source-level `toNode()` terminal.
 *
 * LiveTree construction is handled separately by the `hson.liveTree` facade.
 *
 * @param frame - Normalized frame from stage 1.
 * @returns Stage-2 output-selection API.
 */
 
export function construct_output_2(frame: TransformFrame): TransformOutput {
  function makeBuilder(currentFrame: TransformFrame): TransformOutput {
    return {
      toNode() {
        return currentFrame.node;
      },

      toBinary() {
        const origin = currentFrame.meta?.origin;
        const parserOwnsRoot = origin === "json"
          || origin === "html"
          || origin === "html-sanitized-from-node";
        const retainedBinaryNode = currentFrame.meta?.binaryNode;
        const node = is_Node(retainedBinaryNode)
          ? normalize_empty_hson_metadata(retainedBinaryNode)
          : parserOwnsRoot && currentFrame.node.$_tag === ROOT_TAG
            ? detach_hson_root_value(currentFrame.node)
            : currentFrame.node;
        const bytes = serialize_binary(node);
        return {
          serialize: () => bytes.slice(),
          sha256: () => sha256_bytes(bytes),
        };
      },

      toHson() {
        const ctx: TransformFrameRender<(typeof $RENDER)["Hson"]> = {
          // Hson is intentionally lazy so options selected after `.toHson()`
          // participate in the final serialization pass.
          frame: currentFrame,
          output: $RENDER.Hson,
        };

        return construct_hson_options_3(ctx);
      },

      toJson() {
        const json = json_value_from_node(currentFrame.node);

        const ctx: TransformFrameRender<(typeof $RENDER)["JSON"]> = {
          frame: { ...currentFrame, json },
          output: $RENDER.JSON,
        };

        return construct_json_options_3(ctx);
      },

      toHtml() {
        const html = serialize_html(currentFrame.node);

        const ctx: TransformFrameRender<(typeof $RENDER)["HTML"]> = {
          frame: { ...currentFrame, html },
          output: $RENDER.HTML,
        };

        return construct_html_options_3(ctx);
      },

      sanitizeBEWARE(): TransformOutput {
        const node = currentFrame.node;
        if (!node) {
          throw new Error("sanitizeBEWARE(): frame is missing Hson node data");
        }

        // Node → HTML → sanitized Node, then continue from a fresh frame
        const rawHtml = serialize_html(node);
        if (!transformHtmlSanitizer) {
          throw new Error(
            "sanitizeBEWARE() requires the browser-capable hson-live umbrella facade.",
          );
        }
        const sanitizedNode = transformHtmlSanitizer(rawHtml);
        const retainedMeta = { ...currentFrame.meta };
        delete retainedMeta.binaryNode;

        const nextFrame: TransformFrame = {
          input: rawHtml,
          node: sanitizedNode,
          meta: {
            ...retainedMeta,
            origin: "html-sanitized-from-node",
            sanitized: true,
            unsafePipeline: false,
          },
        };

        return makeBuilder(nextFrame);
      },
    };
  }

  return makeBuilder(frame);
}
