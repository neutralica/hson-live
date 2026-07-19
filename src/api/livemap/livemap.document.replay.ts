import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapGraphReplaceRootOp,
  LiveMapCommitObserverApi,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import { LiveMapReplayInputError, LiveMapRevError } from "./livemap.error.js";
import {
  prepare_document_install,
  type PreparedDocumentInstall,
} from "./livemap.document.install.js";
import {
  prepare_document_graph_operation,
} from "./livemap.document.mutation.js";

export type PreparedDocumentReplay = Readonly<{
  root: HsonNode;
  identity: PreparedDocumentInstall["identity"];
  commit: LiveMapGraphCommit;
}>;

export type LiveMapDocumentReplayController = Readonly<{
  mode: DocumentLiveMapMode;
  rev: () => number;
  root: () => HsonNode;
  applyReplay: (candidate: PreparedDocumentReplay) => LiveMapGraphCommit;
  commits: LiveMapCommitObserverApi;
}>;

/** Validate all graph operations against a detached candidate before one swap. */
export function replay_livemap_document_commit(
  controller: LiveMapDocumentReplayController,
  input: LiveMapGraphCommit,
): LiveMapGraphCommit {
  const envelope = must_graph_commit_envelope(input);
  if (envelope.prevRev !== controller.rev()) {
    throw new LiveMapRevError(envelope.prevRev, controller.rev());
  }

  let root = clone_live_root(controller.root());
  let identity: PreparedDocumentInstall["identity"] | undefined;
  const operations: LiveMapGraphOp[] = [];

  for (const [index, rawOperation] of envelope.ops.entries()) {
    if (is_replace_root_operation(rawOperation)) {
      if (envelope.ops.length !== 1) {
        throw new LiveMapReplayInputError("replace-root must be the only graph operation", index);
      }
      const prepared = prepare_document_install({
        kind: "hson-document",
        version: 1,
        mode: rawOperation.mode,
        rev: envelope.rev,
        root: rawOperation.root,
      }, controller.mode);
      root = prepared.root;
      identity = prepared.identity;
      operations.push(Object.freeze({
        domain: "graph",
        op: "replace-root",
        mode: prepared.mode,
        root: clone_live_root(prepared.root),
      }));
      continue;
    }

    const prepared = prepare_document_graph_operation(root, controller.mode, rawOperation);
    root = prepared.root;
    identity = prepared.identity;
    operations.push(prepared.operation);
  }

  if (identity === undefined) {
    throw new LiveMapReplayInputError("graph commit contains no operations");
  }
  const commit: LiveMapGraphCommit = Object.freeze({
    changed: true,
    prevRev: envelope.prevRev,
    rev: envelope.rev,
    ops: Object.freeze(operations),
  });
  return controller.applyReplay({ root, identity, commit });
}

function must_graph_commit_envelope(input: unknown): LiveMapGraphCommit {
  if (!is_plain_record(input)) throw new LiveMapReplayInputError("graph commit is not an object");
  const keys = Object.keys(input);
  if (keys.length !== 4 || !keys.every((key) => ["changed", "prevRev", "rev", "ops"].includes(key))) {
    throw new LiveMapReplayInputError("graph commit contains missing or unknown fields");
  }
  if (input.changed !== true) throw new LiveMapReplayInputError("graph replay requires a changed commit");
  if (!is_revision(input.prevRev) || !is_revision(input.rev) || input.rev !== input.prevRev + 1) {
    throw new LiveMapReplayInputError("graph commit revisions must be consecutive non-negative integers");
  }
  if (!Array.isArray(input.ops) || input.ops.length === 0) {
    throw new LiveMapReplayInputError("graph commit ops must be a non-empty array");
  }
  return Object.freeze({
    changed: true,
    prevRev: input.prevRev,
    rev: input.rev,
    ops: Object.freeze([...input.ops]),
  });
}

function is_replace_root_operation(input: unknown): input is LiveMapGraphReplaceRootOp {
  if (!is_plain_record(input) || input.domain !== "graph" || input.op !== "replace-root") return false;
  const keys = Object.keys(input);
  if (keys.length !== 4 || !keys.every((key) => ["domain", "op", "mode", "root"].includes(key))) {
    throw new LiveMapReplayInputError("replace-root contains missing or unknown fields");
  }
  return true;
}

function is_revision(input: unknown): input is number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0;
}

function is_plain_record(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
