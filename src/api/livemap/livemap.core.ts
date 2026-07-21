// core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap, LiveMapAnyOp, LiveMapCommit, LiveMapReplay, LiveMapCore, LiveMapCoreSchemaApi, LiveMapCoreSnap, LiveMapFeedListener, LiveMapPathValue, LiveMapSetManyValues, LiveMapStoreApi, LiveMapStorePathListener, LiveMapStoreSelectedListener, LiveMapStoreSubscribeOptions, LiveMapSubApi, LivePath, LiveMapWriteOp, LiveMapDataOp, LiveMapBatchTx, LiveMapPathHandle, LiveMapSpliceOp, LiveMapSpliceWriteOp, LiveMapCapture, LiveMapApply, LiveMapGraphCommit, LiveMapGraphOp, LiveMapGraphReplaceRootOp } from "../../types/livemap.types.js";
import type { LiveMapSchema, LiveMapSchemaResolution, LiveMapSchemaValidation, LiveMapSchemaValue } from "./livemap.schema.js";
import { clone_live_root, delete_live_path, overwrite_hson_node, replace_live_path, set_live_path, snap_live_path } from "./livemap.editor.js";
import { make_livemap_feed_hub } from "./livemap.feed.js";
import { make_livemap_commit_observer_hub } from "./livemap.commit-observer.js";
import { make_livemap_node_handle } from "./livemap.node.js";
import { make_livemap_path_handle } from "./livemap.handle.js";
import { make_livemap_proxy } from "./livemap.proxy.js";
import { make_livemap_store_api } from "./livemap.store.js";
import { is_plain_json_object_value, must_feed_listener, must_json_value, must_live_path, must_set_many_values, path_kind_error } from "./livemap.guard.js";
import { append_live_path, clone_live_path, format_live_path, live_path_key } from "./livemap.path.js";
import { LiveMapReplayError, LiveMapRevError, LiveMapSchemaError, } from "./livemap.error.js";
import { json_values_equal } from "./livemap-helpers.js";
import { must_livemap_replay, replay_write_op } from "./livemap.replay.js";
import { classify_live_root_mode, facade_for_livemap_root, prepare_livemap_root } from "./livemap.document.js";
import { canonical_graph_equal, type LiveMapDocumentInstallController, type PreparedDocumentInstall } from "./livemap.document.install.js";
import type { LiveMapDocumentMutationController, PreparedDocumentMutation } from "./livemap.document.mutation.js";
import type { LiveMapDocumentReplayController, PreparedDocumentReplay } from "./livemap.document.replay.js";
import {
  LiveMapTransitionError,
  make_livemap_transition_controller,
  register_livemap_staged_authority,
  type LiveMapTransitionController,
  type PreparedLiveMapTransition,
} from "./livemap.authority.js";

type LiveMapConstructiveSetWriteOp = Readonly<{
  kind: "constructive-set";
  path: LivePath;
  value: LiveMapSetManyValues;
}>;

type LiveMapCoreWriteOp = LiveMapWriteOp | LiveMapConstructiveSetWriteOp;

type BuiltLiveMapCore = Readonly<{
  core: LiveMapCore<JsonValue | undefined>;
  document?: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController;
  transitionController: LiveMapTransitionController;
  currentRoot: () => HsonNode;
  currentSchema: () => LiveMapSchema | undefined;
  detachUnsafeReferences: () => void;
  prepareDetachedCommit: (
    commit: LiveMapCommit<LiveMapAnyOp>,
    nextRoot: HsonNode,
  ) => PreparedLiveMapTransition;
}>;



/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root HSON node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that coordinates editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 *
 * `at(path)` is the projected data handle. `root()` returns a detached canonical
 * clone. `debug.node(path)` is the explicitly unsafe live HSON graph handle for
 * physical node inspection and mutation.
 *
 * Mutation contract:
 * - `set(path, value)` requires the addressed path to resolve. Plain object
 *   values expand into shallow child writes when the current endpoint is an
 *   object, so unspecified siblings are preserved.
 * - `setMany(path, values)` requires `path` to resolve to an object and writes
 *   the supplied child keys under that object.
 * - `replace(path?, value)` destructively replaces the root or endpoint.
 * - `delete(path)` is strict and requires the addressed path to resolve.
 *
 * Schema validation previews the full candidate root before editor mutation, so
 * schema/editor failures leave the live graph unchanged.
 */
export function make_livemap_core(input: HsonNode): LiveMapCore<JsonValue | undefined> {
  const prepared = prepare_livemap_root(input);
  const built = make_livemap_core_from_owned_root(prepared);
  register_staged_facade(built.core, built);
  return built.core;
}

