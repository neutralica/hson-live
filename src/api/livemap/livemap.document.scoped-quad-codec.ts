import type { HsonNode } from "../../core/types.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/hson-node-quid.js";
import { is_document_quad_name } from "../../internal/document-quad-name.js";
import type { LiveMapDocumentPath } from "../../types/livemap.types.js";
import { compare_document_paths, document_path_is_prefix, resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { qualify_livemap_document } from "./livemap.node-admission.js";

/** Private coordinates only; no field grants receiving QUID authority. @internal */
export type ScopedQuadBindingRecord = Readonly<{
  name: string;
  kind: "element" | "part";
  path: LiveMapDocumentPath;
}>;
/** @internal */
export type ScopedQuadOccurrenceRecord = Readonly<{
  root: LiveMapDocumentPath;
  parent: LiveMapDocumentPath | null;
  bindings: readonly ScopedQuadBindingRecord[];
}>;
/** Authored names and disposable subject labels occupy independent domains. @internal */
export type DocumentScopedQuadRecord = Readonly<{
  document: readonly ScopedQuadBindingRecord[];
  occurrences: readonly ScopedQuadOccurrenceRecord[];
  subjects: readonly Readonly<{ name: string; path: LiveMapDocumentPath; disposition: "disposable" }>[];
}>;

/** Bounds apply to the whole record, including repeated coordinates. @internal */
export const DOCUMENT_SCOPED_QUAD_LIMITS = Object.freeze({
  occurrences: 16_384,
  bindings: 65_536,
  subjects: 65_536,
  pathDepth: 256,
  pathSegments: 1_048_576,
});

function fail(reason: string): never { throw new TypeError(`Invalid scoped QUAD record: ${reason}.`); }

function fields(input: unknown, names: readonly string[]): ReadonlyMap<string, unknown> {
  if (typeof input !== "object" || input === null) fail("expected an exact record");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) fail("record prototype");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key))) fail("record fields");
  const result = new Map<string, unknown>();
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("expected own enumerable data fields");
    result.set(name, descriptor.value);
  }
  return result;
}

function array(input: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(input)) fail("expected an exact array");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Array.prototype && prototype !== null) fail("array prototype");
  const length = Object.getOwnPropertyDescriptor(input, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > limit) fail("array resource bound");
  if (Reflect.ownKeys(input).length !== length + 1) fail("sparse or extended array");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("array data entries");
    result.push(descriptor.value);
  }
  return result;
}

/**
 * Strict, detached validation against a canonical document graph. Sorting is part
 * of the private format: names lexically, occurrences and subjects by raw path.
 * This function has no issuer, overlay installer, Library, or lookup capability.
 * Source QUID payloads are checked for syntax only and remain disposable labels.
 * @internal
 */
