// locus/protocol.ts

import type {
  LocusClientActionMessage,
  LocusClientActionStatusMessage,
  LocusClientMessage,
  LocusClientSessionAttachMessage,
  LocusClientSessionCreateMessage,
  LocusClientSessionGoodbyeMessage,
  LocusError,
  LocusResult,
  LocusServerMessage,
  LocusServerEventMessage,
  LocusActionPayloads,
  LocusServerActionStatusMessage,
  LocusServerSessionAttachedMessage,
  LocusServerSessionCreatedMessage,
  LocusServerSessionEndedMessage,
  LocusServerSessionFencedMessage,
  LocusServerSessionRejectedMessage,
} from "../../src/types/locus.types.js";
import type { LocusCanonicalCommit, LocusCanonicalOp, LocusWireValue, LocusClientCommit, LocusClientProgress, LocusClientSnapshotEnvelope, LocusSnapshotCapabilities, LocusSnapshotEncodingSelection } from "./solo-locus-representation.types.js";
import { is_persisted_quid } from "../../src/core/persisted-quid.js";
import type { CssMap } from "../../src/core/style.types.js";
import type { JsonValue, Primitive } from "../../src/core/types.js";
import { is_Node } from "../../src/core/node-guards.js";
import { classify_live_root_mode } from "../../src/api/livemap/livemap.document.js";
import {
  decode_document_attrs,
  is_public_document_attr_name,
} from "../../src/api/livemap/livemap.document.attrs.js";
import type {
  DocumentLiveMapMode,
  DocumentLiveMap,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapRootMode,
  LivePath,
} from "../../src/types/livemap.types.js";
import type { LiveMapProjectedGraphEnsureQuidOp } from "../../src/api/livemap/livemap.identity.types.js";
import {
  decode_locus_graph_content,
  is_locus_encoded_graph_content,
} from "../../src/api/locus/locus.graph-content-codec.js";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.js";
import { normalize_replacement_lineage } from "../../src/api/livemap/livemap.document.lineage.js";
import {
  decode_hson_data_internal,
  encode_hson_data_internal,
  admit_hson_data_input,
  hson_data_text,
} from "../../src/api/data/hson-data.js";
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
  if (value === "data-object" || value === "data-array" || value === "document") {
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
    let decodedItem: Primitive | CssMap | undefined;
    if (item === undefined || is_finite_primitive(item)) decodedItem = item;
    else {
      const nested = decode_style_map(item);
      if (nested === undefined) return undefined;
      decodedItem = nested;
    }
    Object.defineProperty(decoded, key, {
      value: decodedItem,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(decoded);
}

function decode_document_target(value: unknown): LiveMapDocumentRequestTarget | undefined {
  if (!is_record(value)) return undefined;
  if (value.kind === "path" && has_exact_keys(value, ["kind", "path"])) {
    try {
      return Object.freeze({ kind: "path", path: validate_document_path(value.path) });
    } catch {
      return undefined;
    }
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
export function decode_locus_document_target(value: unknown): LiveMapDocumentRequestTarget | undefined {
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
    if (!has_exact_keys(value, ["domain", "op", "target", "index", "replacement", "lineage"])) return undefined;
    const index = required_rev(value.index);
    if (index === undefined) return undefined;
    const replacement = is_locus_encoded_graph_content(value.replacement) ? value.replacement : undefined;
    let lineage;
    try { lineage = normalize_replacement_lineage(value.lineage); } catch { return undefined; }
    return replacement === undefined
      ? undefined
      : Object.freeze({ domain: "graph", op: "replace-content", target, index, replacement, lineage });
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
    mode === "document"
    || value.format !== "structural-json"
    || typeof value.payload !== "string"
  )) return undefined;
  if (!Array.isArray(value.ops) || value.ops.length === 0) return undefined;
  const ops: LocusCanonicalOp[] = [];
  for (const item of value.ops) {
    const op = mode === "document"
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

/** @internal Exact authority-history decoder; path targets retain legacy identity evidence. */
export function decode_locus_canonical_commit(value: unknown): LocusCanonicalCommit | undefined {
  return decode_canonical_commit(value);
}

/** @internal Convert an encoded document commit into detached LiveMap-domain operations. */
export function decode_locus_document_commit(
  commit: LocusCanonicalCommit,
): LocusDecodedDocumentCommit {
  if (commit.mode !== "document") {
    throw new Error("Locus canonical commit is not a document commit.");
  }
  const operations: LiveMapGraphOp[] = [];
  for (const operation of commit.ops) {
    if (!("domain" in operation)) {
      throw new Error("Locus document commit contains a data operation.");
    }
    if (is_projected_identity_operation(operation)) {
      throw new Error("Locus document commit contains a data identity operation.");
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