/** Construct the public shape-specific façade after detached root ownership. */
export function make_classified_livemap(input: HsonNode): ClassifiedLiveMap {
  const prepared = prepare_livemap_root(input);
  const built = make_livemap_core_from_owned_root(prepared);
  const facade = facade_for_livemap_root(built.core, prepared, built.document);
  register_staged_facade(facade, built);
  return facade;
}

/** Build the shared Core around a root already cloned, validated, and indexed. */
function make_livemap_core_from_owned_root(
  prepared: ReturnType<typeof prepare_livemap_root>,
  initial: Readonly<{ revision?: number; schema?: LiveMapSchema }> = {},
): BuiltLiveMapCore {
  const initialMode = prepared.mode;
  let owned = {
    root: prepared.root,
    documentIdentity: prepared.documentIdentity,
  };
  const feedHub = make_livemap_feed_hub();
  const commitObserverHub = make_livemap_commit_observer_hub<LiveMapAnyOp>();
  // This closure-local schema is fine for the first enforcement pass. Revisit
  // once the Core facade grows: schema attachment may want an immutable facade
  // wrapper or shared Core state object instead of mutating closure-local state.
  let currentSchema: LiveMapSchema | undefined = initial.schema;
  /** Revision zero represents the initial graph before any changed commit. */
  let currentRev = initial.revision ?? 0;
  const transitionController = make_livemap_transition_controller(initialMode, () => currentRev);

  function prepareDetachedCommit(
    commit: LiveMapCommit<LiveMapAnyOp>,
    detachedRoot: HsonNode,
  ): PreparedLiveMapTransition {
    const preparedNext = prepare_livemap_root(detachedRoot);
    if (preparedNext.mode !== initialMode) {
      throw new Error(`Prepared LiveMap transition mode mismatch: expected ${initialMode}, observed ${preparedNext.mode}.`);
    }
    const baseRoot = clone_live_root(owned.root);
    return transitionController.prepare({
      commit,
      baseStillCurrent: () => canonical_graph_equal(owned.root, baseRoot),
      install: () => {
        if (initialMode === "element" || initialMode === "fragment") {
          owned = { root: preparedNext.root, documentIdentity: preparedNext.documentIdentity };
        } else {
          overwrite_hson_node(owned.root, preparedNext.root);
        }
        currentRev = commit.rev;
      },
      notify: (acceptedCommit) => {
        if (initialMode === "element" || initialMode === "fragment") {
          commitObserverHub.emitCommit(acceptedCommit, "authoritative");
        } else {
          feedHub.emit(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (path) => snap_live_path(owned.root, path));
          commitObserverHub.emitCommit(acceptedCommit, "authoritative");
        }
      },
    });
  }

  function detachUnsafeReferences(): void {
    const detached = prepare_livemap_root(owned.root);
    owned = { root: detached.root, documentIdentity: detached.documentIdentity };
    transitionController.invalidate();
  }
  let storeApi: LiveMapStoreApi<JsonValue | undefined> | undefined;
  const commitOps = (
    writeOps: readonly LiveMapCoreWriteOp[],
    origin: "authoritative" | "replay" = "authoritative",
  ): LiveMapCommit => {
    transitionController.assertPublicMutationAllowed();
    if (origin === "replay") {
      transitionController.invalidate();
      return apply_replay_ops(
        owned.root,
        currentSchema,
        feedHub,
        () => currentRev,
        (rev) => { currentRev = rev; },
        writeOps,
        commitObserverHub,
      );
    }
    const transition = prepare_projected_transition(
      owned.root,
      currentSchema,
      feedHub,
      () => currentRev,
      (rev) => { currentRev = rev; },
      writeOps,
      commitObserverHub,
      transitionController,
    );
    return transitionController.accept(transition, "legacy").commit as LiveMapCommit;
  };

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

  const schemaApi: LiveMapCoreSchemaApi<JsonValue | undefined> = Object.freeze({
    get: () => currentSchema,

    use: <TSchema extends LiveMapSchema>(schema: TSchema) => {
      transitionController.assertPublicMutationAllowed();
      must_core_schema_root(schema, owned.root);
      currentSchema = schema;
      transitionController.invalidate();

      return core as unknown as LiveMap<LiveMapSchemaValue<TSchema>>;
    },

    // CHANGED: attached-schema inspection delegates to the schema's single
    // authoritative matcher and resolver rather than reimplementing them.
    match: (path: LivePath) => {
      return currentSchema?.match(must_live_path(path));
    },

    resolve: (path: LivePath) => {
      return currentSchema?.resolve(must_live_path(path));
    },

    has: (path: LivePath) => {
      return currentSchema?.has(must_live_path(path)) ?? false;
    },

    must: Object.freeze({
      resolve: (path: LivePath): LiveMapSchemaResolution => {
        const schema = currentSchema;

        if (schema === undefined) {
          throw new Error("LiveMap has no schema attached");
        }

        return schema.must.resolve(must_live_path(path));
      },
    }),
  });

  const debugApi = Object.freeze({
    node: (path: LivePath) => {
      transitionController.assertPublicMutationAllowed();
      return make_livemap_node_handle(
        owned.root,
        must_live_path(path),
        transitionController.invalidate,
        transitionController.assertPublicMutationAllowed,
      );
    },
  });

  const core: LiveMapCore<JsonValue | undefined> = {
    /** Root capability selected during detached canonical construction. */
    mode: initialMode,
    /** Return a detached structural clone of the root owned by this map core. */
    root: () => clone_live_root(owned.root),

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: ((path: LivePath = []) => snap_live_path(owned.root, must_live_path(path))) as LiveMapCoreSnap<JsonValue | undefined>,

    /** Read and manage the schema currently attached to this Core, if present. */
    schema: schemaApi,

    // schemaApi.use(schema)
    // withSchema(schema)123 
    // TODO: remove/force to schema.use 
    /** Attach a schema to this Core after validating the current projected root. */
    withSchema: (schema) => schemaApi.use(schema),

    /** Create an ergonomic handle scoped to one projected path. */
    at: ((path: LivePath) => get_path_handle(path)) as unknown as LiveMapCore<JsonValue | undefined>["at"],

    /** Create an ergonomic Proxy path-builder scoped to one projected path. */
    proxy: <const TPath extends LivePath = []>(path?: TPath) =>
      make_livemap_proxy<JsonValue | undefined, TPath>(
        core,
        path ?? ([] as unknown as TPath),
      ),

    /** Explicitly unsafe access to live HSON-node-facing handles. */
    debug: debugApi,

    /** Set a resolved projected path; plain objects expand into shallow child sets. */
    set: (path, value) => {
      const livePath = must_live_path(path);
      return commitOps(
        write_ops_from_set(
          livePath,
          value,
          snap_live_path(owned.root, livePath),
        ),
      );
    },

    /** Set multiple object properties while preserving unspecified siblings. */
    setMany: (path, values) => {
      const livePath = must_live_path(path);
      const jsonValues = must_set_many_values(values, livePath);
      return commitOps(
        write_ops_from_set_many(
          livePath,
          jsonValues,
          snap_live_path(owned.root, livePath),
        ),
      );
    },

    /** Apply one semantic array splice and preserve it in the resulting commit. */
    splice: (path, start, deleteCount, ...items) => {
      const livePath = must_live_path(path);
      const currentValue = snap_live_path(owned.root, livePath);
      const op = splice_write_op(livePath, currentValue, start, deleteCount, items);
      return commitOps([op]);
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
      must_resolved_path("replace", op.path, snap_live_path(owned.root, op.path));
      return commitOps([op]);
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, snap_live_path(owned.root, livePath));
      return commitOps([
        { kind: "delete", path: livePath },
      ]);
    },

    /** Explicit synchronous transaction grouping, not automatic notification coalescing. */
    batch: (fn) => {
      transitionController.assertPublicMutationAllowed();
      const writeOps: LiveMapCoreWriteOp[] = [];
      let isOpen = true;
      const tx = make_batch_tx(owned.root, writeOps, () => isOpen);

      try {
        fn(tx);
      } finally {
        isOpen = false;
      }
      return commitOps(writeOps);
    },

    /** Subscribe to commits whose op paths overlap the requested path. */
    feed: (path, listener) => feed_core_path(feedHub, must_live_path(path), must_feed_listener(listener)),

    commits: Object.freeze({ observe: commitObserverHub.observe }),

    /** Subscribe to projected value changes. */
    sub: subApi,

    get rev() {
      return currentRev;
    },
    /** Capture the current projected root together with its committed revision. */
    capture: (): LiveMapCapture<JsonValue | undefined> => {
      return Object.freeze({
        rev: currentRev,
        value: snap_live_path(owned.root, []),
      });
    },
    /** Restore projected state and revision without a commit, feed, or increment. */
    restore: (capture: LiveMapCapture<JsonValue | undefined>): void => {
      transitionController.assertPublicMutationAllowed();
      const normalized = must_projected_capture(capture);
      const operation: LiveMapWriteOp = {
        kind: "replace",
        path: [],
        value: normalized.value,
      };
      must_core_schema_write_ops(currentSchema, owned.root, [operation]);
      must_editor_write_ops(owned.root, [operation]);
      const candidate = clone_live_root(owned.root);
      apply_write_ops(candidate, [operation]);
      const observedMode = classify_live_root_mode(candidate);
      if (observedMode !== initialMode) {
        throw new Error(`LiveMap projected restore mode mismatch: expected ${initialMode}, observed ${observedMode}.`);
      }
      owned = { root: candidate, documentIdentity: undefined };
      currentRev = normalized.rev;
      transitionController.invalidate();
      commitObserverHub.emitSnapshot(normalized.rev);
    },
    /** Replace the root only when the caller's base revision is still current. */
    apply: (input: LiveMapApply<JsonValue | undefined>) => {
      must_expected_rev(
        input.prevRev,
        currentRev,
      );

      return commitOps([
        {
          kind: "replace",
          path: [],
          value: must_json_value(
            input.value,
            [],
          ),
        },
      ]);
    },
    /** Replay semantic ops only when their base revision and prior values match. */
    replay: (input: LiveMapReplay) => {
      transitionController.assertPublicMutationAllowed();
      const replay = must_livemap_replay(input);
      must_expected_rev(
        replay.prevRev,
        currentRev,
      );

      return commitOps(
        replay_write_ops(
          owned.root,
          replay.ops,
        ),
        "replay",
      );
    },


  };

  const pathHandleCache = new Map<string, LiveMapPathHandle>();


  function get_path_handle(path: LivePath): LiveMapPathHandle {
    const handlePath = must_live_path(path);
    const key = live_path_key(handlePath);
    const existing = pathHandleCache.get(key);
    if (existing) return existing;

    const handle = make_livemap_path_handle(core, handlePath);
    pathHandleCache.set(key, handle);
    return handle;
  }

  if (initialMode !== "element" && initialMode !== "fragment") {
    return {
      core,
      transitionController,
      currentRoot: () => owned.root,
      currentSchema: () => currentSchema,
      detachUnsafeReferences,
      prepareDetachedCommit,
    };
  }

  const document: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController = {
    mode: initialMode,
    rev: () => currentRev,
    root: () => owned.root,
    identity: () => {
      const identity = owned.documentIdentity;
      if (identity === undefined) {
        throw new Error(`LiveMap document mode ${initialMode} has no identity index.`);
      }
      return identity;
    },
    commits: Object.freeze({ observe: commitObserverHub.observe }),
    apply: (candidate: PreparedDocumentInstall): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> => {
      transitionController.assertPublicMutationAllowed();
      const prevRev = currentRev;
      const unchanged = canonical_graph_equal(owned.root, candidate.root);
      const commit: LiveMapGraphCommit<LiveMapGraphReplaceRootOp> = unchanged
        ? Object.freeze({ changed: false, prevRev, rev: prevRev, ops: Object.freeze([]) })
        : Object.freeze({
          changed: true,
          prevRev,
          rev: prevRev + 1,
          ops: Object.freeze([Object.freeze({
            domain: "graph",
            op: "replace-root",
            mode: candidate.mode,
            root: clone_live_root(candidate.root),
          })]),
        });
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          owned = { root: candidate.root, documentIdentity: candidate.identity };
          currentRev = commit.rev;
        },
        (acceptedCommit) => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
    },
    restore: (candidate: PreparedDocumentInstall, revision: number): void => {
      transitionController.assertPublicMutationAllowed();
      owned = {
        root: candidate.root,
        documentIdentity: candidate.identity,
      };
      currentRev = revision;
      transitionController.invalidate();
      commitObserverHub.emitSnapshot(revision);
    },
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: PreparedDocumentMutation<TOp>): LiveMapGraphCommit<TOp> => {
      transitionController.assertPublicMutationAllowed();
      const prevRev = currentRev;
      const unchanged = canonical_graph_equal(owned.root, candidate.root);
      const rev = unchanged ? prevRev : prevRev + 1;
      const commit: LiveMapGraphCommit<TOp> = unchanged
        ? Object.freeze({ changed: false, prevRev, rev, ops: Object.freeze([]) })
        : Object.freeze({
          changed: true,
          prevRev,
          rev,
          ops: Object.freeze([candidate.operation]),
        });
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          owned = { root: candidate.root, documentIdentity: candidate.identity };
          currentRev = rev;
        },
        (acceptedCommit) => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<TOp>;
    },
    applyReplay: (candidate: PreparedDocumentReplay): LiveMapGraphCommit => {
      transitionController.assertPublicMutationAllowed();
      owned = {
        root: candidate.root,
        documentIdentity: candidate.identity,
      };
      currentRev = candidate.commit.rev;
      transitionController.invalidate();
      commitObserverHub.emitCommit(candidate.commit, "replay");
      return candidate.commit;
    },
  };

  return {
    core,
    document,
    transitionController,
    currentRoot: () => owned.root,
    currentSchema: () => currentSchema,
    detachUnsafeReferences,
    prepareDetachedCommit,
  };
}

