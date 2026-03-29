import { LiveTree } from "../livetree.js";
import { ClosestFn, LiveTreeDom, ParentFn, DomRectApi } from "../../../types/dom.types.js";
import { _snip } from "../../../utils/sys-utils/snip.utils.js";
import { LiveTreeSvgDom, SvgBox } from "../../../types/svg.types.js";

// honest maybe-returning lookup from DOM element back to tree node
function tree_from_el(tree: LiveTree, el: Element): LiveTree | undefined {
  const quid = el.getAttribute("data-_quid") ?? undefined;
  if (!quid) return undefined;

  // keep using existing find path until a quid index exists
  return tree.find.byAttrs("data-_quid", quid) ?? undefined;
}

// strict helper for internal use
function tree_from_el_must(tree: LiveTree, el: Element, label?: string): LiveTree {
  const hit = tree_from_el(tree, el);
  if (!hit) {
    const desc = label ?? el.tagName.toLowerCase();
    throw new Error(`[LiveTree.dom.must] expected element to belong to this tree: ${desc}`);
  }
  return hit;
}

export function make_svg_manager(tree: LiveTree): LiveTreeSvgDom {
  function bbox(): SvgBox | undefined {
    const el = tree.dom.el();
    if (!(el instanceof SVGGraphicsElement)) return undefined;

    const b = el.getBBox();
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    };
  }

  return {
    bbox,
    must: {
      bbox(label?: string) {
        const b = bbox();
        if (!b) throw new Error(`[svg.bbox.must] no bbox${label ? `: ${label}` : ""}`);
        return b;
      },
    },
  };
}

export function make_dom_api(tree: LiveTree): LiveTreeDom {
  const el = () => tree.asDomElement();

  const html = (() => {
    const e = el();
    return (e instanceof HTMLElement) ? e : undefined;
  }) as (() => HTMLElement | undefined);

  const matches = (sel: string): boolean => {
    const e = el();
    if (!e) return false;
    return e.matches(sel);
  };

  const contains = (other: LiveTree): boolean => {
    const a = el();
    const b = other.dom?.el?.();
    if (!a || !b) return false;
    return a.contains(b);
  };

  const isConnected = (): boolean => {
    const e = el();
    return !!e?.isConnected;
  };

  const rect = (() => {
    const e = el();

    // geometry only exists for rendered elements
    if (!e) return undefined;
    if (typeof e.getBoundingClientRect !== "function") return undefined;

    return e.getBoundingClientRect();
  }) as DomRectApi;

  const closest = ((sel: string) => {
    const e = el();
    if (!e) return undefined;

    const hit = e.closest(sel);
    if (!hit) return undefined;

    return tree_from_el(tree, hit);
  }) as ClosestFn;

  const parent = (() => {
    const e = el();
    if (!e?.parentElement) return undefined;

    return tree_from_el(tree, e.parentElement);
  }) as ParentFn;

  // strict variants grouped under dom.must.* for API symmetry
  const must = {
    el(label?: string): Element {
      const hit = el();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.el] no DOM element available`);
      }
      return hit;
    },

    html(label?: string): HTMLElement {
      const hit = el();
      if (!(hit instanceof HTMLElement)) {
        throw new Error(label ?? `[LiveTree.dom.must.html] element is not an HTMLElement`);
      }
      return hit;
    },

    rect(label?: string): DOMRect {
      const hit = rect();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.rect] no DOMRect available`);
      }
      return hit;
    },

    closest(sel: string, label?: string): LiveTree {
      const hit = closest(sel);
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.closest] no match for ${_snip(sel, 60)}`);
      }
      return hit;
    },

    parent(label?: string): LiveTree {
      const hit = parent();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.parent] no parent`);
      }
      return hit;
    },

    // OPTIONAL: useful if you want the reverse-mapping strict helper public
    treeFromEl(domEl: Element, label?: string): LiveTree {
      return tree_from_el_must(tree, domEl, label);
    },
  };

  return { el, html, matches, contains, isConnected, rect, closest, parent, must };
}