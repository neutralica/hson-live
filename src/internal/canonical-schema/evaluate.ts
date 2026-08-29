import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { emit_ordered_json } from "../../api/transform/utils/json-utils/ordered-json.js";
import { decode_public_attr_value, decode_public_attrs } from "../../core/public-attrs.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_ordered_projected_object, ordered_projected_value_equal, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { HsonNode } from "../../core/types.js";
import type { LiveMapSchemaIssueCode, LivePath } from "../../types/livemap.types.js";
import type {
  CanonicalDocumentAttrProperty,
  CanonicalRefinementRule,
  CanonicalSchemaNode,
  CanonicalSchemaNodeRef,
  VerifiedCanonicalSchemaGraph,
} from "./graph.js";
import type { CanonicalGraphEvaluation, CanonicalGraphIssue, CanonicalGraphIssueEvidence } from "./issues.js";

const MISSING: unique symbol = Symbol("CanonicalSchemaMissing");
type ProjectedCandidate = OrderedProjectedValue | typeof MISSING;

export type CanonicalEvaluationLimits = Readonly<{
  maxSteps?: number;
  maxIssues?: number;
}>;

type EvaluationState = {
  steps: number;
  issues: number;
  limits?: CanonicalEvaluationLimits;
  exhausted: boolean;
};

export function evaluate_canonical_projected_schema(
  graph: VerifiedCanonicalSchemaGraph,
  candidate: OrderedProjectedValue,
  limits?: CanonicalEvaluationLimits,
): CanonicalGraphEvaluation {
  const root = graph.capabilities.projectedRoot;
  if (root === undefined) return invalid([make_issue("INVALID_SCHEMA", [], 0, "invalid graph", "missing projected root", { kind: "invalid-graph" })]);
  const state: EvaluationState = { steps: 0, issues: 0, ...(limits === undefined ? {} : { limits }), exhausted: false };
  return projected(graph, root, candidate, [], state);
}

export function evaluate_canonical_document_schema(
  graph: VerifiedCanonicalSchemaGraph,
  root: HsonNode,
  mode: "element" | "fragment",
  limits?: CanonicalEvaluationLimits,
): CanonicalGraphEvaluation {
  const ref = mode === "element" ? graph.capabilities.documentElementRoot : graph.capabilities.documentFragmentRoot;
  if (ref === undefined) {
    const expectedMode = graph.capabilities.documentElementRoot === undefined ? "fragment" : "element";
    return invalid([make_issue("TYPE_MISMATCH", [], 0, `${expectedMode} document root`, `${mode} document root`, { kind: "type-mismatch" })]);
  }
  const state: EvaluationState = { steps: 0, issues: 0, ...(limits === undefined ? {} : { limits }), exhausted: false };
  if (mode === "element") {
    const element = root_element(root);
    if (element === undefined) return invalid([make_issue("TYPE_MISMATCH", [], ref, "element", describe_root(root), { kind: "type-mismatch" })]);
    return document_item(graph, ref, element, [], state);
  }
  const children = logical_root_children(root);
  if (children === undefined) return invalid([make_issue("TYPE_MISMATCH", [], ref, "fragment", describe_root(root), { kind: "type-mismatch" })]);
  const node = graph.nodes[ref];
  if (node?.kind !== "document-fragment-root") return invalid([make_issue("INVALID_SCHEMA", [], ref, "fragment root", node?.kind ?? "missing", { kind: "invalid-graph" })]);
  return document_content(graph, node.content, children, [], state);
}

