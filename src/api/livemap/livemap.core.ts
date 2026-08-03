// core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap, LiveMapAnyOp, LiveMapCommit, LiveMapReplay, LiveMapCore, LiveMapCoreSchemaApi, LiveMapCoreSnap, LiveMapFeedListener, LiveMapPathValue, LiveMapStoreApi, LiveMapStorePathListener, LiveMapStoreSelectedListener, LiveMapStoreSubscribeOptions, LiveMapSubApi, LivePath, LiveMapDataOp, LiveMapBatchTx, LiveMapPathHandle, LiveMapCapture, LiveMapCaptureInput, LiveMapApply, LiveMapGraphCommit, LiveMapGraphOp, LiveMapGraphReplaceRootOp, LiveMapRootMode } from "../../types/livemap.types.js";
import {
  validate_livemap_schema_projected_root,
  type LiveMapSchema,
  type LiveMapSchemaResolution,
  type LiveMapSchemaValidation,
  type LiveMapSchemaValue,
} from "./livemap.schema.js";
import { clone_live_root, overwrite_hson_node, project_live_path, snap_live_path } from "./livemap.editor.js";
import { make_livemap_feed_hub } from "./livemap.feed.js";
import { make_livemap_commit_observer_hub } from "./livemap.commit-observer.js";
import { make_livemap_node_handle } from "./livemap.node.js";
import { make_livemap_path_handle } from "./livemap.handle.js";
import { make_livemap_proxy } from "./livemap.proxy.js";
import { make_livemap_store_api } from "./livemap.store.js";
import { must_feed_listener, must_live_path, must_ordered_projected_object, must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import { append_live_path, clone_live_path, format_live_path, live_path_key } from "./livemap.path.js";
import { LiveMapProjectedTransportError, LiveMapReplayError, LiveMapRevError, LiveMapSchemaError, } from "./livemap.error.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import {
  is_ordered_projected_object,
  optional_ordered_projected_value_equal,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import {
  ordered_projected_array_splice,
  ordered_projected_value_at,
  ordered_projected_value_delete,
  ordered_projected_value_replace,
  ordered_projected_value_set,
} from "../../core/ordered-projected-value-mutation.js";
import { projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { ROOT_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import { must_livemap_replay } from "./livemap.replay.js";
import {
  decode_projected_value_payload,
  encode_livemap_replay_transport,
  encode_projected_value_transport,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION,
  LiveMapTransportCodecError,
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";
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
import {
  register_livemap_projected_propagation,
  type LiveMapProjectedDeleteWrite,
  type LiveMapProjectedPropagation,
  type LiveMapProjectedPropagationWrite,
  type LiveMapProjectedReplaceWrite,
  type LiveMapProjectedSetWrite,
  type LiveMapProjectedSpliceWrite,
} from "./livemap.projected-propagation.js";
import {
  register_livemap_document_identity_effects,
  replace_livemap_document_identity_overlay_effects,
} from "./livemap.document.identity.js";

type LiveMapConstructiveSetWriteOp = Readonly<{
  kind: "constructive-set";
  path: LivePath;
  value: OrderedProjectedObject;
}>;

type LiveMapProjectedSetWriteOp = LiveMapProjectedSetWrite;
type LiveMapProjectedReplaceWriteOp = LiveMapProjectedReplaceWrite;
type LiveMapProjectedDeleteWriteOp = LiveMapProjectedDeleteWrite;
type LiveMapProjectedSpliceWriteOp = LiveMapProjectedSpliceWrite;

type LiveMapCoreWriteOp =
  | LiveMapProjectedSetWriteOp
  | LiveMapProjectedReplaceWriteOp
  | LiveMapProjectedDeleteWriteOp
  | LiveMapProjectedSpliceWriteOp
  | LiveMapConstructiveSetWriteOp;

type BuiltLiveMapCore = Readonly<{
  core: LiveMapCore<JsonValue | undefined>;
  projected: LiveMapProjectedPropagation;
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
  register_livemap_projected_propagation(built.core, built.projected);
  return built.core;
}

/** Construct the public shape-specific façade after detached root ownership. */
export function make_classified_livemap(input: HsonNode): ClassifiedLiveMap {
  const prepared = prepare_livemap_root(input);
  const built = make_livemap_core_from_owned_root(prepared);
  const facade = facade_for_livemap_root(built.core, prepared, built.document);
  register_staged_facade(facade, built);
  register_livemap_projected_propagation(built.core, built.projected);
  register_livemap_projected_propagation(facade, built.projected);
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
    documentOverlay: prepared.documentOverlay,
    revision: initial.revision ?? 0,
  };
  const feedHub = make_livemap_feed_hub();
  const commitObserverHub = make_livemap_commit_observer_hub<LiveMapAnyOp>();
  // This closure-local schema is fine for the first enforcement pass. Revisit
  // once the Core facade grows: schema attachment may want an immutable facade
  // wrapper or shared Core state object instead of mutating closure-local state.
  let currentSchema: LiveMapSchema | undefined = initial.schema;
  /** Revision zero represents the initial graph before any changed commit. */
  const transitionController = make_livemap_transition_controller(initialMode, () => owned.revision);

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
          owned = {
            root: preparedNext.root,
            documentOverlay: preparedNext.documentOverlay,
            revision: commit.rev,
          };
        } else {
          overwrite_hson_node(owned.root, preparedNext.root);
          owned = { ...owned, revision: commit.rev };
        }
      },
      notify: (acceptedCommit) => {
        if (initialMode === "element" || initialMode === "fragment") {
          commitObserverHub.emitCommit(acceptedCommit, "authoritative");
        } else {
          feedHub.emitProjected(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (path) => project_live_path(owned.root, path));
          commitObserverHub.emitCommit(acceptedCommit, "authoritative");
        }
      },
    });
  }

  function detachUnsafeReferences(): void {
    const detached = prepare_livemap_root(owned.root);
    owned = {
      root: detached.root,
      documentOverlay: detached.documentOverlay,
      revision: owned.revision,
    };
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
        () => owned.revision,
        (revision) => { owned = { ...owned, revision }; },
        writeOps,
        commitObserverHub,
      );
    }
    const transition = prepare_projected_transition(
      owned.root,
      currentSchema,
      feedHub,
      () => owned.revision,
      (revision) => { owned = { ...owned, revision }; },
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
      must_core_schema_root(schema, owned.root, initialMode);
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
          project_live_path(owned.root, livePath),
        ),
      );
    },

    /** Set multiple object properties while preserving unspecified siblings. */
    setMany: (path, values) => {
      const livePath = must_live_path(path);
      const projectedValues = must_ordered_projected_object(values, livePath);
      return commitOps(
        write_ops_from_set_many(
          livePath,
          projectedValues,
          project_live_path(owned.root, livePath),
        ),
      );
    },

    /** Apply one semantic array splice and preserve it in the resulting commit. */
    splice: (path, start, deleteCount, ...items) => {
      const livePath = must_live_path(path);
      const currentValue = project_live_path(owned.root, livePath);
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
      must_resolved_path("replace", op.path, project_live_path(owned.root, op.path));
      return commitOps([op]);
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, project_live_path(owned.root, livePath));
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
      return owned.revision;
    },
    /** Capture the current projected root together with its committed revision. */
    capture: (): LiveMapCapture<JsonValue | undefined> => {
      const projected = must_projected_root_value(owned.root);
      return Object.freeze({
        rev: owned.revision,
        value: materialize_projected_value(projected),
        ...encode_projected_value_transport(projected),
      });
    },
    /** Restore projected state and revision without a commit, feed, or increment. */
    restore: (capture: LiveMapCaptureInput<JsonValue | undefined>): void => {
      transitionController.assertPublicMutationAllowed();
      const normalized = must_projected_capture(capture);
      const operation: LiveMapProjectedReplaceWriteOp = {
        kind: "replace",
        path: [],
        value: normalized.value,
      };
      must_core_schema_write_ops(currentSchema, owned.root, [operation]);
      const planned = plan_write_ops(must_projected_root_value(owned.root), [operation]);
      const candidate = projected_value_to_hson_root(planned.value);
      const observedMode = classify_live_root_mode(candidate);
      if (observedMode !== initialMode) {
        throw new Error(`LiveMap projected restore mode mismatch: expected ${initialMode}, observed ${observedMode}.`);
      }
      owned = { root: candidate, documentOverlay: undefined, revision: normalized.rev };
      transitionController.invalidate();
      commitObserverHub.emitSnapshot(normalized.rev);
    },
    /** Replace the root only when the caller's base revision is still current. */
    apply: (input: LiveMapApply<JsonValue | undefined>) => {
      const normalized = must_projected_apply(input);
      must_expected_rev(
        normalized.prevRev,
        owned.revision,
      );

      return commitOps([
        {
          kind: "replace",
          path: [],
          value: normalized.value,
        },
      ]);
    },
    /** Replay semantic ops only when their base revision and prior values match. */
    replay: (input: LiveMapReplay) => {
      transitionController.assertPublicMutationAllowed();
      const replay = must_livemap_replay(input);
      must_expected_rev(
        replay.prevRev,
        owned.revision,
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

  const projected: LiveMapProjectedPropagation = Object.freeze({
    read: (path) => project_live_path(owned.root, path),
    feed: (path, listener) => feedHub.addProjected(path, listener),
    commit: (ops: readonly LiveMapProjectedPropagationWrite[]) => commitOps(ops),
  });


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
      projected,
      transitionController,
      currentRoot: () => owned.root,
      currentSchema: () => currentSchema,
      detachUnsafeReferences,
      prepareDetachedCommit,
    };
  }

  const document: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController = {
    mode: initialMode,
    rev: () => owned.revision,
    root: () => owned.root,
    overlay: () => {
      const identity = owned.documentOverlay;
      if (identity === undefined) {
        throw new Error(`LiveMap document mode ${initialMode} has no identity overlay.`);
      }
      return identity;
    },
    commits: Object.freeze({ observe: commitObserverHub.observe }),
    apply: (candidate: PreparedDocumentInstall): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> => {
      transitionController.assertPublicMutationAllowed();
      const prevRev = owned.revision;
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
      if (commit.changed) {
        const currentOverlay = owned.documentOverlay;
        if (currentOverlay === undefined) throw new Error("LiveMap document identity overlay is unavailable.");
        register_livemap_document_identity_effects(
          commit,
          replace_livemap_document_identity_overlay_effects(currentOverlay, candidate.overlay),
        );
      }
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          owned = {
            root: candidate.root,
            documentOverlay: candidate.overlay,
            revision: commit.rev,
          };
        },
        (acceptedCommit) => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
    },
    restore: (candidate: PreparedDocumentInstall, revision: number): void => {
      transitionController.assertPublicMutationAllowed();
      owned = {
        root: candidate.root,
        documentOverlay: candidate.overlay,
        revision,
      };
      transitionController.invalidate();
      commitObserverHub.emitSnapshot(revision);
    },
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: PreparedDocumentMutation<TOp>): LiveMapGraphCommit<TOp> => {
      transitionController.assertPublicMutationAllowed();
      const prevRev = owned.revision;
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
      if (commit.changed) register_livemap_document_identity_effects(commit, candidate.identityEffects);
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          owned = {
            root: candidate.root,
            documentOverlay: candidate.overlay,
            revision: rev,
          };
        },
        (acceptedCommit) => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<TOp>;
    },
    applyReplay: (candidate: PreparedDocumentReplay): LiveMapGraphCommit => {
      transitionController.assertPublicMutationAllowed();
      register_livemap_document_identity_effects(candidate.commit, candidate.identityEffects);
      owned = {
        root: candidate.root,
        documentOverlay: candidate.overlay,
        revision: candidate.commit.rev,
      };
      transitionController.invalidate();
      commitObserverHub.emitCommit(candidate.commit, "replay");
      return candidate.commit;
    },
  };

  return {
    core,
    projected,
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
      register_livemap_projected_propagation(ephemeral.draft, draftBuilt.projected);
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
 * The transaction keeps an immutable carrier candidate so each later operation sees
 * earlier staged writes for path resolution and object expansion. The live root
 * is not mutated until the collected write ops pass schema and editor preflight.
 */
function make_batch_tx(
  root: HsonNode,
  writeOps: LiveMapCoreWriteOp[],
  isOpen: () => boolean,
): LiveMapBatchTx<JsonValue | undefined> {
  /** The transaction mirrors Core mutation semantics. */
  let candidate = must_projected_root_value(root);

  const pushWriteOps = (ops: readonly LiveMapCoreWriteOp[]) => {
    candidate = plan_write_ops(candidate, ops).value;
    writeOps.push(...ops);
  };

  const tx: LiveMapBatchTx<JsonValue | undefined> = {
    set: (path, value) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      pushWriteOps(write_ops_from_set(livePath, value, ordered_projected_value_at(candidate, livePath)));
      return tx;
    },
    replace: function (pathOrValue: unknown, value?: unknown) {
      must_batch_open(isOpen);
      const op = replace_write_op_from_args(arguments.length, pathOrValue, value);
      must_resolved_path("replace", op.path, ordered_projected_value_at(candidate, op.path));
      pushWriteOps([op]);
      return tx;
    },
    setMany: (path, values) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const projectedValues = must_ordered_projected_object(values, livePath);
      pushWriteOps(write_ops_from_set_many(livePath, projectedValues, ordered_projected_value_at(candidate, livePath)));
      return tx;
    },
    splice: (path, start, deleteCount, ...items) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const op = splice_write_op(livePath, ordered_projected_value_at(candidate, livePath), start, deleteCount, items);
      pushWriteOps([op]);
      return tx;
    },
    delete: (path) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, ordered_projected_value_at(candidate, livePath));
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
  ops: readonly LiveMapProjectedDataOp[],
): readonly LiveMapCoreWriteOp[] {
  let candidate = must_projected_root_value(root);

  const writeOps: LiveMapCoreWriteOp[] = [];

  for (const op of ops) {
    const currentValue = ordered_projected_value_at(candidate, op.path);

    must_replay_value(
      op.path,
      op.prev,
      currentValue,
    );

    const writeOp = projected_write_op_from_transport(op);

    candidate = plan_write_ops(candidate, [writeOp]).value;

    const nextValue = ordered_projected_value_at(candidate, op.path);

    must_replay_value(
      op.path,
      op.next,
      nextValue,
    );

    writeOps.push(writeOp);
  }

  return writeOps;
}

