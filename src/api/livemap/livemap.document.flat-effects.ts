import type { HsonNode } from "../../core/types.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import { sha256_sync } from "../../core/sha256-sync.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { encode_exact_hson_value } from "./livemap.document.view-state-codec.js";
import { decode_scoped_effect_graph_operation, HOSTED_MAX_OPERATIONS } from "./livemap.hosted.js";
import { assert_portable_document_css_correspondence, decode_document_quads, document_quad_disposition } from "./livemap.document.quad.js";
import { document_css_subject_identities, remap_portable_document_css_identities } from "../../internal/css/css-identity-translation.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, type PortableDocumentStylesheetRecord } from "../../internal/css/portable-document-stylesheet.js";

/** One completed flat transaction, bound by its containing Library and authority
 * position. Graph operations retain their existing replacement lineage. Subjects
 * demand receiving identity; disposable labels never authorize a runtime QUID. */
export type DocumentFlatEffect = Readonly<{
  kind: "flat";
  before: string;
  after: string;
  graphs: readonly string[];
  css: PortableDocumentStylesheetRecord;
  subjects: PortableDocumentQuads;
}>;

export function is_flat_document_effect(value: unknown): value is DocumentFlatEffect {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "kind") && Reflect.get(value, "kind") === "flat";
}

/** Stable disposable labels make durable replay independent of either issuer. */
export function canonical_flat_correspondence(root: HsonNode, css: PortableDocumentStylesheetRecord,
  input?: PortableDocumentQuads): Readonly<{ css: PortableDocumentStylesheetRecord; subjects: PortableDocumentQuads }> {
  const subjects = decode_document_quads(input?.length ? input : undefined, root, "document") ?? [];
  assert_portable_document_css_correspondence(root, "document", subjects.length ? subjects : undefined, css);
  const demanded = new Set(document_css_subject_identities(css, "inbound"));
  const disposable = subjects.filter(s => document_quad_disposition(s) === "disposable")
    .sort((a, b) => JSON.stringify(a.path) < JSON.stringify(b.path) ? -1 : 1);
  if (disposable.some(s => !demanded.has(s.name))) throw new Error("Flat correspondence contains unused disposable subjects.");
  const authored = new Set(subjects.filter(s => document_quad_disposition(s) === "authored").map(s => s.name));
  const names = new Map<string, string>();
  let ordinal = 0;
  for (const subject of disposable) {
    let name: string;
    do { name = `_${(ordinal++).toString(36).padStart(9, "0")}`; } while (authored.has(name));
    names.set(subject.name, name);
  }
  for (const subject of subjects) if (!names.has(subject.name)) names.set(subject.name, subject.name);
  return { css: remap_portable_document_css_identities(css, names),
    subjects: subjects.map(s => ({ ...s, name: names.get(s.name) ?? s.name })).sort((a, b) => a.name < b.name ? -1 : 1) };
}

export function flat_document_fingerprint(root: HsonNode, css: PortableDocumentStylesheetRecord, subjects?: PortableDocumentQuads): string {
  return sha256_sync(JSON.stringify({ graph: encode_exact_hson_value(clone_hson_graph_without_quids(root)),
    ...canonical_flat_correspondence(root, css, subjects) }));
}

/** Envelope validation precedes candidate planning; graph-qualified validation
 * follows the complete ordered graph transaction, before any local issuance. */
export function validate_flat_document_effect(input: DocumentFlatEffect): DocumentFlatEffect {
  if (typeof input !== "object" || input === null
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || Reflect.ownKeys(input).some(key => { const property = Object.getOwnPropertyDescriptor(input, key)!;
      return typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value"); })
    || !is_flat_document_effect(input) || Object.keys(input).sort().join() !== "after,before,css,graphs,kind,subjects"
    || typeof input.before !== "string" || typeof input.after !== "string" || !/^[a-f0-9]{64}$/.test(input.before) || !/^[a-f0-9]{64}$/.test(input.after)
    || !Array.isArray(input.graphs) || input.graphs.length > HOSTED_MAX_OPERATIONS || !Array.isArray(input.subjects)) {
    throw new Error("Malformed flat document effect.");
  }
  if (input.graphs.length === 0 && input.before === input.after) throw new Error("Flat effect cannot invent an unchanged revision.");
  input.graphs.forEach(decode_scoped_effect_graph_operation);
  const css = encode_portable_document_stylesheet(decode_portable_document_stylesheet(input.css));
  if (JSON.stringify(css) !== JSON.stringify(input.css)) throw new Error("Noncanonical flat stylesheet.");
  return input;
}
