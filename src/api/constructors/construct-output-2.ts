// construct-output-2.ts

import { RenderFormats } from "../../types/constructor.types.js";
import { OutputConstructor_2 } from "../../types/constructor.types.js";
import { $RENDER } from "../../core/constants.js";
import { FrameConstructor } from "../../types/constructor.types.js";
import { parse_external_html } from "../parsers/parse-external-html.transform.js";
import { serialize_hson } from "../serializers/serialize-hson.js";
import { serialize_html } from "../serializers/serialize-html.js";
import { serialize_json } from "../serializers/serialize-json.js";
import { construct_options_3 } from "./construct-options-3.js";
import { construct_render_4 } from "./construct-render-4.js";
import { OptionsConstructor_3, RenderConstructor_4 } from "../../types/constructor.types.js";
import { FrameRender } from "../../types/constructor.types.js";

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
 * the merged stage-3 / stage-4 surface used for formatting, `serialize()`,
 * and `parse()`.
 *
 * LiveTree construction is handled separately by the `hson.liveTree` facade.
 *
 * @param frame - Normalized frame from stage 1.
 * @returns Stage-2 output-selection API.
 */
 
export function construct_output_2(frame: FrameConstructor): OutputConstructor_2 {
  function makeFinalizer<K extends RenderFormats>(
    context: FrameRender<K>
  ): OptionsConstructor_3<K> & RenderConstructor_4<K> {
    return {
      ...construct_options_3(context),
      ...construct_render_4(context),
    };
  }

  function makeBuilder(currentFrame: FrameConstructor): OutputConstructor_2 {
    return {
      toHson() {
        const hson = serialize_hson(currentFrame.node);

        const ctx: FrameRender<(typeof $RENDER)["HSON"]> = {
          frame: { ...currentFrame, hson },
          output: $RENDER.HSON,
        };

        return makeFinalizer(ctx);
      },

      toJson() {
        const json = serialize_json(currentFrame.node);

        const ctx: FrameRender<(typeof $RENDER)["JSON"]> = {
          frame: { ...currentFrame, json },
          output: $RENDER.JSON,
        };

        return makeFinalizer(ctx);
      },

      toHtml() {
        const html = serialize_html(currentFrame.node);

        const ctx: FrameRender<(typeof $RENDER)["HTML"]> = {
          frame: { ...currentFrame, html },
          output: $RENDER.HTML,
        };

        return makeFinalizer(ctx);
      },

      sanitizeBEWARE(): OutputConstructor_2 {
        const node = currentFrame.node;
        if (!node) {
          throw new Error("sanitizeBEWARE(): frame is missing HSON node data");
        }

        // Node → HTML → sanitized Node, then continue from a fresh frame
        const rawHtml = serialize_html(node);
        const sanitizedNode = parse_external_html(rawHtml);

        const nextFrame: FrameConstructor = {
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
