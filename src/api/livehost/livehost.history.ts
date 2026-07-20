// livehost.history.ts

import type {
  LiveMapAuthority,
  JsonValue,
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapGraphOp,
  LiveMapOp,
  LivePath,
} from "../../types/index.js";
import type {
  LiveHostCanonicalCommit,
  LiveHostCanonicalCommitListener,
  LiveHostCanonicalHistory,
  LiveHostCanonicalHistoryDiagnostics,
  LiveHostCanonicalOp,
  LiveHostCanonicalStream,
  LiveHostCanonicalStreamOptions,
  LiveHostIncarnationId,
  LiveHostLogicalMapId,
  LiveHostWireValue,
} from "../../types/livehost.types.js";
import { create_live_trace_context } from "./livehost.trace.js";
import { clone_node } from "../../core/clone-node.js";
import { is_Node } from "../../core/node-guards.js";
import { clone_live_root } from "../livemap/livemap.editor.js";

const DEFAULT_MAX_COMMITS = 1_024;
const DEFAULT_MAX_BYTES = 4 * 1_024 * 1_024;
const ABSENT_VALUE: Readonly<{ present: false }> = Object.freeze({ present: false });
const textEncoder = new TextEncoder();

let logicalMapIdIncrement = 0;
let incarnationIdIncrement = 0;

type RetainedCommit = Readonly<{
  commit: LiveHostCanonicalCommit;
  encodedBytes: number;
}>;

function make_logical_map_id(): LiveHostLogicalMapId {
  logicalMapIdIncrement += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `lhm-${uuid}`;
  return `lhm-${Date.now().toString(36)}-${logicalMapIdIncrement.toString(36)}`;
}

function make_incarnation_id(): LiveHostIncarnationId {
  incarnationIdIncrement += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `lhi-${uuid}`;
  return `lhi-${Date.now().toString(36)}-${incarnationIdIncrement.toString(36)}`;
}

function must_identity(value: string, name: string): string {
  if (value.length > 0) return value;
  throw new Error(`LiveHost ${name} must be a non-empty string.`);
}

function must_bound(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  throw new Error(`LiveHost canonical history ${name} must be a finite non-negative number.`);
}

function is_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_json_value);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(is_json_value);
}

function clone_json_value(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map(clone_json_value);
    Object.freeze(clone);
    return clone;
  }

  const clone: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) clone[key] = clone_json_value(item);
  Object.freeze(clone);
  return clone;
}

function wire_value(value: JsonValue | undefined, field: string): LiveHostWireValue {
  if (value === undefined) return ABSENT_VALUE;
  if (!is_json_value(value)) throw new Error(`LiveHost canonical commit ${field} is not JSON.`);
  return Object.freeze({ present: true, value: clone_json_value(value) });
}

function must_path(path: LivePath): LivePath {
  if (!Array.isArray(path)) throw new Error("LiveHost canonical commit path is not an array.");
  for (const part of path) {
    if (typeof part === "string") continue;
    if (typeof part === "number" && Number.isInteger(part) && part >= 0) continue;
    throw new Error("LiveHost canonical commit path contains an invalid segment.");
  }
  return Object.freeze([...path]);
}

function must_json_array(values: readonly JsonValue[], field: string): readonly JsonValue[] {
  if (!Array.isArray(values) || !values.every(is_json_value)) {
    throw new Error(`LiveHost canonical commit ${field} is not a JSON array.`);
  }
  return Object.freeze(values.map(clone_json_value));
}

function canonical_op(op: LiveMapOp): LiveHostCanonicalOp {
  const path = must_path(op.path);

  if (op.kind === "delete") {
    if (op.next !== undefined) throw new Error("LiveHost canonical delete next value must be absent.");
    return Object.freeze({
      kind: "delete",
      path,
      prev: wire_value(op.prev, "delete prev value"),
      next: ABSENT_VALUE,
    });
  }

  if (op.kind === "splice") {
    if (!Number.isInteger(op.start) || op.start < 0) {
      throw new Error("LiveHost canonical splice start must be a non-negative integer.");
    }
    if (!Array.isArray(op.prev) || !Array.isArray(op.next)) {
      throw new Error("LiveHost canonical splice prev and next values must be arrays.");
    }
    return Object.freeze({
      kind: "splice",
      path,
      start: op.start,
      removed: must_json_array(op.removed, "splice removed value"),
      inserted: must_json_array(op.inserted, "splice inserted value"),
      prev: wire_value(op.prev, "splice prev value"),
      next: wire_value(op.next, "splice next value"),
    });
  }

  if (op.next === undefined) {
    throw new Error(`LiveHost canonical ${op.kind} next value must be present.`);
  }

  if (op.kind === "set") {
    return Object.freeze({
      kind: "set",
      path,
      prev: wire_value(op.prev, "set prev value"),
      next: wire_value(op.next, "set next value"),
    });
  }

  if (op.kind === "replace") {
    return Object.freeze({
      kind: "replace",
      path,
      prev: wire_value(op.prev, "replace prev value"),
      next: wire_value(op.next, "replace next value"),
    });
  }

  throw new Error("LiveHost canonical commit operation kind is invalid.");
}

