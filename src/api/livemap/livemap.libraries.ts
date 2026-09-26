import type { PortableAggregateSnapshot } from "./livemap.hosted.internal.types.js";
import { clone_node } from "../../core/clone-node.js";
import { apply_portable_document_css_op, canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { portable_document_stylesheet_equal } from "../../internal/css/portable-document-stylesheet.js";
import { register_echo_map_capability_internal } from "../../internal/echo-map-capability.js";
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
  LiveMapLibraryPathHandle,
  LiveMapDataOp,
  LiveMapLibraryFeedEvent,
  LiveMapCommitObservation,
  LiveMapDocumentApi,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCaptureOptions,
  LiveMapDocumentRequestTarget,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentContent,
  LiveMapReplacementLineage,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapCommit,
  LiveMapSetValue,
  LiveMapWriteValue,
  LivePath,
} from "../../types/livemap.types.js";
import { hson_data_text_from_value } from "../data/hson-data.js";
import { ANY_DATA, ANY_DOCUMENT, HsonSchema as HsonSchemaHandle } from "../schema/hson-schema.js";
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
import { render_local_libraries_html } from "../../internal/document-cut.js";
import { make_livemap_document_css } from "./livemap.css.js";
import { make_livemap_document_mutation_api } from "./livemap.document.mutation.js";
import { make_livemap_document_attrs_read_api, make_livemap_document_flags_read_api } from "./livemap.document.attrs.js";
import { make_livemap_document_location_factory, read_livemap_document_logical_location } from "./livemap.document.location.js";
import { make_livemap_document_proxy } from "./livemap.proxy.js";
import { capture_livemap_document, register_livemap_document_observation_evidence } from "./livemap.document.capture.js";
import { resolve_document_path } from "./livemap.document.path.js";
import {
  make_livemap_document_identity_api,
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
  decode_hosted_root,
  encode_hosted_root,
  HOSTED_MAX_SNAPSHOT_BYTES,
} from "./livemap.hosted.js";
import { node_to_json_value } from "./livemap.editor.js";
import { make_livemap_array_api } from "./livemap.handle-array.js";
import { make_livemap_object_api } from "./livemap.handle-object.js";
import type { LiveMapProjectedPropagation } from "./livemap.projected-propagation.js";
import type { LiveMapSemanticCheckpoint } from "./livemap.internal.js";
import type { PreparedLiveMapAuthorityTransition } from "./livemap.authority.js";

type NamedLibrary = Readonly<{
  name: string;
  identity: LiveMapLibraryIdentity;
  input: LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>;
}>;

const PUBLIC_MULTI_LIBRARY_MAPS = new WeakSet<object>();
const CLIENT_LIBRARY_SOURCES = new WeakMap<object, "authority-projected" | "client-local">();
const DOCUMENT_CSS_STATE = new WeakMap<object, () => import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet>();
const DOCUMENT_CSS_COMMIT = new WeakMap<object, (operation: import("../../types/livemap.types.js").LiveMapCssOp) => void>();

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
const HOSTED_LIBRARY_ADMISSION = new WeakMap<object, (owner: object, inputs: LiveMapDefinitions) => Readonly<{
  transition: PreparedLiveMapAuthorityTransition;
  afterInstall: () => void;
}>>();

function topology_definitions(operation: LiveMapLibraryAddOperation): LiveMapDefinitions {
  if (operation.operation.kind !== "library-add" || operation.operation.libraries.length === 0
    || operation.library !== operation.operation.libraries[0]?.name) {
    throw new Error("LiveMap topology replay requires a canonical library-add operation.");
  }
  const definitions: Record<string, LiveMapLibraryInput> = Object.create(null);
  for (const entry of operation.operation.libraries) {
    if (Object.hasOwn(definitions, entry.name)) throw new Error("LiveMap topology replay contains a duplicate Library.");
    const schema = HsonSchemaHandle.fromHson(entry.schema);
    if (schema.toHson() !== entry.schema) throw new Error("LiveMap topology replay Schema is not canonical.");
    const root = decode_hosted_root(entry.root);
    admit_portable_hson_node(root, "LiveMap topology replay");
    if (classify_live_root_mode(root, entry.mode === "document" ? "document" : "data") !== entry.mode
      || JSON.stringify(encode_hosted_root(root)) !== JSON.stringify(entry.root)) {
      throw new Error("LiveMap topology replay root mode or encoding is inconsistent.");
    }
    definitions[entry.name] = entry.mode === "document"
      ? { document: root, schema }
      : { data: reconstructed_data(root), schema };
  }
  return definitions;
}

