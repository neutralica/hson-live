import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { assert_mutation_publication_available, begin_mutation_publication } from "../lifecycle/mutation-publication.js";
import { content_target_for_owner, restore_dom_children, prepare_terminal_dom, capture_dom_placement } from "../lifecycle/mutation-dom.js";
import { qualify_owned_content, qualify_owned_structure, receiver_role } from "../lifecycle/mutation-qualification.js";
import { claim_node_parent } from "../lifecycle/graph-ownership.js";
import { bind_graph_runtime, release_nodes_runtime } from "../runtime/livetree-runtime.js";
import { get_dom_for_node, unlinkNode } from "../utils/node-map-helpers.js";
// text-form-values.ts

import { HsonNode } from "../../../core/types.js";
import { ELEM_OBJ_ARR, ELEM_TAG, STR_TAG, VAL_TAG } from "../../../core/constants.js";
import { is_Node } from "../../../core/node-guards.js";
import { get_el_for_node, get_node_for_el } from "../utils/node-map-helpers.js";
import { assert_livetree_node_active } from "../livetree-state.js";
import { make_leaf } from "../../transform/parsers/parse-tokens.js";
import { Primitive } from "../../../core/types.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { LiveTree } from "../livetree.js";
import { LiveFormApi } from "../../../types/livetree-internals.types.js";
import {
  delegate_document_text_mutation_if_bound,
  document_binding_for_node,
} from "../lifecycle/document-binding-state.js";
import { release_node_parent, release_subtree_ownership } from "../lifecycle/graph-ownership.js";
import { dispose_node_deep } from "../utils/dispose-node.js";
import { reconcile_browser_realization_children } from "../../../internal/browser-realization/browser-realization-dom.js";
import {
  notify_livetree_realizations_internal,
  default_livetree_runtime,
  runtime_for_node,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";

export type LiveTextApi<TOwner> = Readonly<{
  set: (value: Primitive) => TOwner;
  add: (value: Primitive) => TOwner;
  overwrite: (value: Primitive) => TOwner;
  insert: (ix: number, value: Primitive) => TOwner;
  get: () => string;
}>;

const isElemObjArr = (tag: string): boolean => ELEM_OBJ_ARR.includes(tag);

// Namespace/tag checks use the mapped element's realm, including detached and
// foreign-document controls. Never search descendants or realize a missing node.
function is_input(el: Element): el is HTMLInputElement {
  return el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.tagName.toLowerCase() === "input";
}
function is_textarea(el: Element): el is HTMLTextAreaElement {
  return el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.tagName.toLowerCase() === "textarea";
}
function is_select(el: Element): el is HTMLSelectElement {
  return el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.tagName.toLowerCase() === "select";
}
function require_form_element(node: HsonNode, operation: string): Element {
  const el = get_el_for_node(node);
  if (el === undefined) throw new Error(`LiveTree ${operation}: missing native control; realize it explicitly first.`);
  return el;
}
function unsupported_form_control(operation: string): never {
  throw new Error(`LiveTree ${operation}: unsupported native control.`);
}

// HTML input value modes: hidden/submit/image/reset/button use default mode;
// checkbox/radio use default/on mode. Their .value setters reflect the authored
// value attribute, so they cannot provide this current-only write contract.
// Native .type normalizes missing/unknown types to text.
function supports_current_value(input: HTMLInputElement): boolean {
  switch (input.type) {
    case "text": case "search": case "tel": case "url": case "email": case "password":
    case "date": case "month": case "week": case "time": case "datetime-local":
    case "number": case "range": case "color": case "file": return true;
    default: return false;
  }
}

function write_form_property(
  node: HsonNode,
  operation: string,
  prepare: (el: Element, assertCurrent: () => void) => () => void,
): void {
  assert_livetree_node_active(node, operation);
  const el = require_form_element(node, operation);
  const runtime = runtime_for_node(node);
  const assertCurrent = (): void => {
    assert_livetree_node_active(node, operation);
    if (runtime_for_node(node) !== runtime || get_el_for_node(node) !== el
      || get_node_for_el(el) !== node || get_dom_for_node(node) !== el) {
      throw new Error(`LiveTree ${operation}: native control correspondence changed during operation.`);
    }
  };
  // Keep one reservation across input capture, native qualification, planning
  // and assignment. These reads may invoke application getters or Proxy traps.
  const endPublication = begin_mutation_publication([node]);
  try {
    // Guard admission itself can read native placement. Revalidate its result,
    // then the prepared operation, using only existing lifecycle/map state.
    assertCurrent();
    const write = prepare(el, assertCurrent);
    assertCurrent();
    try { write(); }
    catch (cause) {
      // Canonical state is never written here. Browser-managed side effects of
      // an attempted property assignment are not a rollbackable transaction.
      throw new Error(`LiveTree ${operation}: native property assignment failed.`, { cause });
    }
    assertCurrent();
  } finally { endPublication(); }
}

// Own data descriptors capture primitives without invoking caller methods,
// iteration, species or indexed accessors. Reflection can throw, before writes.
function capture_selected(selected: unknown): string | string[] {
  if (typeof selected === "string") return selected;
  if (!Array.isArray(selected)) throw new TypeError("LiveTree form.setSelected: expected a primitive string or dense array of primitive strings.");
  let descriptors: Record<string, PropertyDescriptor>;
  try { descriptors = Object.getOwnPropertyDescriptors(selected); }
  catch (cause) { throw new TypeError("LiveTree form.setSelected: cannot capture array data descriptors.", { cause }); }
  const length: unknown = descriptors.length?.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > 0xffffffff) {
    throw new TypeError("LiveTree form.setSelected: invalid array length.");
  }
  // A Proxy can report a shorter length alongside additional indexed entries.
  // Reject inconsistent/sparse captures rather than letting length hide invalid
  // elements. Non-index properties (including custom methods) are never used.
  let entries = 0;
  for (const key of Object.keys(descriptors)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key) {
      if (index >= length) throw new TypeError("LiveTree form.setSelected: array indices exceed captured length.");
      entries++;
    }
  }
  if (entries !== length) throw new TypeError("LiveTree form.setSelected: sparse arrays are unsupported.");
  const owned: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.hasOwn(descriptors, index) ? descriptors[index] : undefined;
    const value: unknown = descriptor?.value;
    if (descriptor === undefined || !("value" in descriptor) || typeof value !== "string") {
      throw new TypeError("LiveTree form.setSelected: expected own string data entries; holes and accessors are unsupported.");
    }
    owned.push(value);
  }
  return owned;
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

