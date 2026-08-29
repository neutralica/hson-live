import { assert_ordered_projected_value, is_ordered_projected_object } from "../../core/ordered-projected-value.js";
import { is_public_attr_name } from "../../core/public-attrs.js";
import {
  CANONICAL_CAPABILITY_KEYS,
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_FORMAT_LIMITS,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalCapabilityKey,
  type CanonicalDocumentAttrProperty,
  type CanonicalRefinementRule,
  type CanonicalSchemaGraph,
  type CanonicalSchemaNode,
  type CanonicalSchemaNodeRef,
  type VerifiedCanonicalSchemaGraph,
} from "./graph.js";
import type { CanonicalGraphVerification, CanonicalGraphVerificationIssue } from "./issues.js";

type UnknownRecord = Record<string, unknown>;

const PROJECTED_KINDS = new Set([
  "projected-any", "projected-string", "projected-number", "projected-boolean", "projected-null",
  "projected-literal", "projected-object", "projected-array", "projected-tuple", "projected-record",
  "projected-union", "projected-optional", "projected-nullable", "projected-ref", "projected-refinement",
]);
const DOCUMENT_ITEM_KINDS = new Set(["document-any-item", "document-text", "document-element", "document-item-union"]);
const DOCUMENT_CONTENT_KINDS = new Set(["document-broad-content", "document-sequence", "document-repeat", "document-content-union"]);

export function verify_canonical_schema_graph(input: unknown): CanonicalGraphVerification {
  const issues: CanonicalGraphVerificationIssue[] = [];
  const fail = (path: readonly (string | number)[], message: string): void => {
    issues.push(Object.freeze({ code: "INVALID_GRAPH", path: Object.freeze([...path]), message }));
  };
  if (!preflight_data(input, [], fail)) return invalid(issues);
  if (!is_record(input)) {
    fail([], "Canonical Schema graph must be an object.");
    return invalid(issues);
  }
  exact_fields(input, ["format", "version", "capabilities", "nodes", "semanticDiagnosticMetadata", "documentationMetadata"], [], fail);
  if (input.format !== CANONICAL_SCHEMA_FORMAT) fail(["format"], "Unsupported Canonical Schema format.");
  if (input.version !== CANONICAL_SCHEMA_VERSION) fail(["version"], "Unsupported Canonical Schema version.");
  if (!is_record(input.capabilities)) fail(["capabilities"], "Capabilities must be an object.");
  if (!Array.isArray(input.nodes)) fail(["nodes"], "Nodes must be an array.");
  if (!is_record(input.capabilities) || !Array.isArray(input.nodes)) return invalid(issues);

  const capabilities = input.capabilities;
  exact_fields(capabilities, CANONICAL_CAPABILITY_KEYS, ["capabilities"], fail);
  const nodes = input.nodes;
  if (nodes.length === 0) fail(["nodes"], "Node table must not be empty.");
  if (nodes.length > CANONICAL_SCHEMA_FORMAT_LIMITS.maxGraphNodes) {
    fail(["nodes"], `Node table exceeds the format limit of ${CANONICAL_SCHEMA_FORMAT_LIMITS.maxGraphNodes}.`);
    return invalid(issues);
  }
  let capabilityCount = 0;
  for (const key of CANONICAL_CAPABILITY_KEYS) {
    const ref = capabilities[key];
    if (ref === undefined) continue;
    capabilityCount += 1;
    check_ref(ref, ["capabilities", key], nodes.length, fail);
  }
  if (capabilityCount === 0) fail(["capabilities"], "At least one capability root is required.");

  nodes.forEach((node, index) => verify_node(node, index, nodes, fail));
  verify_metadata(input, nodes, fail);
  verify_capability_domains(capabilities, nodes, fail);
  verify_reachability_and_order(capabilities, nodes, fail);
  verify_productivity(nodes, fail);
  if (issues.length > 0) return invalid(issues);
  deep_freeze(input);
  return Object.freeze({ ok: true, graph: input as unknown as VerifiedCanonicalSchemaGraph });
}

