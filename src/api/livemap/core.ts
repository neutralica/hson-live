// livemap-core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LiveMapCoreSchemaApi, LiveMapCoreSnap, LiveMapFeedListener, LiveMapPathValue, LiveMapSetManyValues, LiveMapStoreApi, LiveMapStorePathListener, LiveMapStoreSelectedListener, LiveMapStoreSubscribeOptions, LiveMapSubApi, LivePath, LiveMapWriteOp, LiveMapOp, LiveMapBatchTx } from "./livemap.types.js";
import type { LiveMapSchema, LiveMapSchemaValidation, LiveMapSchemaValue } from "./schema.js";
import { clone_live_root, delete_live_path, replace_live_path, set_live_path, snap_live_path } from "./editor.js";
import { make_livemap_feed_hub } from "./feed.js";
import { make_livemap_node_handle } from "./node.js";
import { make_livemap_path_handle } from "./handle-api.js";
import { make_livemap_proxy } from "./proxy.js";
import { make_livemap_store_api } from "./store.js";
import { format_live_path, is_plain_json_object_value, must_feed_listener, must_json_value, must_live_path, must_set_many_values } from "./guard.js";

type LiveMapConstructiveSetWriteOp = Readonly<{
  kind: "constructive-set";
  path: LivePath;
  value: LiveMapSetManyValues;
}>;

type LiveMapCoreWriteOp = LiveMapWriteOp | LiveMapConstructiveSetWriteOp;


/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root HSON node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that coordinates editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 *
 * `at(path)` is the projected data handle. `node(path)` is the lower-level HSON
 * graph handle used to build and test the machinery underneath later public data
 * APIs. Keep projected JSON behavior in Core/editor/handles, and keep physical
 * node manipulation isolated to the node handle.
 */
export function make_livemap_core(root: HsonNode): LiveMapCore<JsonValue | undefined> {
  const feedHub = make_livemap_feed_hub();
  // This closure-local schema is fine for the first enforcement pass. Revisit
  // once the Core facade grows: schema attachment may want an immutable facade
  // wrapper or shared Core state object instead of mutating closure-local state.
  let currentSchema: LiveMapSchema | undefined;

  let storeApi: LiveMapStoreApi<JsonValue | undefined> | undefined;

  const getStoreApi = (): LiveMapStoreApi<JsonValue | undefined> => {
    return storeApi ??= make_livemap_store_api(core);
  };
  const subBase: LiveMapStoreApi<JsonValue | undefined>["subscribe"] = (listener) => {
    return getStoreApi().subscribe(listener);
  };

  const subDiff: LiveMapStoreApi<JsonValue | undefined>["subscribeDiff"] = (listener) => {
    return getStoreApi().subscribeDiff(listener);
  };

  const subSel: LiveMapStoreApi<JsonValue | undefined>["subscribeSel"] = <TSelected>(
    selector: (state: JsonValue | undefined) => TSelected,
    listener: LiveMapStoreSelectedListener<TSelected, JsonValue | undefined>,
    options?: LiveMapStoreSubscribeOptions<TSelected>,
  ) => {
    return getStoreApi().subscribeSel(selector, listener, options);
  };

  const subPath: LiveMapStoreApi<JsonValue | undefined>["subscribePath"] = <const TPath extends LivePath>(
    path: TPath,
    listener: LiveMapStorePathListener<JsonValue | undefined, TPath>,
    options?: LiveMapStoreSubscribeOptions<LiveMapPathValue<JsonValue | undefined, TPath>>,
  ) => {
    return getStoreApi().subscribePath(path, listener, options);
  };

  const subApi: LiveMapSubApi<JsonValue | undefined> = Object.assign(subBase, {
    diff: subDiff,
    sel: subSel,
    path: subPath,
  });

  const schemaApi: LiveMapCoreSchemaApi<JsonValue | undefined> = Object.assign(
    () => currentSchema,
    {
      get: () => currentSchema,
      use: <TSchema extends LiveMapSchema>(schema: TSchema) => {
        must_core_schema_root(schema, root);
        currentSchema = schema;
        return core as unknown as LiveMapCore<LiveMapSchemaValue<TSchema>>;
      },
    },
  );

  const core: LiveMapCore<JsonValue | undefined> = {
    /** Return the live root node owned by this map core. */
    root: () => root,

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: ((path: LivePath = []) => snap_live_path(root, must_live_path(path))) as LiveMapCoreSnap<JsonValue | undefined>,

    /** Read and manage the schema currently attached to this Core, if present. */
    schema: schemaApi,

    /** Attach a schema to this Core after validating the current projected root. */
    withSchema: (schema) => schemaApi.use(schema),

    /** Create an ergonomic handle scoped to one projected path. */
    at: ((path: LivePath) => make_livemap_path_handle(core, must_live_path(path))) as unknown as LiveMapCore<JsonValue | undefined>["at"],

    /** Create an ergonomic Proxy path-builder scoped to one projected path. */
    proxy: <const TPath extends LivePath = []>(path?: TPath) =>
      make_livemap_proxy<JsonValue | undefined, TPath>(
        core,
        path ?? ([] as unknown as TPath),
      ),

    /** Create a low-level HSON-node-facing handle scoped to one projected path. */
    node: (path) => make_livemap_node_handle(root, must_live_path(path)),

    /** Set a resolved projected path; plain objects expand into shallow child sets. */
    set: (path, value) => {
      const livePath = must_live_path(path);
      return commit_ops(root, currentSchema, feedHub, write_ops_from_set(livePath, value, snap_live_path(root, livePath)));
    },

    /** Set multiple object properties while preserving unspecified siblings. */
    setMany: (path, values) => {
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      return commit_ops(root, currentSchema, feedHub, write_ops_from_set_many(livePath, jsonValues, snap_live_path(root, livePath)));
    },

    /**
     * Exact root or endpoint replacement.
     *
     * `set([])` remains invalid, so root replacement is explicit. The editor
     * overwrites the existing root node in place for root replace so existing
     * handles stay attached to this map.
     */
    replace: function (pathOrValue: unknown, value?: unknown) {
      const op = replace_write_op_from_args(arguments.length, pathOrValue, value);
      must_resolved_path("replace", op.path, snap_live_path(root, op.path));
      return commit_ops(root, currentSchema, feedHub, [
        op,
      ]);
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, snap_live_path(root, livePath));
      return commit_ops(root, currentSchema, feedHub, [
        { kind: "delete", path: livePath },
      ]);
    },

    /** Explicit synchronous transaction grouping, not automatic notification coalescing. */
    batch: (fn) => {
      const writeOps: LiveMapCoreWriteOp[] = [];
      let isOpen = true;
      const tx = make_batch_tx(root, writeOps, () => isOpen);

      try {
        fn(tx);
      } finally {
        isOpen = false;
      }

      return commit_ops(root, currentSchema, feedHub, writeOps);
    },

    /** Subscribe to commits whose op paths overlap the requested path. */
    feed: (path, listener) => feed_core_path(feedHub, must_live_path(path), must_feed_listener(listener)),

    /** Subscribe to projected value changes. */
    sub: subApi,
  };

  return core;
}

