import { is_Node } from "../../core/node-guards.js";
import { ROOT_TAG } from "../../core/constants.js";
import {
  HsonNodeQuidValidationError,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentPath,
} from "../../types/livemap.types.js";
import {
  append_document_path,
  document_path_equal,
  encode_document_path,
  resolve_document_path,
  transform_document_path,
  validate_document_path,
  type LiveMapDocumentPathEffect,
} from "./livemap.document.path.js";

/** Sparse, immutable QUID/path correspondence for one current document graph. */
export type LiveMapDocumentIdentityOverlay = Readonly<{
  size: number;
  pathForQuid: (quid: string) => LiveMapDocumentPath | undefined;
  quidAtPath: (path: LiveMapDocumentPath) => string | undefined;
}>;

/** Derived evidence from one canonical operation; never an independent command. */
export type LiveMapDocumentIdentityEffect =
  | Readonly<{ kind: "preserved"; quid: string; path: LiveMapDocumentPath }>
  | Readonly<{ kind: "moved"; quid: string; from: LiveMapDocumentPath; to: LiveMapDocumentPath }>
  | Readonly<{ kind: "retired"; quid: string; formerPath: LiveMapDocumentPath }>
  | Readonly<{ kind: "introduced"; quid: string; path: LiveMapDocumentPath }>;

export type LiveMapDocumentIdentityAccounting = Readonly<{
  fullBuilds: number;
  reconciliations: number;
  overlayEntriesVisited: number;
  overlayEntriesChanged: number;
  incomingNodesVisited: number;
}>;

export type LiveMapDocumentIdentityReconciliation = Readonly<{
  overlay: LiveMapDocumentIdentityOverlay;
  effects: readonly LiveMapDocumentIdentityEffect[];
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

  completedOverlayBuilds += 1;
  return make_overlay(quidToPath, pathToQuid);
}

/**
 * Reconcile one sparse overlay from the same structural effect applied to the
 * canonical graph. Existing graph nodes are never scanned; only current sparse
 * claims and an optional incoming subtree participate.
 */
export function reconcile_livemap_document_identity_overlay(
  current: LiveMapDocumentIdentityOverlay,
  effect: LiveMapDocumentPathEffect,
  incoming?: Readonly<{
    content: HsonNode | Primitive;
    path: LiveMapDocumentPath;
  }>,
): LiveMapDocumentIdentityReconciliation {
  const currentEntries = entries_for_overlay(current);
  const quidToPath = new Map<string, LiveMapDocumentPath>();
  const pathToQuid = new Map<string, string>();
  const effects: LiveMapDocumentIdentityEffect[] = [];
  let changedEntries = 0;

  completedOverlayReconciliations += 1;
  completedOverlayEntriesVisited += currentEntries.size;

  for (const [quid, path] of currentEntries) {
    const transformed = transform_document_path(path, effect);
    if (transformed.kind === "invalid") {
      throw new LiveMapDocumentIdentityError(
        "OVERLAY_INVARIANT",
        `LiveMap document identity path transform failed for ${encode_document_path(path)}: ${transformed.reason}.`,
      );
    }
    if (transformed.kind === "retired") {
      changedEntries += 1;
      effects.push(Object.freeze({ kind: "retired", quid, formerPath: path }));
      continue;
    }
    add_overlay_entry(quidToPath, pathToQuid, quid, transformed.path);
    if (transformed.kind === "moved") {
      changedEntries += 1;
      effects.push(Object.freeze({ kind: "moved", quid, from: path, to: transformed.path }));
    }
  }

  if (incoming !== undefined && is_Node(incoming.content)) {
    for (const claim of scan_incoming_identity_claims(incoming.content, incoming.path)) {
      add_overlay_entry(quidToPath, pathToQuid, claim.quid, claim.path);
      changedEntries += 1;
      effects.push(Object.freeze({ kind: "introduced", quid: claim.quid, path: claim.path }));
    }
  }

  completedOverlayEntriesChanged += changedEntries;
  if (changedEntries === 0) {
    return Object.freeze({ overlay: current, effects: Object.freeze(effects) });
  }
  return Object.freeze({
    overlay: make_overlay(quidToPath, pathToQuid),
    effects: Object.freeze(effects),
  });
}

/** Derive an attribute-preservation effect without replacing the overlay. */
export function preserve_livemap_document_identity_at_path(
  overlay: LiveMapDocumentIdentityOverlay,
  path: LiveMapDocumentPath,
): LiveMapDocumentIdentityReconciliation {
  completedOverlayReconciliations += 1;
  const quid = overlay.quidAtPath(path);
  return Object.freeze({
    overlay,
    effects: quid === undefined
      ? Object.freeze([])
      : Object.freeze([Object.freeze({ kind: "preserved", quid, path })]),
  });
}

