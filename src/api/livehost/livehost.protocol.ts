// livehost/protocol.ts

import type {
  LiveHostClientActionMessage,
  LiveHostClientActionStatusMessage,
  LiveHostClientHelloMessage,
  LiveHostClientMessage,
  LiveHostClientRecoverMessage,
  LiveHostClientSessionAttachMessage,
  LiveHostClientSessionCreateMessage,
  LiveHostClientSessionGoodbyeMessage,
  LiveHostClientSubscribeMessage,
  LiveHostClientUnsubscribeMessage,
  LiveHostError,
  LiveHostResult,
  LiveHostServerMessage,
  LiveHostServerEventMessage,
  LiveHostActionPayloads,
  LiveHostCanonicalCommit,
  LiveHostCanonicalOp,
  LiveHostServerCanonicalCommitMessage,
  LiveHostServerActionStatusMessage,
  LiveHostServerRecoveryCaughtUpMessage,
  LiveHostServerRecoveryCommitMessage,
  LiveHostServerRecoveryErrorMessage,
  LiveHostServerRecoveryPlanMessage,
  LiveHostServerRecoverySnapshotMessage,
  LiveHostServerSessionAttachedMessage,
  LiveHostServerSessionCreatedMessage,
  LiveHostServerSessionEndedMessage,
  LiveHostServerSessionFencedMessage,
  LiveHostServerSessionRejectedMessage,
  LiveHostSnapshotEnvelope,
  LiveHostWireValue,
} from "../../types/livehost.types.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { CssMap } from "../../core/style.types.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "../../core/types.js";
import { classify_live_root_mode } from "../livemap/livemap.document.js";
import { index_livemap_document_elements } from "../livemap/livemap.document.identity.js";
import type {
  DocumentLiveMapMode,
  JsonValue,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentContent,
  LiveMapDocumentTarget,
  LiveMapGraphOp,
  LiveMapRootMode,
  LivePath,
} from "../../types/index.js";

function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(message: string, extra?: Omit<LiveHostError, "message">): LiveHostResult<never> {
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

export function is_livehost_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_livehost_json_value);
  if (!is_record(value)) return false;
  return Object.values(value).every(is_livehost_json_value);
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

function decode_wire_value(value: unknown): LiveHostWireValue | undefined {
  if (!is_record(value)) return undefined;
  if (value.present === false && has_exact_keys(value, ["present"])) return Object.freeze({ present: false });
  if (value.present !== true || !has_exact_keys(value, ["present", "value"]) || !is_livehost_json_value(value.value)) {
    return undefined;
  }
  return Object.freeze({ present: true, value: clone_json(value.value) });
}

function decode_projected_canonical_op(value: unknown): LiveHostCanonicalOp | undefined {
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
    if (!value.removed.every(is_livehost_json_value) || !value.inserted.every(is_livehost_json_value)) return undefined;
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
  return undefined;
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

function decode_hson_attrs(value: unknown): HsonAttrs | undefined {
  if (!is_record(value)) return undefined;
  const attrs: HsonAttrs = {};
  for (const [key, item] of Object.entries(value)) {
    if (is_finite_primitive(item)) attrs[key] = item;
    else if (key === "style") {
      const style = decode_style_map(item);
      if (style === undefined) return undefined;
      attrs.style = style;
    } else return undefined;
  }
  return Object.freeze(attrs);
}

function decode_hson_meta(value: unknown): HsonMeta | undefined {
  if (!is_record(value)) return undefined;
  const meta: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.startsWith("data-_") || typeof item !== "string") return undefined;
    meta[key] = item;
  }
  return Object.freeze(meta);
}

