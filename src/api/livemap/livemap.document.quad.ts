import { own_enumerable_data_property } from "../../core/node-storage.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { _throw_transform_err } from "../../core/errors.js";
import type { AuthoredQuadDeclaration } from "../transform/token.types.js";
import { parse_hson_source } from "../transform/parsers/parse-hson-source.js";
import { split_attrs_meta } from "../transform/utils/hson-utils/split-attrs-meta.js";
import { HsonSourceProvenanceBuilder } from "../../internal/hson-source-provenance/hson-source-provenance.js";
import { qualify_livemap_document } from "./livemap.node-admission.js";
import { normalize_document_root } from "./livemap.document.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import type { LiveMapDocumentPath, PortableDocumentQuads } from "../../types/livemap.types.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import { read_hson_node_quid, is_persisted_quid } from "../../core/hson-node-quid.js";
import { is_document_quad_name } from "../../internal/document-quad-name.js";
import { document_css_subject_identities } from "../../internal/css/css-identity-translation.js";
import type { PortableDocumentStylesheetRecord } from "../../internal/css/portable-document-stylesheet.js";
/** @internal */
export { is_document_quad_name } from "../../internal/document-quad-name.js";

/** Only names and legitimate local subject identities survive admission. @internal */
export type DocumentQuadBindings = Readonly<{
  byName: ReadonlyMap<string, string>;
  byQuid: ReadonlyMap<string, string>;
}>;
/** Coordinates belong only to the coherent admission candidate, never working identity. @internal */
export type DocumentQuadAdmission = Readonly<{ name: string; path: LiveMapDocumentPath }>;
/** Current correspondence, resolved through the existing subject overlay. @internal */
export type DocumentQuadSubject = Readonly<{ name: string; quid: string; path: LiveMapDocumentPath }>;
/** Detached admission result for one operation; never installed in the authored registry. @internal */
export type DocumentQuadCorrespondence = DocumentQuadSubject & Readonly<{ disposition: "authored" | "disposable" }>;

/** Read validated own disposition evidence without inheriting prototype fields. @internal */
export function document_quad_disposition(entry: PortableDocumentQuads[number]): "authored" | "disposable" {
  return Object.getOwnPropertyDescriptor(entry, "disposition") === undefined ? "authored" : "disposable";
}

/** Operation-local exclusions use own data evidence; full admission remains graph-qualified. @internal */
export function disposable_document_quad_payloads(inputs: readonly (PortableDocumentQuads | undefined)[]): ReadonlySet<string> {
  const payloads = new Set<string>();
  for (const entries of inputs) {
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error("Invalid portable QUAD exclusion array.");
    for (const entry of exact_array(entries)) {
      if (typeof entry !== "object" || entry === null) throw new Error("Invalid portable QUAD exclusion evidence.");
      const disposition = Object.getOwnPropertyDescriptor(entry, "disposition");
      if (disposition === undefined) continue;
      const name = Object.getOwnPropertyDescriptor(entry, "name");
      if (!disposition.enumerable || !Object.hasOwn(disposition, "value") || disposition.value !== "disposable"
        || !name?.enumerable || !Object.hasOwn(name, "value") || typeof name.value !== "string"
        || name.value[0] !== "_" || !is_persisted_quid(name.value.slice(1))) throw new Error("Invalid disposable QUAD exclusion evidence.");
      payloads.add(name.value.slice(1));
    }
  }
  return payloads;
}

const addressedRoots = new WeakSet<HsonNode>();
const lookups = new WeakMap<object, (name: string | undefined, quid: string | undefined) => DocumentQuadSubject | undefined>();

const fail_quad_declaration = (message: string, declaration: AuthoredQuadDeclaration, code: string, first?: AuthoredQuadDeclaration): never =>
    _throw_transform_err(message, "LiveMap.authored-document", undefined, undefined, {
      code, stage: "library-admission",
      source: { index: declaration.start.index, line: declaration.start.line, column: declaration.start.col },
      ...(first === undefined ? {} : { related: [{ role: "first-declaration", source: {
        index: first.start.index, line: first.start.line, column: first.start.col,
      } }] }),
    });

