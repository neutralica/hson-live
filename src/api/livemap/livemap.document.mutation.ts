import { assert_invariants } from "../../core/assert-invariants.js";
import { ELEM_TAG, ROOT_TAG, STR_TAG, HSON_META_MARKUP_PREFIX } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import {
  plan_public_attr_drop,
  plan_public_attr_set,
  plan_public_attrs_clear,
  plan_public_attrs_drop_many,
  plan_public_attrs_replace,
  plan_public_attrs_set_many,
  plan_public_flags_clear,
  plan_public_flags_set,
} from "../../core/public-attr-transitions.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import {
  assign_hson_node_quid,
  HsonNodeQuidValidationError,
  is_persisted_quid,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonAttrs, HsonNode, Primitive } from "../../core/types.js";
import type {
  LiveMapDocumentAttrsMutationApi,
  LiveMapDocumentFlagsMutationApi,
  LiveMapDocumentMode,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMapGraphInsertContentOp,
  LiveMapGraphMoveContentOp,
  LiveMapGraphOp,
  LiveMapGraphRemoveAttrOp,
  LiveMapGraphReplaceAttrsOp,
  LiveMapGraphRemoveContentOp,
  LiveMapGraphReplaceContentOp,
  LiveMapGraphSetAttrOp,
  LiveMapReplacementLineage,
} from "../../types/livemap.types.js";
import type { LiveMapGraphEnsureQuidOp } from "./livemap.identity.types.js";
import type { LiveMapRuntimeIdentityParticipant } from "./livemap.runtime-identity.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";
import { clone_live_root } from "./livemap.editor.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import {
  build_livemap_document_identity_overlay,
  LiveMapDocumentIdentityError,
  preserve_livemap_document_identity_at_path,
  register_livemap_document_identity_at_path,
  reconcile_livemap_document_identity_overlay,
  type LiveMapDocumentIdentityEffect,
  type LiveMapDocumentIdentityOverlay,
  type LiveMapDocumentIdentityReconciliation,
} from "./livemap.document.identity.js";
import {
  append_document_path,
  document_path_effect_for_graph_operation,
  validate_document_path,
} from "./livemap.document.path.js";
import { classify_live_root_mode } from "./livemap.document.js";
import {
  apply_replacement_lineage,
  derive_replacement_lineage,
  normalize_replacement_lineage,
} from "./livemap.document.lineage.js";
import {
  decode_document_attr_value,
  decode_document_attrs,
  is_public_document_attr_name,
} from "./livemap.document.attrs.js";
import {
  canonicalize_document_request_target,
  normalize_document_commit_target,
  normalize_document_request_target,
  normalize_document_target,
  require_document_attr_element,
  resolve_document_commit_target,
  resolve_document_target,
} from "./livemap.document.target.js";

type DocumentOperation = LiveMapDocumentMutationError["operation"];
type PreparedTargetAuthority = "request" | "commit";

export type PreparedDocumentMutation<TOp extends LiveMapGraphOp = LiveMapGraphOp> = Readonly<{
  root: HsonNode;
  overlay: LiveMapDocumentIdentityOverlay;
  operation: TOp;
  identityEffects: readonly LiveMapDocumentIdentityEffect[];
}>;

/** Internal state boundary implemented by the shared LiveMap Core. */
export type LiveMapDocumentMutationController = Readonly<{
  mode: LiveMapDocumentMode;
  rev: () => number;
  root: () => HsonNode;
  overlay: () => LiveMapDocumentIdentityOverlay;
  acquireLocalIdentity: (
    path: import("../../types/livemap.types.js").LiveMapDocumentPath,
    quid: string,
    participant?: LiveMapRuntimeIdentityParticipant,
  ) => void;
  applyMutation: <TOp extends LiveMapGraphOp>(
    candidate: PreparedDocumentMutation<TOp>,
  ) => LiveMapGraphCommit<TOp>;
}>;

