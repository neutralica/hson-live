// locus/protocol.ts

import type {
  LocusClientActionMessage,
  LocusClientActionStatusMessage,
  LocusClientHelloMessage,
  LocusClientMessage,
  LocusClientRecoverMessage,
  LocusClientSessionAttachMessage,
  LocusClientSessionCreateMessage,
  LocusClientSessionGoodbyeMessage,
  LocusClientSubscribeMessage,
  LocusClientUnsubscribeMessage,
  LocusError,
  LocusResult,
  LocusServerMessage,
  LocusServerEventMessage,
  LocusActionPayloads,
  LocusCanonicalCommit,
  LocusCanonicalOp,
  LocusServerActionStatusMessage,
  LocusServerRecoveryCaughtUpMessage,
  LocusServerRecoveryErrorMessage,
  LocusServerRecoveryPlanMessage,
  LocusSnapshotCapabilities,
  LocusSnapshotEncodingSelection,
  LocusServerSessionAttachedMessage,
  LocusServerSessionCreatedMessage,
  LocusServerSessionEndedMessage,
  LocusServerSessionFencedMessage,
  LocusServerSessionRejectedMessage,
  LocusWireValue,
} from "../../types/locus.types.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { CssMap } from "../../core/style.types.js";
import type { JsonValue, Primitive } from "../../core/types.js";
import { is_Node } from "../../core/node-guards.js";
import { classify_live_root_mode } from "../livemap/livemap.document.js";
import {
  decode_document_attrs,
  is_public_document_attr_name,
} from "../livemap/livemap.document.attrs.js";
import type {
  DocumentLiveMapMode,
  DocumentLiveMap,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentTarget,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapProjectedGraphEnsureQuidOp,
  LiveMapRootMode,
  LivePath,
} from "../../types/livemap.types.js";
import type {
  LocusDecodedServerCanonicalCommitMessage,
  LocusDecodedServerMessage,
  LocusDecodedServerRecoveryCommitMessage,
  LocusDecodedServerRecoverySnapshotMessage,
  LocusValidatedSnapshotEnvelope,
} from "./locus.document-snapshot.js";
import {
  decode_locus_graph_content,
  is_locus_encoded_graph_content,
} from "./locus.graph-content-codec.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
export type LocusDecodedDocumentCommit = Omit<LiveMapGraphCommit, "ops"> & Readonly<{
  ops: readonly LiveMapGraphOp[];
}>;

function is_projected_identity_operation(
  operation: LocusCanonicalOp,
): operation is LiveMapProjectedGraphEnsureQuidOp {
  return "domain" in operation
    && operation.op === "ensure-quid"
    && "projected" in operation.target
    && operation.target.projected === true;
}


function ok<T>(value: T): LocusResult<T> {
  return { ok: true, value };
}

function fail(message: string, extra?: Omit<LocusError, "message">): LocusResult<never> {
  return { ok: false, error: { message, ...extra } };
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function has_exact_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function is_locus_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_locus_json_value);
  if (!is_record(value)) return false;
  return Object.values(value).every(is_locus_json_value);
}

function is_live_path(value: unknown): value is LivePath {
  return Array.isArray(value)
    && value.every((part) => typeof part === "string"
      || (typeof part === "number" && Number.isInteger(part) && part >= 0));
}

