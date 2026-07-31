import { ELEM_TAG, HSON_SYS_PREFIX, OBJ_TAG, ROOT_TAG } from "./constants.js";
import type { HsonNode } from "./types.js";

export type CanonicalHsonDifferenceKind =
  | "array-index-difference"
  | "attribute-presence"
  | "attribute-value"
  | "content-length"
  | "content-ordering"
  | "field-presence"
  | "metadata-presence"
  | "metadata-value"
  | "negative-zero-mismatch"
  | "node-name-mismatch"
  | "quid-difference"
  | "root-leakage"
  | "scalar-value-mismatch"
  | "structural-mode-mismatch"
  | "value-type-mismatch"
  | "vsn-mismatch";

export type CanonicalHsonDifference = Readonly<{
  kind: CanonicalHsonDifferenceKind;
  path: string;
  message: string;
  left?: unknown;
  right?: unknown;
  content?: "missing-node" | "extra-node";
}>;

type ComparisonState = {
  readonly active: WeakMap<object, WeakSet<object>>;
  readonly detectOrdering: boolean;
};

function difference(
  kind: CanonicalHsonDifferenceKind,
  path: string,
  message: string,
  left?: unknown,
  right?: unknown,
  content?: "missing-node" | "extra-node",
): CanonicalHsonDifference {
  return Object.freeze({
    kind,
    path,
    message,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    ...(content === undefined ? {} : { content }),
  });
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is_node_record(value: unknown): value is HsonNode {
  return is_record(value)
    && typeof value.$_tag === "string"
    && Array.isArray(value.$_content);
}

function has_seen_pair(state: ComparisonState, left: object, right: object): boolean {
  const rights = state.active.get(left);
  if (rights?.has(right)) return true;
  if (rights === undefined) state.active.set(left, new WeakSet([right]));
  else rights.add(right);
  return false;
}

function finite_number(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`[HSON equality] invalid HSON number ${String(value)}; numbers must be finite`);
  }
}

function values_equal(left: unknown, right: unknown): boolean {
  return compare_value(left, right, "$", {
    active: new WeakMap(),
    detectOrdering: false,
  }) === undefined;
}

function arrays_are_permutations(left: readonly unknown[], right: readonly unknown[]): boolean {
  const consumed = new Set<number>();
  for (const leftValue of left) {
    let matched = false;
    for (let index = 0; index < right.length; index += 1) {
      if (consumed.has(index) || !values_equal(leftValue, right[index])) continue;
      consumed.add(index);
      matched = true;
      break;
    }
    if (!matched) return false;
  }
  return true;
}

function compare_array(
  left: readonly unknown[],
  right: readonly unknown[],
  path: string,
  state: ComparisonState,
): CanonicalHsonDifference | undefined {
  if (left.length !== right.length) {
    const content = left.length < right.length ? "missing-node" : "extra-node";
    return difference(
      "content-length",
      path,
      `content length differs (${left.length} versus ${right.length}; ${content})`,
      left.length,
      right.length,
      content,
    );
  }
  if (
    state.detectOrdering
    && left.some((value, index) => !values_equal(value, right[index]))
    && arrays_are_permutations(left, right)
  ) {
    return difference(
      "content-ordering",
      path,
      "content contains the same canonical values in a different order",
    );
  }
  for (let index = 0; index < left.length; index += 1) {
    const found = compare_value(left[index], right[index], `${path}[${index}]`, state);
    if (found !== undefined) return found;
  }
  return undefined;
}

function compare_named_record(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  path: string,
  state: ComparisonState,
  field: "attribute" | "metadata" | "record",
): CanonicalHsonDifference | undefined {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  const keys = [...new Set([...leftKeys, ...rightKeys])].sort();
  for (const key of keys) {
    const leftHas = Object.hasOwn(left, key);
    const rightHas = Object.hasOwn(right, key);
    const keyPath = `${path}.${key}`;
    if (leftHas !== rightHas) {
      const kind = field === "attribute"
        ? "attribute-presence"
        : field === "metadata"
          ? "metadata-presence"
          : "field-presence";
      return difference(kind, keyPath, `${field} field presence differs`, leftHas, rightHas);
    }
    const found = compare_value(left[key], right[key], keyPath, state);
    if (found === undefined) continue;
    if (field === "attribute") {
      return difference("attribute-value", keyPath, `attribute value differs: ${found.message}`, left[key], right[key]);
    }
    if (field === "metadata") {
      if (key === "quid") return difference("quid-difference", keyPath, "persisted QUID differs", left[key], right[key]);
      if (key === "index") return difference("array-index-difference", keyPath, "canonical array index differs", left[key], right[key]);
      return difference("metadata-value", keyPath, `metadata value differs: ${found.message}`, left[key], right[key]);
    }
    return found;
  }
  return undefined;
}

