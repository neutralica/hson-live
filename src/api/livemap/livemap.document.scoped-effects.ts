import { map_scoped_css_operation } from "./livemap.document.scoped-css.js";
import { apply_portable_document_css_op, canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { sha256_sync } from "../../core/sha256-sync.js";
import { is_document_quad_name } from "../../internal/document-quad-name.js";
import { document_css_subject_identities, remap_portable_document_css_identities, translate_document_css_identities } from "../../internal/css/css-identity-translation.js";
import { merge_part_stylesheets, retire_part_styles_by_owner } from "../../internal/css/part-stylesheet.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, portable_document_stylesheet_equal, type PortableDocumentStylesheetRecord } from "../../internal/css/portable-document-stylesheet.js";
import type { LiveMapCssOp, LiveMapDocumentPath } from "../../types/livemap.types.js";
import type { DocumentCompositionStyle } from "./livemap.document.composition.js";
import { document_scoped_quads_equal, materialize_document_scoped_record, prepare_scoped_graph_operation, retain_document_scoped_operation, type DocumentScopedCompositionAuthority } from "./livemap.document.scoped-composition.js";
import type { PreparedDocumentScopedLibrary } from "./livemap.document.scoped-library.js";
import { capture_document_scoped_library, decode_document_scoped_library, restore_document_scoped_library_styles, type PortableDocumentScopedLibrary } from "./livemap.document.scoped-portable.js";
import { decode_document_scoped_quads, DOCUMENT_SCOPED_QUAD_LIMITS, type DocumentScopedQuadRecord, type ScopedQuadBindingRecord, type ScopedQuadOccurrenceRecord } from "./livemap.document.scoped-quad-codec.js";
import { compare_document_paths, document_path_effect_for_graph_operation, document_path_is_prefix, transform_document_path, validate_document_path } from "./livemap.document.path.js";
import type { DocumentGraphOp } from "./livemap.document.lineage.js";
import { canonical_graph_equal } from "./livemap.document.install.js";
import { build_livemap_document_identity_overlay, livemap_document_identity_overlay_equal, livemap_document_identity_quids } from "./livemap.document.identity.js";
import { stage_livemap_identity_epoch } from "./livemap.identity-epoch.js";
import { encode_scoped_effect_graph_operation, decode_scoped_effect_graph_operation, HOSTED_MAX_OPERATIONS } from "./livemap.hosted.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "./livemap.hosted-limits.internal.js";
import { encode_exact_hson_value } from "./livemap.document.view-state-codec.js";

type BindingEffect = Readonly<{ owner: LiveMapDocumentPath | null; binding: ScopedQuadBindingRecord }>;
type StyleEffect = Readonly<{ css: PortableDocumentStylesheetRecord; subjects: DocumentScopedQuadRecord["subjects"] }>;
/** One Library-qualified operation. Retirements are BEFORE coordinates; created,
 * added and CSS subjects are AFTER coordinates. Movement and identity survival
 * use the existing graph path effects and private replacement lineage codec.
 * Digests are semantic pre/postconditions, not versions or authenticity proofs.
 * No extra graph snapshot, runtime owner, issued ledger or occurrence token is transported. */
export type DocumentScopedEffect = Readonly<{
  ordinal: number;
  before: string;
  after: string;
  /** Legacy payload field: discriminated graph or CSS operation, using existing codecs. */
  graph: string;
  retired: readonly ScopedQuadOccurrenceRecord[];
  removed: readonly BindingEffect[];
  created: readonly ScopedQuadOccurrenceRecord[];
  added: readonly BindingEffect[];
  styles: readonly StyleEffect[];
}>;

const key = (value: unknown) => JSON.stringify(value);
const same = (a: unknown, b: unknown) => key(a) === key(b);
function fail(): never { throw new TypeError("Invalid, stale or mismatched scoped document effect."); }
const sortBindings = (items: readonly ScopedQuadBindingRecord[]) => [...items].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const sortScopes = (items: readonly ScopedQuadOccurrenceRecord[]) => [...items].sort((a, b) => compare_document_paths(a.root, b.root));

/** Alpha-normalize only disposable CSS labels. Authored namespace names are untouched. */
function fingerprint(value: PortableDocumentScopedLibrary): string {
  const names = new Map(value.scopes.subjects.map((subject, index) => [subject.name, `_${index.toString(36).padStart(9, "0")}`]));
  return sha256_sync(key({ graph: encode_exact_hson_value(value.root), document: value.scopes.document,
    occurrences: value.scopes.occurrences, subjects: value.scopes.subjects.map(s => s.path),
    css: remap_portable_document_css_identities(value.css, names) }));
}

/** Canonical graph movement; replacement survival is precisely the existing
 * private relative lineage, never a synthetic label or a caller QUID claim. */
function movePath(path: LiveMapDocumentPath, operation: DocumentGraphOp, subject: boolean): LiveMapDocumentPath | undefined {
  const effect = document_path_effect_for_graph_operation(operation);
  if (effect === undefined) return path;
  const result = transform_document_path(path, effect);
  if (result.kind === "unchanged" || result.kind === "moved") return result.path;
  if (result.kind === "invalid") fail();
  if (subject && operation.op === "replace-content") {
    const base = [...operation.target.path, operation.index];
    const survivor = operation.lineage?.find(entry => same([...base, ...entry.source], path));
    if (survivor !== undefined) return validate_document_path([...base, ...survivor.destination]);
  }
  return undefined;
}

/** Pure coordinate projection shared by evidence capture and preflight. It does
 * not mutate graphs or create subject/occurrence identity. */
function retained(scopes: DocumentScopedQuadRecord, operation: DocumentGraphOp) {
  const retired = scopes.occurrences.filter(scope => movePath(scope.root, operation, false) === undefined);
  const roots = new Set(retired.map(scope => key(scope.root)));
  const removed: BindingEffect[] = [];
  const bindings = (entries: readonly ScopedQuadBindingRecord[], owner: LiveMapDocumentPath | null) => entries.flatMap(binding => {
    const path = movePath(binding.path, operation, true);
    if (path === undefined || binding.kind === "part" && roots.has(key(binding.path))) {
      removed.push({ owner, binding }); return [];
    }
    return [{ ...binding, path }];
  });
  const document = bindings(scopes.document, null);
  const occurrences = sortScopes(scopes.occurrences.filter(scope => !roots.has(key(scope.root))).map(scope => ({
    root: movePath(scope.root, operation, false)!, parent: scope.parent === null ? null : movePath(scope.parent, operation, false)!,
    bindings: bindings(scope.bindings, scope.root),
  })));
  return { retired, removed, document, occurrences };
}

function stylesForStep(styles: readonly DocumentCompositionStyle[], next: PreparedDocumentScopedLibrary): readonly StyleEffect[] {
  return styles.map(style => {
    const subjects = style.subjects.map(subject => {
      const path = validate_document_path(subject.path), quid = next.overlay.quidAtPath(path);
      if (quid === undefined || !next.issued.has(quid)) fail();
      return { name: `_${quid}`, path, disposition: "disposable" as const };
    }).sort((a, b) => compare_document_paths(a.path, b.path));
    const names = new Map(style.subjects.map(subject => [subject.name, `_${next.overlay.quidAtPath(validate_document_path(subject.path))!}`]));
    return { subjects, css: remap_portable_document_css_identities(style.css, names) };
  });
}

/** Called while the operation-local candidate and old lifetime ownership exist.
 * It refuses any transition this bounded representation cannot fully explain. @internal */
export function capture_document_scoped_effect(before: PreparedDocumentScopedLibrary, next: PreparedDocumentScopedLibrary,
  operation: DocumentGraphOp, styles: readonly DocumentCompositionStyle[], ordinal: number): DocumentScopedEffect {
  const a = capture_document_scoped_library(before), b = capture_document_scoped_library(next);
  const baseline = retained(a.scopes, operation);
  const survivors = new Set(next.scopes.occurrences.map(s => s.lifetime));
  const actualRetired = before.scopes.occurrences.filter(s => !survivors.has(s.lifetime))
    .map(s => before.overlay.pathForQuid(s.rootQuid)!).sort(compare_document_paths);
  if (!same(actualRetired, baseline.retired.map(s => s.root))) fail();
  const previous = new Set(before.scopes.occurrences.map(s => s.lifetime));
  const newRoots = new Set(next.scopes.occurrences.filter(s => !previous.has(s.lifetime)).map(s => key(next.overlay.pathForQuid(s.rootQuid))));
  const created = b.scopes.occurrences.filter(s => newRoots.has(key(s.root)));
  const added: BindingEffect[] = [];
  const collect = (entries: readonly ScopedQuadBindingRecord[], old: readonly ScopedQuadBindingRecord[], owner: LiveMapDocumentPath | null) => {
    // Existing bindings may move or retire. Arbitrary editing of a surviving
    // binding is not currently a private composition operation.
    if (old.some(binding => !entries.some(entry => same(entry, binding)))) fail();
    for (const binding of entries) if (!old.some(entry => same(entry, binding))) added.push({ owner, binding });
  };
  collect(b.scopes.document, baseline.document, null);
  for (const scope of b.scopes.occurrences) if (!newRoots.has(key(scope.root))) {
    const old = baseline.occurrences.find(s => same(s.root, scope.root));
    if (old === undefined || !same(old.parent, scope.parent)) fail();
    collect(scope.bindings, old.bindings, scope.root);
  }
  const result = { ordinal, before: fingerprint(a), after: fingerprint(b), graph: encode_scoped_effect_graph_operation(operation),
    retired: baseline.retired, removed: baseline.removed, created, added, styles: stylesForStep(styles, next) };
  // Exercise the receiving semantics now, not against some later live state.
  const verified = applyPortable(a, result);
  if (fingerprint(verified) !== result.after) fail();
  return freeze(result);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const entries = Object.entries(value);
  if (entries.length !== names.length || entries.some(([name]) => !names.includes(name))) fail();
  return Object.fromEntries(entries);
}
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value) || value.length > 100_000) fail(); return value; }
function coordinate(value: unknown): LiveMapDocumentPath {
  const segments = array(value);
  if (segments.length > DOCUMENT_SCOPED_QUAD_LIMITS.pathDepth || segments.some(segment => Object.is(segment, -0))) fail();
  return validate_document_path(segments);
}
function binding(value: unknown): ScopedQuadBindingRecord {
  const item = fields(value, ["name", "kind", "path"]);
  if (!is_document_quad_name(item.name) || item.kind !== "element" && item.kind !== "part") fail();
  return { name: item.name, kind: item.kind, path: coordinate(item.path) };
}
function occurrence(value: unknown): ScopedQuadOccurrenceRecord {
  const item = fields(value, ["root", "parent", "bindings"]);
  return { root: coordinate(item.root), parent: item.parent === null ? null : coordinate(item.parent), bindings: array(item.bindings).map(binding) };
}
function bindingEffect(value: unknown): BindingEffect {
  const item = fields(value, ["owner", "binding"]);
  return { owner: item.owner === null ? null : coordinate(item.owner), binding: binding(item.binding) };
}

