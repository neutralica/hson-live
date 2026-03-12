import { LiveTree } from "../livetree.js";
import { ClosestFn, LiveTreeDom, ParentFn, RectFn } from "../../../types/dom.types.js";
import { _snip } from "../../../utils/sys-utils/snip.utils.js";

// CHANGED: better name; honest about failure
function tree_from_el(tree: LiveTree, el: Element): LiveTree | undefined {
    const quid = el.getAttribute("data-_quid") ?? undefined;
    if (!quid) return undefined;

    // NOTE: use your existing find path until you add a quid index
    return tree.find.byAttrs ("data-_quid", quid ) ?? undefined;
}

// ADDED: must variant for internal use when you expect it to exist
function tree_from_el_must(tree: LiveTree, el: Element, label?: string): LiveTree {
    const hit = tree_from_el(tree, el);
    if (!hit) {
        const desc = label ?? el.tagName.toLowerCase();
        throw new Error(`[LiveTree.dom] expected element to belong to this tree: ${desc}`);
    }
    return hit;
}
// dom.ts

export function make_dom_api(tree: LiveTree): LiveTreeDom {
  const el = () => tree.asDomElement();

  const matches = (sel: string) => {
    const e = el();
    if (e) return e.matches(sel);
    return false;
  };

  const contains = (other: LiveTree) => {
    const a = el();
    const b = other.dom?.el?.();
    if (a && b) return a.contains(b);
    return false;
  };

  const isConnected = (): boolean => {
    const e = el();
    return !!e?.isConnected;
  };

  const rect = (() => {
    const e = el();
    if (!e) return undefined;

    // CHANGED: geometry is only meaningful on rendered Elements
    if (typeof e.getBoundingClientRect !== "function") return undefined;

    return e.getBoundingClientRect();
  }) as RectFn;

  rect.must = (label?: string): DOMRect => {
    const r = rect();
    if (!r) {
      throw new Error(label ?? `[LiveTree.dom.rect.must] no DOMRect available`);
    }
    return r;
  };

  const closest = ((sel: string) => {
    const e = el();
    if (!e) return undefined;
    const hit = e.closest(sel);
    if (!hit) return undefined;
    return tree_from_el(tree, hit);
  }) as ClosestFn;

  closest.must = (sel, label) => {
    const hit = closest(sel);
    if (!hit) throw new Error(label ?? `[LiveTree.dom.closest.must] no match for ${sel}`);
    return hit;
  };

  const html = (() => {
    const e = el();
    return (e instanceof HTMLElement) ? e : undefined;
  }) as {
    (): HTMLElement | undefined;
    must(): HTMLElement;
  };

  html.must = (): HTMLElement => {
    const e = el();
    if (!(e instanceof HTMLElement)) {
      throw new Error(`[LiveTree.dom.html.must] element is not an HTMLElement`);
    }
    return e;
  };

  const parent = (() => {
    const e = el();
    if (!e?.parentElement) return undefined;
    return tree_from_el(tree, e.parentElement);
  }) as ParentFn;

  parent.must = (label) => {
    const hit = parent();
    if (!hit) throw new Error(label ?? `[LiveTree.dom.parent.must] no parent`);
    return hit;
  };

  return { el, html, matches, contains, isConnected, rect, closest, parent };
}