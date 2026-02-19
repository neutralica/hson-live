// text-manager.ts

import { HsonAttrs, HsonNode } from "../../../types/node.types";
import { ELEM_OBJ_ARR, ELEM_TAG, LEAF_NODES, STR_TAG, VAL_TAG } from "../../../consts/constants";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { make_string } from "../../../utils/primitive-utils/make-string.nodes.utils";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { make_leaf } from "../../parsers/parse-tokens";
import { Primitive } from "../../../types/core.types";
import { LiveTree } from "hson-live";
import { CREATE_NODE } from "../../../consts/factories";

/**
 * Options for form state writers that mirror to the DOM when available.
 */
export type SetNodeFormOpts = Readonly<{
  // CHANGED: default should be "silent" (missing DOM is normal pre-mount)
  silent?: boolean;

  // ADDED: for callers that want the old strict behavior
  strict?: boolean;
}>;

export type LiveTextApi = Readonly<{
  set: (value: Primitive) => LiveTree;
  add: (value: Primitive) => LiveTree;
  overwrite: (value: Primitive) => LiveTree;
  insert: (index: number, value: Primitive) => LiveTree;
  get: () => string;
}>;

// treat _attrs as a simple dictionary
type AttrDict = Record<string, unknown>;
// central DOM form-control narrowing
type FormEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/* ------------------------------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------------------------- */
// ADDED: leaf tags

const isLeafNode = (tag: string): boolean => LEAF_NODES.includes(tag);
const isElemObjArr = (tag: string): boolean => ELEM_OBJ_ARR.includes(tag);
function ensureVsn(node: HsonNode): HsonNode {
  // find first VSN child
  const found = node._content.find((c): c is HsonNode => is_Node(c) && isElemObjArr(c._tag));
  if (found) return found;

  // create bucket; prefer `_elem` as the generic container
  const bucket = CREATE_NODE({
    _tag: ELEM_TAG,      // from your constants
    _attrs: {},          // or however you represent empty attrs/meta
    _meta: {},
    _content: node._content, // move existing content under the bucket
  });

  node._content = [bucket];
  return bucket;
}

function make_dom_leaf(_leaf: HsonNode, value: Primitive): Text {
  return document.createTextNode(value === null ? "" : String(value));
}

function ensure_attrs(node: HsonNode): AttrDict {
  if (!node._attrs) node._attrs = {} as HsonAttrs;
  return node._attrs as unknown as AttrDict;
}
function resolve_form_control(el: Element): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el;
  }
  // If mapping gives a wrapper element, look for the first real control inside.
  const inner = el.querySelector("input,textarea,select");
  if (!inner) return null;

  if (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement || inner instanceof HTMLSelectElement) {
    return inner;
  }
  return null;
}

function form_el_for_node(node: HsonNode): FormEl | null {
  const el = element_for_node(node);
  if (!el) return null;

  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el;
  }
  return null;
}

