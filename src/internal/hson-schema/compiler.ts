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
  type CanonicalRefinementRule,
  type VerifiedCanonicalSchemaGraph,
} from "../canonical-schema/graph.js";
import { verify_canonical_schema_graph } from "../canonical-schema/verify.js";
import { evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { is_public_attr_name } from "../../core/public-attrs.js";
import { resolve_projected_hson_location } from "../../api/livemap/livemap.editor.js";

export const HSON_SCHEMA_MVP_COMPATIBILITY_VERSION = "hson-schema-mvp-4" as const;

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

export type HsonSchemaRefinement = Readonly<{
  member: "int" | "min" | "max" | "over" | "under" | "len" | "minlen" | "maxlen" | "prefix" | "suffix" | "contains" | "unique";
  rule: CanonicalRefinementRule;
}>;

type Refined = Readonly<{ refinements: readonly HsonSchemaRefinement[] }>;

export type HsonSchemaDataSemanticNode =
  | (Readonly<{ kind: "string" | "number" }> & Refined)
  | Readonly<{ kind: "boolean" | "null" }>
  | Readonly<{ kind: "exact"; value: string | number | boolean | null }>
  | Readonly<{ kind: "object"; members: readonly Readonly<{ name: string; optional: boolean; schema: HsonSchemaDataSemanticNode }>[] }>
  | (Readonly<{ kind: "array"; item: HsonSchemaDataSemanticNode }> & Refined)
  | (Readonly<{ kind: "tuple"; items: readonly HsonSchemaDataSemanticNode[] }> & Refined)
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
  if (semantic === undefined || issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues.map((entry) => with_issue_range(entry, parsed.value, parsed.provenance))) });
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
    const schema = input === "string" || input === "number"
      ? Object.freeze({ kind: input, refinements: Object.freeze([]) } as const)
      : Object.freeze({ kind: input } as const);
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
    case "number":
      schema = decode_refined_primitive("number", operand, path, issues);
      break;
    case "string":
      schema = decode_refined_primitive("string", operand, path, issues);
      break;
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
      const wrapper = decode_collection_wrapper("array", operand, path, issues);
      const itemInput = wrapper?.content ?? operand;
      const decoded = decode_expression(itemInput, [...path, "array", ...(wrapper === undefined ? [] : ["content"])], false, issues, ranges, root, provenance);
      if (decoded !== undefined) schema = Object.freeze({ kind: "array", item: decoded.schema, refinements: wrapper?.refinements ?? Object.freeze([]) });
      break;
    }
    case "tuple": {
      const wrapper = decode_collection_wrapper("tuple", operand, path, issues);
      const itemsInput = wrapper?.content ?? operand;
      if (!Array.isArray(itemsInput)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`tuple` requires one Hson array.");
      else {
        const items: HsonSchemaDataSemanticNode[] = [];
        itemsInput.forEach((item, index) => {
          const decoded = decode_expression(item, [...path, "tuple", ...(wrapper === undefined ? [] : ["content"]), index], false, issues, ranges, root, provenance);
          if (decoded !== undefined) items.push(decoded.schema);
        });
        schema = Object.freeze({ kind: "tuple", items: Object.freeze(items), refinements: wrapper?.refinements ?? Object.freeze([]) });
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

const NUMERIC_REFINEMENTS = new Set(["int", "min", "max", "over", "under"]);
const STRING_REFINEMENTS = new Set(["len", "minlen", "maxlen", "prefix", "suffix", "contains"]);
const COLLECTION_REFINEMENTS = new Set(["len", "minlen", "maxlen", "unique"]);

function decode_refined_primitive(kind: "number" | "string", operand: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[]): HsonSchemaDataSemanticNode | undefined {
  if (!is_object(operand)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, kind], `\`${kind}\` refinement descriptor requires one object.`); return undefined; }
  if (Object.keys(operand).length === 0) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, kind], `\`${kind}\` refinement descriptor requires at least one approved member.`); return undefined; }
  const refinements = decode_refinements(kind, operand, [...path, kind], issues);
  return refinements === undefined ? undefined : Object.freeze({ kind, refinements });
}

