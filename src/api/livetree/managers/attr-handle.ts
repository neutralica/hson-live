import { assert_mutation_publication_available, begin_mutation_publication } from "../lifecycle/mutation-publication.js";
import { SVG_TAGS } from "../../../core/all-html-tags.js";
import { HSON_META_MARKUP_PREFIX } from "../../../core/constants.js";
import { clone_node } from "../../../core/clone-node.js";
import {
  canonical_public_attrs_equal,
  decode_public_attrs,
  decode_public_attr_value,
  is_public_attr_name,
} from "../../../core/public-attrs.js";
import {
  canonical_attr_is_flag,
  plan_public_attr_drop,
  plan_public_attr_set,
  plan_public_attrs_clear,
  plan_public_attrs_drop_many,
  plan_public_attrs_replace,
  plan_public_attrs_set_many,
  plan_public_flags_clear,
  plan_public_flags_set,
} from "../../../core/public-attr-transitions.js";
import type {
  CanonicalPublicAttrs,
  CanonicalPublicAttrValue,
  HsonNode,
} from "../../../core/types.js";
import type { AttrHandle, FlagHandle } from "../../../types/attrs.types.js";
import type { SvgTag } from "../../../types/livetree.types.js";
import {
  canonical_svg_attr_name,
} from "../../transform/utils/html-utils/parse_html_attrs.js";
import {
  LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
  LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE,
  LiveTreeAttributeError,
} from "../livetree.error.js";
import type { LiveTree } from "../livetree.js";
import { get_dom_for_node, get_el_for_node, get_node_for_el } from "../utils/node-map-helpers.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { get_quid, HSON_QUID_MARKUP_NAME } from "../quid/data-quid.js";
import {
  runtime_for_node,
  runtime_for_tree,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";
import { lower_browser_attribute_value } from "../../../internal/browser-realization/browser-realization-plan.js";
import { restore_dom_attrs } from "../lifecycle/mutation-dom.js";
import { receiver_role } from "../lifecycle/mutation-qualification.js";
import { qualify_exact_hson_graph } from "../../../internal/exact-node-qualification.js";

const UNASSIGNED_QUID_DIAGNOSTIC = "<unassigned>";

function canonical_attr_key<TTree extends LiveTree>(tree: TTree, name: string): string {
  const lower = name.toLowerCase();
  return tree.svg.inScope() ? canonical_svg_attr_name(name) : lower;
}

function svg_attr_key_from_node_tag(node: HsonNode, name: string): string {
  const lower = name.toLowerCase();
  return SVG_TAGS.includes(node.$_tag as SvgTag) ? canonical_svg_attr_name(name) : lower;
}

export function attr_handle<TTree extends LiveTree>(tree: TTree): AttrHandle<TTree> {
  const must = Object.freeze({
    get: (name: string): CanonicalPublicAttrValue => {
      const key = normalize_livetree_attr_name(tree, name, "must.get");
      const value = read_canonical_attr(tree, key, "must.get");
      if (value === undefined) {
        throw new LiveTreeAttributeError(
          LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
          "must.get",
          diagnostic_quid(tree),
          `ordinary attribute ${JSON.stringify(key)} is absent`,
          { attributeName: key },
        );
      }
      return value;
    },
  });

  return Object.freeze({
    get: (name) => {
      const key = normalize_livetree_attr_name(tree, name, "get");
      return read_canonical_attr(tree, key, "get");
    },
    must,
    has: (name) => {
      const key = normalize_livetree_attr_name(tree, name, "has");
      return has_attr(active_subject_for_tree(tree), key);
    },
    keys: () => Object.freeze(read_attr_keys(active_subject_for_tree(tree))),
    set: (name, value) => mutate_attrs(tree, (node, assertCurrent) => {
      const key = normalize_livetree_attr_name(tree, name, "set");
      const decoded = normalize_livetree_attr_value(tree, key, value, "set");
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "set", name: key, value: decoded });
        return tree;
      }
      const current = read_attrs(tree, "set");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_attr_set(current, key, decoded));
    }),
    setMany: (values) => mutate_attrs(tree, (node, assertCurrent) => {
      const additions = normalize_livetree_attrs_input(tree, values, "setMany");
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "setMany", values: additions });
        return tree;
      }
      const current = read_attrs(tree, "setMany");
      return apply_attrs_replacement(
        tree, node, assertCurrent,
        current,
        plan_public_attrs_set_many(current, additions),
      );
    }),
    drop: (name) => mutate_attrs(tree, (node, assertCurrent) => {
      const key = normalize_livetree_attr_name(tree, name, "drop");
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "drop", name: key });
        return tree;
      }
      const current = read_attrs(tree, "drop");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_attr_drop(current, key));
    }),
    dropMany: (names) => mutate_attrs(tree, (node, assertCurrent) => {
      const normalized = normalize_livetree_drop_names(tree, names, "dropMany");
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "dropMany", names: normalized });
        return tree;
      }
      const current = read_attrs(tree, "dropMany");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_attrs_drop_many(current, normalized));
    }),
    clear: () => mutate_attrs(tree, (node, assertCurrent) => {
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "clear" });
        return tree;
      }
      const current = read_attrs(tree, "clear");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_attrs_clear());
    }),
    replace: (values) => mutate_attrs(tree, (node, assertCurrent) => {
      const next = normalize_livetree_attrs_input(tree, values, "replace");
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "replace", values: next });
        return tree;
      }
      const current = read_attrs(tree, "replace");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_attrs_replace(next));
    }),
  });
}

