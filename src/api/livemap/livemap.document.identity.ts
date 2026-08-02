import { is_Node } from "../../core/node-guards.js";
import { ROOT_TAG } from "../../core/constants.js";
import {
  HsonNodeQuidValidationError,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentPath,
} from "../../types/livemap.types.js";
import {
  append_document_path,
  document_path_equal,
  encode_document_path,
  resolve_document_path,
  validate_document_path,
} from "./livemap.document.path.js";

/** Sparse, immutable QUID/path correspondence for one current document graph. */
export type LiveMapDocumentIdentityOverlay = Readonly<{
  size: number;
  pathForQuid: (quid: string) => LiveMapDocumentPath | undefined;
  quidAtPath: (path: LiveMapDocumentPath) => string | undefined;
}>;

export class LiveMapDocumentIdentityError extends Error {
  readonly code: "MALFORMED_QUID" | "DUPLICATE_QUID" | "OVERLAY_INVARIANT";

  constructor(
    code: LiveMapDocumentIdentityError["code"],
    message: string,
    cause?: HsonNodeQuidValidationError,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveMapDocumentIdentityError";
    this.code = code;
  }
}

/**
 * Build the sole retained LiveMap document identity structure.
 *
 * Traversal validates all metadata in the owned root, but retains only two
 * strings plus one frozen canonical path per present QUID. It never retains a
 * graph node and never mints identity.
 */
export function build_livemap_document_identity_overlay(
  root: HsonNode,
  mode: DocumentLiveMapMode,
): LiveMapDocumentIdentityOverlay {
  const quidToPath = new Map<string, LiveMapDocumentPath>();
  const pathToQuid = new Map<string, string>();
  const firstNodeForQuid = new Map<string, HsonNode>();
  const emptyFragment = mode === "fragment"
    && root.$_tag === ROOT_TAG
    && root.$_content.length === 0;
  const base = emptyFragment
    ? undefined
    : resolve_document_path(root, mode, validate_document_path([]));
  if (base !== undefined && !is_Node(base)) {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      "LiveMap document identity path root is not a canonical HSON node.",
    );
  }

  const visited = new WeakSet<HsonNode>();
  const stack: Array<Readonly<{
    node: HsonNode;
    path: LiveMapDocumentPath | undefined;
  }>> = [{ node: root, path: base !== undefined && root === base ? validate_document_path([]) : undefined }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current.node)) continue;
    visited.add(current.node);

    let quid: string | undefined;
    try {
      quid = read_hson_node_quid(current.node);
    } catch (cause) {
      throw map_identity_error(cause, current.path);
    }

    if (quid !== undefined) {
      if (current.path === undefined) {
        throw new LiveMapDocumentIdentityError(
          "OVERLAY_INVARIANT",
          `LiveMap document QUID ${JSON.stringify(quid)} is outside the canonical document path root.`,
        );
      }
      const prior = quidToPath.get(quid);
      if (prior !== undefined && !document_path_equal(prior, current.path)) {
        const conflictingNode = firstNodeForQuid.get(quid);
        const cause = new HsonNodeQuidValidationError(
          "DUPLICATE_QUID",
          `Duplicate persisted QUID ${JSON.stringify(quid)} at canonical paths ${encode_document_path(prior)} and ${encode_document_path(current.path)}.`,
          {
            node: current.node,
            path: encode_document_path(current.path),
            value: quid,
            ...(conflictingNode === undefined ? {} : { conflictingNode }),
            conflictingPath: encode_document_path(prior),
          },
        );
        throw new LiveMapDocumentIdentityError(
          "DUPLICATE_QUID",
          `LiveMap document contains duplicate quid ${JSON.stringify(quid)} at canonical paths ${encode_document_path(prior)} and ${encode_document_path(current.path)}.`,
          cause,
        );
      }
      const pathKey = encode_document_path(current.path);
      const priorAtPath = pathToQuid.get(pathKey);
      if (priorAtPath !== undefined && priorAtPath !== quid) {
        throw new LiveMapDocumentIdentityError(
          "OVERLAY_INVARIANT",
          `LiveMap document canonical path ${pathKey} carries conflicting QUIDs.`,
        );
      }
      quidToPath.set(quid, current.path);
      firstNodeForQuid.set(quid, current.node);
      pathToQuid.set(pathKey, quid);
    }

    for (let index = current.node.$_content.length - 1; index >= 0; index -= 1) {
      const child = current.node.$_content[index];
      if (!is_Node(child)) continue;
      const childPath = current.path !== undefined
        ? append_document_path(current.path, index)
        : child === base
          ? validate_document_path([])
          : undefined;
      stack.push({ node: child, path: childPath });
    }
  }

  return make_overlay(quidToPath, pathToQuid);
}

