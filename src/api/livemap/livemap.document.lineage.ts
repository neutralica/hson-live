import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import {
  assign_hson_node_quid,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  LiveMapDocumentPath,
  LiveMapGraphOp,
  LiveMapGraphReplaceContentOp,
} from "../../types/livemap.types.js";
import {
  append_document_path,
  encode_document_path,
  document_path_is_prefix,
  validate_document_path,
} from "./livemap.document.path.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";

type ReplacementIdentitySource = Readonly<{ overlay: LiveMapDocumentIdentityOverlay; path: LiveMapDocumentPath }>;

/** Receiving-runtime correspondence, derived by the framework and transported only in internal commits. */
export type DocumentReplacementLineage = readonly Readonly<{
  source: LiveMapDocumentPath;
  destination: LiveMapDocumentPath;
}>[];

/** Internal graph evidence is deliberately absent from public write instructions. */
export type DocumentGraphReplaceContentOp = LiveMapGraphReplaceContentOp & Readonly<{
  lineage?: DocumentReplacementLineage;
}>;

/** Private graph operation representation; not exported by a package entrypoint. */
export type DocumentGraphOp = Exclude<LiveMapGraphOp, LiveMapGraphReplaceContentOp> | DocumentGraphReplaceContentOp;

/** Validate one internal replacement's portable, relative correspondence. @internal */
export function normalize_replacement_lineage(
  input: unknown,
  before?: HsonNode | Primitive,
  after?: HsonNode | Primitive,
): DocumentReplacementLineage {
  if (!Array.isArray(input)) throw new TypeError("Replacement lineage must be an array.");
  const sources = new Set<string>();
  const destinations = new Set<string>();
  const result: Array<DocumentReplacementLineage[number]> = [];
  for (const entry of input) {
    if (!plain_record(entry) || Object.keys(entry).length !== 2
      || !Object.hasOwn(entry, "source") || !Object.hasOwn(entry, "destination")) {
      throw new TypeError("Replacement lineage entry must contain source and destination paths.");
    }
    const source = validate_document_path(entry.source);
    const destination = validate_document_path(entry.destination);
    const sourceKey = encode_document_path(source);
    const destinationKey = encode_document_path(destination);
    if (sources.has(sourceKey) || destinations.has(destinationKey)) {
      throw new TypeError("Replacement lineage must be a partial bijection.");
    }
    sources.add(sourceKey);
    destinations.add(destinationKey);
    if (before !== undefined && after !== undefined
      && (!is_ordinary_element_node(relative_subject(before, source))
        || !is_ordinary_element_node(relative_subject(after, destination)))) {
      throw new TypeError("Replacement lineage endpoints must be document subjects.");
    }
    result.push(Object.freeze({ source, destination }));
  }
  return Object.freeze(result);
}

/** Derive current same-runtime survival evidence without putting QUIDs on the wire. */
export function derive_replacement_lineage(
  before: HsonNode | Primitive,
  after: HsonNode | Primitive,
  sourceIdentity?: ReplacementIdentitySource,
): DocumentReplacementLineage {
  const oldPaths = new Map<string, LiveMapDocumentPath>();
  visit_subjects(before, (node, path) => {
    const quid = read_hson_node_quid(node);
    if (quid !== undefined) oldPaths.set(quid, path);
  });
  const entries: Array<DocumentReplacementLineage[number]> = [];
  visit_subjects(after, (node, destination) => {
    const quid = read_hson_node_quid(node);
    const ownedPath = quid === undefined ? undefined : sourceIdentity?.overlay.pathForQuid(quid);
    const source = quid === undefined ? undefined : oldPaths.get(quid)
      ?? (ownedPath !== undefined && sourceIdentity !== undefined && document_path_is_prefix(sourceIdentity.path, ownedPath)
        ? validate_document_path(ownedPath.slice(sourceIdentity.path.length)) : undefined);
    if (source !== undefined) entries.push(Object.freeze({ source, destination }));
  });
  return normalize_replacement_lineage(entries, before, after);
}

/** Apply only receiving-runtime identities to a detached replacement candidate. */
export function apply_replacement_lineage(
  before: HsonNode | Primitive,
  after: HsonNode | Primitive,
  lineage: DocumentReplacementLineage,
  sourceIdentity?: ReplacementIdentitySource,
): void {
  const oracle = derive_replacement_lineage(before, after, sourceIdentity);
  const mapped = new Map(lineage.map(({ source, destination }) => [encode_document_path(source), encode_document_path(destination)]));
  for (const entry of oracle) {
    if (mapped.get(encode_document_path(entry.source)) !== encode_document_path(entry.destination)) {
      throw new TypeError("Replacement lineage disagrees with existing exact-QUID evidence.");
    }
  }
  if (oracle.length > 0) {
    for (const { source, destination } of lineage) {
      const old = relative_subject(before, source);
      const next = relative_subject(after, destination);
      if (!is_Node(old) || !is_Node(next)) continue;
      const localQuid = read_hson_node_quid(old)
        ?? (sourceIdentity === undefined ? undefined : sourceIdentity.overlay.quidAtPath(validate_document_path([...sourceIdentity.path, ...source])));
      if (localQuid !== undefined && read_hson_node_quid(next) !== localQuid) {
        throw new TypeError("Replacement lineage adds survival absent from existing exact-QUID evidence.");
      }
    }
  }

  for (const { source, destination } of lineage) {
    const old = relative_subject(before, source);
    const next = relative_subject(after, destination);
    if (!is_Node(old) || !is_Node(next)) throw new TypeError("Replacement lineage endpoint disappeared.");
    const localQuid = read_hson_node_quid(old)
      ?? (sourceIdentity === undefined ? undefined : sourceIdentity.overlay.quidAtPath(validate_document_path([...sourceIdentity.path, ...source])));
    const incomingQuid = read_hson_node_quid(next);
    if (localQuid === undefined) {
      if (incomingQuid !== undefined) {
        throw new TypeError("Unquidded survivor has a conflicting incoming QUID claim.");
      }
      continue;
    }
    if (incomingQuid !== undefined && incomingQuid !== localQuid) {
      throw new TypeError("Replacement destination has a conflicting local identity.");
    }
    assign_hson_node_quid(next, localQuid);
  }
}

function relative_subject(root: HsonNode | Primitive, path: LiveMapDocumentPath): HsonNode | Primitive | undefined {
  let current: HsonNode | Primitive | undefined = root;
  for (const index of path) {
    if (!is_Node(current)) return undefined;
    current = current.$_content[index];
  }
  return current;
}

function visit_subjects(
  root: HsonNode | Primitive,
  visit: (node: HsonNode, path: LiveMapDocumentPath) => void,
): void {
  if (!is_Node(root)) return;
  const pending: Array<Readonly<{ node: HsonNode; path: LiveMapDocumentPath }>> = [
    { node: root, path: validate_document_path([]) },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    visit(current.node, current.path);
    for (let index = current.node.$_content.length - 1; index >= 0; index -= 1) {
      const child = current.node.$_content[index];
      if (is_Node(child)) pending.push({ node: child, path: append_document_path(current.path, index) });
    }
  }
}

function plain_record(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