/**
 * Register a Core-level feed listener.
 *
 * This small wrapper keeps the public Core method phrased in LiveMap terms
 * while the FeedHub owns the subscription registry and path matching behavior.
 */
function feed_core_path(
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  path: LivePath,
  listener: LiveMapFeedListener,
) {
  return feedHub.add(path, listener);
}

function make_batch_tx(
  root: HsonNode,
  writeOps: LiveMapCoreWriteOp[],
  isOpen: () => boolean,
): LiveMapBatchTx<JsonValue | undefined> {
  /** The transaction mirrors Core mutation semantics. */
  let candidate = clone_json_value(snap_live_path(root, []));

  const pushWriteOps = (ops: readonly LiveMapCoreWriteOp[]) => {
    candidate = apply_json_write_ops(candidate, ops);
    writeOps.push(...ops);
  };

  const tx: LiveMapBatchTx<JsonValue | undefined> = {
    set: (path, value) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      pushWriteOps(write_ops_from_set(livePath, value, snap_json_path(candidate, livePath)));
      return tx;
    },
    replace: function (pathOrValue: unknown, value?: unknown) {
      must_batch_open(isOpen);
      const op = replace_write_op_from_args(arguments.length, pathOrValue, value);
      must_resolved_path("replace", op.path, snap_json_path(candidate, op.path));
      pushWriteOps([op]);
      return tx;
    },
    setMany: (path, values) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      pushWriteOps(write_ops_from_set_many(livePath, jsonValues, snap_json_path(candidate, livePath)));
      return tx;
    },
    delete: (path) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, snap_json_path(candidate, livePath));
      pushWriteOps([{ kind: "delete", path: livePath }]);
      return tx;
    },
  };

  return tx;
}

function must_batch_open(isOpen: () => boolean): void {
  if (isOpen()) return;
  throw new Error("LiveMap batch transaction is already closed");
}

function replace_write_op_from_args(
  argCount: number,
  pathOrValue: unknown,
  value: unknown,
): LiveMapWriteOp {
  if (argCount <= 1) {
    return {
      kind: "replace",
      path: [],
      value: must_json_value(pathOrValue, []),
    };
  }

  const livePath = must_live_path(pathOrValue);

  return {
    kind: "replace",
    path: livePath,
    value: must_json_value(value, livePath),
  };
}