function must_projected_capture(input: unknown): Readonly<{ rev: number; value: OrderedProjectedValue }> {
  if (!is_plain_unknown_record(input)) {
    throw new LiveMapProjectedTransportError("restore", "capture is not an object");
  }
  if (typeof input.rev !== "number" || !Number.isInteger(input.rev) || input.rev < 0) {
    throw new LiveMapProjectedTransportError("restore", "revision is not a non-negative integer");
  }
  if (has_projected_transport_field(input)) {
    return Object.freeze({
      rev: input.rev,
      value: must_exact_projected_value(input, "restore"),
    });
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("rev") || !keys.includes("value")) {
    throw new LiveMapProjectedTransportError("restore", "legacy capture contains missing or unknown fields");
  }
  return Object.freeze({
    rev: input.rev,
    value: must_ordered_projected_value(input.value, []),
  });
}

function must_projected_apply(input: unknown): Readonly<{ prevRev: number; value: OrderedProjectedValue }> {
  if (!is_plain_unknown_record(input)) {
    throw new LiveMapProjectedTransportError("apply", "input is not an object");
  }
  if (typeof input.prevRev !== "number" || !Number.isInteger(input.prevRev) || input.prevRev < 0) {
    throw new Error(`LiveMap expected revision is not valid: ${String(input.prevRev)}`);
  }
  return Object.freeze({
    prevRev: input.prevRev,
    value: has_projected_transport_field(input)
      ? must_exact_projected_value(input, "apply")
      : must_ordered_projected_value(input.value, []),
  });
}

