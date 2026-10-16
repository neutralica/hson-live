import type { HsonNode } from "../../core/types.js";
import { is_persisted_quid, read_hson_node_quid } from "../../core/hson-node-quid.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import type { LiveMapLibraryIdentity } from "./livemap.library.js";
import type { LiveMapIssuedQuidLedger } from "./livemap.identity-epoch.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import type { LiveMapDocumentPath } from "../../types/livemap.types.js";
import { compare_document_paths, resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { decode_document_scoped_quads, DOCUMENT_SCOPED_QUAD_LIMITS, type DocumentScopedQuadRecord } from "./livemap.document.scoped-quad-codec.js";

const occurrenceOwner = Symbol("Library occurrence lifetime");
// Exact factory provenance only; unrelated to QUID issuance or transport identity.
const occurrenceLifetimes = new WeakSet<object>();
/** A local lifetime marker, not a subject identity or portable address. @internal */
export type DocumentQuadOccurrenceLifetime = Readonly<{ [occurrenceOwner]: LiveMapLibraryIdentity }>;
/** @internal */
export type DocumentScopedQuadBinding = Readonly<{ name: string; kind: "element" | "part"; quid: string }>;
/** @internal */
export type DocumentQuadOccurrenceScope = Readonly<{
  lifetime: DocumentQuadOccurrenceLifetime;
  rootQuid: string;
  parent: DocumentQuadOccurrenceLifetime | null;
  bindings: readonly DocumentScopedQuadBinding[];
}>;
/**
 * Immutable candidate owned by one Library. It retains no graph, paths, handles,
 * issuer, ledger, or second identity index. Current paths come from its overlay.
 * Presence in the installed candidate determines which occurrences are alive.
 * @internal
 */
export type DocumentScopedQuads = Readonly<{
  owner: LiveMapLibraryIdentity;
  document: readonly DocumentScopedQuadBinding[];
  occurrences: readonly DocumentQuadOccurrenceScope[];
}>;
/** Existing owner evidence, borrowed only while preparing/validating a candidate. @internal */
export type DocumentScopedQuadContext = Readonly<{
  owner: LiveMapLibraryIdentity;
  root: HsonNode;
  overlay: LiveMapDocumentIdentityOverlay;
  issued: LiveMapIssuedQuidLedger;
}>;

/**
 * Composition creates one marker per new occurrence, including unnamed Parts.
 * Only explicit occurrence survival may reuse it; a surviving root QUID is not
 * that evidence. No counter, QUID allocation, or durable identity is involved.
 * @internal
 */
export function new_document_quad_occurrence(owner: LiveMapLibraryIdentity): DocumentQuadOccurrenceLifetime {
  const lifetime = Object.freeze({ [occurrenceOwner]: owner });
  occurrenceLifetimes.add(lifetime);
  return lifetime;
}

/** Retain the marker itself only when its Library association cannot change. */
function assert_occurrence_lifetime(lifetime: DocumentQuadOccurrenceLifetime, owner: LiveMapLibraryIdentity): void {
  // Authenticate before reflection: even a transparent Proxy can later revoke.
  if (!occurrenceLifetimes.has(lifetime)) {
    throw new TypeError("Scoped QUAD lifetime requires a factory-issued marker with immutable own-data Library ownership.");
  }
  const descriptor = typeof lifetime === "object" && lifetime !== null
    ? Object.getOwnPropertyDescriptor(lifetime, occurrenceOwner) : undefined;
  // Frozen accessors can still read mutable external state. Never read the
  // symbol as a property; only immutable own-data evidence establishes ownership.
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")
    || descriptor.writable !== false || descriptor.configurable !== false
    || descriptor.value !== owner || !Object.isFrozen(lifetime)) {
    throw new TypeError("Scoped QUAD lifetime requires a frozen marker with immutable own-data Library ownership.");
  }
}

