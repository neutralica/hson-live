import type { GraftConstructor } from "../../types/constructor.types.js";
import type { JsonValue } from "../../core/types.js";
import type { HsonNode } from "../../types/node.types.js";
import { UNSAFE_TRANSFORM_SOURCE } from "../transform/transform.browser.js";
import { parse_html } from "../transform/parsers/parse-html.js";
import { parse_external_html } from "../transform/parsers/parse-external-html.transform.js";
import { is_svg_markup, node_from_svg } from "../transform/utils/node-utils/node-from-svg.js";
import { make_branch_from_node } from "./creation/create-branch.js";
import { graft } from "./creation/graft.js";
import { make_detached_livetree_create } from "./creation/make-detached-livetree.js";
import { LiveTree } from "./livetree.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { create_livetree_runtime } from "./runtime/livetree-runtime.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";

type LiveTreeConstructionOptions = Readonly<{ isolated?: boolean }>;

/** Canonical browser-oriented LiveTree construction facade. */
export const hsonLiveTree = Object.freeze({
  fromUntrustedHtml(input: string | Element): LiveTree {
    return make_branch_from_node(
      parse_external_html(typeof input === "string" ? input : input.outerHTML),
      { quidGraphValidated: true },
    );
  },
  fromTrustedHtml(input: string | Element): LiveTree {
    const source = typeof input === "string" ? input : input.outerHTML;
    const svg = is_svg_markup(source.trimStart());
    const node = svg
      ? node_from_svg(typeof input === "string"
        ? new DOMParser().parseFromString(input, "image/svg+xml").documentElement
        : input)
      : parse_html(input);
    return make_branch_from_node(
      node,
      { quidGraphValidated: true },
    );
  },
  fromJson(input: string | JsonValue): LiveTree {
    return make_branch_from_node(UNSAFE_TRANSFORM_SOURCE.fromJson(input).toNode());
  },
  fromHson(input: string, options?: LiveTreeConstructionOptions): LiveTree {
    return make_branch_from_node(
      // LiveTree retains its established parser-root construction contract;
      // public Transform Hson terminals detach that carrier.
      parse_hson(input),
      { quidGraphValidated: true, runtime: options?.isolated ? create_livetree_runtime() : undefined },
    );
  },
  fromNode(node: HsonNode, options?: LiveTreeConstructionOptions): LiveTree {
    admit_portable_hson_node(node, "LiveTree.fromNode");
    return make_branch_from_node(node, {
      runtime: options?.isolated ? create_livetree_runtime() : undefined,
    });
  },
  queryDom(selector: string): GraftConstructor {
    return {
      graft(): LiveTree {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          throw new Error(`hson.liveTree.queryDom: selector "${selector}" not found.`);
        }
        return graft(element, { unsafe: false });
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
        return graft(element, { unsafe: false });
      },
    };
  },
  create: make_detached_livetree_create(),
});