function verify_node(
  input: unknown,
  index: number,
  nodes: readonly unknown[],
  fail: (path: readonly (string | number)[], message: string) => void,
): void {
  const path = ["nodes", index] as const;
  if (!is_record(input) || typeof input.kind !== "string") {
    fail(path, "Node must be an object with a discriminator.");
    return;
  }
  const node = input;
  const ref = (value: unknown, field: string): void => check_ref(value, [...path, field], nodes.length, fail);
  const refs = (value: unknown, field: string): void => {
    if (!Array.isArray(value)) { fail([...path, field], `${field} must be an array.`); return; }
    value.forEach((item, itemIndex) => check_ref(item, [...path, field, itemIndex], nodes.length, fail));
  };
  switch (node.kind) {
    case "projected-any": case "projected-string": case "projected-number": case "projected-boolean": case "projected-null":
    case "document-any-item": case "document-text": case "document-broad-content":
      exact_fields(node, ["kind"], path, fail); break;
    case "projected-literal":
      exact_fields(node, ["kind", "values"], path, fail);
      if (!Array.isArray(node.values) || node.values.length === 0) fail([...path, "values"], "Literal values must be a nonempty array.");
      else node.values.forEach((value, valueIndex) => {
        try { assert_ordered_projected_value(value); } catch { fail([...path, "values", valueIndex], "Literal is not a canonical projected value."); }
      });
      break;
    case "projected-object":
      exact_fields(node, ["kind", "exact", "properties"], path, fail);
      if (typeof node.exact !== "boolean") fail([...path, "exact"], "Object exact state must be boolean.");
      verify_pairs(node.properties, [...path, "properties"], nodes.length, fail);
      break;
    case "projected-array":
      exact_fields(node, ["kind", "item"], path, fail);
      if (node.item !== undefined) ref(node.item, "item");
      break;
    case "projected-tuple":
      exact_fields(node, ["kind", "items"], path, fail); refs(node.items, "items"); break;
    case "projected-record":
      exact_fields(node, ["kind", "value"], path, fail); ref(node.value, "value"); break;
    case "projected-union":
    case "document-item-union":
    case "document-content-union":
      exact_fields(node, ["kind", "choices"], path, fail);
      if (!Array.isArray(node.choices) || node.choices.length === 0) fail([...path, "choices"], "Union choices must be nonempty.");
      else refs(node.choices, "choices");
      break;
    case "projected-optional": case "projected-nullable":
      exact_fields(node, ["kind", "base"], path, fail); ref(node.base, "base"); break;
    case "projected-ref":
      exact_fields(node, ["kind", "target"], path, fail); ref(node.target, "target"); break;
    case "projected-refinement":
      exact_fields(node, ["kind", "base", "rule", "label"], path, fail);
      ref(node.base, "base"); verify_refinement(node.rule, [...path, "rule"], fail);
      if (node.label !== undefined && typeof node.label !== "string") fail([...path, "label"], "Refinement label must be a string.");
      break;
    case "document-element":
      exact_fields(node, ["kind", "tag", "attrs", "content"], path, fail);
      if (node.tag !== undefined && (typeof node.tag !== "string" || node.tag.length === 0 || node.tag.startsWith("_hson_"))) fail([...path, "tag"], "Element tag must be an ordinary nonempty tag.");
      if (node.attrs !== undefined) ref(node.attrs, "attrs");
      ref(node.content, "content");
      break;
    case "document-sequence":
      exact_fields(node, ["kind", "items"], path, fail); refs(node.items, "items"); break;
    case "document-repeat":
      exact_fields(node, ["kind", "item", "count"], path, fail); ref(node.item, "item");
      if (node.count !== undefined && (!Number.isSafeInteger(node.count) || (node.count as number) < 0)) fail([...path, "count"], "Repeat count must be a nonnegative safe integer.");
      break;
    case "document-fragment-root":
      exact_fields(node, ["kind", "content"], path, fail); ref(node.content, "content"); break;
    case "document-attrs":
      exact_fields(node, ["kind", "exact", "properties"], path, fail);
      if (typeof node.exact !== "boolean") fail([...path, "exact"], "Attrs exact state must be boolean.");
      verify_attrs(node.properties, [...path, "properties"], nodes.length, fail);
      break;
    default:
      fail([...path, "kind"], `Unknown node kind ${JSON.stringify(node.kind)}.`);
  }
}