function projected(graph: VerifiedCanonicalSchemaGraph, ref: number, value: ProjectedCandidate, path: LivePath, state: EvaluationState): CanonicalGraphEvaluation {
  if (!step(state)) return resource(ref, path);
  const node = graph.nodes[ref];
  if (node === undefined) return invalid([make_issue("INVALID_SCHEMA", path, ref, "valid graph node", "missing", { kind: "invalid-graph" })]);
  if (value === MISSING) {
    if (node.kind === "projected-optional") return valid();
    return invalid([make_issue("MISSING_REQUIRED", path, ref, projected_label(graph, ref), "missing", { kind: "missing-required" })]);
  }
  if (node.kind === "projected-optional") return projected(graph, node.base, value, path, state);
  if (node.kind === "projected-nullable") return value === null ? valid() : projected(graph, node.base, value, path, state);
  if (node.kind === "projected-ref") return projected(graph, node.target, value, path, state);
  if (value === null) {
    if (node.kind === "projected-null" || node.kind === "projected-any") return valid();
    return mismatch(graph, ref, path, "null");
  }
  if (node.kind === "projected-any") return valid();
  if (node.kind === "projected-literal") {
    if (node.values.some((literal) => ordered_projected_value_equal(literal, value))) return valid();
    return invalid([make_issue("INVALID_LITERAL", path, ref, projected_label(graph, ref), emit_ordered_json(value), { kind: "literal-mismatch" })]);
  }
  if (node.kind === "projected-union") {
    const branches = node.choices.map((choice) => projected(graph, choice, value, path, state));
    if (branches.some((branch) => branch.ok)) return valid();
    if (is_ordered_projected_object(value) && node.choices.some((choice) => graph.nodes[unwrap(graph, choice)]?.kind === "projected-object")) {
      let closest = branches[0];
      for (const branch of branches.slice(1)) if ((branch.issues.length < (closest?.issues.length ?? Infinity))) closest = branch;
      if (closest !== undefined && closest.issues.length > 0) return closest;
    }
    return invalid([make_issue("TYPE_MISMATCH", path, ref, projected_label(graph, ref), projected_type(value), { kind: "union-failure", branches: node.choices })]);
  }
  if (node.kind === "projected-refinement") {
    const base = projected(graph, node.base, value, path, state);
    if (!base.ok) return base;
    if (refinement_matches(node.rule, value)) return valid();
    return invalid([make_issue("INVALID_CONSTRAINT", path, ref, node.label ?? refinement_label(node.rule), emit_ordered_json(value), { kind: "refinement-failure", detail: node.rule.kind })]);
  }
  if (node.kind === "projected-array") {
    if (!Array.isArray(value)) return mismatch(graph, ref, path, projected_type(value));
    if (node.item === undefined) return valid();
    return merge(value.map((item, index) => projected(graph, node.item as number, item, [...path, index], state)), state);
  }
  if (node.kind === "projected-tuple") {
    if (!Array.isArray(value)) return mismatch(graph, ref, path, projected_type(value));
    const results = node.items.map((item, index) => projected(graph, item, index < value.length ? value[index] as OrderedProjectedValue : MISSING, [...path, index], state));
    for (let index = node.items.length; index < value.length; index += 1) results.push(invalid([make_issue("TUPLE_INDEX_OUT_OF_RANGE", [...path, index], ref, undefined, undefined, { kind: "tuple-index-out-of-range" })]));
    return merge(results, state);
  }
  if (node.kind === "projected-object") {
    if (!is_ordered_projected_object(value)) return mismatch(graph, ref, path, projected_type(value));
    const props = new Map(node.properties); const values = new Map(value.entries);
    const results = node.properties.map(([key, child]) => projected(graph, child, values.has(key) ? values.get(key) as OrderedProjectedValue : MISSING, [...path, key], state));
    if (node.exact) for (const [key] of value.entries) if (!props.has(key)) results.push(invalid([make_issue("UNKNOWN_KEY", [...path, key], ref, undefined, undefined, { kind: "unknown-key", detail: key })]));
    return merge(results, state);
  }
  if (node.kind === "projected-record") {
    if (!is_ordered_projected_object(value)) return mismatch(graph, ref, path, projected_type(value));
    return merge(value.entries.map(([key, child]) => projected(graph, node.value, child, [...path, key], state)), state);
  }
  if (node.kind === "projected-string" || node.kind === "projected-number" || node.kind === "projected-boolean") {
    const expectedType = node.kind.slice("projected-".length);
    return typeof value === expectedType ? valid() : mismatch(graph, ref, path, projected_type(value));
  }
  return invalid([make_issue("INVALID_SCHEMA", path, ref, "projected node", node.kind, { kind: "invalid-graph" })]);
}

