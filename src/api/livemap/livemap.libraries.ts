import { project_interaction_state_internal } from "../interactions/interactions.projection.js";
import { render_portable_document_stylesheet, decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import type { LiveMapCutOptions, LiveMapCut, LiveMapHtmlCut } from "../../types/livemap.types.js";
import type { PortableAggregateSnapshot } from "./livemap.hosted.internal.types.js";
import { clone_node } from "../../core/clone-node.js";
import { apply_portable_document_css_op, canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { portable_document_stylesheet_equal } from "../../internal/css/portable-document-stylesheet.js";
import { register_echo_map_capability_internal } from "../../internal/echo-map-capability.js";
import { mark_browser_html_producer } from "../../internal/browser-html-producer.js";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { HsonNode, JsonValue, Primitive } from "../../core/types.js";
import type {
  LiveMapDataLibrary,
  LiveMapDocumentLibrary,
  LiveMap,
  HostedLiveMapSnapshot,
  LiveMapSnapshot,
  LiveMapInput,
  LiveMapDefinitions,
  LiveMapKnownDefinitions,
  LiveMapLibraryInput,
  LiveMapLibraryOperation,
  LiveMapLibraryAddOperation,
  LiveMapLibrarySchemaUseOperation,
  LiveMapLibraryPathHandle,
  LiveMapDataOp,
  LiveMapLibraryFeedEvent,
  LiveMapCommitObservation,
  LiveMapDocumentApi,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentRequestTarget,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentContent,
  LiveMapReplacementLineage,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapCommit,
  LiveMapStagedWriter,
  LiveMapSetValue,
  LiveMapWriteValue,
  LivePath,
} from "../../types/livemap.types.js";
import { hson_data_text_from_value } from "../data/hson-data.js";
import { ANY_DATA, ANY_DOCUMENT, hson_schema_source_digest, HsonSchema as HsonSchemaHandle } from "../schema/hson-schema.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { clone_live_path } from "./livemap.path.js";
import { must_json_value, must_live_path } from "./livemap.guard.js";
import {
  internal_livemap_aggregate_authority,
  register_internal_authority_position_observer,
  register_internal_livemap_aggregate_owner,
} from "./livemap.internal.js";
import type { LiveMapAggregateCommit, LiveMapLibraryIdentity } from "./livemap.library.js";
import { make_livemap_registry_authority, type InitialSystemState } from "./livemap.core.js";
import { classify_live_root_mode, is_data_livemap_mode } from "./livemap.document.js";
import { realize_document } from "../../internal/document-cut.js";
import { make_livemap_document_css } from "./livemap.css.js";
import { document_css_subject_identities } from "../../internal/css/css-identity-translation.js";
import { make_livemap_document_mutation_api } from "./livemap.document.mutation.js";
import { make_livemap_document_attrs_read_api, make_livemap_document_flags_read_api } from "./livemap.document.attrs.js";
import { make_livemap_document_location_factory, make_livemap_document_quad_location, read_livemap_document_logical_location } from "./livemap.document.location.js";
import { internal_document_subject_logical_path } from "./livemap.document.logical.js";
import { make_livemap_document_proxy } from "./livemap.proxy.js";
import { clone_hson_graph_without_quids, register_livemap_document_observation_evidence } from "./livemap.document.capture.js";
import { resolve_document_path } from "./livemap.document.path.js";
import {
  make_livemap_document_identity_api,
  make_livemap_document_identity_handle,
  register_livemap_document_identity_api,
} from "./livemap.document.identity-handle.js";
import { clone_livemap_document_exact_view, register_livemap_document_identity_overlay } from "./livemap.document.identity.js";
import { register_livemap_document_identity_authority } from "./livemap.document.registration.js";
import { register_livemap_identity_epoch_owner } from "./livemap.identity-epoch.js";
import { make_livemap_projected_identity_api, register_livemap_projected_identity_api } from "./livemap.projected.identity-handle.js";
import {
  assert_libraries_snapshot_bound,
  assert_libraries_snapshot_shape,
  assert_hosted_libraries_snapshot_shape,
  assert_portable_aggregate_snapshot_shape,
  portable_aggregate_snapshot_as_local,
  make_portable_aggregate_snapshot,
  make_hosted_registry,
  registry_from_entries,
  decode_hosted_root,
  encode_hosted_root,
  HOSTED_MAX_SNAPSHOT_BYTES,
} from "./livemap.hosted.js";
import { admit_public_livemap_root } from "./livemap.node-admission.js";
import { make_livemap_array_api } from "./livemap.handle-array.js";
import { make_livemap_object_api } from "./livemap.handle-object.js";
import type { LiveMapProjectedPropagation } from "./livemap.projected-propagation.js";
import type { LiveMapSemanticCheckpoint } from "./livemap.internal.js";
import type { PreparedLiveMapAuthorityTransition } from "./livemap.authority.js";
import { deliver_livemap_observers } from "./livemap.observer-delivery.js";
import { is_staged_thenable, make_livemap_staged_writer } from "./livemap.staged.js";
import type { LiveMapAggregateWrite } from "./livemap.library.js";
import { expand_document_composition, document_composition_options, type DocumentCompositionOptions } from "./livemap.document.composition.js";
import { parse_authored_document_library, register_document_quad_lookup, type DocumentQuadAdmission, decode_document_quads, own_document_quads } from "./livemap.document.quad.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import { ensure_livemap_document_canonical_identity } from "./livemap.document.registration.js";
import { PART_COLLECTION_VALIDATION, part_collection_definition_internal, own_data_library_validation,
  validate_data_library, type DataLibraryValidation, type ValidatedPart } from "./livemap.parts.js";

type NamedLibrary = Readonly<{
  name: string;
  identity: LiveMapLibraryIdentity;
  family: "data" | "document";
  schema: HsonSchemaHandle;
}>;

/** Already-canonical material crossing a fresh Library receiver. @internal */
export type CanonicalLibraryDefinition = Readonly<{
  name: string;
  family: "data" | "document";
  schema: HsonSchemaHandle;
  root: HsonNode;
  quads?: PortableDocumentQuads;
  validation?: DataLibraryValidation;
}>;

function public_library_definitions(inputs: LiveMapDefinitions): readonly CanonicalLibraryDefinition[] {
  return Object.entries(inputs).map(([name, value]) => {
    const input = must_library_input(name, value);
    return Object.freeze({ name, root: library_root(input), schema: input.schema,
      family: "data" in input ? "data" as const : "document" as const,
      ...(input.validation === undefined ? {} : { validation: input.validation }) });
  });
}

function capture_library_definitions(definitions: readonly CanonicalLibraryDefinition[]): readonly CanonicalLibraryDefinition[] {
  const names = new Set<string>();
  return definitions.map((definition) => {
    const { name, family, schema, root } = definition;
    const quads = own_document_quads(definition);
    const validation = own_data_library_validation(definition);
    if (typeof name !== "string" || name === INTERACTION_RESERVED_LIBRARY_KEY || names.has(name)) {
      throw new Error("Canonical Library name is invalid or duplicated.");
    }
    if (family !== "data" && family !== "document" || !(schema instanceof HsonSchemaHandle)) {
      throw new TypeError("Canonical Library family or Schema is invalid.");
    }
    names.add(name);
    const admitted = admit_public_livemap_root(root, family, `LiveMap.reconstruct(${name})`);
    validate_data_library(admitted, classify_live_root_mode(admitted, family), validation);
    const associations = decode_document_quads(quads, admitted, family);
    return Object.freeze({ name, family, schema, root: admitted,
      ...(validation === undefined ? {} : { validation }),
      ...(associations === undefined ? {} : { quads: associations }) });
  });
}

const EXACT_LIBRARY_ADMISSION = new WeakMap<object,
  (definitions: readonly CanonicalLibraryDefinition[]) => LiveMapCommit>();

const DOCUMENT_COMPOSITION = new WeakMap<object,
  (source: string, name: string, options?: DocumentCompositionOptions) => LiveMapDocumentLibrary>();

const PART_COLLECTION_ADMISSION = new WeakMap<object, (name: string, parts: unknown) => LiveMapCommit>();
const PART_READ = new WeakMap<object, (collection: string, member: string) => ValidatedPart>();

/** One ordinary data Library; uses the existing aggregate topology transition. @internal */
export function add_livemap_part_collection_internal(map: LiveMap, name: string, parts: unknown): LiveMapCommit {
  const admit = PART_COLLECTION_ADMISSION.get(map);
  if (admit === undefined) throw new Error("Part collection requires a named LiveMap registry.");
  return admit(name, parts);
}

/** Complete collection validation before detached materialization for a consumer. @internal */
export function read_livemap_part_internal(map: LiveMap, collection: string, member: string): ValidatedPart {
  const read = PART_READ.get(map);
  if (read === undefined) throw new Error("Part read requires a named LiveMap registry.");
  return read(collection, member);
}

/** One-time local construction through ordinary registered Library admission. @internal */
export function compose_livemap_document_internal(
  map: LiveMap, source: string, name: string, options?: DocumentCompositionOptions,
): LiveMapDocumentLibrary {
  const compose = DOCUMENT_COMPOSITION.get(map);
  if (compose === undefined) throw new Error("Document composition requires a named LiveMap registry.");
  return compose(source, name, options);
}

/** Add portable canonical roots without manufacturing public value definitions. @internal */
export function add_livemap_canonical_libraries_internal(
  map: LiveMap, definitions: readonly CanonicalLibraryDefinition[],
): LiveMapCommit {
  const admit = EXACT_LIBRARY_ADMISSION.get(map);
  if (admit === undefined) throw new Error("Canonical Library admission requires a multi-library LiveMap.");
  return admit(capture_library_definitions(definitions));
}

const PUBLIC_MULTI_LIBRARY_MAPS = new WeakSet<object>();
const CLIENT_LIBRARY_SOURCES = new WeakMap<object, "authority-projected" | "client-local">();
const DOCUMENT_CSS_STATE = new WeakMap<object, () => import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet>();
const DOCUMENT_CSS_COMMIT = new WeakMap<object, (operation: import("../../types/livemap.types.js").LiveMapCssOp) => void>();
const DOCUMENT_SSR_CAPTURE = new WeakMap<object, (demanded: readonly string[]) => import("./livemap.internal.js").DocumentSsrCandidate>();
const DOCUMENT_SSR_CUT = new WeakMap<object, (options: LiveMapCutOptions, demanded: readonly string[]) => LiveMapHtmlCut>();

/** Explicit SSR-only projection of Library-owned CSS and subjects. No continuation capability. @internal */
export function capture_document_ssr_internal(document: object, demanded: readonly string[]): import("./livemap.internal.js").DocumentSsrCandidate {
  const capture = DOCUMENT_SSR_CAPTURE.get(document);
  if (capture === undefined) throw new Error("Document SSR capture is unavailable.");
  return capture(demanded);
}

/** Opt-in render using one detached graph/CSS/correspondence candidate. @internal */
export function render_document_ssr_internal(document: object, demanded: readonly string[]) {
  const candidate = capture_document_ssr_internal(document, demanded);
  return realize_document(candidate.root, render_portable_document_stylesheet(decode_portable_document_stylesheet(candidate.css)), { quads: candidate.quads });
}

/** Opt-in local SSR cut; its portable siblings share the selected candidate. @internal */
export function cut_document_ssr_internal(map: object, options: LiveMapCutOptions, demanded: readonly string[]): LiveMapHtmlCut {
  const cut = DOCUMENT_SSR_CUT.get(map);
  if (cut === undefined) throw new Error("Document SSR cut is unavailable.");
  return cut(options, demanded);
}

/** @internal Current semantic stylesheet for a selected document Library. */
export function document_css_state_internal(document: LiveMapDocumentLibrary): import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet {
  const read = DOCUMENT_CSS_STATE.get(document);
  if (read === undefined) throw new Error("Document CSS state is unavailable.");
  return read();
}

/** @internal Commit an already-canonical local CSS operation through its owning LiveMap. */
export function commit_document_css_internal(document: LiveMapDocumentLibrary, operation: import("../../types/livemap.types.js").LiveMapCssOp): void {
  const commit = DOCUMENT_CSS_COMMIT.get(document);
  if (commit === undefined) throw new Error("Document CSS authority is unavailable.");
  commit(operation);
}
const CLIENT_LIBRARY_RETIREMENT = new WeakMap<object, Set<() => void>>();
const CLIENT_PROJECTION_RECONCILE = new WeakMap<object, (owner: object, snapshot: PortableAggregateSnapshot) => void>();
const CLIENT_LOCAL_LIBRARY_ADMISSION = new WeakMap<object, (definitions: readonly CanonicalLibraryDefinition[],
  css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>, installed?: () => void) => LiveMapCommit>();
const HOSTED_LIBRARY_ADMISSION = new WeakMap<object, (owner: object, definitions: readonly CanonicalLibraryDefinition[],
  css?: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>) => Readonly<{
  transition: PreparedLiveMapAuthorityTransition;
  afterInstall: () => void;
}>>();

function topology_definitions(operation: LiveMapLibraryAddOperation): readonly CanonicalLibraryDefinition[] {
  if (operation.operation.kind !== "library-add" || operation.operation.libraries.length === 0
    || operation.library !== operation.operation.libraries[0]?.name) {
    throw new Error("LiveMap topology replay requires a canonical library-add operation.");
  }
  const definitions: CanonicalLibraryDefinition[] = [];
  const names = new Set<string>();
  exact_transport_fields(operation, ["library", "operation"]);
  exact_transport_fields(operation.operation, ["kind", "libraries"]);
  for (const entry of operation.operation.libraries) {
    exact_transport_fields(entry, ["name", "mode", "schema", "root", ...(Object.hasOwn(entry, "validation") ? ["validation"] : []), ...(Object.hasOwn(entry, "css") ? ["css"] : []), ...(Object.hasOwn(entry, "quads") ? ["quads"] : [])]);
    if (Object.hasOwn(entry, "quads") && own_document_quads(entry) === undefined) throw new Error("Undefined QUAD associations.");
    if (names.has(entry.name)) throw new Error("LiveMap topology replay contains a duplicate Library.");
    names.add(entry.name);
    const schema = HsonSchemaHandle.fromHson(entry.schema);
    const root = decode_hosted_root(entry.root);
    admit_portable_hson_node(root, "LiveMap topology replay");
    if (classify_live_root_mode(root, entry.mode === "document" ? "document" : "data") !== entry.mode
      || JSON.stringify(encode_hosted_root(root)) !== JSON.stringify(entry.root)) {
      throw new Error("LiveMap topology replay root mode or encoding is inconsistent.");
    }
    definitions.push({ name: entry.name, family: entry.mode === "document" ? "document" : "data", root, schema,
      ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }),
      ...(own_document_quads(entry) === undefined ? {} : { quads: decode_document_quads(own_document_quads(entry), root, entry.mode) }) });
  }
  return capture_library_definitions(definitions);
}