function verify_pairs(value: unknown, path: readonly (string | number)[], size: number, fail: (path: readonly (string | number)[], message: string) => void): void {
  if (!Array.isArray(value)) { fail(path, "Properties must be an array."); return; }
  const names = new Set<string>();
  value.forEach((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") { fail([...path, index], "Property must be a [name, ref] pair."); return; }
    if (names.has(pair[0])) fail([...path, index, 0], `Duplicate property ${JSON.stringify(pair[0])}.`);
    names.add(pair[0]); check_ref(pair[1], [...path, index, 1], size, fail);
  });
}

function verify_attrs(value: unknown, path: readonly (string | number)[], size: number, fail: (path: readonly (string | number)[], message: string) => void): void {
  if (!Array.isArray(value)) { fail(path, "Attrs properties must be an array."); return; }
  const names = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = [...path, index];
    if (!is_record(item)) { fail(itemPath, "Attr property must be an object."); return; }
    exact_fields(item, item.flag === true ? ["name", "optional", "flag"] : ["name", "optional", "flag", "value"], itemPath, fail);
    if (!is_public_attr_name(item.name)) fail([...itemPath, "name"], "Attr name must be a canonical public attribute name.");
    else if (names.has(item.name)) fail([...itemPath, "name"], `Duplicate attr ${JSON.stringify(item.name)}.`);
    else names.add(item.name);
    if (typeof item.optional !== "boolean") fail([...itemPath, "optional"], "Attr optional state must be boolean.");
    if (typeof item.flag !== "boolean") fail([...itemPath, "flag"], "Attr flag state must be boolean.");
    if (item.flag === false) check_ref(item.value, [...itemPath, "value"], size, fail);
  });
}

function verify_refinement(value: unknown, path: readonly (string | number)[], fail: (path: readonly (string | number)[], message: string) => void): void {
  if (!is_record(value) || typeof value.kind !== "string") { fail(path, "Refinement rule must be an object."); return; }
  const rule = value;
  if (rule.kind === "number-lower-bound" || rule.kind === "number-upper-bound") {
    exact_fields(rule, ["kind", "value", "inclusive"], path, fail);
    if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) fail([...path, "value"], "Numeric bound must be finite.");
    if (typeof rule.inclusive !== "boolean") fail([...path, "inclusive"], "Bound inclusion must be boolean.");
  } else if (rule.kind === "integer" || rule.kind === "array-unique") {
    exact_fields(rule, ["kind"], path, fail);
  } else if (rule.kind === "string-length" || rule.kind === "collection-length") {
    exact_fields(rule, ["kind", "minimum", "maximum"], path, fail);
    verify_length_bounds(rule, path, fail);
  } else if (rule.kind === "string-pattern") {
    exact_fields(rule, ["kind", "dialect", "mode", "pattern"], path, fail);
    if (rule.dialect !== "literal-string-v1") fail([...path, "dialect"], "Unsupported deterministic pattern dialect.");
    if (!["full", "prefix", "suffix", "contains"].includes(String(rule.mode))) fail([...path, "mode"], "Unsupported deterministic pattern mode.");
    if (typeof rule.pattern !== "string") fail([...path, "pattern"], "Pattern must be a string.");
  } else fail([...path, "kind"], `Unknown refinement rule ${JSON.stringify(rule.kind)}.`);
}

