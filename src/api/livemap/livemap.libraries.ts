import { clone_node } from "../../core/clone-node.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import type {
  LiveMapDataLibrary,
  LiveMapDocumentLibrary,
  LiveMapLibraries,
  LiveMapLibrariesInput,
  LiveMapLibraryInput,
  LiveMapLibraryOperation,
  LiveMapLibraryPathHandle,
  LiveMapDataOp,
  LiveMapMultiLibraryCommit,
  LivePath,
} from "../../types/livemap.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { clone_live_path } from "./livemap.path.js";
import { must_json_value, must_live_path } from "./livemap.guard.js";
import { internal_livemap_aggregate_authority } from "./livemap.internal.js";
import type { LiveMapAggregateCommit, LiveMapLibraryIdentity } from "./livemap.library.js";
import { make_classified_livemap } from "./livemap.core.js";

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
    const library = named.get(name);
    if (library === undefined) throw new Error(`Unknown LiveMap Library ${JSON.stringify(name)}.`);
    return "data" in library.input
      ? make_data_library(library, aggregate, public_commit)
      : make_document_library(library, aggregate);
  };

  const libraries = Object.freeze({
    get rev() { return aggregate.inspect().revision; },
    lib: (name: string) => selected(name),
    commits: Object.freeze({
      observe: (listener: (commit: LiveMapMultiLibraryCommit) => void) =>
        aggregate.observe((commit) => listener(public_commit(commit))),
    }),
  });
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
): LiveMapDocumentLibrary {
  const facade: LiveMapDocumentLibrary = {
    mode: "document" as const,
    get rev() { return aggregate.inspect().revision; },
    root: () => clone_node(aggregate.root(library.identity)),
    schema: Object.freeze({ get: () => library.input.schema }),
  };
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