function document_item(graph: VerifiedCanonicalSchemaGraph, ref: number, value: HsonNode, path: readonly number[], state: EvaluationState): CanonicalGraphEvaluation {
  if (!step(state)) return resource(ref, path);
  const node = graph.nodes[ref];
  if (node?.kind === "document-item-union") {
    const branches = node.choices.map((choice) => document_item(graph, choice, value, path, state));
    if (branches.some((branch) => branch.ok)) return valid();
    return document_union_failure(ref, node.choices, branches, path, "an allowed document item", describe_item(value));
  }
  if (node?.kind === "document-text") return value.$_tag === STR_TAG && value.$_content.length === 1 && typeof value.$_content[0] === "string"
    ? valid() : invalid([make_issue("TYPE_MISMATCH", path, ref, "text", describe_item(value), { kind: "type-mismatch" })]);
  if (node?.kind === "document-any-item") return valid();
  if (node?.kind !== "document-element") return invalid([make_issue("INVALID_SCHEMA", path, ref, "document item", node?.kind ?? "missing", { kind: "invalid-graph" })]);
  if (!is_ordinary_element_node(value)) return invalid([make_issue("TYPE_MISMATCH", path, ref, "element", describe_item(value), { kind: "type-mismatch" })]);
  if (node.tag !== undefined && node.tag !== value.$_tag) return invalid([make_issue("INVALID_LITERAL", path, ref, JSON.stringify(node.tag), JSON.stringify(value.$_tag), { kind: "document-tag-mismatch" })]);
  const attrsResult = node.attrs === undefined ? valid() : document_attrs(graph, node.attrs, value.$_attrs ?? {}, path, state);
  if (graph.nodes[node.content]?.kind === "document-broad-content") return attrsResult;
  const children = logical_element_children(value);
  if (children === undefined) return invalid([make_issue("INVALID_SCHEMA", path, ref, "canonical logical content", "invalid content", { kind: "invalid-graph" })]);
  const contentResult = document_content(graph, node.content, children, path, state);
  return merge([attrsResult, contentResult], state);
}

function document_attrs(graph: VerifiedCanonicalSchemaGraph, ref: number, input: unknown, path: readonly number[], state: EvaluationState): CanonicalGraphEvaluation {
  if (!step(state)) return resource(ref, path);
  const node = graph.nodes[ref];
  if (node?.kind === "document-broad-content") return valid();
  if (node?.kind !== "document-attrs") return invalid([make_issue("INVALID_SCHEMA", path, ref, "attrs", node?.kind ?? "missing", { kind: "invalid-graph" })]);
  const attrs = decode_public_attrs(input);
  if (attrs === undefined) return invalid([make_issue("TYPE_MISMATCH", path, ref, "canonical attrs", "invalid attrs", { kind: "type-mismatch" })]);
  const rules = new Map(node.properties.map((prop) => [prop.name, prop] as const));
  const issues: CanonicalGraphIssue[] = [];
  for (const property of node.properties) {
    if (!Object.prototype.hasOwnProperty.call(attrs, property.name)) {
      if (!property.optional) issues.push(make_issue("MISSING_REQUIRED", path, ref, property.flag ? `flag ${JSON.stringify(property.name)}` : "required attribute", "missing", { kind: "attr-missing" }, property.name));
      continue;
    }
    if (property.flag) {
      if (attrs[property.name] !== property.name) issues.push(make_issue("INVALID_LITERAL", path, ref, JSON.stringify(property.name), JSON.stringify(attrs[property.name]), { kind: "flag-mismatch" }, property.name));
      continue;
    }
    const admitted = decode_public_attr_value(property.name, attrs[property.name]);
    const result = admitted === undefined
      ? invalid([make_issue("TYPE_MISMATCH", path, property.value, undefined, undefined, { kind: "attr-invalid" }, property.name)])
      : projected(graph, property.value, admit_attr(admitted), [], state);
    for (const problem of result.issues) issues.push(Object.freeze({ ...problem, path: Object.freeze([...path]), attributeName: property.name, evidence: Object.freeze({ kind: "attr-invalid", detail: problem.evidence.kind }) }));
  }
  if (node.exact) for (const name of Object.keys(attrs)) if (!rules.has(name)) issues.push(make_issue("UNKNOWN_KEY", path, ref, "declared attribute", JSON.stringify(name), { kind: "unknown-key" }, name));
  return issues.length === 0 ? valid() : invalid(issues);
}