function decode_hson_node(value: unknown): HsonNode | undefined {
  if (!is_record(value)) return undefined;
  const allowedKeys = ["$_tag", "$_content"];
  if (Object.prototype.hasOwnProperty.call(value, "$_meta")) allowedKeys.push("$_meta");
  if (Object.prototype.hasOwnProperty.call(value, "$_attrs")) allowedKeys.push("$_attrs");
  if (!has_exact_keys(value, allowedKeys) || typeof value.$_tag !== "string" || !Array.isArray(value.$_content)) {
    return undefined;
  }

  const meta = Object.prototype.hasOwnProperty.call(value, "$_meta")
    ? decode_hson_meta(value.$_meta)
    : undefined;
  const attrs = Object.prototype.hasOwnProperty.call(value, "$_attrs")
    ? decode_hson_attrs(value.$_attrs)
    : undefined;
  if ((Object.prototype.hasOwnProperty.call(value, "$_meta") && meta === undefined)
    || (Object.prototype.hasOwnProperty.call(value, "$_attrs") && attrs === undefined)) return undefined;

  const content: Array<HsonNode | Primitive> = [];
  for (const item of value.$_content) {
    if (is_finite_primitive(item)) content.push(item);
    else {
      const child = decode_hson_node(item);
      if (child === undefined) return undefined;
      content.push(child);
    }
  }
  Object.freeze(content);
  const node: HsonNode = {
    $_tag: value.$_tag,
    ...(meta === undefined ? {} : { $_meta: meta }),
    ...(attrs === undefined ? {} : { $_attrs: attrs }),
    $_content: content,
  };
  Object.freeze(node);
  return node;
}

function validate_canonical_node(value: unknown): HsonNode | undefined {
  const node = decode_hson_node(value);
  if (node === undefined) return undefined;
  try {
    assert_invariants(node, "decode_livehost_graph_operation");
    index_livemap_document_elements(node);
    return node;
  } catch {
    return undefined;
  }
}

function decode_document_target(value: unknown): LiveMapDocumentTarget | undefined {
  if (!is_record(value)) return undefined;
  if (value.kind === "path" && has_exact_keys(value, ["kind", "path"]) && Array.isArray(value.path)) {
    if (!value.path.every((part) => typeof part === "number" && Number.isInteger(part) && part >= 0)) return undefined;
    return Object.freeze({ kind: "path", path: Object.freeze([...value.path]) });
  }
  if (value.kind === "quid" && has_exact_keys(value, ["kind", "quid"]) && is_persisted_quid(value.quid)) {
    return Object.freeze({ kind: "quid", quid: value.quid });
  }
  return undefined;
}

const HSON_ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

function decode_attribute_name(value: unknown): string | undefined {
  return typeof value === "string" && HSON_ATTR_NAME.test(value) && !value.startsWith("data-_")
    ? value
    : undefined;
}

function decode_attribute_value(name: string, value: unknown): LiveMapDocumentAttributeValue | undefined {
  if (is_finite_primitive(value)) return value;
  return name === "style" ? decode_style_map(value) : undefined;
}

function decode_document_content(value: unknown): LiveMapDocumentContent | undefined {
  if (is_finite_primitive(value)) return value;
  const node = decode_hson_node(value);
  if (node === undefined) return undefined;
  try {
    const validationRoot: HsonNode = node.$_tag === ELEM_TAG
      ? {
        $_tag: ROOT_TAG,
        $_content: [{
          $_tag: ELEM_TAG,
          $_content: [{ $_tag: "div", $_content: [node] }],
        }],
      }
      : node;
    assert_invariants(validationRoot, "decode_livehost_graph_content");
    index_livemap_document_elements(validationRoot);
    return node;
  } catch {
    return undefined;
  }
}

/** Shared strict payload decoders used by graph commits and hosted document actions. */
export function decode_livehost_document_target(value: unknown): LiveMapDocumentTarget | undefined {
  return decode_document_target(value);
}

export function decode_livehost_document_attribute_name(value: unknown): string | undefined {
  return decode_attribute_name(value);
}

export function decode_livehost_document_attribute_value(
  name: string,
  value: unknown,
): LiveMapDocumentAttributeValue | undefined {
  return decode_attribute_value(name, value);
}

export function decode_livehost_document_content(value: unknown): LiveMapDocumentContent | undefined {
  return decode_document_content(value);
}