function verify_length_bounds(rule: UnknownRecord, path: readonly (string | number)[], fail: (path: readonly (string | number)[], message: string) => void): void {
  for (const key of ["minimum", "maximum"] as const) if (rule[key] !== undefined && (!Number.isSafeInteger(rule[key]) || (rule[key] as number) < 0)) fail([...path, key], `${key} must be a nonnegative safe integer.`);
  if (rule.minimum === undefined && rule.maximum === undefined) fail(path, "Length refinement requires a minimum or maximum.");
  if (typeof rule.minimum === "number" && typeof rule.maximum === "number" && rule.minimum > rule.maximum) fail(path, "Length minimum must not exceed maximum.");
}

function verify_metadata(graph: UnknownRecord, nodes: readonly unknown[], fail: (path: readonly (string | number)[], message: string) => void): void {
  if (graph.semanticDiagnosticMetadata !== undefined) {
    const value = graph.semanticDiagnosticMetadata;
    if (!is_record(value)) fail(["semanticDiagnosticMetadata"], "Semantic diagnostic metadata must be an object.");
    else {
      exact_fields(value, ["labels"], ["semanticDiagnosticMetadata"], fail);
      if (!Array.isArray(value.labels)) fail(["semanticDiagnosticMetadata", "labels"], "Labels must be an array.");
      else {
        const labeled = new Set<number>();
        value.labels.forEach((pair, index) => {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[1] !== "string") fail(["semanticDiagnosticMetadata", "labels", index], "Label must be a [ref, string] pair.");
        else {
          check_ref(pair[0], ["semanticDiagnosticMetadata", "labels", index, 0], nodes.length, fail);
          const target = nodes[pair[0] as number];
          if (is_record(target) && (typeof target.kind !== "string" || !PROJECTED_KINDS.has(target.kind))) fail(["semanticDiagnosticMetadata", "labels", index, 0], "Semantic diagnostic label must target a projected node.");
          if (typeof pair[0] === "number" && labeled.has(pair[0])) fail(["semanticDiagnosticMetadata", "labels", index, 0], "Semantic diagnostic labels cannot duplicate a node reference.");
          if (typeof pair[0] === "number") labeled.add(pair[0]);
        }
        });
      }
    }
  }
  if (graph.documentationMetadata !== undefined) {
    const value = graph.documentationMetadata;
    if (!is_record(value)) fail(["documentationMetadata"], "Documentation metadata must be an object.");
    else {
      const fields = ["description", "sourceLocation", "authoringProvenance", "generatedFrom", "typescriptOrigin"] as const;
      exact_fields(value, fields, ["documentationMetadata"], fail);
      for (const field of fields) if (value[field] !== undefined && typeof value[field] !== "string") fail(["documentationMetadata", field], "Documentation metadata values must be strings.");
    }
  }
}

