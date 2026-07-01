// livemap-editor.ts


import { HsonNode, JsonValue, Primitive } from "../../core/types.js";
import { is_Node } from "../../core/node-guards.js";
import { LivePathPart, LivePath, LiveMapEditResult } from "./livemap.types.js";
import { _DATA_INDEX, _HSON_, ARR_TAG, II_TAG, OBJ_TAG, STR_TAG, VAL_TAG } from "../../core/constants.js";
import { CREATE_NODE } from "../../core/factories.js";
import { format_live_path } from "./path.js";

/**
 * Parent resolution for a projected LiveMap path.
 *
 * `parent` is the value node that owns the final path segment. For the first
 * mutation slice this must be an object value node. `key` is the final projected
 * path segment to read or write under that parent.
 */
type ResolvedParent = Readonly<{
  parent: HsonNode;
  key: LivePathPart;
}>;

/**
 * Read the projected JSON value at a LiveMap path.
 *
 * This is the editor's read entry point. It resolves the projected path through
 * HSON wrapper nodes, unwraps the value payload, and converts that value node
 * back into ordinary JSON-ish data.
 */
export function snap_live_path(root: HsonNode, path: LivePath): JsonValue | undefined {
  const valueNode = resolve_value_node(root, path);
  if (valueNode === undefined) return undefined;
  return node_to_json_value(valueNode);
}

/**
 * Resolve a projected path to the value payload node at that path.
 *
 * Example: for `["user", "name"]`, this returns the `_hson_str` or `_hson_val`
 * payload inside the `name` property wrapper, not the `name` wrapper itself.
 */
export function resolve_value_node(root: HsonNode, path: LivePath): HsonNode | undefined {
  const wrapper = resolve_wrapper_node(root, path);
  if (wrapper === undefined) return undefined;
  return unwrap_value_payload(wrapper);
}

/**
 * Resolve a projected path to the wrapper node at that path.
 *
 * For object properties this is the user-key wrapper, such as a node with
 * `$_tag === "name"`. For array items this is the `_hson_ii` wrapper. Keeping
 * this separate from `resolve_value_node()` is important because mutation often
 * needs to replace or remove the wrapper, while reads usually want the payload.
 */
export function resolve_wrapper_node(root: HsonNode, path: LivePath): HsonNode | undefined {
  let current: HsonNode | undefined = root;

  for (const part of path) {
    const valueNode = unwrap_value_payload(current);
    if (valueNode === undefined) return undefined;

    current = find_child_wrapper(valueNode, part);
    if (current === undefined) return undefined;
  }

  return current;
}

/**
 * Resolve the parent value node for a projected path.
 *
 * This is the mutation-oriented resolver. Given `["user", "name"]`, it returns
 * the value node for `["user"]` plus the final key `"name"`.
 */
export function resolve_parent_node(root: HsonNode, path: LivePath): ResolvedParent | undefined {
  if (path.length === 0) return undefined;

  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = resolve_value_node(root, parentPath);

  if (parent === undefined) return undefined;
  return { parent, key };
}

/**
 * Set a projected object-property path to a JSON value.
 *
 * This is the first mutation slice and is intentionally narrow:
 * - it supports replacing or adding properties on an already-resolved object
 * - it does not replace the root yet
 * - it can replace existing array indexes
 * - it does not append or insert array items yet
 * - it does not auto-create missing parent containers yet
 *
 * The editor returns raw edit information. Core wraps that into commit/op form.
 */
export function set_live_path(root: HsonNode, path: LivePath, value: JsonValue): LiveMapEditResult {
  if (path.length === 0) {
    throw new Error("LiveMap editor cannot replace the root node yet.");
  }

  const prev = snap_live_path(root, path);
  const resolved = resolve_parent_node(root, path);

  if (resolved === undefined) {
    throw new Error(`LiveMap editor could not resolve parent path: ${format_live_path(path.slice(0, -1))}`);
  }

  write_child_value(resolved.parent, resolved.key, value, path);

  const next = snap_live_path(root, path);

  return {
    changed: !json_values_equal(prev, next),
    prev,
    next,
  };
}

