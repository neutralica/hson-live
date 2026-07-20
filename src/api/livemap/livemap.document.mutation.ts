import { assert_invariants } from "../../core/assert-invariants.js";
import { ELEM_TAG, ROOT_TAG, STR_TAG, _META_DATA_PREFIX } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { HsonAttrs, HsonNode, Primitive } from "../../core/types.js";
import type { CssMap } from "../../core/style.types.js";
import type {
  DocumentLiveMapAttrsApi,
  DocumentLiveMapMode,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentTarget,
  LiveMapGraphCommit,
  LiveMapGraphInsertContentOp,
  LiveMapGraphMoveContentOp,
  LiveMapGraphOp,
  LiveMapGraphRemoveAttrOp,
  LiveMapGraphReplaceAttrsOp,
  LiveMapGraphRemoveContentOp,
  LiveMapGraphReplaceContentOp,
  LiveMapGraphSetAttrOp,
} from "../../types/livemap.types.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";
import { clone_live_root } from "./livemap.editor.js";
import {
  index_livemap_document_elements,
  LiveMapDocumentIdentityError,
  type LiveMapDocumentIdentityIndex,
} from "./livemap.document.identity.js";
import { classify_live_root_mode } from "./livemap.document.js";
import { canonical_graph_equal } from "./livemap.document.install.js";
import {
  decode_document_attrs,
  is_public_document_attr_name,
} from "./livemap.document.attrs.js";

type DocumentOperation = LiveMapDocumentMutationError["operation"];

export type PreparedDocumentMutation<TOp extends LiveMapGraphOp = LiveMapGraphOp> = Readonly<{
  root: HsonNode;
  identity: LiveMapDocumentIdentityIndex;
  operation: TOp;
}>;

/** Internal state boundary implemented by the shared LiveMap Core. */
export type LiveMapDocumentMutationController = Readonly<{
  mode: DocumentLiveMapMode;
  rev: () => number;
  root: () => HsonNode;
  identity: () => LiveMapDocumentIdentityIndex;
  applyMutation: <TOp extends LiveMapGraphOp>(
    candidate: PreparedDocumentMutation<TOp>,
  ) => LiveMapGraphCommit<TOp>;
}>;