function topology_css(operation: LiveMapLibraryAddOperation): Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>> {
  const css: Record<string, import("../../types/document-css.types.js").DocumentCssRecord> = Object.create(null);
  for (const entry of operation.operation.libraries) {
    if (entry.css !== undefined) {
      if (entry.mode !== "document") throw new TypeError("Initial CSS requires a document Library.");
      css[entry.name] = encode_portable_document_stylesheet(decode_portable_document_stylesheet(entry.css));
    }
  }
  return css;
}

function is_library_add_operation(operation: LiveMapCommit["operations"][number]): operation is LiveMapLibraryAddOperation {
  return "kind" in operation.operation && operation.operation.kind === "library-add";
}

function is_library_schema_use_operation(
  operation: LiveMapCommit["operations"][number],
): operation is LiveMapLibrarySchemaUseOperation {
  if (typeof operation !== "object" || operation === null
    || Reflect.ownKeys(operation).length !== 2 || !Object.hasOwn(operation, "library")
    || !Object.hasOwn(operation, "operation") || typeof operation.library !== "string"
    || typeof operation.operation !== "object" || operation.operation === null
    || Reflect.ownKeys(operation.operation).length !== 3
    || !Object.hasOwn(operation.operation, "kind")
    || !Object.hasOwn(operation.operation, "previousSchemaDigest")
    || !Object.hasOwn(operation.operation, "schema")) return false;
  const candidate = operation.operation as Readonly<Record<string, unknown>>;
  return candidate.kind === "library-schema-use"
    && typeof candidate.previousSchemaDigest === "string"
    && /^[a-f0-9]{64}$/u.test(candidate.previousSchemaDigest)
    && typeof candidate.schema === "string";
}

/** Install a projected Phase 1b operation in the existing composed client map. @internal */
export function install_client_projected_topology_internal(
  map: LiveMap,
  owner: object,
  operation: LiveMapLibraryAddOperation,
  expectedDigest: string,
  system?: Readonly<{ format: "hson-exact-value"; payload: string }>,
): void {
  const aggregate = internal_livemap_aggregate_authority(map);
  const current = aggregate.clientProjection();
  if (current === undefined) throw new Error("Projected topology requires a composed client LiveMap.");
  const definitions = topology_definitions(operation);
  const newBindings = operation.operation.libraries.map((entry) => Object.freeze({
    name: entry.name, mode: entry.mode, schema: HsonSchemaHandle.fromHson(entry.schema), identity: Object.freeze({}),
    ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }),
  }));
  const existing = current.registry.libraries.map((entry) => Object.freeze({
    name: entry.name, mode: entry.mode, schema: HsonSchemaHandle.fromHson(entry.schema), identity: Object.freeze({}),
    ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }),
    ...(entry.scope === undefined ? {} : { scope: entry.scope }),
  }));
  const application = [...existing.filter((entry) => entry.scope === undefined), ...newBindings]
    .sort((a, b) => a.name.localeCompare(b.name));
  const predicted = make_hosted_registry([...application, ...existing.filter((entry) => entry.scope === "hson-internal")]);
  if (predicted.digest !== expectedDigest) throw new Error("Projected topology registry digest is incompatible.");
  const prepared = prepare_library_add(map, owner, definitions, topology_css(operation));
  let installSystem: (() => void) | undefined;
  try {
    installSystem = system === undefined ? undefined
      : aggregate.prepareClientProjectionSystemManaged(owner, decode_hosted_root(system),
        operation.operation.libraries.filter((entry) => entry.mode === "document").map((entry) => entry.name));
    if (JSON.stringify(prepared.transition.commit.topology) !== JSON.stringify(operation)) {
      throw new Error("Projected topology operation is noncanonical.");
    }
  } catch (cause) {
    aggregate.discard(prepared.transition);
    throw cause;
  }
  aggregate.accept(prepared.transition, "isolate", () => {
    prepared.afterInstall();
    installSystem?.();
    aggregate.extendClientProjectionManaged(owner, operation.operation.libraries.map((entry) => entry.name), expectedDigest);
  });
}

/** Stage the public definition grammar through the map's managed authority. @internal */
export function prepare_hosted_livemap_library_add_internal(
  map: LiveMap,
  owner: object,
  inputs: LiveMapDefinitions,
  css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>> = {},
): Readonly<{ transition: PreparedLiveMapAuthorityTransition; afterInstall: () => void }> {
  return prepare_library_add(map, owner, public_library_definitions(inputs), css);
}

function prepare_library_add(
  map: LiveMap, owner: object, definitions: readonly CanonicalLibraryDefinition[],
  css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>,
): Readonly<{ transition: PreparedLiveMapAuthorityTransition; afterInstall: () => void }> {
  const prepare = HOSTED_LIBRARY_ADMISSION.get(map);
  if (prepare === undefined) throw new Error("Hosted Library admission requires a multi-library LiveMap.");
  return prepare(owner, definitions, css);
}

/** Internal ownership evidence for write-propagating link admission. */
export function client_library_source_internal(value: object): "authority-projected" | "client-local" | undefined {
  return CLIENT_LIBRARY_SOURCES.get(value);
}

