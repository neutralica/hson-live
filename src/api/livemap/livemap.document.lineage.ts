import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import {
  assign_hson_node_quid,
  read_hson_node_quid,
  remove_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  LiveMapDocumentMode,
  LiveMapDocumentContent,
  LiveMapDocumentPath,
  LiveMapDocumentRequestTarget,
  LiveMapReplacementLineage,
} from "../../types/livemap.types.js";
import {
  append_document_path,
  encode_document_path,
  resolve_document_path,
  validate_document_path,
} from "./livemap.document.path.js";

/** One replacement's portable, relative source/destination correspondence. */
export function normalize_replacement_lineage(
  input: unknown,
  before?: HsonNode | Primitive,
  after?: HsonNode | Primitive,
): LiveMapReplacementLineage {
  if (!Array.isArray(input)) throw new TypeError("Replacement lineage must be an array.");
  const sources = new Set<string>();
  const destinations = new Set<string>();
  const result: Array<LiveMapReplacementLineage[number]> = [];
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
): LiveMapReplacementLineage {
  const oldPaths = new Map<string, LiveMapDocumentPath>();
  visit_subjects(before, (node, path) => {
    const quid = read_hson_node_quid(node);
    if (quid !== undefined) oldPaths.set(quid, path);
  });
  const entries: Array<LiveMapReplacementLineage[number]> = [];
  visit_subjects(after, (node, destination) => {
    const quid = read_hson_node_quid(node);
    const source = quid === undefined ? undefined : oldPaths.get(quid);
    if (source !== undefined) entries.push(Object.freeze({ source, destination }));
  });
  return normalize_replacement_lineage(entries, before, after);
}

/** Derive an Echo-authored request from Echo's own pre-state. */
export function derive_replacement_lineage_for_action(
  root: HsonNode,
  mode: LiveMapDocumentMode,
  target: LiveMapDocumentRequestTarget,
  index: number,
  replacement: LiveMapDocumentContent,
): LiveMapReplacementLineage {
  const parent = resolve_document_path(root, mode, validate_document_path(target.path));
  if (!is_Node(parent) || !Number.isSafeInteger(index) || index < 0) {
    throw new TypeError("Replacement action target is invalid.");
  }
  const before = parent.$_content[index];
  if (before === undefined) throw new TypeError("Replacement action source is absent.");
  return derive_replacement_lineage(before, replacement);
}

/** Apply only receiving-runtime identities to a detached replacement candidate. */
export function apply_replacement_lineage(
  before: HsonNode | Primitive,
  after: HsonNode | Primitive,
  lineage: LiveMapReplacementLineage,
  incomingClaimsAreForeign = false,
): void {
  const oracle = derive_replacement_lineage(before, after);
  const mapped = new Map(lineage.map(({ source, destination }) => [encode_document_path(source), encode_document_path(destination)]));
  for (const entry of oracle) {
    if (mapped.get(encode_document_path(entry.source)) !== encode_document_path(entry.destination)) {
      throw new TypeError("Replacement lineage disagrees with existing exact-QUID evidence.");
    }
  }
  if (oracle.length > 0 && !incomingClaimsAreForeign) {
    for (const { source, destination } of lineage) {
      const old = relative_subject(before, source);
      const next = relative_subject(after, destination);
      if (!is_Node(old) || !is_Node(next)) continue;
      const localQuid = read_hson_node_quid(old);
      if (localQuid !== undefined && read_hson_node_quid(next) !== localQuid) {
        throw new TypeError("Replacement lineage adds survival absent from existing exact-QUID evidence.");
      }
    }
  }

  // Echo-authored content carries Echo-local claims only as a temporary
  // oracle. None of those values may be installed in the authority runtime.
  if (incomingClaimsAreForeign) visit_subjects(after, (node) => {
    if (read_hson_node_quid(node) !== undefined) remove_hson_node_quid(node);
  });

  for (const { source, destination } of lineage) {
    const old = relative_subject(before, source);
    const next = relative_subject(after, destination);
    if (!is_Node(old) || !is_Node(next)) throw new TypeError("Replacement lineage endpoint disappeared.");
    const localQuid = read_hson_node_quid(old);
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