/** Apply one canonical attrs final state without consulting public binding delegation. */
export function apply_projected_attrs_replacement(
  node: HsonNode,
  values: CanonicalPublicAttrs,
  nativeIdentity?: Readonly<{ quid: string | undefined }>,
): void {
  const next = decode_public_attrs(values);
  const current = decode_public_attrs(node.$_attrs ?? {});
  if (next === undefined || current === undefined) {
    throw new Error("LiveTree projected attrs replacement requires canonical attrs.");
  }
  if (!canonical_public_attrs_equal(current, next)) {
    if (Object.keys(next).length === 0) delete node.$_attrs;
    else node.$_attrs = clone_node(next);
    project_attrs_replacement(node, current, next);
  }
  // Native identity is a derived projection, independent of public attrs. Only
  // the bound owner supplies this request after proving accepted CSS demand.
  if (nativeIdentity !== undefined) {
    const element = get_el_for_node(node);
    if (element !== undefined && element.getAttribute(HSON_QUID_MARKUP_NAME) !== (nativeIdentity.quid ?? null)) {
      if (nativeIdentity.quid === undefined) element.removeAttribute(HSON_QUID_MARKUP_NAME);
      else element.setAttribute(HSON_QUID_MARKUP_NAME, nativeIdentity.quid);
    }
  }
}

export function flag_handle<TTree extends LiveTree>(tree: TTree): FlagHandle<TTree> {
  return Object.freeze({
    has: (name) => {
      const key = normalize_livetree_attr_name(tree, name, "flags.has");
      const current = read_attrs(tree, "flags.has");
      return canonical_attr_is_flag(current, key);
    },
    set: (...names): TTree => mutate_attrs(tree, (node, assertCurrent) => {
      const normalized = normalize_livetree_flag_names(tree, names, "flags.set", true);
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({ kind: "setMany", values: livetree_flag_values(normalized) });
        return tree;
      }
      const current = read_attrs(tree, "flags.set");
      return apply_attrs_replacement(tree, node, assertCurrent, current, plan_public_flags_set(current, normalized));
    }),
    clear: (...names): TTree => mutate_attrs(tree, (node, assertCurrent) => {
      const normalized = normalize_livetree_flag_names(tree, names, "flags.clear", true);
      assertCurrent();
      const binding = document_binding_for_node(node);
      if (binding !== undefined) {
        binding.delegateAttrs({
          kind: "transform",
          apply: (current) => ({
            kind: "dropMany",
            names: normalized.filter((name) => canonical_attr_is_flag(current, name)),
          }),
        });
        return tree;
      }
      const current = read_attrs(tree, "flags.clear");
      const next = plan_public_flags_clear(current, normalized);
      return apply_attrs_replacement(tree, node, assertCurrent, current, next);
    }),
  });
}

