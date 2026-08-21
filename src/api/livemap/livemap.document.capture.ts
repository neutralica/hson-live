import { HSON_META_QUID } from "../../core/constants.js";
import { canonical_hson_graph_equal } from "../../core/canonical-hson-equal.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMapCaptureIdentity,
  DocumentLiveMapCaptureOptions,
  DocumentLiveMapInstallIdentity,
  DocumentLiveMapMode,
  LiveMapCommitObservation,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import { LiveMapDocumentIdentityProvenanceError } from "./livemap.error.js";
import type { LiveMapIdentityEpochController } from "./livemap.identity-epoch.js";

type CaptureCategory = DocumentLiveMapCaptureIdentity | "default";

type CaptureProvenance = Readonly<{
  owner: object;
  epoch: number;
  category: CaptureCategory;
  mode: DocumentLiveMapMode;
  rev: number;
  root: HsonNode;
}>;

export type LiveMapDocumentIdentityEpochController = LiveMapIdentityEpochController;

const captureProvenance = new WeakMap<DocumentLiveMapCapture, CaptureProvenance>();
const commitContinuity = new WeakMap<object, "same-epoch" | "new-epoch">();
const observationEvidence = new WeakMap<object, LiveMapDocumentObservationEvidence>();

export type LiveMapDocumentObservationEvidence = Readonly<{
  mode: DocumentLiveMapMode;
  revision: number;
  root: HsonNode;
  continuity: "same-epoch" | "new-epoch";
}>;

/** Capture exact metadata, explicit same-epoch provenance, or an identity-free graph. */
export function capture_livemap_document<TMode extends DocumentLiveMapMode>(
  controller: LiveMapDocumentIdentityEpochController,
  mode: TMode,
  rev: number,
  root: HsonNode,
  options?: DocumentLiveMapCaptureOptions,
): DocumentLiveMapCapture<TMode> {
  const category = capture_category(options);
  const captureRoot = category === "strip"
    ? clone_hson_graph_without_quids(root)
    : clone_live_root(root);
  const capture: DocumentLiveMapCapture<TMode> = Object.freeze({
    kind: "hson-document",
    mode,
    rev,
    root: captureRoot,
  });

  if (options !== undefined) {
    captureProvenance.set(capture, Object.freeze({
      owner: controller.owner,
      epoch: controller.current(),
      category,
      mode,
      rev,
      root: clone_live_root(captureRoot),
    }));
  }
  return capture;
}

/** Resolve and validate one install policy before any candidate is published. */
export function validate_livemap_document_admission(
  controller: LiveMapDocumentIdentityEpochController,
  capture: DocumentLiveMapCapture,
  identity: unknown,
): DocumentLiveMapInstallIdentity {
  const policy = install_identity(identity);
  if (policy !== "same-epoch") return policy;

  const provenance = captureProvenance.get(capture);
  if (provenance === undefined) {
    throw provenance_error(
      "SAME_EPOCH_PROVENANCE_REQUIRED",
      "Same-epoch document admission requires the exact live capture capability; serialized or copied QUID metadata is insufficient.",
    );
  }
  if (provenance.category !== "same-epoch") {
    throw provenance_error(
      "IDENTITY_POLICY_MISMATCH",
      `A ${provenance.category} capture cannot be admitted as same-epoch identity.`,
    );
  }
  if (provenance.owner !== controller.owner) {
    throw provenance_error(
      "FOREIGN_IDENTITY_EPOCH",
      "The same-epoch capture belongs to a different live document map.",
    );
  }
  if (provenance.epoch !== controller.current()) {
    throw provenance_error(
      "STALE_IDENTITY_EPOCH",
      "The same-epoch capture belongs to an identity epoch that has been replaced.",
    );
  }
  if (capture.mode !== provenance.mode
    || capture.rev !== provenance.rev
    || !canonical_hson_graph_equal(capture.root, provenance.root)) {
    throw provenance_error(
      "IDENTITY_POLICY_MISMATCH",
      "The same-epoch capture envelope or graph changed after the capability was issued.",
    );
  }
  return policy;
}

/** Privately carry complete-root continuity through staged-authority acceptance. */
export function register_livemap_document_commit_continuity(
  commit: object,
  continuity: "same-epoch" | "new-epoch",
): void {
  commitContinuity.set(commit, continuity);
}

/** Read complete-root continuity without adding canonical commit fields. */
export function livemap_document_commit_continuity(
  commit: object,
): "same-epoch" | "new-epoch" | undefined {
  return commitContinuity.get(commit);
}

/** Privately attach the exact accepted document state to one publication wave. */
export function register_livemap_document_observation_evidence(
  observation: LiveMapCommitObservation,
  evidence: LiveMapDocumentObservationEvidence,
): void {
  observationEvidence.set(observation, evidence);
}

/** Read exact accepted document state without adding fields to public observations. */
export function livemap_document_observation_evidence(
  observation: LiveMapCommitObservation,
): LiveMapDocumentObservationEvidence | undefined {
  return observationEvidence.get(observation);
}

/** Remove QUID metadata from one detached graph without mutating its source. */
export function clone_hson_graph_without_quids(root: HsonNode): HsonNode {
  const clone = clone_live_root(root);
  const visited = new WeakSet<HsonNode>();
  const stack: HsonNode[] = [clone];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || visited.has(node)) continue;
    visited.add(node);
    if (node.$_meta !== undefined && HSON_META_QUID in node.$_meta) {
      delete node.$_meta[HSON_META_QUID];
      if (Object.keys(node.$_meta).length === 0) delete node.$_meta;
    }
    for (let index = node.$_content.length - 1; index >= 0; index -= 1) {
      const child = node.$_content[index];
      if (is_Node(child)) stack.push(child);
    }
  }
  return clone;
}

function capture_category(options: DocumentLiveMapCaptureOptions | undefined): CaptureCategory {
  if (options === undefined) return "default";
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw provenance_error(
      "UNSUPPORTED_CAPTURE_CATEGORY",
      "Document capture options must name one supported identity category.",
    );
  }
  const category = options.identity;
  if (category === "same-epoch" || category === "preserve-metadata" || category === "strip") {
    return category;
  }
  throw provenance_error(
    "UNSUPPORTED_CAPTURE_CATEGORY",
    `Unsupported document capture identity category ${JSON.stringify(category)}.`,
  );
}

function install_identity(identity: unknown): DocumentLiveMapInstallIdentity {
  if (identity === undefined) return "preserve-metadata";
  if (identity === "same-epoch"
    || identity === "preserve-metadata"
    || identity === "strip"
    || identity === "reject") {
    return identity;
  }
  throw provenance_error(
    "UNSUPPORTED_CAPTURE_CATEGORY",
    `Unsupported document admission identity category ${JSON.stringify(identity)}.`,
  );
}

function provenance_error(
  code: ConstructorParameters<typeof LiveMapDocumentIdentityProvenanceError>[0],
  message: string,
): LiveMapDocumentIdentityProvenanceError {
  return new LiveMapDocumentIdentityProvenanceError(code, message);
}
