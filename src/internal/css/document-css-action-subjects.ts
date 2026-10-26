import type { HsonNode } from "../../core/types.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { encode_persisted_quid, is_persisted_quid, read_hson_node_quid } from "../../core/hson-node-quid.js";
import type { LiveMapCssOp, LiveMapDocumentPath } from "../../types/livemap.types.js";
import type { LiveMapDocumentIdentityOverlay } from "../../api/livemap/livemap.document.identity.js";
import type { LiveMapIssuedQuidLedger } from "../../api/livemap/livemap.identity-epoch.js";
import { compare_document_paths, resolve_document_path, validate_document_path } from "../../api/livemap/livemap.document.path.js";
import { DOCUMENT_SCOPED_QUAD_LIMITS } from "../../api/livemap/livemap.document.scoped-quad-codec.js";
import { encode_document_scoped_quads, type DocumentScopedQuads } from "../../api/livemap/livemap.document.scoped-quad.js";
import { map_scoped_css_operation } from "../../api/livemap/livemap.document.scoped-css.js";
import { css_array_items } from "./portable-document-stylesheet.js";
import { document_css_subject_identities, remap_portable_document_css_identities, translate_document_css_identities } from "./css-identity-translation.js";

/** Reserved CSS wire position, never a subject identity or bearer grant. */
export type DocumentCssActionPosition = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  sessionId: string;
  revision: number;
  projectionSequence: number;
}>;

/** Reserved CSS wire references; never installed in authored namespaces. */
export type DocumentCssActionSubjectContext = Readonly<{
  at: DocumentCssActionPosition;
  subjects: readonly Readonly<{ name: string; path: LiveMapDocumentPath; disposition: "disposable" }>[];
}>;

/** Borrowed existing Library authority. No issuance or installation capability. @internal */
export type DocumentCssActionDocument = Readonly<{
  owner: object;
  root: HsonNode;
  overlay: LiveMapDocumentIdentityOverlay;
  issued: LiveMapIssuedQuidLedger;
  scopes: DocumentScopedQuads | undefined;
  assertCurrent: () => void;
}>;

function invalid(): never { throw new TypeError("Invalid or stale document CSS subject correspondence."); }

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(name => typeof name !== "string" || !keys.includes(name)
    || !descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name]!, "value"))) invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
}

/** Structural admission only. Graph, coverage and freshness checks belong to serialized execution. @internal */
export function decode_document_css_action_subject_context(input: unknown): DocumentCssActionSubjectContext {
  const value = fields(input, ["at", "subjects"]);
  const at = fields(value.at, ["logicalMapId", "incarnationId", "sessionId", "revision", "projectionSequence"]);
  const text = (value: unknown): string => {
    if (typeof value !== "string" || value.length === 0) invalid();
    return value;
  };
  const revision = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) invalid();
    return value;
  };
  const array = (input: unknown, maximum: number): readonly unknown[] => {
    if (!Array.isArray(input) || input.length > maximum) invalid();
    return css_array_items(input);
  };
  const entries = array(value.subjects, DOCUMENT_SCOPED_QUAD_LIMITS.subjects);
  if (!entries.length || entries.length > DOCUMENT_SCOPED_QUAD_LIMITS.subjects) invalid();
  let segments = 0, previous: LiveMapDocumentPath | undefined;
  const names = new Set<string>();
  const subjects = entries.map(input => {
    const entry = fields(input, ["name", "path", "disposition"]), name = entry.name;
    if (typeof name !== "string" || name[0] !== "_" || !is_persisted_quid(name.slice(1))
      || entry.disposition !== "disposable" || names.has(name)) invalid();
    const parts = array(entry.path, DOCUMENT_SCOPED_QUAD_LIMITS.pathDepth);
    segments += parts.length;
    if (parts.length > DOCUMENT_SCOPED_QUAD_LIMITS.pathDepth || segments > DOCUMENT_SCOPED_QUAD_LIMITS.pathSegments
      || parts.some(part => Object.is(part, -0))) invalid();
    const path = validate_document_path(parts);
    if (previous !== undefined && compare_document_paths(previous, path) >= 0) invalid();
    previous = path; names.add(name);
    return Object.freeze({ name, path, disposition: "disposable" as const });
  });
  return Object.freeze({ at: Object.freeze({ logicalMapId: text(at.logicalMapId), incarnationId: text(at.incarnationId),
    sessionId: text(at.sessionId), revision: revision(at.revision), projectionSequence: revision(at.projectionSequence) }),
    subjects: Object.freeze(subjects) });
}