/** Apply an owned, qualified patch without renormalizing existing names. @internal */
export function patchAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  changes: ReadonlyMap<string, CanonicalPublicAttrValue | undefined>,
): TTree {
  const plan = (current: CanonicalPublicAttrs): CanonicalPublicAttrs => {
    const next: Record<string, CanonicalPublicAttrValue> = { ...current };
    for (const [name, value] of changes) {
      if (value === undefined) delete next[name];
      else next[name] = value;
    }
    return plan_public_attrs_replace(next);
  };
  return mutate_attrs(tree, (node, assertCurrent) => {
    assertCurrent();
    const binding = document_binding_for_node(node);
    if (binding !== undefined) {
      binding.delegateAttrs({
        kind: "transform",
        apply: (current) => ({ kind: "replace", values: plan(current) }),
      });
      return tree;
    }
    const current = decode_public_attrs(node.$_attrs ?? {});
    if (current === undefined) {
      throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, "data.setMany", undefined, "stored attrs are not canonical");
    }
    return apply_attrs_replacement(tree, node, assertCurrent, current, plan(current));
  });
}

/** Canonical single-value writer retained for existing internal managers. */
export function setAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  name: string,
  value: CanonicalPublicAttrValue,
): TTree;
export function setAttrsImpl<TTree extends LiveTree>(tree: TTree, values: CanonicalPublicAttrs): TTree;
export function setAttrsImpl<TTree extends LiveTree>(
  tree: TTree,
  nameOrValues: string | CanonicalPublicAttrs,
  value?: CanonicalPublicAttrValue,
): TTree {
  if (typeof nameOrValues === "string") {
    return Reflect.apply(tree.attrs.set, tree.attrs, [nameOrValues, value]);
  }
  return tree.attrs.setMany(nameOrValues);
}

export function removeAttrImpl<TTree extends LiveTree>(tree: TTree, name: string): TTree {
  return tree.attrs.drop(name);
}

export function getAttrImpl(tree: LiveTree, name: string): CanonicalPublicAttrValue | undefined {
  return tree.attrs.get(name);
}

export function readAttrFromNode(
  node: HsonNode,
  name: string,
): CanonicalPublicAttrValue | undefined {
  const key = svg_attr_key_from_node_tag(node, name);
  if (!has_attr(node, key)) return undefined;
  return decode_public_attr_value(key, node.$_attrs?.[key]);
}

export function hasAttrImpl(tree: LiveTree, name: string): boolean {
  return tree.attrs.has(name);
}

function read_canonical_attr(
  tree: LiveTree,
  key: string,
  operation: string,
): CanonicalPublicAttrValue | undefined {
  if (!has_attr(active_subject_for_tree(tree), key)) return undefined;
  const decoded = decode_public_attr_value(key, active_subject_for_tree(tree).$_attrs?.[key]);
  if (decoded !== undefined) return decoded;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, key, "stored value is not canonical");
}

function has_attr(node: HsonNode, key: string): boolean {
  const attrs = node.$_attrs;
  return attrs !== undefined
    && Object.prototype.hasOwnProperty.call(attrs, key);
}

function read_attr_keys(node: HsonNode): string[] {
  return Object.keys(node.$_attrs ?? {})
    .filter(is_public_attr_name)
    .sort();
}

function read_attrs(tree: LiveTree, operation: string): CanonicalPublicAttrs {
  const input: Record<string, unknown> = {};
  for (const name of read_attr_keys(active_subject_for_tree(tree))) input[name] = active_subject_for_tree(tree).$_attrs?.[name];
  const attrs = decode_public_attrs(input);
  if (attrs !== undefined) return attrs;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, undefined, "stored attrs are not canonical");
}

/** @internal Shared exact document-authoring normalization. */
export function normalize_livetree_attr_name(tree: LiveTree, input: unknown, operation: string): string {
  if (typeof input !== "string") {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, undefined, "name must be a string");
  }
  const key = canonical_attr_key(tree, input);
  if (key.startsWith(HSON_META_MARKUP_PREFIX)) {
    throw attr_error(tree, LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE, operation, key, "system metadata is protected");
  }
  if (!is_public_attr_name(key)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, key, "name is not a canonical bare Hson name");
  }
  return key;
}