function required_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function required_rev(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function clone_json<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function decode_wire_value(value: unknown): LocusWireValue | undefined {
  if (!is_record(value)) return undefined;
  if (value.present === false && has_exact_keys(value, ["present"])) return Object.freeze({ present: false });
  if (value.present !== true || !has_exact_keys(value, ["present", "value"]) || !is_locus_json_value(value.value)) {
    return undefined;
  }
  return Object.freeze({ present: true, value: clone_json(value.value) });
}

function decode_projected_canonical_op(value: unknown): LocusCanonicalOp | undefined {
  if (!is_record(value) || !is_live_path(value.path)) return undefined;
  const path = Object.freeze([...value.path]);
  const prev = decode_wire_value(value.prev);
  const next = decode_wire_value(value.next);
  if (!prev || !next) return undefined;

  if (value.kind === "delete") {
    if (!has_exact_keys(value, ["kind", "path", "prev", "next"]) || next.present) return undefined;
    return Object.freeze({ kind: "delete", path, prev, next });
  }
  if (value.kind === "set" || value.kind === "replace") {
    if (!has_exact_keys(value, ["kind", "path", "prev", "next"]) || !next.present) return undefined;
    return Object.freeze({ kind: value.kind, path, prev, next });
  }
  if (value.kind === "splice") {
    if (!has_exact_keys(value, ["kind", "path", "start", "removed", "inserted", "prev", "next"])) return undefined;
    const start = required_rev(value.start);
    if (start === undefined || !Array.isArray(value.removed) || !Array.isArray(value.inserted)) return undefined;
    if (!value.removed.every(is_locus_json_value) || !value.inserted.every(is_locus_json_value)) return undefined;
    if (!prev.present || !next.present || !Array.isArray(prev.value) || !Array.isArray(next.value)) return undefined;
    return Object.freeze({
      kind: "splice",
      path,
      start,
      removed: Object.freeze(value.removed.map(clone_json)),
      inserted: Object.freeze(value.inserted.map(clone_json)),
      prev,
      next,
    });
  }
  if (value.kind === "rename") {
    if (!has_exact_keys(value, ["kind", "path", "from", "to", "prev", "next"])) return undefined;
    if (typeof value.from !== "string" || typeof value.to !== "string" || !prev.present || !next.present) return undefined;
    if (!is_record(prev.value) || Array.isArray(prev.value) || !is_record(next.value) || Array.isArray(next.value)) return undefined;
    return Object.freeze({ kind: "rename", path, from: value.from, to: value.to, prev, next });
  }
  if (value.kind === "move") {
    if (!has_exact_keys(value, ["kind", "path", "from", "to", "prev", "next"])) return undefined;
    if (!is_nonnegative_safe_integer(value.from) || !is_nonnegative_safe_integer(value.to)) return undefined;
    if (!prev.present || !next.present || !Array.isArray(prev.value) || !Array.isArray(next.value)) return undefined;
    return Object.freeze({ kind: "move", path, from: value.from, to: value.to, prev, next });
  }
  return undefined;
}

function decode_projected_identity_op(value: unknown): LocusCanonicalOp | undefined {
  if (!is_record(value)
    || value.domain !== "graph"
    || value.op !== "ensure-quid"
    || !has_exact_keys(value, ["domain", "op", "target", "quid"])
    || !is_persisted_quid(value.quid)
    || !is_record(value.target)
    || !has_exact_keys(value.target, ["kind", "path", "projected"])
    || value.target.kind !== "path"
    || value.target.projected !== true
    || !is_live_path(value.target.path)) return undefined;
  return Object.freeze({
    domain: "graph",
    op: "ensure-quid",
    target: Object.freeze({ kind: "path", path: Object.freeze([...value.target.path]), projected: true }),
    quid: value.quid,
  });
}

function is_nonnegative_safe_integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decode_mode(value: unknown): LiveMapRootMode | undefined {
  if (value === "data-object" || value === "data-array" || value === "element" || value === "fragment") {
    return value;
  }
  return undefined;
}

function is_finite_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function decode_style_map(value: unknown): CssMap | undefined {
  if (!is_record(value)) return undefined;
  const decoded: Record<string, Primitive | CssMap | undefined> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || is_finite_primitive(item)) decoded[key] = item;
    else {
      const nested = decode_style_map(item);
      if (nested === undefined) return undefined;
      decoded[key] = nested;
    }
  }
  return Object.freeze(decoded);
}

function decode_document_target(value: unknown): LiveMapDocumentTarget | undefined {
  if (!is_record(value)) return undefined;
  if (value.kind === "path" && has_exact_keys(value, ["kind", "path"])) {
    try {
      return Object.freeze({ kind: "path", path: validate_document_path(value.path) });
    } catch {
      return undefined;
    }
  }
  if (value.kind === "quid" && has_exact_keys(value, ["kind", "quid"]) && is_persisted_quid(value.quid)) {
    return Object.freeze({ kind: "quid", quid: value.quid });
  }
  return undefined;
}

function decode_document_commit_target(value: unknown): LiveMapDocumentCommitTarget | undefined {
  if (!is_record(value) || value.kind !== "path") return undefined;
  const witnessPresent = Object.hasOwn(value, "witness");
  if (!has_exact_keys(value, witnessPresent ? ["kind", "path", "witness"] : ["kind", "path"])) return undefined;
  let path;
  try {
    path = validate_document_path(value.path);
  } catch {
    return undefined;
  }
  if (!witnessPresent) return Object.freeze({ kind: "path", path });
  if (!is_record(value.witness)
    || !has_exact_keys(value.witness, ["quid"])
    || !is_persisted_quid(value.witness.quid)) return undefined;
  return Object.freeze({
    kind: "path",
    path,
    witness: Object.freeze({ quid: value.witness.quid }),
  });
}

function decode_attribute_name(value: unknown): string | undefined {
  return is_public_document_attr_name(value) ? value : undefined;
}

function decode_attribute_value(name: string, value: unknown): LiveMapDocumentAttributeValue | undefined {
  if (is_finite_primitive(value)) return value;
  return name === "style" ? decode_style_map(value) : undefined;
}

/** Shared strict payload decoders used by graph commits and hosted document actions. */
export function decode_locus_document_target(value: unknown): LiveMapDocumentTarget | undefined {
  return decode_document_target(value);
}

export function decode_locus_document_attribute_name(value: unknown): string | undefined {
  return decode_attribute_name(value);
}

export function decode_locus_document_attribute_value(
  name: string,
  value: unknown,
): LiveMapDocumentAttributeValue | undefined {
  return decode_attribute_value(name, value);
}

