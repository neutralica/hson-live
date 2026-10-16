import type { DocumentGraphOp } from "./livemap.document.lineage.js";
import { ROOT_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { LiveMapDocumentPath, LiveMapGraphOp } from "../../types/livemap.types.js";
import { expand_document_composition, document_composition_options, has_part_connector,
  type DocumentCompositionSource, type DocumentCompositionStyle } from "./livemap.document.composition.js";
import { decode_document_scoped_quads, type DocumentScopedQuadRecord, type ScopedQuadBindingRecord } from "./livemap.document.scoped-quad-codec.js";
import { make_document_scoped_quads, encode_document_scoped_quads, new_document_quad_occurrence,
  retire_document_quad_occurrences, type DocumentScopedQuadContext, type DocumentScopedQuads,
  type DocumentQuadOccurrenceLifetime, type DocumentScopedQuadBinding } from "./livemap.document.scoped-quad.js";
import { allocate_livemap_quid } from "./livemap.quid-allocation.js";
import { stage_livemap_identity_epoch } from "./livemap.identity-epoch.js";
import { livemap_document_identity_quid_unavailable } from "./livemap.document.registration.js";
import { livemap_document_identity_quids, register_livemap_document_identity_at_path,
  livemap_document_identity_overlay_equal, type LiveMapDocumentIdentityEffect } from "./livemap.document.identity.js";
import { document_path_is_prefix, compare_document_paths, resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { admit_public_document_graph_operation, prepare_document_graph_operation } from "./livemap.document.mutation.js";
import { canonical_graph_equal } from "./livemap.document.install.js";

type Composition = ReturnType<typeof expand_document_composition>;
/** Borrowed transaction authority. The fence covers source reads and allocation callbacks. @internal */
export type DocumentScopedCompositionAuthority = Readonly<{
  identityOwner: object;
  assertCurrent: () => void;
  readPart: (collection: string, member: string) => DocumentCompositionSource;
}>;
/**
 * One detached Library candidate, never a second installed registry. Publication
 * must install graph, overlay, issued ledger, scopes and existing CSS preparation
 * together under assertCurrent. Cut 2 deliberately supplies no publication API:
 * core's aggregate candidate/install and initial Library construction are the
 * activation seams, after portable and hosted scope correspondence is complete.
 * Each step contains operation-local style contributions in its coordinates;
 * the existing CSS preparer must consume each before processing the next step.
 * @internal
 */
export type PreparedDocumentScopedComposition = DocumentScopedQuadContext & Readonly<{
  scopes: DocumentScopedQuads;
  identityEffects: readonly LiveMapDocumentIdentityEffect[];
  initialStyles: readonly DocumentCompositionStyle[];
  steps: readonly Readonly<{ operation: DocumentGraphOp; styles: readonly DocumentCompositionStyle[];
    context: DocumentScopedQuadContext; scopes: DocumentScopedQuads }>[];
  changed: boolean;
  assertCurrent: () => void;
}>;

function sorted(bindings: readonly ScopedQuadBindingRecord[]) {
  return [...bindings].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Validate the complete associations before demanding any additional identity. */
function merge(context: DocumentScopedQuadContext, state: DocumentScopedQuads,
  incoming: DocumentScopedQuadRecord, demands: readonly (readonly number[])[],
  parent: DocumentQuadOccurrenceLifetime | null, authority: DocumentScopedCompositionAuthority,
  foreignPayloads: ReadonlySet<string> = new Set()) {
  const existing = encode_document_scoped_quads(state, context, []);
  const parentScope = parent === null ? undefined : state.occurrences.find(scope => scope.lifetime === parent);
  if (parent !== null && parentScope === undefined) throw new Error("Insertion owner occurrence was retired.");
  const parentPath = parentScope === undefined ? null : context.overlay.pathForQuid(parentScope.rootQuid)!;
  const record = decode_document_scoped_quads({
    document: sorted([...existing.document, ...(parent === null ? incoming.document : [])]),
    occurrences: [...existing.occurrences.map(scope => ({ ...scope, bindings: sorted([...scope.bindings,
      ...(parentPath !== null && JSON.stringify(parentPath) === JSON.stringify(scope.root) ? incoming.document : [])]) })),
    ...incoming.occurrences.map(scope => ({ ...scope, parent: scope.parent ?? parentPath }))]
      .sort((a, b) => compare_document_paths(a.root, b.root)), subjects: [],
  }, context.root);
  return materialize_document_scoped_record(context, state, record, demands, authority, foreignPayloads);
}

/** Shared sparse issuer for composition and prevalidated incremental replay.
 * Existing occurrence markers are retained by their reconciled root coordinates.
 * Callers must retire replaced lifetimes before entering this function. @internal */
export function materialize_document_scoped_record(context: DocumentScopedQuadContext, state: DocumentScopedQuads,
  record: DocumentScopedQuadRecord, demands: readonly (readonly number[])[],
  authority: DocumentScopedCompositionAuthority, foreignPayloads: ReadonlySet<string> = new Set()) {
  decode_document_scoped_quads(record, context.root);
  const requested = new Map<string, LiveMapDocumentPath>();
  for (const path of [...record.document.map(binding => binding.path), ...record.occurrences.flatMap(scope =>
    [scope.root, ...scope.bindings.map(binding => binding.path)]), ...demands]) {
    const coordinate = validate_document_path(path);
    if (!is_ordinary_element_node(resolve_document_path(context.root, "document", coordinate))) {
      throw new TypeError("Composition identity demand requires an ordinary subject.");
    }
    requested.set(JSON.stringify(coordinate), coordinate);
  }
  authority.assertCurrent();
  let overlay = context.overlay;
  const reserved = new Set<string>();
  const effects: LiveMapDocumentIdentityEffect[] = [];
  for (const path of requested.values()) {
    if (overlay.quidAtPath(path) !== undefined) continue;
    const quid = allocate_livemap_quid(authority.identityOwner,
      candidate => context.issued.has(candidate) || reserved.has(candidate) || foreignPayloads.has(candidate)
        || livemap_document_identity_quid_unavailable(context.owner, candidate),
      candidate => ({ claimed: true, value: candidate }));
    authority.assertCurrent();
    if (quid === undefined) throw new Error("No available destination QUID for scoped composition.");
    reserved.add(quid);
    const registration = register_livemap_document_identity_at_path(overlay, quid, path);
    overlay = registration.overlay; effects.push(...registration.effects);
  }
  const next: DocumentScopedQuadContext = { ...context, overlay,
    issued: stage_livemap_identity_epoch(context.issued, livemap_document_identity_quids(context.overlay), livemap_document_identity_quids(overlay)) };
  const lifetimes = new Map(state.occurrences.map(scope => [JSON.stringify(context.overlay.pathForQuid(scope.rootQuid)), scope.lifetime]));
  for (const scope of record.occurrences) if (!lifetimes.has(JSON.stringify(scope.root))) {
    lifetimes.set(JSON.stringify(scope.root), new_document_quad_occurrence(context.owner));
  }
  const bindings = (entries: readonly ScopedQuadBindingRecord[]): DocumentScopedQuadBinding[] =>
    entries.map(({ name, kind, path }) => ({ name, kind, quid: overlay.quidAtPath(path)! }));
  const scopes = make_document_scoped_quads(next, bindings(record.document), record.occurrences.map(scope => ({
    lifetime: lifetimes.get(JSON.stringify(scope.root))!, rootQuid: overlay.quidAtPath(scope.root)!,
    parent: scope.parent === null ? null : lifetimes.get(JSON.stringify(scope.parent))!, bindings: bindings(scope.bindings),
  })));
  authority.assertCurrent();
  return { ...next, scopes, effects };
}

/**
 * Initial composition uses the same scoped model and sparse issuer as insertion.
 * The caller captures authority before reading any composition source.
 * @internal
 */
export function prepare_document_scoped_composition(context: DocumentScopedQuadContext, composition: Composition,
  authority: DocumentScopedCompositionAuthority): PreparedDocumentScopedComposition {
  authority.assertCurrent();
  if (context.root !== composition.root) throw new Error("Composition candidate requires its realized graph.");
  return prepare_initial(context, composition.scoped, composition.identityDemands, composition.styles, authority);
}

/** Source-free reconstruction shares the same sparse issuer and lifetime factory.
 * Transport labels exclude sender payloads from allocation but never become bindings. @internal
 */
export function prepare_document_scoped_reconstruction(context: DocumentScopedQuadContext,
  input: DocumentScopedQuadRecord, authority: DocumentScopedCompositionAuthority): PreparedDocumentScopedComposition {
  authority.assertCurrent();
  const record = decode_document_scoped_quads(input, context.root);
  return prepare_initial(context, record, record.subjects.map(subject => subject.path), [], authority,
    new Set(record.subjects.map(subject => subject.name.slice(1))));
}

function prepare_initial(context: DocumentScopedQuadContext, record: DocumentScopedQuadRecord,
  demands: readonly (readonly number[])[], styles: readonly DocumentCompositionStyle[],
  authority: DocumentScopedCompositionAuthority, foreignPayloads?: ReadonlySet<string>): PreparedDocumentScopedComposition {
  const empty = make_document_scoped_quads(context, [], []);
  const result = merge(context, empty, record, demands, null, authority, foreignPayloads);
  return Object.freeze({ owner: result.owner, root: result.root, overlay: result.overlay, issued: result.issued,
    scopes: result.scopes, identityEffects: Object.freeze(result.effects), initialStyles: styles, steps: Object.freeze([]),
    changed: true, assertCurrent: authority.assertCurrent });
}

/** Before-state registered occurrence boundaries determine insertion ownership. */
function insertion_owner(context: DocumentScopedQuadContext, state: DocumentScopedQuads, path: LiveMapDocumentPath) {
  let parent: DocumentQuadOccurrenceLifetime | null = null, depth = -1;
  for (const scope of state.occurrences) {
    const root = context.overlay.pathForQuid(scope.rootQuid)!;
    if (root.length > depth && document_path_is_prefix(root, path)) { parent = scope.lifetime; depth = root.length; }
  }
  return parent;
}

export function retain_document_scoped_operation(context: DocumentScopedQuadContext, state: DocumentScopedQuads, operation: LiveMapGraphOp,
  next: DocumentScopedQuadContext): DocumentScopedQuads {
  const displaced = operation.op === "replace-content" || operation.op === "remove-content"
    ? validate_document_path([...operation.target.path, operation.index]) : undefined;
  const retired = state.occurrences.filter(scope => next.overlay.pathForQuid(scope.rootQuid) === undefined
    || displaced !== undefined && document_path_is_prefix(displaced, context.overlay.pathForQuid(scope.rootQuid)!));
  const surviving = retire_document_quad_occurrences(state, retired.map(scope => scope.lifetime));
  const bindings = (entries: readonly DocumentScopedQuadBinding[]) => entries.filter(binding => next.overlay.pathForQuid(binding.quid) !== undefined);
  return make_document_scoped_quads(next, bindings(surviving.document), surviving.occurrences.map(scope => ({ ...scope, bindings: bindings(scope.bindings) })));
}

/** Runtime equality includes occurrence lifetime, even for identical portable coordinates. @internal */
export function document_scoped_quads_equal(left: DocumentScopedQuads, right: DocumentScopedQuads): boolean {
  const byLifetime = new Map(right.occurrences.map(scope => [scope.lifetime, scope]));
  return left.owner === right.owner && JSON.stringify(left.document) === JSON.stringify(right.document) && left.occurrences.length === right.occurrences.length
    && left.occurrences.every(scope => {
      const other = byLifetime.get(scope.lifetime);
      return other !== undefined && scope.parent === other.parent && scope.rootQuid === other.rootQuid
        && JSON.stringify(scope.bindings) === JSON.stringify(other.bindings);
    });
}

/**
 * Operation-local private preparation only. Every step uses the preceding
 * candidate, including its registered boundaries, ledger and fresh lifetimes.
 * Nothing is installed, even if a later step or the source fence rejects.
 * @internal
 */
export function prepare_document_scoped_operations(before: DocumentScopedQuadContext, scopes: DocumentScopedQuads,
  operations: readonly LiveMapGraphOp[], authority: DocumentScopedCompositionAuthority): PreparedDocumentScopedComposition {
  authority.assertCurrent();
  encode_document_scoped_quads(scopes, before, []);
  let context: DocumentScopedQuadContext = { owner: before.owner, root: before.root, overlay: before.overlay, issued: before.issued };
  let state = scopes, changed = false;
  const effects: LiveMapDocumentIdentityEffect[] = [], steps: PreparedDocumentScopedComposition["steps"][number][] = [];
  for (const input of operations) {
    let operation = admit_public_document_graph_operation(input);
    const content = operation.op === "insert-content" ? operation.content : operation.op === "replace-content" ? operation.replacement : undefined;
    let composition: Composition | undefined;
    if (is_Node(content) && has_part_connector(content)) {
      composition = expand_document_composition("ingress", () => ({ root: { $_tag: ROOT_TAG, $_content: [content] } }),
        document_composition_options(undefined), authority.readPart);
      authority.assertCurrent();
      const output = composition.root.$_content[0];
      if (!is_Node(output)) throw new Error("Part construction lost its incoming graph.");
      if (operation.op === "replace-content") {
        operation = { ...operation, replacement: output };
      } else if (operation.op === "insert-content") operation = { ...operation, content: output };
    }
    if (operation.op === "replace-root") throw new Error("Root installation uses initial scoped composition preparation.");
    const parent = insertion_owner(context, state, operation.target.path);
    const planned = prepare_document_graph_operation(context.root, "document", operation, context.overlay);
    let next: DocumentScopedQuadContext = { ...context, root: planned.root, overlay: planned.overlay,
      issued: stage_livemap_identity_epoch(context.issued, livemap_document_identity_quids(context.overlay), livemap_document_identity_quids(planned.overlay)) };
    let nextScopes = retain_document_scoped_operation(context, state, operation, next);
    effects.push(...planned.identityEffects);
    let styles: readonly DocumentCompositionStyle[] = [];
    if (composition !== undefined && (operation.op === "insert-content" || operation.op === "replace-content")) {
      const prefix = [...operation.target.path, operation.index];
      const relocate = (path: readonly number[]) => validate_document_path([...prefix, ...path.slice(1)]);
      const bindings = (entries: readonly ScopedQuadBindingRecord[]) => entries.map(binding => ({ ...binding, path: relocate(binding.path) }));
      const incoming: DocumentScopedQuadRecord = { document: bindings(composition.scoped.document), subjects: [],
        occurrences: composition.scoped.occurrences.map(scope => ({ root: relocate(scope.root),
          parent: scope.parent === null ? null : relocate(scope.parent), bindings: bindings(scope.bindings) })) };
      const merged = merge(next, nextScopes, incoming, composition.identityDemands.map(relocate), parent, authority);
      next = { owner: merged.owner, root: merged.root, overlay: merged.overlay, issued: merged.issued };
      nextScopes = merged.scopes; effects.push(...merged.effects);
      styles = composition.styles.map(style => ({ ...style, subjects: style.subjects.map(subject => ({ ...subject, path: relocate(subject.path) })) }));
    }
    changed ||= !canonical_graph_equal(context.root, next.root) || !livemap_document_identity_overlay_equal(context.overlay, next.overlay)
      || !document_scoped_quads_equal(state, nextScopes);
    context = next; state = nextScopes;
    steps.push(Object.freeze({ operation: planned.operation, context, scopes: state, styles: Object.freeze(styles) }));
    authority.assertCurrent();
  }
  authority.assertCurrent();
  return Object.freeze({ ...context, scopes: state, identityEffects: Object.freeze(effects), initialStyles: Object.freeze([]), steps: Object.freeze(steps),
    changed, assertCurrent: authority.assertCurrent });
}