/** Admit authorized local initializers without exposing topology mutation on the public map. @internal */
export function add_client_local_libraries_internal(map: LiveMap, definitions: readonly CanonicalLibraryDefinition[],
  css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>,
  installed?: () => void): LiveMapCommit {
  const admit = CLIENT_LOCAL_LIBRARY_ADMISSION.get(map);
  if (admit === undefined) throw new Error("Client-local topology admission requires a composed LiveMap.");
  return admit(capture_library_definitions(definitions), css, installed);
}

/** Observe terminal retirement of one projected document binding. @internal */
export function observe_client_library_retirement_internal(value: object, listener: () => void): () => void {
  const listeners = CLIENT_LIBRARY_RETIREMENT.get(value) ?? new Set<() => void>();
  listeners.add(listener);
  CLIENT_LIBRARY_RETIREMENT.set(value, listeners);
  return () => { listeners.delete(listener); };
}

/** Reconcile only the managed authority partition of an existing composed map. @internal */
export function reconcile_client_projection_snapshot_internal(
  map: LiveMap, owner: object, snapshot: PortableAggregateSnapshot,
): void {
  const reconcile = CLIENT_PROJECTION_RECONCILE.get(map);
  if (reconcile === undefined) throw new Error("Client projection reconciliation requires a composed LiveMap.");
  reconcile(owner, snapshot);
}

/** True only for the dedicated local multi-library public facade. @internal */
export function is_public_multi_library_livemap(value: unknown): value is object {
  return typeof value === "object" && value !== null && PUBLIC_MULTI_LIBRARY_MAPS.has(value);
}

/** Select public configuration once; only admitted material crosses into ownership. @internal */
export function admit_public_livemap_definitions<const TLibraries extends LiveMapDefinitions>(inputs: TLibraries): TLibraries {
  const entries = Object.entries(inputs);
  const admitted: TLibraries = Object.create(null);
  for (const [name, value] of entries) {
    const selected = must_library_input(name, value);
    const input = Object.hasOwn(selected, "document") && typeof selected.document !== "string"
      ? Object.freeze(Object.assign(Object.create(null), selected, { document: admit_public_livemap_root(selected.document, "document", `LiveMap.fromLibraries(${name})`) }))
      : selected;
    Object.defineProperty(admitted, name, { value: input, enumerable: true, configurable: true, writable: true });
  }
  return admitted;
}

/**
 * Admit the complete named registry before constructing its map-global authority.
 * Names remain at this public facade; the engine uses opaque map-local identities.
 */
export function make_livemap_libraries<const TLibraries extends LiveMapDefinitions>(
  inputs: TLibraries,
  systems: readonly InitialSystemState[] = [],
  clientSnapshot?: PortableAggregateSnapshot,
  initialCss: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>> = {},
): LiveMap<LiveMapKnownDefinitions<TLibraries>> {
  return make_livemap_library_receiver(public_library_definitions(inputs), systems, clientSnapshot, initialCss) as LiveMap<LiveMapKnownDefinitions<TLibraries>>;
}

/** Fresh graph-native construction; portable inputs never establish runtime provenance. @internal */
export function make_livemap_from_canonical_libraries_internal(
  definitions: readonly CanonicalLibraryDefinition[],
  systems: readonly InitialSystemState[] = [],
  clientSnapshot?: PortableAggregateSnapshot,
  initialCss: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>> = {},
): LiveMap {
  return make_livemap_library_receiver(capture_library_definitions(definitions), systems, clientSnapshot, initialCss);
}

/**
 * Private initial authored admission. Portable Library-add admission carries explicit
 * captured associations; the public authored-source grammar remains unchanged.
 * The ordinary map stays unreachable until qualification and all sparse binding finish.
 * @internal
 */
export function make_livemap_from_authored_libraries_internal(inputs: LiveMapDefinitions): LiveMap {
  const addresses = new Map<string, readonly DocumentQuadAdmission[]>();
  const definitions = Object.entries(inputs).map(([name, value]): CanonicalLibraryDefinition => {
    const input = must_library_input(name, value);
    if ("document" in input && typeof input.document === "string") {
      const authored = parse_authored_document_library(input.document);
      if (authored.declarations.length) addresses.set(name, authored.declarations);
      return { name, family: "document", schema: input.schema, root: authored.root };
    }
    return { name, family: "data" in input ? "data" : "document", schema: input.schema, root: library_root(input),
      ...(input.validation === undefined ? {} : { validation: input.validation }) };
  });
  return make_livemap_library_receiver(capture_library_definitions(definitions), [], undefined, {}, addresses);
}