function must_core_schema_root(schema: LiveMapSchema, root: HsonNode): void {
  must_schema_validation(schema.validateRoot(snap_live_path(root, [])), []);
}


function delete_json_path(root: JsonValue, path: LivePath): void {
  if (path.length === 0) return;

  let cursor = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];

    if (typeof part === "number") {
      if (!Array.isArray(cursor)) return;
      cursor = cursor[part];
      if (cursor === undefined) return;
      continue;
    }

    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return;
    cursor = cursor[part];
    if (cursor === undefined) return;
  }

  const leaf = path[path.length - 1];

  if (typeof leaf === "number") {
    if (!Array.isArray(cursor)) return;
    cursor.splice(leaf, 1);
    return;
  }

  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return;
  delete cursor[leaf];
}

function must_schema_validation(validation: LiveMapSchemaValidation, path: LivePath): void {
  if (validation.ok) return;

  throw new Error(format_schema_validation_error(validation, path));
}

function format_schema_validation_error(validation: LiveMapSchemaValidation, path: LivePath): string {
  const issueLines = validation.issues.map((issue) => `- ${issue.message}`);

  return [`LiveMap schema rejected value at ${JSON.stringify(path)}:`, ...issueLines].join("\n");
}

function clone_json_value(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function set_json_path(root: JsonValue, path: LivePath, value: JsonValue): void {
  if (path.length === 0) return;

  let cursor = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];

    if (typeof part === "number") {
      if (!Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-array path ${JSON.stringify(path)}`);
      if (cursor[part] === undefined) throw new Error(`LiveMap schema cannot preview set through missing path ${JSON.stringify(path.slice(0, index + 1))}`);
      cursor = cursor[part];
      continue;
    }

    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-object path ${JSON.stringify(path)}`);
    if (cursor[part] === undefined) throw new Error(`LiveMap schema cannot preview set through missing path ${JSON.stringify(path.slice(0, index + 1))}`);
    cursor = cursor[part];
  }

  const leaf = path[path.length - 1];

  if (typeof leaf === "number") {
    if (!Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-array path ${JSON.stringify(path)}`);
    cursor[leaf] = value;
    return;
  }

  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-object path ${JSON.stringify(path)}`);
  cursor[leaf] = value;
}

function snap_json_path(root: JsonValue, path: LivePath): JsonValue | undefined {
  let cursor: JsonValue | undefined = root;

  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[part];
      continue;
    }

    if (!is_json_object_value(cursor)) return undefined;
    cursor = cursor[part];
  }

  return cursor;
}

function plain_object_from_set_many_values(values: LiveMapSetManyValues): JsonValue {
  const objectValue: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(values)) {
    objectValue[key] = value;
  }

  return objectValue;
}


function commit_ops(
  root: HsonNode,
  schema: LiveMapSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  writeOps: readonly LiveMapCoreWriteOp[],
): LiveMapCommit {
  /**
   * Preflight against a cloned JSON view and cloned editor root before touching
   * the live root. That keeps explicit batches all-or-nothing for schema/editor
   * failures.
   */
  must_core_schema_write_ops(schema, root, writeOps);
  must_editor_write_ops(root, writeOps);
  const commit = apply_write_ops(root, writeOps);
  feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
  return commit;
}

function write_ops_from_set(path: LivePath, value: unknown, currentValue: JsonValue | undefined): readonly LiveMapCoreWriteOp[] {
  const jsonValue = must_json_value(value, path);

  must_resolved_path("set", path, currentValue);

  if (path.length === 0 || !is_plain_json_object_value(jsonValue)) {
    return [
      { kind: "set", path, value: jsonValue },
    ];
  }

  if (currentValue !== undefined && !is_json_object_value(currentValue)) {
    return [
      { kind: "set", path, value: jsonValue },
    ];
  }

  return [
    {
      kind: "constructive-set",
      path,
      value: must_set_many_values(jsonValue, path),
    },
  ];
}

function write_ops_from_set_many(path: LivePath, values: LiveMapSetManyValues, currentValue: JsonValue | undefined): readonly LiveMapWriteOp[] {
  must_resolved_object_path("setMany", path, currentValue);

  /** Build the child-path set ops used by sibling-preserving object sets. */
  return Object.entries(values).map(([key, value]) => ({
    kind: "set" as const,
    path: [...path, key],
    value,
  }));
}

function must_editor_write_ops(root: HsonNode, writeOps: readonly LiveMapCoreWriteOp[]): void {
  /** Validate that the editor can apply the full pending op set before mutating the live root. */
  apply_write_ops(clone_live_root(root), writeOps);
}