/**
 * Delete a projected object-property path.
 *
 * This first delete slice is intentionally narrow:
 * - it can remove object properties from an already-resolved object
 * - missing object properties are unchanged, not errors
 * - it does not replace or delete the root
 * - it does not delete array indexes yet
 * - it does not auto-remove empty parent containers
 *
 * The editor returns raw edit information. Core wraps that into commit/op form.
 */
export function delete_live_path(root: HsonNode, path: LivePath): LiveMapEditResult {
  if (path.length === 0) {
    throw new Error("LiveMap editor cannot delete the root node yet.");
  }

  const prev = snap_live_path(root, path);
  const resolved = resolve_parent_node(root, path);

  if (resolved === undefined) {
    return {
      changed: false,
      prev,
      next: undefined,
    };
  }

  delete_child_value(resolved.parent, resolved.key, path);

  const next = snap_live_path(root, path);

  return {
    changed: !json_values_equal(prev, next),
    prev,
    next,
  };
}
/**
 * Write one projected child value under an already-resolved parent value node.
 *
 * Objects support property add/replace by string key. Arrays support replacing
 * an existing numeric index only. Array append/insert policy is intentionally
 * deferred until we decide how list mutation should be represented in ops.
 */
function write_child_value(parent: HsonNode, key: LivePathPart, value: JsonValue, path: LivePath): void {
  if (parent.$_tag === OBJ_TAG && typeof key === "string") {
    write_object_property(parent, key, value);
    return;
  }

  if (parent.$_tag === ARR_TAG && typeof key === "number") {
    write_array_index(parent, key, value, path);
    return;
  }

  throw new Error(`LiveMap editor cannot set this path yet: ${format_live_path(path)}`);
}

/**
 * Add or replace an object property wrapper.
 *
 * Missing object properties are allowed because object shape can expand without
 * needing list insertion semantics.
 */
function write_object_property(parent: HsonNode, key: string, value: JsonValue): void {
  const nextWrapper = make_object_property_wrapper(key, value);
  const existingIndex = parent.$_content.findIndex((child) => is_Node(child) && child.$_tag === key);

  if (existingIndex === -1) {
    parent.$_content.push(nextWrapper);
  } else {
    parent.$_content[existingIndex] = nextWrapper;
  }
}

/**
 * Replace an existing array item wrapper by numeric index.
 *
 * Missing indexes throw for now. That keeps this first array mutation slice to
 * deterministic replacement and avoids deciding append/sparse-array behavior.
 */
function write_array_index(parent: HsonNode, index: number, value: JsonValue, path: LivePath): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`LiveMap editor cannot set invalid array index: ${format_live_path(path)}`);
  }

  const existingIndex = parent.$_content.findIndex((child) => {
    if (!is_Node(child) || child.$_tag !== II_TAG) return false;
    return child.$_meta?.[_DATA_INDEX] === String(index);
  });

  if (existingIndex === -1) {
    throw new Error(`LiveMap editor cannot append or insert array indexes yet: ${format_live_path(path)}`);
  }

  parent.$_content[existingIndex] = make_array_item_wrapper(index, value);
}

/**
 * Delete one projected child value under an already-resolved parent value node.
 *
 * Objects support property deletion by string key. Arrays are deliberately not
 * supported yet because index deletion needs an explicit shifting/hole policy.
 */
function delete_child_value(parent: HsonNode, key: LivePathPart, path: LivePath): void {
  if (parent.$_tag === OBJ_TAG && typeof key === "string") {
    delete_object_property(parent, key);
    return;
  }

  if (parent.$_tag === ARR_TAG && typeof key === "number") {
    throw new Error(`LiveMap editor cannot delete array indexes yet: ${format_live_path(path)}`);
  }

  throw new Error(`LiveMap editor cannot delete this path yet: ${format_live_path(path)}`);
}

/**
 * Remove an object property wrapper when it exists.
 *
 * Missing properties are no-ops so callers can treat delete as idempotent.
 */