/** String envelope shares the existing portable graph codec (including exact
 * content values). JSON data has no accessors or prototypes to execute. @internal */
export function encode_document_scoped_effects(effects: readonly DocumentScopedEffect[]): string {
  return JSON.stringify({ count: effects.length, after: effects.at(-1)?.after ?? null, effects });
}
/** Strict private producer validation; not receipt or replay authority. @internal */
export function validate_document_scoped_effects(input: unknown, startOrdinal = 0): readonly DocumentScopedEffect[] {
  if (typeof input !== "string" || input.length > HOSTED_MAX_SNAPSHOT_BYTES) fail();
  const envelope = fields(JSON.parse(input), ["count", "after", "effects"]), items = array(envelope.effects);
  if (Object.is(envelope.count, -0) || envelope.count !== items.length || (items.length === 0 ? envelope.after !== null
    : fields(items.at(-1), ["ordinal", "before", "after", "graph", "retired", "removed", "created", "added", "styles"]).after !== envelope.after)) fail();
  if (items.length > HOSTED_MAX_OPERATIONS) fail();
  return freeze(items.map((value, ordinal) => {
    const item = fields(value, ["ordinal", "before", "after", "graph", "retired", "removed", "created", "added", "styles"]);
    if (Object.is(item.ordinal, -0) || item.ordinal !== startOrdinal + ordinal || typeof item.graph !== "string" || typeof item.before !== "string"
      || typeof item.after !== "string" || !/^[a-f0-9]{64}$/.test(item.before) || !/^[a-f0-9]{64}$/.test(item.after)) fail();
    decode_document_scoped_operation(item.graph);
    const styles = array(item.styles).map(value => {
      const style = fields(value, ["css", "subjects"]);
      const subjects = array(style.subjects).map(value => {
        const subject = fields(value, ["name", "path", "disposition"]);
        if (typeof subject.name !== "string" || subject.disposition !== "disposable") fail();
        return { name: subject.name, path: coordinate(subject.path), disposition: "disposable" as const };
      });
      return { css: encode_portable_document_stylesheet(decode_portable_document_stylesheet(style.css)), subjects };
    });
    return { ordinal: item.ordinal, before: item.before, after: item.after, graph: item.graph, retired: array(item.retired).map(occurrence),
      removed: array(item.removed).map(bindingEffect), created: array(item.created).map(occurrence), added: array(item.added).map(bindingEffect), styles };
  }));
}

