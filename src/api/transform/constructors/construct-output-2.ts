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

type TransformHtmlSanitizer = (html: string) => TransformFrame["node"];
let transformHtmlSanitizer: TransformHtmlSanitizer | undefined;

/** @internal Install the browser sanitizer used by the compatibility pipeline. */
export function set_transform_html_sanitizer(sanitizer: TransformHtmlSanitizer): void {
  transformHtmlSanitizer = sanitizer;
}

/**
 * HSON pipeline, stage 2: choose an output representation.
 *
 * Given a normalized frame from stage 1, this stage materializes one of the
 * supported output forms:
 * - `toHtml()`
 * - `toJson()`
 * - `toHson()`
 * - `sanitizeBEWARE()` for explicit HTML-style sanitization of node content
 *
 * Each `toX()` call stores the chosen representation on the frame and returns
 * the merged stage-3 / stage-4 surface. HSON is serialization-only at that
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

      toHson() {
        const ctx: TransformFrameRender<(typeof $RENDER)["HSON"]> = {
          // HSON is intentionally lazy so options selected after `.toHson()`
          // participate in the final serialization pass.
          frame: currentFrame,
          output: $RENDER.HSON,
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
          throw new Error("sanitizeBEWARE(): frame is missing HSON node data");
        }

        // Node → HTML → sanitized Node, then continue from a fresh frame
        const rawHtml = serialize_html(node);
        if (!transformHtmlSanitizer) {
          throw new Error(
            "sanitizeBEWARE() requires the browser-capable hson-live umbrella facade.",
          );
        }
        const sanitizedNode = transformHtmlSanitizer(rawHtml);

        const nextFrame: TransformFrame = {
          input: rawHtml,
          node: sanitizedNode,
          meta: {
            ...currentFrame.meta,
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
