// hson.ts


import { construct_source_1 } from "./api/transform/constructors/construct-source-1.js";
import type { GraftConstructor, OutputConstructor_2 } from "./types/constructor.types.js";
import type { HsonNode } from "./types/node.types.js";
import type { JsonValue } from "./types/core.types.js";
import { LiveTree } from "./api/livetree/livetree.js";
import { make_branch_from_node } from "./api/livetree/creation/create-branch.js";
import { graft } from "./api/livetree/creation/graft.js";
import { make_detached_livetree_create } from "./api/livetree/creation/make-detached-livetree.js";
import { make_livemap_core } from "./api/livemap/core.js";
import { define_livemap_schema, LIVEMAP_SCHEMA, make_livemap_schema } from "./api/livemap/schema.js";
import type { LiveMap } from "./api/livemap/livemap.types.js";
import type { InferLiveMapSchemaInput, LiveMapSchema, LiveMapSchemaBuilder } from "./api/livemap/schema.js";


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
    return make_livemap_core(out.toHson().parse());
  }

  const out = UNSAFE_SOURCE.fromJson({});
  const map = make_livemap_core(out.toHson().parse());

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
 *   `fromJson`, `fromHson`, `fromNode`) which return the serialization /
 *   parse pipeline
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

  /** Parse serialized HSON into the transformer pipeline. */
  fromHson(input: string): OutputConstructor_2 {
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
      return make_livemap_core(out.toHson().parse());
    },

    /** Create a mutable LiveMap over an existing HSON node graph. */
    fromNode(node: HsonNode): LiveMap {
      return make_livemap_core(node);
    },
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
      return make_branch_from_node(out.toHson().parse());
    },

    /** Create a detached LiveTree branch from trusted HTML or an Element. */
    fromTrustedHtml(input: string | Element): LiveTree {
      const out = UNSAFE_SOURCE.fromHtml(input, { sanitize: false });
      return make_branch_from_node(out.toHson().parse());
    },

    /** Create a detached LiveTree branch from projected JSON. */
    fromJson(input: string | JsonValue): LiveTree {
      const out = UNSAFE_SOURCE.fromJson(input);
      return make_branch_from_node(out.toHson().parse());
    },

    /** Create a detached LiveTree branch from serialized HSON. */
    fromHson(input: string): LiveTree {
      const out = UNSAFE_SOURCE.fromHson(input);
      return make_branch_from_node(out.toHson().parse());
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
