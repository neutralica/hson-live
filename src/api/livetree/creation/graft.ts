// graft.ts

import { HsonNode } from "../../../core/types.js";
import { unwrap_root_elem } from "../../transform/utils/html-utils/unwrap-root-elem.js";
import { _throw_transform_err } from "../../transform/utils/sys-utils/throw-transform-err.utils.js";
import { parse_html } from "../../transform/parsers/parse-html.js";
import { project_livetree } from "./project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { link_node_to_el, get_node_for_el } from "../utils/node-map-helpers.js";
import {
  HSON_QUID_MARKUP_NAME,
  admit_livetree_quid_graph,
  get_quid,
} from "../quid/data-quid.js";
import { set_attrs_safe } from "../../../safety/safe-mount.safe.js";
import { Primitive } from "../../../core/types.js";
import { canon_to_css_prop, normalize_css_key } from "../../transform/utils/attrs-utils/normalize-css.js";
import { SVG_NS } from "../../transform/utils/node-utils/node-from-svg.js";
import {
  default_livetree_runtime,
  register_runtime_document,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";
import { create_livetree_in_runtime } from "./create-livetree.js";



/**
 * Project a known HSON node into an existing DOM element and return a LiveTree
 * handle for that node.
 *
 * This is the real endpoint used by graft().
 */
function graft_node_into_element(
  element: HTMLElement,
  nodeToRender: HsonNode,
  runtime: LiveTreeRuntime,
): LiveTree {
  register_runtime_document(runtime, element.ownerDocument);
  link_node_to_el(nodeToRender, element);
  const parentNs: "html" | "svg" =
    element.namespaceURI === SVG_NS ? "svg" : "html";

  // reflect attrs from root node onto existing host element
  sync_root_attrs_to_element(nodeToRender, element, runtime);

  const frag = element.ownerDocument.createDocumentFragment();
  for (const child of nodeToRender.$_content ?? []) {
    frag.appendChild(project_livetree(
      child as HsonNode | Primitive,
      parentNs,
      runtime,
      element.ownerDocument,
    ));
  }

  element.replaceChildren(frag);

  return create_livetree_in_runtime(nodeToRender, runtime);
}

/**
 * Graft an existing DOM element into HSON/LiveTree.
 *
 * Semantics:
 * - parses the element itself (not its innerHTML string)
 * - unwraps parser-only structural wrappers (_hson_root / _hson_elem)
 * - requires exactly one real root node
 * - re-projects that node into the same DOM element
 * - returns a LiveTree handle for that element-node
 */
export function graft(
  element?: HTMLElement,
  options: { unsafe: boolean } = { unsafe: false },
): LiveTree {
  void options; // currently unused

  const targetElement = element;
  if (!targetElement) {
    _throw_transform_err("error getting target element", "graft", element);
  }

  const existingNode = get_node_for_el(targetElement);
  if (existingNode) {
    return create_livetree_in_runtime(
      existingNode,
      runtime_for_node(existingNode) ?? default_livetree_runtime(),
    );
  }

  const parsedRoot: HsonNode = parse_html(targetElement);
  const contentNodes = unwrap_root_elem(parsedRoot);

  if (contentNodes.length !== 1) {
    _throw_transform_err(
      `[ERR: graft()]: expected 1 node, but received ${contentNodes.length}. Wrap multiple elements in a single container.`,
      "graft",
    );
  }

  const nodeToRender = contentNodes[0];
  if (!nodeToRender) {
    _throw_transform_err(
      `[ERR: graft()]: unwrap_root_elem() returned no renderable node.`,
      "graft",
    );
  }
  const runtime = default_livetree_runtime();
  register_runtime_document(runtime, targetElement.ownerDocument);
  admit_livetree_quid_graph(nodeToRender, runtime);
  return graft_node_into_element(targetElement, nodeToRender, runtime);
}

function sync_root_attrs_to_element(
  node: HsonNode,
  el: HTMLElement,
  runtime: LiveTreeRuntime,
): void {
  const quid = get_quid(node, runtime);
  if (quid === undefined) {
    throw new Error("graft root was not admitted into its LiveTree runtime.");
  }
  set_attrs_safe(el, HSON_QUID_MARKUP_NAME, quid);

  const attrs = node.$_attrs;

  // clear stale attrs first
  for (const name of el.getAttributeNames()) {
    if (name === HSON_QUID_MARKUP_NAME) continue;
    if (attrs === undefined || !(name in attrs)) {
      el.removeAttribute(name);
    }
  }

  if (attrs === undefined) return;

  for (const [key, raw] of Object.entries(attrs)) {
    if (raw == null) {
      el.removeAttribute(key);
      continue;
    }

    if (key === "style") {
      if (typeof raw === "string") {
        el.style.cssText = raw;
      } else if (raw && typeof raw === "object") {
        // clear then rebuild
        el.removeAttribute("style");

        const obj = raw as Record<string, string | number | null>;
        for (const [prop, v] of Object.entries(obj)) {
          const val = v == null ? "" : String(v);
          const cssProp = canon_to_css_prop(normalize_css_key(prop));
          if (!cssProp) continue;
          if (val === "") el.style.removeProperty(cssProp);
          else el.style.setProperty(cssProp, val);
        }
      }
      continue;
    }

    if (raw === true) {
      set_attrs_safe(el, key, "");
      continue;
    }

    if (raw === false) {
      el.removeAttribute(key);
      continue;
    }

    set_attrs_safe(el, key, String(raw));
  }
}