function decode_graph_op(value: unknown, mode: DocumentLiveMapMode): LiveMapGraphOp | undefined {
  if (!is_record(value) || value.domain !== "graph") return undefined;
  if (value.op === "replace-root") {
    if (!has_exact_keys(value, ["domain", "op", "mode", "root"]) || value.mode !== mode) return undefined;
    const root = validate_canonical_node(value.root);
    if (root === undefined) return undefined;
    try {
      if (classify_live_root_mode(root) !== mode) return undefined;
    } catch {
      return undefined;
    }
    return Object.freeze({ domain: "graph", op: "replace-root", mode, root });
  }

  const target = decode_document_target(value.target);
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
  if (value.op === "replace-content") {
    if (!has_exact_keys(value, ["domain", "op", "target", "index", "replacement"])) return undefined;
    const index = required_rev(value.index);
    if (index === undefined) return undefined;
    const replacement = decode_document_content(value.replacement);
    return replacement === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "replace-content", target, index, replacement });
  }
  return undefined;
}

function decode_canonical_commit(value: unknown): LiveHostCanonicalCommit | undefined {
  if (!is_record(value) || !has_exact_keys(value, ["logicalMapId", "incarnationId", "mode", "prevRev", "rev", "ops"])) return undefined;
  const logicalMapId = required_string(value.logicalMapId);
  const incarnationId = required_string(value.incarnationId);
  const mode = decode_mode(value.mode);
  const prevRev = required_rev(value.prevRev);
  const rev = required_rev(value.rev);
  if (!logicalMapId || !incarnationId || mode === undefined || prevRev === undefined || rev !== prevRev + 1) return undefined;
  if (!Array.isArray(value.ops) || value.ops.length === 0) return undefined;
  const ops: LiveHostCanonicalOp[] = [];
  for (const item of value.ops) {
    const op = mode === "element" || mode === "fragment"
      ? decode_graph_op(item, mode)
      : decode_projected_canonical_op(item);
    if (!op) return undefined;
    ops.push(op);
  }
  return Object.freeze({ logicalMapId, incarnationId, mode, prevRev, rev, ops: Object.freeze(ops) });
}

function decode_snapshot(value: unknown): LiveHostSnapshotEnvelope | undefined {
  if (!is_record(value) || !has_exact_keys(value, ["logicalMapId", "incarnationId", "rev", "mode", "hson"])) return undefined;
  const logicalMapId = required_string(value.logicalMapId);
  const incarnationId = required_string(value.incarnationId);
  const rev = required_rev(value.rev);
  const mode = decode_mode(value.mode);
  if (!logicalMapId || !incarnationId || rev === undefined || mode === undefined || typeof value.hson !== "string") return undefined;
  return Object.freeze({ logicalMapId, incarnationId, rev, mode, hson: value.hson });
}