export function decode_locus_document_attrs(value: unknown): LiveMapDocumentAttrs | undefined {
  return decode_document_attrs(value);
}

function decode_graph_op(
  value: unknown,
  mode: DocumentLiveMapMode,
): LocusCanonicalOp | undefined {
  if (!is_record(value) || value.domain !== "graph") return undefined;
  if (value.op === "replace-root") {
    if (!has_exact_keys(value, ["domain", "op", "mode", "root"]) || value.mode !== mode) return undefined;
    if (!is_locus_encoded_graph_content(value.root)) return undefined;
    try {
      const root = decode_locus_graph_content(value.root);
      if (!is_Node(root) || classify_live_root_mode(root) !== mode) return undefined;
    } catch {
      return undefined;
    }
    return Object.freeze({ domain: "graph", op: "replace-root", mode, root: value.root });
  }

  const target = decode_document_commit_target(value.target);
  if (target === undefined) return undefined;
  if (value.op === "set-attr") {
    if (!has_exact_keys(value, ["domain", "op", "target", "name", "value"])) return undefined;
    const name = decode_attribute_name(value.name);
    if (name === undefined) return undefined;
    const attributeValue = decode_attribute_value(name, value.value);
    if (attributeValue === undefined) return undefined;
    return Object.freeze({ domain: "graph", op: "set-attr", target, name, value: attributeValue });
  }
  if (value.op === "remove-attr") {
    if (!has_exact_keys(value, ["domain", "op", "target", "name"])) return undefined;
    const name = decode_attribute_name(value.name);
    return name === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "remove-attr", target, name });
  }
  if (value.op === "replace-attrs") {
    if (!has_exact_keys(value, ["domain", "op", "target", "attrs"])) return undefined;
    const attrs = decode_document_attrs(value.attrs);
    return attrs === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs });
  }
  if (value.op === "ensure-quid") {
    if (!has_exact_keys(value, ["domain", "op", "target", "quid"])
      || !is_persisted_quid(value.quid)) return undefined;
    return Object.freeze({ domain: "graph", op: "ensure-quid", target, quid: value.quid });
  }
  if (value.op === "replace-content") {
    if (!has_exact_keys(value, ["domain", "op", "target", "index", "replacement"])) return undefined;
    const index = required_rev(value.index);
    if (index === undefined) return undefined;
    const replacement = is_locus_encoded_graph_content(value.replacement) ? value.replacement : undefined;
    return replacement === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "replace-content", target, index, replacement });
  }
  if (value.op === "insert-content") {
    if (!has_exact_keys(value, ["domain", "op", "target", "index", "content"])) return undefined;
    const index = required_rev(value.index);
    if (index === undefined) return undefined;
    const content = is_locus_encoded_graph_content(value.content) ? value.content : undefined;
    return content === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "insert-content", target, index, content });
  }
  if (value.op === "remove-content") {
    if (!has_exact_keys(value, ["domain", "op", "target", "index"])) return undefined;
    const index = required_rev(value.index);
    return index === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "remove-content", target, index });
  }
  if (value.op === "move-content") {
    if (!has_exact_keys(value, ["domain", "op", "target", "from", "to"])) return undefined;
    const from = required_rev(value.from);
    const to = required_rev(value.to);
    return from === undefined || to === undefined || from === to
      ? undefined
      : Object.freeze({ domain: "graph", op: "move-content", target, from, to });
  }
  return undefined;
}

function decode_canonical_commit(value: unknown): LocusCanonicalCommit | undefined {
  if (!is_record(value)) return undefined;
  const transportPresent = Object.hasOwn(value, "format")
    || Object.hasOwn(value, "payload");
  const keys = transportPresent
    ? ["logicalMapId", "incarnationId", "mode", "prevRev", "rev", "ops", "format", "payload"]
    : ["logicalMapId", "incarnationId", "mode", "prevRev", "rev", "ops"];
  if (!has_exact_keys(value, keys)) return undefined;
  const logicalMapId = required_string(value.logicalMapId);
  const incarnationId = required_string(value.incarnationId);
  const mode = decode_mode(value.mode);
  const prevRev = required_rev(value.prevRev);
  const rev = required_rev(value.rev);
  if (!logicalMapId || !incarnationId || mode === undefined || prevRev === undefined || rev !== prevRev + 1) return undefined;
  if (transportPresent && (
    mode === "element"
    || mode === "fragment"
    || value.format !== "structural-json"
    || typeof value.payload !== "string"
  )) return undefined;
  if (!Array.isArray(value.ops) || value.ops.length === 0) return undefined;
  const ops: LocusCanonicalOp[] = [];
  for (const item of value.ops) {
    const op = mode === "element" || mode === "fragment"
      ? decode_graph_op(item, mode)
      : is_record(item) && item.domain === "graph"
        ? decode_projected_identity_op(item)
        : decode_projected_canonical_op(item);
    if (!op) return undefined;
    ops.push(op);
  }
  return Object.freeze({
    logicalMapId,
    incarnationId,
    mode,
    prevRev,
    rev,
    ops: Object.freeze(ops),
    ...(transportPresent ? {
      format: "structural-json" as const,
      payload: value.payload as string,
    } : {}),
  });
}