function applyPortable(before: PortableDocumentScopedLibrary, effect: DocumentScopedEffect): PortableDocumentScopedLibrary {
  if (fingerprint(before) !== effect.before) fail();
  const operation = decode_document_scoped_operation(effect.graph);
  if (operation.domain === "css") return applyPortableCss(before, effect, operation);
  const planned = prepare_scoped_graph_operation({ root: before.root, overlay: build_livemap_document_identity_overlay(before.root, "document") }, operation);
  const baseline = retained(before.scopes, operation);
  if (!same(baseline.retired, effect.retired) || !same(baseline.removed, effect.removed)) fail();
  const prefix = operation.op === "replace-root" ? validate_document_path([]) : operation.op === "insert-content" || operation.op === "replace-content"
    ? validate_document_path([...operation.target.path, operation.index]) : undefined;
  const incoming = (path: LiveMapDocumentPath) => { if (prefix === undefined || !document_path_is_prefix(prefix, path)) fail(); };
  for (const scope of effect.created) incoming(scope.root);
  for (const entry of effect.added) incoming(entry.binding.path);
  const additions = (owner: LiveMapDocumentPath | null) => effect.added.filter(entry => same(owner, entry.owner)).map(entry => entry.binding);
  const scopes = decode_document_scoped_quads({ document: sortBindings([...baseline.document, ...additions(null)]),
    occurrences: sortScopes([...baseline.occurrences.map(scope => ({ ...scope, bindings: sortBindings([...scope.bindings, ...additions(scope.root)]) })), ...effect.created]), subjects: [],
  }, planned.root);
  if (effect.added.some(entry => entry.owner !== null && !baseline.occurrences.some(scope => same(scope.root, entry.owner)))) fail();

  const retiredRoots = new Set(effect.retired.map(scope => key(scope.root)));
  const activeOwners = new Set(before.scopes.subjects.filter(subject => !retiredRoots.has(key(subject.path))
    && movePath(subject.path, operation, true) !== undefined).map(subject => `[hson\\:quad="${subject.name}"]`));
  const css = encode_portable_document_stylesheet(retire_part_styles_by_owner(decode_portable_document_stylesheet(before.css), owner => activeOwners.has(owner)));
  const needed = new Set(document_css_subject_identities(css, "inbound"));
  const oldSubjects = before.scopes.subjects.filter(subject => needed.has(subject.name)).map(subject => {
    const path = movePath(subject.path, operation, true); if (path === undefined) fail();
    return { ...subject, path };
  });
  const contributions: StyleEffect[] = [{ css, subjects: oldSubjects }];
  const createdRoots = new Set(effect.created.map(scope => key(scope.root)));
  for (const style of effect.styles) {
    // The existing complete codec validates exact CSS demands and ownership;
    // it is used here only to validate an incremental contribution.
    decode_document_scoped_library({ root: planned.root, scopes: { ...scopes, subjects: style.subjects }, css: style.css });
    const owners = new Set(style.subjects.filter(s => createdRoots.has(key(s.path))).map(s => `[hson\\:quad="${s.name}"]`));
    const checkOwners = (entries: typeof style.css.order, inherited = false): void => {
      for (const entry of entries) {
        if (entry.owner !== undefined && !owners.has(entry.owner)) fail();
        const owned = inherited || entry.owner !== undefined;
        if (entry.kind === "group") checkOwners(entry.entries, owned); else if (!owned) fail();
      }
    };
    checkOwners(style.css.order); contributions.push(style);
  }
  const paths = new Map(contributions.flatMap(style => style.subjects.map(subject => [key(subject.path), subject.path] as const)));
  const subjects = [...paths.values()].sort(compare_document_paths).map((path, index) => ({ path, name: `_${index.toString(36).padStart(9, "0")}`, disposition: "disposable" as const }));
  const labels = new Map(subjects.map(subject => [key(subject.path), subject.name]));
  const merged = merge_part_stylesheets(contributions.map(style => remap_portable_document_css_identities(style.css,
    new Map(style.subjects.map(subject => [subject.name, labels.get(key(subject.path))!])))));
  return decode_document_scoped_library({ root: planned.root, scopes: { ...scopes, subjects }, css: encode_portable_document_stylesheet(merged) });
}