function demands(operation: LiveMapCssOp, direction: "outbound" | "inbound"): readonly string[] {
  const result = new Set<string>();
  map_scoped_css_operation(operation, css => {
    for (const name of document_css_subject_identities(css, direction)) result.add(name);
    return css;
  });
  return [...result];
}

function subject_at(document: DocumentCssActionDocument, path: LiveMapDocumentPath): string {
  const quid = document.overlay.quidAtPath(path);
  const reverse = quid === undefined ? undefined : document.overlay.pathForQuid(quid);
  const subject = resolve_document_path(document.root, "document", path);
  if (quid === undefined || !document.issued.has(quid) || reverse === undefined || compare_document_paths(reverse, path) !== 0
    || !is_ordinary_element_node(subject)) invalid();
  const metadata = read_hson_node_quid(subject);
  if (metadata !== undefined && metadata !== quid) invalid();
  return quid;
}

function check_scopes(document: DocumentCssActionDocument, quids: readonly string[]): void {
  if (document.scopes !== undefined) encode_document_scoped_quads(document.scopes, document, quids);
  document.assertCurrent();
}

/** Deterministic transport label payload, with no identity issuance. */
function disposable_payload(ordinal: number): string {
  const bytes = new Uint8Array(6);
  // The canonical encoder consumes the first 45 bits, leaving three low bits.
  let bits = ordinal * 8;
  for (let index = bytes.length - 1; index >= 0; index--) {
    bytes[index] = bits % 256;
    bits = Math.floor(bits / 256);
  }
  return encode_persisted_quid(bytes);
}

/** Prepare after queued lowering, under the receiving projection's current fence. @internal */
export function prepare_document_css_action_subjects(operation: LiveMapCssOp, document: DocumentCssActionDocument,
  position: () => Readonly<{ at: DocumentCssActionPosition; assertCurrent: () => void }>): Readonly<{
    operation: LiveMapCssOp; subjectContext?: DocumentCssActionSubjectContext;
  }> {
  document.assertCurrent();
  const quids = demands(operation, "outbound");
  if (!quids.length) return Object.freeze({ operation });
  const captured = position();
  const subjects = quids.map(quid => {
    const path = document.overlay.pathForQuid(quid);
    if (path === undefined || subject_at(document, path) !== quid) invalid();
    return { name: `_${quid}`, path, disposition: "disposable" as const };
  }).sort((a, b) => compare_document_paths(a.path, b.path));
  check_scopes(document, quids);
  const subjectContext = decode_document_css_action_subject_context({ at: captured.at, subjects });
  const assertCurrent = () => { document.assertCurrent(); captured.assertCurrent(); };
  const associations = subjectContext.subjects.map(subject => ({ ...subject, quid: subject.name.slice(1) }));
  const portable = map_scoped_css_operation(operation, css => translate_document_css_identities(css, "outbound", { associations, assertCurrent }, true));
  assertCurrent();
  return Object.freeze({ operation: portable, subjectContext });
}

/** Resolve only existing owner-issued subjects. Caller proves session position and permission first. @internal */
export function resolve_document_css_action_subjects(operation: LiveMapCssOp, context: DocumentCssActionSubjectContext,
  document: DocumentCssActionDocument): LiveMapCssOp {
  document.assertCurrent();
  const needed = new Set(demands(operation, "inbound"));
  if (needed.size !== context.subjects.length || context.subjects.some(subject => !needed.has(subject.name))) invalid();
  const associations = context.subjects.map(subject => ({ ...subject, quid: subject_at(document, subject.path) }));
  check_scopes(document, associations.map(subject => subject.quid));
  // Alpha-rename disposable labels away from receiving QUID payloads. A lexical
  // coincidence must never require the same-runtime restoration shortcut.
  const receiving = new Set(associations.map(subject => subject.quid)), names = new Map<string, string>();
  let ordinal = 0;
  for (const subject of associations) {
    let payload: string;
    do { payload = disposable_payload(ordinal++); } while (receiving.has(payload));
    names.set(subject.name, `_${payload}`);
  }
  const mapped = associations.map(subject => ({ ...subject, name: names.get(subject.name)! }));
  const result = map_scoped_css_operation(operation, css => translate_document_css_identities(
    remap_portable_document_css_identities(css, names), "inbound", { associations: mapped, assertCurrent: document.assertCurrent }, true));
  document.assertCurrent();
  return result;
}
