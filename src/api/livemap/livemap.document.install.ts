import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMapInstallOptions,
  DocumentLiveMapMode,
  LiveMapGraphCommit,
  LiveMapGraphReplaceRootOp,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import { LiveMapDocumentInstallError, LiveMapRevError } from "./livemap.error.js";
import { classify_live_root_mode } from "./livemap.document.js";
import {
  index_livemap_document_elements,
  type LiveMapDocumentIdentityIndex,
} from "./livemap.document.identity.js";

export type PreparedDocumentInstall = Readonly<{
  mode: DocumentLiveMapMode;
  root: HsonNode;
  identity: LiveMapDocumentIdentityIndex;
}>;

/** Internal bridge that keeps the public document façade narrower than Core. */
export type LiveMapDocumentInstallController = Readonly<{
  mode: DocumentLiveMapMode;
  rev: () => number;
  identity: () => LiveMapDocumentIdentityIndex;
  apply: (candidate: PreparedDocumentInstall) => LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
  restore: (
    candidate: PreparedDocumentInstall,
    revision: number,
  ) => void;
}>;

/** Validate a canonical capture with sparse persisted identity, then apply it. */
export function install_livemap_document_capture(
  controller: LiveMapDocumentInstallController,
  capture: DocumentLiveMapCapture,
  options?: DocumentLiveMapInstallOptions,
): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> {
  assert_install_options(options, controller.rev());
  const candidate = prepare_document_install(capture, controller.mode);
  return controller.apply(candidate);
}

/** Restore a canonical capture and its revision without creating a local revision. */
export function restore_livemap_document_capture(
  controller: LiveMapDocumentInstallController,
  capture: DocumentLiveMapCapture,
  options?: DocumentLiveMapInstallOptions,
): void {
  assert_install_options(options, controller.rev());
  const candidate = prepare_document_install(capture, controller.mode);
  controller.restore(candidate, capture.rev);
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
): PreparedDocumentInstall {
  if (typeof capture !== "object" || capture === null || Array.isArray(capture)) {
    throw new LiveMapDocumentInstallError("capture must be an object");
  }
  if (capture.kind !== "hson-document") {
    throw new LiveMapDocumentInstallError(`unsupported capture kind ${JSON.stringify(capture.kind)}`);
  }
  if (capture.version !== 1) {
    throw new LiveMapDocumentInstallError(`unsupported capture version ${String(capture.version)}`);
  }
  if (capture.mode !== "element" && capture.mode !== "fragment") {
    throw new LiveMapDocumentInstallError(`unsupported capture mode ${JSON.stringify(capture.mode)}`);
  }
  if (!Number.isInteger(capture.rev) || capture.rev < 0) {
    throw new LiveMapDocumentInstallError(
      `capture revision must be a non-negative integer; observed ${String(capture.rev)}`,
    );
  }
  if (!is_Node(capture.root)) {
    throw new LiveMapDocumentInstallError("capture root is not a canonical HSON node");
  }

  let root: HsonNode;
  let observedMode;
  try {
    root = clone_live_root(capture.root);
    observedMode = classify_live_root_mode(root);
  } catch (cause) {
    throw new LiveMapDocumentInstallError("capture root is malformed", { cause });
  }

  if (observedMode !== "element" && observedMode !== "fragment") {
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

  try {
    return {
      mode: observedMode,
      root,
      identity: index_livemap_document_elements(root),
    };
  } catch (cause) {
    throw new LiveMapDocumentInstallError("capture document identity is invalid", { cause });
  }
}

/** Canonical graph equality includes attributes, metadata, order, and QUIDs. */
export function canonical_graph_equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) {
    return Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => canonical_graph_equal(item, right[index]));
  }
  if (Array.isArray(right)) return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
      && canonical_graph_equal(leftRecord[key], rightRecord[key]));
}