/** Entire-batch preflight precedes the shared sparse issuer. No prefix is
 * returned/published on failure. This is an unpublished candidate computation,
 * not a transport receipt or cross-message replay/durability authority. @internal */
export function replay_document_scoped_effects(before: PreparedDocumentScopedLibrary, input: unknown,
  authority: DocumentScopedCompositionAuthority, validateRoot: (root: PreparedDocumentScopedLibrary["root"]) => void, startOrdinal = 0): PreparedDocumentScopedLibrary {
  authority.assertCurrent();
  const effects = validate_document_scoped_effects(input, startOrdinal), states: PortableDocumentScopedLibrary[] = [];
  let portable = capture_document_scoped_library(before);
  for (const effect of effects) {
    portable = applyPortable(portable, effect);
    if (fingerprint(portable) !== effect.after) fail();
    states.push(portable); authority.assertCurrent();
  }
  // Match the owning aggregate boundary: schema constrains the completed
  // transaction, not temporary graphs between two valid ordered operations.
  validateRoot(portable.root); authority.assertCurrent();
  // Labels are excluded from issuance even when independently renamed on wire.
  const foreign = new Set(effects.flatMap(effect => effect.styles.flatMap(style => style.subjects.map(s => s.name.slice(1)))));
  let current = before, changed = false;
  const identityEffects = [], steps = [];
  const replayedEffects: DocumentScopedEffect[] = [];
  for (const [index, effect] of effects.entries()) {
    const operation = decode_document_scoped_operation(effect.graph);
    if (operation.domain === "css") {
      // CSS cannot mint subjects or replace occurrence lifetimes.
      const state = states[index]!;
      const next = restore_document_scoped_library_styles({ ...current, identityEffects: [], steps: [], initialStyles: [],
        changed: true, assertCurrent: authority.assertCurrent }, state);
      let styleIndex = 0;
      const local = map_scoped_css_operation(operation, css => {
        const style = effect.styles[styleIndex++]; if (style === undefined) fail();
        const associations = style.subjects.map(subject => {
          const quid = current.overlay.quidAtPath(subject.path);
          if (quid === undefined || !current.issued.has(quid)) fail();
          return { ...subject, quid };
        });
        return translate_document_css_identities(css, "inbound", { associations, assertCurrent: authority.assertCurrent }, true);
      });
      const captured = capture_document_scoped_css_effect(current, next, local, effect.ordinal);
      if (captured.before !== effect.before || captured.after !== effect.after) fail();
      replayedEffects.push(captured);
      changed ||= !portable_document_stylesheet_equal(current.stylesheet, next.stylesheet);
      current = next; authority.assertCurrent(); continue;
    }
    replayedEffects.push(effect);
    const planned = prepare_scoped_graph_operation(current, operation);
    const context = { owner: current.owner, root: planned.root, overlay: planned.overlay,
      issued: stage_livemap_identity_epoch(current.issued, livemap_document_identity_quids(current.overlay), livemap_document_identity_quids(planned.overlay)) };
    const retainedScopes = retain_document_scoped_operation(current, current.scopes, operation, context);
    const state = states[index]!;
    const materialized = materialize_document_scoped_record(context, retainedScopes, state.scopes, state.scopes.subjects.map(s => s.path), authority, foreign);
    identityEffects.push(...planned.identityEffects, ...materialized.effects);
    const step = Object.freeze({ operation: planned.operation, context: Object.freeze(materialized), scopes: materialized.scopes, styles: Object.freeze([]) });
    steps.push(step);
    const next = { ...restore_document_scoped_library_styles({ ...materialized, identityEffects, steps, initialStyles: [],
      changed: true, assertCurrent: authority.assertCurrent }, state), effects };
    changed ||= !canonical_graph_equal(current.root, next.root) || !livemap_document_identity_overlay_equal(current.overlay, next.overlay)
      || !document_scoped_quads_equal(current.scopes, next.scopes) || !portable_document_stylesheet_equal(current.stylesheet, next.stylesheet);
    if (fingerprint(capture_document_scoped_library(next)) !== effect.after) fail();
    current = next;
    authority.assertCurrent();
  }
  return Object.freeze({ ...current, identityEffects: Object.freeze(identityEffects), steps: Object.freeze(steps), effects: Object.freeze(replayedEffects),
    changed, assertCurrent: authority.assertCurrent });
}