/** Build the document capability over one atomic Core controller. */
export function make_livemap_document_mutation_api(
  controller: LiveMapDocumentMutationController,
): Readonly<{
  attrs: DocumentLiveMapAttrsApi;
  /** Internal atomic substrate shared by every public bulk attrs method. */
  replaceAttrs: (
    target: LiveMapDocumentTarget,
    attrs: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  replaceContent: (
    target: LiveMapDocumentTarget,
    index: number,
    replacement: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  insertContent: (
    target: LiveMapDocumentTarget,
    index: number,
    content: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  removeContent: (
    target: LiveMapDocumentTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  moveContent: (
    target: LiveMapDocumentTarget,
    from: number,
    to: number,
  ) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
}> {
  const attrs: DocumentLiveMapAttrsApi = Object.freeze({
    set: (target, name, value) => set_document_attr(controller, target, name, value),
    drop: (target, name) => remove_document_attr(controller, target, name),
    setMany: (target, values) => set_many_document_attrs(controller, target, values),
    dropMany: (target, names) => drop_many_document_attrs(controller, target, names),
    clear: (target) => replace_document_attrs(controller, target, {}),
    replace: (target, values) => replace_document_attrs(controller, target, values),
  });
  return Object.freeze({
    attrs,
    replaceAttrs: (target, values) => replace_document_attrs(controller, target, values),
    replaceContent: (target, index, replacement) =>
      replace_document_content(controller, target, index, replacement),
    insertContent: (target, index, content) =>
      insert_document_content(controller, target, index, content),
    removeContent: (target, index) =>
      remove_document_content(controller, target, index),
    moveContent: (target, from, to) =>
      move_document_content(controller, target, from, to),
  });
}

function set_many_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  valuesInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const { target, attrs: current } = read_document_attrs(controller, targetInput);
  const values = normalize_attrs_bag(valuesInput);
  return replace_document_attrs(controller, target, { ...current, ...values });
}

function drop_many_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  namesInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const { target, attrs: current } = read_document_attrs(controller, targetInput);
  const names = normalize_attr_names(namesInput);
  const next: Record<string, LiveMapDocumentAttributeValue> = { ...current };
  for (const name of names) delete next[name];
  return replace_document_attrs(controller, target, next);
}

function read_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
): Readonly<{ target: LiveMapDocumentTarget; attrs: LiveMapDocumentAttrs }> {
  const operation = "replace-attrs";
  const target = normalize_target(targetInput, operation);
  const element = require_element(resolve_target(controller.root(), controller.mode, target, operation), operation);
  const attrs = decode_document_attrs(element.$_attrs ?? {});
  if (attrs === undefined) {
    throw mutation_error(
      "INVALID_DOCUMENT_REPLACEMENT",
      operation,
      "current ordinary attributes are not a canonical attribute bag",
    );
  }
  return Object.freeze({ target, attrs });
}

function normalize_attrs_bag(input: unknown): LiveMapDocumentAttrs {
  const attrs = decode_document_attrs(input);
  if (attrs !== undefined) return attrs;
  throw mutation_error(
    "INVALID_DOCUMENT_ATTRIBUTE_VALUE",
    "replace-attrs",
    "values must be a canonical ordinary-attribute bag with valid, unprotected names",
  );
}

function normalize_attr_names(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw mutation_error(
      "INVALID_DOCUMENT_ATTRIBUTE_NAME",
      "replace-attrs",
      "names must be an array of canonical ordinary-attribute names",
    );
  }
  return Object.freeze(input.map((name) => normalize_attr_name(name, "replace-attrs")));
}

function replace_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  attrsInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const candidate = prepare_replace_document_attrs(
    controller.root(),
    controller.mode,
    targetInput,
    attrsInput,
  );
  return finish_mutation(controller, candidate);
}

function set_document_attr(
  controller: LiveMapDocumentMutationController,
  targetInput: LiveMapDocumentTarget,
  nameInput: string,
  valueInput: LiveMapDocumentAttributeValue,
): LiveMapGraphCommit<LiveMapGraphSetAttrOp> {
  const candidate = prepare_set_document_attr(controller.root(), controller.mode, targetInput, nameInput, valueInput);
  return finish_mutation(controller, candidate);
}