function make_livemap_library_receiver(
  definitions: readonly CanonicalLibraryDefinition[], systems: readonly InitialSystemState[],
  clientSnapshot: PortableAggregateSnapshot | undefined,
  initialCss: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>,
  authoredQuads: ReadonlyMap<string, readonly DocumentQuadAdmission[]> = new Map(),
): LiveMap {
  const built = make_livemap_registry_authority(definitions.map((definition) => {
    const { name, root, schema, family } = definition;
    const quads = own_document_quads(definition);
    const css = Object.hasOwn(initialCss, name) ? initialCss[name]
      : clientSnapshot?.libraries.find(entry => entry.name === name)?.css;
    return {
      root,
      hsonSchema: schema,
      family,
      ...(definition.validation === undefined ? {} : { validation: definition.validation }),
      ...(quads === undefined ? {} : { quads }),
      ...(css === undefined ? {} : { css: decode_portable_document_stylesheet(css) }),
    };
  }), systems);
  const aggregate = built.aggregate;
  const namesByIdentity = new Map<LiveMapLibraryIdentity, string>();
  const named = new Map<string, NamedLibrary>();
  const selectedFacades = new Map<string, LiveMapDataLibrary | LiveMapDocumentLibrary>();

  const add = (definition: Pick<CanonicalLibraryDefinition, "name" | "family" | "schema">, identity: LiveMapLibraryIdentity): void => {
    const { name, family, schema } = definition;
    if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    namesByIdentity.set(identity, name);
    named.set(name, Object.freeze({ name, identity, family, schema }));
  };

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const identity = built.identities[index];
    if (definition === undefined || identity === undefined) throw new Error("LiveMap registry construction is incomplete.");
    add(definition, identity);
  }

  const inspectedByIdentity = new Map(
    aggregate.inspect().libraries.map((entry) => [entry.identity, entry] as const),
  );
  aggregate.configureHostedRegistry([...named.values()].map((entry) => {
    const inspected = inspectedByIdentity.get(entry.identity);
    if (inspected === undefined) throw new Error("Hosted LiveMap Library inspection is unavailable.");
    const validation = definitions.find(definition => definition.name === entry.name)?.validation;
    return Object.freeze({
      name: entry.name,
      identity: entry.identity,
      mode: inspected.mode,
      schema: entry.schema,
      ...(validation === undefined ? {} : { validation }),
    });
  }));
  if (clientSnapshot !== undefined) aggregate.configureClientComposition(clientSnapshot);

  function cut(options: LiveMapCutOptions = {}, demanded?: readonly string[]): LiveMapCut | LiveMapHtmlCut {
    const checkCapture = aggregate.captureFence();
    if (!is_record(options) || Object.keys(options).some(key => key !== "data" && key !== "documents" && key !== "html")) {
      throw new TypeError("LiveMap cut options must contain only data, documents, and html selections.");
    }
    const html = options.html;
    const source = aggregate.hostedRegistry();
    const applications = source.libraries.filter(entry => entry.scope !== "hson-internal");
    const select = (requested: readonly string[] | undefined, documents: boolean): readonly string[] => {
      if (requested === undefined) return applications.filter(entry => (entry.mode === "document") === documents).map(entry => entry.name);
      if (!Array.isArray(requested)) throw new TypeError("LiveMap cut family selection must be an array of Library names.");
      const names = new Set<string>();
      for (const name of requested) {
        const entry = applications.find(entry => entry.name === name);
        if (entry === undefined || (entry.mode === "document") !== documents || names.has(name)) {
          throw new Error(`Invalid or duplicated LiveMap cut Library ${JSON.stringify(name)}.`);
        }
        names.add(name);
      }
      return Object.freeze([...names]);
    };
    const data = select(options.data, false);
    const documents = select(options.documents, true);
    if (html !== undefined && (typeof html !== "string" || !documents.includes(html))) {
      throw new Error("LiveMap cut HTML must identify a selected document Library.");
    }
    const included = new Set([...data, ...documents]);
    // Source registry order makes equivalent selections deterministic.
    const entries = applications.filter(entry => included.has(entry.name));
    const captured = aggregate.captureSelectedHosted(entries.map(entry => entry.name), false);
    const selectedEntry = html === undefined ? undefined : named.get(html);
    if (demanded !== undefined && selectedEntry === undefined) throw new Error("SSR subject cut requires a selected HTML Library.");
    const ssr = demanded === undefined || selectedEntry === undefined ? undefined
      : aggregate.captureDocumentSsr(selectedEntry.identity, demanded);
    const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
    const registry = registry_from_entries(source.libraries.filter(entry =>
      included.has(entry.name) || (system !== undefined && entry.scope === "hson-internal")));
    const libraryRoots = captured.libraries.map((library, index) => {
      const entry = registry.libraries[index];
      if (entry === undefined) throw new Error("Cut Library metadata is unavailable.");
      return Object.freeze({ name: entry.name, mode: entry.mode, schema: entry.schema, schemaDigest: entry.schemaDigest,
        ...(ssr !== undefined && library.name === html
          ? { root: encode_hosted_root(ssr.root, HOSTED_MAX_SNAPSHOT_BYTES),
            ...(ssr.quads === undefined ? {} : { quads: ssr.quads }), css: ssr.css }
          : { root: library.root, ...(own_document_quads(library) === undefined ? {} : { quads: own_document_quads(library) }), ...(library.css === undefined ? {} : { css: library.css }) }) });
    });
    if (system !== undefined) {
      const entry = registry.libraries[registry.libraries.length - 1];
      if (entry === undefined) throw new Error("Interaction system registry is unavailable.");
      libraryRoots.push(Object.freeze({ name: entry.name, mode: entry.mode, schema: entry.schema, schemaDigest: entry.schemaDigest,
        root: encode_hosted_root(project_interaction_state_internal(aggregate.systemRoot(system), new Set(documents)), HOSTED_MAX_SNAPSHOT_BYTES) }));
    }
    const after = aggregate.hostedPosition();
    if (captured.revision !== after.revision || captured.authority !== after.authority || source.digest !== after.registryDigest) {
      throw new Error("LiveMap state changed during cut.");
    }
    const libs: LiveMapSnapshot = Object.freeze({ format: "hson-livemap-libraries-snapshot", revision: captured.revision,
      registry, registryDigest: registry.digest, libraries: Object.freeze(libraryRoots) });
    // Complete source capture before detached bound checks and realization,
    // which may reenter without changing the captured siblings.
    checkCapture();
    assert_libraries_snapshot_bound(libs);
    if (html === undefined) return Object.freeze({ libs });
    const document = captured.libraries.find(library => library.name === html);
    if (document?.css === undefined) throw new Error("Cut document stylesheet is unavailable.");
    const realization = ssr !== undefined
      ? realize_document(ssr.root, render_portable_document_stylesheet(decode_portable_document_stylesheet(ssr.css)), { quads: ssr.quads })
      : realize_document(decode_hosted_root(document.root, HOSTED_MAX_SNAPSHOT_BYTES),
        render_portable_document_stylesheet(decode_portable_document_stylesheet(document.css)),
        document_css_subject_identities(document.css, "inbound").length ? { quads: document.quads } : undefined);
    return Object.freeze({ libs, document: html, html: realization });
  }

  const public_commit = (commit: LiveMapAggregateCommit): LiveMapCommit => Object.freeze({
    kind: "map" as const,
    changed: commit.changed,
    prevRev: commit.prevRev,
    rev: commit.rev,
    operations: Object.freeze([
      ...(commit.topology === undefined ? [] : [commit.topology]),
      ...(commit.schemaUse === undefined ? [] : (() => {
        const library = namesByIdentity.get(commit.schemaUse.library);
        return library === undefined ? [] : [Object.freeze({ library, operation: commit.schemaUse.operation })];
      })()),
      ...(commit.css === undefined ? [] : (() => {
        const library = namesByIdentity.get(commit.css.library);
        return library === undefined ? [] : [Object.freeze({ library, operation: commit.css.operation })];
      })()),
      ...commit.operations.flatMap((entry): LiveMapCommit["operations"] => {
        if (entry.target.domain !== "application") return [];
        const library = namesByIdentity.get(entry.target.library);
        if (library === undefined) return [];
        const operation = entry.operation;
        if ("domain" in operation && operation.domain === "css") {
          return [Object.freeze({ library, operation })];
        }
        return [Object.freeze({ library, operation })];
      }),
    ]),
  });

  const selected = (name: string): LiveMapDataLibrary | LiveMapDocumentLibrary => {
    const existing = selectedFacades.get(name);
    if (existing !== undefined) return existing;
    const library = named.get(name);
    if (library === undefined) throw new Error(`Unknown LiveMap Library ${JSON.stringify(name)}.`);
    const facade = library.family === "data"
      ? make_data_library(library, aggregate, public_commit)
      : make_document_library(library, aggregate, public_commit);
    if (clientSnapshot !== undefined) CLIENT_LIBRARY_SOURCES.set(facade,
      aggregate.clientProjection()?.libraries.includes(name) ? "authority-projected" : "client-local");
    selectedFacades.set(name, facade);
    return facade;
  };

  const addLibrariesInternal = (additions: readonly CanonicalLibraryDefinition[],
    css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>> = {},
    clientLocal = false, beforeInstall?: () => void, installed?: () => void,
    compositionStyles?: Readonly<{ name: string; styles: readonly import("./livemap.document.composition.js").DocumentCompositionStyle[] }>): LiveMapCommit => {
    if (!clientLocal) aggregate.assertPublicMutationAllowed();
    for (const { name } of additions) {
      if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    }
    const definitions = additions.map((definition) => {
      const { name, root, schema, family } = definition;
      const quads = own_document_quads(definition);
      return Object.freeze({
        name, root, family,
        ...(quads === undefined ? {} : { quads }),
        hsonSchema: schema,
        ...(definition.validation === undefined ? {} : { validation: definition.validation }),
        ...(Object.hasOwn(css, name) ? { css: decode_portable_document_stylesheet(css[name]) } : {}),
        ...(compositionStyles?.name === name ? { compositionStyles: compositionStyles.styles } : {}),
      });
    });
    const afterInstall = (identities: readonly LiveMapLibraryIdentity[]): void => {
      for (let index = 0; index < additions.length; index += 1) {
        const definition = additions[index];
        const identity = identities[index];
        if (definition === undefined || identity === undefined) throw new Error("LiveMap admission lost a Library identity.");
        add(definition, identity);
      }
      installed?.();
    };
    const commit = clientLocal ? aggregate.addClientLocalLibraries(definitions, afterInstall)
      : aggregate.addLibraries(definitions, afterInstall, beforeInstall);
    return public_commit(commit);
  };
  const addLibraries = (inputs: LiveMapDefinitions): LiveMapCommit => {
    aggregate.assertPublicMutationAllowed();
    return addLibrariesInternal(public_library_definitions(inputs));
  };

  const lib = Object.freeze((name: string) => selected(name));

  const batch = (callback: (writer: LiveMapStagedWriter<LiveMap, void>) => unknown): LiveMapCommit => {
    if (clientSnapshot !== undefined) throw new Error("LiveMap batch is unavailable on a client composition map.");
    let writes: readonly LiveMapAggregateWrite[] = [];
    aggregate.withPublicBatch(() => {
      const staged = make_livemap_staged_writer<LiveMap>(aggregate);
      try {
        const result = callback(staged.writer);
        if (is_staged_thenable(result)) {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError("LiveMap batch callback must be synchronous.");
        }
        writes = staged.writes();
      } finally {
        staged.close();
      }
    });
    return public_commit(aggregate.commit(writes));
  };

  const libraries = Object.freeze({
    get rev() { return aggregate.inspect().revision; },
    lib,
    batch,
    addLibraries,
    replay: (commit: LiveMapCommit): LiveMapCommit => {
      if (commit.kind !== "map" || !commit.changed || commit.prevRev !== aggregate.inspect().revision
        || commit.rev !== commit.prevRev + 1 || commit.operations.length !== 1) {
        throw new Error("LiveMap replay requires the next canonical supported commit.");
      }
      const operation = commit.operations[0];
      if (operation !== undefined && "domain" in operation.operation && operation.operation.domain === "css") {
        const binding = named.get(operation.library);
        if (binding === undefined || binding.family === "data") throw new Error("CSS replay requires a document Library.");
        const normalized = canonical_portable_document_css_op(operation.operation);
        const current = aggregate.stylesheet(binding.identity);
        if (portable_document_stylesheet_equal(current, apply_portable_document_css_op(current, normalized))) {
          throw new Error("CSS replay requires a semantic stylesheet change.");
        }
        return public_commit(aggregate.commitStylesheet(binding.identity, normalized));
      }
      if (operation !== undefined && is_library_schema_use_operation(operation)) {
        const binding = named.get(operation.library);
        if (binding === undefined) throw new Error("LiveMap Schema replay requires an existing Library.");
        const schema = HsonSchemaHandle.fromHson(operation.operation.schema);
        const replayed = public_commit(aggregate.useLibrarySchema(
          binding.identity,
          schema,
          operation.operation.previousSchemaDigest,
        ));
        if (!replayed.changed) throw new Error("LiveMap Schema replay requires a semantic tightening transition.");
        return replayed;
      }
      if (operation === undefined || !is_library_add_operation(operation) || operation.operation.libraries.length === 0) {
        throw new Error("LiveMap replay requires a supported topology operation.");
      }
      aggregate.assertPublicMutationAllowed();
      return addLibrariesInternal(topology_definitions(operation), topology_css(operation));
    },
    capture: () => aggregate.captureLibraries(),
    restore: (snapshot: LiveMapSnapshot) => {
      if (snapshot.registry.digest !== aggregate.hostedRegistry().digest) {
        throw new Error("LiveMap restore requires the current Library topology; install a different capture in a fresh map.");
      }
      aggregate.restoreLibraries(snapshot);
    },
    // Surplus JavaScript callback arguments have no public cut semantics.
    cut: (options: LiveMapCutOptions = {}) => cut(options),
    commits: Object.freeze({
      observe: (listener: (commit: LiveMapCommit) => void) =>
        aggregate.observe((commit) => listener(public_commit(commit))),
    }),
  });
  register_internal_livemap_aggregate_owner(libraries, aggregate);
  DOCUMENT_SSR_CUT.set(libraries, (options, demanded) => {
    if (!Array.isArray(demanded)) throw new Error("SSR subject cut requires an exact demand array.");
    const result = cut(options, demanded);
    if (!("html" in result)) throw new Error("SSR subject cut requires HTML selection.");
    return result;
  });
  EXACT_LIBRARY_ADMISSION.set(libraries, (definitions) => addLibrariesInternal(definitions));
  PART_COLLECTION_ADMISSION.set(libraries, (name, parts) => {
    aggregate.assertPublicMutationAllowed();
    const checkCapture = aggregate.captureFence();
    const definition = part_collection_definition_internal(parts);
    const additions = public_library_definitions({ [name]: definition });
    checkCapture();
    return addLibrariesInternal(additions, {}, false, checkCapture);
  });
  const readPart = (collection: string, member: string): ValidatedPart => {
    const checkCapture = aggregate.captureFence();
    if (typeof member !== "string") throw new TypeError("Part member key must be a string.");
    const entry = named.get(collection);
    const contract = aggregate.hostedRegistry().libraries.find(candidate => candidate.name === collection);
    if (entry === undefined || entry.family !== "data" || contract?.validation !== PART_COLLECTION_VALIDATION) {
      throw new Error("Unknown Part collection.");
    }
    const parts = validate_data_library(aggregate.root(entry.identity), contract.mode, contract.validation);
    const part = parts?.find(candidate => candidate.key === member);
    if (part === undefined) throw new Error("Unknown Part member.");
    checkCapture();
    return part;
  };
  PART_READ.set(libraries, readPart);
  DOCUMENT_COMPOSITION.set(libraries, (source, name, options) => {
    // Preserve existing batch/client/hosted authority fences before inspecting sources.
    aggregate.assertPublicMutationAllowed();
    if (typeof source !== "string" || typeof name !== "string") {
      throw new TypeError("Document composition requires source and result Library names.");
    }
    const checkCapture = aggregate.captureFence();
    const configuration = document_composition_options(options);
    const candidate = expand_document_composition(source, (sourceName) => {
      const entry = named.get(sourceName);
      if (entry === undefined) throw new Error(`Unknown composition source Library ${JSON.stringify(sourceName)}.`);
      if (entry.family !== "document") throw new TypeError(`Composition source Library ${JSON.stringify(sourceName)} is not a document.`);
      const css = aggregate.stylesheet(entry.identity);
      if (css.rules.length || css.properties.length || css.keyframes.length || css.order.length) {
        throw new Error(`Composition source Library ${JSON.stringify(sourceName)} has a managed stylesheet; transfer is not supported.`);
      }
      const root = clone_hson_graph_without_quids(aggregate.root(entry.identity));
      const quads = aggregate.projectDocumentCorrespondence(entry.identity, []);
      return { root, ...(quads === undefined ? {} : { quads }) };
    }, configuration, readPart);
    const definitions = capture_library_definitions([{ name, family: "document", schema: configuration.schema, ...candidate }]);
    // Source coherence ends at this exact detached candidate. Ordinary admission
    // retains its own revision, identity and management fences thereafter.
    checkCapture();
    addLibrariesInternal(definitions, {}, false, undefined, undefined,
      candidate.styles.length ? { name, styles: candidate.styles } : undefined);
    const result = selected(name);
    if (result.mode !== "document") throw new Error("Document composition lost its admitted document Library.");
    return result;
  });
  if (clientSnapshot !== undefined) CLIENT_LOCAL_LIBRARY_ADMISSION.set(libraries,
    (definitions, css, installed) => addLibrariesInternal(definitions, css, true, undefined, installed));
  register_echo_map_capability_internal(libraries, Object.freeze({
    revision: () => aggregate.inspect().revision,
    documentMaps: () => Object.freeze([...named.values()]
      .filter((entry) => entry.family === "document"
        && (clientSnapshot === undefined || clientSnapshot.registry.libraries.some((projected) => projected.name === entry.name)))
      .map((entry) => selected(entry.name))),
    acquire(owner: object) {
      aggregate.claimManagement(owner);
      try {
        const projection = aggregate.clientProjection();
        const snapshot = projection === undefined ? aggregate.hostedPosition() : undefined;
        return Object.freeze({
          runManaged: <T>(operation: () => T): T => operation(),
          release: (): void => aggregate.releaseManagement(owner),
          initialRecovery: Object.freeze({
            incarnationId: projection?.authority.incarnationId ?? snapshot?.authority.incarnationId,
            lastAppliedRev: projection?.revision ?? snapshot?.revision,
          }),
        });
      } catch (cause) {
        aggregate.releaseManagement(owner);
        throw cause;
      }
    },
  }));
  // No application callback or public handle escapes this provisional receiver.
  // Failure discards the entire fresh owner, including its private issuance ledger.
  for (const [name, declarations] of authoredQuads) {
    const entry = named.get(name), document = selected(name);
    if (entry === undefined || document.mode !== "document") throw new Error("Authored QUAD admission lost its document Library.");
    const bindings = declarations.map(({ name, path }) => ({ name,
      quid: ensure_livemap_document_canonical_identity(document.document, { kind: "path", path }),
    }));
    aggregate.installInitialDocumentQuads(entry.identity, bindings);
  }
  PUBLIC_MULTI_LIBRARY_MAPS.add(libraries);
  HOSTED_LIBRARY_ADMISSION.set(libraries, (owner, additions, css) => {
    if (additions.length === 0) throw new Error("Hosted Library admission batch is empty.");
    for (const { name } of additions) {
      if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    }
    const prepared = aggregate.prepareAddLibrariesManaged(owner, additions.map((definition) => {
      const { name, root, schema, family } = definition;
      const quads = own_document_quads(definition);
      return Object.freeze({
        name, root, family,
        ...(quads === undefined ? {} : { quads }),
        hsonSchema: schema,
        ...(definition.validation === undefined ? {} : { validation: definition.validation }),
        ...(css !== undefined && Object.hasOwn(css, name) ? { css: decode_portable_document_stylesheet(css[name]) } : {}),
      });
    }));
    return Object.freeze({
      transition: prepared.transition,
      afterInstall: () => {
        for (let index = 0; index < additions.length; index += 1) {
          const definition = additions[index];
          const identity = prepared.identities[index];
          if (definition === undefined || identity === undefined) throw new Error("Hosted Library admission lost an identity.");
          add(definition, identity);
        }
      },
    });
  });
  if (clientSnapshot !== undefined) CLIENT_PROJECTION_RECONCILE.set(libraries, (owner, snapshot) => {
    const prior = aggregate.clientProjection();
    if (prior === undefined) throw new Error("Client projection is unavailable.");
    const previousNames = prior.registry.libraries.filter((entry) => entry.scope === undefined)
      .map((entry) => entry.name);
    const inputs = new Map<string, Pick<CanonicalLibraryDefinition, "name" | "family" | "schema">>();
    for (const entry of snapshot.libraries) {
      const contract = snapshot.registry.libraries.find((candidate) => candidate.name === entry.name);
      if (contract === undefined || contract.scope === "hson-internal") continue;
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      inputs.set(entry.name, { name: entry.name, family: entry.mode === "document" ? "document" : "data", schema });
    }
    aggregate.restoreClientHostedManaged(owner, snapshot, (projected, retired) => {
      const nextByName = new Map(projected.map((entry) => [entry.name, entry.identity]));
      const retiredFacades: object[] = [];
      for (const name of previousNames) {
        const existing = named.get(name);
        if (existing === undefined) continue;
        if (nextByName.get(name) === existing.identity) continue;
        const facade = selectedFacades.get(name);
        if (facade !== undefined) retiredFacades.push(facade);
        named.delete(name);
        namesByIdentity.delete(existing.identity);
        selectedFacades.delete(name);
      }
      for (const entry of projected) {
        if (named.get(entry.name)?.identity === entry.identity) continue;
        const input = inputs.get(entry.name);
        if (input === undefined) throw new Error("Reconciled Library definition is unavailable.");
        add(input, entry.identity);
      }
      void retired;
      for (const facade of retiredFacades) {
        deliver_livemap_observers([...(CLIENT_LIBRARY_RETIREMENT.get(facade) ?? [])], listener => listener(), "library-retirement");
      }
    });
  });
  return libraries as unknown as LiveMap;
}