/** The existing effect envelope retains its field spelling for B2 records. */
export function decode_document_scoped_operation(payload: string): DocumentGraphOp | LiveMapCssOp {
  const value: unknown = JSON.parse(payload);
  if (value !== null && typeof value === "object" && "domain" in value && value.domain === "css") {
    return canonical_portable_document_css_op(value);
  }
  return decode_scoped_effect_graph_operation(payload);
}

/** @internal */
export function capture_document_scoped_css_effect(before: PreparedDocumentScopedLibrary, next: PreparedDocumentScopedLibrary,
  operation: LiveMapCssOp, ordinal: number): DocumentScopedEffect {
  const styles: StyleEffect[] = [];
  const portable = map_scoped_css_operation(operation, css => {
    const subjects = document_css_subject_identities(css, "outbound").map(quid => {
      const path = before.overlay.pathForQuid(quid);
      if (path === undefined || !before.issued.has(quid)) fail();
      return { name: `_${quid}`, path, disposition: "disposable" as const };
    }).sort((a, b) => compare_document_paths(a.path, b.path));
    const translated = translate_document_css_identities(css, "outbound", {
      associations: subjects.map(subject => ({ ...subject, quid: subject.name.slice(1) })), assertCurrent: before.assertCurrent,
    }, true);
    styles.push({ css: translated, subjects }); return translated;
  });
  const a = capture_document_scoped_library(before), b = capture_document_scoped_library(next);
  const effect: DocumentScopedEffect = { ordinal, before: fingerprint(a), after: fingerprint(b), graph: JSON.stringify(portable),
    retired: [], removed: [], created: [], added: [], styles };
  if (fingerprint(applyPortable(a, effect)) !== effect.after) fail();
  return freeze(effect);
}