/** Share declaration uniqueness and source evidence with diagnostic-only scanner observers. @internal */
export function register_document_quad_declaration(names: Map<string, AuthoredQuadDeclaration>, declaration: AuthoredQuadDeclaration): void {
  const first = names.get(declaration.value);
  if (first !== undefined) fail_quad_declaration(`duplicate authored QUAD ${JSON.stringify(declaration.value)}`, declaration, "HSON_LIBRARY_QUAD_DUPLICATE", first);
  names.set(declaration.value, declaration);
}

/** Private authored source admission, preserving scanner diagnostics and occurrence evidence. @internal */
export function parse_authored_document_library(source: string): Readonly<{ root: HsonNode; declarations: readonly DocumentQuadAdmission[] }> {
  const names = new Map<string, AuthoredQuadDeclaration>();
  const subjects = new WeakMap<HsonNode, string>();
  const root = normalize_document_root(parse_hson_source(source, split_attrs_meta,
    { allowTopLevelDocumentText: true }, new HsonSourceProvenanceBuilder(), false, (node, declaration) => {
      if (!is_ordinary_element_node(node)) fail_quad_declaration("QUAD subject must be an ordinary document element", declaration, "HSON_LIBRARY_QUAD_INELIGIBLE");
      register_document_quad_declaration(names, declaration);
      subjects.set(node, declaration.value);
    }));
  const declarations: DocumentQuadAdmission[] = [];
  const stack: { node: HsonNode; path: readonly number[] }[] = [{ node: root, path: [] }];
  while (stack.length) {
    const entry = stack.pop()!;
    const name = subjects.get(entry.node);
    if (name !== undefined) declarations.push(Object.freeze({ name, path: validate_document_path(entry.path) }));
    for (let index = entry.node.$_content.length - 1; index >= 0; index--) {
      const child = entry.node.$_content[index];
      if (is_Node(child)) stack.push({ node: child, path: [...entry.path, index] });
    }
  }
  if (declarations.length !== names.size) throw new Error("Authored QUAD occurrence was lost during document admission.");
  return Object.freeze({ root, declarations: Object.freeze(declarations) });
}

/** Build reversible local address state; the owning aggregate proves each QUID. @internal */
export function make_document_quad_bindings(entries: readonly Readonly<{ name: string; quid: string }>[]): DocumentQuadBindings {
  const byName = new Map<string, string>(), byQuid = new Map<string, string>();
  for (const { name, quid } of entries) {
    if (!is_document_quad_name(name) || !is_persisted_quid(quid)
      || byName.has(name) || byQuid.has(quid)) throw new Error("Invalid or duplicate local QUAD binding.");
    byName.set(name, quid); byQuid.set(quid, name);
  }
  return Object.freeze({ byName, byQuid });
}

/** Final overlay membership owns retirement; moves and legitimate lineage need no path tracker. @internal */
export function retain_document_quad_bindings(bindings: DocumentQuadBindings | undefined, overlay: LiveMapDocumentIdentityOverlay): DocumentQuadBindings | undefined {
  if (bindings === undefined) return undefined;
  const retained = [...bindings.byName].filter(([, quid]) => overlay.pathForQuid(quid) !== undefined);
  return retained.length === bindings.byName.size ? bindings
    : make_document_quad_bindings(retained.map(([name, quid]) => ({ name, quid })));
}

/** Mark owned roots whose detached view-state envelope cannot carry the Library registry. @internal */
export function mark_quad_document_root(root: HsonNode, bindings: DocumentQuadBindings | undefined): void {
  if (bindings !== undefined && bindings.byName.size) addressedRoots.add(root);
}
/** Detached view-state captures have no Library-owned association installer. @internal */
export function assert_quad_free_document_capture(root: HsonNode): void {
  if (addressedRoots.has(root)) throw new Error("QUAD-bearing detached document capture is unsupported; use the portable document Library envelope.");
}