/** Build the document capability over one atomic Core controller. */
export function make_livemap_document_mutation_api(
  controller: LiveMapDocumentMutationController,
): Readonly<{
  attrs: LiveMapDocumentAttrsMutationApi;
  flags: LiveMapDocumentFlagsMutationApi;
  /** Internal atomic substrate shared by every public bulk attrs method. */
  replaceAttrs: (
    target: LiveMapDocumentRequestTarget,
    attrs: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  replaceContent: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    replacement: LiveMapDocumentContent,
    lineage?: LiveMapReplacementLineage,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  insertContent: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    content: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  removeContent: (
    target: LiveMapDocumentRequestTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  moveContent: (
    target: LiveMapDocumentRequestTarget,
    from: number,
    to: number,
  ) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
}> {
  const attrs: LiveMapDocumentAttrsMutationApi = Object.freeze({
    set: (target, name, value) => set_document_attr(controller, target, name, value),
    drop: (target, name) => remove_document_attr(controller, target, name),
    setMany: (target, values) => set_many_document_attrs(controller, target, values),
    dropMany: (target, names) => drop_many_document_attrs(controller, target, names),
    clear: (target) => replace_document_attrs(controller, target, plan_public_attrs_clear()),
    replace: (target, values) => replace_document_attrs(controller, target, values),
  });
  const flags: LiveMapDocumentFlagsMutationApi = Object.freeze({
    set: (target, ...names) => set_document_flags(controller, target, names),
    clear: (target, ...names) => clear_document_flags(controller, target, names),
  });
  return Object.freeze({
    attrs,
    flags,
    replaceAttrs: (target, values) => replace_document_attrs(controller, target, values),
    replaceContent: (target, index, replacement, lineage) =>
      replace_document_content(controller, target, index, replacement, lineage),
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
  return replace_document_attrs(controller, target, plan_public_attrs_set_many(current, values));
}

function drop_many_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  namesInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const { target, attrs: current } = read_document_attrs(controller, targetInput);
  const names = normalize_attr_names(namesInput);
  return replace_document_attrs(controller, target, plan_public_attrs_drop_many(current, names));
}

function set_document_flags(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  namesInput: readonly unknown[],
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const names = normalize_flag_names(namesInput, true);
  const { target, attrs: current } = read_document_attrs(controller, targetInput);
  return replace_document_attrs(controller, target, plan_public_flags_set(current, names));
}

function clear_document_flags(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  namesInput: readonly unknown[],
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const names = normalize_flag_names(namesInput, true);
  const { target, attrs: current } = read_document_attrs(controller, targetInput);
  return replace_document_attrs(controller, target, plan_public_flags_clear(current, names));
}

function read_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
): Readonly<{ target: LiveMapDocumentRequestTarget; attrs: LiveMapDocumentAttrs }> {
  const operation = "replace-attrs";
  const target = normalize_document_target(targetInput, operation);
  const element = require_document_attr_element(
    resolve_document_target(controller.root(), controller.mode, controller.overlay(), target, operation),
    operation,
  );
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

function normalize_flag_names(input: readonly unknown[], rejectStyle: boolean): readonly string[] {
  const names = input.map((name) => normalize_attr_name(name, "replace-attrs"));
  if (rejectStyle && names.includes("style")) {
    throw mutation_error(
      "INVALID_DOCUMENT_ATTRIBUTE_NAME",
      "replace-attrs",
      "style is not a semantic flag",
    );
  }
  return Object.freeze(names);
}

function replace_document_attrs(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  attrsInput: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp> {
  const candidate = prepare_replace_document_attrs(
    controller.root(),
    controller.mode,
    controller.overlay(),
    targetInput,
    attrsInput,
  );
  return finish_mutation(controller, candidate);
}

function set_document_attr(
  controller: LiveMapDocumentMutationController,
  targetInput: LiveMapDocumentRequestTarget,
  nameInput: string,
  valueInput: LiveMapDocumentAttributeValue,
): LiveMapGraphCommit<LiveMapGraphSetAttrOp> {
  const candidate = prepare_set_document_attr(controller.root(), controller.mode, controller.overlay(), targetInput, nameInput, valueInput);
  return finish_mutation(controller, candidate);
}

function prepare_set_document_attr(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  nameInput: unknown,
  valueInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphSetAttrOp> {
  const operationName = "set-attr";
  const name = normalize_attr_name(nameInput, operationName);
  const value = normalize_attr_value(name, valueInput, operationName);
  const root = clone_live_root(inputRoot);
  const { target, endpoint } = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const element = require_document_attr_element(endpoint, operationName);
  const attrs: HsonAttrs = { ...(element.$_attrs ?? {}) };
  const current = decode_document_attrs(attrs);
  if (current === undefined) throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_VALUE", operationName, "current attrs are not canonical");
  element.$_attrs = clone_node(plan_public_attr_set(current, name, value));

  const operation: LiveMapGraphSetAttrOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    name,
    value: clone_attr_value(value),
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function remove_document_attr(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  nameInput: unknown,
): LiveMapGraphCommit<LiveMapGraphRemoveAttrOp> {
  const candidate = prepare_remove_document_attr(controller.root(), controller.mode, controller.overlay(), targetInput, nameInput);
  return finish_mutation(controller, candidate);
}

function prepare_remove_document_attr(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  nameInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphRemoveAttrOp> {
  const operationName = "remove-attr";
  const name = normalize_attr_name(nameInput, operationName);
  const root = clone_live_root(inputRoot);
  const { target, endpoint } = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const element = require_document_attr_element(endpoint, operationName);
  const attrs = decode_document_attrs(element.$_attrs ?? {});
  if (attrs === undefined) throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_VALUE", operationName, "current attrs are not canonical");
  const next = plan_public_attr_drop(attrs, name);
  if (Object.keys(next).length === 0) delete element.$_attrs;
  else element.$_attrs = clone_node(next);

  const operation: LiveMapGraphRemoveAttrOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target,
    name,
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function prepare_replace_document_attrs(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  attrsInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphReplaceAttrsOp> {
  const operationName = "replace-attrs";
  const decodedAttrs = decode_document_attrs(attrsInput);
  if (decodedAttrs === undefined) {
    throw mutation_error(
      "INVALID_DOCUMENT_ATTRIBUTE_VALUE",
      operationName,
      "attrs must be a canonical ordinary-attribute bag with valid, unprotected names",
    );
  }
  const attrs = plan_public_attrs_replace(decodedAttrs);
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const element = require_document_attr_element(
    preparedTarget.endpoint,
    operationName,
  );
  if (Object.keys(attrs).length === 0) delete element.$_attrs;
  else element.$_attrs = clone_node(attrs);

  const operation: LiveMapGraphReplaceAttrsOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target: preparedTarget.target,
    attrs: clone_node(attrs),
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function replace_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
  replacementInput: unknown,
  lineageInput?: unknown,
): LiveMapGraphCommit<LiveMapGraphReplaceContentOp> {
  const candidate = prepare_replace_document_content(controller.root(), controller.mode, controller.overlay(), targetInput, indexInput, replacementInput, "request", lineageInput);
  return finish_mutation(controller, candidate);
}

function prepare_replace_document_content(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  indexInput: unknown,
  replacementInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
  lineageInput?: unknown,
): PreparedDocumentMutation<LiveMapGraphReplaceContentOp> {
  const operationName = "replace-content";
  const index = normalize_content_index(indexInput, operationName);
  if (targetAuthority === "request" && is_Node(replacementInput)) {
    admit_portable_hson_node(replacementInput, "LiveMap.document.content.replace");
  }
  const replacement = clone_content(replacementInput, operationName);
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const endpoint = require_content_endpoint(preparedTarget.endpoint, operationName);
  if (index >= endpoint.$_content.length) {
    throw mutation_error(
      "INVALID_DOCUMENT_CONTENT_INDEX",
      operationName,
      `content index ${index} is outside the existing ${endpoint.$_content.length} slot(s)`,
    );
  }
  const canonicalReplacement = insertion_content(endpoint, replacement);
  const before = endpoint.$_content[index];
  if (before === undefined) {
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operationName, "replacement source is absent");
  }
  let lineage: LiveMapReplacementLineage;
  try {
    lineage = lineageInput === undefined
      ? derive_replacement_lineage(before, canonicalReplacement)
      : normalize_replacement_lineage(lineageInput, before, canonicalReplacement);
    apply_replacement_lineage(before, canonicalReplacement, lineage);
  } catch (cause) {
    if (cause instanceof HsonNodeQuidValidationError) {
      throw mutation_error("INVALID_DOCUMENT_IDENTITY", operationName, "candidate persisted identity is invalid", cause);
    }
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operationName, "replacement lineage is invalid", cause);
  }
  endpoint.$_content[index] = canonicalReplacement;

  const operation: LiveMapGraphReplaceContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target: preparedTarget.target,
    index,
    replacement: clone_content(canonicalReplacement, operationName),
    lineage,
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function insert_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
  contentInput: unknown,
): LiveMapGraphCommit<LiveMapGraphInsertContentOp> {
  const candidate = prepare_insert_document_content(
    controller.root(), controller.mode, controller.overlay(), targetInput, indexInput, contentInput,
  );
  return finish_mutation(controller, candidate);
}

function prepare_insert_document_content(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  indexInput: unknown,
  contentInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphInsertContentOp> {
  const operationName = "insert-content";
  const index = normalize_content_index(indexInput, operationName);
  if (targetAuthority === "request" && is_Node(contentInput)) {
    admit_portable_hson_node(contentInput, "LiveMap.document.content.insert");
  }
  const content = clone_content(contentInput, operationName);
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const endpoint = require_content_endpoint(preparedTarget.endpoint, operationName);
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
    target: preparedTarget.target,
    index,
    content: clone_content(content, operationName),
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function remove_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  indexInput: unknown,
): LiveMapGraphCommit<LiveMapGraphRemoveContentOp> {
  const candidate = prepare_remove_document_content(controller.root(), controller.mode, controller.overlay(), targetInput, indexInput);
  return finish_mutation(controller, candidate);
}

function prepare_remove_document_content(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  indexInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphRemoveContentOp> {
  const operationName = "remove-content";
  const index = normalize_content_index(indexInput, operationName);
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const endpoint = require_content_endpoint(preparedTarget.endpoint, operationName);
  require_existing_content_index(endpoint, index, operationName);
  endpoint.$_content.splice(index, 1);
  const operation: LiveMapGraphRemoveContentOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target: preparedTarget.target,
    index,
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function move_document_content(
  controller: LiveMapDocumentMutationController,
  targetInput: unknown,
  fromInput: unknown,
  toInput: unknown,
): LiveMapGraphCommit<LiveMapGraphMoveContentOp> {
  const candidate = prepare_move_document_content(
    controller.root(), controller.mode, controller.overlay(), targetInput, fromInput, toInput,
  );
  return finish_mutation(controller, candidate);
}

function prepare_move_document_content(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  fromInput: unknown,
  toInput: unknown,
  targetAuthority: PreparedTargetAuthority = "request",
): PreparedDocumentMutation<LiveMapGraphMoveContentOp> {
  const operationName = "move-content";
  const from = normalize_content_index(fromInput, operationName);
  const to = normalize_content_index(toInput, operationName);
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(root, mode, overlay, targetInput, operationName, targetAuthority);
  const endpoint = require_content_endpoint(preparedTarget.endpoint, operationName);
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
    target: preparedTarget.target,
    from,
    to,
  });
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function finish_mutation<TOp extends LiveMapGraphOp>(
  controller: LiveMapDocumentMutationController,
  candidate: PreparedDocumentMutation<TOp>,
): LiveMapGraphCommit<TOp> {
  return controller.applyMutation(candidate);
}

function prepare_finished_mutation<TOp extends LiveMapGraphOp>(
  expectedMode: LiveMapDocumentMode,
  root: HsonNode,
  currentOverlay: LiveMapDocumentIdentityOverlay,
  operation: TOp,
  operationName: DocumentOperation,
): PreparedDocumentMutation<TOp> {
  let reconciliation;
  try {
    reconciliation = reconcile_operation_identity(currentOverlay, operation);
  } catch (cause) {
    if (cause instanceof LiveMapDocumentIdentityError) {
      throw mutation_error(
        cause.code === "DUPLICATE_QUID"
          ? "DOCUMENT_IDENTITY_COLLISION"
          : "INVALID_DOCUMENT_IDENTITY",
        operationName,
        cause.message,
        cause,
      );
    }
    throw mutation_error("INVALID_DOCUMENT_IDENTITY", operationName, "candidate persisted identity is invalid", cause);
  }

  try {
    assert_invariants(root, `LiveMap.${operationName}`);
  } catch (cause) {
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operationName, "candidate graph violates canonical Hson invariants", cause);
  }

  const mode = classify_live_root_mode(root);
  if (mode !== expectedMode) {
    throw mutation_error(
      "DOCUMENT_MODE_MISMATCH",
      operationName,
      `candidate classifies as ${mode}; this façade must remain ${expectedMode}`,
    );
  }

  return {
    root,
    overlay: reconciliation.overlay,
    operation,
    identityEffects: reconciliation.effects,
  };
}

/** Plan one recorded ensure-if-absent registration; allocation is owned elsewhere. @internal */
export function prepare_ensure_document_quid(
  inputRoot: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  targetInput: unknown,
  quidInput: unknown,
): PreparedDocumentMutation<LiveMapGraphEnsureQuidOp> {
  const operationName = "ensure-quid";
  if (!is_persisted_quid(quidInput)) {
    throw mutation_error(
      "INVALID_DOCUMENT_IDENTITY",
      operationName,
      "recorded QUID is malformed",
    );
  }
  const root = clone_live_root(inputRoot);
  const preparedTarget = prepare_target(
    root,
    mode,
    overlay,
    targetInput,
    operationName,
    "commit",
  );
  if (!is_ordinary_element_node(preparedTarget.endpoint)) {
    throw mutation_error(
      "DOCUMENT_IDENTITY_INELIGIBLE",
      operationName,
      "target must be an eligible ordinary document element",
    );
  }
  const existing = read_hson_node_quid(preparedTarget.endpoint);
  if (existing !== undefined && existing !== quidInput) {
    throw mutation_error(
      "DOCUMENT_IDENTITY_DIFFERENT",
      operationName,
      "target already carries a different canonical QUID",
    );
  }

  const operation: LiveMapGraphEnsureQuidOp = Object.freeze({
    domain: "graph",
    op: operationName,
    target: preparedTarget.target,
    quid: quidInput,
  });
  if (existing === quidInput) {
    return prepare_finished_mutation(mode, root, overlay, operation, operationName);
  }
  if (overlay.pathForQuid(quidInput) !== undefined) {
    throw mutation_error(
      "DOCUMENT_IDENTITY_COLLISION",
      operationName,
      "recorded QUID collides with another canonical node",
    );
  }
  assign_hson_node_quid(preparedTarget.endpoint, quidInput);
  return prepare_finished_mutation(mode, root, overlay, operation, operationName);
}

function reconcile_operation_identity(
  overlay: LiveMapDocumentIdentityOverlay,
  operation: LiveMapGraphOp,
): LiveMapDocumentIdentityReconciliation {
  if (operation.op === "replace-root") {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      "Whole-root identity replacement must use the document admission boundary.",
    );
  }
  if (operation.op === "set-attr" || operation.op === "remove-attr" || operation.op === "replace-attrs") {
    return preserve_livemap_document_identity_at_path(overlay, operation.target.path);
  }
  if (operation.op === "ensure-quid") {
    return register_livemap_document_identity_at_path(
      overlay,
      operation.quid,
      operation.target.path,
    );
  }
  const effect = document_path_effect_for_graph_operation(operation);
  if (effect === undefined || effect.kind === "replace-root") {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      "Document mutation did not produce a local structural path effect.",
    );
  }
  if (operation.op === "insert-content") {
    return reconcile_livemap_document_identity_overlay(
      overlay,
      effect,
      { content: operation.content, path: append_document_path(operation.target.path, operation.index) },
    );
  }
  if (operation.op === "replace-content") {
    const replaced = reconcile_livemap_document_identity_overlay(
      overlay,
      effect,
      { content: operation.replacement, path: append_document_path(operation.target.path, operation.index) },
    );
    const base = append_document_path(operation.target.path, operation.index);
    let next = replaced.overlay;
    const effects: LiveMapDocumentIdentityEffect[] = [...replaced.effects];
    for (const entry of operation.lineage ?? []) {
      const source = validate_document_path([...base, ...entry.source]);
      const destination = validate_document_path([...base, ...entry.destination]);
      const quid = overlay.quidAtPath(source);
      if (quid === undefined) continue;
      const registered = register_livemap_document_identity_at_path(next, quid, destination);
      next = registered.overlay;
      effects.push(...registered.effects);
    }
    return Object.freeze({ overlay: next, effects: Object.freeze(effects) });
  }
  return reconcile_livemap_document_identity_overlay(overlay, effect);
}

/** Reject runtime identity on a caller-authored graph operation. */
export function admit_public_document_graph_operation(operation: LiveMapGraphOp): void {
  if (operation.op === "ensure-quid") {
    throw new Error("Public graph operations cannot install generated identity.");
  }
  if (operation.op === "replace-root") {
    if (is_Node(operation.root)) admit_portable_hson_node(operation.root, "LiveMap graph operation");
    return;
  }
  if (operation.target?.witness !== undefined) {
    throw new Error("Public graph operations cannot admit a QUID witness.");
  }
  if (operation.op === "insert-content" && is_Node(operation.content)) {
    admit_portable_hson_node(operation.content, "LiveMap graph operation");
  }
  if (operation.op === "replace-content" && is_Node(operation.replacement)) {
    admit_portable_hson_node(operation.replacement, "LiveMap graph operation");
  }
}

/** Validate and plan one graph operation against a detached candidate root. */
export function prepare_document_graph_operation(
  root: HsonNode,
  mode: LiveMapDocumentMode,
  input: unknown,
  overlay: LiveMapDocumentIdentityOverlay = build_livemap_document_identity_overlay(root, mode),
): PreparedDocumentMutation {
  return prepare_graph_operation(root, mode, overlay, input, "commit");
}

function prepare_graph_operation(
  root: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  input: unknown,
  targetAuthority: PreparedTargetAuthority,
): PreparedDocumentMutation {
  if (!is_plain_record(input) || input.domain !== "graph" || typeof input.op !== "string") {
    throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", "replace-content", "graph operation must have explicit graph domain and operation discriminants");
  }
  if (input.op === "set-attr") {
    must_exact_keys(input, ["domain", "op", "target", "name", "value"], input.op);
    return prepare_set_document_attr(root, mode, overlay, input.target, input.name, input.value, targetAuthority);
  }
  if (input.op === "remove-attr") {
    must_exact_keys(input, ["domain", "op", "target", "name"], input.op);
    return prepare_remove_document_attr(root, mode, overlay, input.target, input.name, targetAuthority);
  }
  if (input.op === "replace-attrs") {
    must_exact_keys(input, ["domain", "op", "target", "attrs"], input.op);
    return prepare_replace_document_attrs(root, mode, overlay, input.target, input.attrs, targetAuthority);
  }
  if (input.op === "replace-content") {
    must_exact_keys(input, Object.hasOwn(input, "lineage")
      ? ["domain", "op", "target", "index", "replacement", "lineage"]
      : ["domain", "op", "target", "index", "replacement"], input.op);
    return prepare_replace_document_content(root, mode, overlay, input.target, input.index, input.replacement, targetAuthority, input.lineage);
  }
  if (input.op === "insert-content") {
    must_exact_keys(input, ["domain", "op", "target", "index", "content"], input.op);
    return prepare_insert_document_content(root, mode, overlay, input.target, input.index, input.content, targetAuthority);
  }
  if (input.op === "remove-content") {
    must_exact_keys(input, ["domain", "op", "target", "index"], input.op);
    return prepare_remove_document_content(root, mode, overlay, input.target, input.index, targetAuthority);
  }
  if (input.op === "move-content") {
    must_exact_keys(input, ["domain", "op", "target", "from", "to"], input.op);
    return prepare_move_document_content(root, mode, overlay, input.target, input.from, input.to, targetAuthority);
  }
  if (input.op === "ensure-quid") {
    must_exact_keys(input, ["domain", "op", "target", "quid"], input.op);
    return prepare_ensure_document_quid(root, mode, overlay, input.target, input.quid);
  }
  throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", "replace-content", `unsupported graph operation ${JSON.stringify(input.op)}`);
}

function prepare_target(
  root: HsonNode,
  mode: LiveMapDocumentMode,
  overlay: LiveMapDocumentIdentityOverlay,
  input: unknown,
  operation: DocumentOperation,
  authority: PreparedTargetAuthority,
): Readonly<{
  target: LiveMapDocumentCommitTarget;
  endpoint: HsonNode | Primitive;
}> {
  return authority === "request"
    ? canonicalize_document_request_target(root, mode, overlay, input, operation)
    : resolve_document_commit_target(root, mode, overlay, input, operation);
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
  if (typeof input === "string" && input.startsWith(HSON_META_MARKUP_PREFIX)) {
    throw mutation_error("PROTECTED_DOCUMENT_METADATA", operation, "system metadata cannot be mutated through ordinary attrs");
  }
  if (!is_public_document_attr_name(input)) {
    throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_NAME", operation, "attribute name is not a canonical bare Hson name");
  }
  return input;
}

function normalize_attr_value(
  name: string,
  input: unknown,
  operation: DocumentOperation,
): LiveMapDocumentAttributeValue {
  const decoded = decode_document_attr_value(name, input);
  if (decoded !== undefined) return decoded;
  throw mutation_error("INVALID_DOCUMENT_ATTRIBUTE_VALUE", operation, "value must be a canonical primitive or structured style map");
}

function normalize_content_index(input: unknown, operation: DocumentOperation): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) {
    throw mutation_error("INVALID_DOCUMENT_CONTENT_INDEX", operation, "content index must be a non-negative safe integer");
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
  throw mutation_error("INVALID_DOCUMENT_REPLACEMENT", operation, "replacement must be one canonical Hson node or primitive");
}

function insertion_content(endpoint: HsonNode, content: LiveMapDocumentContent): LiveMapDocumentContent {
  if ((endpoint.$_tag === ELEM_TAG || endpoint.$_tag === ROOT_TAG) && typeof content === "string") {
    return { $_tag: STR_TAG, $_content: [content] };
  }
  return content;
}

/** Build the exact canonical carrier accepted by the existing insert planner. @internal */
export function make_internal_document_content_carrier(
  contentInput: LiveMapDocumentContent,
): HsonNode {
  const content = clone_content(contentInput, "insert-content");
  const carrier: HsonNode = { $_tag: ELEM_TAG, $_content: [] };
  carrier.$_content.push(insertion_content(carrier, content));
  return carrier;
}

function clone_attr_value(value: LiveMapDocumentAttributeValue): LiveMapDocumentAttributeValue {
  return typeof value === "object" && value !== null ? clone_node(value) : value;
}

function is_finite_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
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