/**
 * Construct an internal, fixed-registry client mirror from an exact aggregate
 * snapshot. The Locus client owns synchronization/current-state protocol handling.
 */
export function make_livemap_hosted_mirror_from_snapshot_internal(
  snapshot: HostedLiveMapSnapshot,
): LiveMap {
  assert_hosted_libraries_snapshot_shape(snapshot);
  assert_libraries_snapshot_bound(snapshot);
  return make_livemap_mirror_from_portable_aggregate_internal(make_portable_aggregate_snapshot(snapshot));
}

/** Construct an Echo replica from QUID-free client state and its protocol fence. */
export function make_livemap_mirror_from_portable_aggregate_internal(
  snapshot: PortableAggregateSnapshot,
): LiveMap {
  const local = portable_aggregate_snapshot_as_local(snapshot);
  const mirror = make_livemap_mirror_from_snapshot_internal(local);
  internal_livemap_aggregate_authority(mirror).restoreClientHosted(snapshot);
  return mirror;
}

/** Construct the authority-owned partition of one composed Echo LiveMap. @internal */
export function make_livemap_client_composition_from_portable_aggregate_internal(
  snapshot: PortableAggregateSnapshot,
): LiveMap {
  const admitted = portable_aggregate_inputs_internal(snapshot);
  return make_livemap_from_canonical_libraries_internal(admitted.inputs, admitted.systems, snapshot);
}

/** Structurally admit one authority partition without constructing its runtime. @internal */
export function portable_aggregate_inputs_internal(
  snapshot: PortableAggregateSnapshot,
): Readonly<{ inputs: readonly CanonicalLibraryDefinition[]; systems: readonly InitialSystemState[] }> {
  assert_portable_aggregate_snapshot_shape(snapshot);
  const inputs: CanonicalLibraryDefinition[] = [];
  const systems: InitialSystemState[] = [];
  for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
    const entry = snapshot.registry.libraries[index];
    const encoded = snapshot.libraries[index];
    if (entry === undefined || encoded === undefined || entry.name !== encoded.name
      || entry.mode !== encoded.mode || entry.schemaDigest !== encoded.schemaDigest
      || hson_schema_source_digest(entry.schema) !== entry.schemaDigest
      || hson_schema_source_digest(encoded.schema) !== entry.schemaDigest) {
      throw new Error("Client projection Library metadata is malformed.");
    }
    const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
    admit_portable_hson_node(root, "Client projection root");
    const schema = HsonSchemaHandle.fromHson(entry.schema);
    if (entry.scope === "hson-internal") {
      systems.push(Object.freeze({ key: entry.name, transportName: entry.name, root, hsonSchema: schema }));
    } else {
      inputs.push({ name: entry.name, family: entry.mode === "document" ? "document" : "data", root, schema,
        ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }),
        ...(own_document_quads(encoded) === undefined ? {} : { quads: decode_document_quads(own_document_quads(encoded), root, entry.mode) }) });
    }
  }
  return Object.freeze({ inputs: Object.freeze(inputs), systems: Object.freeze(systems) });
}