function must_exact_projected_value(
  input: Readonly<Record<string, unknown>>,
  context: "apply" | "restore",
): OrderedProjectedValue {
  if (input.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
    throw new LiveMapProjectedTransportError(context, "format is not supported");
  }
  if (input.formatVersion !== LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION) {
    throw new LiveMapProjectedTransportError(context, "formatVersion is not supported");
  }
  if (typeof input.payload !== "string") {
    throw new LiveMapProjectedTransportError(context, "payload is not a string");
  }
  try {
    return decode_projected_value_payload(input.payload);
  } catch (error) {
    if (error instanceof LiveMapTransportCodecError) {
      throw new LiveMapProjectedTransportError(context, error.reason, { cause: error });
    }
    throw error;
  }
}

function has_projected_transport_field(input: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(input, "format")
    || Object.hasOwn(input, "formatVersion")
    || Object.hasOwn(input, "payload");
}

function is_plain_unknown_record(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function must_replay_value(
  path: LivePath,
  expected: OrderedProjectedValue | undefined,
  actual: OrderedProjectedValue | undefined,
): void {
  if (optional_ordered_projected_value_equal(expected, actual)) return;

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
): LiveMapProjectedReplaceWriteOp {
  if (argCount <= 1) {
    return {
      kind: "replace",
      path: [],
      value: must_ordered_projected_value(pathOrValue, []),
    };
  }

  const livePath = must_live_path(pathOrValue);

  return {
    kind: "replace",
    path: livePath,
    value: must_ordered_projected_value(value, livePath),
  };
}

/** Normalize one public array splice into a transport-safe write intent. */
function splice_write_op(path: LivePath, currentValue: OrderedProjectedValue | undefined, start: number, deleteCount: number, items: readonly unknown[]): LiveMapProjectedSpliceWriteOp {
  const arrayValue = must_core_array_value(currentValue, path);
  const normalizedStart = normalize_splice_start(arrayValue.length, start, path);
  const normalizedDeleteCount = normalize_splice_delete_count(arrayValue.length, normalizedStart, deleteCount, path);
  const projectedItems = items.map((item, index) => must_ordered_projected_value(item, append_live_path(path, normalizedStart + index)));
  return Object.freeze({ kind: "splice", path: clone_live_path(path), start: normalizedStart, deleteCount: normalizedDeleteCount, items: Object.freeze(projectedItems) });
}

function must_core_array_value(value: OrderedProjectedValue | undefined, path: LivePath): readonly OrderedProjectedValue[] {
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
function must_core_schema_root(schema: LiveMapSchema, root: HsonNode, mode: LiveMapRootMode): void {
  if (mode === "element" || mode === "fragment") {
    must_schema_validation(schema.validateRoot(snap_live_path(root, [])), []);
    return;
  }
  must_schema_validation(
    validate_livemap_schema_projected_root(schema, must_projected_root_value(root)),
    [],
  );
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

function must_projected_root_value(root: HsonNode): OrderedProjectedValue {
  const value = project_live_path(root, []);
  if (value !== undefined) return value;
  throw new Error("LiveMap projected root does not resolve.");
}

/** Preserve direct data roots unless an explicit whole-root replacement owns the change. */
function projected_candidate_graph(
  currentRoot: HsonNode,
  value: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
): HsonNode {
  const root = projected_value_to_hson_root(value);
  const replacesRoot = writeOps.some((op) => op.kind === "replace" && op.path.length === 0);
  if (currentRoot.$_tag === ROOT_TAG || replacesRoot) return root;
  const candidate = root.$_content[0];
  if (is_Node(candidate)) return candidate;
  throw new Error("LiveMap projected constructor did not produce a value node.");
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
  const baseRoot = clone_live_root(root);
  const planned = plan_write_ops(must_projected_root_value(root), writeOps);
  must_core_schema_candidate(schema, planned.value, writeOps);
  const nextRoot = projected_candidate_graph(root, planned.value, writeOps);
  const prevRev = getRev();
  const rev = planned.changed
    ? prevRev + 1
    : prevRev;
  const commit: LiveMapCommit = Object.freeze({
    changed: planned.changed,
    prevRev,
    rev,
    ops: planned.ops,
    ...encode_livemap_replay_transport(planned.transportOps),
  });
  return transitionController.prepare({
    commit,
    baseStillCurrent: () => canonical_graph_equal(root, baseRoot),
    install: () => {
      overwrite_hson_node(root, nextRoot);
      setRev(rev);
    },
    notify: (acceptedCommit) => {
      feedHub.emitProjected(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (feedPath) => project_live_path(root, feedPath));
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
  const planned = plan_write_ops(must_projected_root_value(root), writeOps);
  must_core_schema_candidate(schema, planned.value, writeOps);
  const prevRev = getRev();
  const rev = planned.changed ? prevRev + 1 : prevRev;
  if (planned.changed) {
    overwrite_hson_node(root, projected_candidate_graph(root, planned.value, writeOps));
    setRev(rev);
  }
  const commit: LiveMapCommit = Object.freeze({
    changed: planned.changed,
    prevRev,
    rev,
    ops: planned.ops,
    ...encode_livemap_replay_transport(planned.transportOps),
  });
  feedHub.emitProjected(commit, (feedPath) => project_live_path(root, feedPath));
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
function write_ops_from_set(path: LivePath, value: unknown, currentValue: OrderedProjectedValue | undefined): readonly LiveMapCoreWriteOp[] {
  const projectedValue = must_ordered_projected_value(value, path);

  must_resolved_path("set", path, currentValue);

  if (path.length === 0 || !is_ordered_projected_object(projectedValue)) {
    return [
      { kind: "set", path, value: projectedValue },
    ];
  }

  if (currentValue !== undefined && !is_ordered_projected_object(currentValue)) {
    return [
      { kind: "set", path, value: projectedValue },
    ];
  }

  return [
    {
      kind: "constructive-set",
      path,
      value: projectedValue,
    },
  ];
}

/** Normalize public `setMany` into child-path set writes. */
function write_ops_from_set_many(path: LivePath, values: OrderedProjectedObject, currentValue: OrderedProjectedValue | undefined): readonly LiveMapProjectedSetWriteOp[] {
  must_resolved_object_path("setMany", path, currentValue);

  /** Build the child-path set ops used by sibling-preserving object sets. */
  return values.entries.map(([key, value]) => ({
    kind: "set" as const,
    path: append_live_path(path, key),
    value,
  }));
}

type LiveMapPlannedOps = Readonly<{
  changed: boolean;
  value: OrderedProjectedValue;
  ops: readonly LiveMapDataOp[];
  transportOps: readonly LiveMapProjectedDataOp[];
}>;
function plan_write_ops(
  root: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
): LiveMapPlannedOps {
  let candidate = root;
  const transportOps: LiveMapProjectedDataOp[] = [];

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      const planned = plan_constructive_set_write_op(candidate, op);
      candidate = planned.value;
      transportOps.push(...planned.ops);
      continue;
    }

    if (op.kind === "splice") {
      const prev = must_resolved_projected_value("set", op.path, ordered_projected_value_at(candidate, op.path));
      const result = ordered_projected_array_splice(candidate, op.path, op.start, op.deleteCount, op.items);
      const next = must_resolved_projected_value("set", op.path, ordered_projected_value_at(result.value, op.path));
      candidate = result.value;
      if (ordered_projected_value_equal(prev, next)) continue;
      transportOps.push(Object.freeze({
        kind: "splice",
        path: clone_live_path(op.path),
        start: op.start,
        removed: result.removed,
        inserted: op.items,
        prev: must_core_array_value(prev, op.path),
        next: must_core_array_value(next, op.path),
      }));
      continue;
    }

    if (op.kind === "set") {
      const prev = ordered_projected_value_at(candidate, op.path);
      candidate = ordered_projected_value_set(candidate, op.path, op.value);
      if (optional_ordered_projected_value_equal(prev, op.value)) continue;

      transportOps.push(Object.freeze({
        kind: "set",
        path: clone_live_path(op.path),
        prev,
        next: op.value,
      }));
      continue;
    }

    if (op.kind === "replace") {
      const prev = must_resolved_projected_value("replace", op.path, ordered_projected_value_at(candidate, op.path));
      candidate = ordered_projected_value_replace(candidate, op.path, op.value);
      if (ordered_projected_value_equal(prev, op.value)) continue;

      transportOps.push(Object.freeze({
        kind: "replace",
        path: clone_live_path(op.path),
        prev,
        next: op.value,
      }));
      continue;
    }

    const prev = must_resolved_projected_value("delete", op.path, ordered_projected_value_at(candidate, op.path));
    must_plan_projected_delete(candidate, op.path);
    candidate = ordered_projected_value_delete(candidate, op.path);

    transportOps.push(Object.freeze({
      kind: "delete",
      path: clone_live_path(op.path),
      prev,
      next: undefined,
    }));
  }

  const frozenTransportOps = Object.freeze(transportOps);
  return {
    changed: frozenTransportOps.length > 0,
    value: candidate,
    ops: Object.freeze(frozenTransportOps.map(materialize_livemap_projected_op)),
    transportOps: frozenTransportOps,
  };
}

function plan_constructive_set_write_op(
  root: OrderedProjectedValue,
  op: LiveMapConstructiveSetWriteOp,
): Readonly<{ value: OrderedProjectedValue; ops: readonly LiveMapProjectedDataOp[] }> {
  const currentValue = ordered_projected_value_at(root, op.path);
  if (currentValue === undefined) {
    throw new Error(`LiveMap set path does not resolve: ${format_live_path(op.path)}`);
  }
  if (!is_ordered_projected_object(currentValue)) {
    throw new Error(`LiveMap set path is not an object: ${format_live_path(op.path)}`);
  }

  const ops: LiveMapProjectedDataOp[] = [];
  let candidate = root;
  for (const [key, value] of op.value.entries) {
    const childPath = append_live_path(op.path, key);
    const prev = ordered_projected_value_at(candidate, childPath);
    candidate = ordered_projected_value_set(candidate, childPath, value);
    if (optional_ordered_projected_value_equal(prev, value)) continue;

    ops.push(Object.freeze({
      kind: "set",
      path: childPath,
      prev,
      next: value,
    }));
  }

  return Object.freeze({ value: candidate, ops: Object.freeze(ops) });
}

function must_core_schema_write_ops(
  schema: LiveMapSchema | undefined,
  root: HsonNode,
  writeOps: readonly LiveMapCoreWriteOp[],
): void {
  if (schema === undefined) return;
  const candidate = plan_write_ops(must_projected_root_value(root), writeOps).value;
  must_core_schema_candidate(schema, candidate, writeOps);
}

/** Validate the completed immutable candidate through the shared carrier domain. */
function must_core_schema_candidate(
  schema: LiveMapSchema | undefined,
  candidate: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
): void {
  if (schema === undefined) return;
  must_schema_validation(
    validate_livemap_schema_projected_root(schema, candidate),
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

/** Enforce strict resolved-path semantics for endpoint operations. */
function must_resolved_path(action: "delete" | "replace" | "set", path: LivePath, value: OrderedProjectedValue | undefined): void {
  if (path.length === 0 || value !== undefined) return;

  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

/** Enforce `setMany`'s existing-object endpoint requirement. */
function must_resolved_object_path(action: "setMany", path: LivePath, value: OrderedProjectedValue | undefined): void {
  if (value === undefined) {
    throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
  }

  if (is_ordered_projected_object(value)) return;

  throw new Error(`LiveMap ${action} path is not an object: ${format_live_path(path)}`);
}

function must_resolved_projected_value(
  action: "delete" | "replace" | "set",
  path: LivePath,
  value: OrderedProjectedValue | undefined,
): OrderedProjectedValue {
  if (value !== undefined) return value;
  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

function must_plan_projected_delete(root: OrderedProjectedValue, path: LivePath): void {
  if (path.length === 0) {
    throw new Error("LiveMap editor cannot delete the root node yet.");
  }
  const leaf = path[path.length - 1];
  const parent = ordered_projected_value_at(root, path.slice(0, -1));
  if (typeof leaf === "number" && Array.isArray(parent)) {
    throw new Error(`LiveMap editor cannot delete array indexes yet: ${format_live_path(path)}`);
  }
}

/** Compile one already-admitted replay operation into carrier-native planning. */
function projected_write_op_from_transport(op: LiveMapProjectedDataOp): Exclude<LiveMapCoreWriteOp, LiveMapConstructiveSetWriteOp> {
  if (op.kind === "delete") {
    return Object.freeze({ kind: "delete", path: clone_live_path(op.path) });
  }
  if (op.kind === "splice") {
    return Object.freeze({
      kind: "splice",
      path: clone_live_path(op.path),
      start: op.start,
      deleteCount: op.removed.length,
      items: op.inserted,
    });
  }
  return Object.freeze({
    kind: op.kind,
    path: clone_live_path(op.path),
    value: op.next,
  });
}

function write_op_path(op: LiveMapCoreWriteOp | undefined): LivePath {
  if (op === undefined) return [];
  return op.path;
}
