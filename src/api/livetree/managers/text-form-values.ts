// text-form-values.ts

import { HsonAttrs, HsonNode } from "../../../core/types.js";
import { ELEM_OBJ_ARR, ELEM_TAG, LEAF_NODES, STR_TAG, VAL_TAG } from "../../../core/constants.js";
import { is_Node } from "../../../core/node-guards.js";
import { make_string } from "../../../core/stringify.js";
import { _throw_transform_err } from "../../transform/utils/sys-utils/throw-transform-err.utils.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { make_leaf } from "../../transform/parsers/parse-tokens.js";
import { Primitive } from "../../../core/types.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { LiveTree } from "../livetree.js";
import { LiveFormApi } from "../../../types/livetree-internals.types.js";
import { ensure_node_attrs } from "../../../core/node-storage.js";
import { delegate_document_text_mutation_if_bound } from "../lifecycle/document-binding-state.js";

/**
 * Options for form state writers that mirror to the DOM when available.
 */
export type SetNodeFormOpts = Readonly<{
  // default should be "silent" (missing DOM is normal pre-mount)
  silent?: boolean;

  // for callers that want the old strict behavior
  strict?: boolean;
}>;

export type LiveTextApi<TOwner> = Readonly<{
  set: (value: Primitive) => TOwner;
  add: (value: Primitive) => TOwner;
  overwrite: (value: Primitive) => TOwner;
  insert: (ix: number, value: Primitive) => TOwner;
  get: () => string;
}>;

// treat $_attrs as a simple dictionary
type AttrDict = Record<string, unknown>;
// central DOM form-control narrowing
type FormEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/* ------------------------------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------------------------- */
// leaf tags

// const isLeafNode = (tag: string): boolean => LEAF_NODES.includes(tag);
const isElemObjArr = (tag: string): boolean => ELEM_OBJ_ARR.includes(tag);
function ensureVsn(node: HsonNode): HsonNode {
  // find first VSN child
  const found = node.$_content.find((c): c is HsonNode => is_Node(c) && isElemObjArr(c.$_tag));
  if (found) return found;

  // create bucket; prefer `_hson_elem` as the generic container
  const bucket = CREATE_NODE({
    $_tag: ELEM_TAG,
    $_content: node.$_content, // move existing content under the bucket
  });

  node.$_content = [bucket];
  return bucket;
}

// function make_dom_leaf(_leaf: HsonNode, value: Primitive): Text {
//   return document.createTextNode(value === null ? "" : String(value));
// }