/** Prove both overlay directions agree with a fresh scan of the supplied root. */
export function assert_livemap_document_identity_overlay(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  overlay: LiveMapDocumentIdentityOverlay,
): void {
  const expected = build_livemap_document_identity_overlay(root, mode);
  if (overlay.size !== expected.size) {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      `LiveMap document identity overlay has ${overlay.size} entries; expected ${expected.size}.`,
    );
  }
  visit_overlay(expected, (quid, path) => {
    const actualPath = overlay.pathForQuid(quid);
    const actualQuid = overlay.quidAtPath(path);
    if (actualPath === undefined || !document_path_equal(actualPath, path) || actualQuid !== quid) {
      throw new LiveMapDocumentIdentityError(
        "OVERLAY_INVARIANT",
        `LiveMap document identity overlay disagrees at QUID ${JSON.stringify(quid)} and path ${encode_document_path(path)}.`,
      );
    }
  });
}

const overlayOwners = new WeakMap<object, () => LiveMapDocumentIdentityOverlay>();
const overlayEntries = new WeakMap<LiveMapDocumentIdentityOverlay, ReadonlyMap<string, LiveMapDocumentPath>>();
let completedOverlayBuilds = 0;

/** Internal construction instrumentation used by authoritative lifecycle tests. */
export function livemap_document_identity_overlay_build_count(): number {
  return completedOverlayBuilds;
}

/** Register one internal façade owner without widening its public shape. */
export function register_livemap_document_identity_overlay(
  owner: object,
  current: () => LiveMapDocumentIdentityOverlay,
): void {
  overlayOwners.set(owner, current);
}

/** Resolve the current overlay for internal path-first consumers such as reflection. */
export function livemap_document_identity_overlay_for(
  owner: object,
): LiveMapDocumentIdentityOverlay {
  const current = overlayOwners.get(owner);
  if (current === undefined) {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      "LiveMap document façade has no registered identity overlay.",
    );
  }
  return current();
}

function make_overlay(
  quidToPath: ReadonlyMap<string, LiveMapDocumentPath>,
  pathToQuid: ReadonlyMap<string, string>,
): LiveMapDocumentIdentityOverlay {
  const overlay: LiveMapDocumentIdentityOverlay = Object.freeze({
    size: quidToPath.size,
    pathForQuid: (quid) => quidToPath.get(quid),
    quidAtPath: (path) => pathToQuid.get(encode_document_path(path)),
  });
  overlayEntries.set(overlay, quidToPath);
  completedOverlayBuilds += 1;
  return overlay;
}

function visit_overlay(
  overlay: LiveMapDocumentIdentityOverlay,
  visit: (quid: string, path: LiveMapDocumentPath) => void,
): void {
  const entries = overlayEntries.get(overlay);
  if (entries === undefined) {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      "LiveMap document identity overlay cannot be inspected by its owner.",
    );
  }
  for (const [quid, path] of entries) visit(quid, path);
}

function map_identity_error(
  cause: unknown,
  path: LiveMapDocumentPath | undefined,
): LiveMapDocumentIdentityError {
  if (!(cause instanceof HsonNodeQuidValidationError)) throw cause;
  const location = path === undefined ? "outside the canonical document path root" : `at canonical path ${encode_document_path(path)}`;
  return new LiveMapDocumentIdentityError(
    cause.code === "DUPLICATE_QUID" ? "DUPLICATE_QUID" : "MALFORMED_QUID",
    cause.code === "INELIGIBLE_QUID"
      ? `LiveMap cannot own a malformed canonical HSON root: node <${cause.node.$_tag}> is ineligible for quid ${location}.`
      : `LiveMap cannot own a malformed canonical HSON root: element <${cause.node.$_tag}> has an invalid ${cause.value === "" ? "empty" : "malformed"} quid ${location}.`,
    cause,
  );
}