/** @internal Strict current canonical decoder; QUID-only targets are rejected. */
export function decode_locus_canonical_commit(value: unknown): LocusCanonicalCommit | undefined {
  return decode_canonical_commit(value);
}

/** @internal Convert an encoded document commit into detached LiveMap-domain operations. */
export function decode_locus_document_commit(
  commit: LocusCanonicalCommit,
): LocusDecodedDocumentCommit {
  if (commit.mode !== "element" && commit.mode !== "fragment") {
    throw new Error("Locus canonical commit is not a document commit.");
  }
  const operations: LiveMapGraphOp[] = [];
  for (const operation of commit.ops) {
    if (!("domain" in operation)) {
      throw new Error("Locus document commit contains a projected operation.");
    }
    if (is_projected_identity_operation(operation)) {
      throw new Error("Locus document commit contains a projected identity operation.");
    }
    if (operation.op === "replace-root") {
      const root = decode_locus_graph_content(operation.root);
      if (!is_Node(root)) throw new Error("Locus replace-root payload did not decode to a node.");
      operations.push({ ...operation, root });
    } else if (operation.op === "replace-content") {
      operations.push({ ...operation, replacement: decode_locus_graph_content(operation.replacement) });
    } else if (operation.op === "insert-content") {
      operations.push({ ...operation, content: decode_locus_graph_content(operation.content) });
    } else {
      operations.push(operation);
    }
  }
  return Object.freeze({
    changed: true,
    prevRev: commit.prevRev,
    rev: commit.rev,
    ops: Object.freeze(operations),
  });
}

/** @internal Replay one current canonical document commit. */
export function replay_locus_document_commit(
  map: DocumentLiveMap,
  commit: LocusCanonicalCommit,
): LiveMapGraphCommit {
  if (commit.mode !== map.mode) {
    throw new Error(`Locus document commit mode ${commit.mode} does not match map mode ${map.mode}.`);
  }
  return Reflect.apply(map.replay, map, [decode_locus_document_commit(commit)]);
}