function prepare_set_document_attr(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  nameInput: unknown,
  valueInput: unknown,
): PreparedDocumentMutation<LiveMapGraphSetAttrOp> {
  const operationName = "set-attr";
  const target = normalize_target(targetInput, operationName);
  const name = normalize_attr_name(nameInput, operationName);
  const value = normalize_attr_value(name, valueInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = resolve_target(root, mode, target, operationName);
  const element = require_element(endpoint, operationName);
  const attrs: HsonAttrs = { ...(element.$_attrs ?? {}) };
  if (is_style_map(value)) attrs.style = value;
  else attrs[name] = value;
  element.$_attrs = attrs;

  const operation: LiveMapGraphSetAttrOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    name,
    value: clone_attr_value(value),
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function remove_document_attr(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  nameInput: unknown,
): LiveMapGraphCommit<LiveMapGraphRemoveAttrOp> {
  const candidate = prepare_remove_document_attr(controller.root(), controller.mode, targetInput, nameInput);
  return finish_mutation(controller, candidate);
}

function prepare_remove_document_attr(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  nameInput: unknown,
): PreparedDocumentMutation<LiveMapGraphRemoveAttrOp> {
  const operationName = "remove-attr";
  const target = normalize_target(targetInput, operationName);
  const name = normalize_attr_name(nameInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = resolve_target(root, mode, target, operationName);
  const element = require_element(endpoint, operationName);
  const attrs: HsonAttrs = { ...(element.$_attrs ?? {}) };
  delete attrs[name];
  if (Object.keys(attrs).length === 0) delete element.$_attrs;
  else element.$_attrs = attrs;

  const operation: LiveMapGraphRemoveAttrOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    name,
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function prepare_replace_document_attrs(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  attrsInput: unknown,
): PreparedDocumentMutation<LiveMapGraphReplaceAttrsOp> {
  const operationName = "replace-attrs";
  const target = normalize_target(targetInput, operationName);
  const attrs = decode_document_attrs(attrsInput);
  if (attrs === undefined) {
    throw mutation_error(
      "INVALID_DOCUMENT_ATTRIBUTE_VALUE",
      operationName,
      "attrs must be a canonical ordinary-attribute bag with valid, unprotected names",
    );
  }
  const root = clone_live_root(inputRoot);
  const element = require_element(resolve_target(root, mode, target, operationName), operationName);
  if (Object.keys(attrs).length === 0) delete element.$_attrs;
  else element.$_attrs = clone_node(attrs);

  const operation: LiveMapGraphReplaceAttrsOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    attrs: clone_node(attrs),
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function replace_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
  replacementInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceContentOp> {
  const candidate = prepare_replace_document_content(controller.root(), controller.mode, targetInput, indexInput, replacementInput);
  return finish_mutation(controller, candidate);
}

function prepare_replace_document_content(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  indexInput: unknown,
  replacementInput: unknown,
): PreparedDocumentMutation<LiveMapGraphReplaceContentOp> {
  const operationName = "replace-content";
  const target = normalize_target(targetInput, operationName);
  const index = normalize_content_index(indexInput, operationName);
  const replacement = clone_content(replacementInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = require_content_endpoint(resolve_target(root, mode, target, operationName), operationName);
  if (index >= endpoint.$_content.length) {
    throw mutation_error(
      "INVALID_DOCUMENT_CONTENT_INDEX",
      operationName,
      `content index ${index} is outside the existing ${endpoint.$_content.length} slot(s)`,
    );
  }
  endpoint.$_content[index] = replacement;

  const operation: LiveMapGraphReplaceContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    index,
    replacement: clone_content(replacement, operationName),
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function insert_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
  contentInput: unknown,
): LiveMapGraphCommit<LiveMapGraphInsertContentOp> {
  const candidate = prepare_insert_document_content(
    controller.root(), controller.mode, targetInput, indexInput, contentInput,
  );
  return finish_mutation(controller, candidate);
}

function prepare_insert_document_content(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  indexInput: unknown,
  contentInput: unknown,
): PreparedDocumentMutation<LiveMapGraphInsertContentOp> {
  const operationName = "insert-content";
  const target = normalize_target(targetInput, operationName);
  const index = normalize_content_index(indexInput, operationName);
  const content = clone_content(contentInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = require_content_endpoint(resolve_target(root, mode, target, operationName), operationName);
  if (index > endpoint.$_content.length) {
    throw mutation_error(
      "INVALID_DOCUMENT_CONTENT_INDEX",
      operationName,
      `content index ${index} is outside the insertion range 0 through ${endpoint.$_content.length}`,
    );
  }
  endpoint.$_content.splice(index, 0, insertion_content(endpoint, content));

  const operation: LiveMapGraphInsertContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    index,
    content: clone_content(content, operationName),
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function remove_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
): LiveMapGraphCommit<LiveMapGraphRemoveContentOp> {
  const candidate = prepare_remove_document_content(controller.root(), controller.mode, targetInput, indexInput);
  return finish_mutation(controller, candidate);
}

function prepare_remove_document_content(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  indexInput: unknown,
): PreparedDocumentMutation<LiveMapGraphRemoveContentOp> {
  const operationName = "remove-content";
  const target = normalize_target(targetInput, operationName);
  const index = normalize_content_index(indexInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = require_content_endpoint(resolve_target(root, mode, target, operationName), operationName);
  require_existing_content_index(endpoint, index, operationName);
  endpoint.$_content.splice(index, 1);

  const operation: LiveMapGraphRemoveContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    index,
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function move_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  fromInput: unknown,
  toInput: unknown,
): LiveMapGraphCommit<LiveMapGraphMoveContentOp> {
  const candidate = prepare_move_document_content(
    controller.root(), controller.mode, targetInput, fromInput, toInput,
  );
  return finish_mutation(controller, candidate);
}

function prepare_move_document_content(
  inputRoot: HsonNode,
  mode: DocumentLiveMapMode,
  targetInput: unknown,
  fromInput: unknown,
  toInput: unknown,
): PreparedDocumentMutation<LiveMapGraphMoveContentOp> {
  const operationName = "move-content";
  const target = normalize_target(targetInput, operationName);
  const from = normalize_content_index(fromInput, operationName);
  const to = normalize_content_index(toInput, operationName);
  const root = clone_live_root(inputRoot);
  const endpoint = require_content_endpoint(resolve_target(root, mode, target, operationName), operationName);
  require_existing_content_index(endpoint, from, operationName);
  require_existing_content_index(endpoint, to, operationName);
  if (from !== to) {
    const moved = endpoint.$_content.splice(from, 1)[0];
    if (moved === undefined) {
      throw mutation_error("INVALID_DOCUMENT_CONTENT_INDEX", operationName, `content index ${from} is unavailable`);
    }
    endpoint.$_content.splice(to, 0, moved);
  }

  const operation: LiveMapGraphMoveContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    from,
    to,
  });
  return prepare_finished_mutation(mode, root, operation, operationName);
}

function finish_mutation<TOp extends LiveMapGraphOp>(
  controller: LiveMapDocumentMutationController,
  candidate: PreparedDocumentMutation<TOp>,
): LiveMapGraphCommit<TOp> {
  const prevRev = controller.rev();
  if (canonical_graph_equal(controller.root(), candidate.root)) {
    return Object.freeze({ changed: false, prevRev, rev: prevRev, ops: Object.freeze([]) });
  }
  return controller.applyMutation(candidate);
}

function prepare_finished_mutation<TOp extends LiveMapGraphOp>(
  expectedMode: DocumentLiveMapMode,
  root: HsonNode,
  operation: TOp,
  operationName: DocumentOperation,
): PreparedDocumentMutation<TOp> {
  let identity: LiveMapDocumentIdentityIndex | undefined;
  try {
    identity = index_livemap_document_elements(root);
  } catch (cause) {
    if (cause instanceof LiveMapDocumentIdentityError) {
      throw mutation_error("INVALID_DOCUMENT_IDENTITY", operationName, cause.message, cause);
    }
  }

  try {
    assert_invariants(root, `LiveMap.${operationName}`);
  } catch (cause) {
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operationName, "candidate graph violates canonical HSON invariants", cause);
  }

  const mode = classify_live_root_mode(root);
  if (mode !== expectedMode) {
    throw mutation_error(
      "DOCUMENT_MODE_MISMATCH",
      operationName,
      `candidate classifies as ${mode}; this façade must remain ${expectedMode}`,
    );
  }

  if (identity === undefined) {
    try {
      identity = index_livemap_document_elements(root);
    } catch (cause) {
      throw mutation_error("INVALID_DOCUMENT_IDENTITY", operationName, "candidate persisted identity is invalid", cause);
    }
  }

  return { root, identity, operation };
}

/** Validate and plan one graph operation against a detached candidate root. */
export function prepare_document_graph_operation(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  input: unknown,
): PreparedDocumentMutation {
  if (!is_plain_record(input) || input.domain !== "graph" || typeof input.op !== "string") {
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", "replace-content", "graph operation must have explicit graph domain and operation discriminants");
  }
  if (input.op === "set-attr") {
    must_exact_keys(input, ["domain", "op", "target", "name", "value"], input.op);
    return prepare_set_document_attr(root, mode, input.target, input.name, input.value);
  }
  if (input.op === "remove-attr") {
    must_exact_keys(input, ["domain", "op", "target", "name"], input.op);
    return prepare_remove_document_attr(root, mode, input.target, input.name);
  }
  if (input.op === "replace-attrs") {
    must_exact_keys(input, ["domain", "op", "target", "attrs"], input.op);
    return prepare_replace_document_attrs(root, mode, input.target, input.attrs);
  }
  if (input.op === "replace-content") {
    must_exact_keys(input, ["domain", "op", "target", "index", "replacement"], input.op);
    return prepare_replace_document_content(root, mode, input.target, input.index, input.replacement);
  }
  if (input.op === "insert-content") {
    must_exact_keys(input, ["domain", "op", "target", "index", "content"], input.op);
    return prepare_insert_document_content(root, mode, input.target, input.index, input.content);
  }
  if (input.op === "remove-content") {
    must_exact_keys(input, ["domain", "op", "target", "index"], input.op);
    return prepare_remove_document_content(root, mode, input.target, input.index);
  }
  if (input.op === "move-content") {
    must_exact_keys(input, ["domain", "op", "target", "from", "to"], input.op);
    return prepare_move_document_content(root, mode, input.target, input.from, input.to);
  }
  throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", "replace-content", `unsupported graph operation ${JSON.stringify(input.op)}`);
}

function must_exact_keys(
  input: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  operation: DocumentOperation,
): void {
  const keys = Object.keys(input);
  if (keys.length === expected.length && keys.every((key) => expected.includes(key))) return;
  throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operation, "graph operation contains missing or unknown fields");
}

function normalize_target(input: unknown, operation: DocumentOperation): LiveMapDocumentTarget {
  if (!is_plain_record(input) || (input.kind !== "path" && input.kind !== "quid")) {
    throw mutation_error("INVALID_DOCUMENT_TARGET", operation, "target must discriminate kind as path or quid");
  }

  if (input.kind === "path") {
    if (Object.keys(input).some((key) => key !== "kind" && key !== "path") || !Array.isArray(input.path)) {
      throw mutation_error("INVALID_DOCUMENT_TARGET", operation, "path target must contain only kind and path");
    }
    const path = input.path.map((segment) => {
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0) {
        throw mutation_error("INVALID_DOCUMENT_PATH", operation, "every document path segment must be a non-negative integer");
      }
      return segment;
    });
    return Object.freeze({ kind: "path", path: Object.freeze(path) });
  }

  if (Object.keys(input).some((key) => key !== "kind" && key !== "quid")
    || !is_persisted_quid(input.quid)) {
    throw mutation_error("INVALID_DOCUMENT_TARGET", operation, "QUID target must contain one canonical persisted QUID");
  }
  return Object.freeze({ kind: "quid", quid: input.quid });
}

function resolve_target(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  target: LiveMapDocumentTarget,
  operation: DocumentOperation,
): HsonNode | Primitive {
  if (target.kind === "quid") {
    let endpoint: HsonNode | undefined;
    try {
      endpoint = index_livemap_document_elements(root).get(target.quid);
    } catch (cause) {
      throw mutation_error("INVALID_DOCUMENT_IDENTITY", operation, "current persisted identity is invalid", cause);
    }
    if (endpoint === undefined) {
      throw mutation_error("DOCUMENT_TARGET_NOT_FOUND", operation, `no element carries persisted QUID ${JSON.stringify(target.quid)}`);
    }
    return endpoint;
  }

  let endpoint: HsonNode | Primitive = document_path_base(root, mode, operation);
  for (const segment of target.path) {
    if (!is_Node(endpoint) || segment >= endpoint.$_content.length) {
      throw mutation_error("DOCUMENT_PATH_OUT_OF_RANGE", operation, `document path cannot resolve content segment ${segment}`);
    }
    endpoint = endpoint.$_content[segment];
  }
  return endpoint;
}

function document_path_base(root: HsonNode, mode: DocumentLiveMapMode, operation: DocumentOperation): HsonNode {
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined) {
    throw mutation_error("DOCUMENT_TARGET_NOT_FOUND", operation, "owned document cluster is unavailable");
  }
  if (mode === "fragment") return cluster;
  const element = cluster.$_content[0];
  if (!is_ordinary_element_node(element)) {
    throw mutation_error("DOCUMENT_TARGET_NOT_FOUND", operation, "owned top-level element is unavailable");
  }
  return element;
}

function require_element(endpoint: HsonNode | Primitive, operation: DocumentOperation): HsonNode {
  if (!is_ordinary_element_node(endpoint)) {
    throw mutation_error("DOCUMENT_TARGET_KIND", operation, "target must resolve to an ordinary document element");
  }
  return endpoint;
}

function require_content_endpoint(endpoint: HsonNode | Primitive, operation: DocumentOperation): HsonNode {
  if (!is_Node(endpoint)) {
    throw mutation_error("DOCUMENT_TARGET_KIND", operation, "target is a primitive and has no content slots");
  }
  return endpoint;
}

function require_existing_content_index(
  endpoint: HsonNode,
  index: number,
  operation: DocumentOperation,
): void {
  if (index < endpoint.$_content.length) return;
  throw mutation_error(
    "INVALID_DOCUMENT_CONTENT_INDEX",
    operation,
    `content index ${index} is outside the existing ${endpoint.$_content.length} slot(s)`,
  );
}

function normalize_attr_name(input: unknown, operation: DocumentOperation): string {
  if (typeof input === "string" && input.startsWith(_META_DATA_PREFIX)) {
    throw mutation_error("PROTECTED_DOCUMENT_METADATA", operation, "system metadata cannot be mutated through ordinary attrs");
  }
  if (!is_public_document_attr_name(input)) {
    throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_NAME", operation, "attribute name is not a canonical bare HSON name");
  }
  return input;
}

function normalize_attr_value(
  name: string,
  input: unknown,
  operation: DocumentOperation,
): LiveMapDocumentAttributeValue {
  if (is_finite_primitive(input)) return input;
  if (name === "style" && is_style_map(input)) return clone_node(input);
  throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_VALUE", operation, "value must be a canonical primitive or structured style map");
}

function normalize_content_index(input: unknown, operation: DocumentOperation): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    throw mutation_error("INVALID_DOCUMENT_CONTENT_INDEX", operation, "content index must be a non-negative integer");
  }
  return input;
}