/** Prepare a detached candidate; publication remains the Library transaction's job. @internal */
export function make_document_scoped_quads(context: DocumentScopedQuadContext,
  document: readonly DocumentScopedQuadBinding[], occurrences: readonly DocumentQuadOccurrenceScope[]): DocumentScopedQuads {
  if (occurrences.length > DOCUMENT_SCOPED_QUAD_LIMITS.occurrences) throw new TypeError("Scoped QUAD occurrence resource bound.");
  let remaining = DOCUMENT_SCOPED_QUAD_LIMITS.bindings;
  const copyBindings = (bindings: readonly DocumentScopedQuadBinding[]): readonly DocumentScopedQuadBinding[] => {
    remaining -= bindings.length;
    if (remaining < 0) throw new TypeError("Scoped QUAD binding resource bound.");
    return Object.freeze(bindings.map(({ name, kind, quid }) => Object.freeze({ name, kind, quid }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  };
  const state: DocumentScopedQuads = Object.freeze({
    owner: context.owner,
    document: copyBindings(document),
    occurrences: Object.freeze(occurrences.map(({ lifetime, rootQuid, parent, bindings }) =>
      Object.freeze({ lifetime, rootQuid, parent, bindings: copyBindings(bindings) }))),
  });
  encode_document_scoped_quads(state, context, []);
  return state;
}

/**
 * Project observationally through the existing sparse overlay. Only demanded
 * subjects get transport entries; logical bindings and occurrence roots retain
 * their canonical coordinates independently. Repeated demands collapse by QUID.
 * Nothing here registers names, installs state, or issues/accepts an identity.
 * @internal
 */
export function encode_document_scoped_quads(state: DocumentScopedQuads, context: DocumentScopedQuadContext,
  demanded: readonly string[]): DocumentScopedQuadRecord {
  if (state.owner !== context.owner) throw new TypeError("Scoped QUAD Library ownership mismatch.");
  if (state.occurrences.length > DOCUMENT_SCOPED_QUAD_LIMITS.occurrences || demanded.length > DOCUMENT_SCOPED_QUAD_LIMITS.subjects) {
    throw new TypeError("Scoped QUAD resource bound.");
  }
  const paths = new Map<string, LiveMapDocumentPath>();
  const path = (quid: string): LiveMapDocumentPath => {
    const cached = paths.get(quid);
    if (cached !== undefined) return cached;
    if (!is_persisted_quid(quid) || !context.issued.has(quid)) throw new TypeError("Scoped QUAD requires an owner-issued QUID.");
    const coordinate = context.overlay.pathForQuid(quid);
    if (coordinate === undefined || context.overlay.quidAtPath(coordinate) !== quid) throw new TypeError("Scoped QUAD requires an active overlay subject.");
    const subject = resolve_document_path(context.root, "document", coordinate);
    if (!is_ordinary_element_node(subject)) throw new TypeError("Scoped QUAD requires an ordinary subject.");
    const metadata = read_hson_node_quid(subject);
    if (metadata !== undefined && metadata !== quid) throw new TypeError("Scoped QUAD subject metadata mismatch.");
    const detached = validate_document_path(coordinate);
    paths.set(quid, detached);
    return detached;
  };
  const byLifetime = new Map<DocumentQuadOccurrenceLifetime, DocumentQuadOccurrenceScope>();
  for (const occurrence of state.occurrences) {
    assert_occurrence_lifetime(occurrence.lifetime, state.owner);
    if (occurrence.parent !== null) assert_occurrence_lifetime(occurrence.parent, state.owner);
    if (byLifetime.has(occurrence.lifetime)) throw new TypeError("Invalid or duplicate scoped QUAD lifetime.");
    byLifetime.set(occurrence.lifetime, occurrence);
  }
  const bindings = (entries: readonly DocumentScopedQuadBinding[]) => entries.map(({ name, kind, quid }) => ({ name, kind, path: path(quid) }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const occurrences = state.occurrences.map(occurrence => {
    const parent = occurrence.parent === null ? undefined : byLifetime.get(occurrence.parent);
    if (occurrence.parent !== null && parent === undefined) throw new TypeError("Scoped QUAD parent is not a live occurrence.");
    return { root: path(occurrence.rootQuid), parent: parent === undefined ? null : path(parent.rootQuid), bindings: bindings(occurrence.bindings) };
  }).sort((left, right) => compare_document_paths(left.root, right.root));
  const subjects = [...new Set(demanded)].map(quid => ({ name: `_${quid}`, path: path(quid), disposition: "disposable" as const }))
    .sort((left, right) => compare_document_paths(left.path, right.path));
  return decode_document_scoped_quads({ document: bindings(state.document), occurrences, subjects }, context.root);
}

/**
 * Explicit occurrence retirement removes descendant scopes and incoming Part
 * names, even when the root subject QUID survives. Subject retirement and moves
 * still require the transaction's final overlay and candidate validation.
 * @internal
 */
export function retire_document_quad_occurrences(state: DocumentScopedQuads,
  retired: readonly DocumentQuadOccurrenceLifetime[]): DocumentScopedQuads {
  const live = new Map(state.occurrences.map(occurrence => [occurrence.lifetime, occurrence]));
  const dead = new Set(retired);
  for (const lifetime of dead) if (!live.has(lifetime)) throw new TypeError("Cannot retire a foreign or inactive occurrence.");
  const children = new Map<DocumentQuadOccurrenceLifetime, DocumentQuadOccurrenceLifetime[]>();
  for (const occurrence of state.occurrences) {
    if (occurrence.parent === null) continue;
    const siblings = children.get(occurrence.parent) ?? [];
    siblings.push(occurrence.lifetime); children.set(occurrence.parent, siblings);
  }
  // Set iteration also visits descendants appended during traversal.
  for (const lifetime of dead) for (const child of children.get(lifetime) ?? []) dead.add(child);
  const roots = new Set([...dead].map(lifetime => live.get(lifetime)!.rootQuid));
  const retain = (bindings: readonly DocumentScopedQuadBinding[]) => Object.freeze(bindings.filter(binding => binding.kind !== "part" || !roots.has(binding.quid)));
  return Object.freeze({ owner: state.owner, document: retain(state.document),
    occurrences: Object.freeze(state.occurrences.filter(occurrence => !dead.has(occurrence.lifetime))
      .map(occurrence => Object.freeze({ ...occurrence, bindings: retain(occurrence.bindings) }))),
  });
}
