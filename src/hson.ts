// hson.ts


import { construct_source_1 } from "./api/transform/constructors/construct-source-1.js";
import type { GraftConstructor, HsonSourceConstructor_2, OutputConstructor_2 } from "./types/constructor.types.js";
import type { HsonNode } from "./types/node.types.js";
import type { JsonValue } from "./types/core.types.js";
import { LiveTree } from "./api/livetree/livetree.js";
import { make_branch_from_node } from "./api/livetree/creation/create-branch.js";
import { graft } from "./api/livetree/creation/graft.js";
import { make_detached_livetree_create } from "./api/livetree/creation/make-detached-livetree.js";
import { make_livemap_core } from "./api/livemap/livemap.core.js";
import { define_livemap_schema, LIVEMAP_SCHEMA, make_livemap_schema } from "./api/livemap/livemap.schema.js";
import { create_livehost } from "./api/livehost/livehost.core.js";
import { create_livehost_client } from "./api/livehost/livehost.client.js";
import { create_livehost_store } from "./api/livehost/livehost.store.js";
import { decode_livehost_message, encode_livehost_message } from "./api/livehost/livehost.protocol.js";
import { make_livehost_resume_log } from "./api/livehost/livehost.resume.js";
import { make_livehost_sync_manager } from "./api/livehost/livehost.sync.js";
import { make_livehost_canonical_stream } from "./api/livehost/livehost.history.js";
import { make_livehost_recovery_planner } from "./api/livehost/livehost.recovery.js";
import type { LiveMap, LiveMapPathHandle } from "./types/livemap.types.js";
import type { InferLiveMapSchemaInput, LiveMapSchema, LiveMapSchemaBuilder } from "./api/livemap/livemap.schema.js";
import { project_keyed_collection } from "./api/liveproject/liveproject.keyed.js";
import { create_live_inspector } from "./api/liveinspect/liveinspect.js";
import type { LiveInspector, LiveInspectorOptions, LiveInspectorOwnedHsonOptions, LiveInspectorOwnedJsonOptions } from "./types/liveinspect.types.js";


const SAFE_SOURCE = construct_source_1({ unsafe: false });
const UNSAFE_SOURCE = construct_source_1({ unsafe: true });

type LiveMapSchemaNamespace = LiveMapSchemaBuilder & Readonly<{
  define: <const TInput>(makeShape: (schema: LiveMapSchemaBuilder) => TInput) => LiveMapSchema<InferLiveMapSchemaInput<TInput>>;
  make: <const TInput>(input: TInput) => LiveMapSchema<InferLiveMapSchemaInput<TInput>>;
}>;

const LIVE_MAP_SCHEMA_NAMESPACE: LiveMapSchemaNamespace = Object.assign(
  {},
  LIVEMAP_SCHEMA,
  {
    define: define_livemap_schema,
    make: make_livemap_schema,
  },
);

/**
 * Build a LiveMap from projected JSON.
 *
 * Object roots are seeded through an empty HSON object and then `replace(...)`d
 * so LiveMap construction uses the same editor path as later root replacement.
 * Non-object roots can be transformed directly because there is no object graph
 * to seed before replacement.
 */
function make_livemap_core_from_json(input: string | JsonValue): LiveMap {
  const value = typeof input === "string" ? JSON.parse(input) as JsonValue : input;

  if (!is_livemap_seed_object(value)) {
    const out = UNSAFE_SOURCE.fromJson(value);
    return make_livemap_core(out.toNode());
  }

  const out = UNSAFE_SOURCE.fromJson({});
  const map = make_livemap_core(out.toNode());

  map.replace(value);

  return map;
}

