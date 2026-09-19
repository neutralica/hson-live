import { assert_invariants } from "../../core/assert-invariants.js";
import { canonical_hson_graph_equal } from "../../core/canonical-hson-equal.js";
import { ELEM_TAG, HSON_SYS_PREFIX, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { _throw_transform_err } from "../../core/errors.js";
import { is_Node } from "../../core/node-guards.js";
import { classify_ordinary_hson_structure } from "../../core/hson-structural-mode.js";
import type { HsonNode } from "../../core/types.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { serialize_hson_owned_document_content } from "../transform/serializers/serialize-hson.js";
import type { HsonCanonical } from "../transform/transform.types.js";
import { scan_ingested_hson_node_quids } from "../transform/utils/hson-utils/quid-ingress.js";

let wrap_hson_document: (root: HsonNode) => ExactDocumentCarrier;
const hson_document_roots = new WeakMap<object, HsonNode>();
const hson_document_construction_authority = Object.freeze({});

type AdmissionState = Readonly<{
  active: WeakMap<object, string>;
}>;

function fail_admission(path: string, message: string, cause?: unknown): never {
  throw new TypeError(
    `ExactDocumentCarrier node admission failed at ${path}: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}

function reflect_once<T>(path: string, operation: string, inspect: () => T): T {
  try {
    return inspect();
  } catch (cause) {
    return fail_admission(path, `${operation} failed`, cause);
  }
}

function inspect_plain_record(value: object, path: string): readonly PropertyKey[] {
  const prototype = reflect_once(path, "reading object prototype", () => Object.getPrototypeOf(value));
  if (prototype !== Object.prototype && prototype !== null) {
    return fail_admission(path, "object prototype must be Object.prototype or null");
  }
  return reflect_once(path, "reading own keys", () => Reflect.ownKeys(value));
}

function own_enumerable_value(value: object, key: PropertyKey, path: string): unknown {
  const descriptor = reflect_once(path, "reading an own property descriptor", () => (
    Reflect.getOwnPropertyDescriptor(value, key)
  ));
  if (descriptor === undefined) return fail_admission(path, "own property disappeared during admission");
  if (!descriptor.enumerable) return fail_admission(path, "properties must be enumerable");
  if (!("value" in descriptor)) return fail_admission(path, "accessor properties are not supported");
  return descriptor.value;
}

function enter(value: object, path: string, state: AdmissionState): void {
  const origin = state.active.get(value);
  if (origin !== undefined) return fail_admission(path, `cycle returns to ${origin}`);
  state.active.set(value, path);
}

function copy_array(value: unknown[], path: string, state: AdmissionState): unknown[] {
  const prototype = reflect_once(path, "reading array prototype", () => Object.getPrototypeOf(value));
  if (prototype !== Array.prototype) return fail_admission(path, "array prototype must be Array.prototype");
  const keys = reflect_once(path, "reading array keys", () => Reflect.ownKeys(value));
  let length = -1;
  const indexed = new Map<number, unknown>();

  for (const key of keys) {
    if (typeof key === "symbol") return fail_admission(path, "symbol-keyed properties are not supported");
    const keyPath = `${path}[${JSON.stringify(key)}]`;
    const descriptor = reflect_once(keyPath, "reading an array property descriptor", () => (
      Reflect.getOwnPropertyDescriptor(value, key)
    ));
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail_admission(keyPath, "array accessors are not supported");
    }
    if (key === "length") {
      if (!Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
        return fail_admission(path, "array length is invalid");
      }
      length = descriptor.value;
      continue;
    }
    if (!descriptor.enumerable) return fail_admission(keyPath, "array items must be enumerable");
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || String(index) !== key) {
      return fail_admission(keyPath, "extra array properties are not supported");
    }
    indexed.set(index, descriptor.value);
  }

  if (length < 0 || indexed.size !== length) return fail_admission(path, "array must be dense");
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!indexed.has(index)) return fail_admission(path, `array is sparse at index ${index}`);
    copy.push(copy_value(indexed.get(index), `${path}[${index}]`, state));
  }
  return copy;
}

function copy_record(value: object, path: string, state: AdmissionState): Record<string, unknown> {
  const keys = inspect_plain_record(value, path);
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key === "symbol") return fail_admission(path, "symbol-keyed properties are not supported");
    const childPath = `${path}[${JSON.stringify(key)}]`;
    const child = own_enumerable_value(value, key, childPath);
    Object.defineProperty(copy, key, {
      value: copy_value(child, childPath, state),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

function copy_value(value: unknown, path: string, state: AdmissionState): unknown {
  if (value === null || typeof value === "string" || typeof value === "number"
    || typeof value === "boolean" || value === undefined) return value;
  if (typeof value !== "object") return fail_admission(path, `${typeof value} values are not supported`);

  enter(value, path, state);
  try {
    return Array.isArray(value)
      ? copy_array(value, path, state)
      : copy_record(value, path, state);
  } finally {
    state.active.delete(value);
  }
}

function copy_node_input(input: HsonNode): HsonNode {
  const copied = copy_value(input, "$", { active: new WeakMap() });
  if (typeof copied !== "object" || copied === null || Array.isArray(copied)) {
    return fail_admission("$", "document input must be a canonical HsonNode");
  }
  if (!is_Node(copied) || !Array.isArray(copied.$_content)) {
    return fail_admission("$", "document input must own string $_tag and array $_content fields");
  }
  assert_exact_node_fields(copied, "$", new WeakSet());
  return copied;
}

function assert_exact_node_fields(node: HsonNode, path: string, seen: WeakSet<object>): void {
  if (seen.has(node)) return;
  seen.add(node);
  const allowed = new Set(["$_tag", "$_content", "$_attrs", "$_meta"]);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) return fail_admission(`${path}[${JSON.stringify(key)}]`, "unknown HsonNode field");
  }
  for (let index = 0; index < node.$_content.length; index += 1) {
    const child = node.$_content[index];
    if (is_Node(child)) assert_exact_node_fields(child, `${path}.$_content[${index}]`, seen);
  }
}

function normalize_owned_document_boundary(node: HsonNode): HsonNode {
  // Validate before discarding a structural wrapper so attrs/meta can never be
  // hidden by boundary normalization.
  assert_invariants(node, "ExactDocumentCarrier document boundary");

  if (node.$_tag === ROOT_TAG) {
    if (node.$_content.length !== 1) return node;
    const only = node.$_content[0];
    if (!is_Node(only) || only.$_tag !== ELEM_TAG) return node;
    return { $_tag: ROOT_TAG, $_content: only.$_content.slice() };
  }
  if (node.$_tag === ELEM_TAG) {
    return { $_tag: ROOT_TAG, $_content: node.$_content.slice() };
  }
  if (node.$_tag === STR_TAG) {
    return { $_tag: ROOT_TAG, $_content: [node] };
  }
  if (!node.$_tag.startsWith(HSON_SYS_PREFIX)) {
    const structure = classify_ordinary_hson_structure(node);
    if (structure.kind === "empty-element" || structure.kind === "element") {
      return { $_tag: ROOT_TAG, $_content: [node] };
    }
  }
  return fail_admission("$", "node is not document-context Hson content");
}

function qualify_exact_document_root(root: HsonNode): void {
  scan_ingested_hson_node_quids(root, "ExactDocumentCarrier");
  if (root.$_tag !== ROOT_TAG) return fail_admission("$", "private document graph must use _hson_root");
  for (let index = 0; index < root.$_content.length; index += 1) {
    const item = root.$_content[index];
    if (!is_Node(item) || (item.$_tag !== STR_TAG && item.$_tag.startsWith(HSON_SYS_PREFIX))) {
      return fail_admission(
        `$.$_content[${index}]`,
        "document root content must be _hson_str or an ordinary element",
      );
    }
  }

  const source = serialize_hson_owned_document_content(root);
  const reparsed = normalize_owned_document_boundary(parse_hson(source, {
    allowTopLevelDocumentText: true,
  }));
  if (!canonical_hson_graph_equal(root, reparsed)) {
    _throw_transform_err(
      "ExactDocumentCarrier input is canonical document structure but is not exactly closed under Hson notation",
      "ExactDocumentCarrier.fromNode",
      undefined,
      undefined,
      {
        code: "HSON_DOCUMENT_NOTATION_CLOSURE",
        stage: "canonical-document-admission",
        path: "$",
      },
    );
  }
}

function deep_freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) deep_freeze(descriptor.value, seen);
  }
  Object.freeze(value);
}

function assert_deeply_frozen(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (!Object.isFrozen(value)) throw new TypeError("Owned ExactDocumentCarrier roots must be deeply frozen.");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) assert_deeply_frozen(descriptor.value, seen);
  }
}

function admit_owned_document_root(root: HsonNode): ExactDocumentCarrier {
  qualify_exact_document_root(root);
  deep_freeze(root);
  return wrap_hson_document(root);
}

function is_hson_document(value: unknown): value is ExactDocumentCarrier {
  return typeof value === "object" && value !== null && hson_document_roots.has(value);
}

/**
 * One immutable exact canonical Hson value in document context.
 *
 * Zero, one, and many top-level items are the same document semantic kind;
 * `_hson_root` is private structural machinery rather than authored content.
 */
export class ExactDocumentCarrier {
  declare private readonly hsonDocumentNominal: void;

  private constructor(root: HsonNode, authority: object) {
    if (authority !== hson_document_construction_authority) {
      throw new TypeError("ExactDocumentCarrier construction is controlled by ExactDocumentCarrier.fromHson or ExactDocumentCarrier.fromNode.");
    }
    hson_document_roots.set(this, root);
    Object.freeze(this);
  }

  static {
    wrap_hson_document = (root) => new ExactDocumentCarrier(root, hson_document_construction_authority);
  }

  /** Parse exact document-context Hson, including zero-length empty documents. */
  static fromHson(source: HsonCanonical): ExactDocumentCarrier {
    if (typeof source !== "string") throw new TypeError("ExactDocumentCarrier.fromHson requires canonical Hson source text.");
    const parsed = parse_hson(source, { allowTopLevelDocumentText: true });
    return admit_owned_document_root(normalize_owned_document_boundary(parsed));
  }

  /** Safely copy and admit exact notation-closed document-context Hson. */
  static fromNode(node: HsonNode): ExactDocumentCarrier {
    return admit_owned_document_root(normalize_owned_document_boundary(copy_node_input(node)));
  }

  /** Exact canonical graph equality with no serialization or normalization. */
  equals(other: ExactDocumentCarrier): boolean {
    return is_hson_document(other)
      && canonical_hson_graph_equal(hson_document_root(this), hson_document_root(other));
  }

  /** Serialize the complete document through the owned-document Hson boundary. */
  toHson(): HsonCanonical {
    return serialize_hson_owned_document_content(hson_document_root(this));
  }

  /** Return a fresh mutable detached clone of the always-rooted document graph. */
  toNode(): HsonNode {
    return copy_node_input(hson_document_root(this));
  }
}

/** @internal Read the deeply frozen private root after runtime nominal validation. */
export function hson_document_root(value: ExactDocumentCarrier): HsonNode {
  const root = hson_document_roots.get(value);
  if (root === undefined) throw new TypeError("Expected a genuine ExactDocumentCarrier value.");
  return root;
}

/**
 * @internal Wrap a newly allocated, already validated, deeply frozen document
 * root supplied by trusted hson-live internals without cloning it.
 */
export function hson_document_from_owned_root(root: HsonNode): ExactDocumentCarrier {
  assert_deeply_frozen(root);
  assert_invariants(root, "hson_document_from_owned_root");
  qualify_exact_document_root(root);
  return wrap_hson_document(root);
}