/** Register the internal callback-based staging seam on one completed façade. */
function register_staged_facade<TMap extends object>(map: TMap, built: BuiltLiveMapCore): void {
  register_livemap_staged_authority(map, Object.freeze({
    prepare(mutation): PreparedLiveMapTransition {
      const preparedDraft = prepare_livemap_root(built.currentRoot());
      const draftBuilt = make_livemap_core_from_owned_root(preparedDraft, {
        revision: built.core.rev,
        ...(built.currentSchema() !== undefined ? { schema: built.currentSchema() } : {}),
      });
      const draft = facade_for_livemap_root(draftBuilt.core, preparedDraft, draftBuilt.document);
      const observations: Array<Readonly<{
        commit: LiveMapCommit<LiveMapAnyOp>;
        origin: "authoritative" | "replay";
      }>> = [];
      draft.commits.observe((event) => {
        if (event.kind === "commit") observations.push({ commit: event.commit, origin: event.origin });
        else observations.push({
          commit: Object.freeze({ changed: false, prevRev: event.revision, rev: event.revision, ops: Object.freeze([]) }),
          origin: "replay",
        });
      });

      const ephemeral = make_ephemeral_staged_draft(draft as TMap);
      let result: unknown;
      try {
        result = mutation(ephemeral.draft);
      } finally {
        ephemeral.expire();
      }
      if (is_promise_like(result)) {
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Staged LiveMap mutation callback must be synchronous.",
        );
      }
      if (!is_livemap_commit(result)) {
        throw new Error("Staged LiveMap mutation must return its LiveMap commit.");
      }
      if (result.changed) {
        const observation = observations[0];
        if (observations.length !== 1
          || observation === undefined
          || observation.origin !== "authoritative"
          || observation.commit !== result) {
          throw new Error("Staged LiveMap mutation must produce exactly one authoritative commit.");
        }
      } else if (observations.length !== 0
        || !canonical_graph_equal(preparedDraft.root, draftBuilt.currentRoot())) {
        throw new Error("Staged LiveMap no-op mutation changed detached authority state.");
      }

      return built.prepareDetachedCommit(result, draftBuilt.currentRoot());
    },
    accept: built.transitionController.accept,
    discard: built.transitionController.discard,
    claimManagement(owner, schedule): void {
      built.transitionController.claimManagement(
        owner,
        schedule as unknown as (mutation: (draft: object) => LiveMapCommit<LiveMapAnyOp>) => Promise<LiveMapCommit<LiveMapAnyOp>>,
      );
      try {
        built.detachUnsafeReferences();
      } catch (cause) {
        built.transitionController.releaseManagement(owner);
        throw cause;
      }
    },
    releaseManagement: built.transitionController.releaseManagement,
    scheduleManaged: (mutation) => built.transitionController.scheduleManaged(
      mutation as (draft: object) => LiveMapCommit<LiveMapAnyOp>,
    ),
  }));
}