function decode_snapshot(value: unknown): LocusResult<LocusValidatedSnapshotEnvelope> {
  if (!is_record(value)) {
    return fail("Malformed Locus recovery snapshot envelope.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    });
  }
  const logicalMapId = required_string(value.logicalMapId);
  const incarnationId = required_string(value.incarnationId);
  const rev = required_rev(value.rev);
  const mode = decode_mode(value.mode);
  if (!logicalMapId || !incarnationId || rev === undefined || mode === undefined) {
    return fail("Malformed Locus recovery snapshot envelope.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    });
  }

  const hasHson = Object.prototype.hasOwnProperty.call(value, "hson");
  const hasFormat = Object.prototype.hasOwnProperty.call(value, "format");
  const hasPayload = Object.prototype.hasOwnProperty.call(value, "payload");
  const hasRepresentationField = hasFormat || hasPayload;

  if (hasHson) {
    if (hasRepresentationField
      || !has_exact_keys(value, ["logicalMapId", "incarnationId", "rev", "mode", "hson"])
      || typeof value.hson !== "string") {
      return fail("Malformed or ambiguous Locus recovery snapshot envelope.", {
        code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
      });
    }
    return ok(Object.freeze({ logicalMapId, incarnationId, rev, mode, hson: value.hson }));
  }

  if (!hasRepresentationField) {
    return fail("Malformed Locus recovery snapshot envelope.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    });
  }
  if (!has_exact_keys(value, ["logicalMapId", "incarnationId", "rev", "mode", "format", "payload"])) {
    return fail("Malformed Locus view-state snapshot envelope.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    });
  }
  if (value.format !== "view-state") {
    return fail("Locus view-state snapshot format is unsupported.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_FORMAT_UNSUPPORTED",
    });
  }
  if (typeof value.payload !== "string") {
    return fail("Malformed Locus view-state snapshot envelope.", {
      code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    });
  }
  return ok(Object.freeze({
    logicalMapId,
    incarnationId,
    rev,
    mode,
    format: value.format,
    payload: value.payload,
  }));
}

function optional_string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function decode_hello_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientHelloMessage> {
  if (Object.hasOwn(value, "lastSeq") || Object.hasOwn(value, "hostId")) {
    return fail("Locus hello contains a removed field.");
  }
  const clientId = optional_string(value.clientId);

  return ok({
    type: "hello",
    ...(clientId ? { clientId } : {}),
  });
}

function decode_action_message<TActions extends LocusActionPayloads>(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientActionMessage<TActions>> {
  const id = optional_string(value.id);
  if (!id) return fail("Locus action message requires string id.");

  const name = optional_string(value.name);
  if (!name) return fail("Locus action message requires string name.");

  const payload = value.payload;
  if (payload !== undefined && !is_locus_json_value(payload)) {
    return fail("Locus action payload must be JSON-serializable.");
  }

  const requestId = optional_string(value.requestId);
  const attemptId = optional_string(value.attemptId);
  const clientId = optional_string(value.clientId);
  const hasStableIdentity = requestId !== undefined || clientId !== undefined || attemptId !== undefined || value.retry !== undefined;
  if (hasStableIdentity) {
    if (requestId === undefined) return fail("Locus action request requires requestId.", { code: "LOCUS_ACTION_REQUEST_ID_MISSING" });
    if (clientId === undefined) return fail("Locus action request requires clientId.", { code: "LOCUS_ACTION_REQUEST_ID_MISSING" });
    if (requestId.length === 0 || clientId.length === 0 || requestId.length > 256 || clientId.length > 256 || (attemptId !== undefined && (attemptId.length === 0 || attemptId.length > 256))) {
      return fail("Locus action request identity is malformed.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
    }
    if (value.retry !== undefined && value.retry !== true) {
      return fail("Locus action retry marker is malformed.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
    }
  }

  const message = {
    type: "action",
    id,
    name,
    ...(payload !== undefined ? { payload } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(attemptId !== undefined ? { attemptId } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(value.retry === true ? { retry: true as const } : {}),
  } as LocusClientActionMessage<TActions>;

  return ok(message);
}

function decode_action_status_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientActionStatusMessage> {
  const id = required_string(value.id);
  const clientId = required_string(value.clientId);
  const requestId = required_string(value.requestId);
  if (!id || !clientId || !requestId || clientId.length > 256 || requestId.length > 256 || !has_exact_keys(value, ["type", "id", "clientId", "requestId"])) {
    return fail("Malformed Locus action-status request.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
  }
  return ok({ type: "action-status", id, clientId, requestId });
}

function decode_subscribe_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSubscribeMessage> {
  if (!is_live_path(value.path)) return fail("Locus subscribe message requires path.");
  return ok({ type: "subscribe", path: value.path });
}

function decode_unsubscribe_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientUnsubscribeMessage> {
  if (!is_live_path(value.path)) return fail("Locus unsubscribe message requires path.");
  return ok({ type: "unsubscribe", path: value.path });
}

function decode_recover_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientRecoverMessage> {
  const id = required_string(value.id);
  const logicalMapId = required_string(value.logicalMapId);
  if (!id || !logicalMapId) return fail("Locus recovery message requires non-empty id and logicalMapId.");
  const hasIncarnation = Object.prototype.hasOwnProperty.call(value, "incarnationId");
  const hasRevision = Object.prototype.hasOwnProperty.call(value, "lastAppliedRev");
  const hasCapabilities = Object.prototype.hasOwnProperty.call(value, "snapshotCapabilities");
  if (hasIncarnation !== hasRevision) return fail("Locus recovery cursor requires both incarnationId and lastAppliedRev.");
  const snapshotCapabilities = hasCapabilities
    ? decode_snapshot_capabilities(value.snapshotCapabilities)
    : undefined;
  if (hasCapabilities && snapshotCapabilities === undefined) {
    return fail("Locus snapshot capabilities are malformed.", {
      code: "LOCUS_SNAPSHOT_CAPABILITIES_INVALID",
    });
  }
  const baseKeys = ["type", "id", "logicalMapId", ...(hasCapabilities ? ["snapshotCapabilities"] : [])];
  if (!hasIncarnation) {
    if (!has_exact_keys(value, baseKeys)) return fail("Locus recovery request has unknown fields.");
    return ok({ type: "recover", id, logicalMapId, ...(snapshotCapabilities ? { snapshotCapabilities } : {}) });
  }
  const incarnationId = required_string(value.incarnationId);
  const lastAppliedRev = required_rev(value.lastAppliedRev);
  if (!incarnationId || lastAppliedRev === undefined) return fail("Locus recovery cursor is invalid.");
  if (!has_exact_keys(value, [...baseKeys, "incarnationId", "lastAppliedRev"])) {
    return fail("Locus recovery request has unknown fields.");
  }
  return ok({
    type: "recover",
    id,
    logicalMapId,
    incarnationId,
    lastAppliedRev,
    ...(snapshotCapabilities ? { snapshotCapabilities } : {}),
  });
}

function decode_snapshot_capabilities(value: unknown): LocusSnapshotCapabilities | undefined {
  if (!is_record(value)) return undefined;
  const hasViewState = Object.prototype.hasOwnProperty.call(value, "viewState");
  if (!has_exact_keys(value, hasViewState ? ["hson", "viewState"] : ["hson"])
    || value.hson !== true
    || (hasViewState && value.viewState !== true)) {
    return undefined;
  }
  return Object.freeze({ hson: true, ...(hasViewState ? { viewState: true as const } : {}) });
}

function decode_session_create_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionCreateMessage> {
  const id = required_string(value.id);
  if (!id || !has_exact_keys(value, ["type", "id"])) return fail("Malformed Locus session-create message.");
  return ok({ type: "session-create", id });
}

function decode_session_attach_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionAttachMessage> {
  const id = required_string(value.id);
  if (!id) return fail("Locus session-attach message requires non-empty id.");
  if (!has_exact_keys(value, ["type", "id", "credential"]) && !has_exact_keys(value, ["type", "id"])) {
    return fail("Malformed Locus session-attach message.");
  }
  return ok({ type: "session-attach", id, ...(Object.prototype.hasOwnProperty.call(value, "credential") ? { credential: value.credential } : {}) });
}

function decode_session_goodbye_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionGoodbyeMessage> {
  const id = required_string(value.id);
  if (!id || !has_exact_keys(value, ["type", "id"])) return fail("Malformed Locus session-goodbye message.");
  return ok({ type: "session-goodbye", id });
}

export function encode_locus_message(message: LocusServerMessage): string {
  if (message.type === "event") {
    if (!message.event) throw new Error("Locus event message requires non-empty event.");
    if (!is_locus_json_value(message.payload)) {
      throw new Error("Locus event payload must be JSON-serializable.");
    }
  }
  return JSON.stringify(message);
}

function decode_server_event_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusServerEventMessage> {
  if (!has_exact_keys(value, ["type", "event", "payload"])) {
    return fail("Locus event message requires exactly type, event, and payload.");
  }
  if (typeof value.event !== "string" || value.event.length === 0) {
    return fail("Locus event message requires non-empty event.");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "payload") || !is_locus_json_value(value.payload)) {
    return fail("Locus event payload must be JSON-serializable.");
  }
  return ok({ type: "event", event: value.event, payload: value.payload });
}

function decode_snapshot_encoding(value: unknown): LocusSnapshotEncodingSelection | undefined {
  if (!is_record(value)) return undefined;
  if (!has_exact_keys(value, ["format"])) return undefined;
  if (value.format === "hson") return Object.freeze({ format: "hson" });
  if (value.format === "view-state") return Object.freeze({ format: "view-state" });
  return undefined;
}

function decode_recovery_server_message(
  value: Readonly<Record<string, unknown>>,
): LocusResult<LocusDecodedServerMessage> {
  const id = required_string(value.id);
  if (!id) return fail("Locus recovery server message requires non-empty id.");

  if (value.type === "recovery-commit") {
    const commit = decode_locus_canonical_commit(value.commit);
    if (!has_exact_keys(value, ["type", "id", "phase", "commit"]) || (value.phase !== "body" && value.phase !== "tail") || !commit) {
      return fail("Malformed Locus recovery commit message.");
    }
    const message: LocusDecodedServerRecoveryCommitMessage = { type: "recovery-commit", id, phase: value.phase, commit };
    return ok(message);
  }
  if (value.type === "commit") {
    const commit = decode_locus_canonical_commit(value.commit);
    if (!has_exact_keys(value, ["type", "id", "commit"]) || !commit) return fail("Malformed Locus canonical commit message.");
    const message: LocusDecodedServerCanonicalCommitMessage = { type: "commit", id, commit };
    return ok(message);
  }
  if (value.type === "recovery-snapshot") {
    if (!has_exact_keys(value, ["type", "id", "snapshot"])) {
      return fail("Malformed Locus recovery snapshot message.", {
        code: "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
      });
    }
    const decoded = decode_snapshot(value.snapshot);
    if (!decoded.ok) return decoded;
    const message: LocusDecodedServerRecoverySnapshotMessage = {
      type: "recovery-snapshot",
      id,
      snapshot: decoded.value,
    };
    return ok(message);
  }
  if (value.type === "recovery-caught-up") {
    if (!has_exact_keys(value, ["type", "id", "caughtUp"]) || !is_record(value.caughtUp)) return fail("Malformed Locus recovery caught-up message.");
    const caught = value.caughtUp;
    const logicalMapId = required_string(caught.logicalMapId);
    const incarnationId = required_string(caught.incarnationId);
    const throughRev = required_rev(caught.throughRev);
    if (!has_exact_keys(caught, ["kind", "logicalMapId", "incarnationId", "throughRev"]) || caught.kind !== "caught_up" || !logicalMapId || !incarnationId || throughRev === undefined) return fail("Malformed Locus recovery caught-up value.");
    const message: LocusServerRecoveryCaughtUpMessage = { type: "recovery-caught-up", id, caughtUp: { kind: "caught_up", logicalMapId, incarnationId, throughRev } };
    return ok(message);
  }
  if (value.type === "recovery-plan") {
    const sessionId = required_string(value.sessionId);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const headRev = required_rev(value.headRev);
    if (!sessionId || !logicalMapId || !incarnationId || headRev === undefined) return fail("Malformed Locus recovery plan metadata.");
    const hasSnapshotEncoding = Object.prototype.hasOwnProperty.call(value, "snapshotEncoding");
    const snapshotEncoding = hasSnapshotEncoding ? decode_snapshot_encoding(value.snapshotEncoding) : undefined;
    if (hasSnapshotEncoding && snapshotEncoding === undefined) {
      return fail("Locus snapshot encoding acknowledgment is malformed.", {
        code: "LOCUS_SNAPSHOT_NEGOTIATION_INVALID",
      });
    }
    const encodingKeys = hasSnapshotEncoding ? ["snapshotEncoding"] : [];
    const base = {
      type: "recovery-plan" as const,
      id,
      sessionId,
      logicalMapId,
      incarnationId,
      headRev,
      ...(snapshotEncoding ? { snapshotEncoding } : {}),
    };
    let message: LocusServerRecoveryPlanMessage;
    if (value.outcome === "current" || value.outcome === "replay") {
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome", ...encodingKeys])) return fail("Malformed Locus recovery plan.");
      message = { ...base, outcome: value.outcome };
    } else if (value.outcome === "snapshot") {
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome", "reason", ...encodingKeys]) || (value.reason !== "no_usable_revision" && value.reason !== "incarnation_mismatch" && value.reason !== "history_unavailable")) return fail("Malformed Locus snapshot plan.");
      message = { ...base, outcome: "snapshot", reason: value.reason };
    } else if (value.outcome === "reject" && is_record(value.error)) {
      const error = value.error;
      const code = error.code;
      const messageText = required_string(error.message);
      const authoritativeRev = required_rev(error.authoritativeRev);
      const errorIncarnation = required_string(error.incarnationId);
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome", "error", ...encodingKeys]) || !has_exact_keys(error, ["code", "message", "authoritativeRev", "incarnationId"]) || (code !== "LOCUS_RECOVERY_INVALID_TARGET" && code !== "LOCUS_RECOVERY_INVALID_REQUEST" && code !== "REVISION_AHEAD_OF_AUTHORITY") || !messageText || authoritativeRev === undefined || !errorIncarnation) return fail("Malformed Locus recovery rejection.");
      message = { ...base, outcome: "reject", error: { code, message: messageText, authoritativeRev, incarnationId: errorIncarnation } };
    } else return fail("Unknown Locus recovery plan outcome.");
    return ok(message);
  }
  if (value.type === "recovery-error") {
    if (!has_exact_keys(value, ["type", "id", "error"]) || !is_record(value.error)) return fail("Malformed Locus recovery error.");
    const messageText = required_string(value.error.message);
    const code = optional_string(value.error.code);
    if (!messageText) return fail("Malformed Locus recovery error value.");
    const message: LocusServerRecoveryErrorMessage = { type: "recovery-error", id, error: { message: messageText, ...(code ? { code } : {}) } };
    return ok(message);
  }
  return fail("Unknown Locus recovery server message type.");
}

const SESSION_REJECT_CODES = new Set([
  "LOCUS_SESSION_CREDENTIAL_MISSING",
  "LOCUS_SESSION_CREDENTIAL_MALFORMED",
  "LOCUS_SESSION_CREDENTIAL_UNKNOWN",
  "LOCUS_SESSION_CREDENTIAL_EXPIRED",
  "LOCUS_SESSION_CREDENTIAL_REVOKED",
  "LOCUS_SESSION_ATTACHMENT_FENCED",
  "LOCUS_SESSION_NOT_ATTACHED",
  "LOCUS_SESSION_ALREADY_GONE",
]);

function decode_session_server_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusServerMessage> {
  const sessionId = required_string(value.sessionId);
  const epoch = required_rev(value.epoch);
  if (value.type === "session-fenced") {
    if (!sessionId || epoch === undefined || value.code !== "LOCUS_SESSION_ATTACHMENT_FENCED" || !has_exact_keys(value, ["type", "sessionId", "epoch", "code"])) return fail("Malformed Locus session-fenced message.");
    const message: LocusServerSessionFencedMessage = { type: "session-fenced", sessionId, epoch, code: "LOCUS_SESSION_ATTACHMENT_FENCED" };
    return ok(message);
  }
  const id = required_string(value.id);
  if (!id) return fail("Locus session server message requires non-empty id.");
  if (value.type === "session-created") {
    const credential = required_string(value.credential);
    if (!sessionId || !credential || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "credential", "epoch"])) return fail("Malformed Locus session-created message.");
    const message: LocusServerSessionCreatedMessage = { type: "session-created", id, sessionId, credential, epoch };
    return ok(message);
  }
  if (value.type === "session-attached") {
    if (!sessionId || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "epoch"])) return fail("Malformed Locus session-attached message.");
    const message: LocusServerSessionAttachedMessage = { type: "session-attached", id, sessionId, epoch };
    return ok(message);
  }
  if (value.type === "session-ended") {
    if (!sessionId || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "epoch"])) return fail("Malformed Locus session-ended message.");
    const message: LocusServerSessionEndedMessage = { type: "session-ended", id, sessionId, epoch };
    return ok(message);
  }
  if (value.type === "session-rejected") {
    const code = required_string(value.code);
    const messageText = required_string(value.message);
    if (!code || !SESSION_REJECT_CODES.has(code) || !messageText || !has_exact_keys(value, ["type", "id", "code", "message"])) return fail("Malformed Locus session-rejected message.");
    const message: LocusServerSessionRejectedMessage = { type: "session-rejected", id, code: code as LocusServerSessionRejectedMessage["code"], message: messageText };
    return ok(message);
  }
  return fail("Unknown Locus session server message type.");
}

function decode_action_status_server_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusServerActionStatusMessage> {
  const id = required_string(value.id);
  const requestId = required_string(value.requestId);
  const state = value.state;
  if (!id || !requestId || (state !== "pending" && state !== "succeeded" && state !== "failed" && state !== "unknown" && state !== "expired")) {
    return fail("Malformed Locus action-status response.");
  }
  if (state === "pending" || state === "unknown" || state === "expired") {
    if (!has_exact_keys(value, ["type", "id", "requestId", "state"])) return fail("Malformed Locus non-terminal action status.");
    return ok({ type: "action-status", id, requestId, state });
  }
  if (!has_exact_keys(value, ["type", "id", "requestId", "state", "outcome"]) || !is_record(value.outcome)) return fail("Malformed Locus terminal action status.");
  const outcome = value.outcome;
  const seq = required_rev(outcome.seq);
  const completionRev = required_rev(outcome.completionRev);
  if (seq === undefined || completionRev === undefined || outcome.state !== state) return fail("Malformed Locus terminal action outcome.");
  if (state === "succeeded") {
    const allowed = Object.prototype.hasOwnProperty.call(outcome, "result") ? ["state", "seq", "completionRev", "result"] : ["state", "seq", "completionRev"];
    if (!has_exact_keys(outcome, allowed) || (Object.prototype.hasOwnProperty.call(outcome, "result") && !is_locus_json_value(outcome.result))) return fail("Malformed Locus succeeded action outcome.");
    return ok({ type: "action-status", id, requestId, state, outcome: { state, seq, completionRev, ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result as JsonValue } : {}) } });
  }
  if (!has_exact_keys(outcome, ["state", "seq", "completionRev", "error"]) || !is_record(outcome.error)) return fail("Malformed Locus failed action outcome.");
  const message = required_string(outcome.error.message);
  const code = optional_string(outcome.error.code);
  if (!message) return fail("Malformed Locus failed action error.");
  return ok({ type: "action-status", id, requestId, state, outcome: { state, seq, completionRev, error: { message, ...(code ? { code } : {}) } } });
}

