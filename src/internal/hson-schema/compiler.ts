import type { HsonNode } from "../../core/types.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import type { HsonSourceProvenance, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import {
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalSchemaGraph,
  type CanonicalSchemaNode,
  type VerifiedCanonicalSchemaGraph,
} from "../canonical-schema/graph.js";
import { verify_canonical_schema_graph } from "../canonical-schema/verify.js";
import { evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { is_public_attr_name } from "../../core/public-attrs.js";

export const HSON_SCHEMA_MVP_COMPATIBILITY_VERSION = "hson-schema-mvp-3" as const;

export type HsonSchemaIssueCode =
  | "INVALID_ROOT"
  | "UNKNOWN_SCHEMA_MEMBER"
  | "INVALID_SCHEMA_EXPRESSION"
  | "ILLEGAL_OPTIONAL"
  | "INVALID_UNION"
  | "INVALID_SCHEMA_GRAPH";

export type HsonSchemaIssue = Readonly<{
  code: HsonSchemaIssueCode;
  path: readonly (string | number)[];
  message: string;
  range?: HsonSourceRange;
}>;

export type HsonSchemaDataSemanticNode =
  | Readonly<{ kind: "string" | "number" | "boolean" | "null" }>
  | Readonly<{ kind: "exact"; value: string | number | boolean | null }>
  | Readonly<{ kind: "object"; members: readonly Readonly<{ name: string; optional: boolean; schema: HsonSchemaDataSemanticNode }>[] }>
  | Readonly<{ kind: "array"; item: HsonSchemaDataSemanticNode }>
  | Readonly<{ kind: "tuple"; items: readonly HsonSchemaDataSemanticNode[] }>
  | Readonly<{ kind: "union"; choices: readonly [HsonSchemaDataSemanticNode, HsonSchemaDataSemanticNode] }>;

export type HsonSchemaDocumentAttr = Readonly<{
  name: string;
  optional: boolean;
} & (Readonly<{ flag: true }> | Readonly<{ flag: false; schema: HsonSchemaDataSemanticNode }> )>;

export type HsonSchemaDocumentItem =
  | Readonly<{ kind: "document-string" }>
  | HsonSchemaDocumentElement;

export type HsonSchemaDocumentContent =
  | Readonly<{ kind: "document-empty" }>
  | Readonly<{ kind: "document-string-content" }>
  | Readonly<{ kind: "document-sequence"; items: readonly HsonSchemaDocumentItem[] }>;

export type HsonSchemaDocumentElement = Readonly<{
  kind: "document-element";
  tag: string;
  attrs: readonly HsonSchemaDocumentAttr[];
  attrsExact: boolean;
  content: HsonSchemaDocumentContent;
}>;

export type HsonSchemaSemanticNode = HsonSchemaDataSemanticNode | HsonSchemaDocumentElement;

export type CompiledHsonSchema = Readonly<{
  semantic: HsonSchemaSemanticNode;
  graph: VerifiedCanonicalSchemaGraph;
  provenance: HsonSourceProvenance;
  semanticRanges: ReadonlyMap<HsonSchemaSemanticNode, HsonSourceRange>;
  canonicalNodeCount: number;
}>;

export type HsonSchemaCompilation =
  | Readonly<{ ok: true; value: CompiledHsonSchema }>
  | Readonly<{ ok: false; issues: readonly HsonSchemaIssue[] }>;

type JsonObject = Record<string, unknown>;

/**
 * Editor-neutral compiler for the frozen Hson Schema MVP. It parses only data
 * Hson, validates the recursive bootstrap domain, decodes the human vocabulary,
 * and finally subjects the lowered graph to the canonical verifier.
 */
export function compile_hson_schema(source: string): HsonSchemaCompilation {
  let parsed: ReturnType<typeof parse_hson_with_provenance>;
  try {
    parsed = parse_hson_with_provenance(source);
  } catch (error) {
    return failure("INVALID_ROOT", [], error instanceof Error ? error.message : "Invalid Hson Schema source.");
  }

  let materialized: unknown;
  try {
    materialized = materialize_projected_value(projected_value_from_hson_node(parsed.value));
  } catch (error) {
    return failure("INVALID_ROOT", [], error instanceof Error ? error.message : "Schema must be ordinary data Hson.");
  }

  const admitted = admit_projected_value(materialized);
  const bootstrapResult = evaluate_canonical_projected_schema(HSON_SCHEMA_MVP_BOOTSTRAP, admitted);
  if (!bootstrapResult.ok && bootstrapResult.issues.some((entry) => entry.evidence.kind === "resource-limit")) {
    return failure("INVALID_SCHEMA_EXPRESSION", bootstrapResult.issues[0]?.path ?? [], "Hson Schema exceeds the MVP resource limits.");
  }

  const issues: HsonSchemaIssue[] = [];
  const ranges = new Map<HsonSchemaSemanticNode, HsonSourceRange>();
  if (!is_object(materialized)) return failure("INVALID_ROOT", [], "Hson Schema root must be an object.");
  const rootKeys = Object.keys(materialized);
  let semantic: HsonSchemaSemanticNode | undefined;
  if (materialized.type === "data") {
    if (rootKeys.length !== 2 || rootKeys[0] !== "type" || rootKeys[1] !== "content") {
      return failure("INVALID_ROOT", [], 'Data Hson Schema root must contain exactly `type "data"` followed by `content`.');
    }
    semantic = decode_object_members(materialized.content, ["content"], issues, ranges, parsed.value, parsed.provenance);
  } else if (materialized.type === "document") {
    if (rootKeys[0] !== "type") return failure("INVALID_ROOT", [], 'Document Hson Schema root must begin with `type "document"`.');
    semantic = decode_document_element(materialized, [], true, issues, ranges, parsed.value, parsed.provenance);
  } else {
    return failure("INVALID_ROOT", [], 'Hson Schema root `type` must be exactly "data" or "document".');
  }
  if (semantic === undefined || issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  if (!bootstrapResult.ok) {
    const first = bootstrapResult.issues[0];
    return failure("INVALID_SCHEMA_EXPRESSION", first?.path ?? [], first === undefined
      ? "Schema does not match the MVP bootstrap language."
      : `Schema does not match the MVP bootstrap language (${first.code}${first.expected === undefined ? "" : `: expected ${first.expected}`}).`);
  }
  const graph = lower_hson_schema_semantic(semantic);
  const verified = verify_canonical_schema_graph(graph);
  if (!verified.ok) return failure("INVALID_SCHEMA_GRAPH", [], verified.issues.map((issue) => issue.message).join(" "));
  return Object.freeze({
    ok: true,
    value: Object.freeze({ semantic, graph: verified.graph, provenance: parsed.provenance, semanticRanges: ranges, canonicalNodeCount: verified.graph.nodes.length }),
  });
}

function decode_expression(
  input: unknown,
  path: readonly (string | number)[],
  memberPosition: boolean,
  issues: HsonSchemaIssue[],
  ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>,
  root: HsonNode,
  provenance: HsonSourceProvenance,
): Readonly<{ schema: HsonSchemaDataSemanticNode; optional: boolean }> | undefined {
  if (input === "string" || input === "number" || input === "boolean" || input === "null") {
    const schema = Object.freeze({ kind: input } as const);
    bind_range(schema, path, ranges, root, provenance);
    return Object.freeze({ schema, optional: false });
  }
  if (!is_object(input)) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "Schema expression must be a primitive atom or one MVP descriptor.");
    return undefined;
  }
  const keys = Object.keys(input);
  if (keys.length !== 1) {
    issue(issues, "UNKNOWN_SCHEMA_MEMBER", path, "Schema descriptor must contain exactly one known member.");
    return undefined;
  }
  const operator = keys[0] as string;
  const operand = input[operator];
  let schema: HsonSchemaDataSemanticNode | undefined;
  switch (operator) {
    case "exact":
      if (!is_primitive(operand)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`exact` requires one finite primitive or null.");
      else schema = Object.freeze({ kind: "exact", value: operand });
      break;
    case "content":
      schema = decode_object_members(operand, [...path, "content"], issues, ranges, root, provenance);
      break;
    case "optional": {
      if (!memberPosition) {
        issue(issues, "ILLEGAL_OPTIONAL", path, "`optional` is legal only as the direct Schema of a structure member.");
        break;
      }
      const decoded = decode_expression(operand, [...path, "optional"], false, issues, ranges, root, provenance);
      if (decoded?.optional) issue(issues, "ILLEGAL_OPTIONAL", path, "Nested `optional` is not supported.");
      if (decoded !== undefined) return Object.freeze({ schema: decoded.schema, optional: true });
      break;
    }
    case "array": {
      const decoded = decode_expression(operand, [...path, "array"], false, issues, ranges, root, provenance);
      if (decoded !== undefined) schema = Object.freeze({ kind: "array", item: decoded.schema });
      break;
    }
    case "tuple": {
      if (!Array.isArray(operand)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`tuple` requires one Hson array.");
      else {
        const items: HsonSchemaDataSemanticNode[] = [];
        operand.forEach((item, index) => {
          const decoded = decode_expression(item, [...path, "tuple", index], false, issues, ranges, root, provenance);
          if (decoded !== undefined) items.push(decoded.schema);
        });
        schema = Object.freeze({ kind: "tuple", items: Object.freeze(items) });
      }
      break;
    }
    case "union": {
      if (!Array.isArray(operand) || operand.length !== 2) issue(issues, "INVALID_UNION", path, "`union` requires exactly two branches.");
      else {
        const left = decode_expression(operand[0], [...path, "union", 0], false, issues, ranges, root, provenance);
        const right = decode_expression(operand[1], [...path, "union", 1], false, issues, ranges, root, provenance);
        if (left !== undefined && right !== undefined && distinguishable(left.schema, right.schema)) {
          schema = Object.freeze({ kind: "union", choices: Object.freeze([left.schema, right.schema]) as readonly [HsonSchemaDataSemanticNode, HsonSchemaDataSemanticNode] });
        } else if (left !== undefined && right !== undefined) issue(issues, "INVALID_UNION", path, "Union branches are not distinguishable under the MVP rule.");
      }
      break;
    }
    default:
      issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, operator], `Unknown Hson Schema member ${JSON.stringify(operator)}.`);
  }
  if (schema === undefined) return undefined;
  bind_range(schema, path, ranges, root, provenance);
  return Object.freeze({ schema, optional: false });
}