const STAGED_DRAFT_UNAVAILABLE_PROPERTIES = new Set<PropertyKey>([
  "commits",
  "debug",
  "feed",
  "linkTo",
  "replay",
  "restore",
  "schema",
  "sub",
  "withSchema",
]);

/** Restrict and expire the detached callback façade without exposing candidate state. */
function make_ephemeral_staged_draft<TMap extends object>(value: TMap): Readonly<{
  draft: TMap;
  expire: () => void;
}> {
  const proxies = new WeakMap<object, object>();
  let active = true;

  const wrap = <TValue extends object>(target: TValue): TValue => {
    const existing = proxies.get(target);
    if (existing !== undefined) return existing as TValue;
    const proxyTarget = typeof target === "function" ? function () {} : Object.create(null) as object;
    const proxy = new Proxy(proxyTarget, {
      has(_current, property) {
        return Reflect.has(target, property);
      },
      get(_current, property) {
        if (STAGED_DRAFT_UNAVAILABLE_PROPERTIES.has(property)) {
          throw new LiveMapTransitionError(
            "LIVEMAP_TRANSITION_INVALID",
            "Operation is unavailable on a staged LiveMap draft.",
          );
        }
        const member = Reflect.get(target, property, target) as unknown;
        return (typeof member === "object" && member !== null) || typeof member === "function"
          ? wrap(member as object)
          : member;
      },
      set() {
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Staged LiveMap draft properties cannot be assigned directly.",
        );
      },
      apply(_current, thisArgument, argumentsList) {
        if (!active) {
          throw new LiveMapTransitionError(
            "LIVEMAP_TRANSITION_INVALID",
            "Staged LiveMap draft is expired.",
          );
        }
        return Reflect.apply(target as (...args: unknown[]) => unknown, thisArgument, argumentsList);
      },
    }) as TValue;
    proxies.set(target, proxy);
    return proxy;
  };

  return Object.freeze({
    draft: wrap(value),
    expire(): void { active = false; },
  });
}

