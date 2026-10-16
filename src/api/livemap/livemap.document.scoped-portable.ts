import type { HsonNode } from "../../core/types.js";
import { document_css_subject_identities, remap_portable_document_css_identities,
  translate_document_css_identities } from "../../internal/css/css-identity-translation.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet,
  portable_document_stylesheet_equal, type PortableDocumentStylesheetRecord } from "../../internal/css/portable-document-stylesheet.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { canonical_graph_equal } from "./livemap.document.install.js";
import { admit_public_livemap_root } from "./livemap.node-admission.js";
import { decode_document_scoped_quads, document_scoped_quads_semantically_equal,
  type DocumentScopedQuadRecord } from "./livemap.document.scoped-quad-codec.js";
import { encode_document_scoped_quads } from "./livemap.document.scoped-quad.js";
import type { PreparedDocumentScopedLibrary } from "./livemap.document.scoped-library.js";
import type { PreparedDocumentScopedComposition } from "./livemap.document.scoped-composition.js";

/** Private portable value, not a public Library snapshot or checkpoint format.
 * No runtime owner, ledger, epoch, or occurrence lifetime crosses this boundary. @internal
 */
export type PortableDocumentScopedLibrary = Readonly<{
  root: HsonNode;
  scopes: DocumentScopedQuadRecord;
  css: PortableDocumentStylesheetRecord;
}>;

/** Validate the complete portable value before requesting any receiving identity. @internal */
export function decode_document_scoped_library(input: unknown): PortableDocumentScopedLibrary {
  if (typeof input !== "object" || input === null
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new TypeError("Scoped Library capture requires an exact data record.");
  }
  const keys = Reflect.ownKeys(input), values = new Map<string, unknown>();
  if (keys.length !== 3 || keys.some(key => typeof key !== "string" || !["root", "scopes", "css"].includes(key))) {
    throw new TypeError("Invalid scoped Library capture fields.");
  }
  for (const key of ["root", "scopes", "css"]) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) throw new TypeError("Scoped Library capture requires own data fields.");
    values.set(key, field.value);
  }
  const root = admit_public_livemap_root(values.get("root"), "document", "LiveMap.scoped-restore");
  const scopes = decode_document_scoped_quads(values.get("scopes"), root);
  const css = encode_portable_document_stylesheet(decode_portable_document_stylesheet(values.get("css")));
  const demanded = new Set(document_css_subject_identities(css, "inbound"));
  if (demanded.size !== scopes.subjects.length || scopes.subjects.some(subject => !demanded.has(subject.name))) {
    throw new TypeError("Scoped CSS requires exact transport-subject correspondence.");
  }
  // Normalize only subject references through the existing CSS parser. Authored
  // scope names never participate, even when they textually equal these labels.
  const canonicalCss = remap_portable_document_css_identities(css, new Map(scopes.subjects.map(subject => [subject.name, subject.name])));
  const roots = new Set(scopes.occurrences.map(scope => JSON.stringify(scope.root)));
  const owners = new Set(scopes.subjects.filter(subject => roots.has(JSON.stringify(subject.path)))
    .map(subject => `[hson\\:quad="${subject.name}"]`));
  const pending = [...canonicalCss.order];
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.owner !== undefined && !owners.has(entry.owner)) throw new TypeError("Part CSS owner must be a declared occurrence root.");
    if (entry.kind === "group") pending.push(...entry.entries);
  }
  return Object.freeze({ root, scopes, css: canonicalCss });
}

/** The Library authority authenticates the candidate before entering this pure capture. @internal */
export function capture_document_scoped_library(candidate: PreparedDocumentScopedLibrary): PortableDocumentScopedLibrary {
  candidate.assertCurrent();
  const runtimeCss = encode_portable_document_stylesheet(candidate.stylesheet);
  const scopes = encode_document_scoped_quads(candidate.scopes, candidate, document_css_subject_identities(runtimeCss, "outbound"));
  const associations = scopes.subjects.map(subject => {
    const quid = candidate.overlay.quidAtPath(subject.path);
    if (quid === undefined || !candidate.issued.has(quid)) throw new Error("Scoped capture requires an issued active subject.");
    return { ...subject, quid };
  });
  const css = translate_document_css_identities(runtimeCss, "outbound", { associations, assertCurrent: candidate.assertCurrent }, true);
  const result = decode_document_scoped_library({ root: clone_hson_graph_without_quids(candidate.root), scopes, css });
  candidate.assertCurrent();
  return result;
}

/** Consume only the separate, prevalidated transport table after staged issuance. @internal */
export function restore_document_scoped_library_styles(candidate: PreparedDocumentScopedComposition,
  portable: PortableDocumentScopedLibrary): PreparedDocumentScopedLibrary {
  candidate.assertCurrent();
  const associations = portable.scopes.subjects.map(subject => {
    const quid = candidate.overlay.quidAtPath(subject.path);
    if (quid === undefined || !candidate.issued.has(quid)) throw new Error("Scoped CSS restoration requires an issued active subject.");
    return { ...subject, quid };
  });
  const css = translate_document_css_identities(portable.css, "inbound", { associations, assertCurrent: candidate.assertCurrent }, true);
  const stylesheet = decode_portable_document_stylesheet(css);
  candidate.assertCurrent();
  return Object.freeze({ ...candidate, stylesheet, effects: undefined });
}

/** Equality of portable meaning after alpha-renaming CSS subject references by
 * path. It neither proves runtime occurrence continuity nor defines checkpoint
 * hashes, hosted replay equality, or general browser CSS equivalence. @internal
 */
export function document_scoped_libraries_semantically_equal(left: unknown, right: unknown): boolean {
  const a = decode_document_scoped_library(left), b = decode_document_scoped_library(right);
  if (!canonical_graph_equal(a.root, b.root) || !document_scoped_quads_semantically_equal(a.scopes, b.scopes)) return false;
  const names = new Map(b.scopes.subjects.map((subject, index) => [subject.name, a.scopes.subjects[index]!.name]));
  return portable_document_stylesheet_equal(decode_portable_document_stylesheet(a.css),
    decode_portable_document_stylesheet(remap_portable_document_css_identities(b.css, names)));
}

/** Exact optional scoped content field; never authorizes a Library. @internal */
export function own_document_scopes(input: object): unknown | undefined {
  const field = Object.getOwnPropertyDescriptor(input, "scopes");
  if (field === undefined) return undefined;
  if (!field.enumerable || !Object.hasOwn(field, "value") || field.value === undefined) {
    throw new TypeError("Scoped state requires an own defined data field.");
  }
  if (Object.hasOwn(input, "quads")) throw new TypeError("Conflicting flat/scoped correspondence.");
  return field.value;
}
