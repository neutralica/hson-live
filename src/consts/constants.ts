// consts.types.ts

import { HsonNode } from "../types/node.types.js";


/***************************************************************
 * HSON 2025 — core tag, sentinel, and metadata constants
 *
 * This module defines the canonical identifiers used throughout
 * the HSON system: the VSN (Virtual Structural Node) tag set,
 * render-target markers, stable metadata keys, and the runtime
 * identity/DOM-bridge configuration.
 *
 * These constants form the vocabulary of the HsonNode graph.
 * Everything else in the pipeline—parsers, serializers,
 * validators, LiveTree, LiveMap, transform passes—depends on
 * them behaving exactly and immutably as specified here.
 *
 * The goals of this module are:
 *   • centralize all structural tag names and prefixes
 *   • ensure type-level exhaustiveness when matching on node tags
 *   • maintain forward-compatible metadata conventions (`data-_`)
 *   • provide stable keys for identity (QUID), transit attributes,
 *     and render-pipeline selection
 *
 * Any change to these symbols should be treated as a protocol
 * change to the entire HSON ecosystem.
 ***************************************************************/

/***************************************************************
 * NODE_ELEMENT_MAP
 *
 * WeakMap<HsonNode, Element>
 *
 * Runtime bridge linking a hydrated DOM Element to its logical
 * HSON node. Populated by LiveTree mounting routines and used for:
 *
 *   - efficient DOM updates,
 *   - reverse lookups (element → node),
 *   - preserving identity across re-render passes.
 *
 * As a WeakMap, nodes and elements are eligible for GC once no
 * external references remain.
 ***************************************************************/
export const NODE_ELEMENT_MAP = new WeakMap<HsonNode, Element>();

/***************************************************************
 * _FALSE / FALSE_TYPE / _ERROR
 *
 * System-wide sentinel constants used by HSON transforms and
 * Result-like helpers:
 *
 *   - `_FALSE` is a literal marker for "unsuccessful but not an
 *     exceptional error". It’s distinct from boolean `false` to
 *     prevent accidental truthiness logic or JSON confusion.
 *
 *   - `FALSE_TYPE` is the literal type of `_FALSE`, allowing
 *     discriminated unions in transform code.
 *
 *   - `_ERROR` is a string tag used by legacy or intermediate
 *     code paths that surface structured errors prior to wrapping
 *     in ErrReport/Result objects.
 *
 * These values are intentionally string literals, never booleans.
 ***************************************************************/
export const $_FALSE = '_false' as const;
export type FalseType = typeof $_FALSE;
export const $_ERROR = '_error' as const;

/***************************************************************
 * Virtual Structural Node (VSN) tags
 *
 * HSON defines a small, closed set of structural markers
 * (`_str`, `_val`, `_obj`, `_arr`, `_elem`, `_ii`, `_root`) that
 * encode the logical shape of the document tree. These tags are
 * the *only* valid `_tag` values on HsonNode objects.
 *
 *   - `_str`   : leaf wrapper for string primitives
 *   - `_val`   : leaf wrapper for non-string primitives
 *   - `_obj`   : object-like node holding property nodes
 *   - `_arr`   : array node containing `_ii` index nodes
 *   - `_ii`    : index wrapper (exactly one child), always under `_arr`
 *   - `_elem`  : HTML element bridge node
 *   - `_root`  : top-level container (0–1 child)
 *
 * These tags are used by the parser, serializer, validator
 * (assert_invariants), LiveTree, and all transformation passes.
 ***************************************************************/
export const STR_TAG = '_str' as const;
export const VAL_TAG = '_val' as const;
export const ROOT_TAG = '_root' as const;
export const II_TAG = '_ii' as const;
export const OBJ_TAG = '_obj' as const;
export const ARR_TAG = '_arr' as const;
export const ELEM_TAG = '_elem' as const;

/***************************************************************
 * VSN_TAGS
 *
 * Enumerates every Virtual Structural Node tag *except* `_root`.
 * Useful for:
 *   - validating shape without special-casing `_root`,
 *   - filtering nodes for general transforms,
 *   - pattern-matching where the root container is excluded.
 *
 * Order is insignificant; membership is the key.
 ***************************************************************/
export const VSN_TAGS: string[] = [
  II_TAG, ARR_TAG, ELEM_TAG, OBJ_TAG, STR_TAG, VAL_TAG,
] as const;

/***************************************************************
 * EVERY_VSN
 *
 * Complete set of all structural HSON node tags, including
 * `_root`. Used in strict validators, generic transforms,
 * and any code requiring exhaustive tag coverage.
 ***************************************************************/
export const EVERY_VSN: string[] = [
  II_TAG, ARR_TAG, ELEM_TAG, OBJ_TAG, STR_TAG, VAL_TAG, ROOT_TAG,
] as const;