function document_content(graph: VerifiedCanonicalSchemaGraph, ref: number, children: readonly HsonNode[], path: readonly number[], state: EvaluationState): CanonicalGraphEvaluation {
  if (!step(state)) return resource(ref, path);
  const node = graph.nodes[ref];
  if (node?.kind === "document-content-union") {
    const branches = node.choices.map((choice) => document_content(graph, choice, children, path, state));
    if (branches.some((branch) => branch.ok)) return valid();
    return document_union_failure(ref, node.choices, branches, path, "an allowed complete content layout", `content length ${children.length}`);
  }
  if (node?.kind === "document-repeat") {
    if (node.count !== undefined && children.length !== node.count) {
      const short = children.length < node.count;
      return invalid([make_issue(short ? "MISSING_REQUIRED" : "TUPLE_INDEX_OUT_OF_RANGE", short ? [...path, children.length] : path, ref, `length ${node.count}`, `length ${children.length}`, { kind: short ? "missing-required" : "tuple-index-out-of-range" })]);
    }
    return merge(children.map((child, index) => document_item(graph, node.item, child, [...path, index], state)), state);
  }
  if (node?.kind !== "document-sequence") return invalid([make_issue("INVALID_SCHEMA", path, ref, "document content", node?.kind ?? "missing", { kind: "invalid-graph" })]);
  if (children.length !== node.items.length) {
    const short = children.length < node.items.length;
    return invalid([make_issue(short ? "MISSING_REQUIRED" : "TUPLE_INDEX_OUT_OF_RANGE", short ? [...path, children.length] : path, ref, `length ${node.items.length}`, `length ${children.length}`, { kind: short ? "missing-required" : "tuple-index-out-of-range" })]);
  }
  return merge(node.items.map((item, index) => document_item(graph, item, children[index] as HsonNode, [...path, index], state)), state);
}

function document_union_failure(ref: number, choices: readonly number[], branches: readonly CanonicalGraphEvaluation[], path: readonly number[], expected: string, received: string): CanonicalGraphEvaluation {
  const closest = [...branches].sort((left, right) => {
    const leftDepth = left.issues[0]?.path.length ?? 0; const rightDepth = right.issues[0]?.path.length ?? 0;
    return leftDepth !== rightDepth ? rightDepth - leftDepth : left.issues.length - right.issues.length;
  })[0];
  return invalid([make_issue("TYPE_MISMATCH", path, ref, expected, received, { kind: "union-failure", branches: choices }), ...(closest?.issues ?? [])]);
}

function projected_label(graph: VerifiedCanonicalSchemaGraph, ref: number, seen = new Set<number>()): string {
  const semanticLabel = graph.semanticDiagnosticMetadata?.labels.find(([node]) => node === ref)?.[1];
  if (semanticLabel !== undefined) return semanticLabel;
  if (seen.has(ref)) return "recurse"; seen.add(ref);
  const node = graph.nodes[ref]; if (node === undefined) return "invalid schema";
  if (node.kind === "projected-literal") return node.values.map(emit_ordered_json).join(" | ");
  if (node.kind === "projected-union") return node.choices.map((choice) => projected_label(graph, choice, new Set(seen))).join(" | ") || "pick";
  if (node.kind === "projected-ref") return projected_label(graph, node.target, seen);
  if (node.kind === "projected-optional") return projected_label(graph, node.base, seen);
  if (node.kind === "projected-nullable") {
    const label = projected_label(graph, node.base, seen); return label === "null" ? label : `${label} | null`;
  }
  if (node.kind === "projected-refinement") return node.label ?? "constraint";
  const names: Record<string, string> = { "projected-any": "unknown", "projected-string": "string", "projected-number": "number", "projected-boolean": "boolean", "projected-null": "null", "projected-object": "object", "projected-array": "array", "projected-tuple": "tuple", "projected-record": "record" };
  return names[node.kind] ?? node.kind;
}

function mismatch(graph: VerifiedCanonicalSchemaGraph, ref: number, path: LivePath, received: string): CanonicalGraphEvaluation {
  return invalid([make_issue("TYPE_MISMATCH", path, ref, projected_label(graph, ref), received, { kind: "type-mismatch" })]);
}

function refinement_matches(rule: CanonicalRefinementRule, value: OrderedProjectedValue): boolean {
  if (rule.kind === "number-lower-bound") return typeof value === "number" && (rule.inclusive ? value >= rule.value : value > rule.value);
  if (rule.kind === "number-upper-bound") return typeof value === "number" && (rule.inclusive ? value <= rule.value : value < rule.value);
  if (rule.kind === "integer") return typeof value === "number" && Number.isInteger(value);
  if (rule.kind === "string-length") return typeof value === "string" && within(Array.from(value).length, rule.minimum, rule.maximum);
  if (rule.kind === "string-pattern") return typeof value === "string" && (rule.mode === "full" ? value === rule.pattern : rule.mode === "prefix" ? value.startsWith(rule.pattern) : rule.mode === "suffix" ? value.endsWith(rule.pattern) : value.includes(rule.pattern));
  if (rule.kind === "collection-length") {
    const length = Array.isArray(value) ? value.length : is_ordered_projected_object(value) ? value.entries.length : -1;
    return length >= 0 && within(length, rule.minimum, rule.maximum);
  }
  if (rule.kind === "array-unique") return Array.isArray(value) && value.every((item, index) => value.slice(0, index).every((prior) => !ordered_projected_value_equal(prior, item)));
  return false;
}