/** Install complete semantic state without passing through a snapshot artifact. @internal */
export function make_livemap_mirror_from_semantic_checkpoint_internal(
  checkpoint: LiveMapSemanticCheckpoint,
): LiveMap {
  if (checkpoint.registry.libraries.length !== checkpoint.libraries.length) {
    throw new Error("Semantic checkpoint registry is incomplete.");
  }
  const inputs: CanonicalLibraryDefinition[] = [];
  const systems: InitialSystemState[] = [];
  for (let index = 0; index < checkpoint.registry.libraries.length; index += 1) {
    const entry = checkpoint.registry.libraries[index];
    const library = checkpoint.libraries[index];
    if (entry === undefined || library === undefined || entry.name !== library.name) {
      throw new Error("Semantic checkpoint Library order is invalid.");
    }
    admit_portable_hson_node(library.root, "Semantic checkpoint root");
    const schema = HsonSchemaHandle.fromHson(entry.schema);
    if (entry.scope === "hson-internal") {
      systems.push(Object.freeze({ key: entry.name, transportName: entry.name,
        root: library.root, hsonSchema: schema }));
    } else {
      inputs.push({ name: entry.name, family: entry.mode === "document" ? "document" : "data", root: library.root, schema,
        ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }) });
    }
  }
  const map = make_livemap_from_canonical_libraries_internal(inputs, systems);
  internal_livemap_aggregate_authority(map).installSemanticCheckpoint(checkpoint);
  return map;
}

/** @internal Shared exact aggregate decoder/installer used by local and hosted installation. */
export function make_livemap_mirror_from_snapshot_internal(
  snapshot: LiveMapSnapshot,
): LiveMap {
  return restore_portable_document_receiver_internal(snapshot).map;
}

/** Fresh final-only receiver retaining this installation's bounded correspondence. @internal */
export function restore_portable_document_receiver_internal(snapshot: LiveMapSnapshot): Readonly<{
  map: LiveMap; correspondence: import("./livemap.internal.js").PortableQuadRestoration;
}> {
  assert_libraries_snapshot_shape(snapshot);
  assert_libraries_snapshot_bound(snapshot);
  if (snapshot.registryDigest !== snapshot.registry.digest
    || snapshot.libraries.length !== snapshot.registry.libraries.length) {
    throw new Error("LiveMap Libraries snapshot registry is malformed.");
  }

  const inputs: CanonicalLibraryDefinition[] = [];
  const systems: InitialSystemState[] = [];
  for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
    const registry = snapshot.registry.libraries[index];
    const library = snapshot.libraries[index];
    if (registry === undefined || library === undefined
      || registry.name !== library.name
      || registry.mode !== library.mode
      || hson_schema_source_digest(registry.schema) !== registry.schemaDigest
      || hson_schema_source_digest(library.schema) !== registry.schemaDigest
      || registry.schemaDigest !== library.schemaDigest) {
      throw new Error("LiveMap Libraries snapshot Library metadata is malformed.");
    }
    const root = decode_hosted_root(library.root, HOSTED_MAX_SNAPSHOT_BYTES);
    admit_portable_hson_node(root, "LiveMap Libraries snapshot");
    if (registry.scope === "hson-internal") {
      systems.push(Object.freeze({
        key: registry.name,
        transportName: registry.name,
        root,
        hsonSchema: HsonSchemaHandle.fromHson(registry.schema),
      }));
      continue;
    }
    inputs.push({ name: registry.name, family: registry.mode === "document" ? "document" : "data", root,
      schema: HsonSchemaHandle.fromHson(registry.schema),
      ...(own_data_library_validation(registry) === undefined ? {} : { validation: own_data_library_validation(registry) }) });
  }

  const mirror = make_livemap_from_canonical_libraries_internal(inputs, systems);
  const aggregate = internal_livemap_aggregate_authority(mirror);
  const correspondence = aggregate.restorePortableLibrariesWithCorrespondence(snapshot);
  return Object.freeze({ map: mirror, correspondence });
}

function make_data_library(
  library: NamedLibrary,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  public_commit: (commit: LiveMapAggregateCommit) => LiveMapCommit,
): LiveMapDataLibrary {
  const contract = aggregate.hostedRegistry().libraries.find((entry) => entry.name === library.name);
  if (contract === undefined || contract.scope !== undefined || !is_data_livemap_mode(contract.mode)) {
    throw new Error(`LiveMap Library ${JSON.stringify(library.name)} is not a data Library.`);
  }
  const snap = (path: LivePath = []): JsonValue | undefined => aggregate.snap(library.identity, path);
  const public_data_commit = (commit: LiveMapAggregateCommit): LiveMapCommit<string, LiveMapDataOp> =>
    public_commit(commit) as LiveMapCommit<string, LiveMapDataOp>;
  const handle = <TValue = JsonValue | undefined>(path: LivePath): LiveMapLibraryPathHandle<TValue> => {
    const stablePath = clone_live_path(must_live_path(path));
    type DataCommit = LiveMapCommit<string, LiveMapDataOp>;
    const projectedRead = (targetPath: LivePath): OrderedProjectedValue | undefined => ordered_projected_value_at(
      projected_value_from_hson_node(aggregate.root(library.identity)),
      targetPath,
    );
    const projectedAuthority: LiveMapProjectedPropagation<DataCommit> = {
      read: projectedRead,
      feed: () => { throw new Error("Named Library shape helpers do not expose an internal feed."); },
      commit: (ops) => public_data_commit(aggregate.commit(ops.map((op) => ({
        target: aggregate.target(library.identity, op.path),
        ...op,
      })))),
    };
    const objectApi = make_livemap_object_api<TValue, DataCommit>({} as never, stablePath, projectedAuthority);
    const arrayApi = make_livemap_array_api<TValue, DataCommit>({} as never, stablePath, projectedAuthority);
    const objectCapabilities = omit_object_discriminant(objectApi);
    const arrayCapabilities = omit_array_collisions(arrayApi);
    const currentKind = () => classify_data_path_value(snap(stablePath));
    const facade = {
      get rev() { return aggregate.inspect().revision; },
      path: () => clone_live_path(stablePath),
      snap: () => snap(stablePath) as TValue,
      data: () => {
        const value = ordered_projected_value_at(
          projected_value_from_hson_node(aggregate.root(library.identity)),
          stablePath,
        );
        return value === undefined ? undefined : hson_data_text_from_value(value);
      },
      at: ((child: LivePath) => handle([...stablePath, ...must_live_path(child)])) as unknown as LiveMapLibraryPathHandle<TValue>["at"],
      watch: (listener: (next: TValue) => void) => {
        const stopWatch = aggregate.watch(library.identity, stablePath, (next) => listener(next as TValue));
        const stopRestore = aggregate.observeRestore((event) => {
          if (event.libraries.includes(library.identity)) listener(snap(stablePath) as TValue);
        });
        return () => { stopWatch(); stopRestore(); };
      },
      feed: (listener: (event: LiveMapLibraryFeedEvent) => void) => aggregate.feed(
        library.identity, stablePath, (event) => {
          const ops = event.operations.map((entry) => entry.operation).filter(
            (operation): operation is LiveMapDataOp => !("domain" in operation),
          );
          if (ops.length === 0) return;
          const commit = public_data_commit(event.commit);
          listener(Object.freeze({ op: ops[0]!, ops: Object.freeze(ops),
            path: clone_live_path(stablePath), value: event.value, commit }));
        },
      ),
      set: (value: LiveMapSetValue<TValue>) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "set",
        value: must_json_value(value, stablePath),
      }])),
      replace: (value: LiveMapWriteValue<TValue>) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "replace",
        value: must_json_value(value, stablePath),
      }])),
      delete: () => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "delete",
      }])),
      update: (updater: (value: TValue) => LiveMapSetValue<TValue>) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "set",
        value: must_json_value(updater(snap(stablePath) as TValue), stablePath),
      }])),
      kind: currentKind,
      present: () => currentKind() === "missing" ? undefined : handle<Exclude<TValue, undefined>>(stablePath),
      asObject: () => currentKind() === "object" ? handle<TValue>(stablePath) : undefined,
      asArray: () => currentKind() === "array" ? handle<TValue>(stablePath) : undefined,
      asScalar: () => currentKind() === "scalar" ? handle<TValue>(stablePath) : undefined,
      ...(currentKind() === "object" ? objectCapabilities : {}),
      ...(currentKind() === "array" ? arrayCapabilities : {}),
    };
    return Object.freeze(facade) as unknown as LiveMapLibraryPathHandle<TValue>;
  };

  function library_snap(): JsonValue | undefined;
  function library_snap<const TPath extends LivePath>(path: TPath): import("../../types/livemap.types.js").LiveMapPathValue<JsonValue | undefined, TPath>;
  function library_snap(path: LivePath = []): JsonValue | undefined {
    return snap(path);
  }
  function library_at<const TPath extends LivePath>(
    path: TPath,
  ): LiveMapLibraryPathHandle<import("../../types/livemap.types.js").LiveMapPathValue<JsonValue | undefined, TPath>> {
    return handle<import("../../types/livemap.types.js").LiveMapPathValue<JsonValue | undefined, TPath>>(path);
  }

  const facade: LiveMapDataLibrary = {
    mode: contract.mode,
    get rev() { return aggregate.inspect().revision; },
    root: () => clone_node(aggregate.root(library.identity)),
    snap: library_snap,
    at: library_at as LiveMapDataLibrary["at"],
    schema: Object.freeze({
      get: () => aggregate.librarySchema(library.identity) as HsonSchemaHandle<unknown, "data">,
      use: (schema: HsonSchemaHandle) => public_commit(aggregate.useLibrarySchema(library.identity, schema)),
    }),
  };
  Object.defineProperty(facade, "css", {
    get: () => { throw new Error(`LiveMap Library ${JSON.stringify(library.name)} is a data Library; document CSS is unavailable.`); },
  });
  const selected = Object.freeze(facade);
  register_livemap_projected_identity_api(selected, make_livemap_projected_identity_api(
    () => selected,
    Object.freeze({
      root: () => aggregate.root(library.identity),
      overlay: () => aggregate.projectedOverlay(library.identity),
      identityEpoch: aggregate.identityEpoch(),
      acquireLocalIdentity: (path, quid) => aggregate.acquireLocalProjectedIdentity(library.identity, path, quid),
    }),
  ));
  register_livemap_identity_epoch_owner(selected, aggregate.identityEpoch());
  register_internal_authority_position_observer(selected, aggregate.observeAuthorityPosition);
  return selected;
}