function is_library_add_operation(operation: LiveMapCommit["operations"][number]): operation is LiveMapLibraryAddOperation {
  return "kind" in operation.operation && operation.operation.kind === "library-add";
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
  }));
  const existing = current.registry.libraries.map((entry) => Object.freeze({
    name: entry.name, mode: entry.mode, schema: HsonSchemaHandle.fromHson(entry.schema), identity: Object.freeze({}),
    ...(entry.scope === undefined ? {} : { scope: entry.scope }),
  }));
  const application = [...existing.filter((entry) => entry.scope === undefined), ...newBindings]
    .sort((a, b) => a.name.localeCompare(b.name));
  const predicted = make_hosted_registry([...application, ...existing.filter((entry) => entry.scope === "hson-internal")]);
  if (predicted.digest !== expectedDigest) throw new Error("Projected topology registry digest is incompatible.");
  const prepared = prepare_hosted_livemap_library_add_internal(map, owner, definitions);
  let installSystem: (() => void) | undefined;
  try {
    installSystem = system === undefined ? undefined
      : aggregate.prepareClientProjectionSystemManaged(owner, decode_hosted_root(system));
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
): Readonly<{ transition: PreparedLiveMapAuthorityTransition; afterInstall: () => void }> {
  const prepare = HOSTED_LIBRARY_ADMISSION.get(map);
  if (prepare === undefined) throw new Error("Hosted Library admission requires a multi-library LiveMap.");
  return prepare(owner, inputs);
}