/** @internal Shared exact document-authoring normalization. */
export function normalize_livetree_attr_value(
  tree: LiveTree,
  name: string,
  input: unknown,
  operation: string,
): CanonicalPublicAttrValue {
  const value = decode_public_attr_value(name, input);
  if (value !== undefined) return value;
  throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, name, "value is not canonical");
}

/** @internal Shared exact document-authoring normalization. */
export function normalize_livetree_attrs_input(tree: LiveTree, input: unknown, operation: string): CanonicalPublicAttrs {
  if (!is_plain_record(input)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE, operation, undefined, "values must be an ordinary-attribute bag");
  }
  const normalized: Record<string, CanonicalPublicAttrValue> = {};
  const entries = Object.entries(input);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const [inputName, inputValue] = entry;
    try {
      const name = normalize_livetree_attr_name(tree, inputName, operation);
      normalized[name] = normalize_livetree_attr_value(tree, name, inputValue, operation);
    } catch (cause) {
      if (cause instanceof LiveTreeAttributeError) {
        throw new LiveTreeAttributeError(cause.code, operation, cause.quid, cause.reason, {
          attributeName: cause.attributeName,
          inputIndex: index,
        });
      }
      throw cause;
    }
  }
  return normalize_attrs_result(normalized);
}

function normalize_attrs_result(input: Readonly<Record<string, CanonicalPublicAttrValue>>): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(input);
  if (attrs === undefined) throw new Error("LiveTree attrs planner produced an invalid canonical bag");
  return attrs;
}

/** @internal Shared exact document-authoring normalization. */
export function normalize_livetree_drop_names(tree: LiveTree, input: unknown, operation: string): readonly string[] {
  if (!Array.isArray(input)) {
    throw attr_error(tree, LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, operation, undefined, "names must be an array");
  }
  return Object.freeze(input.map((name, index) => {
    try {
      return normalize_livetree_attr_name(tree, name, operation);
    } catch (cause) {
      if (cause instanceof LiveTreeAttributeError) {
        throw new LiveTreeAttributeError(cause.code, operation, cause.quid, cause.reason, {
          attributeName: cause.attributeName,
          inputIndex: index,
        });
      }
      throw cause;
    }
  }));
}

/** Pin standalone authority across input capture, native staging and recovery.
 * Bound mutations keep LiveMap's acceptance and Mirror's failure lifecycle. */
function mutate_attrs<TTree extends LiveTree>(
  tree: TTree,
  apply: (node: HsonNode, assertCurrent: () => void) => TTree,
): TTree {
  const node = active_subject_for_tree(tree);
  const runtime = runtime_for_node(node), element = get_el_for_node(node);
  const binding = document_binding_for_node(node);
  const assertCurrent = (): void => {
    if (active_subject_for_tree(tree) !== node || runtime_for_node(node) !== runtime
      || document_binding_for_node(node) !== binding || get_el_for_node(node) !== element
      || (element !== undefined && (get_node_for_el(element) !== node || get_dom_for_node(node) !== element))) {
      throw new Error("LiveTree attrs: subject or native correspondence changed during operation.");
    }
  };
  assert_mutation_publication_available(node);
  assertCurrent();
  if (binding !== undefined) return apply(node, assertCurrent);
  const endPublication = begin_mutation_publication([node]);
  try {
    assertCurrent();
    return apply(node, assertCurrent);
  } finally { endPublication(); }
}