export function decode_document_scoped_quads(input: unknown, root: HsonNode): DocumentScopedQuadRecord {
  const record = fields(input, ["document", "occurrences", "subjects"]);
  qualify_livemap_document(root, "LiveMap.scoped-quad-codec");
  let remainingBindings = DOCUMENT_SCOPED_QUAD_LIMITS.bindings;
  let remainingSegments = DOCUMENT_SCOPED_QUAD_LIMITS.pathSegments;
  const subjectPaths = new WeakMap<HsonNode, string>();
  const path = (value: unknown): LiveMapDocumentPath => {
    const segments = array(value, DOCUMENT_SCOPED_QUAD_LIMITS.pathDepth);
    remainingSegments -= segments.length;
    if (remainingSegments < 0 || segments.some(segment => Object.is(segment, -0))) fail("path resource bound or noncanonical index");
    return validate_document_path(segments);
  };
  const subject = (coordinate: LiveMapDocumentPath): void => {
    const node = resolve_document_path(root, "document", coordinate);
    if (!is_ordinary_element_node(node)) fail("subject is not an ordinary element");
    const key = JSON.stringify(coordinate), previous = subjectPaths.get(node);
    if (previous !== undefined && previous !== key) fail("one subject has ambiguous canonical coordinates");
    subjectPaths.set(node, key);
  };
  const bindings = (value: unknown): readonly ScopedQuadBindingRecord[] => {
    const entries = array(value, remainingBindings);
    remainingBindings -= entries.length;
    let previous: string | undefined;
    return Object.freeze(entries.map(entry => {
      const data = fields(entry, ["name", "kind", "path"]);
      const name = data.get("name"), kind = data.get("kind");
      if (!is_document_quad_name(name) || previous !== undefined && previous >= name) fail("local name or canonical name order");
      if (kind !== "element" && kind !== "part") fail("binding role");
      const coordinate = path(data.get("path"));
      subject(coordinate);
      previous = name;
      return Object.freeze({ name, kind, path: coordinate });
    }));
  };
  const document = bindings(record.get("document"));
  let previousRoot: LiveMapDocumentPath | undefined;
  const occurrences = Object.freeze(array(record.get("occurrences"), DOCUMENT_SCOPED_QUAD_LIMITS.occurrences).map(entry => {
    const data = fields(entry, ["root", "parent", "bindings"]);
    const coordinate = path(data.get("root"));
    subject(coordinate);
    if (previousRoot !== undefined && compare_document_paths(previousRoot, coordinate) >= 0) fail("duplicate occurrence root or canonical root order");
    previousRoot = coordinate;
    return Object.freeze({ root: coordinate, parent: data.get("parent") === null ? null : path(data.get("parent")), bindings: bindings(data.get("bindings")) });
  }));
  const byRoot = new Map(occurrences.map(occurrence => [JSON.stringify(occurrence.root), occurrence]));
  // Only explicitly declared occurrence roots establish ownership. Ordinary
  // element ancestry is used to prove containment, never to invent a scope.
  const containing = (coordinate: LiveMapDocumentPath, includeSelf: boolean): ScopedQuadOccurrenceRecord | undefined => {
    for (let length = coordinate.length - (includeSelf ? 0 : 1); length >= 0; length--) {
      const occurrence = byRoot.get(JSON.stringify(coordinate.slice(0, length)));
      if (occurrence !== undefined) return occurrence;
    }
    return undefined;
  };
  for (const occurrence of occurrences) {
    const parent = containing(occurrence.root, false);
    if (JSON.stringify(occurrence.parent) !== JSON.stringify(parent?.root ?? null)) fail("parent must be the immediately containing declared occurrence");
    // Strict containment plus unique roots also proves acyclic parentage.
  }
  const checkBindings = (entries: readonly ScopedQuadBindingRecord[], scope: ScopedQuadOccurrenceRecord | undefined): void => {
    for (const binding of entries) {
      if (scope !== undefined && !document_path_is_prefix(scope.root, binding.path)) fail("binding outside its occurrence");
      if (binding.kind === "element") {
        // A subject address may survive lineage onto an immediate child root.
        // Its element role grants no access to that child's namespace. Only
        // the root itself is shared; descendants remain inside the child scope.
        const child = byRoot.get(JSON.stringify(binding.path));
        const immediateChildRoot = child !== undefined && JSON.stringify(child.parent) === JSON.stringify(scope?.root ?? null);
        if (containing(binding.path, true) !== scope && !immediateChildRoot) fail("element binding crosses an occurrence boundary");
      } else {
        const child = byRoot.get(JSON.stringify(binding.path));
        if (child === undefined || JSON.stringify(child.parent) !== JSON.stringify(scope?.root ?? null)) fail("Part binding must name an immediate child occurrence");
      }
    }
  };
  checkBindings(document, undefined);
  for (const occurrence of occurrences) checkBindings(occurrence.bindings, occurrence);

  const labels = new Set<string>();
  let previousSubject: LiveMapDocumentPath | undefined;
  const subjects = Object.freeze(array(record.get("subjects"), DOCUMENT_SCOPED_QUAD_LIMITS.subjects).map(entry => {
    const data = fields(entry, ["name", "path", "disposition"]);
    const name = data.get("name");
    if (data.get("disposition") !== "disposable" || typeof name !== "string" || name[0] !== "_"
      || !is_persisted_quid(name.slice(1)) || labels.has(name)) fail("disposable transport label or duplicate label");
    const coordinate = path(data.get("path"));
    subject(coordinate);
    if (previousSubject !== undefined && compare_document_paths(previousSubject, coordinate) >= 0) fail("duplicate transport subject or canonical subject order");
    previousSubject = coordinate;
    labels.add(name);
    return Object.freeze({ name, path: coordinate, disposition: "disposable" as const });
  }));
  return Object.freeze({ document, occurrences, subjects });
}

/**
 * Inputs are detached records from this codec. Equality covers this association
 * domain only: exact logical topology/names/roles and demanded subject paths,
 * ignoring disposable label payloads. It does not prove occurrence continuity
 * or a transition no-op: replacing a lifetime can leave portable meaning equal.
 * The scoped Library comparator combines this with graph/CSS equality and
 * alpha-renaming CSS references. Never use this for serialized-byte hashes.
 * @internal
 */
export function document_scoped_quads_semantically_equal(left: DocumentScopedQuadRecord, right: DocumentScopedQuadRecord): boolean {
  const meaning = (record: DocumentScopedQuadRecord) => JSON.stringify({
    document: record.document, occurrences: record.occurrences, subjects: record.subjects.map(subject => subject.path),
  });
  return meaning(left) === meaning(right);
}