function verify_capability_domains(capabilities: UnknownRecord, nodes: readonly unknown[], fail: (path: readonly (string | number)[], message: string) => void): void {
  const expected: Record<CanonicalCapabilityKey, (kind: string) => boolean> = {
    projectedRoot: (kind) => PROJECTED_KINDS.has(kind),
    documentItem: (kind) => DOCUMENT_ITEM_KINDS.has(kind),
    documentContent: (kind) => DOCUMENT_CONTENT_KINDS.has(kind),
    documentElementRoot: (kind) => kind === "document-element",
    documentFragmentRoot: (kind) => kind === "document-fragment-root",
    attrs: (kind) => kind === "document-attrs",
  };
  for (const key of CANONICAL_CAPABILITY_KEYS) {
    const ref = capabilities[key];
    const target = nodes[ref as number];
    if (!Number.isInteger(ref) || !is_record(target)) continue;
    const kind = target.kind;
    if (typeof kind !== "string" || !expected[key](kind)) fail(["capabilities", key], `${key} points to an incompatible node kind.`);
  }
  nodes.forEach((raw, index) => {
    if (!is_record(raw) || typeof raw.kind !== "string") return;
    const check = (ref: unknown, accepts: Set<string> | readonly string[], field: string): void => {
      const target = nodes[ref as number];
      if (!Number.isInteger(ref) || !is_record(target)) return;
      const kind = target.kind;
      const ok = accepts instanceof Set ? typeof kind === "string" && accepts.has(kind) : typeof kind === "string" && accepts.includes(kind);
      if (!ok) fail(["nodes", index, field], `${raw.kind}.${field} points to an incompatible node kind.`);
    };
    if (raw.kind.startsWith("projected-")) for (const [field, ref] of outgoing(raw)) check(ref, PROJECTED_KINDS, field);
    if (raw.kind === "document-element") { if (raw.attrs !== undefined) check(raw.attrs, ["document-attrs"], "attrs"); check(raw.content, DOCUMENT_CONTENT_KINDS, "content"); }
    if (raw.kind === "document-item-union") (raw.choices as unknown[] | undefined)?.forEach((ref) => check(ref, DOCUMENT_ITEM_KINDS, "choices"));
    if (raw.kind === "document-content-union") (raw.choices as unknown[] | undefined)?.forEach((ref) => check(ref, DOCUMENT_CONTENT_KINDS, "choices"));
    if (raw.kind === "document-sequence") (raw.items as unknown[] | undefined)?.forEach((ref) => check(ref, DOCUMENT_ITEM_KINDS, "items"));
    if (raw.kind === "document-repeat") check(raw.item, DOCUMENT_ITEM_KINDS, "item");
    if (raw.kind === "document-fragment-root") check(raw.content, DOCUMENT_CONTENT_KINDS, "content");
    if (raw.kind === "document-attrs") (raw.properties as CanonicalDocumentAttrProperty[] | undefined)?.forEach((prop) => { if (!prop.flag) check(prop.value, PROJECTED_KINDS, "properties.value"); });
  });
}

function verify_reachability_and_order(capabilities: UnknownRecord, nodes: readonly unknown[], fail: (path: readonly (string | number)[], message: string) => void): void {
  const discovered: number[] = [];
  const seen = new Set<number>();
  const visit = (ref: unknown): void => {
    if (!Number.isInteger(ref) || (ref as number) < 0 || (ref as number) >= nodes.length || seen.has(ref as number)) return;
    seen.add(ref as number); discovered.push(ref as number);
    const node = nodes[ref as number]; if (!is_record(node)) return;
    outgoing(node).forEach(([, child]) => visit(child));
  };
  CANONICAL_CAPABILITY_KEYS.forEach((key) => visit(capabilities[key]));
  if (seen.size !== nodes.length) fail(["nodes"], "Canonical node table contains unreachable nodes.");
  discovered.forEach((ref, index) => { if (ref !== index) fail(["nodes", ref], `Node table is not in deterministic first-discovery order; expected node ${index}.`); });
}

function verify_productivity(nodes: readonly unknown[], fail: (path: readonly (string | number)[], message: string) => void): void {
  const state = new Uint8Array(nodes.length);
  const visit = (ref: number): boolean => {
    if (state[ref] === 1) return true;
    if (state[ref] === 2) return false;
    state[ref] = 1;
    const node = nodes[ref];
    if (is_record(node)) for (const child of nonconsuming(node)) if (visit(child)) return true;
    state[ref] = 2; return false;
  };
  for (let index = 0; index < nodes.length; index += 1) if (visit(index)) { fail(["nodes", index], "Recursive cycle makes no consuming validation progress."); return; }
}