/** Resolve one subject without cloning any Library graph. @internal */
export function resolve_document_quad(root: HsonNode, overlay: LiveMapDocumentIdentityOverlay,
  bindings: DocumentQuadBindings | undefined, name: string | undefined, quid: string | undefined): DocumentQuadSubject | undefined {
  const authoredName = name ?? (quid === undefined ? undefined : bindings?.byQuid.get(quid));
  if (authoredName === undefined) return undefined;
  const identity = bindings?.byName.get(authoredName);
  if (identity === undefined || (quid !== undefined && identity !== quid) || bindings?.byQuid.get(identity) !== authoredName) return undefined;
  const path = overlay.pathForQuid(identity);
  if (path === undefined || overlay.quidAtPath(path) !== identity) return undefined;
  let subject: HsonNode | Primitive;
  try { subject = resolve_document_path(root, "document", path); }
  catch { return undefined; }
  if (!is_ordinary_element_node(subject)) return undefined;
  const metadata = read_hson_node_quid(subject);
  if (metadata !== undefined && metadata !== identity) return undefined;
  return Object.freeze({ name: authoredName, quid: identity, path: validate_document_path(path) });
}

/** Register the Library's existing authored-subject lookup capability. @internal */
export function register_document_quad_lookup(owner: object, lookup: (name: string | undefined, quid: string | undefined) => DocumentQuadSubject | undefined): void {
  lookups.set(owner, lookup);
}
/** @internal */
export function lookup_document_quad_internal(owner: object, name: string): DocumentQuadSubject | undefined {
  return lookups.get(owner)?.(name, undefined);
}
/** @internal */
export function authored_quad_for_quid_internal(owner: object, quid: string): DocumentQuadSubject | undefined {
  return lookups.get(owner)?.(undefined, quid);
}

/** Optional associations originate only in an explicit own data field. @internal */
export function own_document_quads(input: Readonly<{ quads?: PortableDocumentQuads }>): PortableDocumentQuads | undefined;
export function own_document_quads(input: Readonly<Record<string, unknown>>): unknown;
export function own_document_quads(input: Readonly<Record<string, unknown>>): unknown {
  const field = own_enumerable_data_property(input, "quads");
  if (field === undefined || (field.present && field.value === undefined)) {
    throw new Error("Portable QUAD associations require an own enumerable data field.");
  }
  return field.present ? field.value : undefined;
}

/** Validate all associations against the complete qualified receiving graph. @internal */
export function decode_document_quads(input: unknown, root: HsonNode, mode: string): PortableDocumentQuads | undefined {
  if (input === undefined) return undefined;
  if (mode !== "document" || !Array.isArray(input) || input.length === 0) throw new Error("Invalid portable QUAD associations.");
  qualify_livemap_document(root, "portable QUAD associations");
  const candidates = exact_array(input);
  const names = new Set<string>(), paths = new Set<string>(), subjects = new Set<HsonNode>();
  let previous: string | undefined;
  const entries = candidates.map((item: unknown): PortableDocumentQuads[number] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("Invalid portable QUAD binding.");
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Invalid portable QUAD binding prototype.");
    const keys = Reflect.ownKeys(item);
    const disposition = Object.getOwnPropertyDescriptor(item, "disposition");
    if (keys.length !== (disposition === undefined ? 2 : 3)
      || !keys.every(key => key === "name" || key === "path" || key === "disposition")
      || (disposition !== undefined && (!disposition.enumerable || !Object.hasOwn(disposition, "value")
        || disposition.value !== "disposable"))) throw new Error("Invalid portable QUAD binding fields or disposition.");
    const name = Object.getOwnPropertyDescriptor(item, "name"), coordinate = Object.getOwnPropertyDescriptor(item, "path");
    if (!name?.enumerable || !Object.hasOwn(name, "value") || !coordinate?.enumerable || !Object.hasOwn(coordinate, "value")
      || !is_document_quad_name(name.value) || names.has(name.value)
      || (previous !== undefined && previous >= name.value) || !Array.isArray(coordinate.value)) throw new Error("Invalid portable QUAD name or order.");
    if (disposition !== undefined && (name.value[0] !== "_" || !is_persisted_quid(name.value.slice(1)))) {
      throw new Error("Disposable QUAD requires the exact underscore-prefixed QUID payload.");
    }
    const segments = exact_array(coordinate.value);
    // Negative zero has a second spelling but no distinct structural meaning.
    if (segments.some((part: unknown) => Object.is(part, -0))) throw new Error("Noncanonical portable QUAD path.");
    const path = validate_document_path(segments);
    const key = JSON.stringify(path), subject = resolve_document_path(root, "document", path);
    if (!is_ordinary_element_node(subject) || paths.has(key) || subjects.has(subject)) throw new Error("Invalid or duplicate portable QUAD subject.");
    names.add(name.value); paths.add(key); subjects.add(subject); previous = name.value;
    const admission: PortableDocumentQuads[number] = disposition === undefined
      ? { name: name.value, path } : { name: name.value, path, disposition: "disposable" };
    return Object.freeze(admission);
  });
  return Object.freeze(entries);
}