function apply_attrs_replacement<TTree extends LiveTree>(
  tree: TTree,
  node: HsonNode,
  assertCurrent: () => void,
  current: CanonicalPublicAttrs,
  next: CanonicalPublicAttrs,
): TTree {
  assertCurrent();
  if (canonical_public_attrs_equal(current, next)) return tree;

  // Own and qualify the complete candidate using the existing contextual
  // admission policy. Neither preparation nor native staging installs it.
  const candidate = clone_node(node);
  if (Object.keys(next).length === 0) delete candidate.$_attrs;
  else candidate.$_attrs = clone_node(next);
  qualify_exact_hson_graph(candidate, "attrs replacement", receiver_role(node), true);
  const element = get_el_for_node(node);
  if (element !== undefined) {
    const attrs: [string, string][] = [];
    for (const name of element.getAttributeNames()) {
      assertCurrent();
      const value = element.getAttribute(name);
      assertCurrent();
      if (value !== null) attrs.push([name, value]);
    }
    assertCurrent();
    try {
      realize_attrs_replacement(element, current, next, assertCurrent);
      assertCurrent();
    } catch (cause) {
      try {
        // Restore this exact native element through its owning realm, keeping
        // listeners and identity. Browser/application side effects are not a
        // transaction and are not represented as canonical acceptance.
        restore_dom_attrs(element, attrs);
        assertCurrent();
      } catch (restorationFailure) {
        throw new AggregateError([cause, restorationFailure],
          "LiveTree attrs: native realization failed and native restoration failed.", { cause });
      }
      throw cause;
    }
  }
  assertCurrent();
  if (candidate.$_attrs === undefined) delete node.$_attrs;
  else node.$_attrs = candidate.$_attrs;
  return tree;
}

function project_attrs_replacement(
  node: HsonNode,
  current: CanonicalPublicAttrs,
  next: CanonicalPublicAttrs,
): void {
  const element = get_el_for_node(node);
  if (element !== undefined) realize_attrs_replacement(element, current, next);
}

function realize_attrs_replacement(
  element: Element,
  current: CanonicalPublicAttrs,
  next: CanonicalPublicAttrs,
  assertCurrent: () => void = () => {},
): void {
  // Author defaults through native attribute reflection; do not force dirty
  // current form properties after writing authored attributes.
  const namespace = element.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : "html";
  for (const [name, value] of Object.entries(current)) {
    assertCurrent();
    if (!Object.prototype.hasOwnProperty.call(next, name)) {
      element.removeAttribute(lower_browser_attribute_value(name, value, namespace)?.name ?? name);
    }
  }
  for (const [name, value] of Object.entries(next)) {
    assertCurrent();
    const lowered = lower_browser_attribute_value(name, value, namespace);
    if (lowered === undefined) element.removeAttribute(name);
    else element.setAttribute(lowered.name, lowered.value);
    assertCurrent();
  }
}

/** @internal Shared exact document-authoring normalization. */
export function normalize_livetree_flag_names(
  tree: LiveTree,
  names: readonly string[],
  operation: string,
  rejectStyle: boolean,
): readonly string[] {
  const normalized = names.map((name, index) => {
    try {
      const key = normalize_livetree_attr_name(tree, name, operation);
      if (rejectStyle && key === "style") {
        throw attr_error(
          tree,
          LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
          operation,
          key,
          "style is not a semantic flag",
        );
      }
      return key;
    } catch (cause) {
      if (cause instanceof LiveTreeAttributeError) {
        throw new LiveTreeAttributeError(cause.code, operation, cause.quid, cause.reason, {
          attributeName: cause.attributeName,
          inputIndex: index,
        });
      }
      throw cause;
    }
  });
  return Object.freeze(normalized);
}

/** @internal Shared exact document-authoring normalization. */
export function livetree_flag_values(names: readonly string[]): CanonicalPublicAttrs {
  const values: Record<string, string> = {};
  for (const name of names) values[name] = name;
  return normalize_attrs_result(values);
}

function attr_error(
  tree: LiveTree,
  code: ConstructorParameters<typeof LiveTreeAttributeError>[0],
  operation: string,
  attributeName: string | undefined,
  reason: string,
): LiveTreeAttributeError {
  return new LiveTreeAttributeError(code, operation, diagnostic_quid(tree), reason, { attributeName });
}

function diagnostic_quid(tree: LiveTree): string {
  return get_quid(active_subject_for_tree(tree), runtime_for_tree(tree)) ?? UNASSIGNED_QUID_DIAGNOSTIC;
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
