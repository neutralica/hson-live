// construct-output-2.ts

import { RenderFormats } from "../../types/constructor.types.js";
import { OutputConstructor_2 } from "../../types/constructor.types.js";
import { HsonNode } from "../../types/node.types.js";
import { $RENDER } from "../../consts/constants.js";
import { FrameConstructor } from "../../types/constructor.types.js";
import { parse_external_html } from "../parsers/parse-external-html.transform.js";
import { serialize_hson } from "../serializers/serialize-hson.js";
import { serialize_html } from "../serializers/serialize-html.js";
import { serialize_json } from "../serializers/serialize-json.js";
import { construct_options_3 } from "./construct-options-3.js";
import { construct_render_4 } from "./construct-render-4.js";
import { OptionsConstructor_3, RenderConstructor_4 } from "../../types/constructor.types.js";
import { FrameRender } from "../../types/constructor.types.js";
import { LiveTree } from "../livetree/livetree.js";
import { LiveTreeConstructor_3 } from "../../types/constructor.types.js";
import { make_branch_from_node } from "../livetree/creation/create-branch.js";

/**
 * HSON pipeline – stage 2: select output format.
 *
 * This takes a normalized HSON "frame" (Node + meta) produced by
 * `construct_source_1` and produces the format-selection surface:
 *
 *   hson.fromJson(data)
 *       .toHtml()        // ← this function
 *       .spaced()        // optional options (stage 3)
 *       .serialize();    // final action (stage 4)
 *
 * Each `toX()` call:
 * - serializes the current Node into the chosen format,
 * - stores that representation on the frame (`frame.html` / `frame.json` / `frame.hson`),
 * - and returns a merged object that supports both:
 *   - configuration (OptionsConstructor_3),
 *   - final actions (RenderConstructor_4).
 * Given a normalized frame (Node + meta), this exposes:
 * - text outputs:  .toHtml() / .toJson() / .toHson()
 * - LiveTree:      .liveTree().asBranch()
 * - cross-format transform: .sanitizeBEWARE() (Node → HTML → DOMPurify → Node)
 *
 * @param frame - Normalized frame from stage 1 (node + meta).
 * @returns Stage-2 constructor API for selecting output formats.
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

      toHtml(){
        const html = serialize_html(currentFrame.node);
        const ctx: FrameRender<(typeof $RENDER)["HTML"]> = {
          frame: { ...currentFrame, html },
          output: $RENDER.HTML,
        };
        return makeFinalizer(ctx);
      },

     get liveTree(): LiveTreeConstructor_3 {
        return {
          asBranch(): LiveTree {
            const node: HsonNode | undefined = currentFrame.node;
            if (!node) {
              throw new Error("liveTree().asBranch(): frame is missing HSON node data");
            }
            // Populate NODE_ELEMENT_MAP; actual attach happens later via graft/append.
            
            return make_branch_from_node(node);
          },
        };
      },

      sanitizeBEWARE(): OutputConstructor_2 {
        const node: HsonNode | undefined = currentFrame.node;
        if (!node) {
          throw new Error("sanitizeBEWARE(): frame is missing HSON node data");
        }

        // 1) Node → HTML string
        const rawHtml: string = serialize_html(node);

        // 2) Untrusted HTML path: DOMPurify + parse_external_html
        const sanitizedNode: HsonNode = parse_external_html(rawHtml);

        // 3) Build a new frame rooted at the sanitized Node
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

        // 4) Return a fresh builder for the sanitized frame
        return makeBuilder(nextFrame);
      },
    };
  }

  return makeBuilder(frame);
}