function delete_object_property(parent: HsonNode, key: string): void {
  const existingIndex = parent.$_content.findIndex((child) => is_Node(child) && child.$_tag === key);
  if (existingIndex === -1) return;
  parent.$_content.splice(existingIndex, 1);
}

/**
 * Convert a HSON value node into projected JSON data.
 *
 * This intentionally understands LiveMap's JSON-facing projection, not every
 * possible HTML/document traversal case. Unknown/user element nodes fall back to
 * object projection for now because LiveMap v0.1 is focused on data-shaped HSON.
 */
export function node_to_json_value(node: HsonNode): JsonValue {
  switch (node.$_tag) {
    case STR_TAG:
      return string_node_to_value(node);
    case VAL_TAG:
      return primitive_node_to_value(node);
    case OBJ_TAG:
      return object_node_to_value(node);
    case ARR_TAG:
      return array_node_to_value(node);
    default:
      return object_node_to_value(node);
  }
}

/**
 * Find the child wrapper for one projected path segment.
 *
 * Object paths use string keys and find user-tag wrappers. Array paths use
 * numeric indexes and find `_hson_ii` wrappers by `data-_index` metadata.
 */
function find_child_wrapper(parentValueNode: HsonNode, part: LivePathPart): HsonNode | undefined {
  if (parentValueNode.$_tag === OBJ_TAG && typeof part === "string") {
    return parentValueNode.$_content.find((child) => is_Node(child) && child.$_tag === part) as HsonNode | undefined;
  }

  if (parentValueNode.$_tag === ARR_TAG && typeof part === "number") {
    return parentValueNode.$_content.find((child) => {
      if (!is_Node(child) || child.$_tag !== II_TAG) return false;
      return child.$_meta?.[_DATA_INDEX] === String(part);
    }) as HsonNode | undefined;
  }

  return undefined;
}

/**
 * Convert a wrapper node to its value payload.
 *
 * Value nodes are already their own payload. User-key wrappers and `_hson_ii`
 * wrappers should contain one value node as their first child.
 */
function unwrap_value_payload(wrapper: HsonNode): HsonNode | undefined {
  if (is_value_node(wrapper)) return wrapper;

  const [first] = wrapper.$_content;
  if (!is_Node(first)) return undefined;
  return first;
}

/**
 * Return true for HSON nodes that represent actual JSON-facing values.
 *
 * These are the nodes LiveMap reads as values rather than wrappers or structural
 * containers around values.
 */
function is_value_node(node: HsonNode): boolean {
  return node.$_tag === OBJ_TAG || node.$_tag === ARR_TAG || node.$_tag === STR_TAG || node.$_tag === VAL_TAG;
}

/**
 * Project a `_hson_str` node to a JavaScript string.
 *
 * Invalid or empty string nodes currently project as the empty string rather
 * than throwing; invariant enforcement belongs elsewhere.
 */
function string_node_to_value(node: HsonNode): string {
  const [first] = node.$_content;
  return typeof first === "string" ? first : "";
}

/**
 * Project a `_hson_val` node to a non-string primitive.
 *
 * `_hson_val` is expected to carry number, boolean, or null. Malformed payloads
 * project as null for this early reader slice.
 */
function primitive_node_to_value(node: HsonNode): Primitive {
  const [first] = node.$_content;
  if (is_Node(first)) return null;
  if (first === undefined) return null;
  return first;
}

/**
 * Project an object-shaped value node to a plain JSON object.
 *
 * User-tag child wrappers become object keys. Internal `_hson_*` structural
 * children are skipped so VSN machinery does not leak into projected JSON.
 */
function object_node_to_value(node: HsonNode): JsonValue {
  const out: Record<string, JsonValue> = {};

  for (const child of node.$_content) {
    if (!is_Node(child)) continue;
    if (child.$_tag.startsWith(_HSON_)) continue;

    const payload = unwrap_value_payload(child);
    if (payload === undefined) continue;

    out[child.$_tag] = node_to_json_value(payload);
  }

  return out;
}