function decode_object_members(input: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): HsonSchemaDataSemanticNode | undefined {
  if (!is_object(input)) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`content` requires one closed data object.");
    return undefined;
  }
  const members: { name: string; optional: boolean; schema: HsonSchemaDataSemanticNode }[] = [];
  for (const [name, value] of Object.entries(input)) {
    const decoded = decode_expression(value, [...path, name], true, issues, ranges, root, provenance);
    if (decoded !== undefined) members.push(Object.freeze({ name, optional: decoded.optional, schema: decoded.schema }));
  }
  const schema = Object.freeze({ kind: "object", members: Object.freeze(members) } as const);
  bind_range(schema, path, ranges, root, provenance);
  return schema;
}

function decode_document_element(input: JsonObject, path: readonly (string | number)[], rootDescriptor: boolean, issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): HsonSchemaDocumentElement | undefined {
  const allowed = new Set(rootDescriptor ? ["type", "tag", "attrs", "content"] : ["tag", "attrs", "content"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, key], `Unknown document Schema member ${JSON.stringify(key)}.`);
  if (rootDescriptor && input.type !== "document") issue(issues, "INVALID_ROOT", [...path, "type"], 'Document descriptor requires `type "document"`.');
  if (typeof input.tag !== "string" || input.tag.length === 0 || input.tag.startsWith("_hson_")) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "tag"], "Document `tag` requires one ordinary exact tag string.");
  if (!("content" in input)) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "content"], "Document descriptor requires explicit `content`.");
  let attrs: readonly HsonSchemaDocumentAttr[] = Object.freeze([]);
  let attrsExact = false;
  if ("attrs" in input) {
    const decoded = decode_document_attrs(input.attrs, [...path, "attrs"], issues, ranges, root, provenance);
    if (decoded !== undefined) { attrs = decoded.attrs; attrsExact = decoded.closed; }
  }
  const content = decode_document_content(input.content, [...path, "content"], issues, ranges, root, provenance);
  if (typeof input.tag !== "string" || input.tag.length === 0 || input.tag.startsWith("_hson_") || content === undefined) return undefined;
  const schema = Object.freeze({ kind: "document-element", tag: input.tag, attrs, attrsExact, content } as const);
  bind_range(schema, path, ranges, root, provenance);
  return schema;
}

