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
import { must_feed_listener, must_json_value, must_live_path, must_set_many_values } from "./guard.js";


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

    /** Exact replacement at a projected path. */
    set: (path, value) => {
      const livePath = must_live_path(path);
      const jsonValue = must_json_value(value, livePath);
      return commit_ops(root, currentSchema, feedHub, [
        { kind: "set", path: livePath, value: jsonValue },
      ]);
    },

    /** Write multiple object properties while preserving unspecified siblings. */
    setMany: (path, values) => {
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      return commit_ops(root, currentSchema, feedHub, write_ops_from_set_many(livePath, jsonValues));
    },

    /** Shallow object write: expand the bag into child sets and preserve unspecified siblings. */
    write: (path, values) => {
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      return commit_ops(root, currentSchema, feedHub, write_ops_from_set_many(livePath, jsonValues));
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
      return commit_ops(root, currentSchema, feedHub, [
        op,
      ]);
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      return commit_ops(root, currentSchema, feedHub, [
        { kind: "delete", path: livePath },
      ]);
    },

    /** Explicit synchronous transaction grouping, not automatic notification coalescing. */
    batch: (fn) => {
      const writeOps: LiveMapWriteOp[] = [];
      let isOpen = true;
      const tx = make_batch_tx(writeOps, () => isOpen);

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
  writeOps: LiveMapWriteOp[],
  isOpen: () => boolean,
): LiveMapBatchTx<JsonValue | undefined> {
  /** The transaction mirrors Core write semantics. */
  const tx: LiveMapBatchTx<JsonValue | undefined> = {
    set: (path, value) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const jsonValue = must_json_value(value, livePath);
      writeOps.push({ kind: "set", path: livePath, value: jsonValue });
      return tx;
    },
    replace: function (pathOrValue: unknown, value?: unknown) {
      must_batch_open(isOpen);
      writeOps.push(replace_write_op_from_args(arguments.length, pathOrValue, value));
      return tx;
    },
    setMany: (path, values) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      writeOps.push(...write_ops_from_set_many(livePath, jsonValues));
      return tx;
    },
    write: (path, values) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      writeOps.push(...write_ops_from_set_many(livePath, jsonValues));
      return tx;
    },
    delete: (path) => {
      must_batch_open(isOpen);
      writeOps.push({ kind: "delete", path: must_live_path(path) });
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
    const nextPart = path[index + 1];

    if (typeof part === "number") {
      if (!Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-array path ${JSON.stringify(path)}`);
      if (cursor[part] === undefined || cursor[part] === null || typeof cursor[part] !== "object") cursor[part] = typeof nextPart === "number" ? [] : {};
      cursor = cursor[part];
      continue;
    }

    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error(`LiveMap schema cannot preview set through non-object path ${JSON.stringify(path)}`);
    if (cursor[part] === undefined || cursor[part] === null || typeof cursor[part] !== "object") cursor[part] = typeof nextPart === "number" ? [] : {};
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


function commit_ops(
  root: HsonNode,
  schema: LiveMapSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  writeOps: readonly LiveMapWriteOp[],
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

function write_ops_from_set_many(path: LivePath, values: LiveMapSetManyValues): readonly LiveMapWriteOp[] {
  /** Build the child-path set ops used by sibling-preserving object writes. */
  return Object.entries(values).map(([key, value]) => ({
    kind: "set" as const,
    path: [...path, key],
    value,
  }));
}

function must_editor_write_ops(root: HsonNode, writeOps: readonly LiveMapWriteOp[]): void {
  /** Validate that the editor can apply the full write set before mutating the live root. */
  apply_write_ops(clone_live_root(root), writeOps);
}

function apply_write_ops(root: HsonNode, writeOps: readonly LiveMapWriteOp[]): LiveMapCommit {
  /** Apply normalized write intents in order and collect the changed public ops. */
  const ops: LiveMapOp[] = [];

  for (const op of writeOps) {
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

function must_core_schema_write_ops(
  schema: LiveMapSchema | undefined,
  root: HsonNode,
  writeOps: readonly LiveMapWriteOp[],
): void {
  if (schema === undefined) return;

  /** Preview all writes against projected JSON, then validate the whole candidate root. */
  let candidate = clone_json_value(snap_live_path(root, []));

  for (const op of writeOps) {
    if (op.kind === "set") {
      set_json_path(candidate, op.path, op.value);
      continue;
    }

    if (op.kind === "replace") {
      if (op.path.length === 0) {
        candidate = clone_json_value(op.value);
      } else {
        set_json_path(candidate, op.path, op.value);
      }
      continue;
    }

    delete_json_path(candidate, op.path);
  }

  must_schema_validation(schema.validateRoot(candidate), write_op_path(writeOps[0]));
}

function write_op_path(op: LiveMapWriteOp | undefined): LivePath {
  if (op === undefined) return [];
  return op.path;
}
