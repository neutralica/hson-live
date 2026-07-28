import type { GraftConstructor } from "../../types/constructor.types.js";
import type { JsonValue } from "../../core/types.js";
import type { HsonNode } from "../../types/node.types.js";
import { SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE } from "../transform/transform.browser.js";
import { make_branch_from_node } from "./creation/create-branch.js";
import { graft } from "./creation/graft.js";
import { make_detached_livetree_create } from "./creation/make-detached-livetree.js";
import { LiveTree } from "./livetree.js";

/** Canonical browser-oriented LiveTree construction facade. */
export const hsonLiveTree = {
  fromUntrustedHtml(input: string | Element): LiveTree {
    return make_branch_from_node(
      SAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: true }).toNode(),
      { quidGraphValidated: true },
    );
  },
  fromTrustedHtml(input: string | Element): LiveTree {
    return make_branch_from_node(
      UNSAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: false }).toNode(),
      { quidGraphValidated: true },
    );
  },
  fromJson(input: string | JsonValue): LiveTree {
    return make_branch_from_node(UNSAFE_TRANSFORM_SOURCE.fromJson(input).toNode());
  },
  fromHson(input: string): LiveTree {
    return make_branch_from_node(
      UNSAFE_TRANSFORM_SOURCE.fromHson(input).toNode(),
      { quidGraphValidated: true },
    );
  },
  fromNode(node: HsonNode): LiveTree {
    return make_branch_from_node(node);
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
};