/**
 * Standalone form writes belong exclusively to existing native controls.
 * Temporary Cut A asymmetry: document-bound scalars retain their governed
 * authored-attribute route, just like the async facade. Authority acceptance
 * must never be followed by a local missing-control rejection.
 */
export function set_form_value(node: HsonNode, value: string): void {
  assert_mutation_publication_available(node);
  if (typeof value !== "string") throw new TypeError("LiveTree form.setValue: expected a primitive string.");
  const binding = document_binding_for_node(node);
  if (binding !== undefined) {
    binding.delegateAttrs({ kind: "set", name: "value", value });
    return;
  }
  write_form_property(node, "form.setValue", el => {
    if (!(is_textarea(el) || is_select(el) || (is_input(el) && supports_current_value(el)))) {
      unsupported_form_control("form.setValue");
    }
    if (is_input(el) && el.type === "file" && value !== "") {
      throw new TypeError("LiveTree form.setValue: file inputs accept only the empty string for clearing.");
    }
    return () => { el.value = value; };
  });
}

export function get_form_value(node: HsonNode): string {
  const el = get_el_for_node(node);
  return el && (is_input(el) || is_textarea(el) || is_select(el)) ? el.value : "";
}

export function set_input_checked(node: HsonNode, checked: boolean): void {
  assert_mutation_publication_available(node);
  if (typeof checked !== "boolean") throw new TypeError("LiveTree form.setChecked: expected a primitive boolean.");
  const binding = document_binding_for_node(node);
  if (binding !== undefined) {
    binding.delegateAttrs({ kind: "set", name: "checked", value: checked });
    return;
  }
  write_form_property(node, "form.setChecked", el => {
    if (!is_input(el) || (el.type !== "checkbox" && el.type !== "radio")) unsupported_form_control("form.setChecked");
    return () => { el.checked = checked; };
  });
}

export function get_input_checked(node: HsonNode): boolean {
  const el = get_el_for_node(node);
  return el && is_input(el) ? el.checked : false;
}

export function set_input_selected(node: HsonNode, selected: string | readonly string[]): void {
  assert_mutation_publication_available(node);
  const binding = document_binding_for_node(node);
  if (binding !== undefined) binding.rejectStructuralMutation("form.setSelected");
  write_form_property(node, "form.setSelected", (el, assertCurrent) => {
    const owned = capture_selected(selected);
    if (!is_select(el)) unsupported_form_control("form.setSelected");
    if (typeof owned === "string") return () => { el.value = owned; };
    if (!el.multiple) throw new TypeError("LiveTree form.setSelected: arrays require a multiple select.");
    const values = new Set(owned);
    // Finish native target reads and the entire assignment plan before writing.
    const plan = Array.from(el.options, option => ({ option, selected: values.has(option.value) }));
    return () => {
      for (const item of plan) {
        assertCurrent();
        item.option.selected = item.selected;
      }
    };
  });
}

export function get_input_selected(node: HsonNode): string | readonly string[] {
  const el = get_el_for_node(node);
  if (!el || !is_select(el)) return "";
  return el.multiple ? Array.from(el.selectedOptions, option => option.value) : el.value;
}