function ensure_attrs(node: HsonNode): AttrDict {
  return ensure_node_attrs(node) as unknown as AttrDict;
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
  const el = get_el_for_node(node);
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

// optional strictness helper 
function throw_missing_el(node: HsonNode, source: string): never {
  const quid = node.$_meta?._quid ?? "<no-quid>";
  _throw_transform_err(
    `missing element for node (tag=${node.$_tag}, quid=${quid})`,
    source,
    make_string(node),
  );
}
export function get_node_text_content(node: HsonNode): string {
  let out = "";

  const walk = (n: HsonNode): void => {
    for (const child of n.$_content ?? []) {
      if (!is_Node(child)) {
        if (child !== null && child !== undefined) out += String(child);
        continue;
      }

      if (child.$_tag === STR_TAG || child.$_tag === VAL_TAG) {
        const first = child.$_content?.[0];
        if (first !== null && first !== undefined) out += String(first);
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

  // always mirror when we can
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
  const el = get_el_for_node(node);
  if (el) {
    const ctl = resolve_form_control(el as Element);
    if (ctl) return ctl.value ?? "";
  }

  const attrs = (node.$_attrs as unknown as AttrDict | undefined);
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

  const attrs = (node.$_attrs as unknown as AttrDict | undefined);
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
    // multi-select storage
    attrs.values = selected.slice();
    // optional: also set value to first for convenience
    attrs.value = selected[0] ?? "";
  } else {
    attrs.value = selected;
    // keep values in sync if present
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

  const attrs = (node.$_attrs as unknown as AttrDict | undefined);
  const values = attrs?.values;
  if (Array.isArray(values)) {
    return values.map(v => String(v));
  }

  const raw = attrs?.value;
  return raw == null ? "" : String(raw);
}

export function make_form_api<TTree extends LiveTree>(
    tree: TTree,
): LiveFormApi<TTree> {
    return {
        setValue: (value, opts) => {
            set_form_value(tree.node, value, opts);
            return tree;
        },

        getValue: () => {
            return get_form_value(tree.node);
        },

        getChecked: () => {
            return get_input_checked(tree.node);
        },

        setChecked: (value, opts) => {
            set_input_checked(tree.node, value, opts);
            return tree;
        },

        getSelected: () => {
            return get_input_selected(tree.node);
        },

        setSelected: (value, opts) => {
            set_input_selected(tree.node, value, opts);
            return tree;
        },
    };
}

// -----------------------------------------------------------------------------
// //.. DOM helpers: project text leaves as *Text nodes*, never <_hson_str>/< _hson_val >
// -----------------------------------------------------------------------------

function primitive_to_text(value: Primitive): string {
  return value === null ? "" : String(value);
}

// was creating document.createElement("_hson_str") which injects <_hson_str> into DOM.
// Now: always create a Text node.
function make_dom_text(value: Primitive): Text {
  return document.createTextNode(primitive_to_text(value));
}

// remove direct child Text nodes (these represent projected text leaves).
// We do NOT touch element children, so non-leaf content remains.
function remove_dom_text_leaves(host: Element): void {
  const toRemove: ChildNode[] = [];

  for (const n of Array.from(host.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) toRemove.push(n);
  }

  for (const n of toRemove) host.removeChild(n);
}

function replace_dom_text_leaves(host: Element, value: Primitive): void {
  const nodes = Array.from(host.childNodes);
  const firstTextIndex = nodes.findIndex((n) => n.nodeType === Node.TEXT_NODE);

  remove_dom_text_leaves(host);

  const refIndex = firstTextIndex >= 0 ? firstTextIndex : 0;
  const ref = host.childNodes.item(refIndex) ?? null;
  host.insertBefore(make_dom_text(value), ref);
}


// -----------------------------------------------------------------------------//.. IR helpers
// -----------------------------------------------------------------------------


function isLeafTag(tag: unknown): boolean {
  return tag === STR_TAG || tag === VAL_TAG;
}

// -----------------------------------------------------------------------------//.. Text operations
// -----------------------------------------------------------------------------

/**
 * Replace ONLY the text leaves (_hson_str/_hson_val) under this node.
 * Keeps non-leaf content untouched.
 *
 * DOM: removes only direct Text children under the host element; keeps element children.
 */
export function set_node_text_content(node: HsonNode, value: Primitive): void {
  if (delegate_document_text_mutation_if_bound(node, { kind: "set", value })) return;
  const text = primitive_to_text(value);
  const leaf = make_leaf(text);

  // always edit inside the VSN bucket
  const bucket = ensureVsn(node);

  let replaced = false;
  const next = [] as typeof bucket.$_content;

  for (const child of bucket.$_content) {
    if (is_Node(child) && isLeafTag(child.$_tag)) {
      if (!replaced) {
        next.push(leaf);
        replaced = true;
      }
      continue;
    }

    next.push(child);
  }

  if (!replaced) next.unshift(leaf);
  bucket.$_content = next;

  // --- DOM projection (CHANGED): Text nodes only ---
  const host = get_el_for_node(node);
  if (!host) return;

  replace_dom_text_leaves(host, text);
}

/**
 * Append another text leaf to $_content (non-destructive).
 *
 * DOM: appends a Text node to the host element.
 */
export function add_node_text_content(node: HsonNode, value: Primitive): void {
  if (delegate_document_text_mutation_if_bound(node, { kind: "add", value })) return;
  const text = primitive_to_text(value);
  const leaf = make_leaf(text);

  // always edit inside the VSN bucket
  const bucket = ensureVsn(node);
  bucket.$_content.push(leaf);

  const host = get_el_for_node(node);
  if (!host) return;

  host.appendChild(make_dom_text(text));
}

/**
 * Insert a text leaf at a specific $_content index.
 * Index counts all items in the VSN bucket $_content.
 */
export function insert_node_text_leaf(node: HsonNode, index: number, value: Primitive): void {
  if (delegate_document_text_mutation_if_bound(node, { kind: "insert", index, value })) return;
  const text = primitive_to_text(value);
  const leaf = make_leaf(text);

  // always edit inside the VSN bucket
  const bucket = ensureVsn(node);

  const len = bucket.$_content.length;
  const ix = Number.isFinite(index)
    ? Math.max(0, Math.min(len, Math.floor(index)))
    : len;

  bucket.$_content.splice(ix, 0, leaf);

  const host = get_el_for_node(node);
  if (!host) return;

  const domText = make_dom_text(text);
  const ref = host.childNodes.item(ix) ?? null;
  host.insertBefore(domText, ref);
}

/**
 * Destructive overwrite: replace ALL content with one leaf; mirror to DOM using textContent.
 */
export function overwrite_node_text_content(node: HsonNode, value: Primitive): void {
  if (delegate_document_text_mutation_if_bound(node, { kind: "overwrite", value })) return;
  const text = primitive_to_text(value);
  const leaf = make_leaf(text);

  // always overwrite the VSN bucket, not node.$_content
  const bucket = ensureVsn(node);
  bucket.$_content = [leaf];

  const el = get_el_for_node(node);
  if (!el) return;

  (el as HTMLElement).textContent = text;
}

export function make_text_api<TTree extends LiveTree>(
    tree: TTree,
): LiveTextApi<TTree> {
    return {
        set: (value) => {
            set_node_text_content(tree.node, value);
            return tree;
        },
        add: (value) => {
            add_node_text_content(tree.node, value);
            return tree;
        },
        overwrite: (value) => {
            overwrite_node_text_content(tree.node, value);
            return tree;
        },
        insert: (ix, value) => {
            insert_node_text_leaf(tree.node, ix, value);
            return tree;
        },
        get: () => {
            return get_node_text_content(tree.node);
        },
    };
}