/** Decode the current public Locus server-message contract. */
export function decode_locus_server_message(message: string): LocusResult<LocusServerMessage> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("Locus server message must be an object.");
    if (value.type === "event") return decode_server_event_message(value);
    if (value.type === "recovery-plan" || value.type === "recovery-commit" || value.type === "recovery-snapshot" || value.type === "recovery-caught-up" || value.type === "commit" || value.type === "recovery-error") {
      return decode_recovery_server_message(value);
    }
    if (value.type === "session-created" || value.type === "session-attached" || value.type === "session-rejected" || value.type === "session-fenced" || value.type === "session-ended") {
      return decode_session_server_message(value);
    }
    if (value.type === "action-status") return decode_action_status_server_message(value);
    if (
      value.type === "hello"
      || value.type === "patch"
      || value.type === "sync"
      || value.type === "ack"
      || value.type === "error"
    ) {
      return ok(value as LocusServerMessage);
    }
    return fail("Unknown Locus server message type.");
  } catch (cause) {
    return fail("Invalid Locus server message JSON.", { cause });
  }
}

export function decode_locus_message<TActions extends LocusActionPayloads = LocusActionPayloads>(message: string): LocusResult<LocusClientMessage<TActions>> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("Locus message must be an object.");

    const type = value.type;
    if (type === "hello") return decode_hello_message(value);
    if (type === "action") return decode_action_message<TActions>(value);
    if (type === "action-status") return decode_action_status_message(value);
    if (type === "subscribe") return decode_subscribe_message(value);
    if (type === "unsubscribe") return decode_unsubscribe_message(value);
    if (type === "recover") return decode_recover_message(value);
    if (type === "session-create") return decode_session_create_message(value);
    if (type === "session-attach") return decode_session_attach_message(value);
    if (type === "session-goodbye") return decode_session_goodbye_message(value);

    return fail("Unknown Locus message type.");
  } catch (cause) {
    return fail("Invalid Locus message JSON.", { cause });
  }
}