function canonical_graph_op(op: LiveMapGraphOp): LiveMapGraphOp {
  if (op.op === "replace-root") {
    return Object.freeze({
      domain: "graph",
      op: "replace-root",
      mode: op.mode,
      root: clone_live_root(op.root),
    });
  }
  const target = op.target.kind === "path"
    ? Object.freeze({ kind: "path" as const, path: Object.freeze([...op.target.path]) })
    : Object.freeze({ kind: "quid" as const, quid: op.target.quid });
  if (op.op === "set-attr") {
    return Object.freeze({
      domain: "graph",
      op: "set-attr",
      target,
      name: op.name,
      value: clone_node(op.value),
    });
  }
  if (op.op === "remove-attr") {
    return Object.freeze({ domain: "graph", op: "remove-attr", target, name: op.name });
  }
  if (op.op === "replace-attrs") {
    return Object.freeze({
      domain: "graph",
      op: "replace-attrs",
      target,
      attrs: clone_node(op.attrs),
    });
  }
  if (op.op === "replace-content") {
    return Object.freeze({
      domain: "graph",
      op: "replace-content",
      target,
      index: op.index,
      replacement: is_Node(op.replacement)
        ? clone_live_root(op.replacement)
        : op.replacement,
    });
  }
  if (op.op === "insert-content") {
    return Object.freeze({
      domain: "graph",
      op: "insert-content",
      target,
      index: op.index,
      content: is_Node(op.content) ? clone_live_root(op.content) : op.content,
    });
  }
  if (op.op === "remove-content") {
    return Object.freeze({ domain: "graph", op: "remove-content", target, index: op.index });
  }
  if (op.op === "move-content") {
    return Object.freeze({
      domain: "graph",
      op: "move-content",
      target,
      from: op.from,
      to: op.to,
    });
  }
  throw new Error("LiveHost canonical graph operation discriminant is invalid.");
}

function canonical_commit<TMap extends LiveMapAuthority>(
  map: TMap,
  commit: LiveMapCommit<LiveMapAnyOp>,
  logicalMapId: LiveHostLogicalMapId,
  incarnationId: LiveHostIncarnationId,
  expectedPrevRev: number,
): LiveHostCanonicalCommit {
  if (!commit.changed) throw new Error("LiveHost canonical history received an unchanged commit.");
  if (!Number.isInteger(commit.prevRev) || commit.prevRev < 0) {
    throw new Error("LiveHost canonical commit prevRev is invalid.");
  }
  if (!Number.isInteger(commit.rev) || commit.rev !== commit.prevRev + 1) {
    throw new Error("LiveHost canonical commit revision transition is invalid.");
  }
  if (commit.prevRev !== expectedPrevRev) {
    throw new Error(
      `LiveHost canonical commit is not contiguous: expected prevRev ${expectedPrevRev}, received ${commit.prevRev}.`,
    );
  }
  if (!Array.isArray(commit.ops) || commit.ops.length === 0) {
    throw new Error("LiveHost canonical changed commit must contain operations.");
  }
  const documentMode = map.mode === "element" || map.mode === "fragment";
  if (commit.ops.some((operation) => ("domain" in operation) !== documentMode)) {
    throw new Error(`LiveHost canonical commit operation domain is incompatible with ${map.mode}.`);
  }
  if (documentMode && commit.ops.some((operation) =>
    "domain" in operation
    && operation.op === "replace-root"
    && operation.mode !== map.mode)) {
    throw new Error(`LiveHost canonical root replacement is incompatible with ${map.mode}.`);
  }

  return Object.freeze({
    logicalMapId,
    incarnationId,
    prevRev: commit.prevRev,
    rev: commit.rev,
    mode: map.mode,
    ops: Object.freeze(commit.ops.map((operation) =>
      "domain" in operation ? canonical_graph_op(operation) : canonical_op(operation))),
  });
}

function encoded_bytes(commit: LiveHostCanonicalCommit): number {
  return textEncoder.encode(JSON.stringify(commit)).byteLength;
}

/**
 * Attach canonical commit history and ordered publication to one authoritative
 * LiveMap. This is stream machinery only; it does not add recovery behavior.
 */