function decode_collection_wrapper(kind: "array" | "tuple", operand: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[]): Readonly<{ content: unknown; refinements: readonly HsonSchemaRefinement[] }> | undefined {
  if (!is_object(operand)) return undefined;
  const refinementKeys = Object.keys(operand).filter((key) => COLLECTION_REFINEMENTS.has(key));
  if (refinementKeys.length === 0) return undefined;
  if (!("content" in operand)) { issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, kind], `Refined \`${kind}\` requires \`content\` for its existing ${kind === "array" ? "item Schema" : "item list"}.`); return Object.freeze({ content: undefined, refinements: Object.freeze([]) }); }
  const allowed = new Set(["content", "len", "minlen", "maxlen", ...(kind === "array" ? ["unique"] : [])]);
  for (const key of Object.keys(operand)) if (!allowed.has(key)) issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, kind, key], `Unknown or illegal ${kind} refinement member ${JSON.stringify(key)}.`);
  const refinementInput: JsonObject = {};
  for (const key of refinementKeys) refinementInput[key] = operand[key];
  const refinements = decode_refinements(kind, refinementInput, [...path, kind], issues) ?? Object.freeze([]);
  return Object.freeze({ content: operand.content, refinements });
}

function decode_refinements(domain: "number" | "string" | "array" | "tuple", input: JsonObject, path: readonly (string | number)[], issues: HsonSchemaIssue[]): readonly HsonSchemaRefinement[] | undefined {
  const issueCount = issues.length;
  const legal = domain === "number" ? NUMERIC_REFINEMENTS : domain === "string" ? STRING_REFINEMENTS : domain === "array" ? COLLECTION_REFINEMENTS : new Set(["len", "minlen", "maxlen"]);
  const refinements: HsonSchemaRefinement[] = [];
  let exactLength: number | undefined, minimumLength: number | undefined, maximumLength: number | undefined;
  for (const [member, value] of Object.entries(input)) {
    if (!legal.has(member)) { issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, member], `Unknown or illegal ${domain} refinement member ${JSON.stringify(member)}.`); continue; }
    if (member === "int") {
      if (value !== true) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, member], "`int` must be exactly true.");
      else refinements.push(Object.freeze({ member, rule: Object.freeze({ kind: "integer" }) }));
    } else if (["min", "max", "over", "under"].includes(member)) {
      if (typeof value !== "number" || !Number.isFinite(value)) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, member], `\`${member}\` requires one finite Hson number.`);
      else refinements.push(Object.freeze({ member: member as "min" | "max" | "over" | "under", rule: Object.freeze({ kind: member === "min" || member === "over" ? "number-lower-bound" : "number-upper-bound", value, inclusive: member === "min" || member === "max" }) }));
    } else if (member === "prefix" || member === "suffix" || member === "contains") {
      if (typeof value !== "string") issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, member], `\`${member}\` requires one literal string.`);
      else refinements.push(Object.freeze({ member, rule: Object.freeze({ kind: "string-pattern", dialect: "literal-string-v1", mode: member, pattern: value }) }));
    } else if (member === "unique") {
      if (value !== true) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, member], "`unique` must be exactly true.");
      else refinements.push(Object.freeze({ member, rule: Object.freeze({ kind: "array-unique" }) }));
    } else {
      if (!Number.isSafeInteger(value) || (value as number) < 0) issue(issues, "INVALID_SCHEMA_EXPRESSION", [...path, member], `\`${member}\` requires one nonnegative safe integer.`);
      else if (member === "len") exactLength = value as number;
      else if (member === "minlen") minimumLength = value as number;
      else maximumLength = value as number;
    }
  }
  if (exactLength !== undefined && (minimumLength !== undefined || maximumLength !== undefined)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`len` cannot be combined with `minlen` or `maxlen`.");
  if (minimumLength !== undefined && maximumLength !== undefined && minimumLength > maximumLength) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`minlen` must not exceed `maxlen`.");
  if (exactLength !== undefined || minimumLength !== undefined || maximumLength !== undefined) {
    const minimum = exactLength ?? minimumLength;
    const maximum = exactLength ?? maximumLength;
    const rule = Object.freeze({ kind: domain === "string" ? "string-length" : "collection-length", ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) }) as CanonicalRefinementRule;
    refinements.push(Object.freeze({ member: exactLength !== undefined ? "len" : minimumLength !== undefined ? "minlen" : "maxlen", rule }));
  }
  if (domain === "number") {
    const lowers = refinements.filter((entry) => entry.rule.kind === "number-lower-bound").map((entry) => entry.rule).filter((rule): rule is Extract<CanonicalRefinementRule, { kind: "number-lower-bound" }> => rule.kind === "number-lower-bound");
    const uppers = refinements.filter((entry) => entry.rule.kind === "number-upper-bound").map((entry) => entry.rule).filter((rule): rule is Extract<CanonicalRefinementRule, { kind: "number-upper-bound" }> => rule.kind === "number-upper-bound");
    const lower = lowers.sort((left, right) => right.value - left.value || Number(left.inclusive) - Number(right.inclusive))[0];
    const upper = uppers.sort((left, right) => left.value - right.value || Number(left.inclusive) - Number(right.inclusive))[0];
    if (lower !== undefined && upper !== undefined && (lower.value > upper.value || lower.value === upper.value && (!lower.inclusive || !upper.inclusive))) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "Numeric refinement bounds admit no value.");
    if (input.int === true) {
      const first = lower === undefined ? Number.NEGATIVE_INFINITY : lower.inclusive ? Math.ceil(lower.value) : Math.floor(lower.value) + 1;
      const last = upper === undefined ? Number.POSITIVE_INFINITY : upper.inclusive ? Math.floor(upper.value) : Math.ceil(upper.value) - 1;
      if (first > last) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "Numeric refinement bounds admit no integer.");
    }
  }
  return issues.length > issueCount ? undefined : Object.freeze(refinements);
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
    const refinements = "refinements" in schema ? schema.refinements : Object.freeze([]);
    for (let index = 0; index < refinements.length; index += 1) nodes.push({ kind: "projected-null" });
    const baseRef = ref + refinements.length;
    switch (schema.kind) {
      case "string": case "number": case "boolean": case "null": nodes[baseRef] = { kind: `projected-${schema.kind}` }; break;
      case "exact": nodes[baseRef] = schema.value === null ? { kind: "projected-null" } : { kind: "projected-literal", values: Object.freeze([schema.value]) }; break;
      case "object": nodes[baseRef] = { kind: "projected-object", exact: true, properties: Object.freeze(schema.members.map((member) => Object.freeze([member.name, lower(member.schema, member.optional)] as const))) }; break;
      case "array": nodes[baseRef] = { kind: "projected-array", item: lower(schema.item) }; break;
      case "tuple": nodes[baseRef] = { kind: "projected-tuple", items: Object.freeze(schema.items.map((item) => lower(item))) }; break;
      case "union": nodes[baseRef] = { kind: "projected-union", choices: Object.freeze(schema.choices.map((choice) => lower(choice))) }; break;
    }
    refinements.forEach((refinement, index) => {
      nodes[ref + index] = { kind: "projected-refinement", base: ref + index + 1, rule: refinement.rule, label: refinement.member };
    });
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
function bind_range(schema: HsonSchemaSemanticNode, path: readonly (string | number)[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): void {
  const location = resolve_projected_hson_location(root, path);
  const range = location === undefined ? undefined : provenance.range({ kind: "node", path: location.valuePath, role: "coverage" });
  ranges.set(schema, range ?? provenance.sourceRange);
}
function with_issue_range(value: HsonSchemaIssue, root: HsonNode, provenance: HsonSourceProvenance): HsonSchemaIssue {
  const location = resolve_projected_hson_location(root, value.path);
  if (location === undefined) return value;
  const range = location.scalarValuePath === undefined ? undefined : provenance.range({ kind: "node", path: location.scalarValuePath, role: "value" });
  const fallback = provenance.range({ kind: "node", path: location.wrapperPath, role: "name" })
    ?? provenance.range({ kind: "node", path: location.valuePath, role: "coverage" });
  return Object.freeze({ ...value, ...((range ?? fallback) === undefined ? {} : { range: range ?? fallback }) });
}

function build_bootstrap(): VerifiedCanonicalSchemaGraph {
  // The recursive bootstrap intentionally validates the finite wire domain only;
  // type-dependent legality and restricted-union distinguishability belong to
  // the deterministic human decoder above.
  const nodes: CanonicalSchemaNode[] = [];
  const reserve = (): number => { const ref = nodes.length; nodes.push({ kind: "projected-null" }); return ref; };
  const add = (node: CanonicalSchemaNode): number => { const ref = reserve(); nodes[ref] = node; return ref; };
  const optional = (base: number): number => add({ kind: "projected-optional", base });
  const literal = (...values: readonly (string | boolean)[]): number => add({ kind: "projected-literal", values });
  const root = reserve();
  const data = reserve();
  const dataType = literal("data");
  const content = reserve();
  const expression = reserve();
  const refExpression = (): number => add({ kind: "projected-ref", target: expression });

  const primitiveAtoms = literal("string", "number", "boolean", "null");
  const exact = reserve();
  const exactValue = reserve();
  const exactString = add({ kind: "projected-string" });
  const exactNumber = add({ kind: "projected-number" });
  const exactBoolean = add({ kind: "projected-boolean" });
  const exactNull = add({ kind: "projected-null" });
  nodes[exactValue] = { kind: "projected-union", choices: [exactString, exactNumber, exactBoolean, exactNull] };
  nodes[exact] = { kind: "projected-object", exact: true, properties: [["exact", exactValue]] };
  const object = reserve();
  const objectMembers = reserve();
  const objectMemberValue = refExpression();
  nodes[objectMembers] = { kind: "projected-record", value: objectMemberValue };
  nodes[object] = { kind: "projected-object", exact: true, properties: [["content", objectMembers]] };
  const optionalDescriptor = reserve();
  const optionalExpression = refExpression();
  nodes[optionalDescriptor] = { kind: "projected-object", exact: true, properties: [["optional", optionalExpression]] };
  const array = reserve();
  const arrayItem = refExpression();
  nodes[array] = { kind: "projected-object", exact: true, properties: [["array", arrayItem]] };
  const tuple = reserve();
  const tupleItems = reserve();
  const tupleItem = refExpression();
  nodes[tupleItems] = { kind: "projected-array", item: tupleItem };
  nodes[tuple] = { kind: "projected-object", exact: true, properties: [["tuple", tupleItems]] };
  const union = reserve();
  const unionItems = reserve();
  const unionItem = refExpression();
  nodes[unionItems] = { kind: "projected-tuple", items: [unionItem, unionItem] };
  nodes[union] = { kind: "projected-object", exact: true, properties: [["union", unionItems]] };

  const refinedNumber = reserve();
  const numberRules = reserve();
  const optionalTrue = reserve();
  const booleanTrue = literal(true);
  nodes[optionalTrue] = { kind: "projected-optional", base: booleanTrue };
  const optionalNumber = reserve();
  const finiteNumber = add({ kind: "projected-number" });
  nodes[optionalNumber] = { kind: "projected-optional", base: finiteNumber };
  nodes[numberRules] = { kind: "projected-object", exact: true, properties: [["int", optionalTrue], ["min", optionalNumber], ["max", optionalNumber], ["over", optionalNumber], ["under", optionalNumber]] };
  nodes[refinedNumber] = { kind: "projected-object", exact: true, properties: [["number", numberRules]] };
  const refinedString = reserve();
  const stringRules = reserve();
  const optionalLength = reserve();
  const nonnegativeInteger = reserve();
  const nonnegativeBase = reserve();
  const lengthNumber = add({ kind: "projected-number" });
  nodes[nonnegativeBase] = { kind: "projected-refinement", base: lengthNumber, rule: { kind: "integer" } };
  nodes[nonnegativeInteger] = { kind: "projected-refinement", base: nonnegativeBase, rule: { kind: "number-lower-bound", value: 0, inclusive: true } };
  nodes[optionalLength] = { kind: "projected-optional", base: nonnegativeInteger };
  const optionalText = reserve();
  const text = add({ kind: "projected-string" });
  nodes[optionalText] = { kind: "projected-optional", base: text };
  nodes[stringRules] = { kind: "projected-object", exact: true, properties: [["len", optionalLength], ["minlen", optionalLength], ["maxlen", optionalLength], ["prefix", optionalText], ["suffix", optionalText], ["contains", optionalText]] };
  nodes[refinedString] = { kind: "projected-object", exact: true, properties: [["string", stringRules]] };
  const refinedArray = reserve();
  const arrayRules = reserve();
  const refinedArrayContent = refExpression();
  nodes[arrayRules] = { kind: "projected-object", exact: true, properties: [["content", refinedArrayContent], ["len", optionalLength], ["minlen", optionalLength], ["maxlen", optionalLength], ["unique", optionalTrue]] };
  nodes[refinedArray] = { kind: "projected-object", exact: true, properties: [["array", arrayRules]] };
  const refinedTuple = reserve();
  const tupleRules = reserve();
  const refinedTupleItems = reserve();
  const refinedTupleItem = refExpression();
  nodes[refinedTupleItems] = { kind: "projected-array", item: refinedTupleItem };
  nodes[tupleRules] = { kind: "projected-object", exact: true, properties: [["content", refinedTupleItems], ["len", optionalLength], ["minlen", optionalLength], ["maxlen", optionalLength]] };
  nodes[refinedTuple] = { kind: "projected-object", exact: true, properties: [["tuple", tupleRules]] };

  nodes[expression] = { kind: "projected-union", choices: [primitiveAtoms, exact, object, optionalDescriptor, array, tuple, union, refinedNumber, refinedString, refinedArray, refinedTuple] };
  nodes[content] = { kind: "projected-record", value: expression };
  nodes[data] = { kind: "projected-object", exact: true, properties: [["type", dataType], ["content", content]] };

  const document = reserve();
  const documentType = literal("document");
  const tag = add({ kind: "projected-string" });
  const documentAny = add({ kind: "projected-any" });
  const optionalAttrs = optional(documentAny);
  nodes[document] = { kind: "projected-object", exact: false, properties: [["type", documentType], ["tag", tag], ["content", documentAny], ["attrs", optionalAttrs]] };
  nodes[root] = { kind: "projected-union", choices: [data, document] };
  const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(" "));
  return result.graph;
}

export const HSON_SCHEMA_MVP_BOOTSTRAP = build_bootstrap();