function clone_content(input: unknown, operation: DocumentOperation): LiveMapDocumentContent {
  if (is_Node(input)) {
    try {
      return clone_live_root(input);
    } catch (cause) {
      throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operation, "replacement node cannot be cloned", cause);
    }
  }
  if (is_finite_primitive(input)) return input;
  throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operation, "replacement must be one canonical HSON node or primitive");
}

function insertion_content(endpoint: HsonNode, content: LiveMapDocumentContent): LiveMapDocumentContent {
  if (endpoint.$_tag === ELEM_TAG && typeof content === "string") {
    return { $_tag: STR_TAG, $_content: [content] };
  }
  return content;
}

function clone_attr_value(value: LiveMapDocumentAttributeValue): LiveMapDocumentAttributeValue {
  return is_style_map(value) ? clone_node(value) : value;
}

function is_finite_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function is_style_map(value: unknown): value is CssMap {
  if (!is_plain_record(value)) return false;
  const seen = new WeakSet<object>();
  const stack: Record<string, unknown>[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (seen.has(current)) return false;
    seen.add(current);
    for (const item of Object.values(current)) {
      if (item === undefined || is_finite_primitive(item)) continue;
      if (!is_plain_record(item)) return false;
      stack.push(item);
    }
  }
  return true;
}

function is_plain_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mutation_error(
  code: LiveMapDocumentMutationError["code"],
  operation: DocumentOperation,
  reason: string,
  cause?: unknown,
): LiveMapDocumentMutationError {
  return new LiveMapDocumentMutationError(code, operation, reason, cause === undefined ? undefined : { cause });
}