function outgoing(node: UnknownRecord): readonly (readonly [string, unknown])[] {
  if (["projected-optional", "projected-nullable", "projected-refinement"].includes(String(node.kind))) return [["base", node.base]];
  if (node.kind === "projected-ref") return [["target", node.target]];
  if (node.kind === "projected-object") return Array.isArray(node.properties) ? node.properties.map((pair) => ["properties", Array.isArray(pair) ? pair[1] : undefined] as const) : [];
  if (node.kind === "projected-array") return node.item === undefined ? [] : [["item", node.item]];
  if (node.kind === "projected-tuple" || node.kind === "document-sequence") return Array.isArray(node.items) ? node.items.map((ref) => ["items", ref] as const) : [];
  if (node.kind === "projected-record") return [["value", node.value]];
  if (["projected-union", "document-item-union", "document-content-union"].includes(String(node.kind))) return Array.isArray(node.choices) ? node.choices.map((ref) => ["choices", ref] as const) : [];
  if (node.kind === "document-element") {
    const edges: Array<readonly [string, unknown]> = [];
    if (node.attrs !== undefined) edges.push(["attrs", node.attrs]);
    if (node.content !== undefined) edges.push(["content", node.content]);
    return edges;
  }
  if (node.kind === "document-repeat") return [["item", node.item]];
  if (node.kind === "document-fragment-root") return [["content", node.content]];
  if (node.kind === "document-attrs") return Array.isArray(node.properties) ? node.properties.flatMap((prop) => is_record(prop) && prop.flag === false ? [["properties", prop.value] as const] : []) : [];
  return [];
}

function nonconsuming(node: UnknownRecord): readonly number[] {
  if (["projected-optional", "projected-nullable", "projected-refinement"].includes(String(node.kind)) && Number.isInteger(node.base)) return [node.base as number];
  if (node.kind === "projected-ref" && Number.isInteger(node.target)) return [node.target as number];
  if (["projected-union", "document-item-union", "document-content-union"].includes(String(node.kind)) && Array.isArray(node.choices)) return node.choices.filter(Number.isInteger) as number[];
  if (node.kind === "document-element") return [node.attrs, node.content].filter(Number.isInteger) as number[];
  if (node.kind === "document-fragment-root" && Number.isInteger(node.content)) return [node.content as number];
  return [];
}

function exact_fields(value: UnknownRecord, allowed: readonly string[], path: readonly (string | number)[], fail: (path: readonly (string | number)[], message: string) => void): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) fail([...path, key], `Unknown field ${JSON.stringify(key)}.`);
}

function check_ref(value: unknown, path: readonly (string | number)[], size: number, fail: (path: readonly (string | number)[], message: string) => void): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= size) fail(path, "Node reference is out of range.");
}

function is_record(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(issues: CanonicalGraphVerificationIssue[]): CanonicalGraphVerification {
  return Object.freeze({ ok: false, issues: Object.freeze(issues) });
}

function deep_freeze(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deep_freeze(child, seen);
  Object.freeze(value);
}

function preflight_data(
  value: unknown,
  path: readonly (string | number)[],
  fail: (path: readonly (string | number)[], message: string) => void,
  active = new Set<object>(),
  seen = new Set<object>(),
): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (value === undefined) { fail(path, "Canonical Schema graph cannot contain explicit undefined values."); return false; }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    fail(path, "Canonical Schema graph contains an executable or unsupported value."); return false;
  }
  if (typeof value !== "object") return true;
  if (is_ordered_projected_object(value)) {
    try { assert_ordered_projected_value(value); return true; } catch { fail(path, "Canonical literal is malformed."); return false; }
  }
  if (active.has(value)) { fail(path, "Canonical Schema object representation must be acyclic; recursion uses numeric references."); return false; }
  if (seen.has(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail(path, "Canonical Schema graph objects must be plain records."); return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) { fail(path, "Canonical Schema graph cannot contain symbol fields."); return false; }
  active.add(value); seen.add(value);
  let ok = true;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) { fail([...path, index], "Canonical Schema arrays must be dense."); ok = false; }
    for (const key of Object.keys(descriptors)) if (key !== "length" && !/^\d+$/.test(key)) { fail([...path, key], "Canonical Schema arrays cannot contain extra properties."); ok = false; }
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    if (!("value" in descriptor)) { fail([...path, key], "Canonical Schema fields must be data properties; accessors are executable."); ok = false; continue; }
    if (!descriptor.enumerable) { fail([...path, key], "Canonical Schema fields must be enumerable data properties."); ok = false; }
    if (!preflight_data(descriptor.value, [...path, Array.isArray(value) && /^\d+$/.test(key) ? Number(key) : key], fail, active, seen)) ok = false;
  }
  active.delete(value);
  return ok;
}