/** Derive whole-domain replacement evidence after the admitted root was scanned. */
export function replace_livemap_document_identity_overlay_effects(
  current: LiveMapDocumentIdentityOverlay,
  replacement: LiveMapDocumentIdentityOverlay,
): readonly LiveMapDocumentIdentityEffect[] {
  const effects: LiveMapDocumentIdentityEffect[] = [];
  for (const [quid, path] of entries_for_overlay(current)) {
    effects.push(Object.freeze({ kind: "retired", quid, formerPath: path }));
  }
  for (const [quid, path] of entries_for_overlay(replacement)) {
    effects.push(Object.freeze({ kind: "introduced", quid, path }));
  }
  return Object.freeze(effects);
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
let completedOverlayReconciliations = 0;
let completedOverlayEntriesVisited = 0;
let completedOverlayEntriesChanged = 0;
let completedIncomingNodesVisited = 0;

/** Internal construction instrumentation used by authoritative lifecycle tests. */
export function livemap_document_identity_overlay_build_count(): number {
  return completedOverlayBuilds;
}

/** Internal deterministic accounting used instead of wall-clock thresholds. */
export function livemap_document_identity_accounting(): LiveMapDocumentIdentityAccounting {
  return Object.freeze({
    fullBuilds: completedOverlayBuilds,
    reconciliations: completedOverlayReconciliations,
    overlayEntriesVisited: completedOverlayEntriesVisited,
    overlayEntriesChanged: completedOverlayEntriesChanged,
    incomingNodesVisited: completedIncomingNodesVisited,
  });
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
  return overlay;
}

function entries_for_overlay(
  overlay: LiveMapDocumentIdentityOverlay,
): ReadonlyMap<string, LiveMapDocumentPath> {
  const entries = overlayEntries.get(overlay);
  if (entries !== undefined) return entries;
  throw new LiveMapDocumentIdentityError(
    "OVERLAY_INVARIANT",
    "LiveMap document identity overlay cannot be reconciled by its owner.",
  );
}

function visit_overlay(
  overlay: LiveMapDocumentIdentityOverlay,
  visit: (quid: string, path: LiveMapDocumentPath) => void,
): void {
  for (const [quid, path] of entries_for_overlay(overlay)) visit(quid, path);
}

function add_overlay_entry(
  quidToPath: Map<string, LiveMapDocumentPath>,
  pathToQuid: Map<string, string>,
  quid: string,
  path: LiveMapDocumentPath,
): void {
  const priorPath = quidToPath.get(quid);
  if (priorPath !== undefined && !document_path_equal(priorPath, path)) {
    throw new LiveMapDocumentIdentityError(
      "DUPLICATE_QUID",
      `LiveMap document contains duplicate quid ${JSON.stringify(quid)} at canonical paths ${encode_document_path(priorPath)} and ${encode_document_path(path)}.`,
    );
  }
  const key = encode_document_path(path);
  const priorQuid = pathToQuid.get(key);
  if (priorQuid !== undefined && priorQuid !== quid) {
    throw new LiveMapDocumentIdentityError(
      "OVERLAY_INVARIANT",
      `LiveMap document canonical path ${key} carries conflicting QUIDs.`,
    );
  }
  quidToPath.set(quid, path);
  pathToQuid.set(key, quid);
}

function scan_incoming_identity_claims(
  root: HsonNode,
  basePath: LiveMapDocumentPath,
): readonly Readonly<{ quid: string; path: LiveMapDocumentPath }>[] {
  const claims: Array<Readonly<{ quid: string; path: LiveMapDocumentPath }>> = [];
  const local = new Map<string, LiveMapDocumentPath>();
  const stack: Array<Readonly<{ node: HsonNode; path: LiveMapDocumentPath }>> = [{ node: root, path: basePath }];
  const visited = new WeakSet<HsonNode>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current.node)) continue;
    visited.add(current.node);
    completedIncomingNodesVisited += 1;

    let quid: string | undefined;
    try {
      quid = read_hson_node_quid(current.node);
    } catch (cause) {
      throw map_identity_error(cause, current.path);
    }
    if (quid !== undefined) {
      const prior = local.get(quid);
      if (prior !== undefined && !document_path_equal(prior, current.path)) {
        throw new LiveMapDocumentIdentityError(
          "DUPLICATE_QUID",
          `LiveMap incoming subtree contains duplicate quid ${JSON.stringify(quid)} at canonical paths ${encode_document_path(prior)} and ${encode_document_path(current.path)}.`,
        );
      }
      local.set(quid, current.path);
      claims.push(Object.freeze({ quid, path: current.path }));
    }

    for (let index = current.node.$_content.length - 1; index >= 0; index -= 1) {
      const child = current.node.$_content[index];
      if (is_Node(child)) {
        stack.push({ node: child, path: append_document_path(current.path, index) });
      }
    }
  }
  return Object.freeze(claims);
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
