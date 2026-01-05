// construct-tree.ts

import { JsonValue } from "../../types-consts/core.types";
import { HsonNode } from "../../types-consts/node.types";
import { $_ERROR } from "../../types-consts/constants";
import { isSvgMarkup, node_from_svg } from "../../utils/node-utils/node-from-svg";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";
import { parse_external_html } from "../parsers/parse-external-html.transform";
import { parse_hson } from "../parsers/parse-hson.new.transform";
import { parse_html } from "../parsers/parse-html.new.transform";
import { parse_json } from "../parsers/parse-json.new.transform";
import { make_branch_from_node } from "../livetree/livetree-creation/create-branch";
import { graft } from "../livetree/livetree-creation/graft";
import { LiveTree } from "../livetree/livetree";
import { BranchConstructor, GraftConstructor, TreeConstructor_Source } from "../../types-consts/constructor.types";

/**
 * Build the entry point for the LiveTree creation and grafting pipeline.
 *
 * The returned object provides a uniform API for constructing `LiveTree`
 * branches from multiple input formats (HTML, JSON, HSON) and for grafting
 * into existing DOM elements.
 *
 * Behavior:
 * - The `options` parameter controls safety rules, notably whether
 *   external SVG markup may be parsed (`unsafe: true`) or must be rejected.
 *
 * Branch constructors:
 * - `fromHtml(html)`:
 *     - Detects whether input is SVG or HTML.
 *     - SVG parsing is allowed only when `unsafe: true`; otherwise a
 *       transform error is thrown.
 *     - Non-SVG HTML is routed through either the safe external parser
 *       (`parse_external_html`) or the raw parser (`parse_html`).
 *     - Produces a detached `LiveTree` branch via `make_branch_from_node`.
 * - `fromJson(json)` and `fromHson(hson)`:
 *     - Parse into an HSON root node and normalize through
 *       `make_branch_from_node`.
 *
 * Grafting helpers:
 * - `queryDom(selector)`:
 *     - Returns a lightweight object whose `graft()` method binds the
 *       selected DOM element into the LiveTree pipeline.
 *     - Throws at graft-time if the selector matches no element.
 * - `queryBody()`:
 *     - Convenience form targeting `document.body`.
 *
 * All constructors return small wrapper objects whose `.asBranch()` or
 * `.graft()` methods finalize the creation of a `LiveTree` rooted at
 * either newly parsed content or an existing DOM element.
 *
 * @param options - Configuration flags, e.g. `{ unsafe: boolean }`,
 *                  controlling parsing and sanitization behavior.
 * @returns An object exposing the LiveTree construction and grafting API.
 * @see make_branch_from_node
 * @see graft
 */
export function construct_tree(
  options: { unsafe: boolean } = { unsafe: false }
): TreeConstructor_Source {

  /* the main object returned by construct_tree */
  return {
    /* methods for creating detached branches from data */
    fromHtml(html: string): BranchConstructor {
      let node: HsonNode;

      const trimmed = html.trimStart();

      if (isSvgMarkup(trimmed)) {
        if (!options.unsafe) {
          // SAFE pipeline: SVG from external HTML is not allowed
          _throw_transform_err(
            "liveTree.fromHtml(): SVG markup is only allowed on UNSAFE pipeline or via internal node_from_svg.",
            "liveTree.fromHtml",
            html.slice(0, 200)
          );
        }

        // UNSAFE: legacy SVG path (internal demo content)
        const el = new DOMParser()
          .parseFromString(html, "image/svg+xml")
          .documentElement;
        node = node_from_svg(el);
      } else {
        // NON-SVG HTML: safe pipeline → sanitized; unsafe → raw
        node = options.unsafe
          ? parse_html(html)
          : parse_external_html(html);
      }

      const branch = make_branch_from_node(node);
      return {
        asBranch: () => branch,
      };
    },

    fromJson(json: string | JsonValue): BranchConstructor {
      const rootNode = parse_json(json as string);
      const branch = make_branch_from_node(rootNode);
      return {
        asBranch: () => branch,
      };
    },


    fromHson(hson: string): BranchConstructor {
      // assumes tokenize_hson and parse_tokens available
      const rootNode = parse_hson(hson);
      const branch = make_branch_from_node(rootNode);
      return {
        asBranch: () => branch,
      };
    },

    /* --- methods for targeting and replacing live dom elements --- */

    queryDom(selector: string): GraftConstructor {
      const element = document.querySelector<HTMLElement>(selector);

      /* return the graft constructor object */
      return {
        graft: (): LiveTree => {
          /* the null check here inside the final method call */
          if (!element) {
          throw new Error (`hson.liveTree.queryDom: selector "${selector}" not found.`);
          }
          // only call the main graft function if the element was found
          return graft(element, options);
        }
      };
    },

    queryBody(): GraftConstructor {
      const element = document.body;

      /* return the graft constructor object */
      return {
        graft: (): LiveTree => {
          return graft(element, options);
        }
      };
    },

  };
}
