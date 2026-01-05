// content.ts

import { HsonAttrs, HsonNode } from "../../../types-consts/node.types";
import { STR_TAG } from "../../../types-consts/constants";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { make_string } from "../../../utils/primitive-utils/make-string.nodes.utils";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { make_leaf } from "../../parsers/parse-tokens.new.transform";
import { Primitive } from "../../../types-consts/core.types";

/* ------------------------------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------------------------- */

// treat _attrs as a simple dictionary
type AttrDict = Record<string, unknown>;
// central DOM form-control narrowing
type FormEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

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

/* ------------------------------------------------------------------------------------------------
 * Text/content (unchanged, but note the same "mounted vs not" question applies here too)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Replace a node's content with a single text leaf and mirror it to the DOM.
 *
 * @param node - The HSON node to update.
 * @param value - Primitive value to render as text (null becomes empty string).
 * @returns void.
 */
export function set_node_content(node: HsonNode, value: Primitive): void {
  const leaf = make_leaf(value);
  node._content = [leaf];

  const el = element_for_node(node);
  if (!el) {
    // NOTE: you may eventually want to make this non-throwing like forms.
    // Leaving as-is because you asked to focus on form/input first.
    throw_missing_el(node, "setNodeContent");
  }

  (el as HTMLElement).textContent = value === null ? "" : String(value);
}

/**
 * Read concatenated text content under a node, preferring DOM when mounted.
 *
 * @param node - The HSON node to read from.
 * @returns The concatenated text content.
 */
export function get_node_text(node: HsonNode): string {
  const el = element_for_node(node);
  if (el) return el.textContent ?? "";

  let out = "";
  const seen = new Set<HsonNode>(); // ADDED

  const walk = (n: HsonNode): void => {
    if (seen.has(n)) return;        // ADDED
    seen.add(n);                    // ADDED

    const content = n._content ?? [];
    for (const child of content) {
      if (!is_Node(child)) continue;

      if (child._tag === STR_TAG) {
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
 * Options for form state writers that mirror to the DOM when available.
 */
export type SetNodeFormOpts = Readonly<{
  // CHANGED: default should be "silent" (missing DOM is normal pre-mount)
  silent?: boolean;

  // ADDED: for callers that want the old strict behavior
  strict?: boolean;
}>;

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
export function set_node_form_value(node: HsonNode, value: string, opts?: SetNodeFormOpts): void {
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
export function get_node_form_value(node: HsonNode): string {
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
export function set_node_form_checked(node: HsonNode, checked: boolean, opts?: SetNodeFormOpts): void {
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
export function get_node_form_checked(node: HsonNode): boolean {
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
export function set_node_form_selected(
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
export function get_node_form_selected(node: HsonNode): string | readonly string[] {
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