/** Internal ownership evidence for write-propagating link admission. */
export function client_library_source_internal(value: object): "authority-projected" | "client-local" | undefined {
  return CLIENT_LIBRARY_SOURCES.get(value);
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

/**
 * Admit the complete named registry before constructing its map-global authority.
 * Names remain at this public facade; the engine uses opaque map-local identities.
 */
export function make_livemap_libraries<const TLibraries extends LiveMapDefinitions>(
  inputs: TLibraries,
  systems: readonly InitialSystemState[] = [],
  clientSnapshot?: PortableAggregateSnapshot,
): LiveMap<LiveMapKnownDefinitions<TLibraries>> {
  const entries = Object.entries(inputs);

  const definitions = entries.map(([name, value]) => ({
    name,
    input: must_library_input(name, value),
  }));
  const built = make_livemap_registry_authority(definitions.map(({ input }) => ({
    root: library_root(input),
    hsonSchema: input.schema,
    family: "data" in input ? "data" as const : "document" as const,
  })), systems);
  const aggregate = built.aggregate;
  const namesByIdentity = new Map<LiveMapLibraryIdentity, string>();
  const named = new Map<string, NamedLibrary>();
  const selectedFacades = new Map<string, LiveMapDataLibrary | LiveMapDocumentLibrary>();

  const add = (name: string, input: LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>, identity: LiveMapLibraryIdentity): void => {
    if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    namesByIdentity.set(identity, name);
    named.set(name, Object.freeze({ name, identity, input }));
  };

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const identity = built.identities[index];
    if (definition === undefined || identity === undefined) throw new Error("LiveMap registry construction is incomplete.");
    add(definition.name, definition.input, identity);
  }

  const inspectedByIdentity = new Map(
    aggregate.inspect().libraries.map((entry) => [entry.identity, entry] as const),
  );
  aggregate.configureHostedRegistry([...named.values()].map((entry) => {
    const inspected = inspectedByIdentity.get(entry.identity);
    if (inspected === undefined) throw new Error("Hosted LiveMap Library inspection is unavailable.");
    return Object.freeze({
      name: entry.name,
      identity: entry.identity,
      mode: inspected.mode,
      schema: entry.input.schema,
    });
  }));
  if (clientSnapshot !== undefined) aggregate.configureClientComposition(clientSnapshot);

  const public_commit = (commit: LiveMapAggregateCommit): LiveMapCommit => Object.freeze({
    kind: "map" as const,
    changed: commit.changed,
    prevRev: commit.prevRev,
    rev: commit.rev,
    operations: Object.freeze([
      ...(commit.topology === undefined ? [] : [commit.topology]),
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
    const facade = "data" in library.input
      ? make_data_library(library, aggregate, public_commit)
      : make_document_library(library, aggregate, public_commit);
    if (clientSnapshot !== undefined) CLIENT_LIBRARY_SOURCES.set(facade,
      aggregate.clientProjection()?.libraries.includes(name) ? "authority-projected" : "client-local");
    selectedFacades.set(name, facade);
    return facade;
  };

  const lib = Object.freeze(Object.assign((name: string) => selected(name), {
    add: (inputs: LiveMapDefinitions): LiveMapCommit => {
      const additions = Object.entries(inputs).map(([name, value]) => Object.freeze({
        name, input: must_library_input(name, value),
      }));
      for (const { name } of additions) {
        if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
      }
      const commit = aggregate.addLibraries(additions.map(({ name, input }) => Object.freeze({
        name,
        root: library_root(input),
        hsonSchema: input.schema,
        family: "data" in input ? "data" as const : "document" as const,
      })), (identities) => {
        for (let index = 0; index < additions.length; index += 1) {
          const definition = additions[index];
          const identity = identities[index];
          if (definition === undefined || identity === undefined) throw new Error("LiveMap admission lost a Library identity.");
          add(definition.name, definition.input, identity);
        }
      });
      return public_commit(commit);
    },
  }));

  const libraries = Object.freeze({
    get rev() { return aggregate.inspect().revision; },
    lib,
    replay: (commit: LiveMapCommit): LiveMapCommit => {
      if (commit.kind !== "map" || !commit.changed || commit.prevRev !== aggregate.inspect().revision
        || commit.rev !== commit.prevRev + 1 || commit.operations.length !== 1) {
        throw new Error("LiveMap topology replay requires the next canonical library-add commit.");
      }
      const operation = commit.operations[0];
      if (operation !== undefined && "domain" in operation.operation && operation.operation.domain === "css") {
        const binding = named.get(operation.library);
        if (binding === undefined || "data" in binding.input) throw new Error("CSS replay requires a document Library.");
        const normalized = canonical_portable_document_css_op(operation.operation);
        const current = aggregate.stylesheet(binding.identity);
        if (portable_document_stylesheet_equal(current, apply_portable_document_css_op(current, normalized))) {
          throw new Error("CSS replay requires a semantic stylesheet change.");
        }
        return public_commit(aggregate.commitStylesheet(binding.identity, normalized));
      }
      if (operation === undefined || !is_library_add_operation(operation) || operation.operation.libraries.length === 0) {
        throw new Error("LiveMap topology replay requires a library-add operation.");
      }
      return lib.add(topology_definitions(operation));
    },
    capture: () => aggregate.captureLibraries(),
    restore: (snapshot: LiveMapSnapshot) => {
      if (snapshot.registry.digest !== aggregate.hostedRegistry().digest) {
        throw new Error("LiveMap restore requires the current Library topology; install a different capture in a fresh map.");
      }
      aggregate.restoreLibraries(snapshot);
    },
    render: (document?: string) => render_local_libraries_html(
      libraries as LiveMap, document, install_libraries_snapshot, decode_hosted_root,
    ),
    commits: Object.freeze({
      observe: (listener: (commit: LiveMapCommit) => void) =>
        aggregate.observe((commit) => listener(public_commit(commit))),
    }),
  });
  register_internal_livemap_aggregate_owner(libraries, aggregate);
  register_echo_map_capability_internal(libraries, Object.freeze({
    revision: () => aggregate.inspect().revision,
    documentMaps: () => Object.freeze([...named.values()]
      .filter((entry) => "document" in entry.input
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
  PUBLIC_MULTI_LIBRARY_MAPS.add(libraries);
  HOSTED_LIBRARY_ADMISSION.set(libraries, (owner, inputs) => {
    const additions = Object.entries(inputs).map(([name, value]) => Object.freeze({
      name, input: must_library_input(name, value),
    }));
    if (additions.length === 0) throw new Error("Hosted Library admission batch is empty.");
    for (const { name } of additions) {
      if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    }
    const prepared = aggregate.prepareAddLibrariesManaged(owner, additions.map(({ name, input }) => Object.freeze({
      name,
      root: library_root(input),
      hsonSchema: input.schema,
      family: "data" in input ? "data" as const : "document" as const,
    })));
    return Object.freeze({
      transition: prepared.transition,
      afterInstall: () => {
        for (let index = 0; index < additions.length; index += 1) {
          const definition = additions[index];
          const identity = prepared.identities[index];
          if (definition === undefined || identity === undefined) throw new Error("Hosted Library admission lost an identity.");
          add(definition.name, definition.input, identity);
        }
      },
    });
  });
  if (clientSnapshot !== undefined) CLIENT_PROJECTION_RECONCILE.set(libraries, (owner, snapshot) => {
    const prior = aggregate.clientProjection();
    if (prior === undefined) throw new Error("Client projection is unavailable.");
    const previousNames = prior.registry.libraries.filter((entry) => entry.scope === undefined)
      .map((entry) => entry.name);
    const inputs = new Map<string, NamedLibrary["input"]>();
    for (const entry of snapshot.libraries) {
      const contract = snapshot.registry.libraries.find((candidate) => candidate.name === entry.name);
      if (contract === undefined || contract.scope === "hson-internal") continue;
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      const root = decode_hosted_root(entry.root);
      inputs.set(entry.name, must_library_input(entry.name, entry.mode === "document"
        ? { document: root, schema } : { data: reconstructed_data(root), schema }));
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
        add(entry.name, input, entry.identity);
      }
      void retired;
      for (const facade of retiredFacades) {
        for (const listener of [...(CLIENT_LIBRARY_RETIREMENT.get(facade) ?? [])]) {
          try { listener(); } catch { /* Retired resource observers cannot roll back accepted topology. */ }
        }
      }
    });
  });
  return libraries as unknown as LiveMap<LiveMapKnownDefinitions<TLibraries>>;
}

/**
 * Construct an internal, fixed-registry client mirror from an exact aggregate
 * snapshot. The Locus client owns recovery/bootstrap protocol exposure.
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
  localLibraries?: LiveMapInput,
): LiveMap {
  if (localLibraries !== undefined) {
    assert_portable_aggregate_snapshot_shape(snapshot);
    const inputs: Record<string, LiveMapLibraryInput> = Object.create(null);
    const systems: InitialSystemState[] = [];
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const encoded = snapshot.libraries[index];
      if (entry === undefined || encoded === undefined || entry.name !== encoded.name
        || entry.mode !== encoded.mode || entry.schema !== encoded.schema) {
        throw new Error("Client projection Library metadata is malformed.");
      }
      const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
      admit_portable_hson_node(root, "Client projection root");
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      if (entry.scope === "hson-internal") {
        systems.push(Object.freeze({ key: entry.name, transportName: entry.name, root, hsonSchema: schema }));
      } else {
        inputs[entry.name] = entry.mode === "document"
          ? { document: root, schema }
          : { data: reconstructed_data(root), schema };
      }
    }
    for (const [name, definition] of Object.entries(localLibraries)) {
      if (Object.hasOwn(inputs, name) || snapshot.registry.libraries.some((entry) => entry.name === name)) {
        throw new Error(`Client-local Library ${JSON.stringify(name)} collides with the authority projection.`);
      }
      inputs[name] = must_library_input(name, definition);
    }
    if (Object.keys(inputs).length === 0) {
      throw new Error("An action-only client session has no LiveMap; use endpoint-only Echo.");
    }
    return make_livemap_libraries(inputs, systems, snapshot);
  }
  const local = portable_aggregate_snapshot_as_local(snapshot);
  const mirror = make_livemap_mirror_from_snapshot_internal(local);
  internal_livemap_aggregate_authority(mirror).restoreClientHosted(snapshot);
  return mirror;
}

/** Install one detached complete aggregate snapshot into a fresh runtime domain. */
export function install_libraries_snapshot(
  snapshot: LiveMapSnapshot,
): Readonly<{ map: LiveMap }> {
  return Object.freeze({ map: make_livemap_mirror_from_snapshot_internal(snapshot) });
}

/** Install complete semantic state without passing through a snapshot artifact. @internal */
export function make_livemap_mirror_from_semantic_checkpoint_internal(
  checkpoint: LiveMapSemanticCheckpoint,
): LiveMap {
  if (checkpoint.registry.libraries.length !== checkpoint.libraries.length) {
    throw new Error("Semantic checkpoint registry is incomplete.");
  }
  const inputs: Record<string, LiveMapLibraryInput> = Object.create(null);
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
      inputs[entry.name] = entry.mode === "document"
        ? { document: library.root, schema }
        : { data: reconstructed_data(library.root), schema };
    }
  }
  const map = make_livemap_libraries(inputs, systems);
  internal_livemap_aggregate_authority(map).installSemanticCheckpoint(checkpoint);
  return map;
}

/** @internal Shared exact aggregate decoder/installer used by local and hosted installation. */
export function make_livemap_mirror_from_snapshot_internal(
  snapshot: LiveMapSnapshot,
): LiveMap {
  assert_libraries_snapshot_shape(snapshot);
  assert_libraries_snapshot_bound(snapshot);
  if (snapshot.registryDigest !== snapshot.registry.digest
    || snapshot.libraries.length !== snapshot.registry.libraries.length) {
    throw new Error("LiveMap Libraries snapshot registry is malformed.");
  }

  const inputs: Record<string, LiveMapLibraryInput> = Object.create(null);
  const systems: InitialSystemState[] = [];
  for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
    const registry = snapshot.registry.libraries[index];
    const library = snapshot.libraries[index];
    if (registry === undefined || library === undefined
      || registry.name !== library.name
      || registry.mode !== library.mode
      || registry.schema !== library.schema
      || registry.schemaDigest !== library.schemaDigest) {
      throw new Error("LiveMap Libraries snapshot Library metadata is malformed.");
    }
    const root = decode_hosted_root(library.root);
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
    inputs[registry.name] = registry.mode === "document"
      ? { document: root, schema: HsonSchemaHandle.fromHson(registry.schema) }
      : { data: reconstructed_data(root), schema: HsonSchemaHandle.fromHson(registry.schema) };
  }

  const mirror = make_livemap_libraries(inputs, systems);
  const aggregate = internal_livemap_aggregate_authority(mirror);
  aggregate.restorePortableLibraries(snapshot);
  return mirror;
}

function make_data_library(
  library: NamedLibrary,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  public_commit: (commit: LiveMapAggregateCommit) => LiveMapCommit,
): LiveMapDataLibrary {
  const inspected = aggregate.inspect().libraries.find((entry) => entry.identity === library.identity);
  if (inspected === undefined || !is_data_livemap_mode(inspected.mode)) {
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
    mode: inspected.mode,
    get rev() { return aggregate.inspect().revision; },
    root: () => clone_node(aggregate.root(library.identity)),
    snap: library_snap,
    at: library_at as LiveMapDataLibrary["at"],
    schema: Object.freeze({ get: () => library.input.schema }),
  };
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
  const inspected = aggregate.inspect().libraries.find((entry) => entry.identity === library.identity);
  if (inspected === undefined || inspected.mode !== "document") {
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
    getDocumentSchema: () => library.input.schema,
    useDocumentSchema: () => {
      throw new Error("Named LiveMap document Library schema is fixed at construction.");
    },
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: import("./livemap.document.mutation.js").PreparedDocumentMutation<TOp>) =>
      aggregate.commitDocumentMutation(library.identity, candidate),
    acquireLocalIdentity: (path: import("../../types/livemap.types.js").LiveMapDocumentPath, quid: string, participant?: import("./livemap.runtime-identity.js").LiveMapRuntimeIdentityParticipant) =>
      aggregate.acquireLocalDocumentIdentity(library.identity, path, quid, participant),
  });
  const mutation = make_livemap_document_mutation_api(controller);
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

  const capture: LiveMapDocumentLibrary["capture"] = (options?: LiveMapDocumentCaptureOptions) => capture_livemap_document(
    controller.identityEpoch,
    "document",
    aggregate.inspect().revision,
    root(),
    controller.overlay(),
    options,
    () => aggregate.documentCaptureContinuity(library.identity),
  );
  const facade: LiveMapDocumentLibrary = {
    mode: "document" as const,
    get rev() { return aggregate.inspect().revision; },
    css: make_livemap_document_css(
      () => aggregate.stylesheet(library.identity),
      (operation) => { aggregate.commitStylesheet(library.identity, operation); },
    ),
    root: () => clone_node(root()),
    at: (path) => wrap_location(raw_at(path)),
    proxy: (path: readonly number[] = []) => Object.freeze({ $_: wrap_location(raw_at(path)) }),
    capture,
    document: documentApi,
    commits: document_commits,
    schema: Object.freeze({ get: () => library.input.schema }),
  };
  register_livemap_document_identity_overlay(facade, controller.overlay);
  register_livemap_identity_epoch_owner(facade, controller.identityEpoch);
  const selected = Object.freeze(facade);
  DOCUMENT_CSS_STATE.set(selected, () => aggregate.stylesheet(library.identity));
  DOCUMENT_CSS_COMMIT.set(selected, (operation) => { aggregate.commitStylesheet(library.identity, operation); });
  register_internal_authority_position_observer(selected, aggregate.observeAuthorityPosition);
  return selected;
}

function must_library_input(name: string, value: unknown): LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }> {
  if (name === INTERACTION_RESERVED_LIBRARY_KEY) {
    throw new Error(`LiveMap Library name ${JSON.stringify(name)} is reserved for system state.`);
  }
  if (!is_record(value)) {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} must be an input object.`);
  }
  if (Object.hasOwn(value, "css")) {
    throw new TypeError("Initial Library CSS input is not supported; author through the document Library css handle.");
  }
  const schema = value.schema === undefined
    ? (Object.hasOwn(value, "data") ? ANY_DATA : ANY_DOCUMENT)
    : value.schema;
  if (!(schema instanceof HsonSchemaHandle)) {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} requires an HsonSchema.`);
  }
  const hasData = Object.hasOwn(value, "data");
  const hasDocument = Object.hasOwn(value, "document");
  if (hasData === hasDocument) {
    throw new TypeError(
      `LiveMap Library ${JSON.stringify(name)} must specify exactly one of data or document.`,
    );
  }
  if (hasData) return Object.freeze({ ...value, schema }) as LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>;
  if (typeof value.document === "string" || is_Node(value.document)) return Object.freeze({ ...value, schema }) as LiveMapLibraryInput & Readonly<{ schema: HsonSchemaHandle }>;
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

/** A string in the public data input is JSON source, so re-encode stored string values. */
function reconstructed_data(root: HsonNode): JsonValue {
  const value = node_to_json_value(root);
  return typeof value === "string" ? JSON.stringify(value) : value;
}
