import { is_Node } from "../../core/node-guards.js";
import { collect_hson_node_quid_claims } from "../../core/hson-node-quid.js";
import type { HsonNode } from "../../core/types.js";
export { canonical_hson_graph_equal as canonical_graph_equal } from "../../core/canonical-hson-equal.js";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMapInstallOptions,
  DocumentLiveMapMode,
  LiveMapGraphCommit,
  LiveMapGraphReplaceRootOp,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import { LiveMapDocumentInstallError, LiveMapRevError } from "./livemap.error.js";
import {
  clone_hson_graph_without_quids,
  validate_livemap_document_admission,
  type LiveMapDocumentIdentityEpochController,
} from "./livemap.document.capture.js";
import { classify_live_root_mode } from "./livemap.document.js";
import {
  build_livemap_document_identity_overlay,
  LiveMapDocumentIdentityError,
  type LiveMapDocumentIdentityOverlay,
} from "./livemap.document.identity.js";
import { normalize_hson_array_index_order } from "../../core/hson-array-indexes.js";

export type PreparedDocumentInstall = Readonly<{
  mode: DocumentLiveMapMode;
  root: HsonNode;
  overlay: LiveMapDocumentIdentityOverlay;
}>;

/** Internal bridge that keeps the public document façade narrower than Core. */
export type LiveMapDocumentInstallController = Readonly<{
  mode: DocumentLiveMapMode;
  rev: () => number;
  overlay: () => LiveMapDocumentIdentityOverlay;
  identityEpoch: LiveMapDocumentIdentityEpochController;
  apply: (
    candidate: PreparedDocumentInstall,
    continuity: "same-epoch" | "new-epoch",
  ) => LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
  restore: (
    candidate: PreparedDocumentInstall,
    revision: number,
    continuity: "same-epoch" | "new-epoch",
  ) => void;
}>;

/** Validate an exact canonical capture with optional sparse QUID metadata, then apply it. */
export function install_livemap_document_capture(
  controller: LiveMapDocumentInstallController,
  capture: DocumentLiveMapCapture,
  options?: DocumentLiveMapInstallOptions,
): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> {
  assert_install_options(options, controller.rev());
  assert_capture_object(capture);
  const identity = validate_livemap_document_admission(
    controller.identityEpoch,
    capture,
    options?.identity,
  );
  const candidate = prepare_document_install(capture, controller.mode, identity);
  return controller.apply(candidate, identity === "same-epoch" ? "same-epoch" : "new-epoch");
}

/** Restore a canonical capture and its revision without creating a local revision. */
export function restore_livemap_document_capture(
  controller: LiveMapDocumentInstallController,
  capture: DocumentLiveMapCapture,
  options?: DocumentLiveMapInstallOptions,
): void {
  assert_install_options(options, controller.rev());
  assert_capture_object(capture);
  const identity = validate_livemap_document_admission(
    controller.identityEpoch,
    capture,
    options?.identity,
  );
  const candidate = prepare_document_install(capture, controller.mode, identity);
  controller.restore(
    candidate,
    capture.rev,
    identity === "same-epoch" ? "same-epoch" : "new-epoch",
  );
}

function assert_install_options(
  options: DocumentLiveMapInstallOptions | undefined,
  actualRev: number,
): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new LiveMapDocumentInstallError("options must be an object");
  }

  const expectedRev = options.expectedRev;
  if (expectedRev === undefined) return;
  if (!Number.isInteger(expectedRev) || expectedRev < 0) {
    throw new LiveMapDocumentInstallError(
      `expectedRev must be a non-negative integer; observed ${String(expectedRev)}`,
    );
  }
  if (expectedRev !== actualRev) throw new LiveMapRevError(expectedRev, actualRev);
}

export function prepare_document_install(
  capture: DocumentLiveMapCapture,
  targetMode: DocumentLiveMapMode,
  identity: DocumentLiveMapInstallOptions["identity"] = "preserve-metadata",
): PreparedDocumentInstall {
  assert_capture_object(capture);
  if (capture.kind !== "hson-document") {
    throw new LiveMapDocumentInstallError(`unsupported capture kind ${JSON.stringify(capture.kind)}`);
  }
  if (capture.mode !== "document") {
    throw new LiveMapDocumentInstallError(`unsupported capture mode ${JSON.stringify(capture.mode)}`);
  }
  if (!Number.isInteger(capture.rev) || capture.rev < 0) {
    throw new LiveMapDocumentInstallError(
      `capture revision must be a non-negative integer; observed ${String(capture.rev)}`,
    );
  }
  if (!is_Node(capture.root)) {
    throw new LiveMapDocumentInstallError("capture root is not a canonical Hson node");
  }

  let root: HsonNode;
  let observedMode;
  try {
    const detachedRoot = identity === "strip"
      ? clone_hson_graph_without_quids(capture.root)
      : clone_live_root(capture.root);
    root = normalize_hson_array_index_order(
      detachedRoot,
      "prepare_document_install",
    );
    observedMode = classify_live_root_mode(root);
  } catch (cause) {
    throw new LiveMapDocumentInstallError("capture root is malformed", { cause });
  }

  if (observedMode !== "document") {
    throw new LiveMapDocumentInstallError(
      `capture root classifies as ${observedMode}, not a document mode`,
    );
  }
  if (observedMode !== capture.mode) {
    throw new LiveMapDocumentInstallError(
      `capture declares mode ${capture.mode}, but its root classifies as ${observedMode}`,
    );
  }
  if (observedMode !== targetMode) {
    throw new LiveMapDocumentInstallError(
      `target mode ${targetMode} cannot install ${observedMode} capture`,
    );
  }

  if (identity === "reject" && collect_hson_node_quid_claims(root).length > 0) {
    throw new LiveMapDocumentInstallError(
      "identity policy rejects QUID-bearing external content",
      undefined,
      "IDENTITY_POLICY_MISMATCH",
    );
  }

  try {
    return {
      mode: observedMode,
      root,
      overlay: build_livemap_document_identity_overlay(root, observedMode),
    };
  } catch (cause) {
    throw new LiveMapDocumentInstallError(
      "capture document identity is invalid",
      { cause },
      cause instanceof LiveMapDocumentIdentityError && cause.code === "DUPLICATE_QUID"
        ? "DUPLICATE_PRESERVED_CLAIMS"
        : "MALFORMED_CAPTURE_ENVELOPE",
    );
  }
}

function assert_capture_object(capture: DocumentLiveMapCapture): void {
  if (typeof capture !== "object" || capture === null || Array.isArray(capture)) {
    throw new LiveMapDocumentInstallError("capture must be an object");
  }
  const keys = Object.keys(capture);
  if (keys.length !== 4 || !keys.every((key) => ["kind", "mode", "rev", "root"].includes(key))) {
    throw new LiveMapDocumentInstallError("capture contains missing or unknown fields");
  }
}
