import { clone_node } from "../../core/clone-node.js";
import { is_Node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { HsonNode, JsonValue, Primitive } from "../../core/types.js";
import type {
  LiveMapDataLibrary,
  LiveMapDocumentLibrary,
  LiveMapLibraries,
  LiveMapLibrariesInput,
  LiveMapLibraryInput,
  LiveMapLibraryOperation,
  LiveMapLibraryPathHandle,
  LiveMapDataOp,
  LiveMapCommitObservation,
  LiveMapDocumentApi,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  DocumentLiveMapCaptureOptions,
  LiveMapDocumentRequestTarget,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentContent,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapMultiLibraryCommit,
  LivePath,
} from "../../types/livemap.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { clone_live_path } from "./livemap.path.js";
import { must_json_value, must_live_path } from "./livemap.guard.js";
import {
  internal_livemap_aggregate_authority,
  register_internal_livemap_aggregate_owner,
} from "./livemap.internal.js";
import type { LiveMapAggregateCommit, LiveMapLibraryIdentity } from "./livemap.library.js";
import { make_classified_livemap } from "./livemap.core.js";
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
import { register_livemap_document_identity_overlay } from "./livemap.document.identity.js";
import { register_livemap_document_identity_authority } from "./livemap.document.registration.js";
import { register_livemap_identity_epoch_owner } from "./livemap.identity-epoch.js";

type NamedLibrary = Readonly<{
  name: string;
  identity: LiveMapLibraryIdentity;
  input: LiveMapLibraryInput;
}>;

const PUBLIC_MULTI_LIBRARY_MAPS = new WeakSet<object>();

/** True only for the dedicated local multi-library public facade. @internal */
export function is_public_multi_library_livemap(value: unknown): value is object {
  return typeof value === "object" && value !== null && PUBLIC_MULTI_LIBRARY_MAPS.has(value);
}

/**
 * Establish a fixed local Library registry over the already-complete aggregate
 * engine. Names remain only at this public facade; the engine continues to use
 * opaque map-local library identities.
 */
export function make_livemap_libraries<const TLibraries extends LiveMapLibrariesInput>(
  inputs: TLibraries,
): LiveMapLibraries<TLibraries> {
  const entries = Object.entries(inputs);
  if (entries.length === 0) throw new Error("LiveMap fromLibraries requires at least one named Library.");

  const firstEntry = entries[0];
  if (firstEntry === undefined) throw new Error("LiveMap fromLibraries could not read its first Library.");
  const [firstName, firstInput] = firstEntry;
  const first = must_library_input(firstName, firstInput);
  const firstMap = make_classified_livemap(library_root(first));
  firstMap.schema.use(first.schema);
  const aggregate = internal_livemap_aggregate_authority(firstMap);
  const namesByIdentity = new Map<LiveMapLibraryIdentity, string>();
  const named = new Map<string, NamedLibrary>();
  const selectedFacades = new Map<string, LiveMapDataLibrary | LiveMapDocumentLibrary>();

  const add = (name: string, input: LiveMapLibraryInput, identity: LiveMapLibraryIdentity): void => {
    if (named.has(name)) throw new Error(`LiveMap Library name ${JSON.stringify(name)} is duplicated.`);
    namesByIdentity.set(identity, name);
    named.set(name, Object.freeze({ name, identity, input }));
  };

  add(firstName, first, aggregate.defaultLibrary());
  for (const entry of entries.slice(1)) {
    const [name, rawInput] = entry;
    const input = must_library_input(name, rawInput);
    const identity = aggregate.addLibrary(library_root(input), { hsonSchema: input.schema });
    add(name, input, identity);
  }

  const public_commit = (commit: LiveMapAggregateCommit): LiveMapMultiLibraryCommit => Object.freeze({
    kind: "multi-library" as const,
    changed: commit.changed,
    prevRev: commit.prevRev,
    rev: commit.rev,
    operations: Object.freeze(commit.operations.map((entry): LiveMapLibraryOperation => {
      const library = namesByIdentity.get(entry.target.library);
      if (library === undefined) throw new Error("LiveMap aggregate commit belongs to an unselected Library.");
      return Object.freeze({ library, operation: entry.operation });
    })),
  });

  const selected = (name: string): LiveMapDataLibrary | LiveMapDocumentLibrary => {
    const existing = selectedFacades.get(name);
    if (existing !== undefined) return existing;
    const library = named.get(name);
    if (library === undefined) throw new Error(`Unknown LiveMap Library ${JSON.stringify(name)}.`);
    const facade = "data" in library.input
      ? make_data_library(library, aggregate, public_commit)
      : make_document_library(library, aggregate, public_commit);
    selectedFacades.set(name, facade);
    return facade;
  };

  const libraries = Object.freeze({
    get rev() { return aggregate.inspect().revision; },
    lib: (name: string) => selected(name),
    commits: Object.freeze({
      observe: (listener: (commit: LiveMapMultiLibraryCommit) => void) =>
        aggregate.observe((commit) => listener(public_commit(commit))),
    }),
  });
  register_internal_livemap_aggregate_owner(libraries, aggregate);
  PUBLIC_MULTI_LIBRARY_MAPS.add(libraries);
  return libraries as unknown as LiveMapLibraries<TLibraries>;
}

function make_data_library(
  library: NamedLibrary,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  public_commit: (commit: LiveMapAggregateCommit) => LiveMapMultiLibraryCommit,
): LiveMapDataLibrary {
  const inspected = aggregate.inspect().libraries.find((entry) => entry.identity === library.identity);
  if (inspected === undefined || (inspected.mode !== "data-object" && inspected.mode !== "data-array")) {
    throw new Error(`LiveMap Library ${JSON.stringify(library.name)} is not a data Library.`);
  }
  const snap = (path: LivePath = []): JsonValue | undefined => aggregate.snap(library.identity, path);
  const public_data_commit = (commit: LiveMapAggregateCommit): LiveMapMultiLibraryCommit<string, LiveMapDataOp> =>
    public_commit(commit) as LiveMapMultiLibraryCommit<string, LiveMapDataOp>;
  const handle = <TValue = JsonValue | undefined>(path: LivePath): LiveMapLibraryPathHandle<TValue> => {
    const stablePath = clone_live_path(must_live_path(path));
    const facade: LiveMapLibraryPathHandle<TValue> = {
      get rev() { return aggregate.inspect().revision; },
      path: () => clone_live_path(stablePath),
      snap: () => snap(stablePath) as TValue,
      at: ((child: LivePath) => handle([...stablePath, ...must_live_path(child)])) as unknown as LiveMapLibraryPathHandle<TValue>["at"],
      set: (value) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "set",
        value: must_json_value(value, stablePath),
      }])),
      replace: (value) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "replace",
        value: must_json_value(value, stablePath),
      }])),
      delete: () => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "delete",
      }])),
      update: (updater) => public_data_commit(aggregate.commit([{
        target: aggregate.target(library.identity, stablePath),
        kind: "set",
        value: must_json_value(updater(snap(stablePath) as TValue), stablePath),
      }])),
    };
    return Object.freeze(facade);
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
  return Object.freeze(facade);
}

