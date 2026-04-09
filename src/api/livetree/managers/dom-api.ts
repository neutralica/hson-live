import { LiveTree } from "../livetree.js";
import { ClosestFn, LiveTreeDom, ParentFn, DomRectApi, DomSize, LiveTreeDocument } from "../../../types/dom.types.js";
import { _snip } from "../../../utils/sys-utils/snip.utils.js";
import { LiveTreeSvgDom, SvgBox } from "../../../types/svg.types.js";
import { _DATA_QUID, get_el_if_quid as get_el_by_quid, get_node_by_quid } from "../../../quid/data-quid.quid.js";
import { make_tree_selector } from "../creation/make-tree-selector.js";
import { TreeSelector } from "../tree-selector.js";
import { create_livetree } from "../create-livetree.js";

// honest maybe-returning lookup from DOM element back to tree node
function resolve_tree_from_el(tree: LiveTree, el: Element): LiveTree | undefined {
  const quid = get_el_by_quid(el);
  if (!quid) return undefined;

  const node = get_node_by_quid(quid);
  if (!node) return undefined;

  const t = create_livetree(node);
  t.adoptRoots(tree.hostRootNode());

  return t;
}

// strict helper for internal use
function resolve_tree_el_must(tree: LiveTree, el: Element, label?: string): LiveTree {
  const hit = resolve_tree_from_el(tree, el);
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
    if (!e) return undefined;
    if (typeof e.getBoundingClientRect !== "function") return undefined;
    return e.getBoundingClientRect();
  }) as DomRectApi;

  const clientRects = (() => {
    const e = el();
    if (!e) return undefined;
    if (typeof e.getClientRects !== "function") return undefined;
    return e.getClientRects();
  }) as (() => DOMRectList | undefined);

  const scrollSize = (() => {
    const e = html();
    if (!e) return undefined;
    return {
      width: e.scrollWidth,
      height: e.scrollHeight,
    };
  }) as (() => DomSize | undefined);

  const clientSize = (() => {
    const e = html();
    if (!e) return undefined;
    return {
      width: e.clientWidth,
      height: e.clientHeight,
    };
  }) as (() => DomSize | undefined);

  const computed = (() => {
    const e = el();
    if (!e) return undefined;
    return getComputedStyle(e);
  }) as (() => CSSStyleDeclaration | undefined);

  const computedProp = ((name: string) => {
    const cs = computed();
    if (!cs) return undefined;
    return cs.getPropertyValue(name);
  }) as ((name: string) => string | undefined);

  const closest = ((sel: string) => {
    const e = el();
    if (!e) return undefined;

    const hit = e.closest(sel);
    if (!hit) return undefined;

    return resolve_tree_from_el(tree, hit);
  }) as ClosestFn;

  const parent = (() => {
    const e = el();
    if (!e?.parentElement) return undefined;
    return resolve_tree_from_el(tree, e.parentElement);
  }) as ParentFn;
  function get_doc(): LiveTreeDocument | undefined {
    const e = el();
    if (!e?.ownerDocument) return undefined;

    const owner = e.ownerDocument;

    const elementAtPoint = (x: number, y: number): Element | undefined => {
      const hit = owner.elementFromPoint(x, y);
      return hit instanceof Element ? hit : undefined;
    };

    const elementsFromPoint = (x: number, y: number): Element[] => {
      return owner
        .elementsFromPoint(x, y)
        .filter((hit): hit is Element => hit instanceof Element);
    };

    const treeAtPoint = (x: number, y: number): LiveTree | undefined => {
      const hit = elementAtPoint(x, y);
      if (!hit) return undefined;
      return resolve_tree_from_el(tree, hit);
    };

    const treesFromPoint = (x: number, y: number): TreeSelector => {
      const trees: LiveTree[] = [];

      for (const hit of elementsFromPoint(x, y)) {
        const resolved = resolve_tree_from_el(tree, hit);
        if (resolved) trees.push(resolved);
      }

      return make_tree_selector(trees);
    };

    return Object.freeze({
      elementAtPoint,
      elementsFromPoint,
      treeAtPoint,
      treesFromPoint,
    });
  }

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

    treeFromEl(domEl: Element, label?: string):  LiveTree {
      const el = resolve_tree_el_must(tree, domEl, label);
      if (!el) {throw new Error (label || "[LiveTree.dom.must.treeFromEl] no el found")}
      return el as LiveTree;
    },

    computed(label?: string): CSSStyleDeclaration {
      const hit = computed();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.computed] no computed style available`);
      }
      return hit;
    },

    computedProp(name: string, label?: string): string {
      const hit = computedProp(name);
      if (hit == null) {
        throw new Error(label ?? `[LiveTree.dom.must.computedProp] no computed property "${name}"`);
      }
      return hit;
    },

    clientRects(label?: string): DOMRectList {
      const hit = clientRects();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.clientRects] no client rects available`);
      }
      return hit;
    },

    scrollSize(label?: string): DomSize {
      const hit = scrollSize();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.scrollSize] no scroll size available`);
      }
      return hit;
    },

    clientSize(label?: string): DomSize {
      const hit = clientSize();
      if (!hit) {
        throw new Error(label ?? `[LiveTree.dom.must.clientSize] no client size available`);
      }
      return hit;
    },


    get doc(): LiveTreeDocument {
      const hit = get_doc();
      if (!hit) {
        throw new Error(`[LiveTree.dom.must.doc] no ownerDocument available`);
      }
      return hit;
    },
  };
  return {
    el,
    html,
    matches,
    contains,
    isConnected,
    rect,
    closest,
    parent,
    computed,
    computedProp,
    clientRects,
    scrollSize,
    clientSize,

    get doc() {
      return get_doc();
    },

    must,
  };
}