function optional_string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optional_seq(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function decode_hello_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientHelloMessage> {
  const clientId = optional_string(value.clientId);
  const hostId = optional_string(value.hostId);
  const lastSeq = optional_seq(value.lastSeq);

  return ok({
    type: "hello",
    ...(clientId ? { clientId } : {}),
    ...(hostId ? { hostId } : {}),
    ...(lastSeq !== undefined ? { lastSeq } : {}),
  });
}

function decode_action_message<TActions extends LiveHostActionPayloads>(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientActionMessage<TActions>> {
  const id = optional_string(value.id);
  if (!id) return fail("LiveHost action message requires string id.");

  const name = optional_string(value.name);
  if (!name) return fail("LiveHost action message requires string name.");

  const payload = value.payload;
  if (payload !== undefined && !is_livehost_json_value(payload)) {
    return fail("LiveHost action payload must be JSON-serializable.");
  }

  const requestId = optional_string(value.requestId);
  const attemptId = optional_string(value.attemptId);
  const clientId = optional_string(value.clientId);
  const hasStableIdentity = requestId !== undefined || clientId !== undefined || attemptId !== undefined || value.retry !== undefined;
  if (hasStableIdentity) {
    if (requestId === undefined) return fail("LiveHost action request requires requestId.", { code: "LIVEHOST_ACTION_REQUEST_ID_MISSING" });
    if (clientId === undefined) return fail("LiveHost action request requires clientId.", { code: "LIVEHOST_ACTION_REQUEST_ID_MISSING" });
    if (requestId.length === 0 || clientId.length === 0 || requestId.length > 256 || clientId.length > 256 || (attemptId !== undefined && (attemptId.length === 0 || attemptId.length > 256))) {
      return fail("LiveHost action request identity is malformed.", { code: "LIVEHOST_ACTION_REQUEST_ID_MALFORMED" });
    }
    if (value.retry !== undefined && value.retry !== true) {
      return fail("LiveHost action retry marker is malformed.", { code: "LIVEHOST_ACTION_REQUEST_ID_MALFORMED" });
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
  } as LiveHostClientActionMessage<TActions>;

  return ok(message);
}

function decode_action_status_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientActionStatusMessage> {
  const id = required_string(value.id);
  const clientId = required_string(value.clientId);
  const requestId = required_string(value.requestId);
  if (!id || !clientId || !requestId || clientId.length > 256 || requestId.length > 256 || !has_exact_keys(value, ["type", "id", "clientId", "requestId"])) {
    return fail("Malformed LiveHost action-status request.", { code: "LIVEHOST_ACTION_REQUEST_ID_MALFORMED" });
  }
  return ok({ type: "action-status", id, clientId, requestId });
}

function decode_subscribe_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientSubscribeMessage> {
  if (!is_live_path(value.path)) return fail("LiveHost subscribe message requires path.");
  return ok({ type: "subscribe", path: value.path });
}

function decode_unsubscribe_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientUnsubscribeMessage> {
  if (!is_live_path(value.path)) return fail("LiveHost unsubscribe message requires path.");
  return ok({ type: "unsubscribe", path: value.path });
}

function decode_recover_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientRecoverMessage> {
  const id = required_string(value.id);
  const logicalMapId = required_string(value.logicalMapId);
  if (!id || !logicalMapId) return fail("LiveHost recovery message requires non-empty id and logicalMapId.");
  const hasIncarnation = Object.prototype.hasOwnProperty.call(value, "incarnationId");
  const hasRevision = Object.prototype.hasOwnProperty.call(value, "lastAppliedRev");
  if (hasIncarnation !== hasRevision) return fail("LiveHost recovery cursor requires both incarnationId and lastAppliedRev.");
  if (!hasIncarnation) {
    if (!has_exact_keys(value, ["type", "id", "logicalMapId"])) return fail("LiveHost recovery request has unknown fields.");
    return ok({ type: "recover", id, logicalMapId });
  }
  const incarnationId = required_string(value.incarnationId);
  const lastAppliedRev = required_rev(value.lastAppliedRev);
  if (!incarnationId || lastAppliedRev === undefined) return fail("LiveHost recovery cursor is invalid.");
  if (!has_exact_keys(value, ["type", "id", "logicalMapId", "incarnationId", "lastAppliedRev"])) {
    return fail("LiveHost recovery request has unknown fields.");
  }
  return ok({ type: "recover", id, logicalMapId, incarnationId, lastAppliedRev });
}

function decode_session_create_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientSessionCreateMessage> {
  const id = required_string(value.id);
  if (!id || !has_exact_keys(value, ["type", "id"])) return fail("Malformed LiveHost session-create message.");
  return ok({ type: "session-create", id });
}

function decode_session_attach_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientSessionAttachMessage> {
  const id = required_string(value.id);
  if (!id) return fail("LiveHost session-attach message requires non-empty id.");
  if (!has_exact_keys(value, ["type", "id", "credential"]) && !has_exact_keys(value, ["type", "id"])) {
    return fail("Malformed LiveHost session-attach message.");
  }
  return ok({ type: "session-attach", id, ...(Object.prototype.hasOwnProperty.call(value, "credential") ? { credential: value.credential } : {}) });
}

function decode_session_goodbye_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientSessionGoodbyeMessage> {
  const id = required_string(value.id);
  if (!id || !has_exact_keys(value, ["type", "id"])) return fail("Malformed LiveHost session-goodbye message.");
  return ok({ type: "session-goodbye", id });
}

export function encode_livehost_message(message: LiveHostServerMessage): string {
  if (message.type === "event") {
    if (!message.event) throw new Error("LiveHost event message requires non-empty event.");
    if (!is_livehost_json_value(message.payload)) {
      throw new Error("LiveHost event payload must be JSON-serializable.");
    }
  }
  return JSON.stringify(message);
}

function decode_server_event_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostServerEventMessage> {
  if (!has_exact_keys(value, ["type", "event", "payload"])) {
    return fail("LiveHost event message requires exactly type, event, and payload.");
  }
  if (typeof value.event !== "string" || value.event.length === 0) {
    return fail("LiveHost event message requires non-empty event.");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "payload") || !is_livehost_json_value(value.payload)) {
    return fail("LiveHost event payload must be JSON-serializable.");
  }
  return ok({ type: "event", event: value.event, payload: value.payload });
}

function decode_recovery_server_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostServerMessage> {
  const id = required_string(value.id);
  if (!id) return fail("LiveHost recovery server message requires non-empty id.");

  if (value.type === "recovery-commit") {
    const commit = decode_canonical_commit(value.commit);
    if (!has_exact_keys(value, ["type", "id", "phase", "commit"]) || (value.phase !== "body" && value.phase !== "tail") || !commit) {
      return fail("Malformed LiveHost recovery commit message.");
    }
    const message: LiveHostServerRecoveryCommitMessage = { type: "recovery-commit", id, phase: value.phase, commit };
    return ok(message);
  }
  if (value.type === "commit") {
    const commit = decode_canonical_commit(value.commit);
    if (!has_exact_keys(value, ["type", "id", "commit"]) || !commit) return fail("Malformed LiveHost canonical commit message.");
    const message: LiveHostServerCanonicalCommitMessage = { type: "commit", id, commit };
    return ok(message);
  }
  if (value.type === "recovery-snapshot") {
    const snapshot = decode_snapshot(value.snapshot);
    if (!has_exact_keys(value, ["type", "id", "snapshot"]) || !snapshot) return fail("Malformed LiveHost recovery snapshot message.");
    const message: LiveHostServerRecoverySnapshotMessage = { type: "recovery-snapshot", id, snapshot };
    return ok(message);
  }
  if (value.type === "recovery-caught-up") {
    if (!has_exact_keys(value, ["type", "id", "caughtUp"]) || !is_record(value.caughtUp)) return fail("Malformed LiveHost recovery caught-up message.");
    const caught = value.caughtUp;
    const logicalMapId = required_string(caught.logicalMapId);
    const incarnationId = required_string(caught.incarnationId);
    const throughRev = required_rev(caught.throughRev);
    if (!has_exact_keys(caught, ["kind", "logicalMapId", "incarnationId", "throughRev"]) || caught.kind !== "caught_up" || !logicalMapId || !incarnationId || throughRev === undefined) return fail("Malformed LiveHost recovery caught-up value.");
    const message: LiveHostServerRecoveryCaughtUpMessage = { type: "recovery-caught-up", id, caughtUp: { kind: "caught_up", logicalMapId, incarnationId, throughRev } };
    return ok(message);
  }
  if (value.type === "recovery-plan") {
    const sessionId = required_string(value.sessionId);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const headRev = required_rev(value.headRev);
    if (!sessionId || !logicalMapId || !incarnationId || headRev === undefined) return fail("Malformed LiveHost recovery plan metadata.");
    const base = { type: "recovery-plan" as const, id, sessionId, logicalMapId, incarnationId, headRev };
    let message: LiveHostServerRecoveryPlanMessage;
    if (value.outcome === "current" || value.outcome === "replay") {
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome"])) return fail("Malformed LiveHost recovery plan.");
      message = { ...base, outcome: value.outcome };
    } else if (value.outcome === "snapshot") {
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome", "reason"]) || (value.reason !== "no_usable_revision" && value.reason !== "incarnation_mismatch" && value.reason !== "history_unavailable")) return fail("Malformed LiveHost snapshot plan.");
      message = { ...base, outcome: "snapshot", reason: value.reason };
    } else if (value.outcome === "reject" && is_record(value.error)) {
      const error = value.error;
      const code = error.code;
      const messageText = required_string(error.message);
      const authoritativeRev = required_rev(error.authoritativeRev);
      const errorIncarnation = required_string(error.incarnationId);
      if (!has_exact_keys(value, ["type", "id", "sessionId", "logicalMapId", "incarnationId", "headRev", "outcome", "error"]) || !has_exact_keys(error, ["code", "message", "authoritativeRev", "incarnationId"]) || (code !== "LIVEHOST_RECOVERY_INVALID_TARGET" && code !== "LIVEHOST_RECOVERY_INVALID_REQUEST" && code !== "REVISION_AHEAD_OF_AUTHORITY") || !messageText || authoritativeRev === undefined || !errorIncarnation) return fail("Malformed LiveHost recovery rejection.");
      message = { ...base, outcome: "reject", error: { code, message: messageText, authoritativeRev, incarnationId: errorIncarnation } };
    } else return fail("Unknown LiveHost recovery plan outcome.");
    return ok(message);
  }
  if (value.type === "recovery-error") {
    if (!has_exact_keys(value, ["type", "id", "error"]) || !is_record(value.error)) return fail("Malformed LiveHost recovery error.");
    const messageText = required_string(value.error.message);
    const code = optional_string(value.error.code);
    if (!messageText) return fail("Malformed LiveHost recovery error value.");
    const message: LiveHostServerRecoveryErrorMessage = { type: "recovery-error", id, error: { message: messageText, ...(code ? { code } : {}) } };
    return ok(message);
  }
  return fail("Unknown LiveHost recovery server message type.");
}

const SESSION_REJECT_CODES = new Set([
  "LIVEHOST_SESSION_CREDENTIAL_MISSING",
  "LIVEHOST_SESSION_CREDENTIAL_MALFORMED",
  "LIVEHOST_SESSION_CREDENTIAL_UNKNOWN",
  "LIVEHOST_SESSION_CREDENTIAL_EXPIRED",
  "LIVEHOST_SESSION_CREDENTIAL_REVOKED",
  "LIVEHOST_SESSION_ATTACHMENT_FENCED",
  "LIVEHOST_SESSION_NOT_ATTACHED",
  "LIVEHOST_SESSION_ALREADY_GONE",
]);

function decode_session_server_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostServerMessage> {
  const sessionId = required_string(value.sessionId);
  const epoch = required_rev(value.epoch);
  if (value.type === "session-fenced") {
    if (!sessionId || epoch === undefined || value.code !== "LIVEHOST_SESSION_ATTACHMENT_FENCED" || !has_exact_keys(value, ["type", "sessionId", "epoch", "code"])) return fail("Malformed LiveHost session-fenced message.");
    const message: LiveHostServerSessionFencedMessage = { type: "session-fenced", sessionId, epoch, code: "LIVEHOST_SESSION_ATTACHMENT_FENCED" };
    return ok(message);
  }
  const id = required_string(value.id);
  if (!id) return fail("LiveHost session server message requires non-empty id.");
  if (value.type === "session-created") {
    const credential = required_string(value.credential);
    if (!sessionId || !credential || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "credential", "epoch"])) return fail("Malformed LiveHost session-created message.");
    const message: LiveHostServerSessionCreatedMessage = { type: "session-created", id, sessionId, credential, epoch };
    return ok(message);
  }
  if (value.type === "session-attached") {
    if (!sessionId || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "epoch"])) return fail("Malformed LiveHost session-attached message.");
    const message: LiveHostServerSessionAttachedMessage = { type: "session-attached", id, sessionId, epoch };
    return ok(message);
  }
  if (value.type === "session-ended") {
    if (!sessionId || epoch === undefined || !has_exact_keys(value, ["type", "id", "sessionId", "epoch"])) return fail("Malformed LiveHost session-ended message.");
    const message: LiveHostServerSessionEndedMessage = { type: "session-ended", id, sessionId, epoch };
    return ok(message);
  }
  if (value.type === "session-rejected") {
    const code = required_string(value.code);
    const messageText = required_string(value.message);
    if (!code || !SESSION_REJECT_CODES.has(code) || !messageText || !has_exact_keys(value, ["type", "id", "code", "message"])) return fail("Malformed LiveHost session-rejected message.");
    const message: LiveHostServerSessionRejectedMessage = { type: "session-rejected", id, code: code as LiveHostServerSessionRejectedMessage["code"], message: messageText };
    return ok(message);
  }
  return fail("Unknown LiveHost session server message type.");
}