/** True when LiveMap JSON construction should seed an object root via replace. */
function is_livemap_seed_object(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Public entrypoint for hson-live.
 *
 * The API is split into two layers:
 * - transformer constructors (`fromTrustedHtml`, `fromUntrustedHtml`,
 *   `fromJson`, `fromNode`) which return the serialization / parse pipeline
 * - `fromHson`, whose `.toNode()` terminal parses HSON text directly
 * - LiveTree, which constructs or grafts LiveTree instances directly
 *
 * Use the transformer pipeline when the goal is data or a data string.
 * Use `hson.liveTree.*` to create a mutable LiveTree interface.
 */
export const hson = {
  /**
   * Parse untrusted HTML or an existing `Element` into a detached LiveTree.
   *
   * HTML is sanitized before conversion. The returned tree is detached and
   * does not mutate the live DOM by itself.
   */
  fromUntrustedHtml(input: string | Element): OutputConstructor_2 {
    return SAFE_SOURCE.fromHtml(input, { sanitize: true });
  },

  /**
   * Parse trusted HTML or an existing `Element` into a detached LiveTree.
   *
   * No sanitization is applied. The returned tree is off-DOM until it is
   * appended or otherwise grafted into a mounted tree.
   */

  fromTrustedHtml(input: string | Element): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromHtml(input, { sanitize: false });
  },

  /**
   * Convert JSON or a JSON string into the transformer pipeline.
   *
   * This is the serialization/conversion surface, not a mutable LiveMap.
   */
  fromJson(input: string | JsonValue): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromJson(input);
  },

  /** Parse serialized HSON directly with `.toNode()`. */
  fromHson(input: string): HsonSourceConstructor_2 {
    return UNSAFE_SOURCE.fromHson(input);
  },

  /** Wrap an existing HSON node in the transformer pipeline. */
  fromNode(node: HsonNode): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromNode(node);
  },

  /**
   * Direct LiveMap construction API.
   *
   * LiveMap projects an HSON graph as mutable JSON-path state. It can be used
   * without a schema, or configured through `map.schema.use(schema)` for runtime
   * validation and schema-derived TypeScript types.
   */
  liveMap: {
    /** Schema builder and schema-constructor namespace for LiveMap. */
    schema: LIVE_MAP_SCHEMA_NAMESPACE,

    /**
     * Create a mutable LiveMap from JSON or a JSON string.
     *
     * The resulting map uses the settled LiveMap mutation contract: `set` is
     * strict and sibling-preserving for object endpoints, `setMany` writes child
     * keys under an existing object, and `replace` is destructive.
     */
    fromJson(input: string | JsonValue): LiveMap {
      return make_livemap_core_from_json(input);
    },

    /** Create a mutable LiveMap from serialized HSON. */
    fromHson(input: string): LiveMap {
      const out = UNSAFE_SOURCE.fromHson(input);
      return make_livemap_core(out.toNode());
    },

    /** Create a mutable LiveMap over an existing HSON node graph. */
    fromNode(node: HsonNode): LiveMap {
      return make_livemap_core(node);
    },
  },

  /**
   * Experimental one-way LiveMap -> LiveTree projection APIs.
   *
   * Patch 7A intentionally exposes only keyed collection projection. This is
   * not a component system, template language, or universal data renderer.
   */
  liveProject: Object.freeze({
    keyedCollection: project_keyed_collection,
  }),

  /** Experimental read-only structured-data inspection surface. */
  inspect: Object.freeze({
    create(options: LiveInspectorOptions): LiveInspector {
      return create_live_inspector(options);
    },

    /** Create an inspector-owned LiveMap from a detached JSON-shaped value. */
    fromJson(options: LiveInspectorOwnedJsonOptions): LiveInspector {
      const { value, ...inspectorOptions } = options;
      const ownedMap = is_inspector_root_collection(value)
        ? make_livemap_core_from_json(value)
        : make_livemap_core_from_json({ __hson_inspector_value__: value });
      const source = is_inspector_root_collection(value)
        ? ownedMap
        : make_inspector_primitive_root(ownedMap.at(["__hson_inspector_value__"]));
      return create_live_inspector(
        { ...inspectorOptions, source },
        { origin: "json" },
      );
    },

    /** Create an inspector-owned LiveMap from canonical serialized HSON. */
    fromHson(options: LiveInspectorOwnedHsonOptions): LiveInspector {
      const { value, ...inspectorOptions } = options;
      const output = UNSAFE_SOURCE.fromHson(value);
      return create_live_inspector(
        { ...inspectorOptions, source: make_livemap_core(output.toNode()) },
        { origin: "hson" },
      );
    },
  }),

  /**
   * Direct LiveHost construction API.
   *
   * LiveHost provides an authoritative LiveMap host, a mirrored client, and a
   * small registry for routing named host instances over socket-like transports.
   */
  liveHost: {
    /** Create an authoritative LiveHost instance. */
    create: create_livehost,

    /** Create a mirrored LiveHost client over a socket-like transport. */
    client: create_livehost_client,

    /** Create an in-memory registry of named LiveHost instances. */
    registry: create_livehost_store,

    /** Lower-level protocol helpers for custom adapters and tests. */
    protocol: Object.freeze({
      decode: decode_livehost_message,
      encode: encode_livehost_message,
    }),

    /** Lower-level constructors kept behind a debug namespace for now. */
    debug: Object.freeze({
      canonicalStream: make_livehost_canonical_stream,
      recoveryPlanner: make_livehost_recovery_planner,
      resumeLog: make_livehost_resume_log,
      syncManager: make_livehost_sync_manager,
    }),
  },

  /**
   * Direct LiveTree construction API.
   *
   * These methods bypass the transformer finalization chain and return either:
   * - detached LiveTree branches (`fromTrustedHtml`, `fromJson`, etc.),
   * - `graft()` handles for existing DOM targets (`queryDom`, `queryBody`),
   * - or detached creation helpers via `create`.
   *
   * This is the current public construction surface for LiveTree.
   * Detached branches are created off-DOM; grafting is explicit.
   */

  liveTree: {
    /* see docs above */
    /** Create a detached LiveTree branch from sanitized HTML or an Element. */
    fromUntrustedHtml(input: string | Element): LiveTree {
      const out = SAFE_SOURCE.fromHtml(input, { sanitize: true });
      return make_branch_from_node(out.toNode());
    },

    /** Create a detached LiveTree branch from trusted HTML or an Element. */
    fromTrustedHtml(input: string | Element): LiveTree {
      const out = UNSAFE_SOURCE.fromHtml(input, { sanitize: false });
      return make_branch_from_node(out.toNode());
    },

    /** Create a detached LiveTree branch from projected JSON. */
    fromJson(input: string | JsonValue): LiveTree {
      const out = UNSAFE_SOURCE.fromJson(input);
      return make_branch_from_node(out.toNode());
    },

    /** Create a detached LiveTree branch from serialized HSON. */
    fromHson(input: string): LiveTree {
      const out = UNSAFE_SOURCE.fromHson(input);
      return make_branch_from_node(out.toNode());
    },

    /** Create a detached LiveTree branch from an existing HSON node. */
    fromNode(node: HsonNode): LiveTree {
      return make_branch_from_node(node);
    },

    /**
     * Create a graft handle for an existing DOM subtree selected by CSS selector.
     *
     * Call `.graft()` to parse that subtree into HSON, re-project it as a
     * managed LiveTree, and return the controlling tree.
     */

    queryDom(selector: string): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) {
            throw new Error(`hson.liveTree.queryDom: selector "${selector}" not found.`);
          }
          return graft(element, { unsafe: false });
        },
      };
    },

    /**
     * Convenience graft handle for `document.body`.
     *
     * Call `.graft()` to replace the current body subtree with an equivalent
     * LiveTree-managed projection and return the controlling tree.
     */
    queryBody(): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.body;
          if (!element) {
            throw new Error("hson.liveTree.queryBody: document.body is not available.");
          }
          return graft(element, { unsafe: false });
        },
      };
    },

    /**
     * Detached node-creation helper.
     *
     * Use this to create off-DOM LiveTree nodes directly without a parent tree.
     * Supports HTML and SVG tag helpers plus insertion-position helpers such as
     * `.prepend()` and `.at(index)`.
     */
    create: make_detached_livetree_create(),
  },
};

function is_inspector_root_collection(value: JsonValue): boolean {
  return typeof value === "object" && value !== null;
}

/** Present the internal scalar wrapper property as the inspector's canonical root. */
function make_inspector_primitive_root(source: LiveMapPathHandle): LiveMapPathHandle {
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property === "path") return () => Object.freeze([]);
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}