function within(value: number, minimum?: number, maximum?: number): boolean { return (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum); }
function refinement_label(rule: CanonicalRefinementRule): string { return rule.kind; }
function projected_type(value: OrderedProjectedValue): string { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function unwrap(graph: VerifiedCanonicalSchemaGraph, ref: number, seen = new Set<number>()): number { if (seen.has(ref)) return ref; seen.add(ref); const node = graph.nodes[ref]; return node?.kind === "projected-optional" || node?.kind === "projected-nullable" || node?.kind === "projected-refinement" ? unwrap(graph, node.base, seen) : node?.kind === "projected-ref" ? unwrap(graph, node.target, seen) : ref; }

function make_issue(code: LiveMapSchemaIssueCode, path: LivePath, schemaNode: number, expected: string | undefined, received: string | undefined, evidence: CanonicalGraphIssueEvidence, attributeName?: string): CanonicalGraphIssue {
  return Object.freeze({ code, path: Object.freeze([...path]), schemaNode, ...(expected === undefined ? {} : { expected }), ...(received === undefined ? {} : { received }), ...(attributeName === undefined ? {} : { attributeName }), evidence: Object.freeze(evidence) });
}
function valid(): CanonicalGraphEvaluation { return Object.freeze({ ok: true, issues: Object.freeze([]) }); }
function invalid(issues: readonly CanonicalGraphIssue[]): CanonicalGraphEvaluation { return Object.freeze({ ok: false, issues: Object.freeze([...issues]) }); }
function merge(results: readonly CanonicalGraphEvaluation[], state: EvaluationState): CanonicalGraphEvaluation { const issues = results.flatMap((result) => result.issues); if (state.limits?.maxIssues !== undefined && issues.length > state.limits.maxIssues) return resource(issues[0]?.schemaNode ?? 0, issues[0]?.path ?? []); return issues.length === 0 ? valid() : invalid(issues); }
function step(state: EvaluationState): boolean { state.steps += 1; if (state.limits?.maxSteps !== undefined && state.steps > state.limits.maxSteps) { state.exhausted = true; return false; } return true; }
function resource(ref: number, path: LivePath): CanonicalGraphEvaluation { return invalid([make_issue("INVALID_SCHEMA", path, ref, "resource budget", "exhausted", { kind: "resource-limit" })]); }

function root_element(root: HsonNode): HsonNode | undefined { const cluster = root.$_tag === ELEM_TAG ? root : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG ? root.$_content[0] : undefined; if (cluster === undefined || cluster.$_content.length !== 1) return undefined; const only = cluster.$_content[0]; return is_ordinary_element_node(only) ? only : undefined; }
function logical_root_children(root: HsonNode): readonly HsonNode[] | undefined { if (root.$_tag === ROOT_TAG && root.$_content.length === 0) return Object.freeze([]); const cluster = root.$_tag === ELEM_TAG ? root : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG ? root.$_content[0] : undefined; return cluster !== undefined && cluster.$_content.every(is_Node) ? Object.freeze([...cluster.$_content]) as readonly HsonNode[] : undefined; }
function logical_element_children(element: HsonNode): readonly HsonNode[] | undefined { if (!is_ordinary_element_node(element)) return undefined; if (element.$_content.length === 0) return Object.freeze([]); if (element.$_content.length !== 1) return undefined; const cluster = element.$_content[0]; return is_Node(cluster) && cluster.$_tag === ELEM_TAG && cluster.$_content.every(is_Node) ? Object.freeze([...cluster.$_content]) as readonly HsonNode[] : undefined; }
function describe_item(value: HsonNode): string { return value.$_tag === STR_TAG ? "text" : !value.$_tag.startsWith("_hson_") ? `element <${value.$_tag}>` : `structural node <${value.$_tag}>`; }
function describe_root(root: HsonNode): string { return `<${root.$_tag}>`; }
function admit_attr(value: unknown): OrderedProjectedValue { return admit_projected_value(value); }