function applyPortableCss(before: PortableDocumentScopedLibrary, effect: DocumentScopedEffect, operation: LiveMapCssOp): PortableDocumentScopedLibrary {
  if (effect.retired.length || effect.removed.length || effect.created.length || effect.added.length) fail();
  // Union correspondence by destination coordinate; no author names or runtime
  // identity are inferred from labels. Each operation carrier is validated fully.
  for (const style of effect.styles) decode_document_scoped_library({ root: before.root,
    scopes: { ...before.scopes, subjects: style.subjects }, css: style.css });
  const paths = new Map([...before.scopes.subjects, ...effect.styles.flatMap(style => style.subjects)]
    .map(subject => [key(subject.path), subject.path]));
  const subjects = [...paths.values()].sort(compare_document_paths).map((path, index) =>
    ({ path, name: `_${index.toString(36).padStart(9, "0")}`, disposition: "disposable" as const }));
  const labels = new Map(subjects.map(subject => [key(subject.path), subject.name]));
  const remap = (css: PortableDocumentStylesheetRecord, table: DocumentScopedQuadRecord["subjects"]) =>
    remap_portable_document_css_identities(css, new Map(table.map(subject => [subject.name, labels.get(key(subject.path))!])));
  let index = 0;
  const translated = map_scoped_css_operation(operation, css => {
    const style = effect.styles[index++];
    if (style === undefined || !same(style.css, css)) fail();
    return remap(css, style.subjects);
  });
  if (index !== effect.styles.length) fail();
  const css = encode_portable_document_stylesheet(apply_portable_document_css_op(
    decode_portable_document_stylesheet(remap(before.css, before.scopes.subjects)), translated));
  const demanded = new Set(document_css_subject_identities(css, "inbound"));
  return decode_document_scoped_library({ root: before.root, scopes: { ...before.scopes,
    subjects: subjects.filter(subject => demanded.has(subject.name)) }, css });
}