/** Portable CSS references are valid only with this complete graph's exact associations. @internal */
export function assert_portable_document_css_correspondence(root: HsonNode, mode: string, input: unknown,
  css: PortableDocumentStylesheetRecord): void {
  const entries = decode_document_quads(input, root, mode);
  const names = new Set(entries?.map(entry => entry.name));
  for (const name of document_css_subject_identities(css, "inbound")) {
    if (!names.has(name)) throw new Error("Portable CSS requires a corresponding ordinary Library subject.");
  }
}

/** Project only already-issued active subjects, alongside all existing authored bindings. @internal */
export function project_document_correspondence(root: HsonNode, overlay: LiveMapDocumentIdentityOverlay,
  bindings: DocumentQuadBindings | undefined, issued: Readonly<{ has: (quid: string) => boolean }>,
  requested: readonly string[]): PortableDocumentQuads | undefined {
  if (!Array.isArray(requested)) throw new Error("Correspondence requires an exact subject array.");
  const entries: PortableDocumentQuads[number][] = [...(capture_document_quads(root, overlay, bindings, issued) ?? [])];
  const seen = new Set<string>();
  for (const quid of exact_array(requested)) {
    if (!is_persisted_quid(quid) || !issued.has(quid)) throw new Error("Correspondence requires an owner-issued QUID.");
    if (seen.has(quid)) continue;
    seen.add(quid);
    const path = overlay.pathForQuid(quid);
    if (path === undefined || overlay.quidAtPath(path) !== quid) throw new Error("Correspondence requires an active subject.");
    const subject = resolve_document_path(root, "document", path);
    if (!is_ordinary_element_node(subject)) throw new Error("Correspondence requires an ordinary element.");
    const metadata = read_hson_node_quid(subject);
    if (metadata !== undefined && metadata !== quid) throw new Error("Incoherent correspondence subject identity.");
    const authored = bindings?.byQuid.get(quid);
    if (authored !== undefined) {
      if (resolve_document_quad(root, overlay, bindings, authored, quid) === undefined) throw new Error("Incoherent authored correspondence.");
    } else entries.push(Object.freeze({ name: `_${quid}`, path: validate_document_path(path), disposition: "disposable" }));
  }
  // Authored/disposable collisions are errors, including authored names outside the requested set.
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return entries.length === 0 ? undefined : decode_document_quads(entries, root, "document");
}

function exact_array(input: readonly unknown[]): readonly unknown[] {
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1) throw new Error("Portable QUAD arrays must be dense and exact.");
  const detached: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Portable QUAD arrays require own data entries.");
    detached.push(descriptor.value);
  }
  return detached;
}

/** Resolve current paths without acquiring identity or maintaining a path index. @internal */
export function capture_document_quads(root: HsonNode, overlay: LiveMapDocumentIdentityOverlay,
  bindings: DocumentQuadBindings | undefined, issued: Readonly<{ has: (quid: string) => boolean }>): PortableDocumentQuads | undefined {
  if (bindings === undefined || bindings.byName.size === 0) return undefined;
  const entries = [...bindings.byName.keys()].sort().map(name => {
    const subject = resolve_document_quad(root, overlay, bindings, name, undefined);
    if (subject === undefined || !issued.has(subject.quid)) throw new Error("Portable capture requires coherent owner-issued QUAD bindings.");
    return Object.freeze({ name, path: subject.path });
  });
  return decode_document_quads(entries, root, "document");
}