function decode_action_status_server_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostServerActionStatusMessage> {
  const id = required_string(value.id);
  const requestId = required_string(value.requestId);
  const state = value.state;
  if (!id || !requestId || (state !== "pending" && state !== "succeeded" && state !== "failed" && state !== "unknown" && state !== "expired")) {
    return fail("Malformed LiveHost action-status response.");
  }
  if (state === "pending" || state === "unknown" || state === "expired") {
    if (!has_exact_keys(value, ["type", "id", "requestId", "state"])) return fail("Malformed LiveHost non-terminal action status.");
    return ok({ type: "action-status", id, requestId, state });
  }
  if (!has_exact_keys(value, ["type", "id", "requestId", "state", "outcome"]) || !is_record(value.outcome)) return fail("Malformed LiveHost terminal action status.");
  const outcome = value.outcome;
  const seq = required_rev(outcome.seq);
  const completionRev = required_rev(outcome.completionRev);
  if (seq === undefined || completionRev === undefined || outcome.state !== state) return fail("Malformed LiveHost terminal action outcome.");
  if (state === "succeeded") {
    const allowed = Object.prototype.hasOwnProperty.call(outcome, "result") ? ["state", "seq", "completionRev", "result"] : ["state", "seq", "completionRev"];
    if (!has_exact_keys(outcome, allowed) || (Object.prototype.hasOwnProperty.call(outcome, "result") && !is_livehost_json_value(outcome.result))) return fail("Malformed LiveHost succeeded action outcome.");
    return ok({ type: "action-status", id, requestId, state, outcome: { state, seq, completionRev, ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result as JsonValue } : {}) } });
  }
  if (!has_exact_keys(outcome, ["state", "seq", "completionRev", "error"]) || !is_record(outcome.error)) return fail("Malformed LiveHost failed action outcome.");
  const message = required_string(outcome.error.message);
  const code = optional_string(outcome.error.code);
  if (!message) return fail("Malformed LiveHost failed action error.");
  return ok({ type: "action-status", id, requestId, state, outcome: { state, seq, completionRev, error: { message, ...(code ? { code } : {}) } } });
}

export function decode_livehost_server_message(message: string): LiveHostResult<LiveHostServerMessage> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("LiveHost server message must be an object.");
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
      return ok(value as LiveHostServerMessage);
    }
    return fail("Unknown LiveHost server message type.");
  } catch (cause) {
    return fail("Invalid LiveHost server message JSON.", { cause });
  }
}

export function decode_livehost_message<TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(message: string): LiveHostResult<LiveHostClientMessage<TActions>> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("LiveHost message must be an object.");

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

    return fail("Unknown LiveHost message type.");
  } catch (cause) {
    return fail("Invalid LiveHost message JSON.", { cause });
  }
}