function decode_document_attrs(input: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): Readonly<{ attrs: readonly HsonSchemaDocumentAttr[]; closed: boolean }> | undefined {
  if (!is_object(input)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`attrs` requires one descriptor object."); return undefined; }
  for (const key of Object.keys(input)) if (key !== "props" && key !== "closed") issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, key], `Unknown attrs descriptor member ${JSON.stringify(key)}.`);
  if (!("props" in input) || !is_object(input.props)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "props"], "`attrs.props` requires one object of candidate attribute Schemas."); return undefined; }
  if (input.closed !== undefined && typeof input.closed !== "boolean") issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "closed"], "`attrs.closed` must be boolean when present.");
  const attrs: HsonSchemaDocumentAttr[] = [];
  for (const [name, value] of Object.entries(input.props)) {
    if (!is_public_attr_name(name)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "props", name], `Invalid public attribute name ${JSON.stringify(name)}.`); continue; }
    const decoded = decode_attr_expression(value, [...path, "props", name], issues, ranges, root, provenance);
    if (decoded !== undefined) attrs.push(Object.freeze({ name, ...decoded }));
  }
  return Object.freeze({ attrs: Object.freeze(attrs), closed: input.closed === true });
}

function decode_attr_expression(input: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): Readonly<{ optional: boolean } & (Readonly<{ flag: true }> | Readonly<{ flag: false; schema: HsonSchemaDataSemanticNode }>)> | undefined {
  if (input === "flag") return Object.freeze({ optional: false, flag: true });
  if (is_object(input) && Object.keys(input).length === 1 && "optional" in input) {
    const inner = decode_attr_expression(input.optional, [...path, "optional"], issues, ranges, root, provenance);
    if (inner === undefined) return undefined;
    if (inner.optional) { issue(issues, "ILLEGAL_OPTIONAL", path, "Nested `optional` is not supported."); return undefined; }
    return inner.flag ? Object.freeze({ optional: true, flag: true }) : Object.freeze({ optional: true, flag: false, schema: inner.schema });
  }
  const decoded = decode_expression(input, path, false, issues, ranges, root, provenance);
  if (decoded === undefined) return undefined;
  if (decoded.schema.kind !== "string" && !(decoded.schema.kind === "exact" && typeof decoded.schema.value === "string")) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "Authored valued attrs support `string` and exact strings in this document slice; canonical Hson stores authored attr values as strings.");
    return undefined;
  }
  return Object.freeze({ optional: false, flag: false, schema: decoded.schema });
}