function make_document_library(
  library: NamedLibrary,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  public_commit: (commit: LiveMapAggregateCommit) => LiveMapMultiLibraryCommit,
): LiveMapDocumentLibrary {
  const inspected = aggregate.inspect().libraries.find((entry) => entry.identity === library.identity);
  if (inspected === undefined || inspected.mode !== "document") {
    throw new Error(`LiveMap Library ${JSON.stringify(library.name)} is not a document Library.`);
  }

  const root = (): HsonNode => aggregate.root(library.identity);
  const document_commits = Object.freeze({
    observe: (listener: (observation: LiveMapCommitObservation) => void) => aggregate.observe((aggregateCommit) => {
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
        root: root(),
        continuity: "same-epoch" as const,
      }));
      listener(observation);
    }),
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

  const multi_commit = <TOp extends LiveMapGraphOp>(commit: LiveMapGraphCommit<TOp>): LiveMapMultiLibraryCommit<string, TOp> => {
    const aggregateCommit = aggregate.aggregateCommitForDocument(commit);
    if (aggregateCommit !== undefined) return public_commit(aggregateCommit) as LiveMapMultiLibraryCommit<string, TOp>;
    return Object.freeze({
      kind: "multi-library" as const,
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
    (path, listener) => aggregate.observe((commit) => {
      if (!commit.operations.some((operation) => operation.target.library === library.identity)) return;
      listener(read_livemap_document_logical_location(root(), "document", path));
    }),
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
        replace: (target: LiveMapDocumentRequestTarget, index: number, replacement: LiveMapDocumentContent) => multi_commit(mutation.replaceContent(target, index, replacement)),
        insert: (target: LiveMapDocumentRequestTarget, index: number, content: LiveMapDocumentContent) => multi_commit(mutation.insertContent(target, index, content)),
        remove: (target: LiveMapDocumentRequestTarget, index: number) => multi_commit(mutation.removeContent(target, index)),
        move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => multi_commit(mutation.moveContent(target, from, to)),
      },
    )),
    byQuid: (quid: string) => {
      if (!is_persisted_quid(quid)) return undefined;
      const path = controller.overlay().pathForQuid(quid);
      if (path === undefined) return undefined;
      const node = resolve_document_path(root(), "document", path);
      return is_Node(node) ? clone_node(node) : undefined;
    },
    attrs,
    flags,
  });
  document = documentApi;
  register_livemap_document_identity_api(documentApi, identityApi);
  register_livemap_document_identity_overlay(documentApi, controller.overlay);
  register_livemap_document_identity_authority(documentApi, controller);
  register_livemap_identity_epoch_owner(documentApi, controller.identityEpoch);

  const capture: LiveMapDocumentLibrary["capture"] = (options?: DocumentLiveMapCaptureOptions) => capture_livemap_document(
    controller.identityEpoch,
    "document",
    aggregate.inspect().revision,
    root(),
    options,
  );
  const facade: LiveMapDocumentLibrary = {
    mode: "document" as const,
    get rev() { return aggregate.inspect().revision; },
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
  return Object.freeze(facade);
}

function must_library_input(name: string, value: unknown): LiveMapLibraryInput {
  if (!is_record(value)) {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} must be an input object.`);
  }
  if (typeof value.schema !== "string") {
    throw new TypeError(`LiveMap Library ${JSON.stringify(name)} requires an HsonSchema.`);
  }
  const hasData = Object.hasOwn(value, "data");
  const hasDocument = Object.hasOwn(value, "document");
  if (hasData === hasDocument) {
    throw new TypeError(
      `LiveMap Library ${JSON.stringify(name)} must specify exactly one of data or document.`,
    );
  }
  if (hasData) return value as LiveMapLibraryInput;
  if (typeof value.document === "string" || is_Node(value.document)) return value as LiveMapLibraryInput;
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