function classify_data_path_value(value: JsonValue | undefined): import("../../types/livemap.types.js").LiveMapPathKind {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "scalar";
}

function omit_object_discriminant<TValue, TCommit>(
  api: ReturnType<typeof make_livemap_object_api<TValue, TCommit>>,
) {
  const { is: _is, ...capabilities } = api;
  return capabilities;
}

function omit_array_collisions<TValue, TCommit>(
  api: ReturnType<typeof make_livemap_array_api<TValue, TCommit>>,
) {
  const { is: _is, at: _at, replace: _replace, ...capabilities } = api;
  return capabilities;
}

function make_document_library(
  library: NamedLibrary,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  public_commit: (commit: LiveMapAggregateCommit) => LiveMapCommit,
): LiveMapDocumentLibrary {
  const contract = aggregate.hostedRegistry().libraries.find((entry) => entry.name === library.name);
  if (contract === undefined || contract.scope !== undefined || contract.mode !== "document") {
    throw new Error(`LiveMap Library ${JSON.stringify(library.name)} is not a document Library.`);
  }

  const root = (): HsonNode => aggregate.root(library.identity);
  const document_commits = Object.freeze({
    observe: (listener: (observation: LiveMapCommitObservation) => void) => {
      const stopCommit = aggregate.observe((aggregateCommit) => {
        const mapped = aggregate.documentCommitFor(library.identity, aggregateCommit);
        const selectedOperations = aggregateCommit.operations
          .filter((entry) => entry.target.library === library.identity)
          .map((entry) => entry.operation)
          .filter((operation): operation is LiveMapGraphOp => "domain" in operation && operation.domain === "graph");
        const commit: LiveMapGraphCommit = mapped ?? Object.freeze({
          changed: selectedOperations.length > 0,
          prevRev: aggregateCommit.prevRev,
          rev: aggregateCommit.rev,
          ops: Object.freeze(selectedOperations),
        });
        const observation: LiveMapCommitObservation = Object.freeze({
          kind: "commit" as const,
          commit,
          origin: "authoritative" as const,
        });
        register_livemap_document_observation_evidence(observation, Object.freeze({
          mode: "document" as const,
          revision: aggregateCommit.rev,
          root: aggregate.documentRootFor(library.identity, aggregateCommit) ?? root(),
          continuity: "same-epoch" as const,
        }));
        listener(observation);
      });
      const stopRestore = aggregate.observeRestore((event) => {
        if (!event.libraries.includes(library.identity)) return;
        if (!event.changedLibraries.includes(library.identity) && event.continuity === "same-epoch") {
          const commit: LiveMapGraphCommit = Object.freeze({
            changed: false,
            prevRev: event.previousRevision,
            rev: event.revision,
            ops: Object.freeze([]),
          });
          const observation: LiveMapCommitObservation = Object.freeze({
            kind: "commit" as const,
            origin: "replay" as const,
            commit,
          });
          register_livemap_document_observation_evidence(observation, Object.freeze({
            mode: "document" as const,
            revision: event.revision,
            root: root(),
            continuity: event.continuity,
          }));
          listener(observation);
          return;
        }
        const observation: LiveMapCommitObservation = Object.freeze({
          kind: "snapshot" as const,
          origin: "snapshot" as const,
          revision: event.revision,
        });
        register_livemap_document_observation_evidence(observation, Object.freeze({
          mode: "document" as const,
          revision: event.revision,
          root: root(),
          continuity: event.continuity,
          rootRebase: (() => {
            const rebase = event.documentRootRebases?.find(entry => entry.library === library.identity);
            return rebase === undefined ? undefined : Object.freeze({ ...rebase, library: facade });
          })(),
        }));
        listener(observation);
      });
      return () => {
        stopCommit();
        stopRestore();
      };
    },
  });

  const controller = Object.freeze({
    mode: "document" as const,
    rev: () => aggregate.inspect().revision,
    root,
    overlay: () => aggregate.documentOverlay(library.identity),
    commits: document_commits,
    identityEpoch: aggregate.identityEpoch(),
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: import("./livemap.document.mutation.js").PreparedDocumentMutation<TOp>) =>
      aggregate.commitDocumentMutation(library.identity, candidate),
    acquireLocalIdentity: (path: import("../../types/livemap.types.js").LiveMapDocumentPath, quid: string, participant?: import("./livemap.runtime-identity.js").LiveMapRuntimeIdentityParticipant) =>
      aggregate.acquireLocalDocumentIdentity(library.identity, path, quid, participant),
  });
  const mutation = make_livemap_document_mutation_api(controller);
  // Input admission may invoke proxy traps. Fence q delegation through the same
  // mutation controller so reentrant work cannot redirect a captured subject.
  const quadEditFences: Array<() => void> = [];
  const quadMutation = make_livemap_document_mutation_api({
    ...controller,
    applyMutation: (candidate) => {
      const assertCurrent = quadEditFences.at(-1);
      if (assertCurrent === undefined) throw new Error("QUAD edit has no current subject fence.");
      assertCurrent();
      return controller.applyMutation(candidate);
    },
  });
  const quad_edit = <T>(run: () => T, assertSubject: () => void): T => {
    const assertCurrent = aggregate.captureFence();
    quadEditFences.push(() => {
      assertCurrent();
      assertSubject();
    });
    try { return run(); } finally { quadEditFences.pop(); }
  };
  const rawAttrs = Object.freeze({
    ...make_livemap_document_attrs_read_api(controller),
    ...mutation.attrs,
  });
  const rawFlags = Object.freeze({
    ...make_livemap_document_flags_read_api(controller),
    ...mutation.flags,
  });

  const multi_commit = <TOp extends LiveMapGraphOp>(commit: LiveMapGraphCommit<TOp>): LiveMapCommit<string, TOp> => {
    const aggregateCommit = aggregate.aggregateCommitForDocument(commit);
    if (aggregateCommit !== undefined) return public_commit(aggregateCommit) as LiveMapCommit<string, TOp>;
    return Object.freeze({
      kind: "map" as const,
      changed: commit.changed,
      prevRev: commit.prevRev,
      rev: commit.rev,
      operations: Object.freeze([]),
    });
  };

  const raw_at = make_livemap_document_location_factory(
    Object.freeze({
      get rev() { return aggregate.inspect().revision; },
      root,
    }),
    "document",
    Object.freeze({
      attrs: rawAttrs,
      flags: rawFlags,
      replace: mutation.replaceContent,
      remove: mutation.removeContent,
      insert: mutation.insertContent,
      move: mutation.moveContent,
    }),
    (path, listener) => {
      const stopCommit = aggregate.observe((commit) => {
        if (!commit.operations.some((operation) => operation.target.library === library.identity)) return;
        listener(read_livemap_document_logical_location(root(), "document", path));
      });
      const stopRestore = aggregate.observeRestore((event) => {
        if (!event.libraries.includes(library.identity)) return;
        listener(read_livemap_document_logical_location(root(), "document", path));
      });
      return () => {
        stopCommit();
        stopRestore();
      };
    },
  );
  const wrappedLocations = new WeakMap<object, object>();
  const quad_at = make_livemap_document_location_factory(
    Object.freeze({ get rev() { return controller.rev(); }, root }), "document",
    Object.freeze({
      attrs: Object.freeze({ ...make_livemap_document_attrs_read_api(controller), ...quadMutation.attrs }),
      flags: Object.freeze({ ...make_livemap_document_flags_read_api(controller), ...quadMutation.flags }),
      replace: quadMutation.replaceContent, remove: quadMutation.removeContent,
      insert: quadMutation.insertContent, move: quadMutation.moveContent,
    }),
    (path, listener) => raw_at(path).watch(listener),
  );
  const wrap_location = (raw: ReturnType<typeof raw_at>): ReturnType<LiveMapDocumentLibrary["at"]> => {
    const existing = wrappedLocations.get(raw);
    if (existing !== undefined) return existing as ReturnType<LiveMapDocumentLibrary["at"]>;
    const wrapped = Object.freeze({
      get rev() { return raw.rev; },
      path: () => raw.path(),
      snap: () => raw.snap(),
      watch: (listener: (next: HsonNode | Primitive | undefined) => void) => raw.watch(listener),
      at: (path: readonly number[]) => wrap_location(raw.at(path)),
      id: (value: string) => {
        const found = raw.id(value);
        return found === undefined ? undefined : wrap_location(found);
      },
      kind: () => {
        const value = raw.snap();
        if (value === undefined) return "missing" as const;
        if (is_ordinary_element_node(value)) return "element" as const;
        return is_Node(value) ? "root" as const : "text" as const;
      },
      present: () => raw.snap() === undefined ? undefined : wrap_location(raw),
      asElement: () => is_ordinary_element_node(raw.snap()) ? wrap_location(raw) : undefined,
      asRoot: () => {
        const value = raw.snap();
        return is_Node(value) && !is_ordinary_element_node(value) ? wrap_location(raw) : undefined;
      },
      asText: () => {
        const value = raw.snap();
        return value !== undefined && !is_Node(value) ? wrap_location(raw) : undefined;
      },
      replace: (value: LiveMapDocumentContent) => multi_commit(raw.replace(value)),
      delete: () => multi_commit(raw.delete()),
      insert: (index: number, value: LiveMapDocumentContent) => multi_commit(raw.insert(index, value)),
      move: (from: number, to: number) => multi_commit(raw.move(from, to)),
      attrs: Object.freeze({
        get: (name: string) => raw.attrs.get(name),
        has: (name: string) => raw.attrs.has(name),
        keys: () => raw.attrs.keys(),
        must: Object.freeze({ get: (name: string) => raw.attrs.must.get(name) }),
        set: (name: string, value: LiveMapDocumentAttributeValue) => multi_commit(raw.attrs.set(name, value)),
        drop: (name: string) => multi_commit(raw.attrs.drop(name)),
        setMany: (values: LiveMapDocumentAttrs) => multi_commit(raw.attrs.setMany(values)),
        dropMany: (names: readonly string[]) => multi_commit(raw.attrs.dropMany(names)),
        clear: () => multi_commit(raw.attrs.clear()),
        replace: (values: LiveMapDocumentAttrs) => multi_commit(raw.attrs.replace(values)),
      }),
      flags: Object.freeze({
        has: (name: string) => raw.flags.has(name),
        set: (...names: string[]) => multi_commit(raw.flags.set(...names)),
        clear: (...names: string[]) => multi_commit(raw.flags.clear(...names)),
      }),
    });
    wrappedLocations.set(raw, wrapped);
    return wrapped as ReturnType<LiveMapDocumentLibrary["at"]>;
  };

  const attrs = Object.freeze({
    ...make_livemap_document_attrs_read_api(controller),
    set: (target: LiveMapDocumentRequestTarget, name: string, value: LiveMapDocumentAttributeValue) =>
      multi_commit(mutation.attrs.set(target, name, value)),
    drop: (target: LiveMapDocumentRequestTarget, name: string) => multi_commit(mutation.attrs.drop(target, name)),
    setMany: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => multi_commit(mutation.attrs.setMany(target, values)),
    dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => multi_commit(mutation.attrs.dropMany(target, names)),
    clear: (target: LiveMapDocumentRequestTarget) => multi_commit(mutation.attrs.clear(target)),
    replace: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => multi_commit(mutation.attrs.replace(target, values)),
  });
  const flags = Object.freeze({
    ...make_livemap_document_flags_read_api(controller),
    set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => multi_commit(mutation.flags.set(target, ...names)),
    clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => multi_commit(mutation.flags.clear(target, ...names)),
  });

  let document: object;
  const identityApi = make_livemap_document_identity_api(() => document, controller);
  const documentApi = Object.freeze({
    root: () => clone_node(root()),
    content: Object.freeze(Object.assign(
      () => clone_node(root()).$_content.slice(),
      {
        replace: (target: LiveMapDocumentRequestTarget, index: number, replacement: LiveMapDocumentContent, lineage?: LiveMapReplacementLineage) =>
          multi_commit(mutation.replaceContent(target, index, replacement, lineage)),
        insert: (target: LiveMapDocumentRequestTarget, index: number, content: LiveMapDocumentContent) => multi_commit(mutation.insertContent(target, index, content)),
        remove: (target: LiveMapDocumentRequestTarget, index: number) => multi_commit(mutation.removeContent(target, index)),
        move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => multi_commit(mutation.moveContent(target, from, to)),
      },
    )),
    byQuid: (quid: string) => {
      if (!is_persisted_quid(quid)) return undefined;
      const path = controller.overlay().pathForQuid(quid);
      if (path === undefined) return undefined;
      const view = clone_livemap_document_exact_view(root(), "document", controller.overlay());
      const node = resolve_document_path(view, "document", path);
      return is_Node(node) ? node : undefined;
    },
    attrs,
    flags,
  });
  document = documentApi;
  register_livemap_document_identity_api(documentApi, identityApi);
  register_livemap_document_identity_overlay(documentApi, controller.overlay);
  register_livemap_document_identity_authority(documentApi, controller);
  register_livemap_identity_epoch_owner(documentApi, controller.identityEpoch);

  const facade: LiveMapDocumentLibrary = {
    mode: "document" as const,
    get rev() { return aggregate.inspect().revision; },
    css: make_livemap_document_css(
      () => aggregate.stylesheet(library.identity),
      (operation) => { aggregate.commitStylesheet(library.identity, operation); },
    ),
    root: () => clone_node(root()),
    at: (path) => wrap_location(raw_at(path)),
    q: (name) => {
      if (typeof name !== "string") throw new TypeError("LiveMap document QUAD name is not a string");
      const subject = aggregate.documentQuad(library.identity, name, undefined);
      if (subject === undefined) return undefined;
      const handle = make_livemap_document_identity_handle(controller, subject.quid);
      const authority = aggregate.documentAuthority(library.identity);
      const same_authority = () => {
        const current = aggregate.documentAuthority(library.identity);
        return current?.logicalMapId === authority?.logicalMapId && current?.incarnationId === authority?.incarnationId;
      };
      let terminal = false;
      let stopLifetime = () => {};
      const retire = () => {
        if (terminal) return;
        terminal = true;
        handle.dispose();
        stopLifetime();
      };
      // q has strict terminal lifetimes; generic exact-restoration handles keep
      // their existing semantics. Inspect coherent owner state at installation,
      // before an earlier public observer can restore an absent subject.
      stopLifetime = aggregate.observeAuthorityPosition(() => {
        if (handle.path() === undefined || !same_authority()) retire();
      }, "installed");
      return make_livemap_document_quad_location(
        () => {
          const path = handle.path();
          if (path === undefined || !same_authority()) { retire(); return undefined; }
          return internal_document_subject_logical_path(root(), "document", path);
        },
        retire, quad_at, multi_commit, () => aggregate.inspect().revision, quad_edit,
      );
    },
    proxy: (path: readonly number[] = []) => Object.freeze({ $_: wrap_location(raw_at(path)) }),
    render: mark_browser_html_producer(() => {
      const captured = aggregate.captureSelectedHosted([library.name], false).libraries[0];
      if (captured?.css === undefined) throw new Error("Document render capture is unavailable.");
      return realize_document(decode_hosted_root(captured.root, HOSTED_MAX_SNAPSHOT_BYTES),
        render_portable_document_stylesheet(decode_portable_document_stylesheet(captured.css)),
        document_css_subject_identities(captured.css, "inbound").length ? { quads: captured.quads } : undefined);
    }),
    document: documentApi,
    commits: document_commits,
    schema: Object.freeze({
      get: () => aggregate.librarySchema(library.identity) as HsonSchemaHandle<unknown, "document">,
      use: (schema: HsonSchemaHandle) => public_commit(aggregate.useLibrarySchema(library.identity, schema)),
    }),
  };
  register_livemap_document_identity_overlay(facade, controller.overlay);
  register_livemap_identity_epoch_owner(facade, controller.identityEpoch);
  const quadLookup = (name: string | undefined, quid: string | undefined) => aggregate.documentQuad(library.identity, name, quid);
  register_document_quad_lookup(facade, quadLookup);
  register_document_quad_lookup(documentApi, quadLookup);
  const selected = Object.freeze(facade);
  DOCUMENT_SSR_CAPTURE.set(selected, demanded => aggregate.captureDocumentSsr(library.identity, demanded));
  DOCUMENT_CSS_STATE.set(selected, () => aggregate.stylesheet(library.identity));
  DOCUMENT_CSS_COMMIT.set(selected, (operation) => { aggregate.commitStylesheet(library.identity, operation); });
  register_internal_authority_position_observer(selected, aggregate.observeAuthorityPosition);
  return selected;
}

