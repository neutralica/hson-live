import { LiveTree } from "hson-live/types";
import { ClosestFn, LiveTreeDom, ParentFn } from "../../../types-consts/dom.types";
import { _snip } from "../../../utils/sys-utils/snip.utils";

// CHANGED: better name; honest about failure
function tree_from_el(tree: LiveTree, el: Element): LiveTree | undefined {
    const quid = el.getAttribute("data-_quid") ?? undefined;
    if (!quid) return undefined;

    // NOTE: use your existing find path until you add a quid index
    return tree.find.byId?.(quid) ?? tree.find({ attrs: { "data-_quid": quid } }) ?? undefined;
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
        // fallback if you want; otherwise false
        return false;
    };

    const contains = (other: LiveTree) => {
        const a = el();
        const b = other.dom?.el?.();
        if (a && b) return a.contains(b);
        // fallback if you want
        return false;
    };

    const closest = ((sel: string) => {
        const e = el();
        if (!e) return undefined;
        const hit = e.closest(sel);
        if (!hit) return undefined;
        // CHANGED: convert Element -> LiveTree via data-_quid lookup
        return tree_from_el(tree, hit);
    }) as ClosestFn;

    closest.must = (sel, label) => {
        const hit = closest(sel);
        if (!hit) throw new Error(label ?? `[LiveTree.dom.closest.must] no match for ${sel}`);
        return hit;
    };

    const html = (): HTMLElement | undefined => {
        const e = el();
        return (e instanceof HTMLElement) ? e : undefined;
    };
    html.must = (): HTMLElement => {
        const e = el();
        if (!(e instanceof HTMLElement)) {
            throw new Error(`[LiveTree.dom.html.must]Element is not HTML element }`)
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

    return { el, html, matches, contains, closest, parent };
}