/***************************************************************
 * VSNTag (type)
 *
 * Union type of every non-root VSN tag. Provides precise typing
 * for functions that operate on structural nodes but explicitly
 * exclude `_root` (e.g., recursive transforms, node constructors).
 ***************************************************************/
export type VSNTag = typeof VSN_TAGS[number];

/***************************************************************
 * LEAF_NODES
 *
 * Convenience list of tags for leaf-value wrappers:
 *   - `_str`
 *   - `_val`
 *
 * These nodes always contain exactly one primitive in `_content`.
 ***************************************************************/
export const LEAF_NODES = [STR_TAG, VAL_TAG] as string[];

/***************************************************************
 * ELEM_OBJ_ARR
 *
 * Small grouping for transforms that treat `_elem`, `_obj`,
 * and `_arr` as the “container” trio. For example, node comparison,
 * normalization, and serializer decisions.
 ***************************************************************/
export const ELEM_OBJ_ARR = [ELEM_TAG, ARR_TAG, OBJ_TAG] as string[];

/***************************************************************
 * ELEM_OBJ
 *
 * Mini-group used when `_arr` must be excluded — typically in
 * transforms where array indexing rules (_ii) would complicate
 * processing, but element vs. object containers remain compatible.
 ***************************************************************/
export const ELEM_OBJ = [ELEM_TAG, OBJ_TAG];

/***************************************************************
 * ElemObjType (type)
 *
 * Literal type union of `_elem` | `_obj`. Used for functions that
 * accept only these container forms (e.g., HTML bridge or object
 * normalization routines).
 ***************************************************************/
export type ElemObjType = typeof ELEM_TAG | typeof OBJ_TAG;

/***************************************************************
 * ElemObjArrType (type)
 *
 * Literal tuple-type for `['_elem','_arr','_obj']`. Useful where
 * array membership or exhaustive mapping is required at the type
 * level instead of runtime.
 ***************************************************************/
export type ElemObjArrType = typeof ELEM_OBJ_ARR;;

/***************************************************************
 * Render-target constants
 *
 * Used by HSON's rendering and transformation framework to select
 * an output channel:
 *
 *   - `hson`  : internal HSON tree representation
 *   - `json`  : JSON-compatible value structure
 *   - `html`  : serialized HTML string
 *   - `nodes` : hydrated DOM nodes (for LiveTree)
 *
 * `$RENDER` bundles these into a single frozen lookup object
 * for ergonomic referencing and exhaustiveness checks.
 ***************************************************************/
export const $HSON = 'hson' as const;
export const $JSON = 'json' as const;
export const $HTML = 'html' as const;
export const $NODES = 'nodes' as const;
export const $RENDER = { HSON: $HSON, HTML: $HTML, JSON: $JSON, NODES: $NODES } as const;

/***************************************************************
 * $HSON_FRAME
 *
 * High-level modes for HSON rendering pipelines:
 *   - `generate`: permissive, constructs missing scaffolding
 *   - `standard`: strict, round-trippable, spec-accurate output
 *   - `subset`  : restricted mode for sandbox/UI transforms
 *
 * Serializers pick behavior based on these frame constants.
 ***************************************************************/
export const $HSON_FRAME = {
  GEN: 'generate',
  STD: 'standard',
  SUBSET: 'subset',
} as const;

/***************************************************************
 * HSON metadata constants
 *
 * `_META_DATA_PREFIX`:
 *     Reserved prefix for all legal `_meta` keys (`"data-_*"`).
 *     Enforced by assert_invariants and assertNewShapeQuick.
 *
 * `_DATA_INDEX`:
 *     Fixed key (`"data-_index"`) used by `_ii` nodes to store
 *     their canonical array index as a string.
 *
 * `_DATA_QUID`:
 *     Stable identity key (`"data-_quid"`) inserted into `_meta`
 *     when a node receives a QUID (unique identifier).
 *     Enables DOM↔HsonNode tracking and LiveTree operations.
 ***************************************************************/
export const _META_DATA_PREFIX = 'data-_';
export const _DATA_INDEX = 'data-_index';
export const _DATA_QUID = 'data-_quid';

/***************************************************************
 * Transit-attribute markers
 *
 * `_TRANSIT_PREFIX` (`"data--"`):
 *     Namespace reserved for ephemeral attributes used during
 *     transformation or DOM bridging. These attributes are never
 *     serialized to final output.
 *
 * `_TRANSIT_ATTRS`:
 *     Canonical key `"data--attrmap"`, storing the temporary
 *     attribute-map snapshot used during node→DOM→node cycles.
 ***************************************************************/
export const _TRANSIT_PREFIX = 'data--';  
export const _TRANSIT_ATTRS = `${_TRANSIT_PREFIX}attrmap`;