export function make_livehost_canonical_stream<TMap extends LiveMapAuthority>(
  map: TMap,
  options: LiveHostCanonicalStreamOptions = {},
): LiveHostCanonicalStream<TMap> {
  const logicalMapId = must_identity(options.logicalMapId ?? make_logical_map_id(), "logical map ID");
  const incarnationId = must_identity(options.incarnationId ?? make_incarnation_id(), "incarnation ID");
  const maxCommits = must_bound(options.history?.maxCommits, DEFAULT_MAX_COMMITS, "maxCommits");
  const maxBytes = must_bound(options.history?.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
  const retained: RetainedCommit[] = [];
  const publicationQueue: LiveHostCanonicalCommit[] = [];
  const listeners = new Set<LiveHostCanonicalCommitListener>();
  let retainedEncodedBytes = 0;
  let headRev = map.rev;
  let isPublishing = false;
  let publishedCommitCount = 0;
  let publicationErrorCount = 0;

  function trim_history(): void {
    while (retained.length > maxCommits || retainedEncodedBytes > maxBytes) {
      const removed = retained.shift();
      if (removed) retainedEncodedBytes -= removed.encodedBytes;
    }
  }

  function append_history(commit: LiveHostCanonicalCommit): void {
    const entry = Object.freeze({ commit, encodedBytes: encoded_bytes(commit) });
    retained.push(entry);
    retainedEncodedBytes += entry.encodedBytes;
    trim_history();
  }

  function drain_publication_queue(): void {
    if (isPublishing) return;
    isPublishing = true;

    try {
      while (publicationQueue.length > 0) {
        const commit = publicationQueue.shift();
        if (!commit) continue;

        for (const listener of [...listeners]) {
          try {
            listener(commit);
          } catch {
            publicationErrorCount += 1;
          }
        }
        publishedCommitCount += 1;
      }
    } finally {
      isPublishing = false;
    }
  }

  function ingest(commit: LiveMapCommit<LiveMapAnyOp>, origin: "authoritative" | "replay"): void {
    if (origin !== "authoritative") {
      trace_commit(commit, origin, "skip");
      return;
    }
    const canonical = canonical_commit(map, commit, logicalMapId, incarnationId, headRev);
    append_history(canonical);
    headRev = canonical.rev;
    publicationQueue.push(canonical);
    drain_publication_queue();
    trace_commit(commit, origin, "success");
  }

  function trace_commit(
    commit: LiveMapCommit<LiveMapAnyOp>,
    origin: "authoritative" | "replay",
    status: "success" | "skip",
  ): void {
    if (map.mode !== "element" && map.mode !== "fragment") return;
    const sink = options.trace;
    if (sink === undefined) return;
    const trace = create_live_trace_context(sink, `lht-stream-${logicalMapId}-${commit.rev}`);
    const first = commit.ops[0];
    trace.emit({
      subsystem: "livemap",
      phase: "commit.publication",
      status,
      details: () => ({
        mapMode: map.mode,
        revision: commit.rev,
        operationDomain: first !== undefined && "domain" in first ? "graph" : "data",
        operationCount: commit.ops.length,
        origin,
      }),
    });
  }

  function replay_after(fromRev: number, throughRev = headRev): readonly LiveHostCanonicalCommit[] | undefined {
    if (!Number.isInteger(fromRev) || fromRev < 0) return undefined;
    if (!Number.isInteger(throughRev) || throughRev < 0 || throughRev > headRev) return undefined;
    if (fromRev === throughRev) return Object.freeze([]);
    if (fromRev > throughRev) return undefined;

    let cursor = fromRev;
    const commits: LiveHostCanonicalCommit[] = [];

    for (const entry of retained) {
      const commit = entry.commit;
      if (commit.rev <= fromRev) continue;
      if (commit.rev > throughRev) break;
      if (commit.prevRev !== cursor) return undefined;
      commits.push(commit);
      cursor = commit.rev;
    }

    return cursor === throughRev ? Object.freeze(commits) : undefined;
  }

  function debug(): LiveHostCanonicalHistoryDiagnostics {
    const first = retained[0]?.commit;
    const last = retained[retained.length - 1]?.commit;

    return Object.freeze({
      logicalMapId,
      incarnationId,
      headRev,
      ...(first ? { firstRetainedCommitRev: first.rev } : {}),
      ...(last ? { lastRetainedCommitRev: last.rev } : {}),
      earliestResumableBaseRev: first?.prevRev ?? headRev,
      retainedCommitCount: retained.length,
      retainedEncodedBytes,
      maxCommits,
      maxBytes,
      publishedCommitCount,
      publicationErrorCount,
    });
  }

  const history: LiveHostCanonicalHistory = Object.freeze({
    can_replay(fromRev, throughRev = headRev): boolean {
      return replay_after(fromRev, throughRev) !== undefined;
    },
    replay_after,
    debug,
  });

  const stream: LiveHostCanonicalStream<TMap> = Object.freeze({
    mode: map.mode,
    logicalMapId,
    incarnationId,
    get headRev() {
      return headRev;
    },
    history,
    on_commit(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });

  // Register before the host exposes its map so canonical ingestion is the
  // first host-owned observer of every later authoritative mutation.
  map.commits.observe((event) => {
    if (event.kind === "commit") ingest(event.commit, event.origin);
    else trace_snapshot(event.revision);
  });

  function trace_snapshot(revision: number): void {
    if (map.mode !== "element" && map.mode !== "fragment") return;
    const sink = options.trace;
    if (sink === undefined) return;
    const trace = create_live_trace_context(sink, `lht-stream-${logicalMapId}-snapshot-${revision}`);
    trace.emit({
      subsystem: "livemap",
      phase: "snapshot.installation",
      status: "skip",
      details: () => ({ mapMode: map.mode, revision, origin: "snapshot" }),
    });
  }

  return stream;
}