/**
 * Project an array-shaped value node to a JSON array.
 *
 * Array item wrappers are sorted by their `data-_index` metadata. Invalid,
 * missing, or negative indexes are ignored for now rather than repaired here.
 */
function array_node_to_value(node: HsonNode): JsonValue[] {
  const indexed: Array<Readonly<{ index: number; value: JsonValue }>> = [];

  for (const child of node.$_content) {
    if (!is_Node(child) || child.$_tag !== II_TAG) continue;

    const rawIndex = child.$_meta?.[_DATA_INDEX];
    if (rawIndex === undefined) continue;

    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) continue;

    const payload = unwrap_value_payload(child);
    if (payload === undefined) continue;

    indexed.push({ index, value: node_to_json_value(payload) });
  }

  indexed.sort((a, b) => a.index - b.index);
  return indexed.map((entry) => entry.value);
}

/**
 * Create the user-key wrapper for an object property.
 *
 * The wrapper tag is the object key. Its first child is the HSON value node that
 * represents the assigned JSON value.
 */
function make_object_property_wrapper(key: string, value: JsonValue): HsonNode {
  return CREATE_NODE({
    $_tag: key,
    $_content: [json_value_to_node(value)],
  });
}

/**
 * Create the `_hson_ii` wrapper for an array item.
 *
 * The item index is stored in `data-_index`, matching the canonical HSON array
 * representation used by the parser/serializer pipeline.
 */
function make_array_item_wrapper(index: number, value: JsonValue): HsonNode {
  return CREATE_NODE({
    $_tag: II_TAG,
    $_content: [json_value_to_node(value)],
    $_meta: { [_DATA_INDEX]: String(index) },
  });
}

/**
 * Convert projected JSON data into the corresponding HSON value node.
 *
 * This is the editor-local writer equivalent of `node_to_json_value()`. It is
 * deliberately small for now and should eventually align with the transform
 * constructor path or move into a shared LiveMap projection helper if reused.
 */
function json_value_to_node(value: JsonValue): HsonNode {
  if (typeof value === "string") return make_value_node(STR_TAG, [value]);
  if (value === null || typeof value === "number" || typeof value === "boolean") return make_value_node(VAL_TAG, [value]);
  if (Array.isArray(value)) return json_array_to_node(value);
  return json_object_to_node(value);
}

/**
 * Convert a plain object into an `_hson_obj` value node.
 *
 * Each object entry becomes a user-key wrapper containing one value payload.
 */
function json_object_to_node(value: Readonly<Record<string, JsonValue>>): HsonNode {
  return make_value_node(
    OBJ_TAG,
    Object.entries(value).map(([key, entry]) => make_object_property_wrapper(key, entry)),
  );
}

/**
 * Convert a JSON array into an `_hson_arr` value node.
 *
 * Each entry becomes an `_hson_ii` wrapper with `data-_index` metadata and one
 * value payload child.
 */
function json_array_to_node(value: readonly JsonValue[]): HsonNode {
  return make_value_node(
    ARR_TAG,
    value.map((entry, index) => CREATE_NODE({
      $_tag: II_TAG,
      $_content: [json_value_to_node(entry)],
      $_meta: { [_DATA_INDEX]: String(index) },
    })),
  );
}

/**
 * Create a HSON value node with normalized node defaults.
 *
 * All node construction goes through `CREATE_NODE` so metadata/content defaults
 * stay consistent with core node construction.
 */
function make_value_node(tag: string, content: HsonNode[] | Primitive[]): HsonNode {
  return CREATE_NODE({
    $_tag: tag,
    $_content: content,
  });
}

/**
 * Compare projected JSON values for change detection.
 *
 * This is intentionally simple for the first editor slice. Later, if object key
 * order or richer values become an issue, this should move to a shared stable
 * equality helper.
 */
function json_values_equal(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return preview_json_value(a) === preview_json_value(b);
}

/**
 * Serialize projected JSON for internal comparison/debug output.
 *
 * `undefined` is not JSON, so it gets a distinct sentinel string.
 */
function preview_json_value(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

