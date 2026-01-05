// create-live-tree.new.ts
import { Primitive } from "../../../types-consts/core.types";
import { ensure_quid } from "../../../quid/data-quid.quid";

import { set_attrs_safe } from "../../../safety/safe-mount.safe";
import {
  _DATA_QUID,
  ARR_TAG,
  ELEM_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "../../../types-consts/constants";
import { HsonNode } from "../../../types-consts/node.types";
import { SVG_NS } from "../../../utils/node-utils/node-from-svg";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { linkNodeToElement } from "../../../utils/tree-utils/node-map-helpers";
import { canon_to_css_prop, nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css";



/**
 * Materialize a new DOM subtree from a given HSON node or primitive.
 *
 * Behavior:
 * - When `node` is a primitive (not an `HsonNode`), returns a
 *   `Text` node whose content is `String(node ?? "")`.
 * - When `node` is an `HsonNode`:
 *   - Interprets virtual structural nodes (VSNs) such as `_root`,
 *     `_obj`, `_arr`, `_elem` as *non-rendered* containers:
 *     they never become real DOM elements, but their children are
 *     recursively rendered.
 *   - Creates real DOM `Element` nodes for concrete HSON element tags,
 *     wiring attributes and content according to the HSON structure.
 *   - Recursively renders children, attaching them under the newly
 *     created element or, for VSNs, under the nearest real ancestor.
 *
 * Namespace handling:
 * - Uses the `parentNs` argument (`"html"` or `"svg"`) as the current
 *   namespace context.
 * - When creating elements in SVG context, uses the correct SVG
 *   namespace; HTML context uses regular `document.createElement`.
 * - Namespace context is updated when descending into SVG/HTML roots,
 *   ensuring nested SVG-in-HTML and HTML-in-SVG patterns render
 *   correctly.
 *
 * IMPORTANT:
 * - This function is purely about DOM materialization. It does *not*
 *   assign QUIDs, update `NODE_ELEMENT_MAP`, or otherwise manage
 *   identity; that responsibility lives with `LiveTree` and related
 *   helpers.
 *
 * @param node - The HSON node or primitive value to render.
 * @param parentNs - The current namespace context (`"html"` or `"svg"`),
 *                   used to choose the appropriate element factory.
 * @returns The root DOM `Node` of the newly created subtree.
 */
export function create_live_tree(
  node: HsonNode | Primitive,
  parentNs: "html" | "svg" = "html"
): Node {
  // Non-node primitives → plain text
  if (!is_Node(node)) {
    return document.createTextNode(String(node ?? ""));
  }

  const n = node as HsonNode;

  // Primitive wrappers → text
  if (n._tag === STR_TAG || n._tag === VAL_TAG) {
    const v = n._content?.[0];
    return document.createTextNode(String(v ?? ""));
  }

  // VSNs: unwrap into a fragment
  if (
    n._tag === ROOT_TAG ||
    n._tag === OBJ_TAG ||
    n._tag === ELEM_TAG ||
    n._tag === ARR_TAG
  ) {
    const frag = document.createDocumentFragment();

    if (n._tag === ARR_TAG) {
      // _arr contains <_ii> items; unwrap each item’s single child
      for (const ii of n._content ?? []) {
        const payload =
          is_Node(ii) && Array.isArray(ii._content) ? ii._content[0] : null;
        if (payload != null) {
          frag.appendChild(create_live_tree(payload as HsonNode | Primitive, parentNs));
        }
      }
      return frag;
    }

    // _root/_obj/_elem → render their children directly
    for (const child of n._content ?? []) {
      frag.appendChild(create_live_tree(child as HsonNode | Primitive, parentNs));
    }
    return frag;
  }

  // REAL ELEMENT NODE --------------------------------------

  const tag = n._tag;
  const metaQuid = n._meta?._quid;
  const quidInfo = metaQuid ? `, node._meta._quid=${metaQuid}` : "";
  const illegalDomTag = (badTag: string) =>
    new Error(
      `[create_live_tree2] illegal DOM tag "${badTag}" (node._tag=${n._tag}${quidInfo})`
    );

  // "_" prefixes are reserved for HSON virtual/internal nodes (and meta like `_tag`).
  // They must never be materialized as real DOM elements.
  if (tag.startsWith("_")) {
    throw illegalDomTag(tag);
  }

  // decide namespace for *this* element + descendants
  const ns: "html" | "svg" = tag === "svg" ? "svg" : parentNs;

  // create element respecting namespace
  const el: Element =
    ns === "svg"
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);

  // Belt-and-suspenders: guard against any factory emitting "_" DOM tags.
  if (el.tagName.startsWith("_")) {
    throw illegalDomTag(el.tagName);
  }

  // single source of truth for mapping HsonNode -> Element
  linkNodeToElement(n, el);
  const quid = ensure_quid(n); // uses meta if present, mints if not

  // reflect QUID onto DOM
  if (ns === "svg") {
    el.setAttribute(_DATA_QUID, quid);
  } else {
    set_attrs_safe(el as HTMLElement, _DATA_QUID, quid);
  }
  // reflect _attrs
  const a = n._attrs;
  if (a) {
    for (const [key, raw] of Object.entries(a)) {
      if (raw == null) continue;

      // style handling
      if (key === "style") {
        const elt = el as HTMLElement | SVGElement;

        if (typeof raw === "string") {
          elt.style.cssText = raw;
        } else if (raw && typeof raw === "object") {
          const obj = raw as Record<string, string | number | null>;
          for (const [prop, v] of Object.entries(obj)) {
            const val = v == null ? "" : String(v);
            const cssProp = canon_to_css_prop(nrmlz_cssom_prop_key(prop));
            if (!cssProp) continue;
            if (val === "") elt.style.removeProperty(cssProp);
            else elt.style.setProperty(cssProp, val);
          }
        }
        continue;
      }

      // boolean presence attrs
      if (raw === true) {
        if (ns === "svg") {
          el.setAttribute(key, "");
        } else {
          set_attrs_safe(el as HTMLElement, key, "");
        }
        continue;
      }
      if (raw === false) {
        continue;
      }

      // everything else → string
      const str = String(raw);
      if (ns === "svg") {
        el.setAttribute(key, str);
      } else {
        set_attrs_safe(el as HTMLElement, key, str);
      }
    }
  }

  const m = n._meta;
  if (m && _DATA_QUID in m) {
    const q = String(m[_DATA_QUID]);
    if (ns === "svg") {
      // SVG path: write raw attribute
      el.setAttribute(_DATA_QUID, q);
    } else {
      // HTML path: keep using the safe setter
      set_attrs_safe(el as HTMLElement, _DATA_QUID, q);
    }
  }

  // children — either a single VSN wrapper or direct content
  const kids = n._content ?? [];
  if (
    kids.length === 1 &&
    is_Node(kids[0]) &&
    (kids[0]._tag === OBJ_TAG ||
      kids[0]._tag === ELEM_TAG ||
      kids[0]._tag === ARR_TAG)
  ) {
    const container = kids[0];

    if (container._tag === ARR_TAG) {
      for (const ii of container._content ?? []) {
        const payload =
          is_Node(ii) && Array.isArray(ii._content) ? ii._content[0] : null;
        if (payload != null) {
          el.appendChild(create_live_tree(payload as HsonNode | Primitive, ns));
        }
      }
    } else {
      for (const c of container._content ?? []) {
        el.appendChild(create_live_tree(c as HsonNode | Primitive, ns));
      }
    }
  } else {
    for (const c of kids) {
      el.appendChild(create_live_tree(c as HsonNode | Primitive, ns));
    }
  }

  return el;
}