// ADDED: optional strictness helper (keep your current error style)
function throw_missing_el(node: HsonNode, source: string): never {
  const quid = node._meta?._quid ?? "<no-quid>";
  _throw_transform_err(
    `missing element for node (tag=${node._tag}, quid=${quid})`,
    source,
    make_string(node),
  );
}
export function get_node_text_content(node: HsonNode): string {
  let out = "";

  const walk = (n: HsonNode): void => {
    for (const child of n._content ?? []) {
      if (!is_Node(child)) continue;

      if (child._tag === STR_TAG || child._tag === VAL_TAG) {
        const first = child._content?.[0];
        if (typeof first === "string") out += first;
        continue;
      }

      walk(child);
    }
  };

  walk(node);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Form state: value / checked / selected
 * ---------------------------------------------------------------------------------------------- */



/**
 * Set a form value on the node and mirror it to the DOM when mounted.
 *
 * By default, missing DOM elements are ignored (attrs are canonical).
 *
 * @param node - The HSON node to update.
 * @param value - Form value string to store.
 * @param opts - Optional flags controlling missing DOM behavior.
 * @returns void.
 */
export function set_form_value(node: HsonNode, value: string, opts?: SetNodeFormOpts): void {
  const attrs = ensure_attrs(node);
  attrs.value = value;

  const el = form_el_for_node(node);
  if (!el) {
    if (opts?.strict) throw_missing_el(node, "setNodeFormValue");
    if (opts?.silent === false) throw_missing_el(node, "setNodeFormValue");
    return;
  }

  // CHANGED: always mirror when we can
  const ctl = resolve_form_control(el as Element);
  if (ctl) {
    ctl.value = value;
  }
}

/**
 * Read a form value, preferring DOM when mounted.
 *
 * @param node - The HSON node to read from.
 * @returns The current form value (empty string if missing).
 */
export function get_form_value(node: HsonNode): string {
  const el = element_for_node(node);
  if (el) {
    const ctl = resolve_form_control(el as Element);
    if (ctl) return ctl.value ?? "";
  }

  const attrs = (node._attrs as unknown as AttrDict | undefined);
  const raw = attrs?.value;
  return raw == null ? "" : String(raw);
}

/**
 * Set the checked state for checkbox/radio inputs and mirror to the DOM.
 *
 * @param node - The HSON node to update.
 * @param checked - New checked state.
 * @param opts - Optional flags controlling missing DOM behavior.
 * @returns void.
 */
export function set_input_checked(node: HsonNode, checked: boolean, opts?: SetNodeFormOpts): void {
  const attrs = ensure_attrs(node);
  attrs.checked = checked;

  const el = form_el_for_node(node);
  if (!el) {
    if (opts?.strict) throw_missing_el(node, "setNodeFormChecked");
    if (opts?.silent === false) throw_missing_el(node, "setNodeFormChecked");
    return;
  }

  if (el instanceof HTMLInputElement) {
    el.checked = checked;
  }
}

/**
 * Read the checked state for checkbox/radio inputs, preferring DOM when mounted.
 *
 * @param node - The HSON node to read from.
 * @returns True when checked, otherwise false.
 */
export function get_input_checked(node: HsonNode): boolean {
  const el = form_el_for_node(node);
  if (el instanceof HTMLInputElement) return !!el.checked;

  const attrs = (node._attrs as unknown as AttrDict | undefined);
  const raw = attrs?.checked;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw === "true";
  if (typeof raw === "number") return raw !== 0;
  return false;
}

/**
 * Set selected state for a <select>, mirroring to DOM when mounted.
 *
 * Storage:
 * - attrs.value: string (single select)
 * - attrs.values: readonly string[] (multi select)
 *
 * @param node - The HSON node to update.
 * @param selected - Selected value(s) for single or multi-select.
 * @param opts - Optional flags controlling missing DOM behavior.
 * @returns void.
 */
export function set_input_selected(
  node: HsonNode,
  selected: string | readonly string[],
  opts?: SetNodeFormOpts,
): void {
  const attrs = ensure_attrs(node);

  const isMany = Array.isArray(selected);
  if (isMany) {
    // ADDED: multi-select storage
    attrs.values = selected.slice();
    // optional: also set value to first for convenience
    attrs.value = selected[0] ?? "";
  } else {
    attrs.value = selected;
    // ADDED: keep values in sync if present
    attrs.values = [selected];
  }

  const el = form_el_for_node(node);
  if (!el) {
    if (opts?.strict) throw_missing_el(node, "setNodeFormSelected");
    if (opts?.silent === false) throw_missing_el(node, "setNodeFormSelected");
    return;
  }

  if (el instanceof HTMLSelectElement) {
    if (isMany) {
      const set = new Set(selected);
      for (const opt of Array.from(el.options)) {
        opt.selected = set.has(opt.value);
      }
    } else {
      el.value = String(selected);
    }
  } else {
    // If caller points this at a non-select, degrade to value semantics
    const v = isMany ? (selected[0] ?? "") : selected;
    if (el) el.value = v;
  }
}

/**
 * Read selected state from a <select>, preferring DOM when mounted.
 *
 * @param node - The HSON node to read from.
 * @returns The selected value string or array of values for multi-select.
 */
export function get_input_selected(node: HsonNode): string | readonly string[] {
  const el = form_el_for_node(node);

  if (el instanceof HTMLSelectElement) {
    if (el.multiple) {
      return Array.from(el.selectedOptions).map(o => o.value);
    }
    return el.value ?? "";
  }

  const attrs = (node._attrs as unknown as AttrDict | undefined);
  const values = attrs?.values;
  if (Array.isArray(values)) {
    return values.map(v => String(v));
  }

  const raw = attrs?.value;
  return raw == null ? "" : String(raw);
}
// -----------------------------------------------------------------------------//.. DOM helpers (CHANGED): project text leaves as *Text nodes*, never <_str>/< _val >
// -----------------------------------------------------------------------------

// CHANGED: was creating document.createElement("_str") which injects <_str> into DOM.
// Now: always create a Text node.
function make_dom_text(value: Primitive): Text {
  return document.createTextNode(value === null ? "" : String(value));
}

// CHANGED: remove direct child Text nodes (these represent projected text leaves).
// We do NOT touch element children, so non-leaf content remains.
function remove_dom_text_leaves(host: Element): void {
  const toRemove: ChildNode[] = [];

  for (const n of Array.from(host.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) toRemove.push(n);
  }

  for (const n of toRemove) host.removeChild(n);
}

// Optional helper if you want to *only* remove projected leaves inserted by us,
// but right now you’re projecting leaves as Text nodes only, so this is correct.

// -----------------------------------------------------------------------------//.. IR helpers
// -----------------------------------------------------------------------------

// If you don't already have an isLeafNode(tag) helper, this is safe and tiny.
// Uses your leaf tags invariant.
function isLeafTag(tag: unknown): boolean {
  return tag === "_str" || tag === "_val";
}

// -----------------------------------------------------------------------------//.. Text operations
// -----------------------------------------------------------------------------

/**
 * Replace ONLY the text leaves (_str/_val) under this node.
 * Keeps non-leaf content untouched.
 *
 * DOM: removes only direct Text children under the host element; keeps element children.
 */
export function set_node_text_content(node: HsonNode, value: Primitive): void {
  const leaf = make_leaf(value);

  // CHANGED: always edit inside the VSN bucket
  const bucket = ensureVsn(node);

  // CHANGED: remove only leaf nodes; keep everything else intact
  bucket._content = bucket._content.filter((c) => {
    if (!is_Node(c)) return true;               // if you truly never have non-nodes, fine
    return !isLeafTag(c._tag);                  // remove _str/_val only
  });

  // CHANGED: append exactly one new leaf
  bucket._content.push(leaf);

  // --- DOM projection (CHANGED): Text nodes only ---
  const host = element_for_node(node);
  if (!host) return;

  remove_dom_text_leaves(host);
  host.appendChild(make_dom_text(value));
}

/**
 * Append another text leaf to _content (non-destructive).
 *
 * DOM: appends a Text node to the host element.
 */
export function add_node_text_content(node: HsonNode, value: Primitive): void {
  const leaf = make_leaf(value);

  // CHANGED: always edit inside the VSN bucket
  const bucket = ensureVsn(node);
  bucket._content.push(leaf);

  const host = element_for_node(node);
  if (!host) return;

  host.appendChild(make_dom_text(value));
}

/**
 * Insert a text leaf at a specific _content index.
 * Index counts all items in the VSN bucket _content.
 *
 * DOM: attempts to insert among childNodes by index. This only stays “perfect”
 * if your DOM projection preserves 1:1 direct-child ordering for bucket._content.
 * If that's not guaranteed, prefer the safer approach in the comment below.
 */
export function insert_node_text_leaf(node: HsonNode, index: number, value: Primitive): void {
  const leaf = make_leaf(value);

  // CHANGED: always edit inside the VSN bucket
  const bucket = ensureVsn(node);

  const len = bucket._content.length;
  const ix = Number.isFinite(index)
    ? Math.max(0, Math.min(len, Math.floor(index)))
    : len;

  bucket._content.splice(ix, 0, leaf);

  const host = element_for_node(node);
  if (!host) return;

  const domText = make_dom_text(value);

  // NOTE: This assumes direct childNodes index aligns with bucket._content.
  // If that's not a safe invariant, replace this whole insertBefore block with:
  //   remove_dom_text_leaves(host); host.appendChild(make_dom_text(value));
  // or build a full reconciliation pass.
  const ref = host.childNodes.item(ix) ?? null;
  host.insertBefore(domText, ref);
}

/**
 * Destructive overwrite: replace ALL content with one leaf; mirror to DOM using textContent.
 *
 * This matches your old set_node_text_content semantics, but still respects VSN.
 */
export function overwrite_node_text_content(node: HsonNode, value: Primitive): void {
  const leaf = make_leaf(value);

  // CHANGED: always overwrite the VSN bucket, not node._content
  const bucket = ensureVsn(node);
  bucket._content = [leaf];

  const el = element_for_node(node);
  if (!el) return;

  (el as HTMLElement).textContent = value === null ? "" : String(value);
}