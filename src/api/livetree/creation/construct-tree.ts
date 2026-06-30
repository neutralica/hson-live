// construct-tree.ts

import { JsonValue } from "../../../core/types.js";
import { HsonNode } from "../../../core/types.js";
import { $_ERROR } from "../../../core/constants.js";
import { is_svg_markup, node_from_svg } from "../../transform/utils/node-utils/node-from-svg.js";
import { _throw_transform_err } from "../../transform/utils/sys-utils/throw-transform-err.utils.js";
import { parse_external_html } from "../../transform/parsers/parse-external-html.transform.js";
import { parse_hson } from "../../transform/parsers/parse-hson.js";
import { parse_html } from "../../transform/parsers/parse-html.js";
import { parse_json } from "../../transform/parsers/parse-json.js";
import { make_branch_from_node } from "./create-branch.js";
import { graft } from "./graft.js";
import { LiveTree } from "../livetree.js";
import { GraftConstructor, TreeConstructor_Source } from "../../../types/constructor.types.js";
import { construct_source_1 } from "../../transform/constructors/construct-source-1.js";
import { make_detached_livetree_create } from "./make-detached-livetree.js";

/**
 * HSON pipeline, stage 4: finalize the selected output.
 *
 * This is the terminal stage of the transformer chain. The incoming context
 * already contains:
 * - the chosen render format,
 * - the materialized representation on the frame,
 * - and any formatting options applied in stage 3.
 *
 * This stage exposes only the final data operations:
 * - `serialize()` → string output in the chosen format
 * - `parse()` → structured output for JSON or HSON
 *
 * `LiveTree` creation is not part of this terminal render stage.
 *
 * @param context - Render context containing the frame and chosen format.
 * @returns Stage-4 terminal render API.
 */

export function construct_tree(
  options: { unsafe: boolean } = { unsafe: false }
): TreeConstructor_Source {
  return {
    fromTrustedHtml(input): LiveTree {
      const raw = typeof input === "string" ? input : input.innerHTML;
      const trimmed = raw.trimStart();

      let node: HsonNode;

      if (is_svg_markup(trimmed)) {
        if (!options.unsafe) {
          _throw_transform_err(
            "liveTree.fromTrustedHtml(): SVG markup is only allowed on UNSAFE pipeline or via internal node_from_svg.",
            "liveTree.fromTrustedHtml",
            raw.slice(0, 200)
          );
        }

        const el = new DOMParser()
          .parseFromString(raw, "image/svg+xml")
          .documentElement;

        node = node_from_svg(el);
      } else {
        node = options.unsafe
          ? parse_html(raw)
          : parse_external_html(raw);
      }

      return make_branch_from_node(node);
    },

    fromUntrustedHtml(input): LiveTree {
      const raw = typeof input === "string" ? input : input.innerHTML;
      const node = parse_external_html(raw);
      return make_branch_from_node(node);
    },

    fromJson(input: string | JsonValue): LiveTree {
      const raw = typeof input === "string" ? input : JSON.stringify(input);
      const node = parse_json(raw);
      return make_branch_from_node(node);
    },

    fromHson(input: string): LiveTree {
      const node = parse_hson(input);
      return make_branch_from_node(node);
    },

    fromNode(input: HsonNode): LiveTree {
      return make_branch_from_node(input);
    },

    queryDom(selector: string): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.querySelector<HTMLElement>(selector);

          if (!element) {
            throw new Error(`hson.liveTree.queryDom: selector "${selector}" not found.`);
          }

          return graft(element, options);
        },
      };
    },

    queryBody(): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.body;

          if (!element) {
            throw new Error("hson.liveTree.queryBody: document.body is not available.");
          }

          return graft(element, options);
        },
      };
    },

    create: make_detached_livetree_create(),
  };
}