function is_promise_like(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function";
}

function is_livemap_commit(value: unknown): value is LiveMapCommit<LiveMapAnyOp> {
  return typeof value === "object"
    && value !== null
    && "changed" in value
    && typeof value.changed === "boolean"
    && "prevRev" in value
    && typeof value.prevRev === "number"
    && "rev" in value
    && typeof value.rev === "number"
    && "ops" in value
    && Array.isArray(value.ops);
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

/**
 * Build the transaction facade used by `core.batch(...)`.
 *
 * The transaction keeps a cloned JSON candidate so each later operation sees
 * earlier staged writes for path resolution and object expansion. The live root
 * is not mutated until the collected write ops pass schema and editor preflight.
 */
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
    splice: (path, start, deleteCount, ...items) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const op = splice_write_op(livePath, snap_json_path(candidate, livePath), start, deleteCount, items);
      pushWriteOps([op]);
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

function must_expected_rev(
  expectedRev: number,
  actualRev: number,
): void {
  if (
    !Number.isInteger(expectedRev)
    || expectedRev < 0
  ) {
    throw new Error(
      `LiveMap expected revision is not valid: ${String(expectedRev)}`,
    );
  }

  if (expectedRev === actualRev) return;

  throw new LiveMapRevError(
    expectedRev,
    actualRev,
  );
}

function replay_write_ops(
  root: HsonNode,
  ops: readonly LiveMapDataOp[],
): readonly LiveMapCoreWriteOp[] {
  let candidate = clone_json_value(
    snap_live_path(root, []),
  );

  const writeOps: LiveMapCoreWriteOp[] = [];

  for (const op of ops) {
    const currentValue = snap_json_path(
      candidate,
      op.path,
    );

    must_replay_value(
      op.path,
      op.prev,
      currentValue,
    );

    const writeOp = replay_write_op(op);

    candidate = apply_json_write_ops(
      candidate,
      [writeOp],
    );

    const nextValue = snap_json_path(
      candidate,
      op.path,
    );

    must_replay_value(
      op.path,
      op.next,
      nextValue,
    );

    writeOps.push(writeOp);
  }

  return writeOps;
}

function must_projected_capture(input: unknown): Readonly<{ rev: number; value: JsonValue }> {
  if (!is_plain_unknown_record(input)) {
    throw new TypeError("LiveMap projected restore capture must be an object.");
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("rev") || !keys.includes("value")) {
    throw new TypeError("LiveMap projected restore capture contains missing or unknown fields.");
  }
  if (typeof input.rev !== "number" || !Number.isInteger(input.rev) || input.rev < 0) {
    throw new TypeError("LiveMap projected restore revision must be a non-negative integer.");
  }
  return Object.freeze({
    rev: input.rev,
    value: must_json_value(input.value, []),
  });
}

function is_plain_unknown_record(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function must_replay_value(
  path: LivePath,
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
): void {
  if (
    json_values_equal(
      expected,
      actual,
    )
  ) {
    return;
  }

  throw new LiveMapReplayError(
    path,
    expected,
    actual,
  );
}

/** Normalize overloaded root/endpoint replace calls into one write intent. */
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

/** Normalize one public array splice into a transport-safe write intent. */
function splice_write_op(path: LivePath, currentValue: JsonValue | undefined, start: number, deleteCount: number, items: readonly unknown[]): LiveMapSpliceWriteOp {
  const arrayValue = must_core_array_value(currentValue, path);
  const normalizedStart = normalize_splice_start(arrayValue.length, start, path);
  const normalizedDeleteCount = normalize_splice_delete_count(arrayValue.length, normalizedStart, deleteCount, path);
  const jsonItems = items.map((item, index) => must_json_value(item, append_live_path(path, normalizedStart + index)));
  return Object.freeze({ kind: "splice", path: clone_live_path(path), start: normalizedStart, deleteCount: normalizedDeleteCount, items: Object.freeze(jsonItems) });
}

function must_core_array_value(value: JsonValue | undefined, path: LivePath): readonly JsonValue[] {
  if (!Array.isArray(value)) throw path_kind_error(path, "array");
  return value;
}

function normalize_splice_start(length: number, start: number, path: LivePath): number {
  if (!Number.isInteger(start)) throw new Error(`LiveMap array splice start is not a valid index at ${JSON.stringify(path)}: ${String(start)}`);
  if (start < 0) return Math.max(length + start, 0);
  return Math.min(start, length);
}

function normalize_splice_delete_count(length: number, start: number, deleteCount: number, path: LivePath): number {
  if (!Number.isInteger(deleteCount) || deleteCount < 0) throw new Error(`LiveMap array splice deleteCount is not valid at ${JSON.stringify(path)}: ${String(deleteCount)}`);
  return Math.min(deleteCount, length - start);
}


/** Validate the current root before attaching a schema-bound map view. */
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

function must_schema_validation(
  validation: LiveMapSchemaValidation,
  path: LivePath,
  headlineMode: "path" | "issue" = "path",
): void {
  if (validation.ok) return;

  const headlinePath = headlineMode === "issue"
    ? validation_headline_path(validation, path)
    : path;

  throw new LiveMapSchemaError(
    format_schema_validation_error(validation, headlinePath),
    headlinePath,
    validation.issues,
  );
}

function format_schema_validation_error(validation: LiveMapSchemaValidation, path: LivePath): string {
  const issueLines = validation.issues.map((issue) => `- ${issue.message}`);

  return [`LiveMap schema rejected value at ${JSON.stringify(path)}:`, ...issueLines].join("\n");
}

function validation_headline_path(validation: LiveMapSchemaValidation, fallbackPath: LivePath): LivePath {
  return validation.issues[0]?.path ?? fallbackPath;
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


/** Prepare one exact projected transition entirely against detached state. */
function prepare_projected_transition(
  root: HsonNode,
  schema: LiveMapSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  getRev: () => number,
  setRev: (rev: number) => void,
  writeOps: readonly LiveMapCoreWriteOp[],
  commitObserverHub: ReturnType<typeof make_livemap_commit_observer_hub<LiveMapAnyOp>>,
  transitionController: LiveMapTransitionController,
): PreparedLiveMapTransition {
  must_core_schema_write_ops(schema, root, writeOps);
  const baseRoot = clone_live_root(root);
  const nextRoot = clone_live_root(root);
  const applied = apply_write_ops(nextRoot, writeOps);
  const prevRev = getRev();
  const rev = applied.changed
    ? prevRev + 1
    : prevRev;
  const commit: LiveMapCommit = Object.freeze({
    changed: applied.changed,
    prevRev,
    rev,
    ops: applied.ops,
  });
  return transitionController.prepare({
    commit,
    baseStillCurrent: () => canonical_graph_equal(root, baseRoot),
    install: () => {
      overwrite_hson_node(root, nextRoot);
      setRev(rev);
    },
    notify: (acceptedCommit) => {
      feedHub.emit(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (feedPath) => snap_live_path(root, feedPath));
      commitObserverHub.emitCommit(acceptedCommit, "authoritative");
    },
  });
}

/** Privileged historical replay retains its exact existing notification semantics. */
function apply_replay_ops(
  root: HsonNode,
  schema: LiveMapSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  getRev: () => number,
  setRev: (rev: number) => void,
  writeOps: readonly LiveMapCoreWriteOp[],
  commitObserverHub: ReturnType<typeof make_livemap_commit_observer_hub<LiveMapAnyOp>>,
): LiveMapCommit {
  must_core_schema_write_ops(schema, root, writeOps);
  must_editor_write_ops(root, writeOps);
  const applied = apply_write_ops(root, writeOps);
  const prevRev = getRev();
  const rev = applied.changed ? prevRev + 1 : prevRev;
  if (applied.changed) setRev(rev);
  const commit: LiveMapCommit = Object.freeze({ changed: applied.changed, prevRev, rev, ops: applied.ops });
  feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
  commitObserverHub.emitCommit(commit, "replay");
  return commit;
}

function prepare_document_transition(
  currentRoot: HsonNode,
  commit: LiveMapCommit<LiveMapGraphOp>,
  transitionController: LiveMapTransitionController,
  install: () => void,
  notify: (commit: LiveMapCommit<LiveMapAnyOp>) => void,
): PreparedLiveMapTransition {
  const baseRoot = clone_live_root(currentRoot);
  return transitionController.prepare({
    commit,
    baseStillCurrent: () => canonical_graph_equal(currentRoot, baseRoot),
    install,
    notify,
  });
}

/**
 * Normalize public `set` into internal write intents.
 *
 * Plain object values at an existing object endpoint become constructive child
 * writes. Other JSON values, arrays, null, root values, and non-object current
 * endpoints stay as direct endpoint `set` writes.
 */
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

/** Normalize public `setMany` into child-path set writes. */
function write_ops_from_set_many(path: LivePath, values: LiveMapSetManyValues, currentValue: JsonValue | undefined): readonly LiveMapWriteOp[] {
  must_resolved_object_path("setMany", path, currentValue);

  /** Build the child-path set ops used by sibling-preserving object sets. */
  return Object.entries(values).map(([key, value]) => ({
    kind: "set" as const,
    path: append_live_path(path, key),
    value,
  }));
}

function must_editor_write_ops(root: HsonNode, writeOps: readonly LiveMapCoreWriteOp[]): void {
  /** Validate that the editor can apply the full pending op set before mutating the live root. */
  apply_write_ops(clone_live_root(root), writeOps);
}

type LiveMapAppliedOps = Readonly<{
  changed: boolean;
  ops: readonly LiveMapDataOp[];
}>;
function apply_write_ops(
  root: HsonNode,
  writeOps: readonly LiveMapCoreWriteOp[],
): LiveMapAppliedOps {
  /** Apply normalized pending intents in order and collect the changed public ops. */
  const ops: LiveMapDataOp[] = [];

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      ops.push(...apply_constructive_set_write_op(root, op));
      continue;
    }

    if (op.kind === "splice") {
      const currentValue = must_core_array_value(snap_live_path(root, op.path), op.path);
      const next = [...currentValue];
      const removed = next.splice(op.start, op.deleteCount, ...op.items.map(clone_json_value));
      const edit = set_live_path(root, op.path, next);
      if (!edit.changed) continue;
      const spliceOp: LiveMapSpliceOp = Object.freeze({ kind: "splice", path: clone_live_path(op.path), start: op.start, removed: Object.freeze(removed.map(clone_json_value)), inserted: Object.freeze(op.items.map(clone_json_value)), prev: must_json_value(edit.prev, op.path), next: must_json_value(edit.next, op.path) });
      ops.push(spliceOp);
      continue;
    }

    if (op.kind === "set") {
      const edit = set_live_path(root, op.path, op.value);
      if (!edit.changed) continue;

      ops.push({
        kind: "set",
        path: clone_live_path(op.path),
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
        path: clone_live_path(op.path),
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
      path: clone_live_path(op.path),
      prev: edit.prev,
      next: undefined,
    });
  }

  return {
    changed: ops.length > 0,
    ops,
  };
}

function apply_constructive_set_write_op(root: HsonNode, op: LiveMapConstructiveSetWriteOp): readonly LiveMapDataOp[] {
  const entries = Object.entries(op.value);
  const currentValue = snap_live_path(root, op.path);

  if (currentValue !== undefined && !is_json_object_value(currentValue)) {
    const edit = set_live_path(root, op.path, plain_object_from_set_many_values(op.value));
    if (!edit.changed) return [];

    return [
      {
        kind: "set",
        path: clone_live_path(op.path),
        prev: edit.prev,
        next: edit.next,
      },
    ];
  }

  if (currentValue === undefined) {
    throw new Error(`LiveMap set path does not resolve: ${format_live_path(op.path)}`);
  }

  const ops: LiveMapDataOp[] = [];

  for (const [key, value] of entries) {
    const childPath = append_live_path(op.path, key);
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

  must_schema_validation(
    schema.validateRoot(candidate),
    write_op_path(writeOps[0]),
    schema_headline_mode_for_write_ops(writeOps)
  );
}

/**
 * Choose the schema error headline path.
 *
 * Single endpoint operations report the operation path. Multi-op object writes
 * report the first schema issue path so `setMany` and constructive object `set`
 * point at the field that actually failed.
 */
function schema_headline_mode_for_write_ops(writeOps: readonly LiveMapCoreWriteOp[]): "path" | "issue" {
  if (writeOps.some((op) => op.kind === "constructive-set")) return "issue";
  if (writeOps.length > 1) return "issue";
  return "path";
}

/** Apply staged write intents to a cloned JSON root for schema preview. */
function apply_json_write_ops(root: JsonValue, writeOps: readonly LiveMapCoreWriteOp[]): JsonValue {
  let candidate = root;

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      apply_json_constructive_set(candidate, op);
      continue;
    }

    if (op.kind === "splice") {
      apply_json_splice_write_op(candidate, op);
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

function apply_json_splice_write_op(root: JsonValue, op: LiveMapSpliceWriteOp): void {
  const currentValue = must_core_array_value(snap_json_path(root, op.path), op.path);
  const next = [...currentValue];
  next.splice(op.start, op.deleteCount, ...op.items.map(clone_json_value));
  set_json_path(root, op.path, next);
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
    set_json_path(root, append_live_path(op.path, key), clone_json_value(value));
  }
}

/** True for non-array JSON objects that can receive shallow child writes. */
function is_json_object_value(value: JsonValue | undefined): value is LiveMapSetManyValues {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Enforce strict resolved-path semantics for endpoint operations. */
function must_resolved_path(action: "delete" | "replace" | "set", path: LivePath, value: JsonValue | undefined): void {
  if (path.length === 0 || value !== undefined) return;

  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

/** Enforce `setMany`'s existing-object endpoint requirement. */
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