function decode_document_content(input: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): HsonSchemaDocumentContent | undefined {
  if (input === "empty") return Object.freeze({ kind: "document-empty" });
  if (input === "string") return Object.freeze({ kind: "document-string-content" });
  if (!is_object(input) || Object.keys(input).length !== 1 || !("sequence" in input) || !Array.isArray(input.sequence)) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, '`content` must be exactly "empty", "string", or `<sequence [...]>` in the document MVP.');
    return undefined;
  }
  const items: HsonSchemaDocumentItem[] = [];
  input.sequence.forEach((item, index) => {
    if (item === "string") { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "sequence", index], "Mixed/string sequence items are not representable by the current Hson document grammar; use exact `content \"string\"` for textual content."); return; }
    if (!is_object(item)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, "sequence", index], "Document sequence item must be `string` or an element descriptor."); return; }
    const child = decode_document_element(item, [...path, "sequence", index], false, issues, ranges, root, provenance);
    if (child !== undefined) items.push(child);
  });
  return Object.freeze({ kind: "document-sequence", items: Object.freeze(items) });
}

export function lower_hson_schema_semantic(root: HsonSchemaSemanticNode): CanonicalSchemaGraph {
  const nodes: CanonicalSchemaNode[] = [];
  const lower = (schema: HsonSchemaDataSemanticNode, optional = false): number => {
    const ref = nodes.length;
    nodes.push({ kind: "projected-null" });
    if (optional) {
      nodes[ref] = { kind: "projected-optional", base: lower(schema) };
      return ref;
    }
    switch (schema.kind) {
      case "string": case "number": case "boolean": case "null": nodes[ref] = { kind: `projected-${schema.kind}` }; break;
      case "exact": nodes[ref] = schema.value === null ? { kind: "projected-null" } : { kind: "projected-literal", values: Object.freeze([schema.value]) }; break;
      case "object": nodes[ref] = { kind: "projected-object", exact: true, properties: Object.freeze(schema.members.map((member) => Object.freeze([member.name, lower(member.schema, member.optional)] as const))) }; break;
      case "array": nodes[ref] = { kind: "projected-array", item: lower(schema.item) }; break;
      case "tuple": nodes[ref] = { kind: "projected-tuple", items: Object.freeze(schema.items.map((item) => lower(item))) }; break;
      case "union": nodes[ref] = { kind: "projected-union", choices: Object.freeze(schema.choices.map((choice) => lower(choice))) }; break;
    }
    return ref;
  };
  const lowerDocumentItem = (item: HsonSchemaDocumentItem): number => {
    if (item.kind === "document-string") { const ref = nodes.length; nodes.push({ kind: "document-text" }); return ref; }
    return lowerDocumentElement(item);
  };
  const lowerDocumentContent = (content: HsonSchemaDocumentContent): number => {
    const ref = nodes.length; nodes.push({ kind: "document-sequence", items: [] });
    if (content.kind === "document-empty") nodes[ref] = { kind: "document-sequence", items: Object.freeze([]) };
    else if (content.kind === "document-string-content") { const text = nodes.length; nodes.push({ kind: "document-text" }); nodes[ref] = { kind: "document-sequence", items: Object.freeze([text]) }; }
    else nodes[ref] = { kind: "document-sequence", items: Object.freeze(content.items.map(lowerDocumentItem)) };
    return ref;
  };
  const lowerDocumentElement = (element: HsonSchemaDocumentElement): number => {
    const ref = nodes.length; nodes.push({ kind: "document-element", tag: element.tag, content: 0 });
    let attrsRef: number | undefined;
    if (element.attrs.length > 0 || element.attrsExact) {
      attrsRef = nodes.length; nodes.push({ kind: "document-attrs", exact: element.attrsExact, properties: [] });
      nodes[attrsRef] = { kind: "document-attrs", exact: element.attrsExact, properties: Object.freeze(element.attrs.map((attr) => attr.flag
        ? Object.freeze({ name: attr.name, optional: attr.optional, flag: true } as const)
        : Object.freeze({ name: attr.name, optional: attr.optional, flag: false, value: lower(attr.schema) } as const))) };
    }
    const content = lowerDocumentContent(element.content);
    nodes[ref] = { kind: "document-element", tag: element.tag, ...(attrsRef === undefined ? {} : { attrs: attrsRef }), content };
    return ref;
  };
  if (root.kind === "document-element") {
    const documentElementRoot = lowerDocumentElement(root);
    return { format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { documentElementRoot }, nodes: Object.freeze(nodes) };
  }
  const projectedRoot = lower(root);
  return { format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot }, nodes: Object.freeze(nodes) };
}

