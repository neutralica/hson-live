/** Current single-map client replication projection. Authority history remains exact. */
import type {
  LocusCanonicalCommit,
  LocusClientCommit,
  LocusClientDocumentTarget,
  LocusClientGraphOp,
  LocusClientOp,
  LocusClientProgress,
  LocusClientSnapshotEnvelope,
  LocusSnapshotEnvelope,
} from "../../types/locus.representation.types.js";
import { is_Node } from "../../core/node-guards.js";
import { clone_hson_graph_without_quids } from "../livemap/livemap.document.capture.js";
import { decode_locus_graph_content, encode_locus_portable_graph_content } from "./locus.graph-content-codec.js";
import { decode_view_state_snapshot, encode_view_state_snapshot } from "../livemap/livemap.document.view-state-codec.js";
import { parse_hson_exact_runtime, serialize_hson_owned_document_content_exact_runtime } from "../../internal/exact-runtime-hson-codec.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";

export type LocusClientTransition =
  | Readonly<{ kind: "commit"; commit: LocusClientCommit }>
  | Readonly<{ kind: "progress"; progress: LocusClientProgress }>;

/** Derive client effects or progress at the same authority revision. */
export function project_locus_client_transition(authority: LocusCanonicalCommit): LocusClientTransition {
  const ops: LocusClientOp[] = [];
  for (const operation of authority.ops) {
    if (!("domain" in operation)) {
      ops.push(operation);
      continue;
    }
    if (operation.op === "ensure-quid") continue;
    if (operation.op === "replace-root") {
      const root = decode_locus_graph_content(operation.root);
      if (!is_Node(root)) throw new Error("Authority replace-root history is malformed.");
      ops.push(Object.freeze({ domain: "graph", op: "replace-root", mode: "document", root: encode_locus_portable_graph_content(root) }));
      continue;
    }
    const target: LocusClientDocumentTarget = Object.freeze({ kind: "path", path: operation.target.path });
    let client: LocusClientGraphOp;
    if (operation.op === "set-attr") client = Object.freeze({ domain: "graph", op: operation.op, target, name: operation.name, value: operation.value });
    else if (operation.op === "remove-attr") client = Object.freeze({ domain: "graph", op: operation.op, target, name: operation.name });
    else if (operation.op === "replace-attrs") client = Object.freeze({ domain: "graph", op: operation.op, target, attrs: operation.attrs });
    else if (operation.op === "replace-content") {
      if (operation.lineage === undefined) throw new Error("Legacy authority replacement cannot be projected without portable lineage.");
      client = Object.freeze({ domain: "graph", op: operation.op, target, index: operation.index, replacement: encode_locus_portable_graph_content(decode_locus_graph_content(operation.replacement)), lineage: operation.lineage });
    }
    else if (operation.op === "insert-content") client = Object.freeze({ domain: "graph", op: operation.op, target, index: operation.index, content: encode_locus_portable_graph_content(decode_locus_graph_content(operation.content)) });
    else if (operation.op === "remove-content") client = Object.freeze({ domain: "graph", op: operation.op, target, index: operation.index });
    else client = Object.freeze({ domain: "graph", op: "move-content", target, from: operation.from, to: operation.to });
    ops.push(client);
  }
  if (ops.length === 0) return Object.freeze({
    kind: "progress",
    progress: Object.freeze({
      logicalMapId: authority.logicalMapId,
      incarnationId: authority.incarnationId,
      prevRev: authority.prevRev,
      rev: authority.rev,
    }),
  });
  return Object.freeze({
    kind: "commit",
    commit: Object.freeze({
      clientFormat: "hson-locus-client-commit-v1",
      logicalMapId: authority.logicalMapId,
      incarnationId: authority.incarnationId,
      mode: authority.mode,
      prevRev: authority.prevRev,
      rev: authority.rev,
      ops: Object.freeze(ops),
      ...(authority.format === undefined ? {} : { format: authority.format, payload: authority.payload }),
    }),
  });
}

/** Project exact authority snapshot without importing its identity into Echo. */
export function project_locus_client_snapshot(authority: LocusSnapshotEnvelope & Readonly<{ mode: "document" }>): LocusClientSnapshotEnvelope & Readonly<{ mode: "document" }>;
export function project_locus_client_snapshot(authority: LocusSnapshotEnvelope): LocusClientSnapshotEnvelope;
export function project_locus_client_snapshot(authority: LocusSnapshotEnvelope): LocusClientSnapshotEnvelope {
  if ("hson" in authority) {
    const value = parse_hson_exact_runtime(authority.hson, { allowTopLevelDocumentText: true });
    const portable = clone_hson_graph_without_quids(value);
    admit_portable_hson_node(portable, "Locus client snapshot");
    return Object.freeze({
      logicalMapId: authority.logicalMapId,
      incarnationId: authority.incarnationId,
      mode: authority.mode,
      rev: authority.rev,
      format: "hson-client-snapshot-v1",
      payload: serialize_hson_owned_document_content_exact_runtime(portable, { noBreak: true }),
    });
  }
  // View-state retains its existing value codec but the client version has
  // a separate format and a QUID-free canonical root.
  const decoded = decode_view_state_snapshot({ format: "view-state", payload: authority.payload });
  const portable = clone_hson_graph_without_quids(decoded.root);
  admit_portable_hson_node(portable, "Locus client snapshot");
  return Object.freeze({
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    mode: authority.mode,
    rev: authority.rev,
    format: "view-state-client-snapshot-v1",
    payload: encode_view_state_snapshot(Object.freeze({ ...decoded, root: portable })).payload,
  });
}