/** @internal */
export function prepare_document_scoped_css_operation(before: PreparedDocumentScopedLibrary, operation: LiveMapCssOp,
  ordinal: number): PreparedDocumentScopedLibrary {
  before.assertCurrent();
  const stylesheet = apply_portable_document_css_op(before.stylesheet, operation);
  const next = { ...before, stylesheet, steps: [], identityEffects: [], initialStyles: [],
    changed: !portable_document_stylesheet_equal(before.stylesheet, stylesheet) };
  const effect = capture_document_scoped_css_effect(before, next, operation, ordinal);
  return Object.freeze({ ...next, effects: Object.freeze([effect]) });
}

/** Compare immutable effect evidence with its semantic operation before durable
 * encoding. CSS reference translation uses evidence only, never current state. */
export function scoped_effect_matches_operation(effect: DocumentScopedEffect, operation: DocumentGraphOp | LiveMapCssOp): boolean {
  if (operation.domain === "graph") return effect.graph === encode_scoped_effect_graph_operation(operation);
  let index = 0;
  const portable = map_scoped_css_operation(operation, css => {
    const style = effect.styles[index++]; if (style === undefined) fail();
    return translate_document_css_identities(css, "outbound", { associations: style.subjects.map(subject =>
      ({ ...subject, quid: subject.name.slice(1) })), assertCurrent() {} }, true);
  });
  return index === effect.styles.length && same(portable, decode_document_scoped_operation(effect.graph));
}

/** Alpha-renaming must cover both the CSS payload and its correspondence carriers. */
export function portable_document_scoped_effect(effect: DocumentScopedEffect): DocumentScopedEffect {
  const styles = effect.styles.map(style => {
    const names = new Map(style.subjects.map((subject, ordinal) => [subject.name, `_${ordinal.toString(36).padStart(9, "0")}`]));
    return { css: remap_portable_document_css_identities(style.css, names),
      subjects: style.subjects.map(subject => ({ ...subject, name: names.get(subject.name)! })) };
  });
  const operation = decode_document_scoped_operation(effect.graph);
  let index = 0;
  const graph = operation.domain === "graph" ? effect.graph : JSON.stringify(map_scoped_css_operation(operation, () => styles[index++]!.css));
  return { ...effect, graph, styles };
}

/** Only for locally captured evidence; portable receipt first resolves paths and recaptures. */
export function local_scoped_css_operation(effect: DocumentScopedEffect): LiveMapCssOp {
  const operation = decode_document_scoped_operation(effect.graph);
  if (operation.domain !== "css") fail();
  let index = 0;
  return map_scoped_css_operation(operation, css => {
    const style = effect.styles[index++]; if (style === undefined) fail();
    return translate_document_css_identities(css, "inbound", { associations: style.subjects.map(subject =>
      ({ ...subject, quid: subject.name.slice(1) })), assertCurrent() {} }, true, true);
  });
}