function apply_write_ops(root: HsonNode, writeOps: readonly LiveMapCoreWriteOp[]): LiveMapCommit {
  /** Apply normalized pending intents in order and collect the changed public ops. */
  const ops: LiveMapOp[] = [];

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      ops.push(...apply_constructive_set_write_op(root, op));
      continue;
    }

    if (op.kind === "set") {
      const edit = set_live_path(root, op.path, op.value);
      if (!edit.changed) continue;

      ops.push({
        kind: "set",
        path: [...op.path],
        prev: edit.prev,
        next: edit.next,
      });
      continue;
    }

    if (op.kind === "replace") {
      must_resolved_path("replace", op.path, snap_live_path(root, op.path));
      const edit = replace_live_path(root, op.path, op.value);
      if (!edit.changed) continue;

      ops.push({
        kind: "replace",
        path: [...op.path],
        prev: edit.prev,
        next: edit.next,
      });
      continue;
    }

    must_resolved_path("delete", op.path, snap_live_path(root, op.path));
    const edit = delete_live_path(root, op.path);
    if (!edit.changed) continue;

    ops.push({
      kind: "delete",
      path: [...op.path],
      prev: edit.prev,
      next: undefined,
    });
  }

  return {
    changed: ops.length > 0,
    ops,
  };
}

function apply_constructive_set_write_op(root: HsonNode, op: LiveMapConstructiveSetWriteOp): readonly LiveMapOp[] {
  const entries = Object.entries(op.value);
  const currentValue = snap_live_path(root, op.path);

  if (currentValue !== undefined && !is_json_object_value(currentValue)) {
    const edit = set_live_path(root, op.path, plain_object_from_set_many_values(op.value));
    if (!edit.changed) return [];

    return [
      {
        kind: "set",
        path: [...op.path],
        prev: edit.prev,
        next: edit.next,
      },
    ];
  }

  if (currentValue === undefined) {
    throw new Error(`LiveMap set path does not resolve: ${format_live_path(op.path)}`);
  }

  const ops: LiveMapOp[] = [];

  for (const [key, value] of entries) {
    const childPath = [...op.path, key];
    const edit = set_live_path(root, childPath, value);
    if (!edit.changed) continue;

    ops.push({
      kind: "set",
      path: childPath,
      prev: edit.prev,
      next: edit.next,
    });
  }

  return ops;
}

function must_core_schema_write_ops(
  schema: LiveMapSchema | undefined,
  root: HsonNode,
  writeOps: readonly LiveMapCoreWriteOp[],
): void {
  if (schema === undefined) return;

  /** Preview all writes against projected JSON, then validate the whole candidate root. */
  const candidate = apply_json_write_ops(clone_json_value(snap_live_path(root, [])), writeOps);

  must_schema_validation(schema.validateRoot(candidate), write_op_path(writeOps[0]));
}

function apply_json_write_ops(root: JsonValue, writeOps: readonly LiveMapCoreWriteOp[]): JsonValue {
  let candidate = root;

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      apply_json_constructive_set(candidate, op);
      continue;
    }

    if (op.kind === "set") {
      set_json_path(candidate, op.path, clone_json_value(op.value));
      continue;
    }

    if (op.kind === "replace") {
      if (op.path.length === 0) {
        candidate = clone_json_value(op.value);
      } else {
        must_resolved_path("replace", op.path, snap_json_path(candidate, op.path));
        set_json_path(candidate, op.path, clone_json_value(op.value));
      }
      continue;
    }

    must_resolved_path("delete", op.path, snap_json_path(candidate, op.path));
    delete_json_path(candidate, op.path);
  }

  return candidate;
}

function apply_json_constructive_set(root: JsonValue, op: LiveMapConstructiveSetWriteOp): void {
  const entries = Object.entries(op.value);
  const currentValue = snap_json_path(root, op.path);

  if (currentValue !== undefined && !is_json_object_value(currentValue)) {
    set_json_path(root, op.path, clone_json_value(plain_object_from_set_many_values(op.value)));
    return;
  }

  if (currentValue === undefined) {
    throw new Error(`LiveMap set path does not resolve: ${format_live_path(op.path)}`);
  }

  for (const [key, value] of entries) {
    set_json_path(root, [...op.path, key], clone_json_value(value));
  }
}

function is_json_object_value(value: JsonValue | undefined): value is LiveMapSetManyValues {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function must_resolved_path(action: "delete" | "replace" | "set", path: LivePath, value: JsonValue | undefined): void {
  if (path.length === 0 || value !== undefined) return;

  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

function must_resolved_object_path(action: "setMany", path: LivePath, value: JsonValue | undefined): void {
  if (value === undefined) {
    throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
  }

  if (is_json_object_value(value)) return;

  throw new Error(`LiveMap ${action} path is not an object: ${format_live_path(path)}`);
}

function write_op_path(op: LiveMapCoreWriteOp | undefined): LivePath {
  if (op === undefined) return [];
  return op.path;
}