function distinguishable(left: HsonSchemaDataSemanticNode, right: HsonSchemaDataSemanticNode): boolean {
  const primitive = (value: HsonSchemaDataSemanticNode): string | undefined => value.kind === "exact" ? typeof value.value : ["string", "number", "boolean", "null"].includes(value.kind) ? value.kind : undefined;
  const a = primitive(left), b = primitive(right);
  if (a !== undefined || b !== undefined) return a !== undefined && b !== undefined && a !== b;
  if (left.kind !== "object" || right.kind !== "object") return false;
  for (const member of left.members) {
    if (member.optional || member.schema.kind !== "exact" || typeof member.schema.value !== "string") continue;
    const other = right.members.find((candidate) => candidate.name === member.name);
    if (other !== undefined && !other.optional && other.schema.kind === "exact" && typeof other.schema.value === "string" && other.schema.value !== member.schema.value) return true;
  }
  return false;
}

function is_object(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function is_primitive(value: unknown): value is string | number | boolean | null { return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)); }
function issue(issues: HsonSchemaIssue[], code: HsonSchemaIssueCode, path: readonly (string | number)[], message: string): void { issues.push(Object.freeze({ code, path: Object.freeze([...path]), message })); }
function failure(code: HsonSchemaIssueCode, path: readonly (string | number)[], message: string): HsonSchemaCompilation { return Object.freeze({ ok: false, issues: Object.freeze([Object.freeze({ code, path: Object.freeze([...path]), message })]) }); }
function bind_range(schema: HsonSchemaSemanticNode, _path: readonly (string | number)[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, _root: HsonNode, provenance: HsonSourceProvenance): void { ranges.set(schema, provenance.sourceRange); }

function build_bootstrap(): VerifiedCanonicalSchemaGraph {
  // The recursive bootstrap intentionally validates the finite wire domain only;
  // type-dependent legality and restricted-union distinguishability belong to
  // the deterministic human decoder above.
  const nodes: CanonicalSchemaNode[] = [
    { kind: "projected-union", choices: [1, 25] },
    { kind: "projected-object", exact: true, properties: [["type", 2], ["content", 3]] },
    { kind: "projected-literal", values: ["data"] },
    { kind: "projected-record", value: 4 },
    { kind: "projected-union", choices: [5, 6, 12, 15, 17, 19, 22] },
    { kind: "projected-literal", values: ["string", "number", "boolean", "null"] },
    { kind: "projected-object", exact: true, properties: [["exact", 7]] },
    { kind: "projected-union", choices: [8, 9, 10, 11] },
    { kind: "projected-string" },
    { kind: "projected-number" },
    { kind: "projected-boolean" },
    { kind: "projected-null" },
    { kind: "projected-object", exact: true, properties: [["content", 13]] },
    { kind: "projected-record", value: 14 },
    { kind: "projected-ref", target: 4 },
    { kind: "projected-object", exact: true, properties: [["optional", 16]] },
    { kind: "projected-ref", target: 4 },
    { kind: "projected-object", exact: true, properties: [["array", 18]] },
    { kind: "projected-ref", target: 4 },
    { kind: "projected-object", exact: true, properties: [["tuple", 20]] },
    { kind: "projected-array", item: 21 },
    { kind: "projected-ref", target: 4 },
    { kind: "projected-object", exact: true, properties: [["union", 23]] },
    { kind: "projected-tuple", items: [24, 24] },
    { kind: "projected-ref", target: 4 },
    { kind: "projected-object", exact: false, properties: [["type", 26], ["tag", 27], ["content", 28], ["attrs", 29]] },
    { kind: "projected-literal", values: ["document"] },
    { kind: "projected-string" },
    { kind: "projected-any" },
    { kind: "projected-optional", base: 28 },
  ];
  const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(" "));
  return result.graph;
}

export const HSON_SCHEMA_MVP_BOOTSTRAP = build_bootstrap();