export function make_form_api<TTree extends LiveTree>(tree: TTree): LiveFormApi<TTree> {
  return {
    setValue: value => { set_form_value(active_subject_for_tree(tree), value); return tree; },
    getValue: () => get_form_value(active_subject_for_tree(tree)),
    setChecked: value => { set_input_checked(active_subject_for_tree(tree), value); return tree; },
    getChecked: () => get_input_checked(active_subject_for_tree(tree)),
    setSelected: value => { set_input_selected(active_subject_for_tree(tree), value); return tree; },
    getSelected: () => get_input_selected(active_subject_for_tree(tree)),
  };
}

function primitive_to_text(value: Primitive): string {
  return value === null ? "" : String(value);
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
 * DOM: reconciles the shared browser realization, including Hson boundary markers.
 */
function mutate_text(node: HsonNode, value: Primitive, kind: "set" | "add" | "insert" | "overwrite", index = 0): void {
  if (delegate_document_text_mutation_if_bound(node, kind === "insert" ? { kind, value, index } : { kind, value })) return;
  qualify_owned_structure(node, receiver_role(node), "text." + kind);
  const leaf = make_leaf(primitive_to_text(value));
  const first = node.$_content[0];
  const existing = is_Node(first) && isElemObjArr(first.$_tag) ? first : undefined;
  const bucket = existing ?? CREATE_NODE({ $_tag: ELEM_TAG, $_content: [] });
  const previous = bucket.$_content;
  let next: HsonNode["$_content"];
  if (kind === "overwrite") next = [leaf];
  else if (kind === "add") next = [...previous, leaf];
  else if (kind === "insert") {
    const at = Number.isFinite(index) ? Math.max(0, Math.min(previous.length, Math.floor(index))) : previous.length;
    next = [...previous.slice(0, at), leaf, ...previous.slice(at)];
  } else {
    const at = previous.findIndex(child => is_Node(child) && isLeafTag(child.$_tag));
    const kept = previous.filter(child => !is_Node(child) || !isLeafTag(child.$_tag));
    const insertion = at < 0 ? 0 : at;
    next = [...kept.slice(0, insertion), leaf, ...kept.slice(insertion)];
  }
  qualify_owned_content(node, [{ $_tag: bucket.$_tag, $_content: next }], "text." + kind);
  const runtime = runtime_for_node(node) ?? default_livetree_runtime();
  const displaced = previous.filter((item): item is HsonNode => is_Node(item) && !next.includes(item));
  const prior = node.$_content, element = content_target_for_owner(node);
  const oldDom = element ? Array.from(element.childNodes) : [];
  let restoreDisplaced: (() => void) | undefined;
  const placement = capture_dom_placement(displaced.flatMap(root => collect_subtree_nodes(root, "pre")));
  const endPublication = begin_mutation_publication([node, bucket, leaf], [...placement.containers, ...(element ? [element] : [])]);
  try {
    try {
      restoreDisplaced = prepare_terminal_dom(displaced);
      bucket.$_content = next;
      if (!existing) node.$_content = [bucket];
      if (element) reconcile_browser_realization_children(node, runtime);
      if (!existing) claim_node_parent(bucket, node);
      claim_node_parent(leaf, bucket);
      bind_graph_runtime(bucket, runtime);
    } catch (cause) {
      bucket.$_content = previous; node.$_content = prior;
      restoreDisplaced?.();
      if (element) restore_dom_children(element, oldDom);
      get_dom_for_node(leaf)?.parentNode?.removeChild(get_dom_for_node(leaf)!); unlinkNode(leaf);
      release_node_parent(leaf, bucket);
      if (!existing) release_node_parent(bucket, node);
      release_nodes_runtime(existing ? [leaf] : [leaf, bucket], runtime);
      throw cause;
    }
    for (const root of displaced) {
      release_node_parent(root, bucket);
      dispose_node_deep(root, runtime, false, true); release_subtree_ownership(root);
    }
  } finally { endPublication(); }
  if (element) notify_livetree_realizations_internal(runtime);
}

export function set_node_text_content(node: HsonNode, value: Primitive): void { mutate_text(node, value, "set"); }
export function add_node_text_content(node: HsonNode, value: Primitive): void { mutate_text(node, value, "add"); }
export function insert_node_text_leaf(node: HsonNode, index: number, value: Primitive): void { mutate_text(node, value, "insert", index); }
export function overwrite_node_text_content(node: HsonNode, value: Primitive): void { mutate_text(node, value, "overwrite"); }

export function make_text_api<TTree extends LiveTree>(
    tree: TTree,
): LiveTextApi<TTree> {
    return {
        set: (value) => {
            set_node_text_content(active_subject_for_tree(tree), value);
            return tree;
        },
        add: (value) => {
            add_node_text_content(active_subject_for_tree(tree), value);
            return tree;
        },
        overwrite: (value) => {
            overwrite_node_text_content(active_subject_for_tree(tree), value);
            return tree;
        },
        insert: (ix, value) => {
            insert_node_text_leaf(active_subject_for_tree(tree), ix, value);
            return tree;
        },
        get: () => {
            return get_node_text_content(active_subject_for_tree(tree));
        },
    };
}