function must_library_input(name: string, value: unknown): LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle; validation?: DataLibraryValidation }> {
  if (name === INTERACTION_RESERVED_LIBRARY_KEY) {
    throw new Error(`LiveMap Library name ${JSON.stringify(name)} is reserved for system state.`);
  }
  if (!is_record(value)) {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} must be an input object.`);
  }
  if (Object.hasOwn(value, "css")) {
    throw new TypeError("Initial Library CSS input is not supported; author through the document Library css handle.");
  }
  own_document_quads(value);
  const validation = own_data_library_validation(value);
  // Configuration getters are supported. Select their values once before
  // classification, then retain only this stable envelope downstream.
  const hasData = Object.hasOwn(value, "data");
  const hasDocument = Object.hasOwn(value, "document");
  const selected: Record<string, unknown> = Object.assign(Object.create(null), value);
  if (own_data_library_validation(selected) !== validation) throw new TypeError("Library validation contract changed during input capture.");
  const schemaValue = Object.hasOwn(selected, "schema") ? selected.schema : value.schema;

  const schema = schemaValue === undefined ? (hasData ? ANY_DATA : ANY_DOCUMENT) : schemaValue;
  if (!(schema instanceof HsonSchemaHandle)) {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} requires an HsonSchema.`);
  }
  if (hasData === hasDocument || hasData !== Object.hasOwn(selected, "data")
    || hasDocument !== Object.hasOwn(selected, "document")) {
    throw new TypeError(
      `LiveMap Library ${JSON.stringify(name)} must specify exactly one of data or document.`,
    );
  }
  if (validation !== undefined && !hasData) throw new TypeError("Part validation requires a data Library.");
  if (hasData) return Object.freeze(Object.assign(Object.create(null), selected, { schema })) as LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>;
  // Node fields are inspected only by exact admission, never by a getter-reading guard.
  if (typeof selected.document === "string" || typeof selected.document === "object" && selected.document !== null) return Object.freeze(Object.assign(Object.create(null), selected, { schema })) as LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>;
  throw new TypeError(`LiveMap document Library ${JSON.stringify(name)} requires Hson source or a canonical node.`);
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function library_root(input: LiveMapLibraryInput): HsonNode {
  if ("data" in input) {
    if (input.data === undefined) throw new TypeError("LiveMap data Library requires JSON material.");
    return hsonTransform.fromJson(input.data).toNode();
  }
  if (input.document === undefined) throw new TypeError("LiveMap document Library requires Hson material.");
  return typeof input.document === "string"
    ? parse_hson(input.document, { allowTopLevelDocumentText: true })
    : input.document;
}

function exact_transport_fields(input: object, fields: readonly string[]): void {
  const keys = Reflect.ownKeys(input);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) throw new Error("Library transport has unknown or missing fields.");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Library transport requires own data fields.");
  }
}