function compare_node(
  left: HsonNode,
  right: HsonNode,
  path: string,
  state: ComparisonState,
): CanonicalHsonDifference | undefined {
  if (left.$_tag !== right.$_tag) {
    const leftRoot = left.$_tag === ROOT_TAG;
    const rightRoot = right.$_tag === ROOT_TAG;
    if (leftRoot !== rightRoot) {
      return difference("root-leakage", `${path}.$_tag`, "one graph contains an unexpected root carrier", left.$_tag, right.$_tag);
    }
    if (
      (left.$_tag === OBJ_TAG && right.$_tag === ELEM_TAG)
      || (left.$_tag === ELEM_TAG && right.$_tag === OBJ_TAG)
    ) {
      return difference("structural-mode-mismatch", `${path}.$_tag`, "object and element structural modes differ", left.$_tag, right.$_tag);
    }
    const leftVsn = left.$_tag.startsWith(HSON_SYS_PREFIX);
    const rightVsn = right.$_tag.startsWith(HSON_SYS_PREFIX);
    return difference(
      leftVsn || rightVsn ? "vsn-mismatch" : "node-name-mismatch",
      `${path}.$_tag`,
      leftVsn || rightVsn ? "virtual structural node differs" : "node name differs",
      left.$_tag,
      right.$_tag,
    );
  }

  const leftHasAttrs = Object.hasOwn(left, "$_attrs");
  const rightHasAttrs = Object.hasOwn(right, "$_attrs");
  if (leftHasAttrs !== rightHasAttrs) {
    return difference("attribute-presence", `${path}.$_attrs`, "attribute container presence differs", leftHasAttrs, rightHasAttrs);
  }
  if (leftHasAttrs && rightHasAttrs) {
    const found = compare_named_record(left.$_attrs ?? {}, right.$_attrs ?? {}, `${path}.$_attrs`, state, "attribute");
    if (found !== undefined) return found;
  }

  const leftHasMeta = Object.hasOwn(left, "$_meta");
  const rightHasMeta = Object.hasOwn(right, "$_meta");
  if (leftHasMeta !== rightHasMeta) {
    return difference("metadata-presence", `${path}.$_meta`, "metadata container presence differs", leftHasMeta, rightHasMeta);
  }
  if (leftHasMeta && rightHasMeta) {
    const found = compare_named_record(
      (left.$_meta ?? {}) as Readonly<Record<string, unknown>>,
      (right.$_meta ?? {}) as Readonly<Record<string, unknown>>,
      `${path}.$_meta`,
      state,
      "metadata",
    );
    if (found !== undefined) return found;
  }

  return compare_array(left.$_content, right.$_content, `${path}.$_content`, state);
}

function compare_value(
  left: unknown,
  right: unknown,
  path: string,
  state: ComparisonState,
): CanonicalHsonDifference | undefined {
  finite_number(left);
  finite_number(right);
  if (Object.is(left, right)) return undefined;
  if (typeof left === "number" && typeof right === "number" && (Object.is(left, -0) || Object.is(right, -0))) {
    return difference("negative-zero-mismatch", path, "numeric values differ as 0 versus -0", left, right);
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return difference("value-type-mismatch", path, "value types differ", left, right);
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return difference("scalar-value-mismatch", path, "scalar values differ", left, right);
  }
  if (has_seen_pair(state, left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return difference("value-type-mismatch", path, "array and record values differ", left, right);
    }
    return compare_array(left, right, path, state);
  }
  if (!is_record(left) || !is_record(right)) {
    return difference("value-type-mismatch", path, "non-record values differ", left, right);
  }
  if (is_node_record(left) || is_node_record(right)) {
    if (!is_node_record(left) || !is_node_record(right)) {
      return difference("value-type-mismatch", path, "node and non-node records differ", left, right);
    }
    return compare_node(left, right, path, state);
  }
  return compare_named_record(left, right, path, state, "record");
}

/**
 * Return the first deterministic difference between supplied canonical graphs.
 * This traversal is strict: it performs no admission, normalization, sorting,
 * wrapper repair, metadata projection, or string coercion and never mutates an
 * operand.
 */
export function canonical_hson_graph_difference(
  left: HsonNode,
  right: HsonNode,
): CanonicalHsonDifference | undefined {
  return compare_value(left, right, "$", {
    active: new WeakMap(),
    detectOrdering: true,
  });
}

/** Strict canonical graph equality with no comparison-time transformation. */
export function canonical_hson_graph_equal(left: HsonNode, right: HsonNode): boolean {
  return canonical_hson_graph_difference(left, right) === undefined;
}
