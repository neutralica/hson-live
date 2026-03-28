// construct-tree.ts

import { JsonValue } from "../../types/core.types.js";
import { HsonNode } from "../../types/node.types.js";
import { $_ERROR } from "../../consts/constants.js";
import { is_svg_markup, node_from_svg } from "../../utils/node-utils/node-from-svg.js";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils.js";
import { parse_external_html } from "../parsers/parse-external-html.transform.js";
import { parse_hson } from "../parsers/parse-hson.js";
import { parse_html } from "../parsers/parse-html.js";
import { parse_json } from "../parsers/parse-json.js";
import { make_branch_from_node } from "../livetree/creation/create-branch.js";
import { graft } from "../livetree/creation/graft.js";
import { LiveTree } from "../livetree/livetree.js";
import { GraftConstructor, TreeConstructor_Source } from "../../types/constructor.types.js";
import { construct_source_1 } from "./construct-source-1.js";
import { make_detached_livetree_create } from "./make-detached-livetree.js";

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
 */export function construct_tree(
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